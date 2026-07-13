// ============================================================================
// Auditoria ADS/BBTS — 1A: GATE DE SANIDADE da régua BBTS.
//
// Um erro de leitura contamina TUDO a jusante (auditoria, recebíveis, caixa). Por
// isso o princípio é o mesmo da TRP: na dúvida, TRAVA e avisa — nunca grava uma
// régua pela metade.
//
// Roda em DOIS momentos (defesa em profundidade):
//   1. logo após o parse (buildBbtsDraft) — antes de mostrar na tela;
//   2. de novo no commit (commitBbtsVersion) — o servidor NÃO confia no draft que
//      o client devolveu (pode ter sido editado/adulterado).
//
// TRAVAS (BbtsValidationError -> 422, nada gravado):
//   - grupo esperado ausente ou sem célula;
//   - célula sem as 5 faixas (ou sem a faixa única, no BB Energia);
//   - percentual não-finito ou fora de (0, MAX_PLAUSIVEL];
//   - faixas NÃO crescentes dentro da célula (Faixa 1 <= ... <= Faixa 5) — é a
//     assinatura de coluna desalinhada, o modo de falha clássico de parse de PDF;
//   - grupo bonificado com célula sem adicional (a linha "+0,35%..." se perdeu);
//   - faixas de enquadramento (pág. 8) ausentes/incompletas;
//   - teto do à-vista não encontrado.
// ============================================================================

import {
  AVT_TETO,
  BbtsValidationError,
  EXPECTED_GROUPS,
  FAIXA_LABELS,
  FAIXA_UNICA,
  GRUPOS_BONIFICADOS,
  GRUPOS_FAIXA_UNICA,
  MAX_PLAUSIVEL,
  type RegraBbts,
} from "@/lib/bbts/regraBbts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function checarPct(valor: unknown, onde: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0 || valor > MAX_PLAUSIVEL) {
    throw new BbtsValidationError(
      "percentual implausivel na regua (lido/adulterado errado)",
      `${onde}: ${String(valor)} fora de (0, ${MAX_PLAUSIVEL}]`,
    );
  }
  return valor;
}

/**
 * Valida a régua BBTS inteira. Lança BbtsValidationError na primeira violação.
 * @param competenciaCanonical se informada, exige que _meta.competencia bata.
 */
export function validarRegraBbts(regra: unknown, competenciaCanonical?: string): void {
  if (!isRecord(regra)) {
    throw new BbtsValidationError("regua ausente ou invalida", "regra_json nao e um objeto");
  }
  const meta = regra._meta;
  if (!isRecord(meta)) {
    throw new BbtsValidationError("regua sem _meta", "faltou _meta");
  }
  if (
    competenciaCanonical &&
    typeof meta.competencia === "string" &&
    meta.competencia !== competenciaCanonical
  ) {
    throw new BbtsValidationError(
      "competencia da regua diverge da informada",
      `_meta.competencia='${meta.competencia}' != '${competenciaCanonical}'`,
    );
  }

  // --- faixas de enquadramento (pág. 8) ---
  const faixasEnq = meta.faixas_enquadramento;
  if (!Array.isArray(faixasEnq) || faixasEnq.length !== FAIXA_LABELS.length) {
    throw new BbtsValidationError(
      "faixas de enquadramento nao lidas",
      `esperado ${FAIXA_LABELS.length} faixas (pag. 8 do PDF), achei ${
        Array.isArray(faixasEnq) ? faixasEnq.length : 0
      }`,
    );
  }

  // --- modelo de pagamento (teto do à-vista) ---
  const modelo = meta.modelo_pagamento;
  if (!isRecord(modelo) || typeof modelo.avt_teto !== "number" || !Number.isFinite(modelo.avt_teto)) {
    throw new BbtsValidationError(
      "teto do recebimento a vista nao lido",
      "esperado o rotulo 'Recebimento a vista' com o teto (pag. 8 do PDF)",
    );
  }
  if (Math.abs(modelo.avt_teto - AVT_TETO) > 1e-9) {
    throw new BbtsValidationError(
      "teto do a-vista diferente do esperado",
      `PDF diz ${(modelo.avt_teto * 100).toFixed(2)}%, o sistema espera ${(AVT_TETO * 100).toFixed(2)}% — ` +
        "se a BBTS mudou o teto, isso e uma DECISAO de negocio, nao um ajuste de parser",
    );
  }

  // --- grupos e células ---
  const grupos = regra.grupos;
  if (!isRecord(grupos)) {
    throw new BbtsValidationError("regua sem grupos", "faltou a chave 'grupos'");
  }

  const faltando: string[] = [];
  for (const key of EXPECTED_GROUPS) {
    const g = grupos[key];
    if (!isRecord(g) || !Array.isArray(g.celulas) || g.celulas.length === 0) {
      faltando.push(key);
    }
  }
  if (faltando.length > 0) {
    throw new BbtsValidationError(
      "regua incompleta: grupos ausentes ou sem celula",
      `faltando: ${faltando.join(", ")} (esperados ${EXPECTED_GROUPS.length})`,
    );
  }

  for (const key of EXPECTED_GROUPS) {
    const g = grupos[key] as { celulas: unknown[] };
    const unica = GRUPOS_FAIXA_UNICA.includes(key);
    const labels: readonly string[] = unica ? [FAIXA_UNICA] : FAIXA_LABELS;
    const bonificado = GRUPOS_BONIFICADOS.includes(key);

    g.celulas.forEach((celRaw, i) => {
      if (!isRecord(celRaw) || !isRecord(celRaw.faixas)) {
        throw new BbtsValidationError("celula invalida", `${key} celula ${i} sem 'faixas'`);
      }
      const faixas = celRaw.faixas as Record<string, unknown>;

      const bases: number[] = [];
      const adicionais: number[] = [];
      for (const lab of labels) {
        const pct = faixas[lab];
        if (!isRecord(pct)) {
          throw new BbtsValidationError(
            "celula sem todas as faixas",
            `${key} celula ${i}: faltou '${lab}' (a coluna pode ter saido desalinhada)`,
          );
        }
        bases.push(checarPct(pct.base, `${key} celula ${i} ${lab}.base`));
        if (pct.adicional !== undefined) {
          adicionais.push(checarPct(pct.adicional, `${key} celula ${i} ${lab}.adicional`));
        } else if (bonificado) {
          throw new BbtsValidationError(
            "celula bonificada sem adicional",
            `${key} celula ${i} ${lab}: a linha de bonificacao ('+0,35%...') nao foi lida`,
          );
        }
      }

      // Monotonicidade: a tabela cresce da Faixa 1 para a Faixa 5. Quebra aqui =
      // coluna desalinhada no parse (falha silenciosa clássica de PDF).
      if (!unica) {
        for (let k = 1; k < bases.length; k++) {
          if (bases[k] < bases[k - 1] - 1e-9) {
            throw new BbtsValidationError(
              "faixas nao crescentes na celula (coluna desalinhada?)",
              `${key} celula ${i}: ${bases.map((b) => (b * 100).toFixed(3) + "%").join(" ")}`,
            );
          }
        }
        for (let k = 1; k < adicionais.length; k++) {
          if (adicionais[k] < adicionais[k - 1] - 1e-9) {
            throw new BbtsValidationError(
              "bonificacao nao crescente na celula (coluna desalinhada?)",
              `${key} celula ${i}: ${adicionais.map((b) => (b * 100).toFixed(3) + "%").join(" ")}`,
            );
          }
        }
      }
    });
  }
}
