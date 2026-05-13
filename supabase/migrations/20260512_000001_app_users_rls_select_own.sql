-- Migration: RLS policy SELECT para app_users (Dia 2 bugfix)
--
-- Causa raiz: tabela app_users tem RLS habilitada (provavel via Supabase
-- Studio prompt durante configuracao manual em 11/05/2026) sem policies,
-- bloqueando SELECT do useUser no client.
--
-- DUAS CAMADAS NECESSARIAS:
-- 1. GRANT SELECT (privilegio basico): permite SELECT na tabela para
--    role authenticated. Eh prerequisito do RLS - sem GRANT, Postgres
--    bloqueia antes mesmo de checar a policy (erro 42501 permission denied).
-- 2. RLS POLICY (filtro de linha): controla quais linhas cada user ve.
--
-- Correcao minima: GRANT SELECT + policy authenticated SELECT
-- WHERE auth.uid() = auth_user_id. Dia 3 (RBAC completo) adicionara
-- policies para socio/funcionario lerem outros usuarios, INSERT/UPDATE, etc.

-- Garante RLS habilitada (idempotente)
alter table public.app_users enable row level security;

-- Camada 1: privilegio basico (sem isto, RLS bloqueia antes da policy)
grant select on public.app_users to authenticated;

-- Camada 2: policy app_users_select_own
-- Usuario autenticado le APENAS a propria linha
create policy "app_users_select_own"
on public.app_users for select
to authenticated
using (auth.uid() = auth_user_id);
