-- Migration: Auditoria ADS/BBTS — Sub-etapa 1A (fundação da régua BBTS)  (2026-07-12)
--
-- Objetivo: criar a fonte VERSIONADA da tabela da BBTS — a "TRP da ADS". Espelho
-- estrutural de trp_rule_versions (20260701_000010) + trp_commit_version
-- (20260703_000012), com as diferenças que a tabela da BBTS exige.
--
-- ZERO mudança de comportamento nesta fase:
--   - A tabela nasce VAZIA. Nada lê dela ainda (não há resolver plugado).
--   - O dado entra pela TELA (upload do PDF da BBTS -> parser -> revisão ->
--     commit), na sub-etapa 1B. A auditoria ADS (devido x pago) é a 1C.
--   - Nenhum motor/consolidador muda: a comissão do PROMOTOR na ADS continua
--     saindo da TRP da Promotiva (lib/bbtsMonthly.ts). Esta régua responde outra
--     pergunta: o que a BBTS DEVIA ter pago à RR (caixa), vs o que pagou.
--
-- POR QUE NÃO REUSAR trp_rule_versions:
--   - Régua de OUTRO emissor (BBTS), com vigência/versionamento próprios; misturar
--     as duas numa tabela só exigiria discriminador de parceiro e contaminaria o
--     resolver/motor da TRP, que hoje assume "1 régua ativa por competência".
--   - O shape do regra_json é OUTRO (RegraBbts, ver abaixo): célula com percentual
--     BASE + ADICIONAL (convênios "Bonificado") e lookup ancorado no CÓDIGO DO
--     CONVÊNIO — coisas que o RegraMes da TRP não modela.
--
-- SHAPE regra_json (RegraBbts v1 — documentado aqui, validado na app):
--   {
--     "_meta": { "competencia": "2026-06", "vigencia_inicio": "...", "vigencia_fim": "...",
--                "doc_ref": "...", "faixas": ["Faixa 1".."Faixa 5"], "shape": "BBTS_V1" },
--     "convenios": { "1640": { "grupo": "DEMAIS_PUBLICOS", "nome": "INSS" }, ... },
--     "grupos": {
--       "DEMAIS_PUBLICOS": { "celulas": [
--          { "tx_min": 0.0164, "tx_max": 0.0167, "prazo_min": 48, "prazo_max": 60,
--            "faixas": { "Faixa 1": {"base": 0.0094},
--                        "Faixa 4": {"base": 0.0063, "adicional": 0.0035} } }
--       ]}
--     }
--   }
--   - "adicional" = a bonificação ("0,63% +0,35%"): guardada SEPARADA do base, nunca
--     somada na régua. Quem soma é o consumidor (auditoria/caixa), e só quando a
--     condição da bonificação valer.
--   - As 5 faixas são gravadas FIÉIS à tabela da BBTS. A ADS, por acordo comercial,
--     recebe SEMPRE na FAIXA 4 (todos os convênios) — isso NÃO é achatado aqui: a
--     régua guarda tudo e o RESOLVER da app (sub-etapa 1B) é que fixa a Faixa 4.
--     Se o acordo mudar, muda o resolver, não o dado histórico.
--
-- Segurança/idempotência: PURAMENTE ADITIVA (tabela nova + função nova);
-- transacional; create table/index IF NOT EXISTS; create or replace function.
-- RLS default-deny (nenhuma policy) — igual à F1 da TRP: só service_role entra.
-- Rodar 2x é seguro.
--
-- STATUS: NÃO EXECUTADA. Aguardando revisão do sócio antes de rodar no Studio.

begin;

-- ============================================================
-- 1) bbts_rule_versions — uma linha por VERSÃO de tabela BBTS subida
-- ============================================================
create table if not exists bbts_rule_versions (
  id              uuid primary key default gen_random_uuid(),
  competencia     date not null,               -- 1o dia do mês nominal (ex.: '2026-06-01')
  shape_version   text not null default 'BBTS_V1',  -- versão do SHAPE do regra_json (evolução do formato)
  valid_from      date not null,               -- início da vigência da tabela nesta competência
  valid_until     date not null,               -- fim da vigência
  version_no      integer not null,            -- 1,2,3... por competência (re-upload = nova versão)
  is_active       boolean not null default true,
  regra_json      jsonb not null,              -- RegraBbts COMPLETO (convenios + grupos + células)
  doc_ref         text,                        -- referência do documento da BBTS (se houver)
  source_filename text,                        -- 'TABELA BBTS 062026.pdf'
  source_sha256   text,                        -- hash do PDF (rastreabilidade / dedupe)
  parser_version  text,                        -- versão do parser que extraiu
  uploaded_by     uuid references app_users(id),
  uploaded_at     timestamptz not null default now(),
  notes           text,
  constraint uq_bbts_rule_versions_comp_ver unique (competencia, version_no)
);

-- RLS default-deny: nenhuma policy => authenticated/anon não leem nem escrevem.
-- service_role (rotas com guard no servidor / motor) ignora RLS. Policies de
-- leitura para admin entram junto da tela (1B), se necessário.
alter table bbts_rule_versions enable row level security;

-- Só UMA versão ATIVA por competência (a mais recente confirmada).
create unique index if not exists uq_bbts_rule_versions_active
  on bbts_rule_versions (competencia)
  where is_active;

-- Lookup do resolvedor (1B): por competência + ativa.
create index if not exists idx_bbts_rule_versions_comp
  on bbts_rule_versions (competencia, is_active);

comment on table bbts_rule_versions is
  'Auditoria ADS/BBTS (1A): fonte versionada da TABELA DA BBTS por competência — a '
  '"TRP da ADS". Espelho de trp_rule_versions, shape proprio (RegraBbts). Sera a '
  'fonte canonica de auditoria/recebiveis/caixa da ADS. NAO altera a comissao do '
  'promotor (essa segue a TRP da Promotiva). Nasce vazia; o dado entra pela tela.';
comment on column bbts_rule_versions.regra_json is
  'RegraBbts completo: _meta + convenios (codigo -> grupo) + grupos (celulas com '
  'tx_min/tx_max, prazo_min/prazo_max e percentuais por Faixa 1..5, cada um com '
  'base e adicional/bonificacao SEPARADOS — nunca somados aqui).';
comment on column bbts_rule_versions.shape_version is
  'Versao do SHAPE do regra_json (BBTS_V1). Permite evoluir o formato sem quebrar '
  'as versoes ja gravadas: o resolver despacha pelo shape.';
comment on column bbts_rule_versions.valid_from is
  'Inicio da vigencia da tabela nesta competencia. DECISAO PENDENTE (ver notas da '
  '1A): se a janela BBTS e o mes calendario ou a janela holiday-aware da RR '
  '(lib/trp/vigencia.ts). A app calcula e grava; aqui e so coluna.';

-- ============================================================
-- 2) bbts_commit_version — commit ATÔMICO de uma nova versão
-- ============================================================
-- Espelho de trp_commit_version: advisory lock por competência serializa commits
-- concorrentes (sem corrida no version_no); desativa a ativa; insere a nova ativa.
-- security definer + revoke/grant: só service_role executa (a rota é socio-only).
create or replace function bbts_commit_version(
  p_competencia     date,
  p_shape_version   text,
  p_valid_from      date,
  p_valid_until     date,
  p_regra_json      jsonb,
  p_doc_ref         text,
  p_source_filename text,
  p_source_sha256   text,
  p_parser_version  text,
  p_uploaded_by     uuid,
  p_notes           text
) returns bbts_rule_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_row  bbts_rule_versions;
begin
  -- serializa commits concorrentes da MESMA competência (evita corrida no version_no)
  perform pg_advisory_xact_lock(hashtextextended('bbts:' || p_competencia::text, 0));

  select coalesce(max(version_no), 0) + 1 into v_next
    from bbts_rule_versions where competencia = p_competencia;

  update bbts_rule_versions
     set is_active = false
   where competencia = p_competencia and is_active;   -- 0 ou 1 linha

  insert into bbts_rule_versions (
    competencia, shape_version, valid_from, valid_until, version_no, is_active,
    regra_json, doc_ref, source_filename, source_sha256, parser_version,
    uploaded_by, notes
  ) values (
    p_competencia, coalesce(p_shape_version, 'BBTS_V1'), p_valid_from, p_valid_until, v_next, true,
    p_regra_json, p_doc_ref, p_source_filename, p_source_sha256, p_parser_version,
    p_uploaded_by, p_notes
  ) returning * into v_row;

  return v_row;   -- respeita uq_active (1 ativa) e uq(competencia, version_no)
end $$;

revoke all on function bbts_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function bbts_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  to service_role;

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) tabela existe e está VAZIA:
--   select count(*) as linhas from bbts_rule_versions;   -- esperado: 0
--
--   -- (b) colunas (15), tipos esperados:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'bbts_rule_versions'
--    order by ordinal_position;
--
--   -- (c) índice parcial ÚNICO de "1 versão ativa por competência":
--   select indexname, indexdef from pg_indexes
--    where schemaname = 'public' and indexname = 'uq_bbts_rule_versions_active';
--   -- Prova funcional (deve FALHAR na 2a linha ativa — rode em begin/rollback):
--   -- begin;
--   --   insert into bbts_rule_versions (competencia, valid_from, valid_until, version_no, is_active, regra_json)
--   --     values (date '2026-06-01', date '2026-06-01', date '2026-06-30', 1, true, '{}'::jsonb);
--   --   insert into bbts_rule_versions (competencia, valid_from, valid_until, version_no, is_active, regra_json)
--   --     values (date '2026-06-01', date '2026-06-01', date '2026-06-30', 2, true, '{}'::jsonb);
--   -- rollback;  -- esperado: ERROR duplicate key ... uq_bbts_rule_versions_active
--
--   -- (d) a função existe e só service_role executa:
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'bbts_commit_version';
--   -- esperado: 1 linha, prosecdef = true (security definer)
--
--   -- (e) RLS ligada, sem policies (default-deny):
--   select relrowsecurity from pg_class where relname = 'bbts_rule_versions';  -- true
--   select count(*) from pg_policies where tablename = 'bbts_rule_versions';   -- 0
