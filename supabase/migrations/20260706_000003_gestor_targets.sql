-- Migration: Gestão — META DO GESTOR (override editável), Entrega 2 (2026-07-06)
--
-- Objetivo: dar ao supervisor e ao gerente_regional uma META PRÓPRIA. Por padrão
-- a meta do gestor é DERIVADA (soma das metas dos promotores do time dele, que a
-- /equipe já calcula). Esta tabela guarda um OVERRIDE opcional por (gestor,
-- competência): havendo linha, a meta efetiva = override; senão = derivada.
--
-- Edição é SÓCIO-ONLY (a app grava via /api/equipe/meta com requireSocio, no
-- editor de /admin/equipes). O gestor apenas LÊ a própria meta.
--
-- 'socio' entra na validação de role porque sócios podem atuar como gestor em
-- estados órfãos (F2 / feat/gestao-socio-como-gestor) — forward-compat; no fluxo
-- atual o editor lista supervisor/gerente.
--
-- Segurança / idempotência: transacional; create table if not exists; create or
-- replace function; drop trigger/policy if exists antes de recriar. Rodar 2x é
-- seguro. APLICAR MANUALMENTE no Supabase Studio (banco não migra sozinho).

begin;

-- ============================================================
-- 1) Tabela
-- ============================================================
create table if not exists public.gestor_targets (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  year       int  not null,
  month      int  not null,
  meta       numeric not null check (meta >= 0),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, year, month)
);

comment on table public.gestor_targets is
  'Override de meta por gestor (supervisor/gerente_regional/socio) e competência. '
  'Ausência de linha => meta derivada (Σ metas dos promotores do time). Edição '
  'socio-only (RLS). Integridade de papel garantida pela trigger.';

-- ============================================================
-- 2) Trigger: user_id deve ser um GESTOR
-- ============================================================
create or replace function public.fn_validate_gestor_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.app_users where id = new.user_id;

  if v_role is null then
    raise exception
      'Meta de gestor inválida: user_id % não existe em app_users.', new.user_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_role not in ('supervisor', 'gerente_regional', 'socio') then
    raise exception
      'Meta de gestor inválida: só faz sentido para supervisor, gerente_regional '
      'ou socio; o usuário indicado tem papel "%".', v_role
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_validate_gestor_target on public.gestor_targets;
create trigger trg_validate_gestor_target
  before insert or update on public.gestor_targets
  for each row execute function public.fn_validate_gestor_target();

-- ============================================================
-- 3) Índice de leitura por competência
-- ============================================================
create index if not exists idx_gestor_targets_competencia
  on public.gestor_targets (year, month);

-- ============================================================
-- 4) RLS
-- ============================================================
alter table public.gestor_targets enable row level security;
grant select, insert, update, delete on public.gestor_targets to authenticated;

-- socio: tudo (edição é socio-only).
drop policy if exists "gestor_targets_socio_all" on public.gestor_targets;
create policy "gestor_targets_socio_all"
on public.gestor_targets for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- supervisor/gerente: SELECT só a PRÓPRIA linha. Não há helper de "meu app_user
-- id"; usa o mesmo subselect canônico (auth_user_id = auth.uid()) que
-- current_user_team_promoter_ids/current_app_user_role usam. SEM insert/update/delete.
drop policy if exists "gestor_targets_gestor_select" on public.gestor_targets;
create policy "gestor_targets_gestor_select"
on public.gestor_targets for select to authenticated
using (
  public.current_app_user_role() in ('supervisor', 'gerente_regional')
  and user_id = (select id from public.app_users where auth_user_id = auth.uid())
);

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) sócio consegue INSERT/UPDATE (rodar autenticado como sócio, ou via
--   --     service_role no Studio que bypassa RLS mas dispara a trigger):
--   -- insert into public.gestor_targets (user_id, year, month, meta)
--   --   values ('<id-de-um-supervisor>', 2026, 7, 500000)
--   --   on conflict (user_id, year, month) do update set meta = excluded.meta;
--   -- esperado: OK.
--
--   -- (b) inserir user_id de um PROMOTOR/FUNCIONARIO falha na trigger:
--   -- insert into public.gestor_targets (user_id, year, month, meta)
--   --   values ('<id-de-um-funcionario-ou-promotor>', 2026, 7, 100);
--   -- esperado: ERROR 'Meta de gestor inválida: só faz sentido para supervisor,
--   --           gerente_regional ou socio; o usuário indicado tem papel "..."'.
--
--   -- (c) a policy de gestor só enxerga a PRÓPRIA linha (logado como supervisor):
--   -- select user_id, year, month, meta from public.gestor_targets;
--   -- esperado: só as linhas em que user_id = (meu app_user id); nunca as de outro gestor.
--
--   -- (d) as policies existem:
--   -- select policyname, cmd from pg_policies
--   --  where schemaname='public' and tablename='gestor_targets';
--   -- esperado: gestor_targets_socio_all (ALL) + gestor_targets_gestor_select (SELECT).
