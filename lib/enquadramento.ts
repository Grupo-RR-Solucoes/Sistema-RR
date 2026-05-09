/**
 * Camada 1 — Auditoria de enquadramento mensal (Fase 4.2).
 *
 * Para cada mês do Grupo RR, decide qual categoria de remuneração a
 * Promotiva DEVERIA ter aplicado (Cat_Devida) e compara com o que ela
 * efetivamente aplicou (Cat_Aplicada do snapshot Validador/Resumo).
 *
 * Inputs:
 *   - regrasLoader.getRegraEnquadramento(mes)      → regime, tiers, OPP099
 *   - monthly_validator_snapshot                   → meta_pf, pct_pen, cat_aplicada
 *   - audit_v9_avista (sum por mês ex-SRCC)        → produção real para
 *     recomputar pct_meta (snapshot.pct_meta é apenas referência: cells
 *     da aba Resumo Promotiva podem ser corrompidas; vide Δ +136pp em
 *     2023-04 reportado no Checkpoint B).
 *
 * Output:
 *   - EnquadramentoMes { regime, cat_devida, cat_aplicada, status, ... }
 *
 * NÃO duplica lógica de regime aqui — toda decisão usa o objeto retornado
 * por getRegraEnquadramento (ver brief Fase 4.2 §"REGRA DE DECISÃO").
 */

import {
  getRegraEnquadramento,
  type RegraEnquadramento,
} from "./regrasLoader.ts";
import type { Regime, StatusFase1 } from "./types/blocos.ts";
import { activeCnpjsForMonth } from "./cnpjActivePeriod.ts";

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export interface EnquadramentoMes {
  year: number;
  month: number;
  /** ISO YYYY-MM. */
  mes: string;
  regime: Regime;
  jsonRegra: string;
  regraInferida: boolean;
  /** "META" ou "VOLUME" — espelha regra.type. */
  tipoRegra: "META" | "VOLUME";

  // Da snapshot (validador/resumo)
  metaPf: number | null;
  pctMetaSnapshot: number | null;
  pctPenetracao: number | null;
  /** Recalc per-contract da A Vista do XLSX. Fonte de verdade em meses
   * elegíveis OPP099. NULL fora desses meses (não influi na decisão). */
  pctPenetracaoRecalc: number | null;
  catAplicadaRaw: string | null;
  catAplicadaNormalizada: string | null;
  catAplicadaReconhecida: boolean;

  // Recalculado (audit_v9_avista, ex-SRCC, CNPJs ativos)
  volAvistaRecalc: number | null;
  pctMetaRecalc: number | null;
  /** Δ pct_meta_snapshot vs pct_meta_recalc (em decimal — 0.005 = 0.5pp). */
  deltaPctMetaPp: number | null;
  /** True se pctMetaRecalc ∈ [0.90, 1.00) AND mes >= 2023-09 AND regime META. */
  elegivelOpp099: boolean;

  // Decisão Camada 1
  catDevida: string | null;
  /** Texto humano-legível com a regra que disparou — usado na trilha
   * documental G22. Ex.: "OPP099 (errata 06/09/2023): meta 97,21% +
   * penetração 37,66% → TABELA 2". */
  regraAplicada: string;
  opp099Triggered: boolean;
  status: StatusFase1;

  /** Lista de avisos não-críticos:
   *  - "DELTA_PCT_META_GT_0.5%": snapshot.pct_meta diverge >0,5pp do recalc
   *  - "CAT_APLICADA_NAO_RECONHECIDA": label da Promotiva não bate com nenhum
   *    tier conhecido do regime (ex.: regime VOLUME 6 com label fora de
   *    VAREJO/MIDDLE/CORPORATE)
   *  - "META_PF_ZERO": meta_pf=0 (regime VOLUME — esperado)
   */
  flags: string[];
}

// ---------------------------------------------------------------------------
// Normalização de labels
// ---------------------------------------------------------------------------

/**
 * Normaliza categoria em formato canônico v9 (uppercase, espaços normalizados,
 * acentos preservados). Ex.: "Tabela 1" → "TABELA 1", "Tabela Intermediária 1"
 * → "TABELA INTERMEDIÁRIA 1", "Upper Middle" → "UPPER MIDDLE".
 *
 * Mapeia também sinônimos comuns:
 *   - "INTER 1" / "INTERMEDIÁRIA 1" / "INTERMEDIARIA 1" → "TABELA INTERMEDIÁRIA 1"
 *   - "INTER 2" / "INTERMEDIÁRIA 2" → "TABELA INTERMEDIÁRIA 2"
 */
export function normalizeCategoria(s: string | null | undefined): string | null {
  if (!s) return null;
  const upper = s.normalize("NFC").trim().toUpperCase().replace(/\s+/g, " ");
  if (upper === "") return null;
  // Sinônimos para Inter 1/2
  if (/^INTERMEDI[ÁA]RIA\s*1$/.test(upper) || upper === "INTER 1") return "TABELA INTERMEDIÁRIA 1";
  if (/^INTERMEDI[ÁA]RIA\s*2$/.test(upper) || upper === "INTER 2") return "TABELA INTERMEDIÁRIA 2";
  if (/^TABELA\s*INTERMEDI[ÁA]RIA\s*1$/.test(upper)) return "TABELA INTERMEDIÁRIA 1";
  if (/^TABELA\s*INTERMEDI[ÁA]RIA\s*2$/.test(upper)) return "TABELA INTERMEDIÁRIA 2";
  return upper;
}

/** Conjunto de labels reconhecidas para o regime. */
function recognizedCategoriasFor(regra: RegraEnquadramento): Set<string> {
  const out = new Set<string>();
  for (const t of regra.metaTiers || []) out.add(t.categoria);
  for (const t of regra.volumeTiers || []) out.add(t.categoria);
  return out;
}

// ---------------------------------------------------------------------------
// Decisão Cat_Devida — pura, sem I/O
// ---------------------------------------------------------------------------

interface DecisaoCatDevida {
  catDevida: string | null;
  opp099Triggered: boolean;
  regraAplicada: string;
}

/**
 * Aplica os tiers + OPP099 e retorna Cat_Devida.
 *
 * @param regra      retorno de getRegraEnquadramento(mes)
 * @param pctMeta    decimal (1.0 = 100%). null = não disponível.
 * @param pctPen     decimal Prestamista. null = considerar 0 para o trigger.
 *
 * Comportamento:
 *  - Em regime VOLUME → catDevida = null, regraAplicada = "VOLUME (INDETERMINADO)".
 *  - Em regime META + pctMeta null → catDevida = null, regraAplicada = "(sem pctMeta)".
 *  - Em regime META + pctMeta presente:
 *      - Tenta OPP099 primeiro (se vigente) — overrides intermediários e
 *        promove para TABELA 2.
 *      - Senão, varre metaTiers em ordem e retorna o primeiro match.
 */
export function decideCatDevida(
  regra: RegraEnquadramento,
  pctMeta: number | null,
  pctPen: number | null
): DecisaoCatDevida {
  if (regra.type === "VOLUME") {
    return {
      catDevida: null,
      opp099Triggered: false,
      regraAplicada:
        `${regra.regime}: critério de enquadramento por volume não publicado pela Promotiva → INDETERMINADO`,
    };
  }
  if (pctMeta == null) {
    return {
      catDevida: null,
      opp099Triggered: false,
      regraAplicada: `${regra.regime}: pctMeta indisponível → SEM_DADOS`,
    };
  }
  // OPP099 tem prioridade (overrides intermediários em META 4)
  if (
    regra.opp099 &&
    pctMeta >= regra.opp099.metaMinTrigger &&
    pctMeta < regra.opp099.metaMaxTrigger &&
    (pctPen ?? 0) >= regra.opp099.pctPenTrigger
  ) {
    return {
      catDevida: regra.opp099.upgradeToCategoria,
      opp099Triggered: true,
      regraAplicada:
        `${regra.opp099.fonte}: meta ${(pctMeta * 100).toFixed(2)}%` +
        ` + penetração ${((pctPen ?? 0) * 100).toFixed(2)}%` +
        ` → ${regra.opp099.upgradeToCategoria}`,
    };
  }
  // Tier match
  for (const tier of regra.metaTiers || []) {
    const lo = tier.metaMin ?? -Infinity;
    const hi = tier.metaMax ?? Infinity;
    if (pctMeta >= lo && pctMeta < hi) {
      const opp099Note =
        regra.opp099 ? " (OPP099 não disparou — fora do range ou pen<30%)" : "";
      return {
        catDevida: tier.categoria,
        opp099Triggered: false,
        regraAplicada:
          `${regra.regime} tier [${tier.metaMin ?? "-∞"}, ${tier.metaMax ?? "+∞"}):` +
          ` meta ${(pctMeta * 100).toFixed(2)}% → ${tier.categoria}${opp099Note}`,
      };
    }
  }
  return {
    catDevida: null,
    opp099Triggered: false,
    regraAplicada: `${regra.regime}: pctMeta ${(pctMeta * 100).toFixed(2)}% fora de todos os tiers`,
  };
}

// ---------------------------------------------------------------------------
// Decisão StatusFase1 — pura
// ---------------------------------------------------------------------------

/**
 * Compara Cat_Devida com Cat_Aplicada (ambas normalizadas) e produz status:
 *
 * - SEM_DADOS:           snapshot ausente (sem meta, sem cat_aplicada).
 * - INDETERMINADO:       regime VOLUME (cat_devida = null por design).
 * - OK:                  cat_devida == cat_aplicada.
 * - DIVERGENTE_ENQUADRAMENTO: Promotiva subenquadrou (Cat_Aplicada < Cat_Devida).
 * - ENQUADRAMENTO_FAVORAVEL: Promotiva pagou a maior (Cat_Aplicada > Cat_Devida).
 */
export function decideStatusFase1(input: {
  regraType: "META" | "VOLUME";
  catDevida: string | null;
  catAplicadaNorm: string | null;
  metaPf: number | null;
}): StatusFase1 {
  // Sem snapshot algum → SEM_DADOS
  if (input.metaPf == null && input.catAplicadaNorm == null) {
    return "SEM_DADOS";
  }
  if (input.regraType === "VOLUME") {
    return "INDETERMINADO";
  }
  // META
  if (input.catDevida == null) {
    return "SEM_DADOS";
  }
  if (input.catAplicadaNorm == null) {
    // Devida calculada mas Promotiva não declarou — improvável; reportar SEM_DADOS
    return "SEM_DADOS";
  }
  if (input.catDevida === input.catAplicadaNorm) {
    return "OK";
  }
  // Ranking ordinal para distinguir DIVERGENTE vs FAVORAVEL
  const rank = META_RANK[input.catDevida] ?? -1;
  const rankApl = META_RANK[input.catAplicadaNorm] ?? -1;
  if (rank > 0 && rankApl > 0 && rank > rankApl) return "DIVERGENTE_ENQUADRAMENTO";
  if (rank > 0 && rankApl > 0 && rank < rankApl) return "ENQUADRAMENTO_FAVORAVEL";
  // Fallback: divergência sem ranking comparável
  return "DIVERGENTE_ENQUADRAMENTO";
}

const META_RANK: Record<string, number> = {
  "TABELA 1": 1,
  "TABELA INTERMEDIÁRIA 1": 2,
  "TABELA INTERMEDIÁRIA 2": 3,
  "TABELA 2": 4,
};

// ---------------------------------------------------------------------------
// Acesso a Supabase — produção líquida e snapshot
// ---------------------------------------------------------------------------

interface ValidatorSnapshotRow {
  year: number;
  month: number;
  meta_pf: number | null;
  volume_liquido_atingido: number | null;
  pct_meta: number | null;
  volume_prestamista: number | null;
  pct_penetracao: number | null;
  cat_aplicada: string | null;
  source_file: string | null;
  formato: string | null;
  raw_data: unknown;
  // Colunas adicionadas pela migration 20260509_000002 (recalc).
  // pct_penetracao_recalc é a fonte de verdade para penetração em meses
  // elegíveis OPP099 — vem da coluna per-contract `% PENETRAÇÃO` da aba
  // A Vista do XLSX. NULL em meses não-elegíveis.
  pct_penetracao_recalc: number | null;
  volume_prestamista_recalc: number | null;
  vol_liquido_avista_recalc_xlsx: number | null;
  delta_vol_liquido_xlsx_vs_v9: number | null;
}

/** Erro lançado quando a Camada 1 detecta inconsistência grave de dados. */
export class EnquadramentoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnquadramentoError";
  }
}

/** Cliente Supabase (admin) — espera get/insert/select methods. */
type SupabaseLike = {
  from: (t: string) => any;
};

export async function fetchValidatorSnapshot(
  sb: SupabaseLike,
  year: number,
  month: number
): Promise<ValidatorSnapshotRow | null> {
  const { data, error } = await sb
    .from("monthly_validator_snapshot")
    .select(
      "year,month,meta_pf,volume_liquido_atingido,pct_meta,volume_prestamista,pct_penetracao,cat_aplicada,source_file,formato,raw_data,pct_penetracao_recalc,volume_prestamista_recalc,vol_liquido_avista_recalc_xlsx,delta_vol_liquido_xlsx_vs_v9"
    )
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (error) throw new Error(`monthly_validator_snapshot ${year}-${month}: ${error.message}`);
  return (data ?? null) as ValidatorSnapshotRow | null;
}

/** Mapeia empresa string da v9 → label canônica de CNPJ_ACTIVE_PERIODS. */
function empresaToActiveLabel(emp: unknown): string | null {
  if (!emp) return null;
  const u = String(emp).toUpperCase();
  if (u.includes("ALAGOAS 3") || u.includes("RR AL SOLUCOES")) return "RR Alagoas 3";
  if (u.includes("ALAGOAS 2") || u.includes("RR SOLUCOES AL")) return "RR Alagoas 2";
  if (u.includes("PERNAMBUCO") || u.includes("RR SOLUCOES PE")) return "RR Pernambuco";
  if (u.includes("ALAGOAS") || u.includes("RR SOLUCOES LTDA")) return "RR Alagoas";
  return null;
}

/**
 * Soma audit_v9_avista.valor_liquido para o mês, filtrando ex-SRCC e CNPJs
 * ativos no mês. Ordem da paginação garante varredura completa (PostgREST
 * default 1000 por page).
 */
export async function fetchVolAvistaRecalc(
  sb: SupabaseLike,
  year: number,
  month: number
): Promise<number> {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const activeLabels = new Set(activeCnpjsForMonth(year, month).map((p) => p.label));
  let total = 0;
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("audit_v9_avista")
      .select("empresa,valor_liquido,status_fase1")
      .eq("mes", ym)
      .neq("status_fase1", "SRCC")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`audit_v9_avista sum ${ym}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ empresa: unknown; valor_liquido: unknown }>) {
      const lab = empresaToActiveLabel(r.empresa);
      if (!lab || !activeLabels.has(lab)) continue;
      total += Number(r.valor_liquido || 0);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// API principal: auditEnquadramentoMes
// ---------------------------------------------------------------------------

/**
 * Auditoria completa de Camada 1 para um mês.
 *
 * @param sb     cliente Supabase admin (de getSupabaseAdmin)
 * @param year   ano (2022..2026)
 * @param month  mês (1..12)
 * @returns      EnquadramentoMes (sempre, mesmo em SEM_DADOS — não throw)
 */
export async function auditEnquadramentoMes(
  sb: SupabaseLike,
  year: number,
  month: number
): Promise<EnquadramentoMes> {
  const mes = `${year}-${String(month).padStart(2, "0")}`;
  const regra = getRegraEnquadramento(mes);

  // Lê snapshot validador (pode ser null para 2026-04)
  const snap = await fetchValidatorSnapshot(sb, year, month);

  // Recomputa volume líquido sempre (pode ser zero se o mês não tem A Vista)
  const volAvistaRecalc = await fetchVolAvistaRecalc(sb, year, month);

  const flags: string[] = [];

  const metaPf = snap?.meta_pf ?? null;
  const pctMetaSnapshot = snap?.pct_meta ?? null;
  const pctPenetracao = snap?.pct_penetracao ?? null;
  const pctPenetracaoRecalc = snap?.pct_penetracao_recalc ?? null;
  const catAplicadaRaw = snap?.cat_aplicada ?? null;

  // pctMeta canônico = recalc (decisão); snapshot vira referência
  const pctMetaRecalc =
    metaPf != null && metaPf > 0 ? Math.round((volAvistaRecalc / metaPf) * 1e6) / 1e6 : null;
  const deltaPctMetaPp =
    pctMetaSnapshot != null && pctMetaRecalc != null
      ? Math.round((pctMetaRecalc - pctMetaSnapshot) * 1e6) / 1e6
      : null;
  if (deltaPctMetaPp != null && Math.abs(deltaPctMetaPp) > 0.005) {
    flags.push("DELTA_PCT_META_GT_0.5%");
  }
  if (metaPf === 0) flags.push("META_PF_ZERO");

  // Normaliza cat_aplicada e checa se reconhecida pelo regime
  const catAplicadaNormalizada = normalizeCategoria(catAplicadaRaw);
  const reconhecidas = recognizedCategoriasFor(regra);
  const catAplicadaReconhecida =
    catAplicadaNormalizada != null && reconhecidas.has(catAplicadaNormalizada);
  if (catAplicadaNormalizada && !catAplicadaReconhecida) {
    flags.push(`CAT_APLICADA_NAO_RECONHECIDA:${catAplicadaNormalizada}`);
  }

  // Penetração para decisão OPP099:
  //   - Em meses ELEGÍVEIS (regime META + mes>=2023-09 + pctMetaRecalc∈[0.90,1.00)),
  //     usa pct_penetracao_recalc (per-contract da A Vista, fonte de verdade).
  //   - Se pct_penetracao_recalc IS NULL em mês elegível, lança EnquadramentoError —
  //     sinaliza falha grave do seed (decisão Diego pós-CHECKPOINT C.1).
  //   - Em meses não-elegíveis (VOLUME ou meta fora da faixa), o valor não influi
  //     na decisão; mantém pct_penetracao raw para compatibilidade do payload.
  const elegivelOpp099 =
    regra.type === "META" &&
    mes >= "2023-09" &&
    pctMetaRecalc != null &&
    pctMetaRecalc >= 0.9 &&
    pctMetaRecalc < 1.0;

  let pctPenForDecision: number | null;
  if (elegivelOpp099) {
    if (pctPenetracaoRecalc == null) {
      throw new EnquadramentoError(
        `pct_penetracao_recalc NULL em mês elegível: ${mes}` +
          " (regime META + meta∈[0.90,1.00) + mes≥2023-09 mas seed não populou recalc)"
      );
    }
    pctPenForDecision = pctPenetracaoRecalc;
  } else {
    pctPenForDecision = pctPenetracao;
  }

  // Decisão Cat_Devida
  const decisao = decideCatDevida(regra, pctMetaRecalc, pctPenForDecision);

  // Status Fase 1
  const status = decideStatusFase1({
    regraType: regra.type,
    catDevida: decisao.catDevida,
    catAplicadaNorm: catAplicadaNormalizada,
    metaPf,
  });

  return {
    year,
    month,
    mes,
    regime: regra.regime,
    jsonRegra: regra.jsonRegra,
    regraInferida: regra.regraInferida,
    tipoRegra: regra.type,
    metaPf,
    pctMetaSnapshot,
    pctPenetracao,
    pctPenetracaoRecalc,
    catAplicadaRaw,
    catAplicadaNormalizada,
    catAplicadaReconhecida,
    volAvistaRecalc,
    pctMetaRecalc,
    deltaPctMetaPp,
    elegivelOpp099,
    catDevida: decisao.catDevida,
    regraAplicada: decisao.regraAplicada,
    opp099Triggered: decisao.opp099Triggered,
    status,
    flags,
  };
}

/**
 * Auditoria de um intervalo (inclusivo). Útil para popular a UI da Camada 1
 * e para os testes do CHECKPOINT C.
 */
export async function auditEnquadramentoIntervalo(
  sb: SupabaseLike,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): Promise<EnquadramentoMes[]> {
  const out: EnquadramentoMes[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    out.push(await auditEnquadramentoMes(sb, y, m));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
