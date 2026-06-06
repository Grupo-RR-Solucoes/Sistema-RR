-- ============================================================
-- Etapa 8 — COBRANÇAS EMITIDAS (fonte da verdade do "já cobrado")
-- Trava anti-dupla-cobrança da auditoria Promotiva. socio-only.
--
-- 2 tabelas:
--   cobrancas_emitidas  -> header, 1 linha por cobrança enviada. Valores "como
--                          emitidos" (imutáveis — não derivados do v9).
--   cobranca_itens      -> 1 contrato curado por linha = vínculo aos sol_reg das
--                          audit_v9_*. Trava UNIQUE GLOBAL (tipo, contract_number):
--                          um contrato NUNCA entra em duas cobranças.
--
-- Exclusão da auditoria (futuro): recuperável_novo = curado v9 (sol_reg>0) que
-- NOT EXISTS em cobranca_itens, POR CONTRATO. Já-cobrado = cobranca_itens
-- (informativo, nunca somado ao a recuperar).
--
-- Âncora retroativa (populada à parte, após esta migration):
--   e-mail 07/05/2026 — à vista 60.040,89 (dez/22→abr/26) + PRT 47.581,88
--   (dez/22→mar/26) = total 107.622,76.
-- ============================================================

-- ---------- header ----------
create table if not exists public.cobrancas_emitidas (
  id uuid primary key default gen_random_uuid(),
  emitida_em date not null,
  descricao text,
  competencia_de text not null,                 -- YYYY-MM (informativo)
  competencia_ate text not null,                -- YYYY-MM (informativo)
  valor_avista numeric(14,2) not null default 0,
  valor_prt numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null,           -- "como emitido" (pode diferir 1 centavo
                                                -- da soma das metades por round-then-sum)
  referencia text,
  status text not null default 'EMITIDA'
    check (status in ('EMITIDA','PAGA','CANCELADA')),
  observacao text,
  created_at timestamptz not null default now()
);

-- ---------- itens (vínculo + trava) ----------
create table if not exists public.cobranca_itens (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null
    references public.cobrancas_emitidas(id) on delete cascade,
  tipo text not null check (tipo in ('AVISTA','PRT')),
  contract_number text not null,                -- audit_v9_*.contract_number
  competencia text not null,                    -- YYYY-MM do contrato (mes / mes_origem)
  empresa text,
  valor numeric(14,2) not null,                 -- snapshot do valor_solicitacao_regularizacao
  created_at timestamptz not null default now(),
  -- não duplica contrato dentro da mesma cobrança:
  constraint cobranca_itens_unq_por_cobranca unique (cobranca_id, tipo, contract_number),
  -- TRAVA forte anti-dupla-cobrança: um contrato (por camada) só pode existir em UMA cobrança:
  constraint cobranca_itens_unq_global unique (tipo, contract_number)
);

-- índice para o JOIN/lookup do header (a unique global já indexa tipo+contract_number)
create index if not exists cobranca_itens_cobranca_idx
  on public.cobranca_itens(cobranca_id);

-- ============================================================
-- RLS — socio-only (mesmo padrão de fechamento_mensal_empresa / Dia 3 grupo F)
-- ============================================================
alter table public.cobrancas_emitidas enable row level security;
grant select, insert, update, delete on public.cobrancas_emitidas to authenticated;
drop policy if exists "cobrancas_emitidas_socio_all" on public.cobrancas_emitidas;
create policy "cobrancas_emitidas_socio_all"
on public.cobrancas_emitidas for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

alter table public.cobranca_itens enable row level security;
grant select, insert, update, delete on public.cobranca_itens to authenticated;
drop policy if exists "cobranca_itens_socio_all" on public.cobranca_itens;
create policy "cobranca_itens_socio_all"
on public.cobranca_itens for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');
-- funcionario e promotor BLOQUEADOS (sem policy)
