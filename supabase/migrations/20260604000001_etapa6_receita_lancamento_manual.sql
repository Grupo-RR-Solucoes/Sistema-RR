-- ============================================================
-- ETAPA 6 — Lancamentos manuais de receita (por CNPJ/mes).
-- ------------------------------------------------------------
-- Receita DECLARADA p/ o RBT12 = receita do fechamento importado
-- + soma dos lancamentos manuais do mesmo CNPJ/mes. ADITIVO e rastreavel:
-- o manual NAO sobrescreve o fechamento. Varios lancamentos por CNPJ/mes
-- sao permitidos (somam todos).
--
-- Usos: consorcio recebido a parte (ja separado por CNPJ), ajustes do
-- contador, regularizacao historica (inclusive completar meses sem
-- fechamento, ex.: AL3 jun-ago/2025).
-- ============================================================

create table if not exists public.receita_lancamento_manual (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  ano integer not null,
  mes integer not null,
  categoria text not null check (categoria in ('CONSORCIO', 'AJUSTE_CONTADOR', 'OUTRO')),
  valor numeric(18,2) not null,
  descricao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists receita_lancamento_manual_comp_idx
  on public.receita_lancamento_manual (company_id, ano, mes);

-- ============================================================
-- RLS: socio/funcionario full; promotor SEM acesso (receita por CNPJ,
-- nao por promotor). Sem policy p/ promotor => RLS nega.
-- ============================================================
alter table public.receita_lancamento_manual enable row level security;
grant select on public.receita_lancamento_manual to authenticated;
grant insert on public.receita_lancamento_manual to authenticated;
grant update on public.receita_lancamento_manual to authenticated;
grant delete on public.receita_lancamento_manual to authenticated;

drop policy if exists "receita_lancamento_manual_socio_all" on public.receita_lancamento_manual;
create policy "receita_lancamento_manual_socio_all"
on public.receita_lancamento_manual for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

drop policy if exists "receita_lancamento_manual_funcionario_all" on public.receita_lancamento_manual;
create policy "receita_lancamento_manual_funcionario_all"
on public.receita_lancamento_manual for all to authenticated
using      (public.current_app_user_role() = 'funcionario')
with check (public.current_app_user_role() = 'funcionario');
