// ============================================================================
// Auditoria ADS/BBTS — 1A: o SHAPE canônico da régua da BBTS (RegraBbts / BBTS_V1).
//
// É a "TRP da ADS": a tabela de pagamento da BBTS, versionada por competência em
// bbts_rule_versions.regra_json. Espelha a IDEIA do RegraMes (células com faixa de
// juros/prazo e percentual por faixa de produção), mas com duas diferenças que o
// RegraMes não modela:
//
//   1. CÉLULA COM BASE + ADICIONAL: os convênios "Bonificado" pagam "0,63% +0,35%".
//      Os dois números ficam SEPARADOS aqui e NUNCA são somados na régua — quem
//      soma é o consumidor (auditoria/caixa), e só quando a bonificação valer.
//      (O PDF diz: "Total do pagamento é equivalente a soma dos percentuais.")
//   2. LOOKUP ANCORADO NO CONVÊNIO: a BBTS paga por convênio (o fechamento traz
//      convenio_code). A régua carrega o mapa código -> grupo.
//
// FAIXA DA ADS: a régua guarda as 5 faixas FIÉIS à tabela. O acordo comercial
// (Grupo RR/ADS recebe sempre na FAIXA 4, todos os convênios) é aplicado pelo
// RESOLVER, nunca achatado no dado — se o acordo mudar, muda o resolver e o
// histórico continua íntegro.
// ============================================================================

/** Versão do parser (rastreada em bbts_rule_versions.parser_version). */
export const PARSER_VERSION_BBTS = "bbts-unpdf-1";

/** Versão do SHAPE do regra_json (coluna shape_version). */
export const SHAPE_VERSION_BBTS = "BBTS_V1";

/** Faixas de produção da BBTS (colunas da tabela). */
export const FAIXA_LABELS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5"] as const;

/** Rótulo da coluna única (BB Energia Renovável não varia por faixa). */
export const FAIXA_UNICA = "Faixa Unica";

/**
 * ACORDO COMERCIAL: o Grupo RR/ADS recebe SEMPRE na Faixa 4, em todos os convênios.
 * Vive aqui (e no resolver), NÃO no dado gravado. A régua guarda as 5 faixas.
 */
export const FAIXA_ADS = "Faixa 4";

/** Teto do recebimento à vista (pág. 8 do PDF). O excedente vira PRT (a prazo). */
export const AVT_TETO = 0.06;

/** Guarda de plausibilidade: nenhum percentual da tabela passa disso (mesma da TRP). */
export const MAX_PLAUSIVEL = 0.15;

/** Grupos esperados na tabela (âncoras do parser). Ausência de qualquer um TRAVA. */
export const EXPECTED_GROUPS = [
  "INSS_NOVO",
  "INSS_RENOV",
  "SIAPE",
  "GRUPAMENTO_MG_SP",
  "GRUPAMENTO_MG_SP_REDUZIDOS",
  "PUBLICO_DEMAIS",
  "PUBLICO_DEMAIS_BONIFICADO",
  "PUBLICO_DEMAIS_REDUZIDOS",
  "PRIVADO",
  "PORTAB_PRIVADO",
  "PORTAB_PUBLICO",
  "NAO_CONSIGNADO",
  "NAO_CONSIGNADO_13",
  "CDC_FGTS",
  "BB_ENERGIA",
] as const;

export type GrupoBbtsKey = (typeof EXPECTED_GROUPS)[number];

/** Grupos que pagam bonificação: toda célula PRECISA ter adicional (senão TRAVA). */
export const GRUPOS_BONIFICADOS: readonly string[] = ["PUBLICO_DEMAIS_BONIFICADO"];

/** Grupos de coluna única (1 pct por célula, sem faixa). */
export const GRUPOS_FAIXA_UNICA: readonly string[] = ["BB_ENERGIA"];

/** Percentual de uma célula: base + adicional (bonificação) SEPARADOS. */
export interface PctCelulaBbts {
  /** Percentual base, em decimal (0.0348 = 3,48%). */
  base: number;
  /** Bonificação, em decimal. Só nos grupos bonificados. NUNCA somado aqui. */
  adicional?: number;
}

/** Uma linha da matriz de um grupo. Limites null = aberto ("A partir de"/"Acima de"). */
export interface CelulaBbts {
  tx_min?: number | null;
  tx_max?: number | null;
  prazo_min?: number | null;
  prazo_max?: number | null;
  /** Tíquete mínimo em R$ (Portabilidade >= 2,5 mil; CDC FGTS >= 1,0 mil). */
  valor_min?: number | null;
  /** "Faixa 1".."Faixa 5" (ou "Faixa Unica"). */
  faixas: Record<string, PctCelulaBbts>;
  /** Texto cru da linha do PDF (auditoria/revisão na tela). */
  _origem?: string;
}

export interface GrupoBbts {
  titulo: string;
  celulas: CelulaBbts[];
}

/** Faixa de enquadramento do parceiro (pág. 8) — limites de PRODUÇÃO, em R$. */
export interface FaixaEnquadramento {
  faixa: string;
  prod_min: number;
  prod_max: number | null;
}

/** Seguro Prestamista (pág. 9) — % sobre o PEL. */
export interface SeguroBbts {
  slip: { prazo_min: number; prazo_max: number | null; pct: number }[];
  estoque: { pct: number };
}

/** A régua completa da BBTS de uma competência (= bbts_rule_versions.regra_json). */
export interface RegraBbts {
  _meta: {
    shape: string;
    competencia: string; // "YYYY-MM"
    vigencia_inicio: string; // "YYYY-MM-DD" (janela RR holiday-aware)
    vigencia_fim: string;
    /** Data que o PDF declara ("Vigência a partir de 30/06/2026"). */
    vigencia_pdf?: string | null;
    faixas: string[];
    faixas_enquadramento: FaixaEnquadramento[];
    modelo_pagamento: { avt_teto: number; prt: string };
    fonte_pdf?: string | null;
    parser_version: string;
  };
  /** código do convênio (sem pontos) -> grupo. INCOMPLETO por natureza: o PDF só
   *  enumera os convênios das EXCEÇÕES (Bonificado/Reduzidos). Ver notas da 1A. */
  convenios: Record<string, { grupo: string; nome: string }>;
  grupos: Record<string, GrupoBbts>;
  seguro?: SeguroBbts;
}

/** Erro de PARSE (PDF não é o esperado / âncora não encontrada). Rota -> 422. */
export class BbtsParseError extends Error {
  constructor(message: string, public detalhe?: string) {
    super(message);
    this.name = "BbtsParseError";
  }
}

/** Erro de VALIDAÇÃO (leu, mas o resultado é implausível). Rota -> 422. NADA grava. */
export class BbtsValidationError extends Error {
  constructor(message: string, public detalhe?: string) {
    super(message);
    this.name = "BbtsValidationError";
  }
}
