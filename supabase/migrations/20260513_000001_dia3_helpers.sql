-- Migration: Dia 3 — Helpers SECURITY DEFINER para policies RLS
--
-- Contexto:
--   Cada policy RLS no schema public precisa decidir se o user autenticado
--   pode ler/escrever uma linha. A decisao depende de:
--     - role do user           (socio | funcionario | promotor)
--     - promoter_id do user    (NULL para socio/funcionario)
--     - cnpj_id do user        (NULL para socio/funcionario)
--   Todos os 3 atributos vivem em public.app_users (1 row por auth.users.id).
--
-- Problema sem helpers:
--   Cada policy fariam subquery `select ... from app_users where
--   auth_user_id = auth.uid()` por linha avaliada. Em tabela de 100k rows
--   = 100k subqueries. Inviavel.
--
-- Solucao:
--   3 funcoes SECURITY DEFINER + STABLE que Postgres cacheia por statement.
--     STABLE          = mesmo resultado dentro de um mesmo SELECT/UPDATE;
--                       planner chama 1x e reusa nas N linhas avaliadas.
--     SECURITY DEFINER = executa como owner (postgres), bypassa RLS de
--                       app_users — sem isto, a propria policy
--                       app_users_select_own bloqueia o lookup interno
--                       da funcao gerando loop ou NULL espurio.
--     SET search_path = blinda contra hijack via schema malicioso no path.
--
-- GRANT EXECUTE para authenticated permite o client chamar via policies;
-- service_role ja tem por default da role.

create or replace function public.current_app_user_role()
returns text
language sql
security definer
stable
set search_path = public, auth
as $$
  select role
    from public.app_users
   where auth_user_id = auth.uid()
   limit 1;
$$;

create or replace function public.current_app_user_promoter_id()
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select promoter_id
    from public.app_users
   where auth_user_id = auth.uid()
   limit 1;
$$;

create or replace function public.current_app_user_cnpj_id()
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select cnpj_id
    from public.app_users
   where auth_user_id = auth.uid()
   limit 1;
$$;

grant execute on function public.current_app_user_role()         to authenticated;
grant execute on function public.current_app_user_promoter_id()  to authenticated;
grant execute on function public.current_app_user_cnpj_id()      to authenticated;

comment on function public.current_app_user_role() is
  'Dia 3 helper: retorna role do user autenticado (socio|funcionario|promotor). NULL se nao houver row em app_users com auth_user_id = auth.uid().';
comment on function public.current_app_user_promoter_id() is
  'Dia 3 helper: retorna promoter_id do user autenticado. NULL para socio/funcionario.';
comment on function public.current_app_user_cnpj_id() is
  'Dia 3 helper: retorna cnpj_id do user autenticado. NULL para socio/funcionario.';
