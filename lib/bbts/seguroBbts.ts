// ============================================================================
// Seguro da regua BBTS: resolve a TAXA do seguro (SLIP por prazo / ESTOQUE) a
// partir de bbts_rule_versions.regra_json.seguro. Helper PROPRIO — NAO polui o
// lookupPctBbts, que e credito-only (pctBase/avista/diferido).
//
// Espelha o contrato do lookupPctBbts / do insuranceCalculator do RR: devolve
// { rate } quando resolve OU { rate: null, motivo } quando NAO ha faixa/prazo —
// NUNCA chuta um fallback silencioso (ex.: nao volta ao 0,35 fixo do bug).
//
// FONTE UNICA DA ADS = a regua versionada (bbts_rule_versions). NAO confundir
// com o SLIP do RR (lib/insuranceCalculator + tabela insurance_slip_rules), que
// tem NUMEROS DIFERENTES (0,15/0,25/0,40/0,55) e gestora diferente. Sao reguas
// INDEPENDENTES — nunca unificar as duas fontes.
// ============================================================================

import type { RegraBbts } from "./regraBbts.ts";

export type SeguroModality = "SLIP" | "ESTOQUE";

export type SeguroRateResolved =
  | { rate: number; modality: SeguroModality; motivo?: undefined }
  | { rate: null; modality: SeguroModality; motivo: string };

/** SLIP quando o tipo do seguro contem "SLIP" (sem acento/caixa); senao ESTOQUE. */
function ehSlip(tipo: unknown): boolean {
  return String(tipo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .includes("SLIP");
}

/**
 * A taxa de seguro que a regua BBTS manda aplicar sobre a base (insurance_value).
 *   - ESTOQUE -> regra.seguro.estoque.pct
 *   - SLIP    -> faixa por term_months em regra.seguro.slip[] (limite null = aberto)
 *
 * Retorna { rate: null, motivo } (e o chamador AVISA, sem chutar) quando:
 *   - a regra nao tem secao de seguro (campo opcional ausente);
 *   - ESTOQUE sem estoque.pct;
 *   - SLIP sem prazo confiavel (term_months ausente/invalido) — NAO estima;
 *   - SLIP sem faixa na regua para aquele prazo.
 */
export function seguroRateFromRegra(
  regra: RegraBbts | null | undefined,
  tipo: unknown,
  termMonths: number | null | undefined,
): SeguroRateResolved {
  const slip = ehSlip(tipo);
  const modality: SeguroModality = slip ? "SLIP" : "ESTOQUE";

  const seg = regra?.seguro;
  if (!seg) {
    return { rate: null, modality, motivo: "regua sem secao de seguro (regra.seguro ausente)" };
  }

  if (!slip) {
    const pct = seg.estoque?.pct;
    if (pct == null || !Number.isFinite(pct)) {
      return { rate: null, modality, motivo: "regua sem estoque.pct" };
    }
    return { rate: pct, modality };
  }

  // SLIP -> faixa por prazo. Prazo ausente NAO chuta (espelha lookupPctBbts/RR).
  const prazo = Number(termMonths);
  const temPrazo = termMonths != null && Number.isFinite(prazo) && prazo > 0;
  if (!temPrazo) {
    return {
      rate: null,
      modality,
      motivo: "SLIP sem prazo confiavel (term_months ausente) — nao estimado",
    };
  }

  const faixa = (seg.slip ?? []).find(
    (f) =>
      (f.prazo_min == null || prazo >= f.prazo_min) &&
      (f.prazo_max == null || prazo <= f.prazo_max),
  );
  if (!faixa || faixa.pct == null || !Number.isFinite(faixa.pct)) {
    return { rate: null, modality, motivo: `SLIP sem faixa na regua para prazo ${prazo}` };
  }
  return { rate: faixa.pct, modality };
}
