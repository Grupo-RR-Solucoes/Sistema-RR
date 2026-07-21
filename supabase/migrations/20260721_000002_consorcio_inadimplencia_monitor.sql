-- FRENTE DE PRODUTO — Movimento 2b: MONITOR de inadimplencia do CONSORCIO.
--
-- Espelho do prt_inadimplencia_monitor. A "auditoria forte" do Diego: a cada
-- fechamento compara as parcelas RECEBIDAS (desdobradas pelo M1) contra as
-- ESPERADAS (carteira_consorcio). Se uma proposta ativa deveria ter a proxima
-- parcela e ela NAO veio -> acusa PARCELA_NAO_VEIO com o valor previsto pela TRP 210.
--
-- Grao POR-PARCELA: 1 linha por (competencia, proposta, posicao) — o fato detectado
-- (a posicao que faltou naquele mes) e imutavel; o ciclo de vida
-- (status_acompanhamento) e mutavel; a resolucao manual (resolucao_status) e BLINDADA:
-- o motor faz UPSERT listando SO as colunas do fato + acompanhamento, entao nunca
-- toca resolucao_status/por/em (mesma blindagem estrutural da Fatia B do PRT).
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

create table if not exists public.consorcio_inadimplencia_monitor (
  id uuid primary key default gen_random_uuid(),

  -- identidade do snapshot (grao por-parcela)
  competencia text not null,                  -- YYYY-MM: mes da auditoria que detectou
  proposta    text not null,
  posicao     integer not null,               -- a parcela ESPERADA que nao veio
  company_id  uuid references public.companies(id),

  -- fato detectado (imutavel)
  status text not null
    check (status in ('PARCELA_NAO_VEIO_SUSPEITO', 'PARCELA_NAO_VEIO_QUITACAO')),
  segmento_grupo   text,
  teto_parcelas    integer not null default 0,
  posicao_recebida_max integer not null default 0, -- ultima posicao efetivamente recebida
  ultimo_mes_recebido  text,                        -- YYYY-MM da posicao_recebida_max
  cauda_restante   integer not null default 0,      -- posicoes esperadas ainda faltando
  valor_previsto   numeric(14,2) not null default 0,-- comissao_esperada da posicao que faltou
  recuperavel_estimado numeric(14,2) not null default 0, -- Sigma esperado da cauda

  -- ciclo de vida (mutavel)
  primeira_deteccao text not null,            -- YYYY-MM: 1a competencia em que entrou
  status_acompanhamento text not null default 'NOVO'
    check (status_acompanhamento in
      ('NOVO', 'EM_COBRANCA', 'RECUPERADO', 'RESSURGIU', 'BAIXADO')),
  observacao text,

  detectado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- resolucao MANUAL blindada (o motor nunca sobrescreve estas 3)
  resolucao_status text not null default 'PENDENTE'
    check (resolucao_status in ('PENDENTE', 'SOLUCIONADO')),
  resolucao_por text,
  resolucao_em  timestamptz,

  -- idempotencia: re-rodar a competencia nao duplica
  constraint consorcio_inadimplencia_monitor_unq
    unique (competencia, proposta, posicao)
);

-- timeline de uma proposta:
create index if not exists consorcio_inadimplencia_monitor_prop_idx
  on public.consorcio_inadimplencia_monitor (proposta);
-- fila de acompanhamento:
create index if not exists consorcio_inadimplencia_monitor_acomp_idx
  on public.consorcio_inadimplencia_monitor (status_acompanhamento)
  where status_acompanhamento in ('NOVO', 'EM_COBRANCA');
-- snapshot de um mes / aba solucionados:
create index if not exists consorcio_inadimplencia_monitor_comp_idx
  on public.consorcio_inadimplencia_monitor (competencia, resolucao_status);

-- RLS — socio-only (mesmo padrao do prt_inadimplencia_monitor).
alter table public.consorcio_inadimplencia_monitor enable row level security;
grant select, insert, update, delete
  on public.consorcio_inadimplencia_monitor to authenticated;
drop policy if exists "consorcio_inadimplencia_monitor_socio_all"
  on public.consorcio_inadimplencia_monitor;
create policy "consorcio_inadimplencia_monitor_socio_all"
on public.consorcio_inadimplencia_monitor for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');
