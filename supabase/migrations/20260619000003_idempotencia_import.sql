-- ============================================================
-- Idempotência por arquivo — Fase 2A (SÓ schema).
-- ------------------------------------------------------------
-- O importador vai SOMAR valores por produto no fechamento; nunca pode somar
-- o mesmo arquivo (código C, ex: C101846) duas vezes. Hoje monthly_closing_imports
-- só tem file_name (string crua, sem UNIQUE). Aqui adicionamos o código C extraído
-- do nome + o produto, com unicidade para impedir reprocessar o mesmo arquivo na
-- mesma empresa/competência.
-- Idempotente. Aplicada manualmente no Supabase Studio (sem migrate automático).
-- ============================================================

ALTER TABLE monthly_closing_imports
  ADD COLUMN IF NOT EXISTS codigo_arquivo text,
  ADD COLUMN IF NOT EXISTS produto text;

-- Índice único parcial: um mesmo código de arquivo só pode ser processado uma vez
-- por empresa/competência. NULL em codigo_arquivo não trava (imports legados).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_import_codigo_arquivo
  ON monthly_closing_imports (company_id, year, month, codigo_arquivo)
  WHERE codigo_arquivo IS NOT NULL AND status = 'COMPLETED';
