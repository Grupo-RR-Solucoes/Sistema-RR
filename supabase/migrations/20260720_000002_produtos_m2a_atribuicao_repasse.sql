-- FRENTE DE PRODUTO — Movimento 2a: atribuicao + repasse de EVENTO UNICO
-- (BBCAP / Capitalizacao + Abertura de Conta). Consorcio e LOB (diferidos) ficam
-- para o M2b.
--
-- Depende do M1 (20260720_000001), que ja desdobra as abas em linhas na master
-- (monthly_closing_entries) com a comissao-EMPRESA pronta e SEM promotor.

-- 1) LEDGER — colunas por produto no PMR (padrao achatado existente, uma coluna
--    numerica por componente somada no final_commission_value). O M3 quebra por
--    produto lendo a coluna direto do PMR.
alter table public.promoter_monthly_results
  add column if not exists bbcap_commission_value numeric(18,2) not null default 0,
  add column if not exists conta_corrente_commission_value numeric(18,2) not null default 0;

-- 2) FILA COM MEMORIA — atribuicao do promotor por linha de produto. Molde da fila
--    de debitos (promoter_debit_assignments): PENDING -> ASSIGNED, upsert respeita
--    decisao humana. DESACOPLADA de monthly_closing_entries: o reprocesso do M1
--    reconstroi as entries, mas a atribuicao persiste (a chave inclui a competencia
--    e casa com a chave natural do M1). Serve todos os produtos (BBCAP/CC agora;
--    consorcio/LOB no M2b, com heranca por proposta).
create table if not exists public.product_line_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  year integer not null,
  month integer not null,
  entry_type text not null,               -- 'BBCAP' | 'CONTA_CORRENTE' | (M2b: 'CONSORCIO'/'LOB')
  operation_number text not null,         -- proposta (BBCAP) | numero da conta (CC)
  contract_number text not null default '', -- '' nos eventos unicos; parcela/tipo no M2b
  promoter_id uuid references public.promoters(id),   -- null = PENDING (balde)
  status text not null default 'PENDING' check (status in ('PENDING', 'ASSIGNED')),
  source text not null default 'MANUAL',  -- 'MANUAL' | 'INHERITED'
  assigned_by text,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- mesma chave natural do M1 (indice unico parcial de 20260720_000001).
  unique (company_id, year, month, entry_type, operation_number, contract_number)
);

create index if not exists idx_product_line_assignments_comp
  on public.product_line_assignments(year, month, entry_type, status);
create index if not exists idx_product_line_assignments_promoter
  on public.product_line_assignments(promoter_id);

-- RLS — socio/funcionario gerenciam a fila; promotor NAO ve (balde sem dono),
-- igual a promoter_debit_assignments.
alter table public.product_line_assignments enable row level security;
grant select, insert, update, delete on public.product_line_assignments to authenticated;

drop policy if exists "product_line_assignments_socio_all" on public.product_line_assignments;
create policy "product_line_assignments_socio_all" on public.product_line_assignments for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "product_line_assignments_funcionario_all" on public.product_line_assignments;
create policy "product_line_assignments_funcionario_all" on public.product_line_assignments for all to authenticated
using (public.current_app_user_role() = 'funcionario') with check (public.current_app_user_role() = 'funcionario');
