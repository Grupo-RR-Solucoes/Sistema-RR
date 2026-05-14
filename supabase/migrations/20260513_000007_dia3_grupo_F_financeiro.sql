-- Migration: Dia 3 — Grupo F (Financeiro restrito): 5 tabelas
--
-- Tabelas (todas sem RLS hoje):
--   financial_expenses, cash_opening_balances, recebimento_mensal,
--   diferido_parcelas, fechamento_mensal_empresa
--
-- Matriz de permissoes:
--   financial_expenses          socio ALL | func SELECT+INSERT+UPDATE | promotor BLOQUEADO
--     (D3: funcionario lanca despesas; NAO deleta — DELETE so socio)
--   cash_opening_balances       socio ALL | func BLOQUEADO            | promotor BLOQUEADO
--     (D2: fluxo caixa stricto)
--   recebimento_mensal          socio ALL | func BLOQUEADO            | promotor BLOQUEADO
--     (RECOMENDACAO: bloqueado — entrada de caixa empresa, mesmo padrao
--      de fechamento_mensal_empresa. Pode ser revertido para SELECT se
--      Diego decidir incluir funcionario na conciliacao.)
--   diferido_parcelas           socio ALL | func ALL                  | promotor BLOQUEADO
--     (RECOMENDACAO: ALL — forecast operacional analogo a
--      monthly_expected_closings. Funcionario ajusta cronograma.)
--   fechamento_mensal_empresa   socio ALL | func BLOQUEADO            | promotor BLOQUEADO
--     (D2: consolidacao por CNPJ/mes = fluxo caixa)
--
-- IMPLEMENTACAO "funcionario NAO deleta financial_expenses":
--   Postgres nao permite GRANT DELETE a sub-grupo de authenticated.
--   Solucao: GRANT amplo + AUSENCIA de policy financial_expenses_funcionario_delete.
--   - sócio  : FOR ALL inclui DELETE -> permitido
--   - func   : sem policy DELETE -> RLS bloqueia (mesmo com GRANT presente)
--   Padrao oficial Supabase para este caso.
--
-- IDEMPOTENCIA: DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- ============================================================
-- financial_expenses  (D3)
-- ============================================================
alter table public.financial_expenses enable row level security;
grant select on public.financial_expenses to authenticated;
grant insert on public.financial_expenses to authenticated;
grant update on public.financial_expenses to authenticated;
grant delete on public.financial_expenses to authenticated;

drop policy if exists "financial_expenses_socio_all" on public.financial_expenses;
create policy "financial_expenses_socio_all"
on public.financial_expenses for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario LE todas (precisa conferir historico para nao duplicar)
drop policy if exists "financial_expenses_funcionario_select" on public.financial_expenses;
create policy "financial_expenses_funcionario_select"
on public.financial_expenses for select to authenticated
using (public.current_app_user_role() = 'funcionario');

-- funcionario LANCA despesa (D3: "lanca despesas")
drop policy if exists "financial_expenses_funcionario_insert" on public.financial_expenses;
create policy "financial_expenses_funcionario_insert"
on public.financial_expenses for insert to authenticated
with check (public.current_app_user_role() = 'funcionario');

-- funcionario AJUSTA despesa (corrigir valor, status, payment_date)
drop policy if exists "financial_expenses_funcionario_update" on public.financial_expenses;
create policy "financial_expenses_funcionario_update"
on public.financial_expenses for update to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- funcionario NAO DELETA: ausencia de policy financial_expenses_funcionario_delete.
-- DELETE de despesa eh evento auditavel e fica restrito ao socio (D3).

-- ============================================================
-- cash_opening_balances  (D2: funcionario BLOQUEADO)
-- ============================================================
alter table public.cash_opening_balances enable row level security;
grant select on public.cash_opening_balances to authenticated;
grant insert on public.cash_opening_balances to authenticated;
grant update on public.cash_opening_balances to authenticated;
grant delete on public.cash_opening_balances to authenticated;

drop policy if exists "cash_opening_balances_socio_all" on public.cash_opening_balances;
create policy "cash_opening_balances_socio_all"
on public.cash_opening_balances for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario e promotor BLOQUEADOS (sem policy)

-- ============================================================
-- recebimento_mensal
-- ============================================================
-- RECOMENDACAO: funcionario BLOQUEADO. Recebimento Promotiva = entrada de
-- caixa empresa, mesmo nivel sensivel de fechamento_mensal_empresa.
-- Se Diego decidir liberar funcionario, adicionar policy
-- recebimento_mensal_funcionario_select sem alterar restante.
alter table public.recebimento_mensal enable row level security;
grant select on public.recebimento_mensal to authenticated;
grant insert on public.recebimento_mensal to authenticated;
grant update on public.recebimento_mensal to authenticated;
grant delete on public.recebimento_mensal to authenticated;

drop policy if exists "recebimento_mensal_socio_all" on public.recebimento_mensal;
create policy "recebimento_mensal_socio_all"
on public.recebimento_mensal for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- ============================================================
-- diferido_parcelas
-- ============================================================
-- RECOMENDACAO: funcionario ALL. Parcelas diferidas (PRT) = forecast
-- operacional analogo a monthly_expected_closings (Grupo C, funcionario ALL).
-- Funcionario precisa para acompanhar cronograma e ajustar parcelas pendentes.
alter table public.diferido_parcelas enable row level security;
grant select on public.diferido_parcelas to authenticated;
grant insert on public.diferido_parcelas to authenticated;
grant update on public.diferido_parcelas to authenticated;
grant delete on public.diferido_parcelas to authenticated;

drop policy if exists "diferido_parcelas_socio_all" on public.diferido_parcelas;
create policy "diferido_parcelas_socio_all"
on public.diferido_parcelas for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "diferido_parcelas_funcionario_all" on public.diferido_parcelas;
create policy "diferido_parcelas_funcionario_all"
on public.diferido_parcelas for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');

-- ============================================================
-- fechamento_mensal_empresa  (D2)
-- ============================================================
alter table public.fechamento_mensal_empresa enable row level security;
grant select on public.fechamento_mensal_empresa to authenticated;
grant insert on public.fechamento_mensal_empresa to authenticated;
grant update on public.fechamento_mensal_empresa to authenticated;
grant delete on public.fechamento_mensal_empresa to authenticated;

drop policy if exists "fechamento_mensal_empresa_socio_all" on public.fechamento_mensal_empresa;
create policy "fechamento_mensal_empresa_socio_all"
on public.fechamento_mensal_empresa for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- funcionario e promotor BLOQUEADOS (sem policy)
