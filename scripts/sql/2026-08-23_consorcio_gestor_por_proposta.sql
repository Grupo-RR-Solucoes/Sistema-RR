-- ==============================================================
-- 2026-08-23_consorcio_gestor_por_proposta.sql
--
-- DETALHAMENTO POR PROPOSTA DO PAYOUT DO GESTOR DE CONSORCIO.
--
-- LINHAS CURTAS DE PROPOSITO (<= 72 col): este SQL e copiado do chat
-- para o Studio, e terminal que quebra linha longa gera comando
-- truncado. Nao "arrume" reunindo as linhas.
--
-- REGRA (decisao Diego, 23/08/2026): "o pagamento deve ser por
-- proposta". A decisao operacional que veio junto foi mais fina que
-- isso, e esta migration a segue ao pe da letra:
--
--   (a) QUEM PAGA continua sendo `consorcio_gestor_payout`, uma linha
--       por (competencia, company_id), com o gestor_10 vindo de UM
--       round sobre o agregado. NENHUM valor ja gravado se move.
--   (b) O DETALHE por proposta nasce numa tabela NOVA,
--       `consorcio_gestor_payout_proposta`, informativa. E ela que
--       responde "quanto o gestor ganhou NESTA proposta".
--
-- POR QUE AS DUAS COISAS, E NAO SO UMA: o round muda o total.
-- MEDIDO em 23/08/2026, com os dados de producao:
--     2026-06  agregado 1.190,31  por proposta 1.190,30  delta -0,01
--     2026-07  agregado 1.480,32  por proposta 1.480,31  delta -0,01
-- Junho JA FOI PAGO ao Alan (1.190,31). Fazer o total nascer da soma
-- das propostas obrigaria a conciliar um centavo numa competencia
-- paga. A separacao acima evita isso sem abrir mao do detalhe.
--
-- CONSEQUENCIA ASSUMIDA, ESCRITA PARA O PROXIMO LEITOR: a soma das
-- linhas de detalhe NAO fecha com o gestor_10 do agregado — fica 1
-- centavo abaixo nas duas competencias. Isso NAO e defeito, e a
-- diferenca entre 1 round e N rounds. A coluna `delta_arredondamento`
-- do agregado guarda o numero para ninguem ter de redescobrir. A tela
-- /produtos/atribuicao ja mostra 1.480,31 (soma por proposta) desde
-- cb6e067 — a divergencia ja existia, agora ela esta NOMEADA.
--
-- JUNHO FICA CONGELADA. Nao se apaga, nao se reescreve o valor,
-- nao se muda o status. Ganha so um ROTULO
-- (formato = 'AGREGADO_LEGADO') e NENHUMA linha de detalhe — o
-- passo 5 mostra isso. O codigo respeita o rotulo: quem
-- reconsolidar junho NAO gera detalhe para ela.
--
-- JULHO E REFEITA — no DETALHE, nao no valor. A linha agregada de
-- 2026-07 (1.480,32, gestor ALAN, ABERTO) fica INTACTA; o que passa a
-- existir sao as 33 linhas de detalhe. Aqui esta a UNICA divergencia
-- entre esta migration e a opcao escolhida na conversa: a opcao dizia
-- "a linha agregada de hoje sai". Ela NAO sai, porque a outra decisao
-- da mesma conversa — "agregado paga, proposta so detalha" — a
-- define como o registro de pagamento. Remover a linha agregada
-- de julho faria o pagamento valer 1.480,31, que e exatamente o
-- risco que a primeira decisao recusou. Se a intencao for pagar
-- 1.480,31 em julho, isto e uma linha de UPDATE — mas nao
-- acontece sozinho aqui.
--
-- ESTA MIGRATION NAO MUDA NENHUM VALOR PAGO. Ela cria uma tabela
-- vazia, adiciona duas colunas ADITIVAS e escreve um rotulo em 1
-- linha. O detalhe so aparece quando o reconsolidar rodar depois
-- dela.
--
-- APLICAR MANUALMENTE no Supabase Studio (nao ha migrate automatico).
-- ==============================================================

-- --------------------------------------------------------------
-- 1. CONFERIR ANTES (rode sozinho primeiro; nao altera nada)
-- --------------------------------------------------------------
-- -- (1a) a tabela de detalhe ainda nao existe? esperado: 0 linhas.
-- SELECT table_name
--   FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name = 'consorcio_gestor_payout_proposta';
--
-- -- (1b) as colunas novas ainda nao existem? esperado: 0 linhas.
-- SELECT column_name
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name = 'consorcio_gestor_payout'
--    AND column_name IN ('formato', 'delta_arredondamento');
--
-- -- (1c) o que esta gravado HOJE — o que NAO pode mudar.
-- --      esperado: 2 linhas.
-- --      2026-06 | 11.903,05 | 1.190,31 | gestor NULL | ABERTO
-- --      2026-07 | 14.803,21 | 1.480,32 | gestor ALAN | ABERTO
-- SELECT p.competencia,
--        c.name       AS empresa,
--        u.full_name  AS gestor,
--        p.base_comissao_empresa,
--        p.gestor_10,
--        p.status,
--        p.created_at
--   FROM consorcio_gestor_payout p
--   LEFT JOIN companies c ON c.id = p.company_id
--   LEFT JOIN app_users u ON u.id = p.gestor_user_id
--  ORDER BY p.competencia;
--
-- -- (1d) a base por PROPOSTA que o detalhe vai reproduzir.
-- --      esperado: 2026-06 -> 37 propostas / 11.903,05
-- --                2026-07 -> 33 propostas / 14.803,21
-- SELECT year,
--        month,
--        COUNT(DISTINCT operation_number) AS propostas,
--        COUNT(*)                         AS parcelas,
--        SUM(commission_value)            AS base
--   FROM monthly_closing_entries
--  WHERE entry_type = 'CONSORCIO'
--    AND COALESCE(contract_number, '') NOT LIKE 'M|%'
--  GROUP BY year, month
--  ORDER BY year, month;

BEGIN;

-- --------------------------------------------------------------
-- 2. ROTULO DE FORMATO + O DELTA, NA TABELA QUE PAGA
--    (aditivo, nao destrutivo)
-- --------------------------------------------------------------
-- `formato` diz de que mundo a linha veio. Sem ele, "junho nao
-- tem detalhe" so se saberia pela AUSENCIA de linhas na outra
-- tabela — e ausencia e prova ruim: nao distingue "nao deve ter"
-- de "ainda nao rodou".
ALTER TABLE public.consorcio_gestor_payout
  ADD COLUMN IF NOT EXISTS formato text NOT NULL
  DEFAULT 'AGREGADO_COM_DETALHE';

ALTER TABLE public.consorcio_gestor_payout
  DROP CONSTRAINT IF EXISTS consorcio_gestor_payout_formato_check;

ALTER TABLE public.consorcio_gestor_payout
  ADD CONSTRAINT consorcio_gestor_payout_formato_check
  CHECK (formato IN ('AGREGADO_LEGADO', 'AGREGADO_COM_DETALHE'));

-- O centavo, GRAVADO em vez de redescoberto. NULL = nao calculado.
-- Vale (soma do detalhe) - gestor_10. Negativo = detalhe soma menos.
ALTER TABLE public.consorcio_gestor_payout
  ADD COLUMN IF NOT EXISTS delta_arredondamento numeric(18,2);

COMMENT ON COLUMN public.consorcio_gestor_payout.formato IS
  'AGREGADO_LEGADO = competencia anterior ao detalhe por proposta; '
  'nao gerar detalhe (junho/2026 ja foi paga ao gestor). '
  'AGREGADO_COM_DETALHE = o valor pago continua sendo o desta linha, '
  'e consorcio_gestor_payout_proposta tem o rateio.';

COMMENT ON COLUMN
  public.consorcio_gestor_payout.delta_arredondamento IS
  'soma(detalhe.gestor_10) - gestor_10. Diferenca entre N rounds '
  'por proposta e 1 round no agregado. Medido -0,01 em 2026-06 e '
  'em 2026-07. NAO e defeito.';

-- --------------------------------------------------------------
-- 3. A TABELA DE DETALHE
-- --------------------------------------------------------------
-- Uma linha por (competencia, empresa, PROPOSTA). Nao por parcela: a
-- proposta e a unidade que o Diego nomeou, e e a unidade da ancora de
-- atribuicao (product_line_assignments, entry_type='CONSORCIO').
CREATE TABLE IF NOT EXISTS public.consorcio_gestor_payout_proposta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia text NOT NULL,
  company_id uuid REFERENCES public.companies(id),
  proposta text NOT NULL,
  gestor_user_id uuid
    REFERENCES public.app_users(id) ON DELETE SET NULL,
  base_comissao_empresa numeric(18,2) NOT NULL DEFAULT 0,
  gestor_10 numeric(18,2) NOT NULL DEFAULT 0,
  parcelas integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competencia, company_id, proposta)
);

-- competencia = YYYY-MM. proposta = operation_number.
-- base_comissao_empresa = Sigma comissao-empresa das parcelas
--   REGULARES da proposta na competencia.
-- gestor_10 = round2(base * 0,10) — UM round por proposta.
-- O UNIQUE e a idempotencia: recomputar nao duplica a proposta.

CREATE INDEX IF NOT EXISTS
  consorcio_gestor_payout_proposta_comp_idx
  ON public.consorcio_gestor_payout_proposta (competencia);

CREATE INDEX IF NOT EXISTS
  consorcio_gestor_payout_proposta_gestor_idx
  ON public.consorcio_gestor_payout_proposta (gestor_user_id);

COMMENT ON TABLE public.consorcio_gestor_payout_proposta IS
  'DETALHE informativo do payout do gestor, por proposta. QUEM '
  'PAGA e consorcio_gestor_payout (por competencia+empresa). A '
  'soma daqui '
  'fica ~1 centavo abaixo do agregado por causa dos N rounds — ver '
  'delta_arredondamento la.';

-- --------------------------------------------------------------
-- 4. RLS — o MESMO recorte da tabela que paga
-- --------------------------------------------------------------
-- socio faz tudo; o gestor le SO as linhas onde ele e o
-- gestor_user_id. Nenhum campo de comissao de PROMOTOR mora aqui,
-- entao nao ha o que vazar — mas o recorte por gestor fica igual
-- ao do agregado para nao criar uma segunda regra.
ALTER TABLE public.consorcio_gestor_payout_proposta
  ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.consorcio_gestor_payout_proposta
  TO authenticated;

DROP POLICY IF EXISTS "cgpp_socio_all"
  ON public.consorcio_gestor_payout_proposta;

CREATE POLICY "cgpp_socio_all"
  ON public.consorcio_gestor_payout_proposta
  FOR ALL TO authenticated
  USING (public.current_app_user_role() = 'socio')
  WITH CHECK (public.current_app_user_role() = 'socio');

DROP POLICY IF EXISTS "cgpp_gestor_select"
  ON public.consorcio_gestor_payout_proposta;

CREATE POLICY "cgpp_gestor_select"
  ON public.consorcio_gestor_payout_proposta
  FOR SELECT TO authenticated
  USING (
    public.current_app_user_role() = 'gestor_consorcio'
    AND gestor_user_id = (
      SELECT id FROM public.app_users
       WHERE auth_user_id = auth.uid()
    )
  );

-- --------------------------------------------------------------
-- 5. CONGELAR JUNHO (rotulo apenas — nenhum valor, nenhum status)
-- --------------------------------------------------------------
-- Idempotente: rodar 2x nao faz nada na segunda. NAO toca gestor_10,
-- base_comissao_empresa, status nem gestor_user_id.
UPDATE public.consorcio_gestor_payout
   SET formato = 'AGREGADO_LEGADO'
 WHERE competencia = '2026-06'
   AND formato <> 'AGREGADO_LEGADO';

COMMIT;

-- --------------------------------------------------------------
-- 6. CONFERIR DEPOIS
-- --------------------------------------------------------------
-- -- (6a) as duas linhas seguem com o MESMO valor. So o `formato`
-- --      mudou. esperado:
-- --      2026-06 gestor_10 1190.31 formato AGREGADO_LEGADO
-- --      2026-07 gestor_10 1480.32 formato AGREGADO_COM_DETALHE
-- SELECT competencia,
--        base_comissao_empresa,
--        gestor_10,
--        status,
--        formato,
--        delta_arredondamento
--   FROM consorcio_gestor_payout
--  ORDER BY competencia;
--
-- -- (6b) a tabela de detalhe nasce VAZIA. esperado: 0.
-- --      Ela so enche quando o reconsolidar rodar depois desta.
-- SELECT COUNT(*) AS linhas_de_detalhe
--   FROM consorcio_gestor_payout_proposta;
--
-- -- (6c) RLS ligada e as 2 policies criadas. esperado: 2 linhas.
-- SELECT policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename = 'consorcio_gestor_payout_proposta'
--  ORDER BY policyname;
--
-- -- (6d) DEPOIS de rodar o reconsolidar de 2026-07: o detalhe fecha?
-- --   esperado: 33 propostas, soma 1480.31, agregado 1480.32,
-- --             delta -0.01, e ZERO detalhe para 2026-06 (legado).
-- SELECT d.competencia,
--        COUNT(*)         AS propostas,
--        SUM(d.gestor_10) AS soma_detalhe,
--        MAX(p.gestor_10) AS agregado_que_paga,
--        SUM(d.gestor_10) - MAX(p.gestor_10) AS delta
--   FROM consorcio_gestor_payout_proposta d
--   JOIN consorcio_gestor_payout p
--     ON p.competencia = d.competencia
--    AND p.company_id IS NOT DISTINCT FROM d.company_id
--  GROUP BY d.competencia
--  ORDER BY d.competencia;
--
-- -- ROLLBACK (o rotulo de junho volta ao default)
-- -- BEGIN;
-- --   DROP TABLE IF EXISTS
-- --     public.consorcio_gestor_payout_proposta;
-- --   ALTER TABLE public.consorcio_gestor_payout
-- --     DROP COLUMN IF EXISTS formato;
-- --   ALTER TABLE public.consorcio_gestor_payout
-- --     DROP COLUMN IF EXISTS delta_arredondamento;
-- -- COMMIT;
