-- Fase 4.2 — snapshot da aba Validador (formato Cxxxx_*) ou Resumo (formato
-- antigo) dos arquivos mensais Promotiva. 1 linha por mês (year, month).
--
-- Ground truth da Camada 1: lib/enquadramento.ts cruza:
--   - meta_pf, pct_penetracao, cat_aplicada (deste snapshot)
--   - sum(vol_liquido) ex-SRCC (de audit_v9_avista — Fase 4.1)
--   - regime do mês (regrasLoader)
-- para decidir Cat_Devida e gerar StatusFase1 (lib/types/blocos.ts).
--
-- raw_data jsonb preserva o dump bruto da aba para auditoria documental
-- futura (G22): permite reconstruir qualquer interpretação posterior sem
-- precisar re-abrir o XLSX original.
--
-- Convenções:
--   pct_meta, pct_penetracao em decimal (1.0 = 100%).
--   meta_pf, volume_liquido_atingido, volume_prestamista em R$.
--   cat_aplicada é o conteúdo bruto da coluna TABELA / Resultado
--     (ex.: "TABELA 1", "TABELA 2", "INTERMEDIÁRIA 1", "RUBI", "FAIXA 3",
--           "UPPER MIDDLE"). Camada 1 normaliza ao comparar com Cat_Devida.

create table if not exists monthly_validator_snapshot (
  year smallint not null,
  month smallint not null,
  meta_pf numeric(14,2),
  volume_liquido_atingido numeric(14,2),
  pct_meta numeric(8,4),
  volume_prestamista numeric(14,2),
  pct_penetracao numeric(8,4),
  cat_aplicada text,
  source_file text,
  formato text,                                  -- "validador" | "resumo" | NULL (sem dados)
  imported_at timestamptz not null default now(),
  raw_data jsonb,
  primary key (year, month),
  constraint monthly_validator_snapshot_month_range check (month between 1 and 12),
  constraint monthly_validator_snapshot_year_range check (year between 2022 and 2030)
);

comment on table monthly_validator_snapshot is
  'Fase 4.2 — snapshot mensal da aba Validador (Aug/2024+) ou Resumo (pre-Aug/2024) dos arquivos Promotiva. 1 linha por mês.';
comment on column monthly_validator_snapshot.pct_meta is
  'Decimal: 1.0 = 100% atingido. Vem da célula direta do Validador/Resumo — pode estar corrompida em alguns meses (compare com vol_liquido/meta_pf antes de usar para decisão).';
comment on column monthly_validator_snapshot.pct_penetracao is
  'Decimal: 1.0 = 100% Prestamista. Null em meses Dez/2022–Jul/2023 (campo não existia na Resumo).';
comment on column monthly_validator_snapshot.formato is
  'Layout do arquivo de origem: validador (formato novo Aug/2024+), resumo (formato antigo pré-Aug/2024).';
comment on column monthly_validator_snapshot.raw_data is
  'Dump bruto da aba Validador/Resumo do XLSX (chaves normalizadas em lowercase, sem acento). Preservado para defesa documental.';
