-- Fase 4.1 — tabela de quarentena para duplicatas detectadas durante seed.
--
-- Origem: dry-run do scripts/seed_v9.cjs detectou 5 contratos repetidos na
-- aba "Auditoria À Vista" do RELATORIO_AUDITORIA_FINAL_v9.xlsx, todos em
-- Jul/2024 com status SEM_LOOKUP:
--   161198814, 161213111, 161500311, 162019551, 161768225
--
-- Decisão (Condição 1, Diego, Fase 4.1 Etapa 6 pré-execute):
--   - PK contract_number da tabela audit_v9_avista mantém apenas a primeira
--     ocorrência (5 contratos).
--   - As 10 linhas (5 dups × 2 ocorrências) ficam aqui para rastreabilidade.
--   - Se algum desses contratos virar discussão com Promotiva, podemos
--     provar que detectamos e tratamos.
--
-- raw_data jsonb preserva o objeto completo da linha original do XLSX para
-- comparação futura. reason permite agrupar lotes de quarentena por causa
-- (este lote: 'SEM_LOOKUP_DUPLICATE_JUL_2024').

create table if not exists audit_v9_duplicates_quarantine (
  id bigserial primary key,
  contract_number text not null,
  occurrence int not null,                       -- 1 = primeira encontrada, 2+ = duplicatas
  raw_data jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_v9_duplicates_quarantine_contract_idx
  on audit_v9_duplicates_quarantine (contract_number);
create index if not exists audit_v9_duplicates_quarantine_reason_idx
  on audit_v9_duplicates_quarantine (reason);
