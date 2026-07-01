-- Migration: TRP self-service — Fase 1 (2026-07-01)
--
-- Objetivo (F1, SÓ ESTRUTURA): criar a tabela versionada que passará a ser a
-- FONTE das regras de crédito da TRP por competência (alimentada pela tela de
-- upload nas fases seguintes), e ligar a trp_credit_rules existente a ela como
-- espelho achatado por versão.
--
-- ZERO mudança de comportamento nesta fase:
--   - As tabelas nascem VAZIAS.
--   - O motor CONTINUA lendo os JSON estáticos (MAPA_MES_REGRA / regrasData.ts).
--   - Nada passa a ler do banco ainda — o resolvedor é a Fase 2; o flip da
--     fonte só depois do gate de paridade (Fase 3).
--
-- Decisões fechadas (desenho A–G aprovado):
--   - Fonte do motor = trp_rule_versions.regra_json (JSONB do RegraMes canônico,
--     MESMO shape do JSON de hoje → lookupPctInRegra intacto → paridade trivial).
--   - trp_credit_rules (hoje vestigial) vira ESPELHO ACHATADO por versão (SQL/
--     auditoria/diff da tela). NÃO é fonte do cálculo.
--   - Versionamento: novo upload da mesma competência = nova versão ativa; a
--     anterior fica is_active=false (rastreabilidade). Índice parcial único
--     garante 1 versão ATIVA por competência.
--   - Vigência (valid_from/valid_until) é calculada holiday-aware na aplicação
--     (Fase 2, reusando productionBusinessWindow de projecaoMetas — calendário
--     bancário NACIONAL). Aqui são só colunas.
--
-- Segurança / idempotência: PURAMENTE ADITIVA (tabela nova + coluna nova nullable);
-- transacional; create table/index IF NOT EXISTS; add column IF NOT EXISTS.
-- Rodar 2x é seguro.

begin;

-- ============================================================
-- 1) trp_rule_versions — uma linha por VERSÃO de TRP subida
-- ============================================================
create table if not exists trp_rule_versions (
  id              uuid primary key default gen_random_uuid(),
  competencia     date not null,               -- 1o dia do mês nominal (ex.: '2026-07-01')
  regime          text not null,               -- 'VOLUME_5_FAIXAS' etc (de getRegime)
  valid_from      date not null,               -- último dia útil do mês anterior (holiday-aware)
  valid_until     date not null,               -- penúltimo dia útil do mês nominal (holiday-aware)
  version_no      integer not null,            -- 1,2,3... por competência (sobrescrita)
  is_active       boolean not null default true,
  regra_json      jsonb not null,              -- RegraMes canônico COMPLETO (== o JSON de hoje)
  trp_doc_ref     text,                        -- 'TRP Nº 2026/201'
  source_filename text,                        -- 'TRP38 - PROMOTIVA 072026.pdf'
  source_sha256   text,                        -- hash do PDF (rastreabilidade / dedupe)
  parser_version  text,                        -- versão do parser que extraiu
  uploaded_by     uuid references app_users(id),
  uploaded_at     timestamptz not null default now(),
  notes           text,
  constraint uq_trp_rule_versions_comp_ver unique (competencia, version_no)
);

-- RLS: default-deny nesta fase. Nenhuma policy => authenticated não lê/escreve;
-- service_role (motor/admin) ignora RLS. Policies de leitura para admin
-- (socio/funcionario) entram na fase da tela (F6). Idempotente: habilitar RLS
-- já habilitado é no-op (produção já está com RLS via botão do Studio).
alter table trp_rule_versions enable row level security;

-- Só UMA versão ATIVA por competência (a mais recente confirmada).
create unique index if not exists uq_trp_rule_versions_active
  on trp_rule_versions (competencia)
  where is_active;

-- Lookup do resolvedor (Fase 2): por competência + ativa.
create index if not exists idx_trp_rule_versions_comp
  on trp_rule_versions (competencia, is_active);

comment on table trp_rule_versions is
  'TRP self-service (F1): fonte versionada das regras de crédito por competência. '
  'regra_json = RegraMes canônico (mesmo shape dos JSON estáticos). 1 versão ativa '
  'por competência (uq_trp_rule_versions_active). Motor passa a ler daqui na F4 '
  '(após gate de paridade); nesta fase nasce vazia e nada consome.';
comment on column trp_rule_versions.regra_json is
  'RegraMes completo (_meta + produtos/faixas/células). Fonte do motor a partir da F4.';
comment on column trp_rule_versions.valid_from is
  'Último dia útil do mês anterior (calendário bancário nacional, holiday-aware). Calculado na app (F2).';
comment on column trp_rule_versions.valid_until is
  'Penúltimo dia útil do mês nominal (holiday-aware). Calculado na app (F2).';

-- ============================================================
-- 2) trp_credit_rules — passa a ser ESPELHO ACHATADO por versão
-- ============================================================
-- Liga cada linha achatada à versão que a gerou. Nullable/aditiva: as linhas
-- existentes (se houver) ficam com version_id NULL até re-seed pela F2+.
alter table trp_credit_rules
  add column if not exists version_id uuid references trp_rule_versions(id) on delete cascade;

create index if not exists idx_trp_credit_rules_version
  on trp_credit_rules (version_id);

comment on column trp_credit_rules.version_id is
  'TRP self-service (F1): versão (trp_rule_versions) que gerou esta linha achatada. '
  'trp_credit_rules é espelho SQL/auditoria, NÃO fonte do cálculo (fonte = regra_json).';

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) a tabela trp_rule_versions existe e está VAZIA:
--   select count(*) as linhas from trp_rule_versions;   -- esperado: 0
--
--   -- (b) colunas de trp_rule_versions (15 colunas, tipos esperados):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'trp_rule_versions'
--    order by ordinal_position;
--   -- esperado: id/uuid, competencia/date, regime/text, valid_from/date,
--   --           valid_until/date, version_no/integer, is_active/boolean,
--   --           regra_json/jsonb, trp_doc_ref/text, source_filename/text,
--   --           source_sha256/text, parser_version/text, uploaded_by/uuid,
--   --           uploaded_at/timestamptz, notes/text.
--
--   -- (c) índice parcial ÚNICO de "1 versão ativa por competência":
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public' and indexname = 'uq_trp_rule_versions_active';
--   -- esperado: 1 linha; indexdef contém UNIQUE ... (competencia) WHERE is_active.
--   -- Prova funcional (deve FALHAR na 2a linha ativa — rode em begin/rollback):
--   -- begin;
--   --   insert into trp_rule_versions (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--   --     values (date '2026-06-01','VOLUME_5_FAIXAS', date '2026-05-29', date '2026-06-29', 1, true, '{}'::jsonb);
--   --   insert into trp_rule_versions (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--   --     values (date '2026-06-01','VOLUME_5_FAIXAS', date '2026-05-29', date '2026-06-29', 2, true, '{}'::jsonb);
--   -- rollback;  -- esperado: ERROR duplicate key value violates unique constraint "uq_trp_rule_versions_active"
--
--   -- (d) coluna version_id em trp_credit_rules (FK p/ trp_rule_versions):
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'trp_credit_rules'
--      and column_name = 'version_id';
--   -- esperado: version_id / uuid / YES (nullable).
