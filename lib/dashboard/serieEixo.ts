// ============================================================================
// lib/dashboard/serieEixo.ts — QUEM APARECE NO EIXO da serie mensal do grupo.
//
// O DEFEITO QUE ISTO FECHA (03/08/2026): o eixo do grafico "Producao mensal do
// grupo" saia de duas fontes — PMR (byMonth) e daily de chave MASTER nao
// atribuida (unassignedByMonth) — e de nenhuma delas saia a daily ATRIBUIDA.
// Enquanto julho/2026 teve 8 linhas fosseis de PMR o mes aparecia; apagadas
// essas linhas (frente feat/pmr-julho-ads), julho SUMIU do eixo, com 873 linhas
// de daily atribuida e elegivel na competencia (R$ 6.482.490,15).
//
// Medido no dia: eixo = [1,2,3,4,5,6,8]. E o unassignedByMonth estava VAZIO o
// ano inteiro, ou seja, na pratica o eixo era "PMR + mes corrente" — um mes so
// existia no grafico depois de consolidado.
//
// A REGRA: mes com producao IMPORTADA aparece no eixo, consolidado ou nao. O
// eixo responde "esta competencia tem dado?", nao "esta competencia foi
// fechada?" — quem responde a segunda e o VALOR do ponto, que segue vindo do
// PMR (ver route.ts) e por isso pode ser 0. Um mes com producao real e valor 0
// e informacao honesta: diz que falta consolidar. Sumir do eixo nao diz nada.
//
// POR QUE OS PREDICADOS MUDARAM DE CASA. Eles nasceram dentro de
// app/api/dashboard/route.ts e sao consumidos em 5 lacos de la. Duplica-los
// aqui criaria a sexta copia da regra de elegibilidade do daily no repo (ja ha
// isEligibleProductionRecord em promoterAnalytics e isEligibleRecord em
// projecaoMetas). Entao foram MOVIDOS para ca, sem alterar semantica, e a rota
// os importa de volta: uma definicao, dois consumidores (rota + gate).
//
// A MUDANCA E VERBATIM: os cinco predicados foram copiados byte a byte, sem
// uma linha reescrita. Em especial a classe de combinantes do normStatus
// continua na forma LITERAL (os proprios caracteres U+0300..U+036F dentro dos
// colchetes), e nao na forma escapada — trocar a representacao seria mexer no
// unico trecho do arquivo que depende de bytes invisiveis, e o ganho de leitura
// nao paga o risco. Quem garante que a copia sobreviveu nao e a inspecao visual
// e sim o gate, que passa um status ACENTUADO por isProductionStatus e exige
// true — se a classe de combinantes se perder numa copia futura, o acento
// sobrevive ao NFD, o texto deixa de casar com "PRODUCAO" e o gate acende.
// ============================================================================

import { getProductionPeriodFromValue } from "@/lib/productionPeriod";

/** Linha de daily pelo que estas funcoes REALMENTE leem — nao a linha inteira. */
export type LinhaDailyElegivel = {
  status?: string | null;
  is_srcc_restricted?: boolean | null;
  cancellation_date?: string | null;
};

/** Linha de daily pelo que o EIXO le: elegibilidade + a cascata de competencia. */
export type LinhaDailyEixo = LinhaDailyElegivel & {
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

export function normStatus(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}
export function isProductionStatus(status: unknown) {
  const s = normStatus(status);
  return s === "PRODUCAO" || s === "PRODUCTION";
}
export function isCancelledStatus(status: unknown) {
  const s = normStatus(status);
  return s.includes("CANCEL") || s.includes("ESTORN") || s.includes("RECUS");
}
export function isPendingStatus(status: unknown) {
  const s = normStatus(status);
  return s.includes("PEND") || s.includes("ANALIS") || s.includes("PROCESS");
}
export function isValidDailyRecord(r: LinhaDailyElegivel) {
  if (r.cancellation_date) return false;
  if (isCancelledStatus(r.status)) return false;
  if (isPendingStatus(r.status)) return false;
  if (r.is_srcc_restricted === true) return false;
  return true;
}

/**
 * A competencia da linha. CASCATA movement_date -> contract_date ->
 * proposal_date, a MESMA de lib/projecaoMetas.ts:831-837 (competenciaDoRegistro)
 * e de lib/bbtsMonthly.ts:138-142. NAO e um criterio novo.
 *
 * O laco do master em route.ts le so movement_date; aqui a cascata e usada de
 * proposito, porque a pergunta e outra: la se SOMA valor (e uma linha sem
 * movement_date nao tem valor no mes), aqui se decide se o mes EXISTE. Perder o
 * mes por causa de um campo nulo e exatamente o defeito que esta frente fecha.
 */
export function competenciaDaLinha(r: LinhaDailyEixo) {
  return (
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date)
  );
}

/**
 * Os MESES (1-12) do ano pedido que tem ao menos uma linha de daily ELEGIVEL.
 *
 * Elegivel = status PRODUCAO + isValidDailyRecord (nao cancelada, nao pendente,
 * sem SRCC restrita) — os MESMOS dois testes que route.ts:376-377 aplica ao
 * balde master. Sem filtro de empresa: o valor do ponto ja soma a ADS (o
 * byMonth do PMR nao filtra company_id), entao um mes que so tivesse producao
 * da ADS tem de aparecer no eixo tambem.
 *
 * Funcao PURA (sem I/O): quem busca as linhas e o chamador.
 */
export function competenciasComDailyElegivel(
  rows: readonly LinhaDailyEixo[],
  year: number
): Set<number> {
  const meses = new Set<number>();
  for (const r of rows) {
    if (!isProductionStatus(r.status)) continue;
    if (!isValidDailyRecord(r)) continue;
    const p = competenciaDaLinha(r);
    if (!p || p.year !== year) continue;
    meses.add(p.month);
  }
  return meses;
}
