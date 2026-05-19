-- Dia 4.5 Etapa A — Schema de perfis de repasse do promotor.
--
-- Identifica 6 perfis distintos a partir das planilhas mensais
-- consolidadas (RR AL_1, AL_2, AL_3, PE — abril/2026) e introduz
-- as tabelas que alimentarao a nova cascata de calculo de %
-- repasse na Etapa B.
--
-- Tabelas/campos novos:
--   share_profile_type (ENUM)
--   share_scale (escalas de repasse, kind=CREDIT|INSURANCE)
--   share_scale_tier (faixas por escala)
--   promoter_share_profile (1:1 promoter -> perfil)
--   entrante_monthly_volume (tracking mensal para futura graduacao)
--   promoter_proposal_commissions.share_percent_override (col nova)
--
-- Idempotencia: DO blocks para CREATE TYPE; IF NOT EXISTS para
-- CREATE TABLE; ADD COLUMN IF NOT EXISTS; DROP POLICY IF EXISTS
-- antes de cada CREATE POLICY.

-- ============================================================
-- Enum
-- ============================================================
do $$
begin
  create type share_profile_type as enum (
    'DEFAULT',
    'CLT_FIXO',
    'ACORDO_FIXO',
    'ENTRANTE_PADRAO',
    'ENTRANTE_CUSTOM',
    'ACORDO_VARIAVEL'
  );
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- share_scale
-- ============================================================
create table if not exists public.share_scale (
  id uuid primary key default gen_random_uuid(),
  scale_code text unique not null,
  description text,
  scale_kind text not null check (scale_kind in ('CREDIT', 'INSURANCE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- share_scale_tier
-- ============================================================
create table if not exists public.share_scale_tier (
  id uuid primary key default gen_random_uuid(),
  scale_id uuid not null references public.share_scale(id) on delete cascade,
  volume_min numeric(15,2) not null default 0,
  volume_max numeric(15,2),  -- NULL = sem teto
  share_percent numeric(7,4) not null,
  unique (scale_id, volume_min),
  constraint max_gt_min check (volume_max is null or volume_max > volume_min)
);

create index if not exists share_scale_tier_scale_id_idx
  on public.share_scale_tier(scale_id);

-- ============================================================
-- promoter_share_profile
-- ============================================================
create table if not exists public.promoter_share_profile (
  promoter_id uuid primary key references public.promoters(id) on delete cascade,
  profile_type share_profile_type not null default 'DEFAULT',
  fixed_percent numeric(7,4),
  scale_id uuid references public.share_scale(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_consistency check (
    (profile_type = 'DEFAULT'
       and fixed_percent is null and scale_id is null) or
    (profile_type in ('CLT_FIXO', 'ACORDO_FIXO')
       and fixed_percent is not null and scale_id is null) or
    (profile_type in ('ENTRANTE_PADRAO', 'ENTRANTE_CUSTOM')
       and fixed_percent is null and scale_id is not null) or
    (profile_type = 'ACORDO_VARIAVEL'
       and fixed_percent is null and scale_id is null)
  )
);

create index if not exists promoter_share_profile_type_idx
  on public.promoter_share_profile(profile_type);

-- ============================================================
-- entrante_monthly_volume
-- ============================================================
create table if not exists public.entrante_monthly_volume (
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  year integer not null,
  month integer not null,
  monthly_volume numeric(15,2) not null default 0,
  qualified_for_default boolean not null default false,
  primary key (promoter_id, year, month)
);

-- ============================================================
-- promoter_proposal_commissions: override por proposta
-- ============================================================
alter table public.promoter_proposal_commissions
  add column if not exists share_percent_override numeric(7,4);

comment on column public.promoter_proposal_commissions.share_percent_override is
  'Dia 4.5: override do % de repasse para esta proposta. NULL = usa perfil do promotor. Preenchido = vence cascata (perfil + tabelas).';

-- ============================================================
-- RLS — read autenticado, write so socio
-- ============================================================

-- share_scale
alter table public.share_scale enable row level security;
grant select on public.share_scale to authenticated;
grant insert, update, delete on public.share_scale to authenticated;

drop policy if exists "share_scale_read" on public.share_scale;
create policy "share_scale_read"
  on public.share_scale for select to authenticated using (true);

drop policy if exists "share_scale_socio_write" on public.share_scale;
create policy "share_scale_socio_write"
  on public.share_scale for all to authenticated
  using (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  )
  with check (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  );

-- share_scale_tier
alter table public.share_scale_tier enable row level security;
grant select on public.share_scale_tier to authenticated;
grant insert, update, delete on public.share_scale_tier to authenticated;

drop policy if exists "share_scale_tier_read" on public.share_scale_tier;
create policy "share_scale_tier_read"
  on public.share_scale_tier for select to authenticated using (true);

drop policy if exists "share_scale_tier_socio_write" on public.share_scale_tier;
create policy "share_scale_tier_socio_write"
  on public.share_scale_tier for all to authenticated
  using (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  )
  with check (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  );

-- promoter_share_profile
alter table public.promoter_share_profile enable row level security;
grant select on public.promoter_share_profile to authenticated;
grant insert, update, delete on public.promoter_share_profile to authenticated;

drop policy if exists "promoter_share_profile_read" on public.promoter_share_profile;
create policy "promoter_share_profile_read"
  on public.promoter_share_profile for select to authenticated using (true);

drop policy if exists "promoter_share_profile_socio_write" on public.promoter_share_profile;
create policy "promoter_share_profile_socio_write"
  on public.promoter_share_profile for all to authenticated
  using (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  )
  with check (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  );

-- entrante_monthly_volume
alter table public.entrante_monthly_volume enable row level security;
grant select on public.entrante_monthly_volume to authenticated;
grant insert, update, delete on public.entrante_monthly_volume to authenticated;

drop policy if exists "entrante_monthly_volume_read" on public.entrante_monthly_volume;
create policy "entrante_monthly_volume_read"
  on public.entrante_monthly_volume for select to authenticated using (true);

drop policy if exists "entrante_monthly_volume_socio_write" on public.entrante_monthly_volume;
create policy "entrante_monthly_volume_socio_write"
  on public.entrante_monthly_volume for all to authenticated
  using (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  )
  with check (
    exists (
      select 1 from public.app_users
       where auth_user_id = auth.uid() and role = 'socio'
    )
  );
