// ============================================================
// RECEBIVEIS — Camada 1: DETECÇÃO DE INADIMPLÊNCIA / parada antecipada do PRT.
//
// Compara os DOIS snapshots mais recentes da carteira PRT (COD EST=1).
// Identifica contratos que estavam VIVOS no snapshot anterior (parcelas
// restantes > 0) e SUMIRAM no recente SEM ter quitado — pararam de pingar
// antes do fim do prazo.
//
// Classificação de quem sumiu (estava vivo antes, ausente depois):
//   - parcelasRestantes(anterior) == 1  -> PROVÁVEL QUITAÇÃO: pagou a última
//     parcela no mês seguinte e saiu legitimamente. Excluído do gancho.
//   - parcelasRestantes(anterior) >= 2  -> PARADA ANTECIPADA (suspeita): faltavam
//     >= 2 parcelas, impossível ter quitado em 1 mês. É o gancho de auditoria
//     (questionar Promotiva OU confirmar inadimplência legítima do cliente).
//
// READ-ONLY. Self-contained exceto pelo reuso de fetchPrtSnapshot/PrtContract
// de ./prtAgenda (mesma pasta, sem "@/").
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchPrtSnapshot, type PrtContract } from "./prtAgenda.ts";

const PRT_ENTRY_TYPE = "PRT";

/** Faltavam >= este nº de parcelas no snapshot anterior => parada antecipada. */
const MIN_PARCELAS_PARA_SUSPEITA = 2;

export interface PrtSumiuItem {
  operacao: string;
  /** COMISSÃO mensal que deixou de pingar (R$). */
  comissaoMensal: number;
  /** Parcelas que ainda faltavam no snapshot anterior. */
  parcelasRestantes: number;
  parcelasPagas: number;
  parcelasTotal: number;
}

export interface PrtInadimplenciaResult {
  snapshotAnterior: { ano: number; mes: number; competencia: string };
  snapshotRecente: { ano: number; mes: number; competencia: string };
  contratosAnterior: number;
  contratosRecente: number;
  /** Vivos no anterior (restantes>0) que sumiram no recente. */
  sumiramVivos: number;
  /** Dos que sumiram: restantes==1 (saíram legitimamente). */
  provavelQuitacao: number;
  /** Dos que sumiram: restantes>=2 (pararam antes do fim) — o gancho. */
  paradaAntecipada: number;
  /** Σ COMISSÃO mensal perdida pelos de parada antecipada (R$/mês). */
  comissaoMensalPerdida: number;
  /** Σ parcelas que faltavam nos de parada antecipada (direito futuro perdido em nº parcelas). */
  parcelasFuturasPerdidas: number;
  /** Itens de parada antecipada, ordenados por COMISSÃO desc. */
  itens: PrtSumiuItem[];
}

/** Competência PRT mais recente estritamente anterior a (ano, mes), ou null. */
async function findPrtMonthBefore(
  supabase: SupabaseClient,
  ano: number,
  mes: number,
): Promise<{ ano: number; mes: number } | null> {
  // (year < ano) OU (year = ano E month < mes), pegando a mais recente.
  const { data, error } = await supabase
    .from("monthly_closing_entries")
    .select("year, month")
    .eq("entry_type", PRT_ENTRY_TYPE)
    .or(`year.lt.${ano},and(year.eq.${ano},month.lt.${mes})`)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return { ano: Number(row.year), mes: Number(row.month) };
}

/**
 * Acha as DUAS competências mais recentes com linhas PRT (recente primeiro).
 *
 * NÃO usa dedup sobre uma página: o mês mais recente tem ~10k linhas, então
 * paginar para achar o segundo seria caro. Faz duas buscas limit-1: a mais
 * recente, depois a mais recente estritamente anterior a ela.
 */
export async function findTwoLatestPrtSnapshots(
  supabase: SupabaseClient,
): Promise<Array<{ ano: number; mes: number }>> {
  const { data, error } = await supabase
    .from("monthly_closing_entries")
    .select("year, month")
    .eq("entry_type", PRT_ENTRY_TYPE)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const top = data?.[0];
  if (!top) return [];

  const recente = { ano: Number(top.year), mes: Number(top.month) };
  const anterior = await findPrtMonthBefore(supabase, recente.ano, recente.mes);
  return anterior ? [recente, anterior] : [recente];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Detecta contratos que pararam de pagar antes do fim entre os dois snapshots
 * mais recentes (função pura sobre as duas carteiras já carregadas).
 */
export function detectarParadaAntecipada(
  anterior: PrtContract[],
  recente: PrtContract[],
  snapAnterior: { ano: number; mes: number },
  snapRecente: { ano: number; mes: number },
): PrtInadimplenciaResult {
  const opsRecente = new Set(recente.map((c) => c.operacao));

  let sumiramVivos = 0;
  let provavelQuitacao = 0;
  const itens: PrtSumiuItem[] = [];

  for (const c of anterior) {
    if (c.parcelasRestantes <= 0) continue; // já estava quitado no anterior
    if (opsRecente.has(c.operacao)) continue; // continua na carteira
    sumiramVivos += 1;
    if (c.parcelasRestantes < MIN_PARCELAS_PARA_SUSPEITA) {
      provavelQuitacao += 1; // restava 1 parcela -> pagou e saiu
      continue;
    }
    itens.push({
      operacao: c.operacao,
      comissaoMensal: c.comissao,
      parcelasRestantes: c.parcelasRestantes,
      parcelasPagas: c.parcelasPagas,
      parcelasTotal: c.parcelasTotal,
    });
  }

  itens.sort((a, b) => b.comissaoMensal - a.comissaoMensal);

  const comissaoMensalPerdida =
    Math.round(itens.reduce((s, it) => s + it.comissaoMensal, 0) * 100) / 100;
  const parcelasFuturasPerdidas = itens.reduce((s, it) => s + it.parcelasRestantes, 0);

  return {
    snapshotAnterior: { ...snapAnterior, competencia: `${snapAnterior.ano}-${pad2(snapAnterior.mes)}` },
    snapshotRecente: { ...snapRecente, competencia: `${snapRecente.ano}-${pad2(snapRecente.mes)}` },
    contratosAnterior: anterior.length,
    contratosRecente: recente.length,
    sumiramVivos,
    provavelQuitacao,
    paradaAntecipada: itens.length,
    comissaoMensalPerdida,
    parcelasFuturasPerdidas,
    itens,
  };
}

/**
 * Orquestra: carrega os dois snapshots mais recentes e detecta parada
 * antecipada. Ponto de entrada do gancho de auditoria.
 */
export async function buildPrtInadimplencia(
  supabase: SupabaseClient,
): Promise<PrtInadimplenciaResult> {
  const snaps = await findTwoLatestPrtSnapshots(supabase);
  if (snaps.length < 2) {
    throw new Error("Preciso de ao menos 2 snapshots PRT para comparar.");
  }
  const [recente, anterior] = snaps; // ordem: recente primeiro
  const [carteiraAnterior, carteiraRecente] = await Promise.all([
    fetchPrtSnapshot(supabase, anterior.ano, anterior.mes),
    fetchPrtSnapshot(supabase, recente.ano, recente.mes),
  ]);
  return detectarParadaAntecipada(carteiraAnterior, carteiraRecente, anterior, recente);
}
