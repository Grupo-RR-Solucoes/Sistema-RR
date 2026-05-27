-- FIX-1.E.6.PRE.D.A — colunas de erro em monthly_closing_imports
-- Permite registrar a causa de falhas do importador (status='FAILED' ou
-- 'CANCELLED') em vez de deixar status='PROCESSING' permanente quando o
-- handler explode. Idempotente (IF NOT EXISTS).

alter table monthly_closing_imports
  add column if not exists error_message text;

alter table monthly_closing_imports
  add column if not exists error_at timestamptz;
