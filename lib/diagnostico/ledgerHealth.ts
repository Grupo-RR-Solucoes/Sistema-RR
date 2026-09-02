import type { SupabaseClient } from "@supabase/supabase-js";

import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
import { detectRulesStale } from "@/lib/rulesFingerprint";
import { detectTrpStaleCrossFechadas } from "@/lib/trp/detectorReguaObsoleta";
import { auditCmsVsPmr } from "@/lib/cms/auditCmsVsPmr";
import { detectFechamentoParcial } from "@/lib/diagnostico/fechamentoParcial";
import {
  descontosNaoAplicadosPorPiso,
  type LinhaDesconto as DescontoLinha,
} from "@/lib/piso/descontoNaoAplicado";

// ============================================================================
// lib/diagnostico/ledgerHealth.ts — o VIGIA DO COFRE.
//
// O /api/diagnostico historico so checava se 8 tabelas respondem a um count.
// Ele NAO olhava promoter_monthly_results — a tabela CANONICA que todas as
// telas somam (financeiro, dashboard, DRE, projecao, metas) e que os 3
// movimentos do ledger construiram. Se o PMR corrompesse, o diagnostico dizia
// "tudo bem". Este modulo fecha essa cegueira: mede as INVARIANTES do PMR e
// CONSOME o detector de regua obsoleta (Camada 2) sem reimplementa-lo.
//
// SO LEITURA. Nenhuma escrita. Roda com service_role (getSupabaseAdmin) porque:
//   - detect_rules_stale() e grant-to-service_role (revoke public);
//   - pmr_rules_fingerprint / trp_rule_versions sao RLS default-deny;
//   - assim o vigia le o mesmo universo que o consolidador escreve.
// A secao env/tables do endpoint continua no client ANON (RLS) — este modulo
// NAO troca o client do endpoint inteiro, so a secao ledger usa admin.
//
// REGIME e a fonte da verdade sobre "a competencia esta fechada?": reusa
// detectMonthRegime (cms | fechamento | open) — NAO reimplementa a regra (o
// codebase ja pagou caro por copias divergentes dessa logica). 'cms' e
// 'fechamento' contam como FECHADO; 'open' e mes vivo.
// ============================================================================

// ---------------------------------------------------------------------------
// PISO em 2026-01 (checagem regime_fechado_sem_pmr). Decisao de ESCOPO, nao
// faxina: o ledger de promotor NASCE no seed cms de janeiro/2026 — "dez/2025
// esta FORA" foi decidido na virada arquitetural. Antes disso o PMR nao e a
// fonte canonica de comissao (era o processo legado).
//
// Sem o piso, a invariante acende em 2025-09, 2025-10, 2025-11 e 2025-12: os 4
// estao em regime 'fechamento' (monthly_closing_imports COMPLETED nas 4
// empresas ativas) com ZERO linha de PMR. Investigado (read-only) em
// 2026-07-15: NAO sao recebivel historico — sao fechamentos de comissao REAIS
// (27-31 promotores/mes, ~R$583k no total, as MESMAS j_keys individuais de
// abril/junho), que entraram no backfill de abr-jun/2026 junto com o PRT.
//
// Sao RECUPERAVEIS via reconsolidarCompetenciaFechada SE for decisao de
// negocio do Diego trazer o historico de promotor de 2025 para o sistema — mas
// isso esta FORA do mandato do health-check: reconsolidar injetaria ~R$583k na
// tabela que todas as telas somam, com risco de dupla contagem contra o legado
// onde essas comissoes ja foram pagas, e contaminaria vintages/metricas de
// 2026 que cruzem a fronteira. O piso e a definicao de escopo — NAO varrer para
// baixo do tapete. Reabrir aqui so se o escopo do ledger mudar para tras.
// ---------------------------------------------------------------------------
const PISO_YEAR = 2026;
const PISO_MONTH = 1;
const compKey = (year: number, month: number) => year * 12 + month;
const PISO_KEY = compKey(PISO_YEAR, PISO_MONTH);

/** Sources que representam PMR de mes FECHADO (o ledger canonico). 'daily' NAO. */
const CLOSED_PMR_SOURCES = new Set(["cms", "fechamento", "bbts"]);

export type LedgerSeverity = "erro" | "alerta" | "info";
export type LedgerStatus = "ok" | "alerta" | "erro";

export interface LedgerCheck {
  id: string;
  severity: LedgerSeverity;
  count: number;
  descricao: string;
  /** amostra/lista das ocorrencias (limitada). Vazio quando count = 0. */
  detalhe?: unknown;
}

export interface LedgerHealth {
  status: LedgerStatus;
  checks: LedgerCheck[];
  message: string;
}

type PmrRow = {
  promoter_id: string;
  company_id: string | null;
  year: number;
  month: number;
  source: string;
  final_commission_value: number | string | null;
  /** Rastro do piso de producao. Le-se SEMPRE `=== true` (null = legado). */
  piso_zerou?: boolean | null;
};

const fmtComp = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

const toNum = (v: number | string | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function fetchAllPaged<T>(build: () => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    all.push(...((data as T[]) || []));
    if (!data || data.length < size) break;
    from += size;
  }
  return all;
}

/**
 * Mede as invariantes do PMR e devolve a secao 'ledger' do diagnostico.
 * READ-ONLY (so SELECT + a RPC read-only detect_rules_stale).
 *
 * @param admin cliente service_role (getSupabaseAdmin).
 */
export async function buildLedgerHealth(admin: SupabaseClient): Promise<LedgerHealth> {
  // --- carga base (uma vez) ---
  const pmr = await fetchAllPaged<PmrRow>(() =>
    admin
      .from("promoter_monthly_results")
      .select(
        "promoter_id, company_id, year, month, source, final_commission_value, piso_zerou"
      )
  );

  const promoters = await fetchAllPaged<{ id: string; name: string | null; is_master: boolean | null }>(
    () => admin.from("promoters").select("id, name, is_master")
  );
  const masterSet = new Set(
    promoters.filter((p) => p.is_master === true).map((p) => p.id)
  );
  const nomePromotor = new Map(promoters.map((p) => [p.id, p.name ?? "(sem nome)"]));

  // Parcelas de desconto — insumo do check `desconto_nao_cobrado_por_piso`.
  // Tabela pequena (dezenas de linhas); nao vale indexar por competencia aqui.
  const descontos = await fetchAllPaged<DescontoLinha>(() =>
    admin
      .from("promoter_discounts")
      .select(
        "id, promoter_id, year, month, amount, apply_to_company, status, notes, discount_type"
      )
  );

  // Competencias candidatas para a checagem (a): as que tem cobertura de
  // fechamento/cms COMPLETED. Sao o INPUT do regime; para a linha (a) so
  // importam as >= PISO. (A competencia fechada sem PMR nao aparece no scan do
  // PMR — por isso derivamos dos imports, nao do PMR.)
  const cmsImports = await fetchAllPaged<{ prod_year: number; prod_month: number; status: string }>(
    () => admin.from("cms_imports").select("prod_year, prod_month, status").eq("status", "COMPLETED")
  );
  const closingImports = await fetchAllPaged<{ year: number; month: number; status: string }>(
    () => admin.from("monthly_closing_imports").select("year, month, status").eq("status", "COMPLETED")
  );

  // --- regime memoizado (fonte da verdade: detectMonthRegime) ---
  const regimeCache = new Map<string, MonthRegime>();
  const regimeOf = async (year: number, month: number): Promise<MonthRegime> => {
    const key = fmtComp(year, month);
    const cached = regimeCache.get(key);
    if (cached) return cached;
    const r = await detectMonthRegime(admin, year, month);
    regimeCache.set(key, r);
    return r;
  };

  // Index do PMR por competencia.
  const pmrByComp = new Map<string, PmrRow[]>();
  for (const row of pmr) {
    const key = fmtComp(row.year, row.month);
    const arr = pmrByComp.get(key);
    if (arr) arr.push(row);
    else pmrByComp.set(key, [row]);
  }

  // Universo de competencias candidatas a (a): coberturas COMPLETED >= PISO.
  const candidateComps = new Map<string, { year: number; month: number }>();
  for (const c of cmsImports) {
    if (compKey(c.prod_year, c.prod_month) >= PISO_KEY)
      candidateComps.set(fmtComp(c.prod_year, c.prod_month), { year: c.prod_year, month: c.prod_month });
  }
  for (const c of closingImports) {
    if (compKey(c.year, c.month) >= PISO_KEY)
      candidateComps.set(fmtComp(c.year, c.month), { year: c.year, month: c.month });
  }

  // =========================================================================
  // (a) regime_fechado_sem_pmr (ERRO) — a invariante do Mov 1: regime fechado
  //     => PMR fechado existe. So >= PISO (ver comentario extenso no topo). Um
  //     mes 'cms' com linha source='cms' CONTA como "PMR existe" (nao acende).
  // =========================================================================
  const aViol: Array<{ competencia: string; regime: MonthRegime }> = [];
  for (const { year, month } of candidateComps.values()) {
    const regime = await regimeOf(year, month);
    if (regime === "open") continue; // nao fechada: nao ha o que exigir
    const rows = pmrByComp.get(fmtComp(year, month)) || [];
    const hasClosed = rows.some((r) => CLOSED_PMR_SOURCES.has(String(r.source)));
    if (!hasClosed) aViol.push({ competencia: fmtComp(year, month), regime });
  }

  // =========================================================================
  // (b) fechado_com_daily (ERRO) — linha source='daily' sobrevivente em
  //     competencia FECHADA. Protege o #13/Caixa por FILTRO (nao so por
  //     construcao da reconciliacao): quem soma o PMR sem filtrar source
  //     contaria a fatia diaria por cima da fechada. NAO tem piso — uma linha
  //     errada e uma linha errada.
  // =========================================================================
  const bViol: Array<{ competencia: string; promoter_id: string }> = [];
  for (const row of pmr) {
    if (String(row.source) !== "daily") continue;
    const regime = await regimeOf(row.year, row.month);
    if (regime !== "open")
      bViol.push({ competencia: fmtComp(row.year, row.month), promoter_id: row.promoter_id });
  }

  // =========================================================================
  // (c) aberto_com_daily (ERRO) — o IRMAO que faltava do (b). Linha de PMR em
  //     competencia de regime 'open'. O (b) so olhava o lado fechado, e por
  //     isso o comentario dele afirmava que "julho (open) com 'daily' e o
  //     estado CERTO". NAO e — essa frase custou o fossil de 2026-07.
  //
  //     O QUE ELA PROIBE, e por que e ERRO e nao alerta:
  //     mes aberto e do pipeline DIARIO; o PMR e o ledger do mes FECHADO. Uma
  //     linha de PMR num mes aberto e um SNAPSHOT que nao se atualiza sozinho,
  //     e quatro leitores a somam sem perguntar o regime:
  //       lib/historicoMensal.ts:101-102   `if (pmr) return ...` — a linha
  //                                        BLOQUEIA o fallback ao daily, entao
  //                                        a serie de /projecao e /equipe passa
  //                                        a mostrar o snapshot no lugar do
  //                                        numero vivo (e some a producao da
  //                                        OUTRA empresa do mesmo promotor);
  //       app/api/dashboard/route.ts:360   soma production_value por mes, sem
  //                                        filtro de source;
  //       app/api/metas/route.ts:93        no regime 'open' le justamente
  //                                        source='daily';
  //       lib/projecaoMetas.ts:250         alimenta a media de 3 meses.
  //
  //     MEDIDO em 2026-08-03: 8 linhas source='daily' em 2026-07 (ADS),
  //     gravadas em 20/07/2026 11:54 UTC pela rota diaria do RR, ~4h ANTES da
  //     trava semAds (commit 4c064ee). A serie de julho mostrava R$ 400.228,79
  //     onde o daily ao vivo dava R$ 753.955,30. Decisao Diego (2026-08-03):
  //     apagar sem regravar — julho esta aberto, PMR e ledger de mes fechado.
  //
  //     SEM PISO e SEM filtro de source: qualquer source em mes aberto viola.
  //     Gravar 'bbts'/'fechamento' num mes aberto seria PIOR que o 'daily' —
  //     esses dois passam pelo `.neq("source","daily")` do Caixa
  //     (lib/financialAnalytics.ts:486) e virariam comissao paga antes do
  //     fechamento. Por isso a checagem olha a COMPETENCIA, nao o source.
  //
  //     ONDE ELA NAO ACENDE: competencia sem nenhuma linha de PMR. Mes aberto
  //     sem PMR e o estado correto, e e o estado que o DELETE de 2026-07
  //     produz.
  // =========================================================================
  const cViol: Array<{ competencia: string; promoter_id: string; source: string }> = [];
  for (const row of pmr) {
    const regime = await regimeOf(row.year, row.month);
    if (regime === "open")
      cViol.push({
        competencia: fmtComp(row.year, row.month),
        promoter_id: row.promoter_id,
        source: String(row.source),
      });
  }

  // =========================================================================
  // (d) master_com_comissao (ERRO) — chave master (is_master) com
  //     final_commission_value > 0 em mes FECHADO. Master e balde operacional:
  //     nao recebe comissao. Contamina relatorio/DRE/projecao. Hoje sobrevive 1
  //     (2026-02, source 'cms', R$18,91 vindo do ground-truth) apesar dos
  //     consertos do Mov 2. Mes aberto nao entra (regime !== open).
  // =========================================================================
  const dViol: Array<{
    competencia: string;
    promoter_id: string;
    source: string;
    valor: number;
  }> = [];
  for (const row of pmr) {
    if (!masterSet.has(row.promoter_id)) continue;
    const valor = toNum(row.final_commission_value);
    if (valor <= 0) continue;
    const regime = await regimeOf(row.year, row.month);
    if (regime !== "open")
      dViol.push({
        competencia: fmtComp(row.year, row.month),
        promoter_id: row.promoter_id,
        source: String(row.source),
        valor,
      });
  }

  // =========================================================================
  // rules_stale (ERRO) + rules_desconhecido (ALERTA) — CONSOME a Camada 2
  //     (detect_rules_stale), NAO reimplementa. Buckets SEPARADOS, nunca
  //     somados: STALE = regua mudou desde o calculo (reconsolidar); DESCONHECIDO
  //     = fechada antes do detector, sem baseline (estado honesto, resolve na
  //     proxima reconsolidacao) — por isso ALERTA brando, nao erro.
  // =========================================================================
  let staleCount = 0;
  let desconhecidoCount = 0;
  let staleDetalhe: unknown = [];
  let desconhecidoDetalhe: unknown = [];
  try {
    const rules = await detectRulesStale(admin);
    staleCount = rules.counts.stale;
    desconhecidoCount = rules.counts.desconhecido;
    staleDetalhe = rules.alteradas;
    desconhecidoDetalhe = rules.desconhecidas;
  } catch (e: any) {
    // A Camada 2 e auxiliar: se a RPC falhar, o vigia reporta o erro no proprio
    // check (como alerta) em vez de derrubar todo o diagnostico.
    desconhecidoCount = 0;
    staleCount = 0;
    staleDetalhe = { erro: e?.message || "detect_rules_stale falhou" };
    desconhecidoDetalhe = staleDetalhe;
  }

  // =========================================================================
  // trp_stale (ERRO) + trp_desconhecido (ALERTA) — CONSOME a Camada 1
  //     cross-competencia (detectTrpStaleCrossFechadas), NAO reimplementa. Mesma
  //     disciplina da Camada 2: buckets SEPARADOS. So a linha ADS (bbts) fechada
  //     usa TRP (RR vem pronto do arquivo -> NAO_APLICAVEL). STALE = a TRP mudou
  //     desde o calculo (reconsolidar); DESCONHECIDO = ADS fechado sem
  //     trp_version_id rastreado (resolve na proxima reconsolidacao) -> ALERTA.
  //
  //     + trp_multi_versao (INFO), desde 01/09/2026: competencia de VIGENCIA
  //     PARTIDA. Ela NAO pode cair em trp_desconhecido — a descricao daquele
  //     item ("calculado antes do rastreamento", "resolve na proxima
  //     reconsolidacao") seria falsa nas DUAS metades: foi calculada COM
  //     rastreamento, e reconsolidar grava o mesmo NULL. Alerta que nunca apaga
  //     treina todo mundo a ignorar o painel. Bucket proprio, severidade INFO.
  // =========================================================================
  let trpStaleCount = 0;
  let trpDesconhecidoCount = 0;
  let trpMultiVersaoCount = 0;
  let trpStaleDetalhe: unknown = [];
  let trpDesconhecidoDetalhe: unknown = [];
  let trpMultiVersaoDetalhe: unknown = [];
  try {
    const trp = await detectTrpStaleCrossFechadas(admin);
    trpStaleCount = trp.counts.stale;
    trpDesconhecidoCount = trp.counts.desconhecido;
    trpMultiVersaoCount = trp.counts.multi_versao;
    trpStaleDetalhe = trp.alteradas;
    trpDesconhecidoDetalhe = trp.desconhecidas;
    trpMultiVersaoDetalhe = trp.partidas;
  } catch (e: any) {
    // Detector auxiliar: se falhar, reporta no proprio check em vez de derrubar
    // o diagnostico (igual a Camada 2).
    trpStaleCount = 0;
    trpDesconhecidoCount = 0;
    trpMultiVersaoCount = 0;
    trpStaleDetalhe = { erro: e?.message || "detectTrpStaleCrossFechadas falhou" };
    trpDesconhecidoDetalhe = trpStaleDetalhe;
    trpMultiVersaoDetalhe = trpStaleDetalhe;
  }

  // =========================================================================
  // promotor_multi_linha (INFO) — promotores com 2+ linhas na MESMA
  //     competencia (a linha RR + a linha ADS). NAO e erro: e o esperado (4 em
  //     2026-06). Serve de telemetria para flagrar explosao anomala. NUNCA
  //     muda o status.
  // =========================================================================
  const perPromComp = new Map<string, number>();
  for (const row of pmr) {
    const key = `${fmtComp(row.year, row.month)}|${row.promoter_id}`;
    perPromComp.set(key, (perPromComp.get(key) || 0) + 1);
  }
  const multi = [...perPromComp.entries()].filter(([, n]) => n > 1);

  // =========================================================================
  // cms_vs_pmr_stale (ERRO) — o PMR source='cms' AINDA reproduz o
  //     cms_promoter_entries (ground-truth)? Fecha o unico ponto cego real das
  //     brechas "congelam": a Camada 2 (detect_rules_stale) EXCLUI os meses cms
  //     de proposito (escopo fechamento/bbts) e as checagens acima so olham
  //     EXISTENCIA. Se alguem reimportar o cms sem rodar o CLI
  //     (run_pmr_cms --apply), o PMR cms fica STALE e nada avisava.
  //
  //     Reusa auditCmsVsPmr (lib/cms/auditCmsVsPmr.ts) — a MESMA regra da
  //     AUDITORIA 2 do runner: FINAL por promotor, MASTER FORA (o PMR zera o
  //     master de proposito; comparar cru daria falso — fev/2026 R$18,91), e
  //     tolerancia meia-casa (artefato 6-casas do cms vs 2-casas do PMR).
  //
  //     SO regime cms: abril/junho sao 'fechamento' e julho e 'open' — nao
  //     entram (iteramos so competencias com PMR source='cms' e regime 'cms').
  // =========================================================================
  const cmsComps = [
    ...new Set(
      pmr.filter((r) => String(r.source) === "cms").map((r) => fmtComp(r.year, r.month))
    ),
  ];
  let cmsStaleCount = 0;
  const cmsStaleDetalhe: Array<{
    competencia: string;
    divergencias: number;
    amostra: Array<{ promoter_id: string; pmr_final: number; cms_esperado: number; delta: number }>;
  }> = [];
  for (const key of cmsComps) {
    const [y, m] = key.split("-").map(Number);
    if ((await regimeOf(y, m)) !== "cms") continue; // guarda: so regime cms.
    const audit = await auditCmsVsPmr(admin, y, m, { masterIds: masterSet });
    if (audit.divergences > 0) {
      cmsStaleCount += audit.divergences;
      cmsStaleDetalhe.push({
        competencia: key,
        divergencias: audit.divergences,
        amostra: audit.rows
          .filter((r) => r.diverge)
          .slice(0, 10)
          .map((r) => ({
            promoter_id: r.promoter_id,
            pmr_final: r.pmr_final,
            cms_esperado: r.cms_esperado,
            delta: r.delta,
          })),
      });
    }
  }

  // O QUE NAO CHEGOU — competencia meio processada (ADS: 2 PDFs; RR: Todos +
  // avulsas). CONSOME o detector, nao o reimplementa (mesmo padrao do trp_stale).
  // Sao 'alerta' por construcao: apontam descontinuidade, nao provam falta.
  const parciais = await detectFechamentoParcial(admin);

  // DESCONTO x PISO — CONSOME a regra unica (lib/piso/descontoNaoAplicado.ts),
  // nao a reimplementa. A mesma funcao decide o que o consolidador marca como
  // WAIVED; se as duas divergissem, a tela mostraria um conjunto e o banco
  // outro. `piso_zerou === true` e estrito la dentro.
  const descontoPiso = descontosNaoAplicadosPorPiso(pmr, descontos).map((d) => ({
    competencia: d.competencia,
    promoter_id: d.promoter_id,
    promotor: nomePromotor.get(d.promoter_id) ?? "(promotor desconhecido)",
    valor: d.valor,
    tipo: d.discount_type,
  }));

  const checks: LedgerCheck[] = [
    {
      id: "regime_fechado_sem_pmr",
      severity: "erro",
      count: aViol.length,
      descricao:
        "Competencia >= 2026-01 em regime fechado (cms/fechamento) sem linha de PMR. Piso em 2026-01: o ledger nasce no seed cms de jan/2026 (2025 fora de escopo).",
      detalhe: aViol,
    },
    {
      id: "fechado_com_daily",
      severity: "erro",
      count: bViol.length,
      descricao:
        "Linha source='daily' sobrevivente em competencia fechada (contaria por cima da fatia fechada — #13/Caixa).",
      detalhe: bViol.slice(0, 50),
    },
    {
      id: "aberto_com_daily",
      severity: "erro",
      count: cViol.length,
      descricao:
        "Linha de PMR em competencia de regime 'open'. Mes aberto e do pipeline diario; o PMR e o ledger do mes fechado. A linha vira snapshot congelado e bloqueia o fallback ao daily na serie hibrida (lib/historicoMensal.ts:101).",
      detalhe: cViol.slice(0, 50),
    },
    {
      id: "master_com_comissao",
      severity: "erro",
      count: dViol.length,
      descricao:
        "Chave master (is_master) com final_commission_value > 0 em mes fechado (master e balde, nao recebe comissao).",
      detalhe: dViol.slice(0, 50),
    },
    {
      id: "rules_stale",
      severity: "erro",
      count: staleCount,
      descricao:
        "Camada 2: regua mudou desde o calculo do PMR fechado (reconsolidar para alinhar).",
      detalhe: staleDetalhe,
    },
    {
      id: "rules_desconhecido",
      severity: "alerta",
      count: desconhecidoCount,
      descricao:
        "Camada 2: PMR fechado sem baseline de fingerprint (fechado antes do detector). Resolve na proxima reconsolidacao.",
      detalhe: desconhecidoDetalhe,
    },
    {
      id: "trp_stale",
      severity: "erro",
      count: trpStaleCount,
      descricao:
        "Camada 1 (TRP): competencia FECHADA cuja regua de credito (linha ADS/bbts) mudou desde o calculo do PMR (reconsolidar para alinhar).",
      detalhe: trpStaleDetalhe,
    },
    {
      id: "trp_desconhecido",
      severity: "alerta",
      count: trpDesconhecidoCount,
      descricao:
        "Camada 1 (TRP): PMR fechado da ADS sem trp_version_id rastreado (calculado antes do rastreamento). Resolve na proxima reconsolidacao.",
      detalhe: trpDesconhecidoDetalhe,
    },
    {
      id: "trp_multi_versao",
      severity: "info",
      count: trpMultiVersaoCount,
      descricao:
        "Camada 1 (TRP): competencia com vigencia PARTIDA (2+ reguas ativas) — o PMR nao carimba versao unica, por construcao: seria afirmacao falsa que confere. NAO e pendencia e reconsolidar NAO muda. Consequencia: staleness desta competencia nao e detectavel pela Camada 1; se a regua for reeditada, conferir a mao.",
      detalhe: trpMultiVersaoDetalhe,
    },
    {
      id: "cms_vs_pmr_stale",
      severity: "erro",
      count: cmsStaleCount,
      descricao:
        "Mes cms: o PMR (source='cms') deixou de reproduzir o cms_promoter_entries (ground-truth). Reimportaram o cms sem rodar o CLI (run_pmr_cms --apply)? Master fora e tolerancia meia-casa aplicados.",
      detalhe: cmsStaleDetalhe,
    },
    {
      // =====================================================================
      // O DESCONTO QUE O PISO NAO DEIXOU ACONTECER.
      //
      // 'info' porque NAO e defeito: e a decisao de 20/08/2026 funcionando
      // (piso zerou o repasse => a parcela nao e consumida; nao e
      // `max(0, final - desconto)`). O que faltava era VISIBILIDADE — o dinheiro
      // deixava de ser cobrado e nenhuma tela dizia. Medido em 02/09/2026:
      // 2 casos, ambos 2026-08, R$ 8,54, primeira ocorrencia da historia.
      //
      // POR QUE IMPORTA MESMO SENDO 'info': hoje os dois casos sao parcela 1/1
      // (cobranca avulsa, sem cauda a deslocar). No dia em que cair aqui uma
      // parcela de plano (um ADIANTAMENTO 3/9), o plano perde uma parcela em
      // silencio — promoter_discounts nao tem contador e ninguem recria a que
      // faltou. Este item e o unico lugar onde isso aparece no mesmo dia.
      // =====================================================================
      id: "desconto_nao_cobrado_por_piso",
      severity: "info",
      count: descontoPiso.length,
      descricao:
        "Parcela de desconto que NAO foi cobrada porque o piso de producao zerou o repasse " +
        "do promotor na competencia. NAO e defeito — e a regra (o desconto nao acontece, " +
        "nao e absorvido). Fica aqui porque o valor deixa de ser cobrado e nada mais o mostra. " +
        "Parcela de PLANO caindo aqui (installments > 1) merece decisao: a cauda nao desloca sozinha.",
      detalhe: descontoPiso.slice(0, 50),
    },
    {
      id: "promotor_multi_linha",
      severity: "info",
      count: multi.length,
      descricao:
        "Promotores com 2+ linhas na mesma competencia (linha RR + linha ADS). Esperado — telemetria, nunca alerta.",
      detalhe: multi.slice(0, 50).map(([k, n]) => ({ chave: k, linhas: n })),
    },
    ...parciais,
  ];

  const erroCount = checks
    .filter((c) => c.severity === "erro")
    .reduce((a, c) => a + c.count, 0);
  const alertaCount = checks
    .filter((c) => c.severity === "alerta")
    .reduce((a, c) => a + c.count, 0);

  const status: LedgerStatus = erroCount > 0 ? "erro" : alertaCount > 0 ? "alerta" : "ok";

  const message =
    status === "erro"
      ? "O cofre (PMR) tem invariante violada — ver os checks com severity 'erro'."
      : status === "alerta"
        ? "O PMR esta integro; ha alerta brando (Camada 2 sem baseline)."
        : "O PMR (ledger canonico) esta integro em todas as invariantes vigiadas.";

  return { status, checks, message };
}
