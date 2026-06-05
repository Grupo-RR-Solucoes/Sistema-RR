-- ============================================================
-- FRENTE C — Repasse escalonado por meta (competencia 2026-05)
-- ------------------------------------------------------------
-- As METAS EM VALOR continuam em monthly_targets (meta/meta_1/meta_2),
-- fonte unica ja usada pelo motor de comissao. Aqui criamos APENAS a
-- escala de % de repasse ao promotor por meta atingida.
--
-- Regra de negocio: so se aplica a propostas faixa 5,80% empresa
-- (visao promotor). producao_mes >= meta_2 -> pct_meta2;
-- producao_mes >= meta_1 -> pct_meta1; senao pct_base.
-- INSS da Aldalene fica FORA da escala (repasse fixo).
-- ============================================================

create table if not exists public.promoter_goal_repasse (
  id uuid primary key default gen_random_uuid(),
  promoter_id uuid not null references public.promoters(id) on delete cascade,
  competencia date not null,                 -- 1o dia do mes
  pct_base  numeric(6,4) not null,           -- ex 0.5833
  pct_meta1 numeric(6,4),
  pct_meta2 numeric(6,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (promoter_id, competencia)
);

-- ============================================================
-- RLS: socio/funcionario full; promotor so as proprias linhas (SELECT)
-- (mesmo idiom de monthly_targets — dia3 grupo B)
-- ============================================================
alter table public.promoter_goal_repasse enable row level security;
grant select on public.promoter_goal_repasse to authenticated;
grant insert on public.promoter_goal_repasse to authenticated;
grant update on public.promoter_goal_repasse to authenticated;
grant delete on public.promoter_goal_repasse to authenticated;

drop policy if exists "promoter_goal_repasse_socio_all" on public.promoter_goal_repasse;
create policy "promoter_goal_repasse_socio_all"
on public.promoter_goal_repasse for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "promoter_goal_repasse_funcionario_all" on public.promoter_goal_repasse;
create policy "promoter_goal_repasse_funcionario_all"
on public.promoter_goal_repasse for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

drop policy if exists "promoter_goal_repasse_promotor_select" on public.promoter_goal_repasse;
create policy "promoter_goal_repasse_promotor_select"
on public.promoter_goal_repasse for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);
