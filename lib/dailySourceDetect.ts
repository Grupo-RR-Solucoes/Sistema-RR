// ============================================================================
// dailySourceDetect — detecção da ORIGEM de uma diária pela assinatura de colunas
// (+ nome de aba). Função PURA, usada no cliente (mostra o formato ANTES do upload)
// e no servidor (roteia /api/import/daily). O dropdown de override na tela protege
// contra cabeçalho novo — por isso o servidor confia no `source` explícito quando
// vem, e só usa esta detecção como fallback.
//
//   promotiva   : cabeçalhos "MCI"/"Coban" + "Proposta"            -> parser RR inline
//   ads-credito : snake_case cd_mci_correspondente / nu_proposta   -> bbtsDailyImport
//   ads-seguro  : aba "Prestamista" + "Cód. MCI" + "Contrato"      -> adsSeguroDailyImport
// ============================================================================

export type DailySource = "promotiva" | "ads-credito" | "ads-seguro";

export const DAILY_SOURCE_LABEL: Record<DailySource, string> = {
  "promotiva": "Promotiva (RR)",
  "ads-credito": "ADS — Crédito",
  "ads-seguro": "ADS — Seguro (Prestamista)",
};

function norm(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Detecta a origem pela lista de abas + cabeçalhos (linha 1). Retorna null quando
 * nenhuma assinatura casa (ex.: PDF exportado / arquivo desconhecido) — a tela
 * pede então a escolha manual no dropdown.
 */
export function detectDailySource(input: {
  sheetNames?: Array<string | number>;
  headers?: Array<string | number>;
}): DailySource | null {
  const sheets = (input.sheetNames || []).map(norm);
  const cols = new Set((input.headers || []).map(norm));
  const has = (...ks: string[]) => ks.every((k) => cols.has(norm(k)));
  const hasAny = (...ks: string[]) => ks.some((k) => cols.has(norm(k)));

  // ADS-seguro: a aba "Prestamista" é o sinal forte; fallback por colunas.
  if (sheets.includes("PRESTAMISTA")) return "ads-seguro";
  if (has("Cod. MCI", "Contrato") && hasAny("Vl. Financiado", "Seguro", "Total Seg. Liquido")) {
    return "ads-seguro";
  }

  // ADS-crédito: colunas snake_case próprias do relatório BBTS.
  if (has("cd_mci_correspondente", "nu_proposta")) return "ads-credito";

  // Promotiva (RR): MCI/Coban + Proposta.
  if (
    hasAny("MCI", "Cod. Coban", "Coban") &&
    hasAny("Proposta", "Numero Proposta", "Numero da Proposta", "Nr Proposta")
  ) {
    return "promotiva";
  }

  return null;
}
