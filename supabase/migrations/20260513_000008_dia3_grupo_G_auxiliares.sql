-- Migration: Dia 3 — Grupo G (Auxiliares): 2 tabelas
--
-- Tabelas (todas sem RLS hoje):
--   expense_categories  -> 9 rows seedadas (Folha, Aluguel, Marketing, etc.)
--   audit_logs          -> log de auditoria interna (vazio; future trigger)
--
-- Matriz de permissoes:
--   expense_categories  socio ALL          | func SELECT | promotor BLOQUEADO (D10 versao B)
--   audit_logs          socio SELECT-only  | func BLOQUEADO | promotor BLOQUEADO
--
-- DECISAO ESPECIAL audit_logs (recomendacao Diego aprovada):
--   audit_logs eh append-only via sistema. Sem policy INSERT/UPDATE/DELETE
--   = ninguem escreve manual via PostgREST (nem socio). Triggers futuros
--   serao SECURITY DEFINER + owner postgres -> bypassam GRANT e RLS por
--   design, inserts do sistema seguem funcionando.
--
--   GRANT amplo (4 verbos) mantido por consistencia com outras migrations
--   e para mensagens de erro coerentes (policy denial em vez de privilegio
--   denial em nivel de GRANT, mais facil de debugar no Studio).
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- ============================================================
-- expense_categories  (D10 versao B)
-- ============================================================
alter table public.expense_categories enable row level security;
grant select on public.expense_categories to authenticated;
grant insert on public.expense_categories to authenticated;
grant update on public.expense_categories to authenticated;
grant delete on public.expense_categories to authenticated;

drop policy if exists "expense_categories_socio_all" on public.expense_categories;
create policy "expense_categories_socio_all"
on public.expense_categories for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario LE (combobox em formularios de financial_expenses)
drop policy if exists "expense_categories_funcionario_select" on public.expense_categories;
create policy "expense_categories_funcionario_select"
on public.expense_categories for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- promotor BLOQUEADO (D10 versao B): sem policy

-- ============================================================
-- audit_logs  (SELECT-only para socio; sem escrita manual)
-- ============================================================
alter table public.audit_logs enable row level security;
grant select on public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;
grant update on public.audit_logs to authenticated;
grant delete on public.audit_logs to authenticated;

-- socio LE somente. Sem policy FOR ALL = INSERT/UPDATE/DELETE via PostgREST
-- bloqueados pela RLS (mesmo com GRANT presente).
drop policy if exists "audit_logs_socio_select" on public.audit_logs;
create policy "audit_logs_socio_select"
on public.audit_logs for select to authenticated
using (public.current_app_user_role() = 'socio');

-- funcionario e promotor BLOQUEADOS (sem policy)
--
-- INSERT do sistema: triggers futuros usarao SECURITY DEFINER owner=postgres
-- e bypassarao tanto GRANT quanto RLS automaticamente. Padrao referencia:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#bypass-rls
