/**
 * Imports estáticos dos 41 JSONs de regras Promotiva e mapa mês → JSON.
 *
 * Fonte: regras_promotiva/json/*.json (41 arquivos: 35 OPP/TRP mensais + 4
 * alternates/erratas + convenios_oficiais.json + 1 fallback período).
 *
 * Cobertura:
 * - 35 meses com JSON nativo (regraInferida=false)
 * - 6 meses com fallback documentado (regraInferida=true): Jun/2023, Set/2023,
 *   Out/2023, Nov/2023, Dez/2023, Mai/2024.
 * - Total: 41 meses cobertos (Dez/2022 a Abr/2026).
 *
 * Erratas que substituem JSON original (vigente = errata, NÃO o original):
 * - TRP05_2024-04b.json (errata sobre TRP04) → vigente em Abr/2024
 * - TRP08_2024-06b.json (errata sobre TRP07) → vigente em Jun/2024
 * - TRP27_2025-09.json (PR2025/130, errata sobre TRP26) → vigente em Set/2025
 * - TRP29_2025-10.json (PR2025/144, errata sobre TRP28) → vigente em Out/2025
 *
 * Validação: stress_test_workspace_local/validacao_reversa_p2_p3.md Parte C.
 */

import OPP060_2022_12 from "../regras_promotiva/json/OPP060_2022-12.json";
import OPP060_2023_01 from "../regras_promotiva/json/OPP060_2023-01.json";
import OPP060_2023_02 from "../regras_promotiva/json/OPP060_2023-02.json";
import OPP060_2023_03 from "../regras_promotiva/json/OPP060_2023-03.json";
import OPP060_2023_04 from "../regras_promotiva/json/OPP060_2023-04.json";
import OPP060_2023_05 from "../regras_promotiva/json/OPP060_2023-05.json";
import OPP060_periodo from "../regras_promotiva/json/OPP060_2022-12_a_2023-05.json";
import OPP072_2023_07_a_2023_08 from "../regras_promotiva/json/OPP072_2023-07_a_2023-08.json";
import TRP01_2024_01 from "../regras_promotiva/json/TRP01_2024-01.json";
import TRP02_2024_02 from "../regras_promotiva/json/TRP02_2024-02.json";
import TRP03_2024_03 from "../regras_promotiva/json/TRP03_2024-03.json";
import TRP04_2024_04 from "../regras_promotiva/json/TRP04_2024-04.json";
import TRP05_2024_04b from "../regras_promotiva/json/TRP05_2024-04b.json";
import TRP06_2024_05 from "../regras_promotiva/json/TRP06_2024-05.json";
import TRP07_2024_06 from "../regras_promotiva/json/TRP07_2024-06.json";
import TRP08_2024_06b from "../regras_promotiva/json/TRP08_2024-06b.json";
import TRP09_2024_07 from "../regras_promotiva/json/TRP09_2024-07.json";
import TRP10_2024_08 from "../regras_promotiva/json/TRP10_2024-08.json";
import TRP11_2024_09 from "../regras_promotiva/json/TRP11_2024-09.json";
import TRP12_2024_10 from "../regras_promotiva/json/TRP12_2024-10.json";
import TRP13_2024_11 from "../regras_promotiva/json/TRP13_2024-11.json";
import TRP14_2024_12 from "../regras_promotiva/json/TRP14_2024-12.json";
import TRP15_2025_01 from "../regras_promotiva/json/TRP15_2025-01.json";
import TRP16_2025_02 from "../regras_promotiva/json/TRP16_2025-02.json";
import TRP17_2025_03 from "../regras_promotiva/json/TRP17_2025-03.json";
import TRP20_2025_04 from "../regras_promotiva/json/TRP20_2025-04.json";
import TRP22_2025_05 from "../regras_promotiva/json/TRP22_2025-05.json";
import TRP23_2025_06 from "../regras_promotiva/json/TRP23_2025-06.json";
import TRP24_2025_07 from "../regras_promotiva/json/TRP24_2025-07.json";
import TRP25_2025_08 from "../regras_promotiva/json/TRP25_2025-08.json";
import TRP26_2025_09 from "../regras_promotiva/json/TRP26_2025-09.json";
import TRP27_2025_09 from "../regras_promotiva/json/TRP27_2025-09.json";
import TRP28_2025_10 from "../regras_promotiva/json/TRP28_2025-10.json";
import TRP29_2025_10 from "../regras_promotiva/json/TRP29_2025-10.json";
import TRP30_2025_11 from "../regras_promotiva/json/TRP30_2025-11.json";
import TRP31_2025_12 from "../regras_promotiva/json/TRP31_2025-12.json";
import TRP32_2026_01 from "../regras_promotiva/json/TRP32_2026-01.json";
import TRP33_2026_02 from "../regras_promotiva/json/TRP33_2026-02.json";
import TRP34_2026_03 from "../regras_promotiva/json/TRP34_2026-03.json";
import TRP35_2026_04 from "../regras_promotiva/json/TRP35_2026-04.json";
import convenios_oficiais from "../regras_promotiva/json/convenios_oficiais.json";

/**
 * Estrutura genérica de um JSON de regra mensal.
 *
 * Os campos exatos variam por regime (META 2 níveis tem celulas_taxa_prazo;
 * META 4 niveis tem celulas_taxa; VOLUME tem celulas_taxa, celulas_prazo, etc.).
 * Por isso o tipo é amplo no nível de Categoria — `lookupPctInRegra` faz o
 * dispatch correto baseado em qual array existe.
 */
export interface RegraMes {
  _meta: {
    trp?: string;
    opp?: string;
    opp_referencia?: string;
    competencia?: string;
    competencia_inicial?: string;
    competencia_final?: string;
    regime: string;
    fonte_pdf?: string;
    categorias_publicadas?: string[];
    categorias_logicas?: string[];
    categorias?: string[]; // VOLUME usa este nome
    limites_categoria?: Record<string, { meta_min?: number; meta_max?: number; prod_min?: number; teto_avista: number }>;
    obs?: string | string[];
    observacoes?: string[];
    bonus_observacao?: string;
  };
  // Demais chaves: CONSIG_GERAL, CONSIG_PUBLICO, INSS, INSS_NOVO, INSS_RENOV,
  // SIAPE, NAO_CONSIGNADO, ADIANTAMENTO_13, FGTS, PORTAB_*, etc.
  [categoria: string]: unknown;
}

/**
 * Estrutura de uma célula de matriz (linha de lookup).
 *
 * Algumas categorias têm `tx_min`/`tx_max`, outras `prazo_min`/`prazo_max`,
 * outras ambos. As chaves de categoria (ex.: "Tabela 1", "Faixa 3", "Rubi")
 * variam por regime.
 */
export interface RegraCelula {
  tx_min?: number;
  tx_max?: number;
  prazo_min?: number;
  prazo_max?: number;
  pct_geral?: number;
  [categoriaCalculo: string]: number | undefined;
}

/**
 * Estrutura de uma categoria de produto dentro de uma regra.
 */
export interface RegraCategoriaProduto {
  _titulo?: string;
  _observacao?: string;
  prazo_min?: number;
  prazo_max?: number;
  tx_juros_min?: number;
  tx_juros_fixa?: number;
  tiquete_min?: number;
  custo_processamento?: number | string;
  convenio?: string;
  pct_geral?: number; // FGTS — pct único
  pct_geral_tab2?: number;
  celulas_taxa?: RegraCelula[];
  celulas_taxa_prazo?: RegraCelula[];
  celulas_prazo?: RegraCelula[];
  celulas?: RegraCelula[];
  [extra: string]: unknown;
}

/**
 * Mapeamento mês (YYYY-MM) → { regra, jsonRegra, regraInferida }.
 *
 * 35 meses diretos + 6 meses inferidos (regraInferida=true) = 41 total.
 *
 * Erratas: usamos a errata como vigente (TRP05b > TRP04, TRP08b > TRP07,
 * TRP27 > TRP26, TRP29 > TRP28). Os JSONs originais TRP04/07/26/28 são
 * mantidos no pacote para auditoria histórica mas não entram no mapa.
 */
export const MAPA_MES_REGRA: Record<
  string,
  { regra: RegraMes; jsonRegra: string; regraInferida: boolean }
> = {
  // === 2022-12 a 2023-05 — OPP060 (1 JSON por mês) ===
  "2022-12": { regra: OPP060_2022_12 as RegraMes, jsonRegra: "OPP060_2022-12.json", regraInferida: false },
  "2023-01": { regra: OPP060_2023_01 as RegraMes, jsonRegra: "OPP060_2023-01.json", regraInferida: false },
  "2023-02": { regra: OPP060_2023_02 as RegraMes, jsonRegra: "OPP060_2023-02.json", regraInferida: false },
  "2023-03": { regra: OPP060_2023_03 as RegraMes, jsonRegra: "OPP060_2023-03.json", regraInferida: false },
  "2023-04": { regra: OPP060_2023_04 as RegraMes, jsonRegra: "OPP060_2023-04.json", regraInferida: false },
  "2023-05": { regra: OPP060_2023_05 as RegraMes, jsonRegra: "OPP060_2023-05.json", regraInferida: false },

  // === 2023-06 — sem JSON nativo, fallback OPP060 (período) ===
  // Spec v9 §4.3: validado em 15 contratos, 100% bate com OPP060.
  "2023-06": { regra: OPP060_periodo as RegraMes, jsonRegra: "OPP060_2022-12_a_2023-05.json", regraInferida: true },

  // === 2023-07 a 2023-08 — OPP072 (CP6A: substitui OPP061 errado, fundação Promotiva fase 4.3.B etapa 3) ===
  "2023-07": { regra: OPP072_2023_07_a_2023_08 as RegraMes, jsonRegra: "OPP072_2023-07_a_2023-08.json", regraInferida: false },
  "2023-08": { regra: OPP072_2023_07_a_2023_08 as RegraMes, jsonRegra: "OPP072_2023-07_a_2023-08.json", regraInferida: false },

  // === 2023-09 a 2023-12 — sem JSON nativo, fallback TRP01 ===
  // Spec v9 §4.3: validado amostralmente, 39/40 contratos (97,5%) batem com TRP01.
  "2023-09": { regra: TRP01_2024_01 as RegraMes, jsonRegra: "TRP01_2024-01.json", regraInferida: true },
  "2023-10": { regra: TRP01_2024_01 as RegraMes, jsonRegra: "TRP01_2024-01.json", regraInferida: true },
  "2023-11": { regra: TRP01_2024_01 as RegraMes, jsonRegra: "TRP01_2024-01.json", regraInferida: true },
  "2023-12": { regra: TRP01_2024_01 as RegraMes, jsonRegra: "TRP01_2024-01.json", regraInferida: true },

  // === 2024-01 a 2024-12 — TRP01 a TRP14 (com erratas TRP05b, TRP08b) ===
  "2024-01": { regra: TRP01_2024_01 as RegraMes, jsonRegra: "TRP01_2024-01.json", regraInferida: false },
  "2024-02": { regra: TRP02_2024_02 as RegraMes, jsonRegra: "TRP02_2024-02.json", regraInferida: false },
  "2024-03": { regra: TRP03_2024_03 as RegraMes, jsonRegra: "TRP03_2024-03.json", regraInferida: false },
  // Errata TRP05_2024-04b substitui TRP04_2024-04 (PR2024/05)
  "2024-04": { regra: TRP05_2024_04b as RegraMes, jsonRegra: "TRP05_2024-04b.json", regraInferida: false },
  // Mai/2024 sem JSON nativo, fallback TRP05_2024-04b (errata Abr/2024)
  // Spec v9 §4.3: declarado explicitamente no metadata.
  "2024-05": { regra: TRP05_2024_04b as RegraMes, jsonRegra: "TRP05_2024-04b.json", regraInferida: true },
  // NB: TRP06_2024-05.json existe mas spec v9 manda usar TRP05_2024-04b para Mai/2024
  // (errata aplicada extensivamente). Mantemos TRP06 importado para auditoria mas não no mapa.
  // Errata TRP08_2024-06b substitui TRP07_2024-06 (PR2024/08)
  "2024-06": { regra: TRP08_2024_06b as RegraMes, jsonRegra: "TRP08_2024-06b.json", regraInferida: false },
  "2024-07": { regra: TRP09_2024_07 as RegraMes, jsonRegra: "TRP09_2024-07.json", regraInferida: false },
  "2024-08": { regra: TRP10_2024_08 as RegraMes, jsonRegra: "TRP10_2024-08.json", regraInferida: false },
  "2024-09": { regra: TRP11_2024_09 as RegraMes, jsonRegra: "TRP11_2024-09.json", regraInferida: false },
  "2024-10": { regra: TRP12_2024_10 as RegraMes, jsonRegra: "TRP12_2024-10.json", regraInferida: false },
  "2024-11": { regra: TRP13_2024_11 as RegraMes, jsonRegra: "TRP13_2024-11.json", regraInferida: false },
  "2024-12": { regra: TRP14_2024_12 as RegraMes, jsonRegra: "TRP14_2024-12.json", regraInferida: false },

  // === 2025-01 a 2025-06 — META 4 níveis (TRP15 a TRP23) ===
  "2025-01": { regra: TRP15_2025_01 as RegraMes, jsonRegra: "TRP15_2025-01.json", regraInferida: false },
  "2025-02": { regra: TRP16_2025_02 as RegraMes, jsonRegra: "TRP16_2025-02.json", regraInferida: false },
  "2025-03": { regra: TRP17_2025_03 as RegraMes, jsonRegra: "TRP17_2025-03.json", regraInferida: false },
  "2025-04": { regra: TRP20_2025_04 as RegraMes, jsonRegra: "TRP20_2025-04.json", regraInferida: false },
  "2025-05": { regra: TRP22_2025_05 as RegraMes, jsonRegra: "TRP22_2025-05.json", regraInferida: false },
  "2025-06": { regra: TRP23_2025_06 as RegraMes, jsonRegra: "TRP23_2025-06.json", regraInferida: false },

  // === 2025-07 a 2025-12 — VOLUME 6 perfis (TRP24 a TRP31, com erratas TRP27, TRP29) ===
  "2025-07": { regra: TRP24_2025_07 as RegraMes, jsonRegra: "TRP24_2025-07.json", regraInferida: false },
  "2025-08": { regra: TRP25_2025_08 as RegraMes, jsonRegra: "TRP25_2025-08.json", regraInferida: false },
  // Errata TRP27 (PR2025/130) substitui TRP26 para Set/2025
  "2025-09": { regra: TRP27_2025_09 as RegraMes, jsonRegra: "TRP27_2025-09.json", regraInferida: false },
  // Errata TRP29 (PR2025/144) substitui TRP28 para Out/2025
  "2025-10": { regra: TRP29_2025_10 as RegraMes, jsonRegra: "TRP29_2025-10.json", regraInferida: false },
  "2025-11": { regra: TRP30_2025_11 as RegraMes, jsonRegra: "TRP30_2025-11.json", regraInferida: false },
  "2025-12": { regra: TRP31_2025_12 as RegraMes, jsonRegra: "TRP31_2025-12.json", regraInferida: false },

  // === 2026-01 a 2026-03 — VOLUME 3 perfis (Rubi/Safira/Diamante) ===
  "2026-01": { regra: TRP32_2026_01 as RegraMes, jsonRegra: "TRP32_2026-01.json", regraInferida: false },
  "2026-02": { regra: TRP33_2026_02 as RegraMes, jsonRegra: "TRP33_2026-02.json", regraInferida: false },
  "2026-03": { regra: TRP34_2026_03 as RegraMes, jsonRegra: "TRP34_2026-03.json", regraInferida: false },

  // === 2026-04 — VOLUME 5 faixas (TRP35 = TRP Nº 2026/187) ===
  // Confirmado em stress_test_workspace_local/confirmacao_documental.md P1:
  // matriz completa varia por Faixa, NÃO é hard-code de teto.
  "2026-04": { regra: TRP35_2026_04 as RegraMes, jsonRegra: "TRP35_2026-04.json", regraInferida: false },
};

/**
 * Lista de convênios oficiais por linha (INSS, MPDG, EXÉRCITO, SP, MG).
 * Fonte: TRP23 págs. 7-8.
 *
 * NB: NÃO contém os 864 convênios da "ação de regionalização" da OPP128 —
 * essa lista não é necessária para cálculo de comissão (ver
 * stress_test_workspace_local/validacao_reversa_p2_p3.md Parte B).
 */
export const CONVENIOS_OFICIAIS = convenios_oficiais as {
  _meta: { fonte: string; linhas: string[] };
  INSS: string[];
  MPDG: string[];
  EXERCITO: string[];
  SP: string[];
  MG: string[];
};

/**
 * JSONs originais que foram SUBSTITUÍDOS por errata e não entram em
 * MAPA_MES_REGRA. Mantidos como referência de auditoria histórica e para
 * manter os 41 JSONs carregados em build-time conforme spec.
 */
export const JSONS_SUBSTITUIDOS_POR_ERRATA: Record<string, RegraMes> = {
  "TRP04_2024-04": TRP04_2024_04 as RegraMes,
  "TRP06_2024-05": TRP06_2024_05 as RegraMes, // Spec v9 §4.3 manda usar TRP05b para Mai/2024
  "TRP07_2024-06": TRP07_2024_06 as RegraMes,
  "TRP26_2025-09": TRP26_2025_09 as RegraMes,
  "TRP28_2025-10": TRP28_2025_10 as RegraMes,
};

/**
 * Quantidade total de JSONs importados (auditoria interna).
 *
 * 41 imports estáticos:
 * - 7 OPP060 (Dez/2022 a Mai/2023 + período)
 * - 1 OPP061 (Jul-Ago/2023)
 * - 14 TRP01–TRP14 (Jan-Dez/2024)
 * - 2 erratas Abr/Jun/2024 (TRP05b, TRP08b)
 * - 6 TRP15-17, 20, 22-23 (Jan-Jun/2025 META 4)
 * - 8 TRP24-31 (Jul-Dez/2025 VOLUME 6 perfis)
 * - 2 erratas Set/Out/2025 (TRP27, TRP29)
 * - 4 TRP32-35 (Jan-Abr/2026)
 * - 1 convenios_oficiais
 * TOTAL = 41 ✓
 *
 * Cobertura mensal MAPA_MES_REGRA:
 * - 35 meses com JSON nativo (regraInferida=false)
 * - 6 meses com fallback (regraInferida=true): Jun/23, Set-Dez/23, Mai/24
 * - Total: 41 meses (Dez/2022 a Abr/2026)
 */
export const TOTAL_JSONS_IMPORTADOS = 41;
