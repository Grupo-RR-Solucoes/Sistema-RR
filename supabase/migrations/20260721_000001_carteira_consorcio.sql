-- FRENTE DE PRODUTO — Movimento 2b: CARTEIRA do consorcio (diferido).
--
-- Espelha a ANATOMIA da carteira PRT (carteira_contrato), mas com grao POR-PARCELA:
-- 1 linha por (company_id, proposta, posicao). O consorcio difere do PRT porque:
--   - o teto de parcelas NAO vem no dado; vem da TRP 2026/210 (Geral=6, Imovel=10);
--   - a comissao e EM DEGRAU (a 6a parcela do Geral cai de %); e
--   - a atribuicao do promotor e POR PROPOSTA e herda para todas as parcelas.
--
-- A carteira e MATERIALIZADA por lib/consorcio/carteira.ts (materializarCarteiraConsorcio),
-- nao por funcao SQL: a projecao precisa do back-out da classificacao pelo % observado
-- cruzado com a Tabela 1 da TRP 210 — logica que mora no TypeScript (regua versionada).
-- Rebuild total (delete-all + insert) a cada fechamento, re-juntando o promotor pela
-- fila (product_line_assignments, ancora por proposta) — a verdade do promotor fica na
-- fila; a carteira e derivada.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

create table if not exists public.carteira_consorcio (
  id uuid primary key default gen_random_uuid(),

  -- identidade (grao por-parcela)
  company_id uuid references public.companies(id),
  proposta   text not null,
  posicao    integer not null,               -- 1..teto (a parcela esperada)

  -- caracteristicas do bem/proposta (da 1a aparicao)
  segmento_codigo text,                       -- codigo cru (MO/AI/DEMAIS/...)
  segmento_grupo  text not null default 'GERAL'
    check (segmento_grupo in ('GERAL', 'IMOVEL')),
  teto_parcelas   integer not null,           -- 6 (Geral) | 10 (Imovel)
  valor_bem       numeric(18,2) not null default 0,
  classificacao   text,                       -- back-out do %; null quando nao casou
  alerta_pct      boolean not null default false, -- % observado sem linha na TRP 210

  -- projecao vs realizado
  pct_comissao_ref     numeric(10,6) not null default 0, -- % usado na projecao desta posicao
  comissao_esperada    numeric(18,2) not null default 0, -- valor_bem * pct (projetado)
  comissao_recebida    numeric(18,2),                    -- valor real quando a parcela chega
  competencia_recebida text,                             -- YYYY-MM em que foi recebida

  status text not null default 'ESPERADA'
    check (status in ('ESPERADA', 'RECEBIDA', 'NAO_VEIO', 'ENCERRADA')),

  -- promotor DESNORMALIZADO (verdade fica na fila product_line_assignments)
  promoter_id uuid references public.promoters(id),

  primeira_competencia text,                  -- YYYY-MM da 1a aparicao da proposta
  origem_import_id uuid references public.monthly_closing_imports(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- idempotencia: rebuild nao duplica parcela.
  unique (company_id, proposta, posicao)
);

create index if not exists carteira_consorcio_proposta_idx
  on public.carteira_consorcio (company_id, proposta);
create index if not exists carteira_consorcio_status_idx
  on public.carteira_consorcio (status);
create index if not exists carteira_consorcio_promoter_idx
  on public.carteira_consorcio (promoter_id);

-- RLS — socio/funcionario leem a carteira (operacional). Promotor NAO ve (a
-- comissao dos outros nao pode vazar; a carteira propria vem por outra rota).
alter table public.carteira_consorcio enable row level security;
grant select, insert, update, delete on public.carteira_consorcio to authenticated;

drop policy if exists "carteira_consorcio_socio_all" on public.carteira_consorcio;
create policy "carteira_consorcio_socio_all" on public.carteira_consorcio for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "carteira_consorcio_funcionario_all" on public.carteira_consorcio;
create policy "carteira_consorcio_funcionario_all" on public.carteira_consorcio for all to authenticated
using (public.current_app_user_role() = 'funcionario') with check (public.current_app_user_role() = 'funcionario');
