// ============================================================================
// lib/trp/carimboPmr.ts — A REGUA UNICA do carimbo da TRP no PMR.
//
// Fase 3, BLOCO 1 da vigencia intra-mes (01/09/2026). Existe porque a decisao
// (b) do Diego (31/08) tem DOIS escritores — app/api/calculate/monthly/route.ts
// e lib/bbtsMonthly.ts — e uma regra que so vale se os dois a aplicarem
// IGUAL. Espalhada em dois arquivos de 1.600 e 700 linhas, ela divergiria; aqui
// ela e uma funcao pura de 3 linhas, testavel por mutacao.
//
// AS TRES SAIDAS, e a verdade que cada uma afirma:
//
//   competencia de REGUA UNICA  -> { id da versao, false }
//       "esta linha foi produzida por esta versao". E o comportamento de todo o
//       historico, byte-identico.
//
//   competencia PARTIDA         -> { NULL, true }
//       "nao cabe em um id" — porque nao cabe mesmo: agosto/2026 tem TRP38 ate
//       04/08 e TRP39 de 05/08, e a linha do PMR agrega contratos dos dois
//       lados. Carimbar a ULTIMA (o que o codigo fazia ate hoje, resolvendo por
//       `${comp}-15`) seria afirmacao FALSA QUE CONFERE para os 83 contratos de
//       31/07-04/08 — pior que vazia, porque nada acusaria. O booleano true e o
//       que impede esse NULL de ser lido como "esqueceram de carimbar".
//
//   SEM stamp (TRP_SOURCE=json, ou competencia sem versao no DB)
//                               -> { NULL, NULL }
//       "desconhecido". NAO vira false: false seria a afirmacao "esta
//       competencia tem regua unica", que nao foi medida. Mesma disciplina do
//       default ausente na migration 20260831_000001.
//
// COMO LER trp_multi_versao, sempre: `=== true`. NUNCA `!multiVersao`, nunca
// truthiness. O historico inteiro do PMR esta NULL (medido em 01/09/2026: 0
// linhas nao-nulas em todo o banco), e `!null` e `true` — a leitura preguicosa
// reclassifica TODO o passado como competencia partida. E a mesma armadilha do
// `status` decorativo do promoter_discounts.
// ============================================================================

import type { TrpVersionStamp } from "@/lib/trp/creditTrpProvider";

/** As 3 colunas de rastreio da TRP no promoter_monthly_results. */
export interface CarimboTrpPmr {
  trp_version_id: string | null;
  trp_fallback: boolean | null;
  trp_multi_versao: boolean | null;
}

/**
 * Decide o que o PMR grava a partir do stamp que o provider ja resolveu.
 * PURA: nao le banco, nao depende de data. `stamp` vem de
 * TrpCreditProvider.getResolved(competencia) — null quando nao ha TRP no DB.
 */
export function carimboTrpDoPmr(stamp: TrpVersionStamp | null | undefined): CarimboTrpPmr {
  if (!stamp) {
    // DESCONHECIDO: sem fonte versionada, nao ha o que afirmar.
    return { trp_version_id: null, trp_fallback: null, trp_multi_versao: null };
  }
  if (stamp.competenciaPartida) {
    // PARTIDA: o id fica NULL DE PROPOSITO, e o booleano diz que e de proposito.
    // trp_fallback continua sendo gravado: ele responde outra pergunta ("a regua
    // veio de outra competencia?") e na partida e sempre false (partida exige
    // fatias PROPRIAS da competencia — ver resolveTrpRegraDb, que so marca
    // competenciaPartida no ramo exact, nunca no fallback em cascata).
    return { trp_version_id: null, trp_fallback: stamp.isFallback, trp_multi_versao: true };
  }
  // REGUA UNICA: exatamente o que se gravava antes desta frente.
  return {
    trp_version_id: stamp.versionId,
    trp_fallback: stamp.isFallback,
    trp_multi_versao: false,
  };
}
