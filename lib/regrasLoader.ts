/**
 * Loader de regras Promotiva — API pública para Camada 1 e Camada 2 (Fases 4.2/4.3).
 *
 * Responsabilidades:
 * 1. getRegra(mes) — retorna a regra do mês (com flag regraInferida quando fallback).
 * 2. getRegime(mes) — retorna o regime do mês (META_2_NIVEIS, META_4_NIVEIS, VOLUME_*).
 * 3. lookupPct(mes, categoria, taxa, prazo, tabLabel) — lookup com EPS=1e-7 + traceability G22.
 *
 * Fonte: stress_test_workspace_local/TRANSFERENCIA_CONHECIMENTO_SISTEMA.md §6, §9, §4.3
 * Validação reversa: stress_test_workspace_local/validacao_reversa_p2_p3.md
 *
 * NÃO implementa Camada 1 nem Camada 2 — apenas o loader.
 */

import type { LookupPctResult, Regime } from "./types/blocos.ts";
import {
  MAPA_MES_REGRA,
  CONVENIOS_OFICIAIS,
  type RegraMes,
  type RegraCelula,
  type RegraCategoriaProduto,
} from "./regrasData.ts";

/**
 * Tolerância de comparação de taxas (corrige bug #3 v8).
 *
 * Taxas vêm de XLSX/Promotiva e podem ter ruído de ponto flutuante (ex.: 1,65%
 * representado como 0.018000000000000002). EPS=1e-7 permite que valores como
 * 0.018 e 0.018000000000000002 caiam na mesma faixa de matriz.
 */
export const EPS = 1e-7;

// ---------------------------------------------------------------------------
// API: getRegra / getRegime
// ---------------------------------------------------------------------------

/**
 * Retorna a regra vigente para o mês informado.
 * @param mes formato ISO YYYY-MM (ex.: "2024-07")
 * @returns { regra, jsonRegra, regraInferida } ou null se mês fora da cobertura
 */
export function getRegra(mes: string): {
  regra: RegraMes;
  jsonRegra: string;
  regraInferida: boolean;
} | null {
  const entry = MAPA_MES_REGRA[mes];
  if (!entry) return null;
  return {
    regra: entry.regra,
    jsonRegra: entry.jsonRegra,
    regraInferida: entry.regraInferida,
  };
}

/**
 * Retorna o regime canônico do mês.
 *
 * Implementa a tabela de spec v9 §9. Se o JSON do mês trouxer `_meta.regime`
 * inconsistente com a tabela canônica, o valor da tabela prevalece (defesa
 * contra inconsistências de metadados).
 */
export function getRegime(mes: string): Regime {
  // Tabela canônica spec v9 §9
  if (mes >= "2022-12" && mes <= "2023-05") return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
  if (mes >= "2023-06" && mes <= "2024-12") return "META_2_NIVEIS";
  if (mes >= "2025-01" && mes <= "2025-06") return "META_4_NIVEIS";
  if (mes >= "2025-07" && mes <= "2025-12") return "VOLUME_6_PERFIS";
  if (mes >= "2026-01" && mes <= "2026-03") return "VOLUME_3_PERFIS";
  if (mes >= "2026-04") return "VOLUME_5_FAIXAS";
  // Pré Dez/2022 ou data inválida — devolve META 2 (mais antigo) por consistência;
  // chamador deve checar com getRegra() == null antes.
  return "META_2_NIVEIS_MATRIZ_TAXA_PRAZO";
}

// ---------------------------------------------------------------------------
// Função pura — lookupPctInRegra (testável sem mocks)
// ---------------------------------------------------------------------------

/**
 * Comparação de range com EPS — `min - EPS <= valor <= max + EPS`.
 */
function inRange(valor: number, min?: number, max?: number): boolean {
  const lo = typeof min === "number" ? min - EPS : -Infinity;
  const hi = typeof max === "number" ? max + EPS : Infinity;
  return valor >= lo && valor <= hi;
}

/**
 * Lookup puro: dado uma regra mensal já resolvida, encontra o pct para o
 * contrato. Não acessa MAPA_MES_REGRA — recebe a regra como parâmetro.
 *
 * @param regra estrutura RegraMes (de getRegra)
 * @param categoriaProduto chave da categoria (ex.: "INSS", "INSS_NOVO", "CONSIG_GERAL")
 * @param taxa taxa de juros do contrato em decimal (ex.: 0.0165 = 1,65%)
 * @param prazo prazo em meses
 * @param tabLabel label da tabela vigente (ex.: "Tabela 1", "Tabela 2",
 *                "Tabela Intermediária 1", "Faixa 3", "Rubi", "pct_geral")
 * @param jsonRegra nome do arquivo JSON (para trace)
 * @param regraInferida true se regra é fallback
 *
 * Implementa Bug #6: ADIANTAMENTO_13 com taxa < tx_juros_min retorna pct null.
 */
export function lookupPctInRegra(
  regra: RegraMes,
  categoriaProduto: string,
  taxa: number,
  prazo: number,
  tabLabel: string,
  jsonRegra: string,
  regraInferida: boolean
): LookupPctResult {
  const cat = regra[categoriaProduto] as RegraCategoriaProduto | undefined;
  if (!cat || typeof cat !== "object") {
    return { pct: null, celula: null, jsonRegra, regraInferida };
  }

  // Bug #6: ADIANTAMENTO_13 (e demais categorias com tx_juros_min) — se taxa
  // declarada no contrato é menor que tx_juros_min do JSON, contrato está
  // FORA_DA_TABELA. v8 atual retorna pct positivo erroneamente.
  //
  // TODO Fase 4.4: revisar tx_juros_min para ADIANTAMENTO_13.
  //   V8 e V9 humanas IGNORAM este check — motor TS espelha esta convenção
  //   nesta fase (skip APENAS para ADIANTAMENTO_13). 6 contratos no batch
  //   full são tratados como SUBPAGAMENTO por v9 mesmo com taxa abaixo do
  //   tx_juros_min declarado (~R$ 227 total). 1 contrato outlier (204131022,
  //   Fev/2026) v9 marcou FORA_DA_TABELA — v9 NÃO É CONSISTENTE INTERNAMENTE.
  //   Identificar critério do outlier e investigar PDFs originais TRP07/08
  //   antes de remover este skip. Risco se removido sem revisão: motor
  //   diverge do email enviado 07/05/2026 que cobrou esses 6 contratos.
  //   Ver gap_analysis.md "DÍVIDA TÉCNICA — Fase 4.4 — PADRAO_B_ADIANTAMENTO_13_TX_JUROS_MIN".
  const skipTxJurosMin = categoriaProduto === "ADIANTAMENTO_13";
  if (
    !skipTxJurosMin &&
    typeof cat.tx_juros_min === "number" &&
    taxa < cat.tx_juros_min - EPS
  ) {
    return {
      pct: null,
      celula: `${categoriaProduto}: taxa ${taxa} < tx_juros_min ${cat.tx_juros_min} (FORA_DA_TABELA)`,
      jsonRegra,
      regraInferida,
    };
  }

  // Categoria tem prazo_min/prazo_max global? Validar antes de iterar células.
  //
  // TODO Fase 4.4: revisar prazo_min para FGTS.
  //   V9 humana IGNORA prazo_min=36 declarado em TRP15+ FGTS, usando
  //   pct_geral=0.042 mesmo para prazo<36. Mudança Jan/2025 (TRP15)
  //   prazo_min=2→36 é DELIBERADA conforme histórico longitudinal dos 41
  //   JSONs. Suporte documental: confirmar nos PDFs TRP15 originais se
  //   prazo_min é regra dura ou orientação. Motor TS espelha v9 nesta fase
  //   (skip APENAS para FGTS) por consistência com email enviado 07/05/2026.
  //   NÃO ESTENDER esta regra a outras categorias (INSS, NAO_CONSIGNADO, etc.)
  //   sem revisão Fase 4.4. Impacto: ~R$ 267 em 3 contratos.
  //   Ver gap_analysis.md "DÍVIDA TÉCNICA — Fase 4.4 — PADRAO_C_FGTS_PRAZO_MIN".
  const skipPrazoMin = categoriaProduto === "FGTS";
  if (
    !skipPrazoMin &&
    typeof cat.prazo_min === "number" &&
    prazo < cat.prazo_min
  ) {
    return {
      pct: null,
      celula: `${categoriaProduto}: prazo ${prazo} < prazo_min ${cat.prazo_min} (FORA_DA_TABELA)`,
      jsonRegra,
      regraInferida,
    };
  }
  if (typeof cat.prazo_max === "number" && prazo > cat.prazo_max) {
    return {
      pct: null,
      celula: `${categoriaProduto}: prazo ${prazo} > prazo_max ${cat.prazo_max} (FORA_DA_TABELA)`,
      jsonRegra,
      regraInferida,
    };
  }

  // pct_geral em nível de categoria (ex.: FGTS único)
  if (typeof cat.pct_geral === "number" && tabLabel === "pct_geral") {
    return {
      pct: cat.pct_geral,
      celula: `${categoriaProduto}: pct_geral=${cat.pct_geral}`,
      jsonRegra,
      regraInferida,
    };
  }

  // Encontrar matriz a iterar (ordem de preferência por especificidade)
  const matriz: RegraCelula[] | undefined =
    cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas;

  if (!matriz || matriz.length === 0) {
    return { pct: null, celula: null, jsonRegra, regraInferida };
  }

  for (const celula of matriz) {
    const taxaOk = inRange(taxa, celula.tx_min, celula.tx_max);
    const prazoOk = inRange(prazo, celula.prazo_min, celula.prazo_max);
    if (!taxaOk || !prazoOk) continue;

    // Match — extrair pct pela tabLabel
    if (tabLabel === "pct_geral") {
      // Algumas células têm pct_geral local
      if (typeof celula.pct_geral === "number") {
        return {
          pct: celula.pct_geral,
          celula: descreverCelula(categoriaProduto, celula, "pct_geral"),
          jsonRegra,
          regraInferida,
        };
      }
    }
    const pct = celula[tabLabel];
    if (typeof pct === "number") {
      return {
        pct,
        celula: descreverCelula(categoriaProduto, celula, tabLabel),
        jsonRegra,
        regraInferida,
      };
    }
  }

  // Nenhuma célula casou
  return { pct: null, celula: null, jsonRegra, regraInferida };
}

/**
 * Constrói descrição textual de uma célula que matchou (para trace G22).
 * Ex.: "INSS taxa_min:1.65, taxa_max:1.69, prazo_min:36, prazo_max:48 → Tabela 2: 6.00%"
 */
function descreverCelula(
  categoriaProduto: string,
  celula: RegraCelula,
  tabLabel: string
): string {
  const partes: string[] = [];
  if (typeof celula.tx_min === "number") partes.push(`taxa_min:${celula.tx_min}`);
  if (typeof celula.tx_max === "number") partes.push(`taxa_max:${celula.tx_max}`);
  if (typeof celula.prazo_min === "number") partes.push(`prazo_min:${celula.prazo_min}`);
  if (typeof celula.prazo_max === "number") partes.push(`prazo_max:${celula.prazo_max}`);
  const pct = celula[tabLabel];
  return `${categoriaProduto} ${partes.join(", ")} → ${tabLabel}: ${pct}`;
}

// ---------------------------------------------------------------------------
// API: lookupPct (combina getRegra + lookupPctInRegra)
// ---------------------------------------------------------------------------

/**
 * Lookup completo: dado mês + categoria + taxa + prazo + tabLabel, retorna
 * pct + trace. Versão de conveniência que internamente chama getRegra().
 */
export function lookupPct(
  mes: string,
  categoriaProduto: string,
  taxa: number,
  prazo: number,
  tabLabel: string
): LookupPctResult {
  const r = getRegra(mes);
  if (!r) {
    return { pct: null, celula: null, jsonRegra: null, regraInferida: false };
  }
  return lookupPctInRegra(
    r.regra,
    categoriaProduto,
    taxa,
    prazo,
    tabLabel,
    r.jsonRegra,
    r.regraInferida
  );
}

// ---------------------------------------------------------------------------
// Reexports utilitários
// ---------------------------------------------------------------------------

export { CONVENIOS_OFICIAIS, MAPA_MES_REGRA };
export type { RegraMes, RegraCelula, RegraCategoriaProduto };

/**
 * Lista de meses cobertos (auditoria/diagnóstico).
 */
export function listarMesesCobertos(): string[] {
  return Object.keys(MAPA_MES_REGRA).sort();
}

/**
 * Resumo de cobertura (auditoria/diagnóstico).
 */
export function resumoCobertura(): {
  total: number;
  diretos: number;
  inferidos: number;
  primeiroMes: string;
  ultimoMes: string;
} {
  const meses = listarMesesCobertos();
  let diretos = 0;
  let inferidos = 0;
  for (const m of meses) {
    if (MAPA_MES_REGRA[m].regraInferida) inferidos += 1;
    else diretos += 1;
  }
  return {
    total: meses.length,
    diretos,
    inferidos,
    primeiroMes: meses[0],
    ultimoMes: meses[meses.length - 1],
  };
}

// ===========================================================================
// API: getRegraEnquadramento — Fase 4.2 (Camada 1)
// ===========================================================================
//
// Encapsula em uma única estrutura tudo que enquadramento.ts precisa para
// decidir Cat_Devida, sem que esse caller precise duplicar lógica de regime.
// Vide brief Fase 4.2 — "regrasLoader expõe getRegraEnquadramento, e
// enquadramento.ts apenas APLICA o objeto".
//
// Esta função é aditiva sobre o regrasLoader 4.1 — não muda APIs existentes.
// As regras encodadas aqui são *spec Promotiva* (não derivadas dos JSONs por
// `_meta.limites_categoria`, que tem schemas inconsistentes entre regimes).
// Fonte: TRP15 texto literal (META 4), errata OPP099 (06/09/2023), TRP24+
// (VOLUME 6 perfis), TRP32+ (Rubi/Safira/Diamante), TRP35 (Faixa 1-5).

/** Tier por meta atingida em regimes META. */
export interface MetaTier {
  /** Categoria no formato canônico v9 (uppercase): "TABELA 1", "TABELA 2",
   * "TABELA INTERMEDIÁRIA 1", "TABELA INTERMEDIÁRIA 2". */
  categoria: string;
  /** Limite inferior inclusivo em decimal (ex.: 0.95). null = -infinito. */
  metaMin: number | null;
  /** Limite superior exclusivo em decimal (ex.: 1.0). null = +infinito. */
  metaMax: number | null;
}

/** Tier por produção líquida em regimes VOLUME. */
export interface VolumeTier {
  /** Categoria no formato canônico (uppercase): "RUBI", "SAFIRA", "DIAMANTE",
   * "FAIXA 1"-"FAIXA 5", "VAREJO I", "VAREJO II", "MIDDLE", "UPPER MIDDLE",
   * "CORPORATE", "LARGE CORPORATE". */
  categoria: string;
  /** Limite inferior inclusivo em R$. */
  prodMin: number;
  /** Limite superior exclusivo em R$. null = +infinito. */
  prodMax: number | null;
}

/** Estrutura completa de regra de enquadramento mensal. */
export interface RegraEnquadramento {
  mes: string;                      // ISO YYYY-MM
  regime: Regime;
  jsonRegra: string;
  regraInferida: boolean;
  /** "META" → usa metaTiers + opp099. "VOLUME" → cat_devida = null (auditoria
   * marca INDETERMINADO; Promotiva aplica perfis sem critério publicado). */
  type: "META" | "VOLUME";
  metaTiers: MetaTier[] | null;
  /** Listado para diagnóstico — não usado pela Camada 1 (que retorna
   * INDETERMINADO em VOLUME). Camada 2 pode usar se necessário. */
  volumeTiers: VolumeTier[] | null;
  /** Configuração da regra promocional OPP099. null = não vigente nesse mês. */
  opp099: {
    metaMinTrigger: number;     // 0.90 inclusivo
    metaMaxTrigger: number;     // 1.00 exclusivo
    pctPenTrigger: number;      // 0.30 mínimo
    upgradeToCategoria: string; // "TABELA 2"
    fonte: string;              // "OPP099 (errata 06/09/2023)"
  } | null;
}

// Tabela canônica de tiers META — não muda entre meses do mesmo regime.
const TIERS_META_2_NIVEIS: MetaTier[] = [
  { categoria: "TABELA 1", metaMin: null, metaMax: 1.0 },
  { categoria: "TABELA 2", metaMin: 1.0, metaMax: null },
];

// META 4 NIVEIS — TRP15 texto literal (Jan-Jun/2025).
const TIERS_META_4_NIVEIS: MetaTier[] = [
  { categoria: "TABELA 1", metaMin: null, metaMax: 0.95 },
  { categoria: "TABELA INTERMEDIÁRIA 1", metaMin: 0.95, metaMax: 0.97 },
  { categoria: "TABELA INTERMEDIÁRIA 2", metaMin: 0.97, metaMax: 1.0 },
  { categoria: "TABELA 2", metaMin: 1.0, metaMax: null },
];

// VOLUME 6 PERFIS — TRP24/PR2025/103 (Jul-Dez/2025).
const TIERS_VOLUME_6: VolumeTier[] = [
  { categoria: "VAREJO I", prodMin: 0, prodMax: 1_000_000 },
  { categoria: "VAREJO II", prodMin: 1_000_000, prodMax: 3_000_000 },
  { categoria: "MIDDLE", prodMin: 3_000_000, prodMax: 5_000_000 },
  { categoria: "UPPER MIDDLE", prodMin: 5_000_000, prodMax: 7_000_000 },
  { categoria: "CORPORATE", prodMin: 7_000_000, prodMax: 10_000_000 },
  { categoria: "LARGE CORPORATE", prodMin: 10_000_000, prodMax: null },
];

// VOLUME 3 PERFIS — TRP32 (Jan-Mar/2026). Rubi/Safira/Diamante.
const TIERS_VOLUME_3: VolumeTier[] = [
  { categoria: "RUBI", prodMin: 1_000_000, prodMax: 3_000_000 },
  { categoria: "SAFIRA", prodMin: 3_000_000, prodMax: 7_000_000 },
  { categoria: "DIAMANTE", prodMin: 7_000_000, prodMax: null },
];

// VOLUME 5 FAIXAS — TRP35 (Abr/2026+). Faixa 1-5 conforme P1.4.
const TIERS_VOLUME_5: VolumeTier[] = [
  { categoria: "FAIXA 1", prodMin: 0, prodMax: 1_000_000 },
  { categoria: "FAIXA 2", prodMin: 1_000_000, prodMax: 3_000_000 },
  { categoria: "FAIXA 3", prodMin: 3_000_000, prodMax: 7_000_000 },
  { categoria: "FAIXA 4", prodMin: 7_000_000, prodMax: 20_000_000 },
  { categoria: "FAIXA 5", prodMin: 20_000_000, prodMax: null },
];

/**
 * OPP099 — errata Promotiva 06/09/2023 (PR2023/099). Vigente Set/2023 a
 * Jun/2025 nos regimes META_2_NIVEIS e META_4_NIVEIS. Texto literal:
 *   "Caso o desempenho fique entre 90% e 99,99% da meta de produção do
 *    crédito em conjunto com índice de penetração financeira mínima de 30%
 *    no PRESTAMISTA, gozará do benefício da tabela 2".
 *
 * Validação reversa em validacao_reversa_p2_p3.md confirmou aplicação em
 * META_2 (1.136 contratos promovidos em Jul+Set/2024) — em META_4 a regra
 * fica vigente por princípio mas dados Jan-Jun/2025 não exercitaram o
 * cenário.
 */
function buildOpp099(mes: string, regime: Regime): RegraEnquadramento["opp099"] {
  const vigente = mes >= "2023-09" && mes <= "2025-06";
  const aplicavel = regime === "META_2_NIVEIS" || regime === "META_4_NIVEIS";
  if (!vigente || !aplicavel) return null;
  return {
    metaMinTrigger: 0.9,
    metaMaxTrigger: 1.0,
    pctPenTrigger: 0.3,
    upgradeToCategoria: "TABELA 2",
    fonte: "OPP099 (errata 06/09/2023)",
  };
}

/**
 * Retorna a regra de enquadramento (Cat_Devida) para o mês, no formato que
 * a Camada 1 (lib/enquadramento.ts) consome diretamente.
 *
 * Para meses sem cobertura no MAPA_MES_REGRA, ainda retorna o regime via
 * `getRegime` e os tiers correspondentes (com regraInferida=true,
 * jsonRegra="(sem JSON nativo)"). Isso permite tratar Abr/2026+ mesmo
 * quando o JSON está em rascunho.
 */
export function getRegraEnquadramento(mes: string): RegraEnquadramento {
  const r = getRegra(mes);
  const regime = getRegime(mes);
  const jsonRegra = r ? r.jsonRegra : "(sem JSON nativo)";
  const regraInferida = r ? r.regraInferida : true;
  let metaTiers: MetaTier[] | null = null;
  let volumeTiers: VolumeTier[] | null = null;
  let type: "META" | "VOLUME";
  switch (regime) {
    case "META_2_NIVEIS_MATRIZ_TAXA_PRAZO":
    case "META_2_NIVEIS":
      type = "META";
      metaTiers = TIERS_META_2_NIVEIS;
      break;
    case "META_4_NIVEIS":
      type = "META";
      metaTiers = TIERS_META_4_NIVEIS;
      break;
    case "VOLUME_6_PERFIS":
      type = "VOLUME";
      volumeTiers = TIERS_VOLUME_6;
      break;
    case "VOLUME_3_PERFIS":
      type = "VOLUME";
      volumeTiers = TIERS_VOLUME_3;
      break;
    case "VOLUME_5_FAIXAS":
      type = "VOLUME";
      volumeTiers = TIERS_VOLUME_5;
      break;
  }
  return {
    mes,
    regime,
    jsonRegra,
    regraInferida,
    type,
    metaTiers,
    volumeTiers,
    opp099: buildOpp099(mes, regime),
  };
}

// ===========================================================================
// API: getMatrizTRPParaContrato — Fase 4.3 (Camada 2 À Vista)
// ===========================================================================
//
// Encapsula em uma única função tudo que auditoriaAvista.ts precisa para
// resolver o pct devido de um contrato sob a Cat_Devida da Camada 1.
//
// Estratégia (ordem):
//   1. catDevidaCanonical → tabLabel do JSON (TABELA 2 → "Tabela 2", FAIXA 3 → "Faixa 3", etc).
//   2. produto+tipo+convenio → lista ordenada de categorias candidatas (G24).
//   3. Para cada candidato, lookupPctInRegra(taxa, prazo, tabLabel) com EPS=1e-7.
//   4. Para PORTAB sem variação por categoria, fallback para "pct_geral".
//   5. Retorna primeiro pct não-null + trace completo.
//
// NÃO aplica teto BACEN aqui — o caller (auditoriaAvista.ts) faz min(pct, teto).
// `pct` retornado é "pct cheio" da matriz.

/** Mapeia categoria canônica (UPPERCASE v9) → tabLabel usado nas chaves dos JSONs. */
export function categoriaCanonicalToJsonKey(catCanonical: string | null): string | null {
  if (!catCanonical) return null;
  const u = catCanonical.normalize("NFC").trim().toUpperCase().replace(/\s+/g, " ");
  switch (u) {
    case "TABELA 1": return "Tabela 1";
    case "TABELA 2": return "Tabela 2";
    case "TABELA INTERMEDIÁRIA 1":
    case "TABELA INTERMEDIARIA 1":
    case "INTER 1":
    case "INTERMEDIÁRIA 1":
    case "INTERMEDIARIA 1":
      return "Tabela Intermediaria 1";
    case "TABELA INTERMEDIÁRIA 2":
    case "TABELA INTERMEDIARIA 2":
    case "INTER 2":
    case "INTERMEDIÁRIA 2":
    case "INTERMEDIARIA 2":
      return "Tabela Intermediaria 2";
    case "RUBI": return "Rubi";
    case "SAFIRA": return "Safira";
    case "DIAMANTE": return "Diamante";
    case "VAREJO I": return "Varejo I";
    case "VAREJO II": return "Varejo II";
    case "MIDDLE": return "Middle";
    case "UPPER MIDDLE": return "Upper Middle";
    case "CORPORATE": return "Corporate";
    case "LARGE CORPORATE": return "Large Corporate";
    case "FAIXA 1": return "Faixa 1";
    case "FAIXA 2": return "Faixa 2";
    case "FAIXA 3": return "Faixa 3";
    case "FAIXA 4": return "Faixa 4";
    case "FAIXA 5": return "Faixa 5";
    default: return null;
  }
}

/**
 * Mapeia (mes, produto, tipo, convenio) → lista ordenada de candidatos a
 * categoria do JSON. Implementa G24 (validação extra 2 da Fase 4.1):
 * PORTAB checa antes de INSS, INSS_RENOV antes de INSS, NÃO CONSIGNADO antes
 * de qualquer CONSIG.
 *
 * Lista de produtos observada em audit_v9_avista (23.879 contratos):
 *   CONSIGNADO INSS (8638), NÃO CONSIGNADO (5933), CRÉDITO ADIANTAMENTO (3033),
 *   CONSIGNADO (2399), CONSIGNADO PÚBLICO/PUBLICO (1315+1201=2516),
 *   PORTABILIDADE INSS (479), CONSIGNADO PRIVADO (422), CONSIGNADO MPDG (420),
 *   CDC FGTS (17), PORTABILIDADE (9), CONSIGNADO SP (8), CONSIGNADO EXÉRCITO (4),
 *   CONSIGNADO SPMG (1).
 *
 * Variações temporais (relevantes para escolher categoria do JSON):
 *   - INSS_NOVO/INSS_RENOV existem só a partir de 2025-04 (TRP20).
 *   - PORTAB_PUBLICO/PORTAB_PRIVADO a partir de 2025-07 (TRP24).
 *   - CONSIG_PUBLICO/CONSIG_PRIVADO a partir de 2024-08 (TRP10).
 *   - CONSIG_SP_MG (merge SP+MG) a partir de 2025-01 (TRP15).
 */
export function categoriasCandidatasFor(
  mes: string,
  produto: string | null,
  tipo: string | null,
  convenio: number | string | null
): string[] {
  const p = String(produto ?? "").toUpperCase();
  const t = String(tipo ?? "").toUpperCase();
  const cv = String(convenio ?? "");

  // FGTS (raro — 17 contratos)
  if (p.includes("FGTS")) return ["FGTS"];

  // ADIANTAMENTO 13º — produto típico "CRÉDITO ADIANTAMENTO" (3033 contratos)
  if (p.includes("ADIANTAMENTO") || p.includes("13º") || p.includes("13°") || p === "13") {
    return ["ADIANTAMENTO_13"];
  }

  // PORTABILIDADE — checa ANTES de INSS porque produto pode ser "PORTABILIDADE INSS"
  if (p.includes("PORTAB")) {
    if (mes >= "2025-07") {
      // VOLUME 6 / 3 / 5 → PORTAB_PUBLICO + PORTAB_PRIVADO
      return ["PORTAB_PUBLICO", "PORTAB_PRIVADO", "PORTAB_GERAL", "PORTAB_INSS"];
    }
    if (p.includes("INSS")) return ["PORTAB_INSS", "PORTAB_GERAL"];
    return ["PORTAB_GERAL", "PORTAB_INSS"];
  }

  // NÃO CONSIGNADO — checa ANTES de INSS para evitar Bug roteamento por convenio
  // (G24 caso 2): 455 contratos em audit_v9_avista têm produto='NÃO CONSIGNADO'
  // com convenio=1640 (INSS). Esses são contratos não-consignados oferecidos
  // a aposentados INSS — devem usar matriz NAO_CONSIGNADO, não INSS. Se a
  // checagem `cv === "1640"` rodar antes do NÃO CONSIGNADO, esses contratos
  // caem em INSS Tab2 prazo 36-48 (=4,50%) em vez de NAO_CONSIGNADO Tab2
  // (=8,05% pré-teto, =6,00% após teto). Detectado em CHECKPOINT B.
  if (
    p.includes("NÃO CONSIGNADO") || p.includes("NAO CONSIGNADO") ||
    p.includes("SALÁRIO") || p.includes("SALARIO") ||
    p.includes("BENEFÍCIO") || p.includes("BENEFICIO")
  ) {
    return ["NAO_CONSIGNADO"];
  }

  // INSS — produto contém "INSS" OR (produto genérico AND convênio 1640).
  // O fallback por convênio só dispara para produtos genéricos ("CONSIGNADO"),
  // protegendo contra o bug acima. Há uns 455 contratos NÃO CONSIGNADO conv=1640
  // — esses já caíram no branch acima.
  if (p.includes("INSS") || cv === "1640") {
    if (mes >= "2025-04") {
      // TRP20+ tem split INSS_NOVO / INSS_RENOV
      if (t.includes("RENOV")) return ["INSS_RENOV", "INSS_NOVO", "INSS"];
      return ["INSS_NOVO", "INSS_RENOV", "INSS"];
    }
    return ["INSS"];
  }

  // SIAPE/MPDG — convênio 1078 ou produto contém MPDG/SIAPE
  if (p.includes("MPDG") || p.includes("SIAPE") || cv === "1078") {
    return ["SIAPE", "CONSIG_GERAL"];
  }

  // EXÉRCITO — convênio 14661 ou produto contém EXÉRCITO.
  // EXERCITO existe como categoria JSON apenas em TRP20 (abr/2025). Nos demais
  // meses, a Promotiva trata o convênio dentro de CONSIG_PUBLICO (TRP10+ e
  // VOLUME) ou CONSIG_GERAL (TRP01-09 / OPPs). Sem este fallback, contratos
  // EXÉRCITO em meses ≠ abr/2025 caíam em SEM_LOOKUP (CP3 bug A: 11 contratos).
  if (p.includes("EXÉRCITO") || p.includes("EXERCITO") || cv === "14661") {
    return ["EXERCITO", "CONSIG_PUBLICO", "CONSIG_GERAL"];
  }

  // CONSIG SP_MG — merge a partir de 2025-01 (TRP15) E em Dez/2023 (OPP139,
  // primeira aparição do unificado, antes da reversão temporária em TRP01-14).
  // CP3 bug C: 1 contrato SPMG dez/2023 (146547177) caía em CONSIG_GERAL
  // porque OPP139 só tem CONSIG_SP_MG e o threshold antigo era 2025-01.
  const SP_MG_UNIFICADO = mes >= "2025-01" || mes === "2023-12";
  if (p.includes("SPMG") || (p.includes("SP") && p.includes("MG"))) {
    if (SP_MG_UNIFICADO) return ["CONSIG_SP_MG", "CONSIG_GERAL"];
    return ["CONSIG_SP", "CONSIG_MG", "CONSIG_GERAL"];
  }
  if (p.includes("CONSIGNADO MG") || p === "MG") {
    if (SP_MG_UNIFICADO) return ["CONSIG_SP_MG", "CONSIG_GERAL"];
    return ["CONSIG_MG", "CONSIG_GERAL"];
  }
  if (p.includes("CONSIGNADO SP") || p === "SP") {
    if (SP_MG_UNIFICADO) return ["CONSIG_SP_MG", "CONSIG_GERAL"];
    if (mes >= "2024-01") return ["CONSIG_SP", "CONSIG_GERAL"];
    return ["CONSIG_GERAL"];
  }
  if (p.includes("PÚBLICO") || p.includes("PUBLICO")) {
    return ["CONSIG_PUBLICO", "CONSIG_GERAL"];
  }
  if (p.includes("PRIVADO")) {
    return ["CONSIG_PRIVADO", "CONSIG_GERAL"];
  }
  if (p.includes("CONSIGNADO")) {
    if (mes >= "2024-08") return ["CONSIG_PUBLICO", "CONSIG_PRIVADO", "CONSIG_GERAL"];
    return ["CONSIG_GERAL"];
  }
  return [];
}

/**
 * Teto BACEN à vista por categoria canônica.
 *
 * Spec v9 §8 e gap_analysis G11: regimes VOLUME (Jul/2025+) usam 6,00%
 * universal mesmo quando o JSON declara teto inferior (ex.: TRP24 declara
 * 5,4% para Varejo I, 5,6% Varejo II). A política de cobrança real é 6,00%.
 *
 * META 2 (Tabela 1/2): teto 5,40% / 6,00%.
 * META 4 (4 níveis):  Tabela 1=5,40%, Inter1=5,60%, Inter2=5,80%, Tabela 2=6,00%.
 * VOLUME (todos):     6,00% universal.
 */
export function tetoBacenForCategoria(catCanonical: string | null): number | null {
  if (!catCanonical) return null;
  const u = catCanonical.normalize("NFC").trim().toUpperCase().replace(/\s+/g, " ");
  switch (u) {
    case "TABELA 1": return 0.054;
    case "TABELA 2": return 0.06;
    case "TABELA INTERMEDIÁRIA 1":
    case "TABELA INTERMEDIARIA 1":
      return 0.056;
    case "TABELA INTERMEDIÁRIA 2":
    case "TABELA INTERMEDIARIA 2":
      return 0.058;
    case "RUBI":
    case "SAFIRA":
    case "DIAMANTE":
    case "VAREJO I":
    case "VAREJO II":
    case "MIDDLE":
    case "UPPER MIDDLE":
    case "CORPORATE":
    case "LARGE CORPORATE":
    case "FAIXA 1":
    case "FAIXA 2":
    case "FAIXA 3":
    case "FAIXA 4":
    case "FAIXA 5":
      return 0.06;
    default: return null;
  }
}

/** Input mínimo para o lookup de matriz (subset de audit_v9_avista). */
export interface ContratoAvistaInput {
  /** ISO YYYY-MM. */
  mes: string;
  /** "CONSIGNADO INSS", "PORTABILIDADE INSS", etc. */
  produto: string | null;
  /** "NOVO" | "RENOVACAO". */
  tipo: string | null;
  /** Código do convênio (ex.: 1640 = INSS, 1078 = MPDG). */
  convenio: number | string | null;
  /** Taxa de juros do contrato. Aceita unidade percentual (1.65) ou decimal
   * (0.0165) — função detecta e normaliza para decimal antes do lookup. */
  txJuros: number;
  /** Prazo em meses. */
  prazo: number;
}

/** Resultado do lookup de matriz para um contrato. */
export interface MatrizTRPLookup {
  /** Pct cheio da matriz (sem teto BACEN aplicado). null = lookup falhou. */
  pct: number | null;
  /** Categoria de produto JSON em que o lookup achou (ex.: "INSS"). */
  categoriaProduto: string | null;
  /** Descrição da célula que matchou (G22 trace). */
  celula: string | null;
  /** Nome do JSON usado. */
  jsonRegra: string | null;
  /** True se mês usou fallback (Jun/2023, Set-Dez/2023, Mai/2024). */
  regraInferida: boolean;
  /** tabLabel JSON usado no lookup (ex.: "Tabela 2", "Faixa 3"). */
  tabLabelUsado: string | null;
  /** Categoria canônica usada na decisão (input do caller). */
  catCanonicalUsada: string | null;
  /** Lista de motivos de falha por candidato tentado (debug). */
  motivos: string[];
}

/**
 * Resolve o pct da matriz para um contrato, dado o regime do mês e a
 * categoria canônica devida (ex.: "TABELA 2", "FAIXA 3").
 *
 * Lança nada — sempre retorna estrutura com pct possivelmente null. Caller
 * (lib/auditoriaAvista.ts) classifica em SEM_LOOKUP / FORA_DA_TABELA quando
 * pct=null.
 *
 * @param contrato       subset de audit_v9_avista (mes/produto/tipo/convenio/taxa/prazo)
 * @param regime         do mês (vide getRegime — não usado para decisão, só para trace)
 * @param catCanonical   categoria devida em formato canônico v9 (UPPERCASE)
 *
 * Estratégia para PORTAB com pct_geral: se tabLabel não existe na célula mas
 * pct_geral existe, usa pct_geral (compatível com como check_lookup_vs_v9.cjs
 * fazia).
 */
export function getMatrizTRPParaContrato(
  contrato: ContratoAvistaInput,
  regime: Regime,
  catCanonical: string | null
): MatrizTRPLookup {
  const motivos: string[] = [];
  const r = getRegra(contrato.mes);
  if (!r) {
    motivos.push(`mes ${contrato.mes} sem cobertura em MAPA_MES_REGRA`);
    return {
      pct: null, categoriaProduto: null, celula: null,
      jsonRegra: null, regraInferida: false, tabLabelUsado: null,
      catCanonicalUsada: catCanonical, motivos,
    };
  }
  const tabLabel = categoriaCanonicalToJsonKey(catCanonical);
  if (!tabLabel) {
    motivos.push(`catCanonical '${catCanonical}' não mapeada para tabLabel JSON`);
    return {
      pct: null, categoriaProduto: null, celula: null,
      jsonRegra: r.jsonRegra, regraInferida: r.regraInferida, tabLabelUsado: null,
      catCanonicalUsada: catCanonical, motivos,
    };
  }
  const candidatos = categoriasCandidatasFor(contrato.mes, contrato.produto, contrato.tipo, contrato.convenio);
  if (candidatos.length === 0) {
    motivos.push(`produto '${contrato.produto}' tipo '${contrato.tipo}' não mapeia em nenhuma categoria JSON`);
    return {
      pct: null, categoriaProduto: null, celula: null,
      jsonRegra: r.jsonRegra, regraInferida: r.regraInferida, tabLabelUsado: tabLabel,
      catCanonicalUsada: catCanonical, motivos,
    };
  }

  // Normalizar taxa: o XLSX pode trazer percentual (1.65) ou decimal (0.0165).
  // Heurística: valor > 1 é percentual; senão decimal. Auditoria valida 100%
  // dos contratos usando essa convenção em check_lookup_vs_v9.cjs.
  const taxaDec = !Number.isFinite(contrato.txJuros)
    ? NaN
    : contrato.txJuros > 1 ? contrato.txJuros / 100 : contrato.txJuros;

  for (const cand of candidatos) {
    const out = lookupPctInRegra(
      r.regra, cand, taxaDec, contrato.prazo, tabLabel, r.jsonRegra, r.regraInferida
    );
    if (out.pct != null) {
      return {
        pct: out.pct,
        categoriaProduto: cand,
        celula: out.celula,
        jsonRegra: out.jsonRegra,
        regraInferida: out.regraInferida,
        tabLabelUsado: tabLabel,
        catCanonicalUsada: catCanonical,
        motivos,
      };
    }
    motivos.push(`${cand}: ${out.celula ?? "sem match"}`);
    // PORTAB: alguns JSONs trazem "pct_geral" em vez de "Tabela X" (sem
    // variação por categoria — pct é o mesmo independente de Cat_Devida).
    // Tenta pct_geral como fallback antes de descartar este candidato.
    if (tabLabel !== "pct_geral") {
      const g = lookupPctInRegra(
        r.regra, cand, taxaDec, contrato.prazo, "pct_geral", r.jsonRegra, r.regraInferida
      );
      if (g.pct != null) {
        return {
          pct: g.pct,
          categoriaProduto: cand,
          celula: g.celula,
          jsonRegra: g.jsonRegra,
          regraInferida: g.regraInferida,
          tabLabelUsado: "pct_geral",
          catCanonicalUsada: catCanonical,
          motivos,
        };
      }
    }
  }

  // Marca regime explicitamente nos motivos (debug)
  motivos.push(`regime=${regime} tabLabel=${tabLabel} candidatos=[${candidatos.join(",")}]`);
  return {
    pct: null, categoriaProduto: null, celula: null,
    jsonRegra: r.jsonRegra, regraInferida: r.regraInferida, tabLabelUsado: tabLabel,
    catCanonicalUsada: catCanonical, motivos,
  };
}
