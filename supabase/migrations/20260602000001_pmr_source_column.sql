-- CMS-IMPORT.B1 — origem do PMR (rastreabilidade do modelo condicional).
--
-- promoter_monthly_results passa a registrar de onde veio a consolidacao:
--   'daily' = caminho atual (diario + FIX-6, mes aberto)
--   'cms'   = ground truth do cms (mes fechado, REPRODUZ o repasse do financeiro)
--
-- Default 'daily': todas as linhas atuais foram geradas pelo caminho diario; o
-- branch cms sobrescreve para 'cms' no proximo recalculo do mes fechado.
-- Idempotente (IF NOT EXISTS). Diego roda no Studio.

alter table promoter_monthly_results
  add column if not exists source text not null default 'daily';
