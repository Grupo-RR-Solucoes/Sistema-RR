-- Migration: Dia 3 — Grupo C (Operacao): 6 tabelas
--
-- Tabelas (todas sem RLS hoje):
--   daily_imports, daily_production_records, proposal_reassignments,
--   monthly_closing_imports, monthly_closing_entries, monthly_expected_closings
--
-- Chaves de scope (verificado contra rr_foundation.sql):
--   daily_imports                -> SEM promoter_id, SEM company_id
--   daily_production_records     -> 3 colunas promoter_id: promoter_id,
--                                   original_promoter_id, assigned_promoter_id
--                                   (D6: usar assigned com fallback para promoter_id)
--   proposal_reassignments       -> from_promoter_id, to_promoter_id (D8: ambos)
--                                   + daily_production_record_id (SEM FK declarada)
--   monthly_closing_imports      -> company_id (nullable)
--   monthly_closing_entries      -> company_id, company_cnpj, j_key (texto sem FK)
--                                   -> D5: promotor BLOQUEADO (filtro via j_key
--                                   eh fragil; numeros consolidados sao da empresa)
--   monthly_expected_closings    -> company_id (NOT NULL); SEM promoter_id
--
-- Matriz de permissoes:
--   daily_imports                socio ALL | func ALL              | promotor BLOQUEADO
--   daily_production_records     socio ALL | func ALL              | promotor SELECT (D6)
--   proposal_reassignments       socio ALL | func ALL              | promotor SELECT (D8)
--   monthly_closing_imports      socio ALL | func ALL              | promotor BLOQUEADO
--   monthly_closing_entries      socio ALL | func ALL              | promotor BLOQUEADO (D5)
--   monthly_expected_closings    socio ALL | func ALL              | promotor BLOQUEADO
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- ============================================================
-- daily_imports
-- ============================================================
-- Metadata de upload diario (file_name, status, rows_count, etc.).
-- Funcionario importa => RW completo. Promotor nao tem interesse.
alter table public.daily_imports enable row level security;
grant select on public.daily_imports to authenticated;
grant insert on public.daily_imports to authenticated;
grant update on public.daily_imports to authenticated;
grant delete on public.daily_imports to authenticated;

drop policy if exists "daily_imports_socio_all" on public.daily_imports;
create policy "daily_imports_socio_all"
on public.daily_imports for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "daily_imports_funcionario_all" on public.daily_imports;
create policy "daily_imports_funcionario_all"
on public.daily_imports for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- promotor BLOQUEADO

-- ============================================================
-- daily_production_records  (D6)
-- ============================================================
alter table public.daily_production_records enable row level security;
grant select on public.daily_production_records to authenticated;
grant insert on public.daily_production_records to authenticated;
grant update on public.daily_production_records to authenticated;
grant delete on public.daily_production_records to authenticated;

drop policy if exists "daily_production_records_socio_all" on public.daily_production_records;
create policy "daily_production_records_socio_all"
on public.daily_production_records for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW (corrige reassignments, ajusta campos de contrato)
drop policy if exists "daily_production_records_funcionario_all" on public.daily_production_records;
create policy "daily_production_records_funcionario_all"
on public.daily_production_records for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- D6: assigned_promoter_id eh a fonte de verdade pos-reassignment.
-- Quando assigned_promoter_id IS NULL (records antigos pre-reassignment),
-- fallback para promoter_id (coluna original do contrato).
-- original_promoter_id NAO entra no filtro: se contrato foi tirado do
-- promotor, ele nao deve mais ler.
drop policy if exists "daily_production_records_promotor_select" on public.daily_production_records;
create policy "daily_production_records_promotor_select"
on public.daily_production_records for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and (
    assigned_promoter_id = public.current_app_user_promoter_id()
    or (
      assigned_promoter_id is null
      and promoter_id = public.current_app_user_promoter_id()
    )
  )
);

-- ============================================================
-- proposal_reassignments  (D8)
-- ============================================================
-- Schema confirmado: from_promoter_id + to_promoter_id (FK references promoters).
-- daily_production_record_id existe mas SEM FK declarada (uuid livre).
alter table public.proposal_reassignments enable row level security;
grant select on public.proposal_reassignments to authenticated;
grant insert on public.proposal_reassignments to authenticated;
grant update on public.proposal_reassignments to authenticated;
grant delete on public.proposal_reassignments to authenticated;

drop policy if exists "proposal_reassignments_socio_all" on public.proposal_reassignments;
create policy "proposal_reassignments_socio_all"
on public.proposal_reassignments for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "proposal_reassignments_funcionario_all" on public.proposal_reassignments;
create policy "proposal_reassignments_funcionario_all"
on public.proposal_reassignments for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- D8: promotor ve onde aparece como from (contrato saiu dele, transparencia
-- de motivo) ou to (contrato entrou para ele, conhecimento operacional).
drop policy if exists "proposal_reassignments_promotor_select" on public.proposal_reassignments;
create policy "proposal_reassignments_promotor_select"
on public.proposal_reassignments for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and (
    from_promoter_id = public.current_app_user_promoter_id()
    or to_promoter_id = public.current_app_user_promoter_id()
  )
);

-- ============================================================
-- monthly_closing_imports
-- ============================================================
alter table public.monthly_closing_imports enable row level security;
grant select on public.monthly_closing_imports to authenticated;
grant insert on public.monthly_closing_imports to authenticated;
grant update on public.monthly_closing_imports to authenticated;
grant delete on public.monthly_closing_imports to authenticated;

drop policy if exists "monthly_closing_imports_socio_all" on public.monthly_closing_imports;
create policy "monthly_closing_imports_socio_all"
on public.monthly_closing_imports for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "monthly_closing_imports_funcionario_all" on public.monthly_closing_imports;
create policy "monthly_closing_imports_funcionario_all"
on public.monthly_closing_imports for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- promotor BLOQUEADO (metadata de fechamento mensal = operacao empresa)

-- ============================================================
-- monthly_closing_entries  (D5: promotor BLOQUEADO)
-- ============================================================
-- j_key eh texto sem FK declarada para j_keys.j_key. Mesmo se filtrarmos
-- via JOIN com j_keys.promoter_id, o caminho eh fragil (j_key duplicado,
-- ausente, etc.). Decisao D5: promotor BLOQUEADO; ele ve sua comissao via
-- promoter_monthly_results e promoter_proposal_commissions (Grupo D).
alter table public.monthly_closing_entries enable row level security;
grant select on public.monthly_closing_entries to authenticated;
grant insert on public.monthly_closing_entries to authenticated;
grant update on public.monthly_closing_entries to authenticated;
grant delete on public.monthly_closing_entries to authenticated;

drop policy if exists "monthly_closing_entries_socio_all" on public.monthly_closing_entries;
create policy "monthly_closing_entries_socio_all"
on public.monthly_closing_entries for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "monthly_closing_entries_funcionario_all" on public.monthly_closing_entries;
create policy "monthly_closing_entries_funcionario_all"
on public.monthly_closing_entries for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- ============================================================
-- monthly_expected_closings
-- ============================================================
-- Forecast da empresa por (company_id, year, month) — sem dimensao promotor.
-- Funcionario RW para ajustes operacionais. Promotor BLOQUEADO.
alter table public.monthly_expected_closings enable row level security;
grant select on public.monthly_expected_closings to authenticated;
grant insert on public.monthly_expected_closings to authenticated;
grant update on public.monthly_expected_closings to authenticated;
grant delete on public.monthly_expected_closings to authenticated;

drop policy if exists "monthly_expected_closings_socio_all" on public.monthly_expected_closings;
create policy "monthly_expected_closings_socio_all"
on public.monthly_expected_closings for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "monthly_expected_closings_funcionario_all" on public.monthly_expected_closings;
create policy "monthly_expected_closings_funcionario_all"
on public.monthly_expected_closings for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');
