-- Migration: Detector de regua obsoleta — CAMADA 1 (TRP)  (2026-07-14)
--
-- Objetivo: gravar, junto de cada linha do PMR (promoter_monthly_results), QUAL
-- versao da TRP (trp_rule_versions) produziu o numero. Sem isto a divergencia
-- "o PMR foi calculado com a regua velha" e INVISIVEL POR CONSTRUCAO — nao ha
-- como nem DETECTAR qual competencia ficou para tras quando a TRP muda.
--
-- ESCOPO (Camada 1): SO a TRP de credito, que e a unica regua com id de versao
-- ESTAVEL (trp_rule_versions.id). A TRP entra no calculo do PMR apenas nos
-- consolidadores que RECALCULAM pela regua:
--   - source='bbts'  (ADS fechada): recalcula credito pela TRP Promotiva.
--   - source='daily' (mes aberto):  recalcula credito pela TRP.
-- NAO entra em source='fechamento'/'cms' (a comissao ja vem PRONTA do arquivo
-- importado — a TRP ali e regua de AUDITORIA, nao insumo do PMR). Nesses a
-- coluna fica NULL de proposito.
--
-- SEMANTICA DAS COLUNAS (o ponto que impede a mentira do "ok"):
--   trp_version_id NULL  = "nao usa TRP" (fechamento/cms) OU "desconhecido"
--                          (linha calculada ANTES deste detector). A UI
--                          distingue os dois pelo source. NUNCA significa "ok".
--   trp_version_id != NULL = a versao efetivamente usada (com fallback em
--                          cascata resolvido: e o id da versao FORNECEDORA, nao
--                          a nominal). O detector compara este id com o vigente
--                          HOJE; diferente => STALE.
--   trp_fallback = true    = competencia sem TRP propria, usou a de uma
--                          competencia anterior (informativo, NAO e stale).
--                          NULL = desconhecido/nao-aplicavel.
--
-- Backfill: NENHUM. As competencias ja gravadas ficam trp_version_id=NULL
-- (DESCONHECIDO) ate a proxima reconsolidacao, que grava o baseline. Inventar
-- versao retroativa seria mentir sobre o que produziu o numero.
--
-- Seguranca/idempotencia: PURAMENTE ADITIVA (2 colunas nullable, sem default).
-- Sem default de proposito: o default seria uma mentira ("ok"/false). NULL e a
-- unica verdade honesta para o historico. transacional; add column IF NOT EXISTS.
-- Rodar 2x e seguro.

begin;

alter table promoter_monthly_results
  add column if not exists trp_version_id uuid
    references trp_rule_versions(id) on delete set null;

alter table promoter_monthly_results
  add column if not exists trp_fallback boolean;

comment on column promoter_monthly_results.trp_version_id is
  'Detector Camada 1: versao da TRP (trp_rule_versions) que produziu esta linha. '
  'Gravada so por consolidadores que recalculam pela TRP (source bbts/daily). '
  'NULL = nao usa TRP (fechamento/cms) OU desconhecido (calculado antes do '
  'detector). NUNCA significa ok — a UI distingue pelo source. Com fallback em '
  'cascata, e o id da versao FORNECEDORA (a efetivamente usada).';
comment on column promoter_monthly_results.trp_fallback is
  'Detector Camada 1: true = competencia sem TRP propria, usou a de uma anterior '
  '(informativo, NAO e stale). NULL = desconhecido/nao-aplicavel.';

-- Consulta do detector (mes fechado): quais linhas bbts/daily tem versao != a
-- vigente. Indice leve para o filtro por competencia + source (o detector varre
-- por year/month). Parcial: so as linhas que carregam versao interessam.
create index if not exists idx_pmr_trp_version
  on promoter_monthly_results (year, month, source)
  where trp_version_id is not null;

commit;

-- ============================================================
-- Verificacao pos-execucao (rodar apos o commit)
-- ============================================================
--   -- (a) as 2 colunas existem e sao NULLABLE (sem default):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'promoter_monthly_results'
--      and column_name in ('trp_version_id','trp_fallback')
--    order by column_name;
--   -- esperado: trp_fallback/boolean/YES/null ; trp_version_id/uuid/YES/null
--
--   -- (b) TODAS as linhas existentes ficam DESCONHECIDO (nada foi backfillado):
--   select count(*) as total,
--          count(trp_version_id) as com_versao        -- esperado: 0
--     from promoter_monthly_results;
--
--   -- (c) a FK aponta para trp_rule_versions:
--   select conname, confrelid::regclass as referencia
--     from pg_constraint
--    where conrelid = 'promoter_monthly_results'::regclass and contype = 'f'
--      and conname like '%trp_version%';
--   -- esperado: 1 linha, referencia = trp_rule_versions
