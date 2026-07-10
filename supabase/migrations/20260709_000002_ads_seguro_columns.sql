-- ============================================================================
-- FRENTE IMPORTAÇÃO ADS — colunas do seguro na produção (merge por dono de coluna).
--
-- DECISÃO (coluna real, não raw_payload):
--   prod_segurada  -> DIMENSÃO ANALÍTICA. A penetração individual do RR filtra
--     "PROD. SEGURADA = Sim" (lib/insurancePenetration / closingPromoterBase). Para
--     a ADS unificar com o RR (mesma forma da aba "A Vista"), esse flag precisa ser
--     FILTRÁVEL em SQL e uniforme com as colunas de seguro que já são de 1ª classe
--     (has_insurance, insurance_slip_eligible). Em raw_payload ele ficaria opaco e
--     forçaria lógica paralela. É um booleano por linha (o Prestamista lista TODAS
--     as propostas, seguradas ou não).
--   insurance_number -> Nº Seguro (Prestamista/fechamento). Trace barato; como a
--     migration já é necessária pro prod_segurada, uma coluna text nullable torna a
--     conferência/auditoria por seguro trivial (join direto), sem custo. "Versão EDS"
--     fica em raw_payload.__ads_meta (trace puro, sem consulta).
--
-- ADITIVA e nullable/default — NÃO altera nenhum cálculo existente (bbtsMonthly usa
--   insurance_value>0 p/ penetração, não prod_segurada), então junho não muda.
-- ============================================================================

alter table public.daily_production_records
  add column if not exists insurance_number text,
  add column if not exists prod_segurada boolean not null default false;

comment on column public.daily_production_records.insurance_number is
  'ADS: Nº Seguro (Prestamista/fechamento PDF). Rastreabilidade do seguro.';
comment on column public.daily_production_records.prod_segurada is
  'ADS/RR: proposta segurada (coluna Seguro do Prestamista não-vazia). Base da penetração individual.';
