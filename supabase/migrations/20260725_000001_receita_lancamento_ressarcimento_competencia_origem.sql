-- Migration 1A: receita_lancamento_manual — natureza RESSARCIMENTO + competencia
-- de producao de origem  (frente ADS/BBTS, ressarcimento junho/2026).
--
-- CONTEXTO: o ressarcimento da BBTS (16 contratos de jun/2026 pagos na Faixa 1,
-- corrigidos p/ Faixa 4) foi recebido no caixa de julho mas e producao de junho.
-- A tabela receita_lancamento_manual (migrations 20260604000001 + 20260619000001)
-- tinha UM eixo de competencia (ano/mes = mes de caixa) e a categoria nao aceitava
-- RESSARCIMENTO. Esta migration adiciona a natureza e o eixo de competencia de
-- origem.
--
-- O QUE ESTA MIGRATION MUDA (so isto; a RLS da tabela JA estava ligada antes, NAO
-- e ligada aqui):
--   1) recria o check de categoria incluindo RESSARCIMENTO (OUTRO preservado);
--   2) adiciona competencia_origem_ano / competencia_origem_mes (integer, nullable);
--   3) comenta as duas colunas.
--
-- Transacional, idempotente.
-- STATUS: JA EXECUTADA no Studio (2026-07). Este arquivo versiona o que foi aplicado.

begin;

-- 1) natureza RESSARCIMENTO (OUTRO ja estava nos dados, foi preservado)
alter table receita_lancamento_manual
  drop constraint if exists receita_lancamento_manual_categoria_check;
alter table receita_lancamento_manual
  add constraint receita_lancamento_manual_categoria_check
  check (categoria = any (array['CONSORCIO', 'AJUSTE_CONTADOR', 'OUTRO', 'RESSARCIMENTO']));

-- 2) competencia de PRODUCAO de origem (separada do ano/mes = mes de caixa/fiscal)
alter table receita_lancamento_manual
  add column if not exists competencia_origem_ano integer,
  add column if not exists competencia_origem_mes integer;

comment on column receita_lancamento_manual.competencia_origem_ano is
  'Competencia de PRODUCAO de origem quando difere do ano/mes de caixa. Ex: ressarcimento de producao 06/2026 recebido em 07/2026. NULL = mesma do caixa.';
comment on column receita_lancamento_manual.competencia_origem_mes is
  'Mes (1-12) da competencia de producao de origem. Ver competencia_origem_ano.';

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select pg_get_constraintdef(oid) from pg_constraint
--     where conname = 'receita_lancamento_manual_categoria_check';
--   -- esperado: CHECK (categoria = ANY (ARRAY['CONSORCIO','AJUSTE_CONTADOR','OUTRO','RESSARCIMENTO']))
--
--   select column_name, data_type from information_schema.columns
--     where table_name = 'receita_lancamento_manual'
--       and column_name in ('competencia_origem_ano','competencia_origem_mes');
--   -- esperado: ambas integer
