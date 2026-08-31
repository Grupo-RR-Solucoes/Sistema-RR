// ============================================================================
// Auditoria ADS/BBTS — 1A: monta o DRAFT da régua BBTS a partir do PDF.
//
// PDF -> parseBbtsPdf (extração crua) -> RegraBbts (shape canônico) -> GATE de
// sanidade (validarRegraBbts) -> { regraDraft, meta, confianca }.
//
// CONFIANÇA (mesmo padrão da TRP): o parser separa o que ele PROVOU (os
// percentuais — extraídos pela regra "as N últimas % da linha") do que ele
// INFERIU (faixa de juros herdada de célula mesclada, tíquete propagado,
// fragmentos quebrados no PDF). O que é inferido vai para "conferir" e aparece na
// tela para o sócio bater contra o PDF antes de gravar.
//
// VIGÊNCIA: reusa lib/trp/vigencia.ts (janela RR holiday-aware: último dia útil do
// mês anterior -> penúltimo dia útil do mês nominal). NÃO existe segunda lógica de
// vigência no sistema. A data que o PDF declara ("Vigência a partir de 30/06/2026")
// é mapeada para a COMPETÊNCIA por competenciaDaData — ou seja, um PDF com vigência
// 30/06/2026 é a tabela de JULHO/2026 (a janela de julho começa no último dia útil
// de junho).
//
// READ-ONLY: não escreve nada.
// ============================================================================

import {
  BbtsValidationError,
  EXPECTED_GROUPS,
  FAIXA_LABELS,
  PARSER_VERSION_BBTS,
  SHAPE_VERSION_BBTS,
  type RegraBbts,
} from "@/lib/bbts/regraBbts";
import { parseBbtsPdf, type MatrizCrua } from "@/lib/bbts/parseBbtsPdf";
import { validarRegraBbts } from "@/lib/bbts/validateRegraBbts";
import { competenciaDaData, competenciaKey, vigenciaDaCompetencia } from "@/lib/trp/vigencia";

/** Um ponto que o parser NÃO provou — o sócio confere na tela antes de gravar. */
export interface ConferirItemBbts {
  grupo: string;
  celula?: number;
  motivo: string;
}

export interface BbtsDraftMeta {
  competencia: string; // "YYYY-MM"
  vigencia_pdf: string | null; // o que o PDF declara ("2026-06-30")
  valid_from: string;
  valid_until: string;
  shape_version: string;
  parser_version: string;
  source_filename: string | null;
  sha256: string | null;
  /** contagem de células por grupo (o sócio bate de olho contra o PDF). */
  celulas_por_grupo: Record<string, number>;
  total_celulas: number;
  /** códigos de convênio que o PDF enumera (só as exceções). */
  convenios_mapeados: number;
}

export interface BbtsDraftResult {
  regraDraft: RegraBbts;
  meta: BbtsDraftMeta;
  confianca: {
    provado: string[];
    conferir: ConferirItemBbts[];
  };
}

export interface BuildBbtsDraftOptions {
  /** "YYYY-MM". Se omitida, é derivada da vigência declarada no PDF. */
  competencia?: string;
  sourceFilename?: string | null;
  sha256?: string | null;
}

/** Competência plausível (mesma guarda da TRP: nada fora de 2022-01..2030-12). */
export function validarCompetenciaBbts(competencia: string): void {
  if (!/^\d{4}-\d{2}$/.test(competencia)) {
    throw new BbtsValidationError("competencia invalida", `esperado YYYY-MM, recebido '${competencia}'`);
  }
  const [y, m] = competencia.split("-").map(Number);
  if (y < 2022 || y > 2030 || m < 1 || m > 12) {
    throw new BbtsValidationError("competencia fora da faixa plausivel", competencia);
  }
}

function montarRegra(
  crua: MatrizCrua,
  competencia: string,
  opts: BuildBbtsDraftOptions,
): { regra: RegraBbts; conferir: ConferirItemBbts[] } {
  const vig = vigenciaDaCompetencia(competencia);
  const conferir: ConferirItemBbts[] = [];

  const grupos: RegraBbts["grupos"] = {};
  for (const [key, g] of Object.entries(crua.grupos)) {
    grupos[key] = {
      titulo: g.titulo,
      celulas: g.celulas.map((c) => {
        // _conferir é ruído de parse: sai do dado gravado e vira item de revisão.
        const { _conferir, ...limpa } = c;
        return limpa;
      }),
    };
    g.celulas.forEach((c, i) => {
      for (const motivo of c._conferir ?? []) {
        conferir.push({ grupo: key, celula: i, motivo });
      }
    });
  }

  // Os grupos ESPERADOS que este documento nao trouxe (ou trouxe sem celula).
  // Mesmo criterio do validador, para as duas listas nunca divergirem.
  const gruposAusentes = EXPECTED_GROUPS.filter((k) => {
    const g = grupos[k];
    return !g || !Array.isArray(g.celulas) || g.celulas.length === 0;
  });

  const regra: RegraBbts = {
    _meta: {
      shape: SHAPE_VERSION_BBTS,
      competencia,
      vigencia_inicio: vig.validFrom,
      vigencia_fim: vig.validUntil,
      vigencia_pdf: crua.vigenciaPdf,
      faixas: [...FAIXA_LABELS],
      faixas_enquadramento: crua.faixasEnquadramento,
      modelo_pagamento: {
        avt_teto: crua.avtTeto ?? Number.NaN,
        prt: crua.prtRegra ?? "",
      },
      fonte_pdf: opts.sourceFilename ?? null,
      parser_version: PARSER_VERSION_BBTS,
    },
    convenios: crua.convenios,
    grupos,
    // AUSENCIA DECLARADA: o que o documento NAO trouxe vira DADO, aqui, em vez
    // de virar recusa da regua inteira. A lista sai da comparacao com
    // EXPECTED_GROUPS e o validador cobra que ela bata exatamente — ver a nota
    // em RegraBbts.grupos_ausentes. Chave OMITIDA quando nao falta nada: assim
    // `regra_json ? 'grupos_ausentes'` no SQL ja separa as reguas completas das
    // que perderam grupo, sem precisar comparar array vazio.
    ...(gruposAusentes.length > 0 ? { grupos_ausentes: gruposAusentes } : {}),
    ...(crua.seguro ? { seguro: crua.seguro } : {}),
  };

  return { regra, conferir };
}

/**
 * PDF -> draft revisável da régua BBTS. Lança BbtsParseError/BbtsValidationError
 * (a rota converte em 422): NUNCA devolve meia-régua.
 */
export async function buildBbtsDraft(
  pdfBytes: Uint8Array,
  opts: BuildBbtsDraftOptions = {},
): Promise<BbtsDraftResult> {
  const crua = await parseBbtsPdf(pdfBytes);

  // Competência: a informada tem precedência; senão, derivada da vigência do PDF
  // pela janela RR (30/06/2026 -> competência 2026-07).
  let competencia: string;
  if (opts.competencia) {
    competencia = competenciaKey(opts.competencia);
  } else if (crua.vigenciaPdf) {
    competencia = competenciaDaData(crua.vigenciaPdf);
  } else {
    throw new BbtsValidationError(
      "competencia nao informada e nao deduzivel",
      "o PDF nao traz 'Vigencia a partir de DD/MM/AAAA' e nenhuma competencia foi informada",
    );
  }
  validarCompetenciaBbts(competencia);

  const { regra, conferir } = montarRegra(crua, competencia, opts);

  // GATE: trava antes de qualquer coisa chegar à tela ou ao banco.
  validarRegraBbts(regra, competencia);

  // Divergência entre a competência informada e a que o PDF declara: NÃO trava
  // (o sócio pode estar subindo uma tabela para outra competência), mas grita.
  if (crua.vigenciaPdf) {
    const derivada = competenciaDaData(crua.vigenciaPdf);
    if (derivada !== competencia) {
      conferir.push({
        grupo: "_meta",
        motivo:
          `o PDF declara vigencia a partir de ${crua.vigenciaPdf} (competencia ${derivada} pela janela RR), ` +
          `mas voce esta gravando em ${competencia}`,
      });
    }
  }

  // Mapa de convênios: por natureza INCOMPLETO (o PDF só enumera as exceções).
  const convCount = Object.keys(regra.convenios).length;
  conferir.push({
    grupo: "convenios",
    motivo:
      `o PDF enumera ${convCount} codigos de convenio (apenas as EXCECOES: Bonificado/Reduzidos). ` +
      "Os convenios do caso comum (INSS, SIAPE, Demais Publicos, Privados) NAO tem codigo listado na " +
      "tabela — o de-para codigo->grupo do fechamento precisa de outra fonte.",
  });

  if (!crua.seguro) {
    conferir.push({ grupo: "seguro", motivo: "tabela do Seguro Prestamista nao encontrada no PDF" });
  }

  const celulasPorGrupo: Record<string, number> = {};
  let total = 0;
  for (const key of EXPECTED_GROUPS) {
    const n = regra.grupos[key]?.celulas.length ?? 0;
    celulasPorGrupo[key] = n;
    total += n;
  }

  const provado: string[] = [
    `${total} celulas lidas em ${EXPECTED_GROUPS.length} grupos (percentuais extraidos pela regra "as N ultimas % da linha")`,
    "todas as faixas crescentes dentro da celula (Faixa 1 <= ... <= Faixa 5)",
    `todos os percentuais em (0, 15%]`,
    `teto do a-vista lido do PDF: ${((crua.avtTeto ?? 0) * 100).toFixed(2)}%`,
    `faixas de enquadramento lidas: ${crua.faixasEnquadramento.length}`,
    ...(crua.seguro
      ? [`seguro prestamista: slip ${crua.seguro.slip.length} faixas de prazo + estoque`]
      : []),
  ];

  const vig = vigenciaDaCompetencia(competencia);
  return {
    regraDraft: regra,
    meta: {
      competencia,
      vigencia_pdf: crua.vigenciaPdf,
      valid_from: vig.validFrom,
      valid_until: vig.validUntil,
      shape_version: SHAPE_VERSION_BBTS,
      parser_version: PARSER_VERSION_BBTS,
      source_filename: opts.sourceFilename ?? null,
      sha256: opts.sha256 ?? null,
      celulas_por_grupo: celulasPorGrupo,
      total_celulas: total,
      convenios_mapeados: convCount,
    },
    confianca: { provado, conferir },
  };
}
