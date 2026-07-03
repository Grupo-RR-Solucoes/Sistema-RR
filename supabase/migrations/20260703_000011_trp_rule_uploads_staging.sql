-- Migration: TRP self-service — Fase 6b.3 (staging de rascunhos)  (2026-07-03)
--
-- Objetivo: tabela de STAGING para o fluxo delegado. O funcionário (ou o sócio)
-- salva aqui um RASCUNHO REVISADO da TRP (regra_draft + confiança + metadados),
-- status 'pendente'. O sócio abre o pendente, revisa e CONFIRMA → /api/trp/commit
-- grava a versão viva em trp_rule_versions e marca o rascunho 'confirmado'.
--
-- INVARIANTE (crítico): esta tabela é RASCUNHO. NUNCA é fonte do motor. A ÚNICA
-- tabela viva (fonte do cálculo) é trp_rule_versions, escrita SÓ por
-- /api/trp/commit (socio-only). O funcionário escreve AQUI e só aqui.
--
-- RLS default-deny (igual à F1): nenhuma policy → authenticated/anon não lê/
-- escreve; só service_role (rotas com guard no servidor) acessa.
--
-- Puramente aditiva, transacional, idempotente (IF NOT EXISTS). Rodar 2x é seguro.
-- STATUS: NÃO EXECUTADA. Aguardando validação do sócio antes de rodar no Studio.

begin;

create table if not exists trp_rule_uploads (
  id                   uuid primary key default gen_random_uuid(),
  competencia          date not null,              -- 1º dia do mês nominal (ex.: '2026-07-01')
  regime               text not null,              -- 'VOLUME_5_FAIXAS'
  regra_draft          jsonb not null,             -- RegraMes DRAFT revisado (MESMO shape de regra_json)
  confianca            jsonb,                       -- snapshot { provado, conferir } da revisão (auditoria)
  trp_doc_ref          text,                        -- 'TRP Nº 2026/201' (se lido/informado)
  source_filename      text,
  source_sha256        text,                        -- hash do PDF (rastreabilidade / dedupe)
  parser_version       text,
  status               text not null default 'pendente'
                         check (status in ('pendente','confirmado','descartado')),
  uploaded_by          uuid references app_users(id),   -- quem PREPAROU (funcionário ou sócio)
  uploaded_at          timestamptz not null default now(),
  reviewed_by          uuid references app_users(id),   -- SÓCIO que confirmou/descartou
  reviewed_at          timestamptz,
  committed_version_id uuid references trp_rule_versions(id) on delete set null, -- versão gerada no confirmar
  notes                text
);

-- RLS default-deny: nenhuma policy. service_role ignora RLS; ninguém mais entra.
alter table trp_rule_uploads enable row level security;

-- No máximo 1 rascunho PENDENTE por competência (inbox limpo; re-upload substitui
-- o pendente via upsert). Confirmado/descartado não contam → histórico acumula.
create unique index if not exists uq_trp_rule_uploads_pendente
  on trp_rule_uploads (competencia)
  where status = 'pendente';

-- Inbox do sócio: pendentes por competência.
create index if not exists idx_trp_rule_uploads_status
  on trp_rule_uploads (status, competencia);

comment on table trp_rule_uploads is
  'TRP self-service (F6b.3): STAGING de rascunhos revisados. NÃO é fonte do motor. '
  'Fluxo delegado: funcionário/sócio salva rascunho pendente; sócio confirma via '
  '/api/trp/commit → grava trp_rule_versions e marca confirmado. RLS default-deny.';
comment on column trp_rule_uploads.regra_draft is
  'RegraMes DRAFT revisado — mesmo shape de trp_rule_versions.regra_json. Revalidado '
  'no commit (defesa em profundidade) antes de virar versão viva.';
comment on column trp_rule_uploads.committed_version_id is
  'Versão (trp_rule_versions) gerada quando este rascunho foi confirmado. Liga '
  'preparador (uploaded_by) → confirmador (reviewed_by=sócio) → versão viva.';

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   select count(*) from trp_rule_uploads;   -- esperado: 0
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='trp_rule_uploads'
--    order by ordinal_position;
--
--   -- índice parcial "1 pendente por competência":
--   select indexname, indexdef from pg_indexes
--    where schemaname='public' and indexname='uq_trp_rule_uploads_pendente';
--
--   -- Prova funcional (deve FALHAR no 2º pendente da mesma competência):
--   -- begin;
--   --   insert into trp_rule_uploads (competencia, regime, regra_draft)
--   --     values (date '2026-07-01','VOLUME_5_FAIXAS','{}'::jsonb);
--   --   insert into trp_rule_uploads (competencia, regime, regra_draft)
--   --     values (date '2026-07-01','VOLUME_5_FAIXAS','{}'::jsonb);
--   -- rollback;  -- esperado: ERROR duplicate key ... uq_trp_rule_uploads_pendente
