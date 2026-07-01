-- Migration: Frente Gestão — Fase 3 (2026-07-01)
--
-- Objetivo (F3, visão de dados SEGURA do gestor): dar ao supervisor e ao
-- gerente_regional acesso de LEITURA à PRODUÇÃO do seu time, SEM comissão,
-- SEM financeiro, SEM PII. Três peças:
--   1) helper current_user_team_promoter_ids() — o "time" do usuário logado;
--   2) view mascarada vw_team_production — produção do time, colunas de
--      comissão/financeiro/PII FISICAMENTE omitidas (não é SELECT com filtro de
--      coluna: a coluna nem existe na view);
--   3) policy de SELECT em monthly_targets para os roles de gestão (só o time).
--
-- NÃO faz parte da F3 (fases posteriores): nenhuma tela do gestor (F4);
-- nenhuma policy de gestor na tabela CRUA daily_production_records nem em
-- qualquer tabela de comissão/financeiro/auditoria.
--
-- ------------------------------------------------------------
-- MODELO DE SEGURANÇA
-- ------------------------------------------------------------
-- * O gestor (supervisor/gerente_regional) NÃO recebe policy em
--   daily_production_records. Ele lê produção SÓ pela view vw_team_production.
-- * A view roda com DIREITO DO OWNER (security_invoker = false): o SELECT
--   interno na tabela crua usa o privilégio do dono da view (bypassa a RLS que
--   negaria o gestor), e o WHERE restringe ao time via helper. auth.uid() dentro
--   do helper (security definer) continua sendo o do usuário logado — cada um vê
--   só o próprio time.
-- * Colunas OMITIDAS fisicamente da view (verificado contra o create table de
--   daily_production_records em 20260420_000001; a tabela NÃO tem ALTER que
--   adicione colunas — convenio_segment já nasce no create):
--     promoter_commission_percent, promoter_commission_amount,
--     insurance_commission_percent, insurance_commission_amount,
--     commission_rule_source, company_received_percent  (comissão/financeiro)
--     customer_name                                       (PII)
--     raw_payload, daily_import_id, j_key, promoter_source (internos/import)
--   created_at/updated_at (metadata) também NÃO entram — não são de produção.
--
-- ------------------------------------------------------------
-- DEFAULT-DENY (registro): tabelas que continuam NEGADAS ao gestor por AUSÊNCIA
-- de policy (default-deny do Dia 3). Esta migration NÃO cria policy de gestão
-- em nenhuma delas:
--   daily_production_records (CRUA)  -> gestor lê só via vw_team_production
--   commission_tables, commission_table_rows
--   promoter_proposal_commissions, promoter_product_commissions
--   promoter_agreements
--   financial_expenses, monthly_closing_entries
--   audit_logs e demais tabelas de comissão/financeiro/CMS/auditoria
-- ------------------------------------------------------------
--
-- Premissas (verificadas):
--   - Helpers Dia 3 existem e são o mesmo mecanismo: current_app_user_role()
--     (20260513_000001_dia3_helpers) — sql, security definer, stable,
--     search_path = public, auth.
--   - F2 já em produção: promoters.supervisor_user_id, app_users.manager_user_id.
--   - promoters.is_master existe (20260517_000001) — chaves master fora do time.
--   - monthly_targets tem RLS + policies socio_all/funcionario_all/promotor_select
--     (20260513_000003). A nova policy é PERMISSIVE (OR) → só ADICIONA leitura
--     de time ao gestor; não afrouxa nada existente.
--
-- Segurança / idempotência: transacional; create or replace (helper/view),
-- drop policy if exists antes de create. Rodar 2x é seguro.

begin;

-- ============================================================
-- 1) Helper: promoter_ids do TIME do usuário logado
-- ============================================================
-- Espelha EXATAMENTE o padrão dos helpers Dia 3 (sql, security definer, stable,
-- search_path = public, auth). Retorna vazio para socio/funcionario/promotor.
create or replace function public.current_user_team_promoter_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  with me as (
    select id, role
      from public.app_users
     where auth_user_id = auth.uid()
     limit 1
  )
  -- supervisor: promotores diretamente sob ele (exclui chave master)
  select p.id
    from public.promoters p, me
   where me.role = 'supervisor'
     and p.supervisor_user_id = me.id
     and coalesce(p.is_master, false) = false
  union
  -- gerente_regional: promotores sob os supervisores que reportam a ele
  select p.id
    from public.promoters p, me
   where me.role = 'gerente_regional'
     and p.supervisor_user_id in (
           select s.id from public.app_users s where s.manager_user_id = me.id
         )
     and coalesce(p.is_master, false) = false
$$;

grant execute on function public.current_user_team_promoter_ids() to authenticated;

comment on function public.current_user_team_promoter_ids() is
  'F3: retorna os promoter_id do TIME do usuário logado. supervisor -> seus '
  'promotores; gerente_regional -> promotores dos seus supervisores. Exclui '
  'is_master. Vazio para socio/funcionario/promotor. security definer + '
  'search_path fixo (padrão Dia 3).';

-- ============================================================
-- 2) View mascarada: produção do time, SEM comissão/financeiro/PII
-- ============================================================
-- security_invoker = false => roda com direito do OWNER (bypassa a RLS da tabela
-- crua); o WHERE restringe ao time. As colunas sensíveis nem constam do SELECT.
create or replace view public.vw_team_production
  with (security_invoker = false)
as
select
  id,
  company_id,
  assigned_promoter_id,
  promoter_id,
  original_promoter_id,
  proposal_number,
  contract_number,
  product_code,
  product_description,
  convenio_code,
  convenio_type,
  convenio_segment,
  gross_value,
  net_value,
  has_insurance,
  insurance_value,
  insurance_net_value,
  insurance_type,
  insurance_slip_eligible,
  interest_rate,
  term_months,
  installments,
  status,
  proposal_date,
  movement_date,
  contract_date,
  cancellation_date,
  is_srcc_restricted
from public.daily_production_records
where assigned_promoter_id in (select public.current_user_team_promoter_ids())
   or promoter_id          in (select public.current_user_team_promoter_ids());

revoke all on public.vw_team_production from public;
grant select on public.vw_team_production to authenticated;

comment on view public.vw_team_production is
  'F3: produção (daily_production_records) do TIME do gestor logado, com colunas '
  'de comissão/financeiro/PII FISICAMENTE omitidas. security_invoker=false '
  '(direito do owner) + WHERE por current_user_team_promoter_ids(). Gestor NÃO '
  'tem policy na tabela crua — lê só por aqui.';

-- ============================================================
-- 3) Policy de SELECT em monthly_targets para os roles de gestão
-- ============================================================
-- PERMISSIVE (OR com as demais): supervisor/gerente_regional leem só as metas
-- dos promotores do seu time. Mesmo mecanismo current_app_user_role() (Dia 3).
drop policy if exists "monthly_targets_gestor_select" on public.monthly_targets;
create policy "monthly_targets_gestor_select"
on public.monthly_targets for select to authenticated
using (
  public.current_app_user_role() in ('supervisor', 'gerente_regional')
  and promoter_id in (select public.current_user_team_promoter_ids())
);

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) helper existe e é security definer + stable:
--   select proname, prosecdef as security_definer, provolatile as volatile
--     from pg_proc
--    where proname = 'current_user_team_promoter_ids';
--   -- esperado: 1 linha; security_definer = t; volatile = s (stable).
--
--   -- (b1) a view NÃO contém NENHUMA coluna sensível (deve devolver 0 linhas):
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'vw_team_production'
--      and column_name in (
--        'promoter_commission_percent','promoter_commission_amount',
--        'insurance_commission_percent','insurance_commission_amount',
--        'commission_rule_source','company_received_percent',
--        'customer_name','raw_payload','daily_import_id','j_key','promoter_source'
--      );
--   -- esperado: 0 linhas.
--   -- (b2) a view tem exatamente 28 colunas de produção:
--   select count(*) as colunas
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'vw_team_production';
--   -- esperado: 28.
--
--   -- (c) a policy de monthly_targets foi criada (SELECT):
--   select policyname, cmd
--     from pg_policies
--    where schemaname = 'public' and tablename = 'monthly_targets'
--      and policyname = 'monthly_targets_gestor_select';
--   -- esperado: 1 linha; cmd = SELECT.
--
--   -- (d) NENHUMA tabela de comissão/financeiro (nem a crua) tem policy que
--   --     mencione os roles de gestão ou o helper de time (deve devolver 0):
--   select tablename, policyname
--     from pg_policies
--    where schemaname = 'public'
--      and tablename in (
--        'daily_production_records','commission_tables','commission_table_rows',
--        'promoter_proposal_commissions','promoter_product_commissions',
--        'promoter_agreements','financial_expenses','monthly_closing_entries'
--      )
--      and (qual ilike '%supervisor%'
--        or qual ilike '%gerente_regional%'
--        or qual ilike '%current_user_team_promoter_ids%');
--   -- esperado: 0 linhas.
