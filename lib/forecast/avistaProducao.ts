// ============================================================
// FORECAST — Camada 2: À VISTA da produção ABERTA (só o realizado).
//
// Projeta o à vista que a produção JÁ REALIZADA do mês corrente vai liberar no
// caixa M+1. SÓ o que existe em daily_production_records — SEM extrapolação,
// SEM assumir ritmo. O número cresce naturalmente conforme novas diárias são
// importadas (fiel ao princípio "só o que existe").
//
// Pipeline:
//   1. competência da produção aberta via productionBusinessWindow (janela
//      holiday-aware: último dia útil de M-1 ao penúltimo de M) — NÃO o mês cru.
//   2. seleciona daily na janela (por contract_date) e filtra elegíveis
//      (status='Produção' + não-SRCC), mesma regra do painel de metas.
//   3. roda o motor TRP (resolveAvistaTrpJunho2026) por contrato -> pctEmpresa
//      (à vista capado no teto-empresa 6%).
//   4. à vista previsto = Σ pctEmpresa × net_value. Entra no caixa de M+1.
//
// READ-ONLY. NÃO extrapola.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { productionBusinessWindow } from "@/lib/projecaoMetas";
import {
  resolveAvistaTrpJunho2026,
  resolveAvistaTrpDb,
  type TrpAvistaRecord,
} from "@/lib/trp/creditAvistaTrp";
import { isTrpDbSource } from "@/lib/trp/trpSource";
import { createTrpRegraDbPreloader } from "@/lib/trp/resolveTrpRegraDb";
import { competenciaDaData } from "@/lib/trp/vigencia";

const PAGE_SIZE = 1000;

/** Linha mínima lida de daily_production_records. */
interface DailyRow {
  product_description: string | null;
  interest_rate: number | null;
  term_months: number | null;
  installments: number | null;
  contract_date: string | null;
  net_value: number | null;
  status: string | null;
  is_srcc_restricted: boolean | null;
  raw_payload: Record<string, unknown> | null;
}

export interface AvistaProducaoResult {
  /** Competência da produção aberta ("YYYY-MM"). */
  competenciaProducao: string;
  /** Competência de caixa destino — M+1 ("YYYY-MM"). */
  competenciaCaixa: string;
  /** Janela de competência usada (datas ISO). */
  janela: { inicio: string; fim: string };
  /** À vista previsto = Σ pctEmpresa × net_value (R$) — só do que já existe. */
  avistaPrevisto: number;
  /** Contratos elegíveis na janela (status Produção, não-SRCC). */
  contratosElegiveis: number;
  /** Contratos para os quais o motor resolveu um pct. */
  contratosResolvidos: number;
  /** Contratos elegíveis sem match no motor TRP (não somados). */
  contratosSemTrp: number;
  /** Fonte da regra usada: "json" (JSON estático) ou "db" (trp_rule_versions). */
  fonte: "json" | "db";
  /** Contratos resolvidos por FALLBACK (regra de competência anterior). Só fonte=db. */
  contratosFallback: number;
  /** Competência que forneceu a regra por fallback (ex.: "2026-06"), ou null. Só fonte=db. */
  competenciaFallback: string | null;
  /** Maior contract_date processado — "atualizado até" (ISO ou null). */
  ultimoContractDate: string | null;
}

// ------------------------------------------------------------------ helpers --

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function competenciaLabel(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Mesma regra de elegibilidade do painel de metas (projecaoMetas.isEligibleRecord). */
function isEligible(r: DailyRow): boolean {
  const st = String(r.status ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  return (st === "PRODUCAO" || st === "PRODUCTION") && r.is_srcc_restricted !== true;
}

/**
 * Competência da produção ABERTA que contém refDate. Se refDate já passou do
 * fim da janela do mês-calendário (penúltimo dia útil), a produção corrente já
 * pertence à competência seguinte.
 */
export function determinarCompetenciaProducao(refDate: Date): { year: number; month: number } {
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth() + 1;
  const win = productionBusinessWindow(year, month);
  if (refDate.getTime() > win.end.getTime()) {
    return addMonth(year, month, 1);
  }
  return { year, month };
}

// ----------------------------------------------------------------- IO (db) --

async function fetchDailyNaJanela(
  supabase: SupabaseClient,
  inicioISO: string,
  fimISO: string,
): Promise<DailyRow[]> {
  const rows: DailyRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("daily_production_records")
      .select(
        "product_description, interest_rate, term_months, installments, contract_date, net_value, status, is_srcc_restricted, raw_payload",
      )
      .gte("contract_date", inicioISO)
      .lte("contract_date", fimISO)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as DailyRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// ----------------------------------------------------------- orquestrador --

/**
 * Calcula o à vista previsto da produção aberta (só o realizado). Ponto de
 * entrada da Camada 2.
 */
export async function buildAvistaProducao(
  supabase: SupabaseClient,
  options: { refDate?: Date } = {},
): Promise<AvistaProducaoResult> {
  const refDate = options.refDate ?? new Date();
  const comp = determinarCompetenciaProducao(refDate);
  const win = productionBusinessWindow(comp.year, comp.month);
  const inicioISO = ymd(win.start);
  const fimISO = ymd(win.end);

  const rows = await fetchDailyNaJanela(supabase, inicioISO, fimISO);
  const elegiveis = rows.filter(isEligible);

  // TRP self-service F4: fonte da regra atrás da flag TRP_SOURCE (default json).
  //   json => resolveAvistaTrpJunho2026 (legado hardcode junho — comportamento atual).
  //   db   => resolveAvistaTrpDb (genérico por competência, com fallback). O
  //           preload async das competências da janela roda 1x aqui; o cálculo
  //           por contrato continua síncrono (preloader.getResolvedSync).
  const dbSource = isTrpDbSource();
  let provider: ((competencia: string) => ReturnType<ReturnType<typeof createTrpRegraDbPreloader>["getResolvedSync"]>) | null = null;
  if (dbSource) {
    const preloader = createTrpRegraDbPreloader(supabase);
    const comps = new Set<string>();
    for (const r of elegiveis) {
      const cd = r.contract_date ? String(r.contract_date).slice(0, 10) : null;
      if (cd) comps.add(competenciaDaData(cd));
    }
    await preloader.preload([...comps]);
    provider = (competencia: string) => preloader.getResolvedSync(competencia);
  }

  let avistaPrevisto = 0;
  let contratosElegiveis = 0;
  let contratosResolvidos = 0;
  let contratosSemTrp = 0;
  let contratosFallback = 0;
  let competenciaFallback: string | null = null;
  let ultimoContractDate: string | null = null;

  for (const r of elegiveis) {
    contratosElegiveis += 1;

    const cd = r.contract_date ? String(r.contract_date).slice(0, 10) : null;
    if (cd && (ultimoContractDate === null || cd > ultimoContractDate)) {
      ultimoContractDate = cd;
    }

    const record: TrpAvistaRecord = {
      product_description: r.product_description,
      interest_rate: r.interest_rate,
      term_months: r.term_months,
      installments: r.installments,
      contract_date: r.contract_date,
      raw_payload: r.raw_payload,
    };
    const trp = provider
      ? resolveAvistaTrpDb(record, provider)
      : resolveAvistaTrpJunho2026(record);
    if (!trp) {
      contratosSemTrp += 1;
      continue;
    }
    avistaPrevisto += trp.pctEmpresa * toNumber(r.net_value);
    contratosResolvidos += 1;
    if (trp.isFallback) {
      contratosFallback += 1;
      competenciaFallback = trp.competenciaFornecedora ?? competenciaFallback;
    }
  }

  const caixa = addMonth(comp.year, comp.month, 1);

  return {
    competenciaProducao: competenciaLabel(comp.year, comp.month),
    competenciaCaixa: competenciaLabel(caixa.year, caixa.month),
    janela: { inicio: inicioISO, fim: fimISO },
    avistaPrevisto: Math.round(avistaPrevisto * 100) / 100,
    contratosElegiveis,
    contratosResolvidos,
    contratosSemTrp,
    fonte: dbSource ? "db" : "json",
    contratosFallback,
    competenciaFallback,
    ultimoContractDate,
  };
}
