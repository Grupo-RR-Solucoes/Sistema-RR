-- Migration: Performance index em monthly_closing_entries
--
-- Etapa 3.8 Dia 4.2: resolve timeout 11s pre-existente em
-- /api/auditoria, /api/fechamento, /api/relatorios e
-- /api/relatorios/export. Causa raiz (confirmada via leitura de
-- lib/closingAnalytics.ts): 3 queries paralelas
-- (PRT/CASH/DEBIT) em monthly_closing_entries faziam Seq Scan
-- em ~280k linhas sem index secundario.
--
-- O index cobre o WHERE das 3 queries:
--   WHERE company_cnpj IN (...) AND entry_type = X
--     AND year = Y AND month = Z
--
-- Ordem das colunas escolhida por seletividade:
-- 1. year (1/40 do dataset) - high selectivity
-- 2. month (1/12 do year) - high selectivity
-- 3. entry_type (PRT/CASH/DEBIT/outros) - medium selectivity
-- 4. company_cnpj (4 valores) - low selectivity, mas IN() usa
--
-- /api/dashboard ja era rapido via fastDashboardMode (skipa as
-- 3 queries). Este index resolve os demais endpoints.

create index if not exists monthly_closing_entries_year_month_type_cnpj_idx
  on public.monthly_closing_entries (year, month, entry_type, company_cnpj);

-- Atualizar estatisticas do planner para que o Postgres detecte
-- e use o index imediatamente, sem esperar autoanalyze proxima.
analyze public.monthly_closing_entries;
