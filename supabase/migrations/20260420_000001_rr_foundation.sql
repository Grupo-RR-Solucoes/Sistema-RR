create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  cnpj text not null unique,
  group_name text,
  group_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists company_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  mci text,
  coban_code text,
  identifier_type text not null default 'PRIMARY',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, mci, coban_code)
);

create index if not exists company_identifiers_mci_idx on company_identifiers(mci);
create index if not exists company_identifiers_coban_idx on company_identifiers(coban_code);

create table if not exists promoters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  name text not null,
  document_number text,
  status text not null default 'ACTIVE',
  active boolean not null default true,
  hired_at date,
  dismissed_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists j_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  promoter_id uuid references promoters(id),
  j_key text not null unique,
  key_type text not null default 'INDIVIDUAL',
  active boolean not null default true,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists proposal_reassignments (
  id uuid primary key default gen_random_uuid(),
  daily_production_record_id uuid,
  from_promoter_id uuid references promoters(id),
  to_promoter_id uuid references promoters(id),
  reason text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create table if not exists daily_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  import_date date,
  status text not null default 'PENDING',
  rows_count integer,
  processing_notes text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists daily_production_records (
  id uuid primary key default gen_random_uuid(),
  daily_import_id uuid references daily_imports(id),
  company_id uuid not null references companies(id),
  j_key text,
  promoter_id uuid references promoters(id),
  original_promoter_id uuid references promoters(id),
  assigned_promoter_id uuid references promoters(id),
  promoter_source text,
  proposal_number text not null,
  contract_number text,
  customer_name text,
  product_code text,
  product_description text,
  convenio_code text,
  convenio_type text,
  convenio_segment text,
  gross_value numeric(18,2) not null default 0,
  net_value numeric(18,2) not null default 0,
  insurance_value numeric(18,2) not null default 0,
  insurance_net_value numeric(18,2) not null default 0,
  has_insurance boolean not null default false,
  insurance_type text,
  insurance_slip_eligible boolean,
  interest_rate numeric(10,4),
  term_months integer,
  installments integer,
  company_received_percent numeric(10,4),
  status text,
  proposal_date date,
  movement_date date,
  contract_date date,
  cancellation_date date,
  is_srcc_restricted boolean not null default false,
  promoter_commission_percent numeric(10,4),
  promoter_commission_amount numeric(18,2),
  insurance_commission_percent numeric(10,4),
  insurance_commission_amount numeric(18,2),
  commission_rule_source text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, proposal_number)
);

create index if not exists daily_production_records_company_movement_idx
  on daily_production_records(company_id, movement_date);
create index if not exists daily_production_records_assigned_promoter_idx
  on daily_production_records(assigned_promoter_id);

create table if not exists commission_tables (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  year integer not null,
  month integer not null,
  source_name text,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, year, month, version)
);

create table if not exists commission_table_rows (
  id uuid primary key default gen_random_uuid(),
  commission_table_id uuid not null references commission_tables(id) on delete cascade,
  rule_type text not null,
  metric_type text not null default 'VALUE',
  range_from numeric(18,4) not null default 0,
  range_to numeric(18,4),
  commission_value numeric(18,4) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists monthly_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  promoter_id uuid not null references promoters(id) on delete cascade,
  year integer not null,
  month integer not null,
  meta numeric(18,2) not null default 0,
  meta_1 numeric(18,2) not null default 0,
  meta_2 numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (promoter_id, year, month)
);

create table if not exists promoter_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  promoter_id uuid not null references promoters(id) on delete cascade,
  year integer not null,
  month integer not null,
  agreement_type text not null,
  commission_type text not null default 'PERCENT',
  commission_value numeric(18,4) not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists promoter_product_commissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  promoter_id uuid not null references promoters(id) on delete cascade,
  year integer not null,
  month integer not null,
  product_code text,
  product_description text,
  company_received_percent_from numeric(10,4),
  company_received_percent_to numeric(10,4),
  commission_percent numeric(10,4),
  insurance_commission_percent numeric(10,4),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists promoter_product_rate_rules (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null,
  product_description text,
  received_percent numeric(10,4),
  promoter_percent numeric(10,4),
  insurance_percent numeric(10,4),
  created_at timestamptz not null default now()
);

create table if not exists promoter_proposal_commissions (
  id uuid primary key default gen_random_uuid(),
  daily_production_record_id uuid not null references daily_production_records(id) on delete cascade,
  promoter_id uuid not null references promoters(id),
  commission_percent numeric(10,4),
  insurance_commission_percent numeric(10,4),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_production_record_id)
);

create table if not exists monthly_expected_closings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  year integer not null,
  month integer not null,
  gross_production numeric(18,2) not null default 0,
  net_valid_production numeric(18,2) not null default 0,
  cancelled_value numeric(18,2) not null default 0,
  pending_value numeric(18,2) not null default 0,
  renewed_value numeric(18,2) not null default 0,
  production_band text,
  expected_cash_commission numeric(18,2) not null default 0,
  expected_insurance_commission numeric(18,2) not null default 0,
  expected_prt_commission numeric(18,2) not null default 0,
  expected_total numeric(18,2) not null default 0,
  calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, year, month)
);

create table if not exists promoter_monthly_results (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references promoters(id) on delete cascade,
  company_id uuid references companies(id),
  year integer not null,
  month integer not null,
  production_value numeric(18,2) not null default 0,
  proposal_count integer not null default 0,
  insured_proposal_count integer not null default 0,
  insured_production_value numeric(18,2) not null default 0,
  insurance_penetration_percent numeric(10,4) not null default 0,
  target_value numeric(18,2) not null default 0,
  target_1_value numeric(18,2) not null default 0,
  target_2_value numeric(18,2) not null default 0,
  projected_production_value numeric(18,2) not null default 0,
  production_commission_value numeric(18,2) not null default 0,
  insurance_commission_value numeric(18,2) not null default 0,
  agreement_adjustment_value numeric(18,2) not null default 0,
  final_commission_value numeric(18,2) not null default 0,
  discount_value numeric(18,2) not null default 0,
  target_status text,
  calculated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (promoter_id, year, month)
);

create table if not exists promoter_discounts (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid references promoters(id),
  company_id uuid references companies(id),
  daily_production_record_id uuid references daily_production_records(id),
  year integer not null,
  month integer not null,
  discount_type text not null,
  amount numeric(18,2) not null default 0,
  installments integer not null default 1,
  installment_number integer not null default 1,
  apply_to_company boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists recebimento_mensal (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  empresa_cnpj text not null,
  numero_operacao text,
  data_referencia date not null,
  tipo_recebimento text,
  valor_recebido numeric(18,2) not null default 0,
  valor_diferido numeric(18,2) not null default 0,
  valor_seguro numeric(18,2) not null default 0,
  valor_estorno numeric(18,2) not null default 0,
  valor_renovacao numeric(18,2) not null default 0,
  status text,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists diferido_parcelas (
  id uuid primary key default gen_random_uuid(),
  operacao_id uuid not null references recebimento_mensal(id) on delete cascade,
  parcela_numero integer not null,
  valor numeric(18,2) not null default 0,
  data_prevista timestamptz,
  status text not null default 'PENDENTE',
  created_at timestamptz not null default now()
);

create table if not exists fechamento_mensal_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_cnpj text not null,
  ano integer not null,
  mes integer not null,
  valor_avista numeric(18,2) not null default 0,
  valor_diferido numeric(18,2) not null default 0,
  valor_seguro numeric(18,2) not null default 0,
  valor_estorno numeric(18,2) not null default 0,
  valor_renovacao numeric(18,2) not null default 0,
  valor_liquido numeric(18,2) not null default 0,
  operacoes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_cnpj, ano, mes)
);

create table if not exists monthly_closing_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  year integer not null,
  month integer not null,
  file_name text not null,
  source_type text not null default 'MONTHLY_CLOSING',
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists monthly_closing_entries (
  id uuid primary key default gen_random_uuid(),
  monthly_closing_import_id uuid not null references monthly_closing_imports(id) on delete cascade,
  company_id uuid references companies(id),
  company_cnpj text,
  year integer not null,
  month integer not null,
  sheet_name text not null,
  operation_number text,
  contract_number text,
  j_key text,
  product_name text,
  entry_type text,
  status text,
  gross_value numeric(18,2) not null default 0,
  net_value numeric(18,2) not null default 0,
  insurance_value numeric(18,2) not null default 0,
  commission_value numeric(18,2) not null default 0,
  operation_date date,
  cancellation_date date,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists financial_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  year integer not null,
  month integer not null,
  category_id uuid references expense_categories(id),
  scope text not null default 'COMPANY',
  description text not null,
  amount numeric(18,2) not null default 0,
  due_date date,
  payment_date date,
  status text not null default 'PLANNED',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cash_opening_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  year integer not null,
  month integer not null,
  opening_balance numeric(18,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, year, month)
);

create table if not exists access_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  access_profile_id uuid references access_profiles(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  entity_name text not null,
  entity_id text,
  action text not null,
  description text,
  payload jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

insert into expense_categories (name, is_default)
values
  ('Folha', true),
  ('Aluguel', true),
  ('Marketing', true),
  ('Operacional', true),
  ('Impostos', true),
  ('Comercial', true),
  ('Financeiro', true),
  ('Tecnologia', true),
  ('Outros', true)
on conflict (name) do nothing;

insert into access_profiles (name, description)
values
  ('Visao Geral', 'Acesso completo para diretoria'),
  ('Visao Parcial', 'Lancamento de despesas, importacao diaria e descontos de promotores')
on conflict (name) do nothing;
