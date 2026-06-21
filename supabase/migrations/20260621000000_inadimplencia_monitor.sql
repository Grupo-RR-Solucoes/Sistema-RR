-- ============================================================
-- MONITOR DE INADIMPLÊNCIA PRT — snapshot mensal persistido.
-- Grava, por competência, os contratos PRT INTERROMPIDO/AUSENTE ainda não
-- cobrados (saída de buildInadimplenciaNovos, anti-dupla por tipo=PRT).
-- Dá rastro histórico: quem entrou quando, quem já foi cobrado, quem ressurgiu.
-- socio-only (mesmo padrão de cobranca_itens / fechamento_mensal_empresa).
--
-- Linha por (competencia, operation_number): o fato detectado é imutável por
-- mês (timeline + progressão do recuperável); os campos de ciclo de vida
-- (status_acompanhamento, ja_cobrado, cobranca_id) são mutáveis e atualizados
-- pelo reconciliador (persistInadimplenciaSnapshot). Aplicada manualmente no
-- Supabase Studio (banco não usa migrate automático).
-- ============================================================

create table if not exists public.prt_inadimplencia_monitor (
  id uuid primary key default gen_random_uuid(),

  -- identidade do snapshot
  competencia      text not null,                 -- YYYY-MM: mês da auditoria que detectou
  operation_number text not null,                 -- NRO OPERAÇÃO (= contract_number)
  company_cnpj     text,

  -- fato detectado (imutável) — "como estava" naquela competência
  status           text not null
    check (status in ('INTERROMPIDO_SUSPEITO','AUSENTE')),
  parcelas_pagas   integer not null default 0,
  parcelas_total   integer not null default 0,
  ultimo_mes_pago  text,                           -- YYYY-MM (null p/ AUSENTE)
  meses_parado     integer,                        -- competencia − ultimo_mes_pago (aging)
  recuperavel_estimado numeric(14,2) not null default 0,

  -- rastro de ciclo de vida (mutável)
  primeira_deteccao text not null,                -- YYYY-MM: 1ª competência em que entrou
  ja_cobrado        boolean not null default false,
  cobranca_id       uuid references public.cobrancas_emitidas(id) on delete set null,
  status_acompanhamento text not null default 'NOVO'
    check (status_acompanhamento in
      ('NOVO','EM_COBRANCA','RECUPERADO','RESSURGIU','BAIXADO')),
  observacao        text,

  detectado_em   timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  -- idempotência: re-rodar a competência não duplica
  constraint prt_inadimplencia_monitor_unq
    unique (competencia, operation_number)
);

-- timeline de um contrato ao longo das competências:
create index if not exists prt_inadimplencia_monitor_op_idx
  on public.prt_inadimplencia_monitor (operation_number);
-- "abertos" / fila de cobrança:
create index if not exists prt_inadimplencia_monitor_acomp_idx
  on public.prt_inadimplencia_monitor (status_acompanhamento)
  where status_acompanhamento in ('NOVO','EM_COBRANCA');
-- snapshot de um mês:
create index if not exists prt_inadimplencia_monitor_comp_idx
  on public.prt_inadimplencia_monitor (competencia);

-- ============================================================
-- RLS — socio-only (mesmo padrão de cobranca_itens / Dia 3 grupo F).
-- funcionario e promotor BLOQUEADOS (sem policy).
-- ============================================================
alter table public.prt_inadimplencia_monitor enable row level security;
grant select, insert, update, delete
  on public.prt_inadimplencia_monitor to authenticated;
drop policy if exists "prt_inadimplencia_monitor_socio_all"
  on public.prt_inadimplencia_monitor;
create policy "prt_inadimplencia_monitor_socio_all"
on public.prt_inadimplencia_monitor for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');
