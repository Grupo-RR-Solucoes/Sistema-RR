-- Migration: TRP self-service — Fase 6b.3 (RPC atômico de commit)  (2026-07-03)
--
-- Objetivo: função transacional que /api/trp/commit (socio-only) chama para
-- gravar uma nova versão em trp_rule_versions de forma ATÔMICA:
--   1. version_no = coalesce(max,0)+1 da competência;
--   2. desativa a versão ativa atual (is_active=false);
--   3. insere a nova (is_active=true).
-- advisory lock por competência serializa commits concorrentes (sem corrida no
-- version_no). Respeita os índices únicos da F1: uq_trp_rule_versions_active
-- (1 ativa/competência) e uq_trp_rule_versions_comp_ver (competencia, version_no).
--
-- security definer + revoke/grant: só service_role executa. RLS default-deny da
-- F1 continua sendo a fronteira real; isto é cinto-e-suspensório.
--
-- STATUS: NÃO EXECUTADA. Aguardando validação do sócio antes de rodar no Studio.
-- NB: a assinatura pode ganhar p_upload_id (fechar o rascunho do staging na MESMA
-- transação) na implementação, se aprovado o fluxo delegado.

begin;

create or replace function trp_commit_version(
  p_competencia     date,
  p_regime          text,
  p_valid_from      date,
  p_valid_until     date,
  p_regra_json      jsonb,
  p_trp_doc_ref     text,
  p_source_filename text,
  p_source_sha256   text,
  p_parser_version  text,
  p_uploaded_by     uuid,
  p_notes           text
) returns trp_rule_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_row  trp_rule_versions;
begin
  -- serializa commits concorrentes da MESMA competência (evita corrida no version_no)
  perform pg_advisory_xact_lock(hashtextextended(p_competencia::text, 0));

  select coalesce(max(version_no), 0) + 1 into v_next
    from trp_rule_versions where competencia = p_competencia;

  update trp_rule_versions
     set is_active = false
   where competencia = p_competencia and is_active;   -- 0 ou 1 linha

  insert into trp_rule_versions (
    competencia, regime, valid_from, valid_until, version_no, is_active,
    regra_json, trp_doc_ref, source_filename, source_sha256, parser_version,
    uploaded_by, notes
  ) values (
    p_competencia, p_regime, p_valid_from, p_valid_until, v_next, true,
    p_regra_json, p_trp_doc_ref, p_source_filename, p_source_sha256, p_parser_version,
    p_uploaded_by, p_notes
  ) returning * into v_row;

  return v_row;   -- respeita uq_active (1 ativa) e uq(competencia, version_no)
end $$;

revoke all on function trp_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function trp_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  to service_role;

commit;
