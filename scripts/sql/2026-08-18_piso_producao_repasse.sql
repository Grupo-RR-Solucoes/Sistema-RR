-- ============================================================================
-- 2026-08-18_piso_producao_repasse.sql
--
-- CRIA A REGUA VERSIONADA DO PISO DE PRODUCAO PARA O REPASSE.
--
-- REGRA (decisao Diego): abaixo de um PISO de producao liquida CONSOLIDADA da
-- pessoa na competencia, o REPASSE e ZERO — zera credito E seguro. A comissao da
-- EMPRESA NAO muda: a RR recebe da Promotiva pela producao, independente de
-- repassar. Piso e regra de REPASSE, nao de receita. Se companyGross cair, o DRE
-- fica errado.
--
-- NAO E REGRA DE VINCULO. As duas alcancadas hoje sao CLT_FIXO (fixed_percent
-- 0.1666, medido em promoter_share_profile), mas a coincidencia NAO e o gatilho.
-- O alcance e EXPLICITO, na coluna scope. Uma terceira CLT_FIXO NAO entra
-- sozinha.
--
-- ESTA MIGRATION NAO MUDA NENHUM NUMERO HOJE. Ela so cria a tabela e a linha da
-- regua. Nenhum codigo le esta tabela ainda: lib/pisoProducao.ts existe e tem
-- gate proprio, mas NAO esta ligado ao orquestrador nem aos consolidadores. O
-- piso so passa a morder quando o bloco F do lib/bbtsOrchestrator.ts for ligado,
-- em commit separado e revisado.
--
-- ONDE O PISO VAI SER APLICADO (registro, para o proximo leitor):
--   lib/bbtsOrchestrator.ts, entre :216 e :218 — o UNICO ponto do sistema onde a
--   producao consolidada RR+ADS existe para as duas empresas ao mesmo tempo
--   (:195 base do diario; :198-199 base do fechamento). NAO em closingMonthly:
--   la o consolidado pode nao existir (execucao RR-pura, params opcionais em
--   :216-223) e o fallback zeraria quem nao devia.
--
-- BASE DE CALCULO — a escolha e DADO, porque as duas candidatas DIVERGEM.
-- Medido em 2026-04 (janela 2026-03-31 .. <2026-04-30, via getProductionWindow):
--   LILIAN  fechamento (production_value) 115.030,26 | diario valido 137.620,26
--                                                      -> DIFERENCA 22.590,00
--   MARIA   fechamento     145.900,00     | diario valido 145.900,00  (iguais)
--   2026-06 e 2026-07: identicos nos dois lados, nas duas pessoas.
-- O seed usa PRODUCAO_LIQUIDA_FECHAMENTO: e exatamente o numero que vira
-- production_value no PMR e que aparece no Dashboard, na /metas e na
-- /promotores. Julgar o piso por um numero que nao aparece em tela nenhuma
-- seria inauditavel.
--
-- COMPARACAO = MENOR_QUE: R$ 150.000,00 EXATOS PAGAM. Nao e preciosismo —
-- LILIAN fechou 2026-05 em 150.066,98, R$ 66,98 acima do piso.
--
-- 'zera' NASCE SEM PRODUTO. BBCAP / Conta Corrente / Consorcio continuam pagos.
-- O encanamento da Frente C le a lista, entao mudar isso e uma linha no jsonb,
-- nao um commit. (Medido: as duas tem 0,00 nas tres colunas de produto — no-op.)
--
-- VIGENCIA 2026-08: NAO retroage. As competencias fechadas somam R$ 3.898,37 de
-- repasse que o piso zeraria (2026-04: 670,36 + 1.027,07 | 2026-06: 582,09 +
-- 778,51 | 2026-07: 457,85 + 382,49). Reprocessar mes fechado tem trava propria
-- e e decisao separada. O insert retroativo esta no passo 5, comentado.
--
-- PENDENTE DE DECISAO (nao resolver aqui): promoter_discounts e gravado ANTES do
-- repasse, e payable = final - desconto. Com o piso zerando o final, quem tiver
-- desconto na competencia fica com payable NEGATIVO. Medido nas duas:
--   2026-06 LILIAN  3,75 | 2026-06 MARIA 166,34 | 2026-07 MARIA 24,51
-- Com a vigencia 2026-08 do seed isso e LATENTE (as duas nao tem desconto de
-- 2026-08 em diante). Com o insert retroativo do passo 5 vira VIVO: -194,60 em 3
-- linhas. Ver o TODO em lib/pisoProducao.ts e os sitios
-- lib/promoterAnalytics.ts:1507 e :1385-1386.
--
-- RLS default-deny, igual a trp_rule_versions e leadership_rule_versions: sem
-- policy, authenticated nao le nem escreve; service_role (motor/gate) ignora RLS.
-- Verificado que os 5 caminhos que gravam PMR usam service_role
-- (lib/auth/guards.ts:219-223, app/api/pmr/reconsolidar/route.ts:37,
-- app/api/import/closing/ads/route.ts:41, app/api/calculate/monthly/route.ts:638,
-- lib/monthlyClosingImport.ts:680).
--
-- IDEMPOTENTE: create table if not exists + on conflict do nothing sobre a chave
-- natural (competencia_inicio). Rodar 2x = 0 linhas novas na segunda.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CONFERIR ANTES (rode sozinho primeiro; nao altera nada)
-- ---------------------------------------------------------------------------
-- -- (1a) a tabela ainda nao existe? esperado: 0 linhas.
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'piso_producao_rule_versions';
--
-- -- (1b) as duas pessoas do alcance existem e estao ativas?
-- --      esperado: 2 linhas, is_master = false nas duas.
-- SELECT id, name, active, is_master FROM promoters
--  WHERE id IN ('c8925313-09fb-49c1-b677-e00402181a9a',
--               'bf872c4a-7288-40f8-b53f-43b79218d643');
--
-- -- (1c) o que elas recebem HOJE (o que o piso passaria a zerar).
-- --      esperado: 2026-04/06/07 com source='fechamento' e final > 0.
-- SELECT r.year, r.month, p.name, r.source,
--        r.production_value, r.production_commission_value,
--        r.insurance_commission_value, r.final_commission_value
--   FROM promoter_monthly_results r
--   JOIN promoters p ON p.id = r.promoter_id
--  WHERE r.promoter_id IN ('c8925313-09fb-49c1-b677-e00402181a9a',
--                          'bf872c4a-7288-40f8-b53f-43b79218d643')
--  ORDER BY r.year, r.month, p.name;
--
-- -- (1d) descontos das duas (o payable negativo do TODO acima).
-- --      esperado: 5 linhas, todas apply_to_company = false.
-- SELECT d.year, d.month, p.name, d.discount_type, d.amount
--   FROM promoter_discounts d
--   JOIN promoters p ON p.id = d.promoter_id
--  WHERE d.promoter_id IN ('c8925313-09fb-49c1-b677-e00402181a9a',
--                          'bf872c4a-7288-40f8-b53f-43b79218d643')
--  ORDER BY d.year, d.month;

BEGIN;

-- ---------------------------------------------------------------------------
-- 2. A TABELA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS piso_producao_rule_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Vigencia por COMPETENCIA (1o dia do mes), nao por data-calendario: a regra
  -- vale para a competencia inteira. fim NULO = vigente ate segunda ordem.
  competencia_inicio  date NOT NULL,
  competencia_fim     date,
  -- A REGRA: quanto, sobre qual base, o que zera. NUNCA nome, nunca id de pessoa.
  regra               jsonb NOT NULL,
  -- O ALCANCE. Ver o COMMENT ON COLUMN mais abaixo.
  scope               jsonb NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_piso_vigencia
    CHECK (competencia_fim IS NULL OR competencia_fim >= competencia_inicio),

  -- jsonb_exists() em vez do operador '?': '?' e placeholder em varios clients
  -- e quebraria quem rodar este DDL fora do Studio.
  CONSTRAINT ck_piso_regra_chaves
    CHECK (jsonb_exists(regra, 'piso')
       AND jsonb_exists(regra, 'comparacao')
       AND jsonb_exists(regra, 'base_calculo')
       AND jsonb_exists(regra, 'zera')),
  CONSTRAINT ck_piso_valor
    CHECK ((regra->>'piso')::numeric >= 0),
  CONSTRAINT ck_piso_comparacao
    CHECK (regra->>'comparacao' IN ('MENOR_QUE', 'MENOR_OU_IGUAL')),
  -- Os DOIS valores que o orquestrador sabe computar (lib/bbtsOrchestrator.ts:195
  -- e :198-199). Valor novo aqui SEM codigo que o entenda = pagamento errado; por
  -- isso o dominio e fechado no banco E o leitor lanca no que nao reconhece.
  CONSTRAINT ck_piso_base
    CHECK (regra->>'base_calculo' IN
           ('PRODUCAO_LIQUIDA_FECHAMENTO', 'PRODUCAO_VALIDA_DIARIO')),
  CONSTRAINT ck_piso_escopo_producao
    CHECK (regra->>'escopo_producao' IS NULL
        OR regra->>'escopo_producao' IN ('CONSOLIDADO_RR_ADS')),
  CONSTRAINT ck_piso_zera
    CHECK (jsonb_typeof(regra->'zera') = 'array'
       AND jsonb_array_length(regra->'zera') >= 1
       AND regra->'zera' <@ '["CREDITO","SEGURO","PRODUTO"]'::jsonb),

  CONSTRAINT ck_piso_scope_objeto
    CHECK (jsonb_typeof(scope) = 'object'),
  CONSTRAINT ck_piso_scope_nao_vazio
    CHECK (scope <> '{}'::jsonb),
  -- Dominio FECHADO de chaves de escopo. A guarda de tipo vem antes no OR para
  -- que um scope nao-objeto caia em ck_piso_scope_objeto (erro legivel) e nao
  -- num erro de operador dentro deste CHECK.
  CONSTRAINT ck_piso_scope_chaves
    CHECK (jsonb_typeof(scope) <> 'object'
        OR (scope - 'promoter_ids' - 'profile_types' - 'company_ids' - 'estados')
           = '{}'::jsonb),
  CONSTRAINT ck_piso_scope_promoter_ids
    CHECK (NOT jsonb_exists(scope, 'promoter_ids')
        OR (jsonb_typeof(scope->'promoter_ids') = 'array'
            AND jsonb_array_length(scope->'promoter_ids') >= 1)),

  CONSTRAINT uq_piso_inicio UNIQUE (competencia_inicio)
);

ALTER TABLE piso_producao_rule_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_piso_rule_vigencia
  ON piso_producao_rule_versions (competencia_inicio DESC);

-- UMA vigencia aberta por vez. Duas reguas abertas seriam duas verdades
-- simultaneas, com a ORDEM do resolvedor decidindo dinheiro. Se um dia for
-- preciso ter dois pisos concorrentes, isso e mudanca DELIBERADA de esquema,
-- nao acidente de insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_piso_uma_vigencia_aberta
  ON piso_producao_rule_versions ((true)) WHERE competencia_fim IS NULL;

COMMENT ON TABLE piso_producao_rule_versions IS
  'Regua versionada do PISO DE PRODUCAO PARA O REPASSE: abaixo do piso de '
  'producao liquida consolidada da pessoa na competencia, o repasse e ZERO. A '
  'comissao da EMPRESA nao muda. Lida por lib/pisoProducao.ts e aplicada UMA vez, '
  'no bloco F de lib/bbtsOrchestrator.ts, onde a producao consolidada RR+ADS '
  'existe. Padrao espelhado de trp_rule_versions / leadership_rule_versions.';

COMMENT ON COLUMN piso_producao_rule_versions.regra IS
  'A REGRA, nunca nome: {piso, comparacao, base_calculo, escopo_producao, zera[]}. '
  'base_calculo escolhe entre a producao do FECHAMENTO (= production_value do PMR) '
  'e a do DIARIO valido na janela — elas DIVERGEM (22.590,00 medidos em 2026-04). '
  'comparacao MENOR_QUE => o valor exato do piso PAGA. zera[] diz O QUE morre: '
  'CREDITO, SEGURO e/ou PRODUTO — trocar a lista NAO exige commit.';

-- ESTE E O COMENTARIO QUE IMPORTA PARA O PROXIMO LEITOR.
COMMENT ON COLUMN piso_producao_rule_versions.scope IS
  'O ALCANCE da regua, como REGRA em jsonb — nao como uma linha por pessoa. '
  '{"promoter_ids": ["<uuid>", ...]} e a forma MAIS SIMPLES de escopo, e e a '
  'unica implementada hoje em lib/pisoProducao.ts. A coluna aceita outras formas, '
  'e o CHECK ck_piso_scope_chaves ja as reconhece: "profile_types" (por perfil de '
  'repasse, ex.: ["CLT_FIXO"]), "company_ids" (por empresa) e "estados" (por '
  'regiao). Chaves podem ser combinadas — a semantica pretendida e INTERSECCAO. '
  'PREFIRA EXPRESSAR A REGRA A LISTAR PESSOAS: se o alcance real e "todo CLT_FIXO '
  'da ADS", escreva {"profile_types":["CLT_FIXO"],"company_ids":["<uuid>"]} em vez '
  'de enumerar ids que envelhecem a cada admissao. '
  'ATENCAO — HOJE A REGRA E POR PESSOA DE PROPOSITO: o piso de 150k alcanca duas '
  'promotoras que POR COINCIDENCIA sao CLT_FIXO, e o vinculo NAO e o gatilho '
  '(decisao Diego). Trocar para profile_types faria uma terceira CLT_FIXO entrar '
  'sozinha, sem ninguem decidir. '
  'SEM FK: promoter_ids em jsonb nao tem integridade referencial, entao um uuid '
  'inexistente alcancaria ninguem em silencio. O leitor cobre isso: '
  'lib/pisoProducao.ts valida cada id contra promoters e LANCA se algum nao '
  'resolver. Uma chave de escopo que o leitor ainda nao implementa tambem LANCA — '
  'nunca e ignorada.';

-- ---------------------------------------------------------------------------
-- 2b. RASTRO NO PMR — a coluna que diz "esta linha foi zerada pelo piso"
-- ---------------------------------------------------------------------------
-- POR QUE A COLUNA E OBRIGATORIA (e nao da para o leitor deduzir):
--   Quando o piso zera o repasse, o desconto da competencia NAO e aplicado
--   (decisao Diego: fica pendente, nao vira zero absorvido). Quem aplica o
--   desconto sao os leitores de payable — promoterAnalytics, dre e
--   financialAnalytics — e eles PRECISAM saber que a linha foi zerada pelo piso.
--   Reavaliar o piso no leitor NAO funciona: promoterAnalytics.ts:1421 filtra o
--   agregado por empresa, entao sob filtro de CNPJ a producao sairia PARCIAL e
--   zeraria quem esta ACIMA do piso.
--   Deduzir por "final = 0" tambem nao serve: chave master tem final 0 por outro
--   motivo (cmsMonthly.ts:270-275) e promotor sem producao tambem.
--
-- discount_value CONTINUA 0 nas linhas do fechamento (ja era: closingMonthly e
-- bbtsMonthly gravam 0 sempre). Com o piso ativo isso vira RASTRO deliberado: a
-- linha diz que o desconto NAO aconteceu, nao que aconteceu e foi absorvido.
--
-- DEFAULT false => toda linha existente continua exatamente como esta. Nenhum
-- numero muda por causa desta coluna.
ALTER TABLE promoter_monthly_results
  ADD COLUMN IF NOT EXISTS piso_zerou boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN promoter_monthly_results.piso_zerou IS
  'TRUE quando o PISO DE PRODUCAO zerou o repasse desta linha (ver '
  'piso_producao_rule_versions e lib/pisoProducao.ts). E o flag que autoriza os '
  'leitores de payable a SUPRIMIR o desconto da competencia: piso zerou => '
  'payable 0 E o desconto nao acontece. NAO deduzir isto de final = 0 — chave '
  'master e promotor sem producao tambem tem final 0, por outros motivos.';

-- ---------------------------------------------------------------------------
-- 3. SEED DA REGUA VIGENTE (a partir de 2026-08; NAO retroage)
-- ---------------------------------------------------------------------------
INSERT INTO piso_producao_rule_versions
  (competencia_inicio, competencia_fim, regra, scope, notes)
VALUES
  (DATE '2026-08-01', NULL,
   jsonb_build_object(
     'piso',            150000.00,
     'comparacao',      'MENOR_QUE',
     'base_calculo',    'PRODUCAO_LIQUIDA_FECHAMENTO',
     'escopo_producao', 'CONSOLIDADO_RR_ADS',
     'zera',            jsonb_build_array('CREDITO', 'SEGURO')
   ),
   jsonb_build_object(
     'promoter_ids', jsonb_build_array(
       'c8925313-09fb-49c1-b677-e00402181a9a',  -- LILIAN CRISLAYNE TRINDADE NOBRE
       'bf872c4a-7288-40f8-b53f-43b79218d643'   -- MARIA DE FATIMA TAVARES DA COSTA
     )
   ),
   'Piso permanente de R$ 150.000,00 sobre a producao liquida consolidada da '
   'pessoa na competencia. Abaixo disso, repasse ZERO (credito e seguro). A '
   'comissao da EMPRESA fica inalterada — o piso e regra de REPASSE. Alcance por '
   'promoter_ids de proposito: o perfil CLT_FIXO das duas e coincidencia, nao '
   'gatilho (decisao Diego). Vigencia a partir de 2026-08 para nao reescrever '
   'competencia ja paga (abr+jun+jul somam R$ 3.898,37). PRODUTO fora do zera[].')
ON CONFLICT (competencia_inicio) DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. CONFERIR DEPOIS (rode apos o COMMIT)
-- ---------------------------------------------------------------------------
-- -- (4a) 1 regua, vigente, com a regra legivel.
-- --      esperado: 1 linha | 2026-08-01 | (null) | 150000.00 | MENOR_QUE
-- --                        | PRODUCAO_LIQUIDA_FECHAMENTO | ["CREDITO","SEGURO"]
-- SELECT competencia_inicio, competencia_fim,
--        regra->>'piso'         AS piso,
--        regra->>'comparacao'   AS comparacao,
--        regra->>'base_calculo' AS base,
--        regra->'zera'          AS zera
--   FROM piso_producao_rule_versions
--  ORDER BY competencia_inicio;
--
-- -- (4b) o alcance resolve para pessoas REAIS (o que substitui o FK).
-- --      esperado: 2 linhas — LILIAN CRISLAYNE..., MARIA DE FATIMA...
-- --      QUALQUER numero diferente de 2 = uuid errado no scope. Nao ignore.
-- SELECT p.name, p.active, p.is_master
--   FROM piso_producao_rule_versions v
--   CROSS JOIN LATERAL jsonb_array_elements_text(v.scope->'promoter_ids') AS s(pid)
--   JOIN promoters p ON p.id = s.pid::uuid
--  WHERE v.competencia_fim IS NULL
--  ORDER BY p.name;
--
-- -- (4c) nenhuma vigencia SOBREPOSTA (deve devolver 0 linhas).
-- SELECT a.competencia_inicio, b.competencia_inicio
--   FROM piso_producao_rule_versions a
--   JOIN piso_producao_rule_versions b ON a.id <> b.id
--  WHERE a.competencia_inicio <= COALESCE(b.competencia_fim, DATE '9999-12-31')
--    AND b.competencia_inicio <= COALESCE(a.competencia_fim, DATE '9999-12-31');
--
-- -- (4d) os CHECKs barram regua invalida (rode em BEGIN/ROLLBACK).
-- -- BEGIN;
-- --   INSERT INTO piso_producao_rule_versions (competencia_inicio, regra, scope)
-- --     VALUES (DATE '2027-01-01',
-- --             '{"piso":1,"comparacao":"MENOR_QUE","base_calculo":"CHUTE","zera":["CREDITO"]}'::jsonb,
-- --             '{"promoter_ids":["c8925313-09fb-49c1-b677-e00402181a9a"]}'::jsonb);
-- -- ROLLBACK;  -- esperado: ERROR ... viola "ck_piso_base"
-- -- BEGIN;
-- --   INSERT INTO piso_producao_rule_versions (competencia_inicio, regra, scope)
-- --     VALUES (DATE '2027-01-01',
-- --             '{"piso":1,"comparacao":"MENOR_QUE","base_calculo":"PRODUCAO_VALIDA_DIARIO","zera":["FERIAS"]}'::jsonb,
-- --             '{"promoter_ids":["c8925313-09fb-49c1-b677-e00402181a9a"]}'::jsonb);
-- -- ROLLBACK;  -- esperado: ERROR ... viola "ck_piso_zera"
-- -- BEGIN;
-- --   INSERT INTO piso_producao_rule_versions (competencia_inicio, regra, scope)
-- --     VALUES (DATE '2027-01-01',
-- --             '{"piso":1,"comparacao":"MENOR_QUE","base_calculo":"PRODUCAO_VALIDA_DIARIO","zera":["CREDITO"]}'::jsonb,
-- --             '{"cor_do_cracha":["azul"]}'::jsonb);
-- -- ROLLBACK;  -- esperado: ERROR ... viola "ck_piso_scope_chaves"
-- -- BEGIN;
-- --   INSERT INTO piso_producao_rule_versions (competencia_inicio, regra, scope)
-- --     SELECT DATE '2027-01-01', regra, scope FROM piso_producao_rule_versions LIMIT 1;
-- -- ROLLBACK;  -- esperado: ERROR ... viola "uq_piso_uma_vigencia_aberta"
--
-- -- (4e) NADA mudou no PMR (esta migration nao toca dinheiro; nenhum codigo le a
-- --      tabela ainda). Rode o (1c) de novo: os valores devem estar IDENTICOS.

-- ---------------------------------------------------------------------------
-- 5. DESFAZER / ALTERNATIVA RETROATIVA
-- ---------------------------------------------------------------------------
-- -- (5a) DESFAZER por completo (a tabela e nova e ninguem depende dela):
-- -- DROP TABLE IF EXISTS piso_producao_rule_versions;
--
-- -- (5b) Desligar a regua SEM apagar historico (encerra a vigencia):
-- -- UPDATE piso_producao_rule_versions
-- --    SET competencia_fim = DATE '2026-07-01'
-- --  WHERE competencia_fim IS NULL;
-- --  -- NAO deixa vigencia aberta => o leitor devolve "sem regua" e nada e zerado.
--
-- -- (5c) ALTERNATIVA RETROATIVA — NAO RODAR sem decidir. Muda mes JA PAGO.
-- --      Trocando a vigencia para 2026-04, a proxima reconsolidacao das
-- --      competencias fechadas zeraria (medido no PMR, source='fechamento'):
-- --        2026-04  LILIAN  670,36   MARIA 1.027,07  (prod 115.030,26 / 145.900,00)
-- --        2026-06  LILIAN  582,09   MARIA   778,51  (prod  98.548,32 / 140.800,00)
-- --        2026-07  LILIAN  457,85   MARIA   382,49  (prod  85.390,00 /  64.794,66)
-- --                                          total   R$ 3.898,37
-- --      E o payable ficaria NEGATIVO em 3 linhas (descontos ja lancados):
-- --        2026-06 LILIAN -3,75 | 2026-06 MARIA -166,34 | 2026-07 MARIA -24,51
-- --      jan-mar e mai sao regime 'cms' (ground truth) e NAO sao recalculados —
-- --      lib/reconsolidarCompetencia.ts:123-133 se recusa. Nada mudaria neles,
-- --      nem em 2026-03 (LILIAN 155.449,01 e MARIA 202.113,25, ACIMA do piso)
-- --      nem em 2026-05 (LILIAN 150.066,98, R$ 66,98 acima).
-- -- UPDATE piso_producao_rule_versions
-- --    SET competencia_inicio = DATE '2026-04-01'
-- --  WHERE competencia_fim IS NULL;
