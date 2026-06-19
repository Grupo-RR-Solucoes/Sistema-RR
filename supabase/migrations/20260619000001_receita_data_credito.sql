-- ============================================================
-- Receita manual — DATA DO CRÉDITO (regime de caixa /financeiro).
-- ------------------------------------------------------------
-- A coluna data_credito JÁ EXISTE no banco (aplicada via SQL direto).
-- Esta migration documenta isso no repo como fonte da verdade.
-- Idempotente (ADD COLUMN IF NOT EXISTS + UPDATE só nos NULL) — segura
-- para re-run e para ambiente novo (reset).
--
-- Regime de caixa /financeiro: data real de crédito do lançamento manual
-- (manual NÃO segue M+1; a data mora dentro do mês de competência).
-- Backfill neutro = dia 1 da competência (ano/mes); o usuário ajusta na UI.
-- ============================================================

ALTER TABLE receita_lancamento_manual
  ADD COLUMN IF NOT EXISTS data_credito date;

UPDATE receita_lancamento_manual
SET data_credito = make_date(ano, mes, 1)
WHERE data_credito IS NULL;
