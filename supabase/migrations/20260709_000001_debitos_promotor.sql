-- ============================================================================
-- FRENTE DÉBITOS — plano de débito + regra versionada + rastreabilidade.
--
-- DECISÃO (ESTENDER, não duplicar): promoter_discounts JÁ é o modelo de PARCELA
-- (1 linha = 1 mês/parcela, com amount/installment_number/installments/competência)
-- e JÁ é subtraído no payable do /promotores (promoterAnalytics). Então:
--   promoter_debits            = o PLANO do débito (total, tipo, nº parcelas, regra, status)
--   promoter_discounts         = as PARCELAS (reuso; +debit_id, +status, +applied_at)
--   debit_rule_versions        = a REGRA por competência (vigência é DADO, não hardcode)
--   promoter_debit_sources     = RASTREABILIDADE (débito AUTO 1:N operações canceladas)
--   promoter_debit_assignments = FILA dos estornos MASTER aguardando atribuição do Diego
-- NÃO se cria promoter_debit_installments (seria paralela).
--
-- STATUS EXPLÍCITO (ressalva 1): a parcela carrega status ('PENDING'|'APPLIED'|
-- 'WAIVED'|'CANCELLED') + applied_at — é DADO, não inferência por competência
-- (cobre recálculo de mês, perdão, pagamento externo, cancelamento no meio). Saldo
-- continua DERIVADO = total_amount − Σ(parcelas com status='APPLIED').
--
-- promoter_discounts está VAZIO hoje => sem migração de dados.
-- ============================================================================

-- 1) REGRA VERSIONADA por competência.
create table if not exists public.debit_rule_versions (
  id uuid primary key default gen_random_uuid(),
  debit_type text not null,
  vigencia_inicio date not null,           -- 1o dia da competência de início da vigência
  rule jsonb not null,
  created_at timestamptz not null default now(),
  unique (debit_type, vigencia_inicio)
);

-- 2) PLANO do débito.
create table if not exists public.promoter_debits (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id),
  company_id uuid references public.companies(id),
  kind text not null,                      -- 'AUTO' | 'MANUAL'
  debit_type text not null,                -- CANCELAMENTO_SEGURO | ADIANTAMENTO | PASSAGEM | LIQUIDACAO_ANTECIPADA | CERTIFICACAO ...
  total_amount numeric(18,2) not null default 0,
  installments_total integer not null default 1,
  start_year integer not null,
  start_month integer not null,
  rule_version_id uuid references public.debit_rule_versions(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAID', 'CANCELLED')),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

-- 3) RASTREABILIDADE: operações que compõem um débito AUTO (audita 218,23 = 113,40 + 104,83).
create table if not exists public.promoter_debit_sources (
  id uuid primary key default gen_random_uuid(),
  debit_id uuid not null references public.promoter_debits(id) on delete cascade,
  source_kind text not null,               -- 'CLOSING_INSURANCE' | 'DAILY_CANCEL' | 'MANUAL'
  operation text,                          -- OPERAÇÃO (ex 208916381)
  closing_entry_id uuid references public.monthly_closing_entries(id),
  estorno_amount numeric(18,2) not null default 0,   -- |COMISSÃO|
  chave_j text,
  resolved_via text,                       -- 'closing/PRT' | 'cms' | 'daily'
  created_at timestamptz not null default now()
);

-- 4) FILA de atribuição dos estornos MASTER (não viram débito até o Diego atribuir).
--    O resolvedor faz upsert (PENDING) por operação; Diego atribui -> promoter_id +
--    status='ASSIGNED' e o débito é criado. Sobrevive a re-imports (idempotência
--    respeita o que já foi atribuído). Ex.: 211243326 (22,50) -> Maria Letícia.
create table if not exists public.promoter_debit_assignments (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null,
  source_kind text not null,               -- 'CLOSING_INSURANCE' | 'DAILY_CANCEL'
  operation text not null,
  closing_entry_id uuid references public.monthly_closing_entries(id),
  estorno_amount numeric(18,2) not null default 0,
  chave_j text,
  debit_type text not null default 'CANCELAMENTO_SEGURO',
  promoter_id uuid references public.promoters(id),   -- null = pendente
  status text not null default 'PENDING' check (status in ('PENDING', 'ASSIGNED', 'RESOLVED')),
  assigned_by text,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (year, month, operation)
);

-- 5) PARCELAS = promoter_discounts (reuso). Liga ao plano + STATUS EXPLÍCITO.
alter table public.promoter_discounts
  add column if not exists debit_id uuid references public.promoter_debits(id) on delete cascade,
  add column if not exists status text not null default 'PENDING',
  add column if not exists applied_at timestamptz;

-- CHECK do status da parcela (idempotente — só cria se ainda não existir).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'promoter_discounts_status_check'
  ) then
    alter table public.promoter_discounts
      add constraint promoter_discounts_status_check
      check (status in ('PENDING', 'APPLIED', 'WAIVED', 'CANCELLED'));
  end if;
end $$;

-- índices
create index if not exists idx_promoter_debits_promoter
  on public.promoter_debits(promoter_id, start_year, start_month);
create index if not exists idx_debit_rule_versions_lookup
  on public.debit_rule_versions(debit_type, vigencia_inicio);
create index if not exists idx_debit_sources_debit
  on public.promoter_debit_sources(debit_id);
create index if not exists idx_debit_sources_operation
  on public.promoter_debit_sources(operation);
create index if not exists idx_discounts_debit
  on public.promoter_discounts(debit_id);
create index if not exists idx_debit_assignments_pending
  on public.promoter_debit_assignments(year, month, status);

-- ============================================================================
-- SEED — regra do CANCELAMENTO_SEGURO (vigência versionada).
--   2026-06 CONGELADO: soma dos estornos do promotor, desconto 100%.
--   2026-07+          : por operação; estorno > R$100 desconta 80%, ≤ R$100 desconta 100%.
-- ============================================================================
insert into public.debit_rule_versions (debit_type, vigencia_inicio, rule) values
  ('CANCELAMENTO_SEGURO', '2026-06-01', '{"mode":"SUM_100"}'::jsonb),
  ('CANCELAMENTO_SEGURO', '2026-07-01', '{"mode":"PER_OPERATION","threshold":100,"above_pct":0.80,"below_pct":1.00}'::jsonb)
on conflict (debit_type, vigencia_inicio) do nothing;

-- ============================================================================
-- RLS — espelha promoter_discounts (dia3 grupo D): socio ALL | funcionario ALL |
-- promotor SELECT dos PRÓPRIOS. debit_rule_versions = referência (leitura geral).
-- ============================================================================
alter table public.promoter_debits enable row level security;
alter table public.promoter_debit_sources enable row level security;
alter table public.promoter_debit_assignments enable row level security;
alter table public.debit_rule_versions enable row level security;
grant select, insert, update, delete on public.promoter_debits to authenticated;
grant select, insert, update, delete on public.promoter_debit_sources to authenticated;
grant select, insert, update, delete on public.promoter_debit_assignments to authenticated;
grant select on public.debit_rule_versions to authenticated;

-- promoter_debit_assignments (fila): socio/funcionario gerenciam; promotor NÃO vê
-- (é balde de atribuição, sem dono ainda — igual à aba Migração).
drop policy if exists "promoter_debit_assignments_socio_all" on public.promoter_debit_assignments;
create policy "promoter_debit_assignments_socio_all" on public.promoter_debit_assignments for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_debit_assignments_funcionario_all" on public.promoter_debit_assignments;
create policy "promoter_debit_assignments_funcionario_all" on public.promoter_debit_assignments for all to authenticated
using (public.current_app_user_role() = 'funcionario') with check (public.current_app_user_role() = 'funcionario');

-- promoter_debits
drop policy if exists "promoter_debits_socio_all" on public.promoter_debits;
create policy "promoter_debits_socio_all" on public.promoter_debits for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_debits_funcionario_all" on public.promoter_debits;
create policy "promoter_debits_funcionario_all" on public.promoter_debits for all to authenticated
using (public.current_app_user_role() = 'funcionario') with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_debits_promotor_select" on public.promoter_debits;
create policy "promoter_debits_promotor_select" on public.promoter_debits for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id is not null
  and promoter_id = public.current_app_user_promoter_id()
);

-- promoter_debit_sources (promotor vê as fontes dos próprios débitos)
drop policy if exists "promoter_debit_sources_socio_all" on public.promoter_debit_sources;
create policy "promoter_debit_sources_socio_all" on public.promoter_debit_sources for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_debit_sources_funcionario_all" on public.promoter_debit_sources;
create policy "promoter_debit_sources_funcionario_all" on public.promoter_debit_sources for all to authenticated
using (public.current_app_user_role() = 'funcionario') with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_debit_sources_promotor_select" on public.promoter_debit_sources;
create policy "promoter_debit_sources_promotor_select" on public.promoter_debit_sources for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and debit_id in (
    select id from public.promoter_debits
    where promoter_id = public.current_app_user_promoter_id()
  )
);

-- debit_rule_versions (referência: qualquer autenticado lê; escrita só socio)
drop policy if exists "debit_rule_versions_read" on public.debit_rule_versions;
create policy "debit_rule_versions_read" on public.debit_rule_versions for select to authenticated
using (true);

drop policy if exists "debit_rule_versions_socio_write" on public.debit_rule_versions;
create policy "debit_rule_versions_socio_write" on public.debit_rule_versions for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');
