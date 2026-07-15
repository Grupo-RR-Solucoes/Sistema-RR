-- Migration: FIX da RPC compute_rules_fingerprint (Camada 2) — cast de ENUM  (2026-07-15)
--
-- BUG REAL EM PRODUCAO (a 000001 deu "Success" e quebrou so no runtime):
--   ERROR: 42883: function pmr_fp_txt(share_profile_type) does not exist
--   CONTEXT: PL/pgSQL function compute_rules_fingerprint line 13
--
-- CAUSA: promoter_share_profile.profile_type e o ENUM share_profile_type
-- (definido em 20260518230000_dia45_share_profiles.sql), NAO text. O helper
-- pmr_fp_txt(v text) nao recebe enum sem cast: o Postgres NAO faz coercao
-- implicita enum->text numa chamada de funcao (so em contexto de literal/IO).
-- A 000001 chamava pmr_fp_txt(profile_type) sem ::text -> nao resolve o overload.
--
-- >>> LICAO (registrada aqui de proposito): plpgsql NAO valida nomes/tipos de
--     coluna no CREATE OR REPLACE — corpo e so string ate a 1a EXECUCAO. Por
--     isso a migration 000001 reportou "Success" mesmo com o bug: criar != rodar.
--     Toda RPC precisa de um teste de EXECUCAO (chamar a funcao com o schema e os
--     TIPOS REAIS), nao so de criacao. O gate da 000001 passou porque o dado
--     sintetico declarava profile_type como TEXT; com o enum real teria pego.
--     Corrigido no gate (scripts/detector_regua_camada2_gate.cjs): schema efemero
--     agora usa o enum real e roda 000001 (reproduz o 42883) + 000002 (conserta).
--
-- AUDITORIA DE TIPOS (todas as colunas usadas na RPC, tipo REAL de producao):
--   promoter_share_profile.profile_type  share_profile_type (ENUM) <- unico enum, o bug
--   promoter_share_profile.fixed_percent numeric(7,4)   -> ja tinha ::numeric   ok
--   promoter_share_profile.scale_id      uuid           -> ja tinha ::text      ok
--   j_keys.key_type                      text           -> pmr_fp_txt direto    ok
--   j_keys.j_key                         text           -> upper()->text        ok
--   j_keys.promoter_id                   uuid           -> ja tinha ::text      ok
--   monthly_targets.company_id           uuid           -> ja tinha ::text      ok
--   monthly_targets.meta/meta_1/meta_2   numeric(18,2)  -> ja tinha ::numeric   ok
--   promoter_goal_repasse.pct_*          numeric(6,4)   -> ja tinha ::numeric   ok
--   monthly_closing_entries.entry_type   text           -> so comparador = 'CASH'/'INSURANCE'  ok
--   monthly_closing_entries.sheet_name   text           -> so comparador = 'A Vista '          ok
--   monthly_closing_entries.net/commission/insurance_value numeric(18,2) -> ::numeric ok
--   monthly_closing_entries.created_at   timestamptz    -> pmr_fp_ts            ok
--   daily_production_records.company_id  uuid           -> comparador = v_bbts (uuid)          ok
--   daily_production_records.gross/net/insurance_value numeric(18,2) -> ::numeric ok
--   daily_production_records.movement/contract/proposal_date date -> coalesce->date_trunc     ok
--   daily_production_records.created_at  timestamptz    -> pmr_fp_ts            ok
--   companies.id                         uuid           -> ja tinha ::text      ok
--   companies.group_name                 text           -> so comparador = 'Grupo RR'          ok
-- CONCLUSAO: uma unica coluna com tipo != text sem cast -> profile_type. Os
-- comparadores com enum (nao ha, entry_type e text) seriam ok mesmo se enum:
-- literal e coercivel em `col = 'X'`. O que quebra e passar enum como ARGUMENTO
-- de funcao text.
--
-- CORRECAO: pmr_fp_txt(profile_type)  ->  pmr_fp_txt(profile_type::text).
-- Uma linha. O resto do corpo e BYTE-IDENTICO a 000001 (o fingerprint calculado
-- nao muda de forma nao-intencional). Aditiva e idempotente (CREATE OR REPLACE);
-- nao toca dado nem a tabela pmr_rules_fingerprint. Nenhum baseline foi gravado
-- ainda (a RPC nunca rodou com sucesso), entao nao ha hash antigo a preservar.

begin;

create or replace function compute_rules_fingerprint(p_year int, p_month int, p_grp text)
returns text
language plpgsql
stable
as $$
declare
  v_bbts constant uuid := '375aea6d-3b9c-4490-87f0-e739e312c8ef'; -- ADS (BBTS_COMPANY_ID)
  v_comp date := make_date(p_year, p_month, 1);
  h_profile text; h_goal text; h_targets text; h_jkeys text; h_companies text;
  h_src_cash text; h_src_ins text; h_src_ads text;
begin
  -- Hoje so o grupo 'fechado' (o que a reconsolidacao produz). cms/daily: futuro.
  if p_grp <> 'fechado' then
    raise exception 'compute_rules_fingerprint: grupo % nao implementado (apenas ''fechado'')', p_grp;
  end if;

  with
  pmr_prom as (
    -- ESCOPO: promotores presentes no PMR FECHADO desta competencia.
    select distinct promoter_id
    from promoter_monthly_results
    where year = p_year and month = p_month
      and source in ('fechamento','bbts')
      and promoter_id is not null
  ),
  d_profile as (
    select md5(coalesce(string_agg(
      concat_ws('|',
        promoter_id::text,
        pmr_fp_txt(profile_type::text),   -- FIX: profile_type e ENUM share_profile_type -> ::text
        pmr_fp_num(fixed_percent::numeric),
        pmr_fp_txt(scale_id::text)),
      E'\n' order by promoter_id), '')) as h
    from promoter_share_profile
    where promoter_id in (select promoter_id from pmr_prom)
  ),
  d_goal as (
    select md5(coalesce(string_agg(
      concat_ws('|',
        promoter_id::text,
        pmr_fp_num(pct_base::numeric),
        pmr_fp_num(pct_meta1::numeric),
        pmr_fp_num(pct_meta2::numeric)),
      E'\n' order by promoter_id), '')) as h
    from promoter_goal_repasse
    where promoter_id in (select promoter_id from pmr_prom)
      and competencia = v_comp
  ),
  d_targets as (
    select md5(coalesce(string_agg(
      concat_ws('|',
        promoter_id::text,
        pmr_fp_txt(company_id::text),
        pmr_fp_num(meta::numeric),
        pmr_fp_num(meta_1::numeric),
        pmr_fp_num(meta_2::numeric)),
      E'\n' order by promoter_id, company_id), '')) as h
    from monthly_targets
    where promoter_id in (select promoter_id from pmr_prom)
      and year = p_year and month = p_month
  ),
  d_jkeys as (
    select md5(coalesce(string_agg(
      concat_ws('|',
        pmr_fp_txt(upper(j_key)),
        promoter_id::text,
        pmr_fp_txt(key_type)),
      E'\n' order by promoter_id, upper(j_key)), '')) as h
    from j_keys
    where promoter_id in (select promoter_id from pmr_prom)
  ),
  d_companies as (
    -- conjunto de empresas 'Grupo RR' (escopo do consolidador). Editar group_name
    -- para (des)incluir uma empresa muda o conjunto -> pego.
    select md5(coalesce(string_agg(id::text, E'\n' order by id), '')) as h
    from companies
    where group_name = 'Grupo RR'
  ),
  d_src_cash as (
    -- FONTE RR (agregado leve): CASH da aba A Vista. Ver LIMITACAO (a)/(c) na 000001.
    select md5(concat_ws('|',
      count(*)::text,
      pmr_fp_num(sum(net_value)::numeric),
      pmr_fp_num(sum(commission_value)::numeric),
      pmr_fp_num(sum(insurance_value)::numeric),
      pmr_fp_ts(max(created_at)))) as h
    from monthly_closing_entries
    where year = p_year and month = p_month and entry_type = 'CASH'
  ),
  d_src_ins as (
    -- FONTE RR (agregado leve): INSURANCE avulso da aba 'A Vista ' (com espaco).
    select md5(concat_ws('|',
      count(*)::text,
      pmr_fp_num(sum(net_value)::numeric),
      pmr_fp_num(sum(commission_value)::numeric),
      pmr_fp_num(sum(insurance_value)::numeric),
      pmr_fp_ts(max(created_at)))) as h
    from monthly_closing_entries
    where year = p_year and month = p_month
      and entry_type = 'INSURANCE' and sheet_name = 'A Vista '
  ),
  d_src_ads as (
    -- FONTE ADS (agregado leve): diario company=BBTS na competencia (periodo por
    -- movement_date -> contract_date -> proposal_date, como o consolidador).
    select md5(concat_ws('|',
      count(*)::text,
      pmr_fp_num(sum(gross_value)::numeric),
      pmr_fp_num(sum(net_value)::numeric),
      pmr_fp_num(sum(insurance_value)::numeric),
      pmr_fp_ts(max(created_at)))) as h
    from daily_production_records
    where company_id = v_bbts
      and date_trunc('month', coalesce(movement_date, contract_date, proposal_date)) = v_comp
  )
  select
    p.h, g.h, t.h, j.h, c.h, sc.h, si.h, sa.h
  into
    h_profile, h_goal, h_targets, h_jkeys, h_companies, h_src_cash, h_src_ins, h_src_ads
  from d_profile p, d_goal g, d_targets t, d_jkeys j, d_companies c,
       d_src_cash sc, d_src_ins si, d_src_ads sa;

  -- Digest final: concat posicional em ORDEM FIXA de tabelas, depois md5.
  return md5(concat_ws('#',
    h_profile, h_goal, h_targets, h_jkeys, h_companies,
    h_src_cash, h_src_ins, h_src_ads));
end;
$$;

comment on function compute_rules_fingerprint(int, int, text) is
  'Detector Camada 2 (v2, fix enum cast): hash de conteudo canonico das reguas do '
  'PMR FECHADO de uma competencia, escopado pelos promotores do PMR. profile_type '
  'e ENUM -> ::text explicito. Usada para GRAVAR o baseline e para COMPARAR (mesma '
  'funcao => sem drift). MICRO-RACE: le as reguas em T e chama esta funcao em T+e; '
  'se uma regua mudar no intervalo o baseline nao corresponde ao PMR. Aceitavel.';

commit;

-- ============================================================
-- GATE / verificacao pos-execucao (rodar apos o commit)
-- ============================================================
-- (V0) A FUNCAO AGORA EXECUTA (era isto que quebrava em prod):
--   select compute_rules_fingerprint(2026,6,'fechado');
--   -- esperado: um md5 (32 hex). SEM erro 42883.
--
-- (V1) determinismo: compute 2x = identico
--   select compute_rules_fingerprint(2026,6,'fechado') = compute_rules_fingerprint(2026,6,'fechado');
--   -- esperado: true
--
-- (V2) estados: antes de baseline tudo DESCONHECIDO
--   select state, count(*) from detect_rules_stale() group by state;
--   -- esperado (pre-baseline): so 'DESCONHECIDO'. Reconsolidar grava o baseline -> 'OK'.
--
-- Se o PostgREST nao achar a RPC atualizada (schema cache): notify pgrst, 'reload schema';
