// ============================================================
// MONITOR DE INADIMPLÊNCIA PRT — Camada 1: lista filtrada (ponte anti-dupla).
//
// Reusa o motor existente (auditPrtForMonth) que já classifica contratos PRT em
// INTERROMPIDO_SUSPEITO / AUSENTE com recuperável em R$. Aqui só montamos a
// PONTE que faltava para ter a lista de candidatos NOVOS a cobrar:
//   1) roda auditPrtForMonth(competência) — NÃO reimplementa nada;
//   2) filtra status SUSPEITO/AUSENTE;
//   3) anti-dupla: exclui quem já está em cobranca_itens (tipo PRT), mesmo padrão
//      NOT EXISTS de lib/auditoria.ts;
//   4) parada recente: ultimoMesPago dentro dos últimos N meses (foco no fresco).
//
// Diagnóstico (2026-06): mai/26 tem ~491 suspeitos, mas ~99% já cobrados; o
// recuperável NOVO real é um punhado (~5 contratos). Esta função entrega isso.
//
// READ-ONLY.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import {
  auditPrtForMonth,
  type ContractPrtStatus,
} from "@/lib/historicalAuditEngine";

const CANDIDATE_STATUSES: ContractPrtStatus[] = [
  "INTERROMPIDO_SUSPEITO",
  "AUSENTE",
];

export interface InadimplenciaNovoItem {
  operationNumber: string;
  companyCnpj: string;
  status: ContractPrtStatus;
  parcelasPagas: number;
  parcelasTotal: number;
  ultimoMesPago: { year: number; month: number } | null;
  recuperavelEstimado: number;
}

export interface InadimplenciaNovosResult {
  competencia: { year: number; month: number };
  lookbackParadaMeses: number;
  /** SUSPEITO + AUSENTE detectados pelo motor (antes dos filtros). */
  totalSuspeitos: number;
  /** Excluídos por já estarem em cobranca_itens (tipo PRT). */
  jaCobrados: number;
  /** Excluídos por parada antiga (fora da janela de lookback). */
  foraDaJanela: number;
  /** Lista final (já filtrada), ordenada por recuperável desc. */
  novos: InadimplenciaNovoItem[];
  totalNovos: number;
  recuperavelNovo: number;
  /**
   * TODOS os operationNumbers ainda suspeitos nesta competência (SUSPEITO +
   * AUSENTE, ANTES dos filtros anti-dupla/recência). Alimenta a transição
   * RESSURGIU do reconciliador: um contrato aberto no monitor cujo op NÃO está
   * mais aqui deixou de ser inadimplente (voltou a pagar / mudou de status).
   */
  suspeitosAtuaisOps: string[];
}

export interface InadimplenciaNovosOptions {
  competencia: { year: number; month: number };
  /** Janela de "parada recente" em meses (default 3). */
  lookbackParadaMeses?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Monta a lista de candidatos NOVOS a cobrança PRT para uma competência.
 * `supabase` é usado só para cobranca_itens; auditPrtForMonth usa seu próprio
 * client admin (mesmo padrão da rota /api/auditoria/historico).
 */
export async function buildInadimplenciaNovos(
  supabase: SupabaseClient,
  options: InadimplenciaNovosOptions,
): Promise<InadimplenciaNovosResult> {
  const { competencia } = options;
  const lookbackParadaMeses = options.lookbackParadaMeses ?? 3;

  // 1) motor existente + 3) carga do anti-dupla (paginado — cobranca_itens > 1000).
  const [payload, itens] = await Promise.all([
    auditPrtForMonth(competencia.year, competencia.month),
    fetchAllRows<{ tipo: string; contract_number: string }>(() =>
      supabase.from("cobranca_itens").select("tipo, contract_number"),
    ),
  ]);

  // DECISÃO DE CHAVE (anti-dupla por tipo=PRT, não por contrato): à vista e PRT
  // são pagamentos COMPLEMENTARES que se somam. O PRT interrompido é um direito
  // DISTINTO que ainda falta — cobrável mesmo que o à vista do MESMO contrato já
  // tenha sido cobrado. Por isso só excluímos quem já foi cobrado COMO PRT
  // (tipo === "PRT"); cobranças de tipo AVISTA do mesmo contrato NÃO encerram o
  // PRT. (mai/26: tipo=PRT → 17 novos; chave por-contrato qualquer-tipo daria 5.)
  const cobradoPrt = new Set(
    itens
      .filter((i) => i.tipo === "PRT")
      .map((i) => String(i.contract_number ?? "").trim()),
  );

  // 2) candidatos: SUSPEITO + AUSENTE.
  const candidatos = payload.results.filter((r) =>
    CANDIDATE_STATUSES.includes(r.status),
  );

  const compIdx = competencia.year * 12 + (competencia.month - 1);
  const mesesDesdeUltimoPago = (
    ump: { year: number; month: number } | null,
  ): number | null => (ump ? compIdx - (ump.year * 12 + (ump.month - 1)) : null);

  let jaCobrados = 0;
  let foraDaJanela = 0;
  const novos: InadimplenciaNovoItem[] = [];

  for (const r of candidatos) {
    const op = String(r.operationNumber ?? "").trim();

    // 3) anti-dupla: já cobrado como PRT.
    if (cobradoPrt.has(op)) {
      jaCobrados += 1;
      continue;
    }

    // 4) parada recente. AUSENTE não tem ultimoMesPago (nunca pagou) — mantém
    //    sempre (é um sinal distinto, raro), só interrompidos passam pela janela.
    const ms = mesesDesdeUltimoPago(r.ultimoMesPago);
    if (r.status !== "AUSENTE") {
      if (ms === null || ms < 0 || ms > lookbackParadaMeses) {
        foraDaJanela += 1;
        continue;
      }
    }

    novos.push({
      operationNumber: op,
      companyCnpj: r.companyCnpj,
      status: r.status,
      parcelasPagas: r.parcelasPagas,
      parcelasTotal: r.parcelasTotal,
      ultimoMesPago: r.ultimoMesPago,
      recuperavelEstimado: r.recuperavelEstimado,
    });
  }

  novos.sort((a, b) => b.recuperavelEstimado - a.recuperavelEstimado);
  const recuperavelNovo = round2(
    novos.reduce((a, r) => a + r.recuperavelEstimado, 0),
  );

  return {
    competencia,
    lookbackParadaMeses,
    totalSuspeitos: candidatos.length,
    jaCobrados,
    foraDaJanela,
    novos,
    totalNovos: novos.length,
    recuperavelNovo,
    suspeitosAtuaisOps: candidatos.map((c) => String(c.operationNumber ?? "").trim()),
  };
}
