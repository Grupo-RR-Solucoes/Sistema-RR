-- Migration: Dia 3 — Grupo D (Comissoes): 5 tabelas
--
-- Tabelas (todas sem RLS hoje):
--   promoter_agreements, promoter_product_commissions,
--   promoter_proposal_commissions, promoter_monthly_results,
--   promoter_discounts
--
-- Chaves de scope (verificado contra rr_foundation.sql):
--   promoter_agreements             -> promoter_id NOT NULL (FK promoters)
--   promoter_product_commissions    -> promoter_id NOT NULL (FK promoters)
--   promoter_proposal_commissions   -> promoter_id NOT NULL (FK promoters)
--   promoter_monthly_results        -> promoter_id NOT NULL (FK promoters)
--   promoter_discounts              -> promoter_id NULLABLE (FK promoters)
--                                      Quando apply_to_company=true => promoter_id IS NULL
--                                      D7: promotor NAO ve esses (sao da empresa)
--
-- Matriz de permissoes:
--   promoter_agreements              socio ALL | func ALL | promotor SELECT (promoter_id = me)
--   promoter_product_commissions     socio ALL | func ALL | promotor SELECT (promoter_id = me)
--   promoter_proposal_commissions    socio ALL | func ALL | promotor SELECT (promoter_id = me)
--   promoter_monthly_results         socio ALL | func ALL | promotor SELECT (promoter_id = me)
--   promoter_discounts               socio ALL | func ALL | promotor SELECT (D7: promoter_id IS NOT NULL AND = me)
--
-- Funcionario tem ALL (escopo declarado: "ve comissoes $$$" + edita acordos
-- + lanca descontos operacionais). Promotor enxerga apenas seus proprios
-- numeros.
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- ============================================================
-- promoter_agreements
-- ============================================================
alter table public.promoter_agreements enable row level security;
grant select on public.promoter_agreements to authenticated;
grant insert on public.promoter_agreements to authenticated;
grant update on public.promoter_agreements to authenticated;
grant delete on public.promoter_agreements to authenticated;

drop policy if exists "promoter_agreements_socio_all" on public.promoter_agreements;
create policy "promoter_agreements_socio_all"
on public.promoter_agreements for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW (escopo: "edita acordos com promotores")
drop policy if exists "promoter_agreements_funcionario_all" on public.promoter_agreements;
create policy "promoter_agreements_funcionario_all"
on public.promoter_agreements for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_agreements_promotor_select" on public.promoter_agreements;
create policy "promoter_agreements_promotor_select"
on public.promoter_agreements for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- promoter_product_commissions
-- ============================================================
alter table public.promoter_product_commissions enable row level security;
grant select on public.promoter_product_commissions to authenticated;
grant insert on public.promoter_product_commissions to authenticated;
grant update on public.promoter_product_commissions to authenticated;
grant delete on public.promoter_product_commissions to authenticated;

drop policy if exists "promoter_product_commissions_socio_all" on public.promoter_product_commissions;
create policy "promoter_product_commissions_socio_all"
on public.promoter_product_commissions for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW (ve valores $$$, pode lancar)
drop policy if exists "promoter_product_commissions_funcionario_all" on public.promoter_product_commissions;
create policy "promoter_product_commissions_funcionario_all"
on public.promoter_product_commissions for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_product_commissions_promotor_select" on public.promoter_product_commissions;
create policy "promoter_product_commissions_promotor_select"
on public.promoter_product_commissions for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- promoter_proposal_commissions
-- ============================================================
-- Tem promoter_id NOT NULL + daily_production_record_id NOT NULL (FK).
-- Filtro promotor = promoter_id direto (nao precisa JOIN com production_records).
alter table public.promoter_proposal_commissions enable row level security;
grant select on public.promoter_proposal_commissions to authenticated;
grant insert on public.promoter_proposal_commissions to authenticated;
grant update on public.promoter_proposal_commissions to authenticated;
grant delete on public.promoter_proposal_commissions to authenticated;

drop policy if exists "promoter_proposal_commissions_socio_all" on public.promoter_proposal_commissions;
create policy "promoter_proposal_commissions_socio_all"
on public.promoter_proposal_commissions for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_proposal_commissions_funcionario_all" on public.promoter_proposal_commissions;
create policy "promoter_proposal_commissions_funcionario_all"
on public.promoter_proposal_commissions for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_proposal_commissions_promotor_select" on public.promoter_proposal_commissions;
create policy "promoter_proposal_commissions_promotor_select"
on public.promoter_proposal_commissions for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- promoter_monthly_results
-- ============================================================
alter table public.promoter_monthly_results enable row level security;
grant select on public.promoter_monthly_results to authenticated;
grant insert on public.promoter_monthly_results to authenticated;
grant update on public.promoter_monthly_results to authenticated;
grant delete on public.promoter_monthly_results to authenticated;

drop policy if exists "promoter_monthly_results_socio_all" on public.promoter_monthly_results;
create policy "promoter_monthly_results_socio_all"
on public.promoter_monthly_results for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_monthly_results_funcionario_all" on public.promoter_monthly_results;
create policy "promoter_monthly_results_funcionario_all"
on public.promoter_monthly_results for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_monthly_results_promotor_select" on public.promoter_monthly_results;
create policy "promoter_monthly_results_promotor_select"
on public.promoter_monthly_results for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- promoter_discounts  (D7)
-- ============================================================
-- Schema: promoter_id NULLABLE (references promoters). Quando
-- apply_to_company=true, promoter_id IS NULL e o desconto eh da empresa
-- (rateado entre socios), nao de um promotor especifico.
--
-- D7: promotor NAO ve descontos com promoter_id IS NULL. Filtro explicito
-- `promoter_id is not null and promoter_id = me` impede vazamento via
-- NULL-comparison (NULL = X retorna NULL, nao true — mas seguranca em
-- profundidade exige o IS NOT NULL explicito).
alter table public.promoter_discounts enable row level security;
grant select on public.promoter_discounts to authenticated;
grant insert on public.promoter_discounts to authenticated;
grant update on public.promoter_discounts to authenticated;
grant delete on public.promoter_discounts to authenticated;

drop policy if exists "promoter_discounts_socio_all" on public.promoter_discounts;
create policy "promoter_discounts_socio_all"
on public.promoter_discounts for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_discounts_funcionario_all" on public.promoter_discounts;
create policy "promoter_discounts_funcionario_all"
on public.promoter_discounts for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_discounts_promotor_select" on public.promoter_discounts;
create policy "promoter_discounts_promotor_select"
on public.promoter_discounts for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id is not null
  and promoter_id = public.current_app_user_promoter_id()
);
