-- ============================================================
-- ETAPA 6 — Coluna valor_nota_fiscal em fechamento_mensal_empresa.
-- ------------------------------------------------------------
-- Total EXATO da aba Resumo ("Valor Nota Fiscal" = soma de TODAS as linhas
-- de comissao, inclusive Conta Corrente/BrasilCap/Dental/Consorcio/LOB Vem/
-- Portabilidade INSS, que os 5 componentes derivados nao capturavam).
-- Preenchido a partir de jun/2026 pelo importador corrigido (readResumoTotals).
-- NULL nos fechamentos antigos -> RBT12 cai no valor_liquido (+ bridge manual).
-- ============================================================

alter table public.fechamento_mensal_empresa
  add column if not exists valor_nota_fiscal numeric(18,2);
