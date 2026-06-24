-- ============================================================
-- convenio_segmento — FONTE DE VERDADE do segmento (público/privado) e da
-- categoria TRP por convênio. Religa a auditoria à vista: quando o convênio
-- NÃO está aqui e o roteamento depende de público/privado, o contrato vai para
-- "SEGMENTO_DESCONHECIDO" (a confirmar, FORA da cobrança) — nunca chute público.
--
-- Seed (script scripts/seed-convenio-segmento.cjs, idempotente):
--   - daily_production_records.convenio_segment (verdade do banco): seg 1 =
--     CONSIG_PUBLICO, seg 2 = CONSIG_PRIVADO. fonte='daily'.
--   - convenios_oficiais.json (TRP23): INSS 1640, MPDG 1078, EXERCITO 14661,
--     SP/MG. fonte='convenios_oficiais'.  (SP_MG_CONVENIOS do motor = mesma lista.)
--
-- convenio_code: APENAS dígitos, sem zeros à esquerda (ex.: '1640'). A diária
-- traz '000001640'; o seed e a auditoria normalizam igual.
--
-- NÃO APLICAR automaticamente — Diego roda no Studio. Idempotente
-- (create ... if not exists). RLS socio-only (mesmo padrão de
-- prt_inadimplencia_monitor / cobranca_itens).
-- ============================================================

create table if not exists public.convenio_segmento (
  convenio_code  text primary key,           -- só dígitos, sem zeros à esquerda
  categoria_trp  text not null,
  segmento       text,                        -- PUBLICO | PRIVADO | null (n/a)
  fonte          text not null,
  confirmado     boolean not null default false,
  confirmado_em  date,
  updated_at     timestamptz not null default now(),
  constraint convenio_segmento_categoria_chk check (categoria_trp in (
    'INSS','MPDG','SP_MG','EXERCITO','CONSIG_PUBLICO','CONSIG_PRIVADO','FGTS','NAO_CONSIGNADO'
  )),
  constraint convenio_segmento_segmento_chk check (segmento is null or segmento in ('PUBLICO','PRIVADO')),
  constraint convenio_segmento_fonte_chk check (fonte in (
    'daily','convenios_oficiais','sp_mg_set','manual'
  ))
);

create index if not exists idx_convenio_segmento_categoria
  on public.convenio_segmento (categoria_trp);

-- ============================================================
-- RLS — socio-only (mesmo padrão de prt_inadimplencia_monitor / cobranca_itens).
-- funcionario e promotor BLOQUEADOS (sem policy). A auditoria lê via service
-- role (getSupabaseAdmin), que ignora RLS.
-- ============================================================
alter table public.convenio_segmento enable row level security;
grant select, insert, update, delete
  on public.convenio_segmento to authenticated;
drop policy if exists "convenio_segmento_socio_all"
  on public.convenio_segmento;
create policy "convenio_segmento_socio_all"
on public.convenio_segmento for all to authenticated
using      (public.current_app_user_role() = 'socio')
with check (public.current_app_user_role() = 'socio');

-- Conferência (após rodar a migration): tabela existe e vazia.
--   select count(*) as linhas from public.convenio_segmento;   -- 0 (seed à parte)
