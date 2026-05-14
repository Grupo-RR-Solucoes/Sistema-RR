-- Migration: Dia 3 — Grupo E (Auditoria Promotiva): 7 tabelas
--
-- Tabelas (TODAS com RLS JA habilitada via Studio prompt — confirmado §6,
-- ALTER TABLE ENABLE RLS abaixo eh idempotente; SEM policies hoje = apenas
-- service_role passa, scripts batch continuam funcionando):
--   audit_v9_avista
--   audit_v9_prt
--   audit_v9_enquadramento
--   audit_v9_reconciliacao
--   audit_v9_duplicates_quarantine
--   audit_v9_padrao_d_exclusoes
--   monthly_validator_snapshot
--
-- Matriz (D1 — escopo declarado: "funcionario nao ve audit_v9_*"):
--   socio        -> ALL (defende numeros junto a Promotiva, ajusta exclusoes)
--   funcionario  -> BLOQUEADO (sem policy)
--   promotor     -> BLOQUEADO (sem policy)
--
-- Padrao desta migration: APENAS policy _socio_all por tabela. Funcionario e
-- promotor caem em "RLS habilitada + sem policy que case" = SELECT 0 rows,
-- INSERT/UPDATE/DELETE bloqueados.
--
-- Nota operacional: scripts/seed_v9.cjs, seed_validator.cjs e demais usam
-- SUPABASE_SERVICE_ROLE_KEY que bypassa RLS — seguem funcionando independente
-- desta migration. RLS+policy aqui controla apenas acesso via PostgREST.
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- ============================================================
-- audit_v9_avista
-- ============================================================
alter table public.audit_v9_avista enable row level security;
grant select on public.audit_v9_avista to authenticated;
grant insert on public.audit_v9_avista to authenticated;
grant update on public.audit_v9_avista to authenticated;
grant delete on public.audit_v9_avista to authenticated;

drop policy if exists "audit_v9_avista_socio_all" on public.audit_v9_avista;
create policy "audit_v9_avista_socio_all"
on public.audit_v9_avista for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- audit_v9_prt
-- ============================================================
alter table public.audit_v9_prt enable row level security;
grant select on public.audit_v9_prt to authenticated;
grant insert on public.audit_v9_prt to authenticated;
grant update on public.audit_v9_prt to authenticated;
grant delete on public.audit_v9_prt to authenticated;

drop policy if exists "audit_v9_prt_socio_all" on public.audit_v9_prt;
create policy "audit_v9_prt_socio_all"
on public.audit_v9_prt for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- audit_v9_enquadramento
-- ============================================================
alter table public.audit_v9_enquadramento enable row level security;
grant select on public.audit_v9_enquadramento to authenticated;
grant insert on public.audit_v9_enquadramento to authenticated;
grant update on public.audit_v9_enquadramento to authenticated;
grant delete on public.audit_v9_enquadramento to authenticated;

drop policy if exists "audit_v9_enquadramento_socio_all" on public.audit_v9_enquadramento;
create policy "audit_v9_enquadramento_socio_all"
on public.audit_v9_enquadramento for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- audit_v9_reconciliacao
-- ============================================================
alter table public.audit_v9_reconciliacao enable row level security;
grant select on public.audit_v9_reconciliacao to authenticated;
grant insert on public.audit_v9_reconciliacao to authenticated;
grant update on public.audit_v9_reconciliacao to authenticated;
grant delete on public.audit_v9_reconciliacao to authenticated;

drop policy if exists "audit_v9_reconciliacao_socio_all" on public.audit_v9_reconciliacao;
create policy "audit_v9_reconciliacao_socio_all"
on public.audit_v9_reconciliacao for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- audit_v9_duplicates_quarantine
-- ============================================================
alter table public.audit_v9_duplicates_quarantine enable row level security;
grant select on public.audit_v9_duplicates_quarantine to authenticated;
grant insert on public.audit_v9_duplicates_quarantine to authenticated;
grant update on public.audit_v9_duplicates_quarantine to authenticated;
grant delete on public.audit_v9_duplicates_quarantine to authenticated;

drop policy if exists "audit_v9_duplicates_quarantine_socio_all" on public.audit_v9_duplicates_quarantine;
create policy "audit_v9_duplicates_quarantine_socio_all"
on public.audit_v9_duplicates_quarantine for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- audit_v9_padrao_d_exclusoes
-- ============================================================
alter table public.audit_v9_padrao_d_exclusoes enable row level security;
grant select on public.audit_v9_padrao_d_exclusoes to authenticated;
grant insert on public.audit_v9_padrao_d_exclusoes to authenticated;
grant update on public.audit_v9_padrao_d_exclusoes to authenticated;
grant delete on public.audit_v9_padrao_d_exclusoes to authenticated;

drop policy if exists "audit_v9_padrao_d_exclusoes_socio_all" on public.audit_v9_padrao_d_exclusoes;
create policy "audit_v9_padrao_d_exclusoes_socio_all"
on public.audit_v9_padrao_d_exclusoes for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- monthly_validator_snapshot
-- ============================================================
alter table public.monthly_validator_snapshot enable row level security;
grant select on public.monthly_validator_snapshot to authenticated;
grant insert on public.monthly_validator_snapshot to authenticated;
grant update on public.monthly_validator_snapshot to authenticated;
grant delete on public.monthly_validator_snapshot to authenticated;

drop policy if exists "monthly_validator_snapshot_socio_all" on public.monthly_validator_snapshot;
create policy "monthly_validator_snapshot_socio_all"
on public.monthly_validator_snapshot for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');
