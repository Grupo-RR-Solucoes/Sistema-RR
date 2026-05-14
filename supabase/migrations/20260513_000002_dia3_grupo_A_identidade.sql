-- Migration: Dia 3 — Grupo A (Identidade): app_users + access_profiles
--
-- Estado inicial (confirmado pelo §6 do inventario):
--   app_users        -> RLS habilitada (Dia 2) + 1 policy app_users_select_own
--                       (for select to authenticated using auth.uid()=auth_user_id)
--                       + GRANT SELECT to authenticated
--   access_profiles  -> sem RLS, sem policies, sem GRANT; 2 rows seedadas
--
-- Matriz de permissoes (decisao Diego):
--   app_users
--     socio        -> ALL (gerencia usuarios)
--     funcionario  -> SELECT todas as rows (lista de quem eh quem; nao escreve)
--     promotor     -> SELECT propria row apenas (via app_users_select_own herdada)
--   access_profiles (D10 versao B)
--     socio        -> ALL
--     funcionario  -> SELECT
--     promotor     -> BLOQUEADO (sem policy)
--
-- IDEMPOTENCIA:
--   - ENABLE RLS eh idempotente nativamente
--   - GRANT eh idempotente nativamente
--   - CREATE POLICY NAO eh idempotente -> precede cada com DROP POLICY IF EXISTS
--   - A policy app_users_select_own (Dia 2) NAO eh tocada por esta migration:
--     ela continua valida para todos os roles e da SELECT da propria row a
--     funcionario/promotor mesmo se as policies novas falharem.

-- ============================================================
-- app_users
-- ============================================================

-- RLS ja habilitada pela 20260512_000001 (Dia 2). ENABLE eh idempotente.
alter table public.app_users enable row level security;

-- GRANT SELECT em app_users ja existe (Dia 2). Adiciona INSERT/UPDATE/DELETE
-- para que policy socio_all possa exercer escrita via PostgREST.
grant insert on public.app_users to authenticated;
grant update on public.app_users to authenticated;
grant delete on public.app_users to authenticated;

-- Policy PRESERVADA da Dia 2 (NAO recriar aqui):
--   app_users_select_own  for select to authenticated
--                         using (auth.uid() = auth_user_id)
--   -> garante que qualquer authenticated sempre ve sua propria row.
--      Funciona para socio (que tem cobertura mais ampla abaixo),
--      funcionario (cobertura ampla abaixo) e promotor (UNICA cobertura).
--      OR-semantics entre policies = sufficient if any policy passes.

-- Policy NOVA: socio gerencia tudo em app_users.
-- Cobertura SELECT/INSERT/UPDATE/DELETE para socio.
-- Combinada com app_users_select_own (OR em SELECT) e funcionario_select:
--   socio       -> select_own OR socio_all      = todas (4 verbos)
--   funcionario -> select_own OR func_select    = todas as rows (SELECT only)
--   promotor    -> select_own apenas            = propria row apenas
drop policy if exists "app_users_socio_all" on public.app_users;
create policy "app_users_socio_all"
on public.app_users
for all
to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- Policy NOVA: funcionario le lista completa de usuarios (precisa saber
-- quem eh quem para operacao dos 4 CNPJs — identificar quem lancou despesa,
-- quem cadastrou promoter, etc.) mas NAO escreve (escopo declarado:
-- "nao gerencia usuarios").
drop policy if exists "app_users_funcionario_select" on public.app_users;
create policy "app_users_funcionario_select"
on public.app_users
for select
to authenticated
using (public.current_app_user_role() = 'funcionario');

-- promotor: SELECT propria row apenas, via policy app_users_select_own
-- herdada do Dia 2. Sem policy adicional aqui. INSERT/UPDATE/DELETE
-- bloqueados (sem policy que case).

-- ============================================================
-- access_profiles
-- ============================================================

alter table public.access_profiles enable row level security;

grant select on public.access_profiles to authenticated;
grant insert on public.access_profiles to authenticated;
grant update on public.access_profiles to authenticated;
grant delete on public.access_profiles to authenticated;

-- socio gerencia perfis legados (lookup de access_profile_id em app_users).
-- Tabela tem 2 rows seedadas ("Visao Geral", "Visao Parcial") — manutencao
-- rara, mas socio precisa de ALL para criar/renomear se decidir refatorar.
drop policy if exists "access_profiles_socio_all" on public.access_profiles;
create policy "access_profiles_socio_all"
on public.access_profiles
for all
to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario apenas le (D10 versao B: promotor bloqueado; func mantem leitura
-- para eventual UI de admin onde precisa enxergar o perfil legado de outro
-- usuario que ele esta investigando).
drop policy if exists "access_profiles_funcionario_select" on public.access_profiles;
create policy "access_profiles_funcionario_select"
on public.access_profiles
for select
to authenticated
using (public.current_app_user_role() = 'funcionario');

-- promotor BLOQUEADO: ausencia de policy + RLS on = SELECT retorna 0 rows.
