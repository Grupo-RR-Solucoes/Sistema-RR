-- Migration: previsao_snapshot — congela a previsão de recebíveis  (2026-07-04)
--
-- Objetivo (Pipeline de Recebíveis, sub-PR 1): o "previsto" da tela Recebíveis é
-- RE-DERIVADO a cada request (buildAgregadorRecebiveis). Sem congelar, "previsto
-- ENTÃO vs recebido DEPOIS" é impossível para sempre, e cada fechamento sem
-- snapshot perde histórico irrecuperável. Esta tabela congela, no momento do
-- fechamento, a curva forward que a projeção previu.
--
-- Granularidade: competencia_snapshot × competencia_alvo. Um snapshot é uma CURVA
-- congelada — "no momento X (competencia_snapshot) previ isto para o mês Y
-- (competencia_alvo)". Permite escolher o LEAD (previsão de 1, 2, 3... meses antes)
-- ao confrontar depois com o recebido real.
--
-- Idempotência: unique (competencia_snapshot, competencia_alvo). O congelamento
-- usa ON CONFLICT DO NOTHING (o PRIMEIRO congelamento vence; re-importar o mesmo
-- fechamento NÃO sobrescreve a previsão autêntica).
--
-- ADITIVA: tabela nova, não altera nada existente. previsto_diferido nasce NULL
-- (será preenchido no sub-PR 2). Rodar 2x é seguro (create table if not exists).

begin;

create table if not exists previsao_snapshot (
  id                        uuid primary key default gen_random_uuid(),
  -- QUANDO congelei (o momento/vintage), "YYYY-MM".
  competencia_snapshot      text not null,
  -- o mês PREVISTO por esse congelamento, "YYYY-MM".
  competencia_alvo          text not null,
  -- direito contratado PRT (agenda) previsto para o alvo.
  previsto_prt              numeric(18,2),
  -- à-vista crédito PF previsto (produção aberta) — só na competência da produção.
  previsto_avista           numeric(18,2),
  -- diferido previsto — NULL até o sub-PR 2 (diferido na projeção).
  previsto_diferido         numeric(18,2),
  -- rastreabilidade: competência do estoque PRT (snapshot do prtAgenda) usado.
  base_snapshot_prt         text,
  -- rastreabilidade: nº de contratos à-vista sob fallback de TRP no congelamento.
  contratos_avista_fallback integer,
  data_congelamento         timestamptz not null default now(),
  unique (competencia_snapshot, competencia_alvo)
);

comment on table previsao_snapshot is
  'Congela a previsao de recebiveis (Pipeline de Recebiveis sub-PR 1). Granularidade '
  'competencia_snapshot (quando congelei) x competencia_alvo (mes previsto). Idempotente '
  'via unique(snapshot, alvo) + ON CONFLICT DO NOTHING (primeiro congelamento vence).';
comment on column previsao_snapshot.competencia_snapshot is
  'Momento/vintage do congelamento (YYYY-MM) — QUANDO a previsao foi feita.';
comment on column previsao_snapshot.competencia_alvo is
  'Mes previsto (YYYY-MM) por esse congelamento — o alvo da previsao.';
comment on column previsao_snapshot.previsto_diferido is
  'Diferido previsto. NULL ate o sub-PR 2 (diferido na projecao).';

commit;

-- ============================================================
-- Verificação pós-execução:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='previsao_snapshot'
--    order by ordinal_position;
--   -- tabela nasce VAZIA; o congelamento (hook do fechamento ou acao manual) popula.
-- ============================================================
