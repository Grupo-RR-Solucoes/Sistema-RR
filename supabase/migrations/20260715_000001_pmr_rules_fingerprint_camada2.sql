-- Migration: Detector de regua obsoleta — CAMADA 2 (hash de conteudo)  (2026-07-15)
--
-- POR QUE EXISTE: a Camada 1 (trp_version_id) cobre a TRP, a unica regua com id
-- de versao ESTAVEL. As demais reguas que alimentam o PMR sao MUTAVEIS SEM
-- VERSAO — um UPDATE nelas muda o passado SEM RASTRO. E o updated_at NAO serve
-- de detector (medido: promoter_goal_repasse 19/19 linhas com updated_at
-- congelado no created_at apesar de re-imports; 6 das 10 tabelas nem tem a
-- coluna; ZERO trigger de updated_at em 64 migrations). Logo: HASH DE CONTEUDO.
--
-- COMO FUNCIONA: uma RPC unica (compute_rules_fingerprint) serializa
-- canonicamente as reguas que produziram o PMR FECHADO de uma competencia e
-- devolve um md5. A MESMA funcao GRAVA (o consolidador chama e guarda o baseline
-- em pmr_rules_fingerprint) e COMPARA (o detector recomputa e confronta) — uma
-- so implementacao => sem drift. detect_rules_stale() varre todas as
-- competencias fechadas e classifica OK / STALE / DESCONHECIDO.
--
-- ESCOPO POR PROMOTOR-NO-PMR: o fingerprint le SO as reguas dos promotores que
-- aparecem no PMR daquela competencia (espelha o .in("promoter_id", …) dos
-- consolidadores). Assim editar a regua de um promotor que NAO esta na
-- competencia NAO acende — mata o falso positivo estrutural.
--
-- CONJUNTO DO GRUPO 'fechado' (o que reconsolidarCompetenciaFechada recomputa =
-- consolidateMonthlyFromClosing + consolidateMonthlyFromBbts + orquestrador):
--   DENTRO (conteudo semantico que move o numero):
--     promoter_share_profile  -> profile_type, fixed_percent, scale_id
--     promoter_goal_repasse    -> pct_base, pct_meta1, pct_meta2  (a que congelou)
--     monthly_targets          -> company_id, meta, meta_1, meta_2
--     j_keys                   -> upper(j_key), promoter_id, key_type
--     companies                -> id (conjunto de empresas 'Grupo RR')
--     monthly_closing_entries  -> AGREGADO leve (fonte RR: CASH + INSURANCE)
--     daily_production_records -> AGREGADO leve (fonte ADS, company=BBTS)
--   FORA (por decisao, documentado):
--     - created_at / updated_at / notes / description / display_name / cnpj /
--       legal_name / name / status / active …: NAO entram no calculo do numero;
--       incluir = falso STALE. (updated_at ainda por cima e a coluna morta.)
--     - promoter_agreements, commission_tables, promoter_proposal_commissions:
--       NAO sao lidos no grupo fechado (so no 'daily'); incluir = falso STALE.
--     - promoters.name: cosmetico (o carve-out por nome e outro problema).
--     - share_scale + share_scale_tier: FORA hoje. Medido na faxina: a escala
--       ENTRANTE e praticamente inerte (todos resolvem nos niveis 1-2
--       PROFILE_ACORDO_FIXO; ~1 promotor/competencia no mesmo tier com o volume
--       corrigido). Incluir = ruido sem impacto no numero.
--       >>> LIMITACAO DOCUMENTADA: mudanca na ESCADA ENTRANTE (share_scale/tier)
--           NAO e detectada por esta Camada 2 enquanto a escala nao entrar em
--           uso. Reabrir o conjunto quando algum promotor passar a resolver no
--           nivel 3 (escala entrante).
--
-- LIMITACAO DO AGREGADO DA FONTE (count/sums/max(created_at)) — as 3 fugas, NAO
-- escondidas:
--   (a) edicao do jsonb (monthly_closing_entries.metadata / daily raw_payload):
--       o % a-vista, o SRCC e o valor liquido REAIS saem do jsonb; o agregado
--       sobre colunas tipadas NAO ve uma edicao la dentro.
--   (b) reatribuicao de promotor (assigned_promoter_id) em mes fechado: count e
--       sums globais ficam iguais. >>> JA COBERTO por flagCompetenciaFechada
--       (o nudge reconsolidarAviso do /promotores); a Camada 2 nao duplica.
--   (c) edicao de campo TRP-relevante (interest_rate/term_months/convenio) sem
--       mudar valor: muda o numero pela TRP, sum(valor) intacto -> escapa.
--   Fugas (a) e (c) exigem edicao MANUAL no Studio (nao e fluxo normal). Opcao
--   futura para fechar (a)/(c): hashear o jsonb canonicalizado (mais caro, risco
--   de falso positivo por chave volatil dentro do blob). NAO feito agora.
--
-- SERIALIZACAO CANONICA (determinismo):
--   - numerico: v::numeric(20,6)::text  => 3.20 == 3.2 == '3.200000'.
--   - NULL: sentinela literal '\N' (distinta de '' e de '0.000000').
--   - timestamp: to_char(v at time zone 'UTC', ...) — independe do TimeZone da
--     sessao (senao a MESMA linha renderiza diferente entre sessoes -> falso STALE).
--   - ordem das linhas: ORDER BY chave (nunca sem order -> agregado embaralha).
--   - ordem das colunas: concat_ws('|', …) posicional; das tabelas: concat_ws('#').
--   - upper(j_key): fecha o falso positivo de caixa (j001 vs J001, mesmo promotor).
--
-- DESCONHECIDO SEM BACKFILL: competencia sem linha em pmr_rules_fingerprint
-- (fechada antes desta Camada) => DESCONHECIDO, NUNCA verde. Resolve sozinha na
-- proxima reconsolidacao, que grava o baseline. Inventar hash retroativo seria
-- mentir sobre o que produziu o numero (mesma filosofia da Camada 1).
--
-- Seguranca/idempotencia: puramente aditiva (1 tabela nova + 3 funcoes helper +
-- 2 funcoes RPC). Nao toca dado existente. Rodar 2x e seguro (IF NOT EXISTS /
-- CREATE OR REPLACE). RLS default-deny na tabela; EXECUTE so para service_role.

begin;

-- ============================================================
-- Helpers de serializacao canonica (uma fonte de verdade)
-- ============================================================
create or replace function pmr_fp_num(v numeric) returns text
  language sql immutable as $$ select coalesce(v::numeric(20,6)::text, '\N') $$;

create or replace function pmr_fp_txt(v text) returns text
  language sql immutable as $$ select coalesce(v, '\N') $$;

-- timestamp normalizado em UTC (independe do TimeZone da sessao).
create or replace function pmr_fp_ts(v timestamptz) returns text
  language sql stable as $$
    select coalesce(to_char(v at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '\N')
  $$;

-- ============================================================
-- Tabela lateral: baseline do fingerprint por (competencia, grupo)
-- ============================================================
create table if not exists pmr_rules_fingerprint (
  year         int         not null,
  month        int         not null,
  source_group text        not null,           -- 'fechado' (cms/daily: futuro)
  fingerprint  text        not null,           -- md5 canonico das reguas
  algo         text        not null,           -- versao do algoritmo (ex: md5-canon-v1)
  computed_at  timestamptz not null default now(),
  primary key (year, month, source_group)
);

comment on table pmr_rules_fingerprint is
  'Detector Camada 2: baseline do hash de conteudo das reguas que produziram o '
  'PMR de cada competencia. Gravado pelo consolidador (persistRulesFingerprint) '
  'na reconsolidacao; comparado pelo detector (detect_rules_stale). Ausencia de '
  'linha = DESCONHECIDO (nunca verde). Sem backfill.';

alter table pmr_rules_fingerprint enable row level security;
-- Sem policy: default-deny. Escrita/leitura so via service_role (consolidador +
-- detector), igual trp_rule_versions. service_role ignora RLS.

-- ============================================================
-- RPC 1: compute_rules_fingerprint — GRAVA e COMPARA (mesma funcao, sem drift)
-- ============================================================
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
        pmr_fp_txt(profile_type),
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
    -- FONTE RR (agregado leve): CASH da aba A Vista. Ver LIMITACAO (a)/(c) no topo.
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
  'Detector Camada 2: hash de conteudo canonico das reguas do PMR FECHADO de uma '
  'competencia, escopado pelos promotores do PMR. Usada para GRAVAR o baseline e '
  'para COMPARAR (mesma funcao => sem drift). MICRO-RACE: o consolidador le as '
  'reguas em T e chama esta funcao em T+e; se uma regua mudar no intervalo o '
  'baseline nao corresponde ao PMR calculado. Aceitavel (reconsolidacao manual/rara).';

-- ============================================================
-- RPC 2: detect_rules_stale — varre competencias fechadas e classifica
-- ============================================================
create or replace function detect_rules_stale()
returns table(
  year int, month int, source_group text,
  stored_fp text, current_fp text, state text
)
language sql
stable
as $$
  with comps as (
    select distinct year as y, month as m, 'fechado'::text as grp
    from promoter_monthly_results
    where source in ('fechamento','bbts')
  )
  select
    c.y, c.m, c.grp,
    f.fingerprint as stored_fp,
    cur.fp        as current_fp,
    case
      when f.fingerprint is null   then 'DESCONHECIDO'  -- sem baseline: nunca verde
      when f.fingerprint = cur.fp  then 'OK'
      else 'STALE'
    end as state
  from comps c
  cross join lateral (select compute_rules_fingerprint(c.y, c.m, c.grp) as fp) cur
  left join pmr_rules_fingerprint f
    on f.year = c.y and f.month = c.m and f.source_group = c.grp
  order by c.y, c.m;
$$;

comment on function detect_rules_stale() is
  'Detector Camada 2: para cada competencia com PMR fechado, compara o fingerprint '
  'gravado com o recomputado agora. DESCONHECIDO (sem baseline) e STALE sao buckets '
  'SEPARADOS — nunca somar num numero so.';

-- EXECUTE so para service_role (consolidador + detector). Fecha a porta para
-- anon/authenticated (que sob RLS invoker leriam vazio e gerariam hash errado).
revoke execute on function compute_rules_fingerprint(int, int, text) from public;
revoke execute on function detect_rules_stale() from public;
grant  execute on function compute_rules_fingerprint(int, int, text) to service_role;
grant  execute on function detect_rules_stale() to service_role;

commit;

-- ============================================================
-- GATE / verificacao pos-execucao (rodar apos o commit)
-- ============================================================
-- (G1) DETERMINISMO — serializacao canonica (3.20==3.2 ; \N vs '' vs 0):
--   select (3.20::numeric(20,6))::text                as a,        -- '3.200000'
--          (3.2 ::numeric(20,6))::text                as b,        -- '3.200000'  => a=b
--          pmr_fp_num(null)                           as num_null, -- '\N'
--          pmr_fp_num(0)                              as num_zero, -- '0.000000'  (!= '\N')
--          pmr_fp_txt(null)                           as txt_null, -- '\N'
--          pmr_fp_txt('')                             as txt_vazio;-- ''          (!= '\N')
--   -- esperado: a = b ; '\N' != '0.000000' ; '\N' != '' . Tres formas DISTINTAS.
--
-- (G2) DETERMINISMO — mesma competencia 2x => hash IDENTICO:
--   select compute_rules_fingerprint(2026,6,'fechado') = compute_rules_fingerprint(2026,6,'fechado');
--   -- esperado: true
--
-- (G3) DISCRIMINACAO — 2 competencias diferentes => hashes DIFERENTES (se tem dado):
--   select compute_rules_fingerprint(2026,4,'fechado') <> compute_rules_fingerprint(2026,6,'fechado');
--   -- esperado: true
--
-- (G4) ESTADOS: antes de qualquer baseline, toda competencia fechada = DESCONHECIDO:
--   select state, count(*) from detect_rules_stale() group by state;
--   -- esperado (pre-baseline): so 'DESCONHECIDO'. Nada verde.
--   -- Apos reconsolidar 2026-06 (grava baseline) -> aquela vira 'OK'.
--   -- Editar uma regua de 2026-06 SEM reconsolidar -> vira 'STALE'.
--
-- (G5) FALSO POSITIVO (escopo por promotor): editar promoter_goal_repasse de um
--   promotor que NAO esta no PMR de 2026-06 NAO muda o hash de 2026-06.
--   (prova executavel no gate node: scripts/detector_regua_camada2_gate.cjs)
