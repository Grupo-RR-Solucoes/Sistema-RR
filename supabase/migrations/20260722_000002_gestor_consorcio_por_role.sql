-- FRENTE DE PRODUTO — desburocratizar o GESTOR de consorcio: definir pelo ROLE,
-- igual supervisor/gerente_regional do credito (standing, ativo-ate-trocar).
--
-- O gestor deixa de ser definido por competencia (tabela consorcio_gestor) e passa a
-- ser simplesmente o app_user com role='gestor_consorcio'. O vinculo de "tambem e
-- promotor" sai da tabela e vai para app_users.promoter_id (mesmo campo do papel
-- promotor). O payout continua carimbando quem era o gestor no momento da
-- reconsolidacao (historico leve), mas resolvido pelo role — nao mais por tela.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).
-- Reverte 20260721_000003 (parte consorcio_gestor) e 20260722_000001 (a coluna
-- promoter_id daquela tabela some junto com o drop). O payout (consorcio_gestor_payout)
-- e o role permanecem.

begin;

-- 1) Elimina a tabela de vigencia por competencia (e a coluna promoter_id dela).
drop table if exists public.consorcio_gestor cascade;

-- 2) Scope CHECK: gestor_consorcio passa a aceitar promoter_id OPCIONAL (cnpj_id null).
--    null = gestor puro; um promoters(id) valido = gestor que TAMBEM vende. Mesmo
--    campo/mecanismo do papel promotor.
alter table public.app_users
  drop constraint if exists app_users_role_scope_check;

alter table public.app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role = 'gestor_consorcio' and cnpj_id is null) or
    (role in ('socio', 'funcionario', 'supervisor', 'gerente_regional')
      and cnpj_id is null and promoter_id is null)
  );

-- 3) RLS do payout: o gestor le por ROLE (nao mais por gestor_user_id carimbado).
--    Assim o payout ORFAO de junho (gestor_user_id null, gravado antes de existir
--    gestor) fica visivel automaticamente ao Alan assim que ele ganhar o role — sem
--    precisar re-carimbar. socio continua com o _all.
drop policy if exists "consorcio_gestor_payout_gestor_select" on public.consorcio_gestor_payout;
create policy "consorcio_gestor_payout_gestor_select" on public.consorcio_gestor_payout for select to authenticated
using (public.current_app_user_role() = 'gestor_consorcio');

commit;

-- 4) (OPCIONAL) Trava de 1 gestor_consorcio ATIVO por vez (o grupo tem um). Indice
--    unico parcial sobre uma constante: no maximo uma linha ativa com esse role.
--    Se hoje ja houver >1 ativo, este create FALHA (esperado: resolva os duplicados
--    antes). Comente se nao quiser a trava.
create unique index if not exists app_users_um_gestor_consorcio_ativo
  on public.app_users ((true))
  where role = 'gestor_consorcio' and active;

-- Verificacao pos-execucao:
--   -- (a) consorcio_gestor sumiu:
--   select to_regclass('public.consorcio_gestor');  -- esperado: null
--   -- (b) gestor com promoter_id passa no scope check:
--   --   update app_users set promoter_id = '<promoters.id>' where role='gestor_consorcio';  -- ok
--   -- (c) o payout de junho fica visivel ao gestor por role (rodar autenticado como gestor):
--   select competencia, gestor_10 from consorcio_gestor_payout where competencia='2026-06';
