-- Migration: producao_contrato — projecao TIPADA por-contrato  (2026-07-04)
--
-- Opcao B, sub-PR 1. Projecao DERIVADA de monthly_closing_entries (que ja guarda,
-- no jsonb metadata, a linha crua por contrato de cada fechamento). NAO e segunda
-- fonte nem muda o importador: e uma view materializada ergonomica (colunas tipadas
-- + indices) sobre o dado que JA existe, para o gerador de cronograma consultar
-- rapido sem parsear jsonb.
--
-- So as linhas com NRO OPERACAO entram (as demais — CASH/INSURANCE/CREDIT — sao
-- agregados sem operacao). Na pratica, 100% das linhas com operacao sao PRT (a
-- carteira de diferido por contrato).
--
-- Idempotente: unique (numero_operacao, competencia, entry_type) + o populate usa
-- ON CONFLICT DO NOTHING (re-rodar nao duplica). Aditiva: nao toca nada existente.

begin;

-- Conversor numerico BR/US robusto — ESPELHA o toNumberBR do app (virgula => BR:
-- ponto e milhar, virgula e decimal; sem virgula => ponto e decimal). Regex-guard:
-- valor invalido vira NULL (NUNCA aborta o insert no meio).
create or replace function to_num_br(v text) returns numeric
  language sql immutable as $$
  with c as (
    select case
      when v is null or btrim(v) = '' then null
      when position(',' in v) > 0 then replace(replace(v, '.', ''), ',', '.')
      else v
    end as s
  )
  select case when s ~ '^-?[0-9]+(\.[0-9]+)?$' then s::numeric else null end from c
$$;

create table if not exists producao_contrato (
  id                        uuid primary key default gen_random_uuid(),
  numero_operacao           text not null,
  competencia               text not null,            -- 'YYYY-MM' do fechamento
  entry_type                text,                      -- na pratica sempre 'PRT'
  chave_j                   text,
  mci                       text,
  valor_financiado          numeric(18,2),
  prazo                     integer,                   -- QTD PARCELAS TOTAL
  parcelas_pagas            integer,                   -- QTD PARCELAS PGS
  comissao                  numeric(18,2),             -- diferido mensal observado
  cod_est                   integer,                   -- 1 pagavel, 2, 99
  monthly_closing_import_id uuid references monthly_closing_imports(id),
  created_at                timestamptz not null default now(),
  unique (numero_operacao, competencia, entry_type)
);

-- indices para o gerador de cronograma / conferencia
create index if not exists idx_producao_contrato_comp_type
  on producao_contrato (competencia, entry_type);
create index if not exists idx_producao_contrato_operacao
  on producao_contrato (numero_operacao);

comment on table producao_contrato is
  'Projecao tipada por-contrato, DERIVADA de monthly_closing_entries (metadata). Nao e '
  'segunda fonte; e materializacao ergonomica para o cronograma de diferido (Opcao B).';

commit;

-- ============================================================
-- POPULATE (rodar SEPARADO no Studio; NAO faz parte do schema).
-- Idempotente (ON CONFLICT DO NOTHING). Insere ~249.740 linhas PRT.
-- ------------------------------------------------------------
--   insert into producao_contrato (numero_operacao, competencia, entry_type, chave_j,
--          mci, valor_financiado, prazo, parcelas_pagas, comissao, cod_est,
--          monthly_closing_import_id)
--   select
--     btrim(metadata->>'NRO OPERAÇÃO'),
--     year || '-' || lpad(month::text, 2, '0'),
--     entry_type,
--     metadata->>'CHAVE J',
--     metadata->>'MCI',
--     to_num_br(metadata->>'VALOR FINANCIADO'),
--     trunc(to_num_br(metadata->>'QTD PARCELAS TOTAL'))::int,
--     trunc(to_num_br(metadata->>'QTD PARCELAS PGS'))::int,
--     to_num_br(coalesce(metadata->>'COMISSÃO', metadata->>'COMISSAO')),
--     trunc(to_num_br(metadata->>'COD EST'))::int,
--     monthly_closing_import_id
--   from monthly_closing_entries
--   where entry_type = 'PRT'                                  -- a carteira de DIFERIDO
--     and btrim(coalesce(metadata->>'NRO OPERAÇÃO', '')) <> ''
--   on conflict (numero_operacao, competencia, entry_type) do nothing;
--
-- Por que SO 'PRT': PRT e a carteira de diferido por contrato — o metadata carrega
-- VALOR FINANCIADO + QTD PARCELAS (prazo) + COMISSAO (o diferido mensal observado).
-- CASH e a a-vista da venda (chave 'CONTRATO', VALOR LIQUIDO, sem parcelas — nao e
-- diferido); CREDIT e agregado (MCI/produto, sem operacao). Logo o diferido do
-- credito TEM base: mora no PRT, nao no CASH/CREDIT.
-- ============================================================
