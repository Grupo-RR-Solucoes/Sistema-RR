// ============================================================================
// F6b sub-fase 3 — revalidação do DRAFT antes de gravar (defesa em profundidade).
//
// O commit (e o staging) NÃO confiam que o client mandou um draft íntegro. Aqui
// re-aplicamos as MESMAS validações de plausibilidade da F6b.1 sobre o RegraMes
// DRAFT (shape de trp_rule_versions.regra_json), reusando as constantes
// canônicas (EXPECTED_PRODUCTS, MAX_PLAUSIVEL) e o tipo de erro (TrpValidationError)
// de parseTrpDraft — nada é reimplementado/hardcodado aqui.
//
// Diferença vs parseTrpDraft.validarProdutos: lá valida a saída CRUA do parser
// (ProdutoExtraido.rows); aqui valida o draft já no shape RegraMes (células com
// "Faixa 1..5"/"pct_geral"), que é o que o sócio revisou/editou e o que vai virar
// versão viva. Lança TrpValidationError (a rota converte em 422).
// ============================================================================

import {
  EXPECTED_PRODUCTS,
  MAX_PLAUSIVEL,
  TrpValidationError,
} from "@/lib/trp/parseTrpDraft";

const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"] as const;
/** Chaves numéricas de percentual numa célula (o resto — tx_/prazo_ — é faixa, não pct). */
const PCT_KEYS = [...FAIXA_LABELS, "pct_geral"];
/** Nomes possíveis do array de células por produto (mesmo vocabulário do JSON canônico). */
const CELL_ARRAY_KEYS = ["celulas_taxa", "celulas_prazo", "celulas_taxa_prazo", "celulas"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Valida um RegraMes DRAFT contra a competência canônica (já normalizada YYYY-MM).
 * Regras (idênticas à F6b.1, agora sobre o shape do draft):
 *   - regime === 'VOLUME_5_FAIXAS';
 *   - _meta.competencia (se presente) bate com a competência do servidor;
 *   - os 11 EXPECTED_PRODUCTS presentes, cada um com array de células não-vazio;
 *   - todo percentual (Faixa 1..5 / pct_geral) é number finito em (0, MAX_PLAUSIVEL].
 * Lança TrpValidationError em qualquer violação (nada é gravado a montante).
 */
export function validateRegraDraft(regraDraft: unknown, competenciaCanonical: string): void {
  if (!isRecord(regraDraft)) {
    throw new TrpValidationError("draft ausente ou inválido", "regraDraft não é um objeto");
  }
  const meta = regraDraft._meta;
  if (!isRecord(meta) || meta.regime !== "VOLUME_5_FAIXAS") {
    throw new TrpValidationError(
      "regime inválido no draft",
      `esperado _meta.regime='VOLUME_5_FAIXAS', recebido '${isRecord(meta) ? String(meta.regime) : "sem _meta"}'`,
    );
  }
  if (typeof meta.competencia === "string" && meta.competencia !== competenciaCanonical) {
    throw new TrpValidationError(
      "competência do draft diverge da informada",
      `_meta.competencia='${meta.competencia}' ≠ '${competenciaCanonical}'`,
    );
  }

  const faltando: string[] = [];
  for (const k of EXPECTED_PRODUCTS) {
    const prod = regraDraft[k];
    if (!isRecord(prod)) {
      faltando.push(k);
      continue;
    }
    const cellsKey = CELL_ARRAY_KEYS.find((c) => Array.isArray(prod[c]));
    const cells = cellsKey ? (prod[cellsKey] as unknown[]) : null;
    if (!cells || cells.length === 0) {
      faltando.push(k);
      continue;
    }
    let temPct = false;
    for (let i = 0; i < cells.length; i++) {
      const cel = cells[i];
      if (!isRecord(cel)) {
        throw new TrpValidationError("célula inválida no draft", `${k} célula ${i} não é um objeto`);
      }
      for (const pk of PCT_KEYS) {
        const v = cel[pk];
        if (v === undefined) continue;
        temPct = true;
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_PLAUSIVEL) {
          throw new TrpValidationError(
            "percentual implausível no draft (lido/adulterado errado)",
            `${k} célula ${i} campo ${pk}: ${String(v)} fora de (0, ${MAX_PLAUSIVEL}]`,
          );
        }
      }
    }
    if (!temPct) faltando.push(k);
  }
  if (faltando.length > 0) {
    throw new TrpValidationError(
      "draft incompleto: produtos ausentes ou sem percentual",
      `faltando: ${faltando.join(", ")} (esperados ${EXPECTED_PRODUCTS.length})`,
    );
  }
}
