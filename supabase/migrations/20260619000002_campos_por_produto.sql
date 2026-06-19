-- ============================================================
-- Reestruturação campos-por-produto — Fase 1 (SÓ schema).
-- ------------------------------------------------------------
-- Cada produto da Promotiva vira campo próprio em fechamento_mensal_empresa
-- (rastreável e somável no caixa). Substitui a abordagem de NF agregada.
-- Idempotente, nullable, default 0 — não quebra registros existentes.
-- Aplicada manualmente no Supabase Studio (banco não usa migrate automático).
-- ============================================================

ALTER TABLE fechamento_mensal_empresa
  ADD COLUMN IF NOT EXISTS valor_consorcio      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_bbcap          numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_conta_corrente numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_dental         numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_lob            numeric DEFAULT 0;
