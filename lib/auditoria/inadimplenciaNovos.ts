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

// DECISÃO DO DIEGO (Camada 4.x): TODO contrato que parou de pagar antes de
// quitar é RECEBÍVEL EM ABERTO — o sistema NUNCA descarta sozinho, só prioriza.
// Por isso a fila inclui os DOIS interrompidos (SUSPEITO <12 parc e LEGITIMO
// ≥12 parc) + AUSENTE. A baixa só sai por decisão manual (BAIXADO/JUSTIFICADO).
const CANDIDATE_STATUSES: ContractPrtStatus[] = [
  "INTERROMPIDO_SUSPEITO",
  "INTERROMPIDO_LEGITIMO",
  "AUSENTE",
];

/**
 * Fase de tratamento — PRIORIZA sem descartar:
 * - A_COBRAR: INTERROMPIDO_SUSPEITO (<12 parcelas) — indício forte, cobrar logo.
 * - AGUARDANDO_EXPLICACAO: INTERROMPIDO_LEGITIMO (≥12 parcelas) e AUSENTE
 *   (nunca listou) — provável legítimo; pediu/vai pedir explicação à Promotiva.
 * Ambas contam no recuperável EM ABERTO.
 */
export type FaseInadimplencia = "A_COBRAR" | "AGUARDANDO_EXPLICACAO";

function faseDoStatus(status: ContractPrtStatus): FaseInadimplencia {
  return status === "INTERROMPIDO_SUSPEITO" ? "A_COBRAR" : "AGUARDANDO_EXPLICACAO";
}

export interface InadimplenciaNovoItem {
  operationNumber: string;
  companyCnpj: string;
  status: ContractPrtStatus;
  /** Prioridade sem descarte (deriva do status). */
  fase: FaseInadimplencia;
  parcelasPagas: number;
  parcelasTotal: number;
  ultimoMesPago: { year: number; month: number } | null;
  /** Meses desde o último pagamento (aging) — null p/ AUSENTE. Só prioriza. */
  mesesParado: number | null;
  recuperavelEstimado: number;
}

export interface InadimplenciaNovosResult {
  competencia: { year: number; month: number };
  /** Só rotula "parada antiga" (informativo). NÃO descarta mais nada. */
  lookbackParadaMeses: number;
  /** SUSPEITO + LEGITIMO + AUSENTE detectados pelo motor (antes do anti-dupla). */
  totalSuspeitos: number;
  /** Excluídos por já estarem em cobranca_itens (tipo PRT) — única exclusão. */
  jaCobrados: number;
  /** Informativo: parada > lookback. NÃO é excluído (decisão do Diego). */
  paradaAntiga: number;
  /** Lista final (só anti-dupla aplicada), ordenada por recuperável desc. */
  novos: InadimplenciaNovoItem[];
  totalNovos: number;
  /** Fase A_COBRAR (SUSPEITO <12). */
  aCobrar: number;
  /** Fase AGUARDANDO_EXPLICACAO (LEGITIMO ≥12 + AUSENTE). */
  aguardandoExplicacao: number;
  /** Recuperável EM ABERTO = A_COBRAR + AGUARDANDO_EXPLICACAO (toda a fila). */
  recuperavelNovo: number;
  /**
   * TODOS os operationNumbers ainda em aberto nesta competência (SUSPEITO +
   * LEGITIMO + AUSENTE, ANTES do anti-dupla). Alimenta a transição RESSURGIU do
   * reconciliador: um contrato aberto no monitor cujo op NÃO está mais aqui
   * deixou de ser inadimplente (voltou a pagar / mudou de status).
   */
  suspeitosAtuaisOps: string[];
}

export interface InadimplenciaNovosOptions {
  competencia: { year: number; month: number };
  /** Janela p/ ROTULAR "parada antiga" (default 3). NÃO descarta. */
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

  // 2) candidatos: SUSPEITO + LEGITIMO + AUSENTE (nada é pré-descartado).
  const candidatos = payload.results.filter((r) =>
    CANDIDATE_STATUSES.includes(r.status),
  );

  const compIdx = competencia.year * 12 + (competencia.month - 1);
  const mesesDesdeUltimoPago = (
    ump: { year: number; month: number } | null,
  ): number | null => (ump ? compIdx - (ump.year * 12 + (ump.month - 1)) : null);

  let jaCobrados = 0;
  let paradaAntiga = 0;
  const novos: InadimplenciaNovoItem[] = [];

  for (const r of candidatos) {
    const op = String(r.operationNumber ?? "").trim();

    // 3) ÚNICA exclusão automática: anti-dupla (já cobrado como PRT). À vista e
    //    PRT são complementares — só encerra o PRT quem já foi cobrado COMO PRT.
    if (cobradoPrt.has(op)) {
      jaCobrados += 1;
      continue;
    }

    // 4) Aging: rotula "parada antiga" (> lookback) só pra PRIORIZAR. NÃO
    //    descarta — recebível em aberto até pago ou justificado manualmente.
    const ms = mesesDesdeUltimoPago(r.ultimoMesPago);
    if (ms !== null && ms > lookbackParadaMeses) paradaAntiga += 1;

    novos.push({
      operationNumber: op,
      companyCnpj: r.companyCnpj,
      status: r.status,
      fase: faseDoStatus(r.status),
      parcelasPagas: r.parcelasPagas,
      parcelasTotal: r.parcelasTotal,
      ultimoMesPago: r.ultimoMesPago,
      mesesParado: ms,
      recuperavelEstimado: r.recuperavelEstimado,
    });
  }

  // Ordena por fase (A_COBRAR primeiro) e, dentro da fase, por recuperável desc.
  const ordemFase: Record<FaseInadimplencia, number> = {
    A_COBRAR: 0,
    AGUARDANDO_EXPLICACAO: 1,
  };
  novos.sort(
    (a, b) =>
      ordemFase[a.fase] - ordemFase[b.fase] ||
      b.recuperavelEstimado - a.recuperavelEstimado,
  );
  const recuperavelNovo = round2(
    novos.reduce((a, r) => a + r.recuperavelEstimado, 0),
  );

  return {
    competencia,
    lookbackParadaMeses,
    totalSuspeitos: candidatos.length,
    jaCobrados,
    paradaAntiga,
    novos,
    totalNovos: novos.length,
    aCobrar: novos.filter((n) => n.fase === "A_COBRAR").length,
    aguardandoExplicacao: novos.filter((n) => n.fase === "AGUARDANDO_EXPLICACAO").length,
    recuperavelNovo,
    suspeitosAtuaisOps: candidatos.map((c) => String(c.operationNumber ?? "").trim()),
  };
}
