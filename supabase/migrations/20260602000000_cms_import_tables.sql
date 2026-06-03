-- CMS-IMPORT.A1 — tabelas do import do cms (PRODUÇÃO_GERAL_RR) como GROUND TRUTH
-- da comissão do promotor. Ref: SPEC_IMPORT_CMS.md secoes 3.
--
-- O sistema deixa de RECALCULAR a comissao do promotor e passa a IMPORTAR e
-- REPRODUZIR o cms, onde o financeiro RR ja calculou o repasse (cols COMISSAO
-- PROMOTOR / COMISSAO SEGURO das ABAS POR PROMOTOR). Estas tabelas guardam esse
-- ground truth, separadas do diario (daily_production_records) porque o cms ja
-- vem por promotor atribuido, com repasse pronto e competencia = mes de producao.
--
-- Idempotente (IF NOT EXISTS). NAO destrutivo. Diego roda no Studio.

create table if not exists cms_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  prod_year integer not null,
  prod_month integer not null,
  file_name text not null,
  status text not null default 'PENDING',
  -- colunas de erro p/ paridade com monthly_closing_imports: registram a causa
  -- quando o handler explode (status='FAILED') em vez de travar em 'PROCESSING'.
  error_message text,
  error_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cms_imports_competencia_idx
  on cms_imports(prod_year, prod_month, company_id);

create table if not exists cms_promoter_entries (
  id uuid primary key default gen_random_uuid(),
  cms_import_id uuid not null references cms_imports(id) on delete cascade,
  company_id uuid references companies(id),
  company_cnpj text,
  -- competencia = mes de PRODUCAO (extraido do nome do arquivo)
  prod_year integer not null,
  prod_month integer not null,
  j_key text,
  promoter_id uuid references promoters(id),     -- resolvido por j_key (fallback nome da aba)
  promoter_name_sheet text,                      -- nome da aba (PROMOTOR/A) no cms
  contract_number text,
  product_description text,
  net_value numeric(18,2) not null default 0,
  gross_value numeric(18,2) not null default 0,
  avista_percent numeric(12,6),                  -- ref.
  -- COMISSAO PF (empresa) — p/ reconciliacao cms x monthly_closing_entries.
  -- numeric(18,6): preserva a precisao do cms; o consumo soma e arredonda no fim.
  company_commission numeric(18,6) not null default 0,
  promoter_credit numeric(18,6) not null default 0,    -- COMISSAO PROMOTOR — GROUND TRUTH credito
  promoter_insurance numeric(18,6) not null default 0, -- COMISSAO SEGURO (ultima col) — GROUND TRUTH seguro
  insurance_premium numeric(18,2) not null default 0,  -- VALOR SEGURO (premio, ref.)
  penetration numeric(12,6),                     -- % PENETRACAO (ref.)
  meta_atingida boolean not null default false,  -- banner "META ATINGIDA" da aba (informativo, exibicao; nao afeta valor)
  is_master boolean not null default false,      -- CHAVE J e key_type=MASTER em j_keys (marca as 4 chaves master)
  source_sheet text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cms_promoter_entries_competencia_idx
  on cms_promoter_entries(prod_year, prod_month, company_id);
create index if not exists cms_promoter_entries_promoter_idx
  on cms_promoter_entries(promoter_id, prod_year, prod_month);
