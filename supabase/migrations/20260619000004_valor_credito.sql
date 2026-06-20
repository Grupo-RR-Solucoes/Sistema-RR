-- ============================================================
-- Campo valor_credito — incremental (SÓ schema).
-- ------------------------------------------------------------
-- Crédito como campo próprio (produtos avulsos/mistos). avista permanece intocado.
-- avista mantém o Crédito que já veio nos arquivos "Todos"; este campo captura
-- só o Crédito de arquivos AVULSOS/MISTOS. Exibição soma avista + credito.
-- Idempotente, nullable, default 0. Aplicada manualmente no Supabase Studio.
-- ============================================================

ALTER TABLE fechamento_mensal_empresa
  ADD COLUMN IF NOT EXISTS valor_credito numeric DEFAULT 0;
