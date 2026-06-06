-- ============================================================
-- CMS tables — GRANT + RLS (corrige o "permission denied" que fazia
-- detectClosedMonth retornar false em qualquer rota com cliente RLS, e o
-- detalhe por proposta de mês fechado cair no daily em vez do cms ground truth).
--
-- As tabelas cms_imports e cms_promoter_entries foram criadas SEM grant/RLS
-- (20260602000000_cms_import_tables.sql) -> authenticated tomava permission denied.
-- Escrita continua só service_role (import + calculate/monthly), que bypassa RLS.
--
--   cms_imports         = metadata de import (company/mês/arquivo/status, SEM valor
--                         sensível). SELECT p/ socio/funcionario/promotor — o
--                         detectClosedMonth roda nas 3 rotas.
--   cms_promoter_entries = comissão por promotor (promoter_credit/seguro — sensível).
--                         MESMO padrão do daily_production_records (Dia 3 grupo C):
--                         socio ALL | funcionario ALL | promotor SELECT só as próprias.
--
-- Idempotente (drop policy if exists). Diego roda no Studio.
-- ============================================================

-- ---------- cms_imports (metadata, não-sensível) ----------
alter table public.cms_imports enable row level security;
grant select on public.cms_imports to authenticated;

drop policy if exists "cms_imports_app_select" on public.cms_imports;
create policy "cms_imports_app_select"
on public.cms_imports for select to authenticated
using (public.current_app_user_role() in ('socio', 'funcionario', 'promotor'));

-- ---------- cms_promoter_entries (comissão por promotor, sensível) ----------
alter table public.cms_promoter_entries enable row level security;
grant select on public.cms_promoter_entries to authenticated;

drop policy if exists "cms_promoter_entries_socio_all" on public.cms_promoter_entries;
create policy "cms_promoter_entries_socio_all"
on public.cms_promoter_entries for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "cms_promoter_entries_funcionario_all" on public.cms_promoter_entries;
create policy "cms_promoter_entries_funcionario_all"
on public.cms_promoter_entries for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- promotor: SELECT só as próprias linhas (promoter_id = o seu). cms_promoter_entries
-- tem uma única coluna promoter_id (resolvido por j_key no import), então o filtro
-- é direto — sem o split assigned/original do daily_production_records.
drop policy if exists "cms_promoter_entries_promotor_select" on public.cms_promoter_entries;
create policy "cms_promoter_entries_promotor_select"
on public.cms_promoter_entries for select to authenticated
using (
  public.current_app_user_role() = 'promotor'
  and promoter_id = public.current_app_user_promoter_id()
);
