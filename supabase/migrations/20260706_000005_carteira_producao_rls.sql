-- Migration: RLS + grant da carteira_contrato e producao_contrato (2026-07-06)
--
-- Corrige "permission denied for table carteira_contrato" na /recebiveis. Ambas as
-- tabelas foram criadas ad-hoc (Opcao B) com RLS habilitada e ZERO policies
-- (deny-by-default). As funcoes de materializacao usam service_role (bypassa RLS),
-- mas a /recebiveis le via client autenticado (withSocioAnon) -> permission denied.
-- Espelha o padrao de monthly_closing_entries (a fonte antiga): socio ALL, funcionario SELECT.
-- producao_contrato recebe as mesmas policies preventivamente (mesma cadeia, mesmo risco).
--
-- APLICAR MANUALMENTE no Studio. Idempotente (drop policy if exists).

begin;

-- carteira_contrato
grant select on public.carteira_contrato to authenticated;

drop policy if exists "carteira_contrato_socio_all" on public.carteira_contrato;
create policy "carteira_contrato_socio_all"
on public.carteira_contrato for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "carteira_contrato_funcionario_select" on public.carteira_contrato;
create policy "carteira_contrato_funcionario_select"
on public.carteira_contrato for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- producao_contrato
grant select on public.producao_contrato to authenticated;

drop policy if exists "producao_contrato_socio_all" on public.producao_contrato;
create policy "producao_contrato_socio_all"
on public.producao_contrato for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "producao_contrato_funcionario_select" on public.producao_contrato;
create policy "producao_contrato_funcionario_select"
on public.producao_contrato for select to authenticated
using (public.current_app_user_role() = 'funcionario');

commit;
