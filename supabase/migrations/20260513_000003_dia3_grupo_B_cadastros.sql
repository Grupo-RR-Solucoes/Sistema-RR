-- Migration: Dia 3 — Grupo B (Cadastros): 8 tabelas
--
-- Tabelas (todas sem RLS hoje; sem policies; sem GRANT a authenticated):
--   companies, company_identifiers, promoters, j_keys, monthly_targets,
--   commission_tables, commission_table_rows, promoter_product_rate_rules
--
-- Chaves de scope (verificado contra schema em 20260420_000001_rr_foundation.sql):
--   company_identifiers          -> SEM promoter_id; FK company_id (NOT NULL)
--   j_keys                       -> promoter_id DIRETO (nullable, FK)
--   monthly_targets              -> promoter_id DIRETO (NOT NULL, FK)
--   promoter_product_rate_rules  -> SEM promoter_id E SEM company_id (tabela
--                                   global por year/month/product_description)
--
-- Matriz de permissoes:
--   companies                    socio ALL | func SELECT+UPDATE              | promotor SELECT (id = cnpj_id)
--   company_identifiers          socio ALL | func SELECT                     | promotor SELECT (company_id = cnpj_id)
--   promoters                    socio ALL | func ALL                        | promotor SELECT (id = promoter_id)
--   j_keys                       socio ALL | func ALL                        | promotor SELECT (promoter_id = me)
--   monthly_targets              socio ALL | func ALL                        | promotor SELECT (promoter_id = me)
--   commission_tables            socio ALL | func SELECT+UPDATE              | promotor BLOQUEADO (D4)
--   commission_table_rows        socio ALL | func SELECT+UPDATE              | promotor BLOQUEADO (D4)
--   promoter_product_rate_rules  socio ALL | func ALL                        | promotor BLOQUEADO (D4 + sem chave promoter)
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.
-- GRANT e ENABLE RLS sao idempotentes nativamente.

-- ============================================================
-- companies
-- ============================================================
alter table public.companies enable row level security;
grant select on public.companies to authenticated;
grant insert on public.companies to authenticated;
grant update on public.companies to authenticated;
grant delete on public.companies to authenticated;

drop policy if exists "companies_socio_all" on public.companies;
create policy "companies_socio_all"
on public.companies for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario le tudo (precisa enxergar os 4 CNPJs para operacao)
drop policy if exists "companies_funcionario_select" on public.companies;
create policy "companies_funcionario_select"
on public.companies for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- funcionario atualiza dados cadastrais (legal_name, group_name, active flag,
-- etc.) — escopo "atualizar configuracoes de empresa". INSERT/DELETE de
-- companies fica restrito ao socio (decisao estrutural — 4 CNPJs sao
-- entidades juridicas, criacao/exclusao eh evento raro e nao operacional).
drop policy if exists "companies_funcionario_update" on public.companies;
create policy "companies_funcionario_update"
on public.companies for update to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "companies_promotor_select" on public.companies;
create policy "companies_promotor_select"
on public.companies for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and id = public.current_app_user_cnpj_id()
);

-- ============================================================
-- company_identifiers
-- ============================================================
-- Schema: company_id NOT NULL references companies(id). Sem promoter_id.
-- Filtro promotor = via FK company_id (que aponta para a company do user).
alter table public.company_identifiers enable row level security;
grant select on public.company_identifiers to authenticated;
grant insert on public.company_identifiers to authenticated;
grant update on public.company_identifiers to authenticated;
grant delete on public.company_identifiers to authenticated;

drop policy if exists "company_identifiers_socio_all" on public.company_identifiers;
create policy "company_identifiers_socio_all"
on public.company_identifiers for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario apenas le (cadastro de mci/coban — gestao restrita ao socio)
drop policy if exists "company_identifiers_funcionario_select" on public.company_identifiers;
create policy "company_identifiers_funcionario_select"
on public.company_identifiers for select to authenticated
using (public.current_app_user_role() = 'funcionario');

drop policy if exists "company_identifiers_promotor_select" on public.company_identifiers;
create policy "company_identifiers_promotor_select"
on public.company_identifiers for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and company_id = public.current_app_user_cnpj_id()
);

-- ============================================================
-- promoters
-- ============================================================
alter table public.promoters enable row level security;
grant select on public.promoters to authenticated;
grant insert on public.promoters to authenticated;
grant update on public.promoters to authenticated;
grant delete on public.promoters to authenticated;

drop policy if exists "promoters_socio_all" on public.promoters;
create policy "promoters_socio_all"
on public.promoters for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW completo (escopo: "funcionario adiciona/remove promotor")
drop policy if exists "promoters_funcionario_all" on public.promoters;
create policy "promoters_funcionario_all"
on public.promoters for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoters_promotor_select" on public.promoters;
create policy "promoters_promotor_select"
on public.promoters for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and id = public.current_app_user_promoter_id()
);

-- ============================================================
-- j_keys
-- ============================================================
-- Schema: promoter_id DIRETO (nullable references promoters(id)).
-- Filtro promotor = promoter_id = current_app_user_promoter_id().
alter table public.j_keys enable row level security;
grant select on public.j_keys to authenticated;
grant insert on public.j_keys to authenticated;
grant update on public.j_keys to authenticated;
grant delete on public.j_keys to authenticated;

drop policy if exists "j_keys_socio_all" on public.j_keys;
create policy "j_keys_socio_all"
on public.j_keys for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW (precisa conferir mapeamento Promotiva <-> promoter)
drop policy if exists "j_keys_funcionario_all" on public.j_keys;
create policy "j_keys_funcionario_all"
on public.j_keys for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "j_keys_promotor_select" on public.j_keys;
create policy "j_keys_promotor_select"
on public.j_keys for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- monthly_targets
-- ============================================================
-- Schema: promoter_id NOT NULL references promoters(id) on delete cascade.
-- Filtro promotor = promoter_id = current_app_user_promoter_id().
alter table public.monthly_targets enable row level security;
grant select on public.monthly_targets to authenticated;
grant insert on public.monthly_targets to authenticated;
grant update on public.monthly_targets to authenticated;
grant delete on public.monthly_targets to authenticated;

drop policy if exists "monthly_targets_socio_all" on public.monthly_targets;
create policy "monthly_targets_socio_all"
on public.monthly_targets for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW completo (escopo: "edita metas dos promotores")
drop policy if exists "monthly_targets_funcionario_all" on public.monthly_targets;
create policy "monthly_targets_funcionario_all"
on public.monthly_targets for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "monthly_targets_promotor_select" on public.monthly_targets;
create policy "monthly_targets_promotor_select"
on public.monthly_targets for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);

-- ============================================================
-- commission_tables  (D4: promotor BLOQUEADO)
-- ============================================================
alter table public.commission_tables enable row level security;
grant select on public.commission_tables to authenticated;
grant insert on public.commission_tables to authenticated;
grant update on public.commission_tables to authenticated;
grant delete on public.commission_tables to authenticated;

drop policy if exists "commission_tables_socio_all" on public.commission_tables;
create policy "commission_tables_socio_all"
on public.commission_tables for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario SELECT (parametro operacional, precisa conferir)
drop policy if exists "commission_tables_funcionario_select" on public.commission_tables;
create policy "commission_tables_funcionario_select"
on public.commission_tables for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- funcionario UPDATE (ajustar version flag, active, source_name).
-- INSERT/DELETE da tabela-mae fica restrito ao socio (criar nova versao =
-- evento raro e auditavel; idem deletar versao antiga).
drop policy if exists "commission_tables_funcionario_update" on public.commission_tables;
create policy "commission_tables_funcionario_update"
on public.commission_tables for update to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- ============================================================
-- commission_table_rows  (D4: promotor BLOQUEADO)
-- ============================================================
alter table public.commission_table_rows enable row level security;
grant select on public.commission_table_rows to authenticated;
grant insert on public.commission_table_rows to authenticated;
grant update on public.commission_table_rows to authenticated;
grant delete on public.commission_table_rows to authenticated;

drop policy if exists "commission_table_rows_socio_all" on public.commission_table_rows;
create policy "commission_table_rows_socio_all"
on public.commission_table_rows for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "commission_table_rows_funcionario_select" on public.commission_table_rows;
create policy "commission_table_rows_funcionario_select"
on public.commission_table_rows for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- funcionario UPDATE (ajustar faixas, valores percentuais).
-- INSERT/DELETE de linhas fica para socio (estrutura da tabela-mae).
drop policy if exists "commission_table_rows_funcionario_update" on public.commission_table_rows;
create policy "commission_table_rows_funcionario_update"
on public.commission_table_rows for update to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- ============================================================
-- promoter_product_rate_rules  (D4: promotor BLOQUEADO)
-- ============================================================
-- ATENCAO: schema NAO tem promoter_id NEM company_id. Tabela eh GLOBAL por
-- (year, month, product_description). Reforca D4 — nao ha como filtrar por
-- promoter sem inventar JOIN externo. Promotor BLOQUEADO totalmente.
alter table public.promoter_product_rate_rules enable row level security;
grant select on public.promoter_product_rate_rules to authenticated;
grant insert on public.promoter_product_rate_rules to authenticated;
grant update on public.promoter_product_rate_rules to authenticated;
grant delete on public.promoter_product_rate_rules to authenticated;

drop policy if exists "promoter_product_rate_rules_socio_all" on public.promoter_product_rate_rules;
create policy "promoter_product_rate_rules_socio_all"
on public.promoter_product_rate_rules for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario RW completo (escopo: "configura regras de calculo dos promotores")
drop policy if exists "promoter_product_rate_rules_funcionario_all" on public.promoter_product_rate_rules;
create policy "promoter_product_rate_rules_funcionario_all"
on public.promoter_product_rate_rules for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');
