/**
 * Fase 2 — Regra "prazo TRP" do CRÉDITO.
 *
 * A Promotiva indexa a TRP por um campo de prazo que NÃO é uniforme
 * entre produtos. Validado empiricamente nas Tarefas J/K cruzando 40
 * meses de fechamentos (12/2022 a 04/2026, 19.522 CASH entries):
 *
 *   - produto 3100 / 3101 (Antecipação 13º) → usa "Prazo" do raw_payload
 *     (= prazo total do contrato em meses). "Parcelas" para 13º é sempre
 *     1 e cairia abaixo do prazo_min=5 da TRP → zeraria indevidamente.
 *   - todos os outros produtos → usa "Parcelas" do raw_payload
 *     (= número de pagamentos mensais). Bate categoricamente:
 *     CONSIGNADO 253/253 discriminantes, NÃO-CONSIGNADO 72/72.
 *
 * Fonte canônica: raw_payload do XLSX original da Promotiva.
 * Justificativa: o importer hoje grava `term_months = installments =
 * raw["Prazo"]` (Tarefa I), perdendo "Parcelas". raw_payload é
 * imutável e contém ambos os campos em 87,2% das 619 dailies (Tarefa L.2).
 *
 * Fallbacks:
 *   - degraded: se o campo preferido faltar mas o outro existir, usa
 *     o outro e emite console.warn (NODE_ENV development). Em produção
 *     do banco atual, esse caminho nunca é exercitado para 3100/3101
 *     (0 dos 79 sem Prazo são 13º — pré-check 2.0).
 *   - final: se raw_payload ausente/nulo, usa record.term_months ??
 *     record.installments ?? null (= comportamento legacy).
 *
 * IMPORTANT — escopo CRÉDITO apenas. O motor de seguro (rota /api/
 * calculate/monthly:274 getInsuranceCompanyRate e :1066 calculate
 * InsuranceCommissionFromRules) NÃO usa este helper na Fase 2.
 * Decisão de seguro fica para a Fase 3.
 */

export interface PrazoTrpRecord {
  product_code?: string | number | null;
  term_months?: number | null;
  installments?: number | null;
  raw_payload?: Record<string, unknown> | null;
}

const PRODUTO_ALIASES = [
  "Codigo Produto",
  "Código Produto",
  "Cod Produto",
  "Cód. Produto",
  "CodigoProduto",
];

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function readRawPayloadValue(
  raw: Record<string, unknown> | null | undefined,
  aliases: string[]
): unknown {
  if (!raw || typeof raw !== "object") return null;
  const normAliases = aliases.map(normalizeText);
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === "") continue;
    if (normAliases.includes(normalizeText(k))) return v;
  }
  return null;
}

function toFiniteInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
}

function getProductCode(record: PrazoTrpRecord): string {
  // 1) record.product_code direto (após importer)
  const direct = record.product_code;
  if (direct !== null && direct !== undefined && direct !== "") {
    const s = String(direct).trim();
    if (s) return s;
  }
  // 2) raw_payload aliases
  const raw = readRawPayloadValue(record.raw_payload, PRODUTO_ALIASES);
  if (raw === null) return "";
  return String(raw).trim();
}

const ANTECIPACAO_13_CODES = new Set(["3100", "3101"]);

function isAntecipacao13(code: string): boolean {
  return ANTECIPACAO_13_CODES.has(code);
}

function isDev(): boolean {
  return (
    typeof process !== "undefined" && process.env?.NODE_ENV === "development"
  );
}

/**
 * Retorna o prazo TRP a usar no lookup do motor de crédito.
 *
 * @returns number positivo, ou null se nenhuma fonte tiver valor válido.
 */
export function getPrazoTrp(record: PrazoTrpRecord): number | null {
  const productCode = getProductCode(record);
  const ant13 = isAntecipacao13(productCode);

  const rawPrazo = toFiniteInt(readRawPayloadValue(record.raw_payload, ["Prazo"]));
  const rawParcelas = toFiniteInt(
    readRawPayloadValue(record.raw_payload, ["Parcelas"])
  );

  if (rawPrazo !== null || rawParcelas !== null) {
    if (ant13) {
      if (rawPrazo !== null) return rawPrazo;
      // fallback degraded: 13º sem Prazo no raw — não esperado em
      // produção (pré-check 2.0: 0 dos 79 sem Prazo são 3100/3101).
      if (rawParcelas !== null) {
        if (isDev()) {
          // eslint-disable-next-line no-console
          console.warn(
            `[getPrazoTrp] fallback degraded — produto ${productCode || "(s/cod)"} (Antecipação 13º) sem "Prazo" no raw_payload; usando Parcelas=${rawParcelas}`
          );
        }
        return rawParcelas;
      }
    } else {
      if (rawParcelas !== null) return rawParcelas;
      // fallback degraded: outros produtos sem Parcelas no raw.
      if (rawPrazo !== null) {
        if (isDev()) {
          // eslint-disable-next-line no-console
          console.warn(
            `[getPrazoTrp] fallback degraded — produto ${productCode || "(s/cod)"} sem "Parcelas" no raw_payload; usando Prazo=${rawPrazo}`
          );
        }
        return rawPrazo;
      }
    }
  }

  // fallback final: raw_payload ausente OU sem nenhum campo de prazo.
  const fbTerm = toFiniteInt(record.term_months);
  if (fbTerm !== null) return fbTerm;
  const fbInst = toFiniteInt(record.installments);
  if (fbInst !== null) return fbInst;

  return null;
}
