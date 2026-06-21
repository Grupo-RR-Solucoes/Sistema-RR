// ============================================================
// FORECAST — Camada 3: AGREGADOR previsto-vs-recebido.
//
// Junta, mês a mês, os componentes que já existem, com TRANSPARÊNCIA sobre o
// que está incluído e o que falta (lacunas NÃO viram zero escondido):
//   - RECEBIDO (realizado): buildFinancialAnalytics.receivedNet — só meses com
//     fechamento(M-1); futuros = null.
//   - PREVISTO PRT (Camada 1, prtAgenda): direito contratado da carteira.
//   - PREVISTO À VISTA (Camada 2, avistaProducao): só no mês de caixa destino
//     da produção aberta; demais meses futuros = não projetado (sem produção).
//   - COBERTURA: o que está incluído vs a incluir (pra tela avisar honestamente).
//   - GAP (só meses fechados): recebido − previsto.
//
// ATENÇÃO de BASE: recebido é CAIXA (fechamento M-1, todos os produtos); previsto
// PRT é por COMPETÊNCIA (direito que vence no mês) e previsto à vista é parcial
// (só crédito PF). O gap mistura bases e é parcial — a cobertura/nota deixam
// isso explícito. NÃO reimplementa nada: orquestra as camadas existentes.
//
// READ-ONLY.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFinancialAnalytics } from "@/lib/financialAnalytics";
import { buildPrtAgenda } from "./prtAgenda.ts";
import { buildAvistaProducao } from "./avistaProducao.ts";

export interface CoberturaMes {
  incluido: string[];
  aIncluir: string[];
  nota: string;
}

export interface AgregadorMes {
  /** Mês de caixa ("YYYY-MM"). */
  competencia: string;
  /** true se fechamento(M-1) existe -> recebido é real. */
  fechado: boolean;
  /** receivedNet (caixa) ou null se ainda não recebido. */
  recebido: number | null;
  /** Previsto PRT (agenda, por competência) ou null se fora do horizonte. */
  previstoPrt: number | null;
  /** Previsto à vista crédito PF (só no mês de caixa destino da produção aberta). */
  previstoAvista: number | null;
  /** previstoPrt + previstoAvista (null se ambos null). */
  totalPrevisto: number | null;
  /** recebido − totalPrevisto (só meses fechados; senão null). */
  gap: number | null;
  cobertura: CoberturaMes;
}

export interface AgregadorResult {
  snapshotPrt: string;
  competenciaProducaoAberta: string;
  competenciaCaixaAvista: string;
  avistaContratosSemTrp: number;
  meses: AgregadorMes[];
}

export interface AgregadorOptions {
  refDate?: Date;
  /** Meses à frente do caixa inicial (default 6 -> 7 linhas). */
  horizonteMeses?: number;
  /** Mês de caixa inicial; default = última competência fechada + 1. */
  caixaInicial?: { year: number; month: number };
}

// ------------------------------------------------------------------ helpers --

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function label(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}
function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Conjunto de competências (YYYY-MM) com fechamento + a mais recente. */
async function fetchClosedMonths(
  supabase: SupabaseClient,
): Promise<{ set: Set<string>; latest: { year: number; month: number } | null }> {
  const { data, error } = await supabase
    .from("fechamento_mensal_empresa")
    .select("ano, mes");
  if (error) throw new Error(error.message);
  const set = new Set<string>();
  let latestIdx = -1;
  let latest: { year: number; month: number } | null = null;
  for (const r of (data ?? []) as Array<{ ano: number; mes: number }>) {
    const y = Number(r.ano), m = Number(r.mes);
    set.add(label(y, m));
    const idx = y * 12 + (m - 1);
    if (idx > latestIdx) {
      latestIdx = idx;
      latest = { year: y, month: m };
    }
  }
  return { set, latest };
}

// ----------------------------------------------------------- orquestrador --

export async function buildAgregadorForecast(
  supabase: SupabaseClient,
  options: AgregadorOptions = {},
): Promise<AgregadorResult> {
  const horizonteMeses = options.horizonteMeses ?? 6;
  const refDate = options.refDate ?? new Date();

  // Componentes (cada um já validado isoladamente).
  const [agenda, avista, closed] = await Promise.all([
    buildPrtAgenda(supabase, { horizonteMeses: horizonteMeses + 2 }),
    buildAvistaProducao(supabase, { refDate }),
    fetchClosedMonths(supabase),
  ]);

  const agendaByComp = new Map(agenda.serie.map((p) => [p.competencia, p.previsto]));

  // Caixa inicial: última competência fechada + 1 (o caixa "corrente").
  const caixaInicial =
    options.caixaInicial ??
    (closed.latest ? addMonth(closed.latest.year, closed.latest.month, 1) : { year: refDate.getUTCFullYear(), month: refDate.getUTCMonth() + 1 });

  const meses: AgregadorMes[] = [];
  for (let h = 0; h <= horizonteMeses; h++) {
    const m = addMonth(caixaInicial.year, caixaInicial.month, h);
    const comp = label(m.year, m.month);
    const prev = addMonth(m.year, m.month, -1);
    const fechado = closed.set.has(label(prev.year, prev.month));

    // Recebido: só meses com fechamento(M-1). Evita chamar o financeiro à toa.
    let recebido: number | null = null;
    if (fechado) {
      const fin = await buildFinancialAnalytics(supabase, { year: m.year, month: m.month });
      recebido = fin.summary.receivedNet;
    }

    const previstoPrt = agendaByComp.has(comp) ? (agendaByComp.get(comp) as number) : null;
    const previstoAvista = avista.competenciaCaixa === comp ? avista.avistaPrevisto : null;

    const totalPrevisto =
      previstoPrt === null && previstoAvista === null
        ? null
        : round2((previstoPrt ?? 0) + (previstoAvista ?? 0));

    const gap =
      fechado && recebido !== null && totalPrevisto !== null
        ? round2(recebido - totalPrevisto)
        : null;

    // ---- cobertura (transparência honesta) ----
    const incluido: string[] = [];
    if (previstoPrt !== null) incluido.push("PRT (agenda — direito contratado, base competência)");
    if (previstoAvista !== null) incluido.push("à vista crédito PF (produção aberta, só realizado)");

    const aIncluir: string[] = [
      "outros produtos (consórcio, bbcap, conta corrente, dental, lob)",
    ];
    if (previstoPrt === null) aIncluir.push("PRT além do horizonte da agenda");
    if (previstoAvista !== null && avista.contratosSemTrp > 0) {
      aIncluir.push(`${avista.contratosSemTrp} contratos à vista sem match no motor TRP`);
    }
    if (previstoAvista === null) {
      aIncluir.push("à vista crédito PF (sem produção importada para esta competência ainda)");
    }

    let nota: string;
    if (fechado) {
      nota =
        "Recebido = CAIXA total (fechamento M-1, todos os produtos); previsto é PARCIAL " +
        "(só PRT + à vista crédito PF) e em base de competência. Gap positivo esperado — não comparar 1:1.";
    } else {
      nota =
        "Mês futuro: ainda não recebido. Previsto parcial (PRT agenda" +
        (previstoAvista !== null ? " + à vista crédito PF da produção aberta" : "; à vista ainda não projetado") +
        ").";
    }

    meses.push({
      competencia: comp,
      fechado,
      recebido: recebido === null ? null : round2(recebido),
      previstoPrt: previstoPrt === null ? null : round2(previstoPrt),
      previstoAvista: previstoAvista === null ? null : round2(previstoAvista),
      totalPrevisto,
      gap,
      cobertura: { incluido, aIncluir, nota },
    });
  }

  return {
    snapshotPrt: agenda.snapshot.competencia,
    competenciaProducaoAberta: avista.competenciaProducao,
    competenciaCaixaAvista: avista.competenciaCaixa,
    avistaContratosSemTrp: avista.contratosSemTrp,
    meses,
  };
}
