-- Migration: Auditoria ADS/BBTS — 1A (staging de rascunhos da régua BBTS)  (2026-07-12)
--
-- Espelho de trp_rule_uploads (20260703_000011). Tabela de STAGING do fluxo
-- delegado: o funcionário (ou o sócio) sobe o PDF da tabela BBTS, revisa e salva
-- um RASCUNHO (status 'pendente'); o SÓCIO abre o pendente, confere e CONFIRMA →
-- /api/bbts/commit grava a versão viva em bbts_rule_versions (via
-- bbts_commit_version) e marca o rascunho 'confirmado'.
--
-- INVARIANTE (crítico): esta tabela é RASCUNHO. NUNCA é fonte de cálculo. A única
-- tabela viva é bbts_rule_versions, escrita SÓ por /api/bbts/commit (socio-only).
--
-- RLS default-deny: nenhuma policy → authenticated/anon não leem nem escrevem; só
-- service_role (rotas com guard no servidor).
--
-- Aditiva, transacional, idempotente (IF NOT EXISTS). Rodar 2x é seguro.
-- STATUS: NÃO EXECUTADA. Rodar no Studio antes de usar o botão "Salvar rascunho"
-- (o caminho "Confirmar e gravar" do sócio NÃO depende desta tabela).

begin;

create table if not exists bbts_rule_uploads (
  id                   uuid primary key default gen_random_uuid(),
  competencia          date not null,              -- 1o dia do mês nominal ('2026-07-01')
  shape_version        text not null default 'BBTS_V1',
  regra_draft          jsonb not null,             -- RegraBbts DRAFT (mesmo shape de regra_json)
  confianca            jsonb,                      -- { provado, conferir } da revisão (auditoria)
  doc_ref              text,
  source_filename      text,
  source_sha256        text,                       -- hash do PDF (rastreabilidade / dedupe)
  parser_version       text,
  status               text not null default 'pendente'
                         check (status in ('pendente','confirmado','descartado')),
  uploaded_by          uuid references app_users(id),   -- quem PREPAROU
  uploaded_at          timestamptz not null default now(),
  reviewed_by          uuid references app_users(id),   -- SÓCIO que confirmou/descartou
  reviewed_at          timestamptz,
  committed_version_id uuid references bbts_rule_versions(id) on delete set null,
  notes                text
);

alter table bbts_rule_uploads enable row level security;   -- default-deny: sem policy

-- No máximo 1 rascunho PENDENTE por competência (inbox limpo; re-upload substitui).
create unique index if not exists uq_bbts_rule_uploads_pendente
  on bbts_rule_uploads (competencia)
  where status = 'pendente';

-- Inbox do sócio: pendentes por competência.
create index if not exists idx_bbts_rule_uploads_status
  on bbts_rule_uploads (status, competencia);

comment on table bbts_rule_uploads is
  'Auditoria ADS/BBTS (1A): STAGING de rascunhos da regua BBTS. NAO e fonte de '
  'calculo. Funcionario/socio salva rascunho pendente; socio confirma via '
  '/api/bbts/commit -> grava bbts_rule_versions. RLS default-deny.';

commit;

-- ============================================================
-- Verificação pós-execução
-- ============================================================
--   select count(*) from bbts_rule_uploads;   -- esperado: 0
--   select indexname, indexdef from pg_indexes
--    where schemaname='public' and indexname='uq_bbts_rule_uploads_pendente';
--   select relrowsecurity from pg_class where relname='bbts_rule_uploads';   -- true
--   select count(*) from pg_policies where tablename='bbts_rule_uploads';    -- 0
