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
  if (typeof cat.tx_juros_min === "number" && taxa < cat.tx_juros_min - EPS) {
    return {
      pct: null,
      celula: `${categoriaProduto}: taxa ${taxa} < tx_juros_min ${cat.tx_juros_min} (FORA_DA_TABELA)`,
      jsonRegra,
      regraInferida,
    };
  }

  // Categoria tem prazo_min/prazo_max global? Validar antes de iterar células.
  if (typeof cat.prazo_min === "number" && prazo < cat.prazo_min) {
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
