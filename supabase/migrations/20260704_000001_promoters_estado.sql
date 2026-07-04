-- Migration: dimensão ESTADO gerencial do promotor  (2026-07-04)
--
-- Objetivo (Refactor Projeção por Estado — sub-PR 1, SÓ ESTRUTURA): adicionar a
-- dimensão gerencial de ESTADO no cadastro do promotor, para a Projeção passar a
-- agrupar por estado (AL/SE/PE/BA) em vez de por CNPJ. Este PR NÃO toca a Projeção,
-- a UI (/cadastros) nem o motor (projecaoMetas) — isso é sub-PR 2 e 3. Aqui a coluna
-- nasce VAZIA (NULL); o backfill do default é SQL à parte (rodado no Studio).
--
-- Decisões de negócio:
--   - estado é GERENCIAL: onde a produção pertence na hierarquia (supervisor/gerente),
--     INDEPENDENTE do CNPJ fiscal (company_id). Caso âncora: Thaynara está no CNPJ de
--     PERNAMBUCO, mas sua produção conta para o gestor de ALAGOAS → estado = 'AL',
--     sobrescrevendo o default derivado 'PE'. O valor SALVO é a verdade; NÃO derivar
--     em runtime (senão casos como o dela reverteriam ao CNPJ).
--   - NULL = "não classificado": bucket VISÍVEL na Projeção (não esconder, não default).
--   - estado_confirmado = proveniência: false = ainda é o default derivado do CNPJ
--     (revisar); true = confirmado/editado manualmente pelo sócio.
--
-- Segurança / idempotência: PURAMENTE ADITIVA (2 colunas novas), transacional,
-- add column IF NOT EXISTS. estado_confirmado NOT NULL DEFAULT false preenche as
-- linhas existentes com false. Rodar 2x é seguro.

begin;

alter table promoters
  add column if not exists estado text
    check (estado is null or estado in ('AL', 'SE', 'PE', 'BA')),
  add column if not exists estado_confirmado boolean not null default false;

comment on column promoters.estado is
  'Estado GERENCIAL do promotor (onde a produção pertence na hierarquia), NULL = não '
  'classificado. INDEPENDENTE do CNPJ fiscal (company_id) — ex.: Thaynara CNPJ PE, '
  'estado AL. Default derivado do CNPJ no backfill, mas o valor salvo é a verdade '
  '(edição sobrescreve; NÃO derivar em runtime).';
comment on column promoters.estado_confirmado is
  'Proveniência do estado: false = default derivado do CNPJ (revisar); true = '
  'confirmado/editado manualmente pelo sócio.';

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) colunas criadas com os tipos esperados:
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'promoters'
--      and column_name in ('estado', 'estado_confirmado')
--    order by column_name;
--   -- esperado: estado / text / YES / null
--   --           estado_confirmado / boolean / NO / false
--
--   -- (b) CHECK ativo (deve FALHAR — rode em begin/rollback):
--   -- begin;
--   --   update promoters set estado = 'XX' where id = (select id from promoters limit 1);
--   -- rollback;  -- esperado: ERROR ... violates check constraint (só AL/SE/PE/BA ou NULL)
--
--   -- (c) coluna VAZIA logo após a migration (sem backfill ainda):
--   select coalesce(estado, '(NULL)') as estado, count(*) from promoters group by 1;
--   -- esperado: (NULL) 62  (todos sem estado; o backfill é o SQL à parte)
