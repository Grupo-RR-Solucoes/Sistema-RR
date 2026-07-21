// FRENTE DE PRODUTO — Movimento 2b: regua do CONSORCIO (TRP 2026/210, Tabela 1).
//
// Grupo RR usa SEMPRE a Tabela 1. O % da comissao-EMPRESA por parcela depende de
// CLASSIFICACAO (Varejo..Large Corporate) x SEGMENTO (Geral/Imovel) x POSICAO
// (1a..teto). O dado NAO traz a classificacao; nos a DEDUZIMOS (back-out) do %
// observado na 1a parcela recebida (decisao fechada do Diego).
//
// A comissao-empresa de cada parcela JA vem pronta no fechamento (M1 grava em
// monthly_closing_entries.commission_value). A TRP serve para PROJETAR as parcelas
// futuras (carteira) e AUDITAR — nunca e a fonte do valor pago.

export type SegmentoGrupo = "GERAL" | "IMOVEL";

export type Classificacao =
  | "VAREJO"
  | "MIDDLE"
  | "UPPER_MIDDLE"
  | "CORPORATE"
  | "LARGE_CORPORATE";

// Teto de parcelas por segmento (Tabela 1): Geral=6, Imovel=10.
export const TETO_GERAL = 6;
export const TETO_IMOVEL = 10;

// Tabela 1 da TRP 2026/210, em FRACAO (0,72% = 0.0072), igual a coluna % COMISSAO
// do dado. Para o Geral, geral15 vale nas posicoes 1a..5a e geral6 na 6a (degrau).
// Para o Imovel, imovel vale em todas as posicoes 1a..10a.
type LinhaTrp = { classificacao: Classificacao; geral15: number; geral6: number; imovel: number };

export const TRP210_TABELA1: LinhaTrp[] = [
  { classificacao: "VAREJO", geral15: 0.0072, geral6: 0.004, imovel: 0.004 },
  { classificacao: "MIDDLE", geral15: 0.0076, geral6: 0.004, imovel: 0.0042 },
  { classificacao: "UPPER_MIDDLE", geral15: 0.0078, geral6: 0.004, imovel: 0.0043 },
  { classificacao: "CORPORATE", geral15: 0.008, geral6: 0.0045, imovel: 0.00445 },
  { classificacao: "LARGE_CORPORATE", geral15: 0.0083, geral6: 0.0045, imovel: 0.0046 },
];

// Repasse do consorcio (TRP 210): promotor 40%, gestor 10%, empresa 50%.
export const FATOR_REPASSE_PROMOTOR_CONSORCIO = 0.4;
export const FATOR_REPASSE_GESTOR_CONSORCIO = 0.1;

const round2 = (v: number) => Math.round(v * 100) / 100;

// Reconhece IMOVEL explicitamente (decisao A do Diego): AI, IM*, variantes de
// imovel -> teto 10. Todo o resto (AU, DEMAIS, MO, qualquer nao-imovel) -> GERAL,
// teto 6. Default seguro = GERAL; so vira IMOVEL com match explicito.
export function isImovel(segmentoCodigo: string | null | undefined): boolean {
  const c = String(segmentoCodigo || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
  if (!c) return false;
  // codigos de imovel conhecidos + prefixos (AI = Aquisicao Imovel; IM* = Imovel).
  return c === "AI" || c.startsWith("IM") || c.includes("IMOV");
}

export function grupoDoSegmento(segmentoCodigo: string | null | undefined): SegmentoGrupo {
  return isImovel(segmentoCodigo) ? "IMOVEL" : "GERAL";
}

export function tetoDoGrupo(grupo: SegmentoGrupo): number {
  return grupo === "IMOVEL" ? TETO_IMOVEL : TETO_GERAL;
}

// Converte "PARC3" (ou "3") na posicao numerica 3. Retorna null se nao reconhecer.
export function posicaoDaParcela(parcela: string | null | undefined): number | null {
  const m = String(parcela || "").match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const PCT_TOLERANCIA = 0.00005; // 0,005 ponto percentual: separa as linhas da tabela.

// BACK-OUT (decisao B): deduz a classificacao cruzando o % OBSERVADO da 1a parcela
// (posicao <=5 no Geral, qualquer no Imovel) com a Tabela 1. Retorna null quando o
// % nao casa com nenhuma linha -> o chamador marca ALERTA e projeta pelo % observado.
export function classificacaoPorPercentual(
  grupo: SegmentoGrupo,
  pctObservado: number
): Classificacao | null {
  const alvo = grupo === "IMOVEL" ? "imovel" : "geral15";
  for (const linha of TRP210_TABELA1) {
    if (Math.abs((linha as any)[alvo] - pctObservado) <= PCT_TOLERANCIA) {
      return linha.classificacao;
    }
  }
  return null;
}

// % da comissao-empresa esperado numa dada POSICAO, para uma classificacao/grupo.
export function pctPosicao(
  grupo: SegmentoGrupo,
  classificacao: Classificacao,
  posicao: number
): number {
  const linha = TRP210_TABELA1.find((l) => l.classificacao === classificacao);
  if (!linha) return 0;
  if (grupo === "IMOVEL") return linha.imovel;
  return posicao >= TETO_GERAL ? linha.geral6 : linha.geral15;
}

export type ProjecaoParcela = { posicao: number; pct: number; comissaoEsperada: number };

// Projeta a comissao-empresa esperada de TODAS as posicoes 1..teto de uma proposta.
// Quando ha classificacao (back-out ok), usa o % da TRP por posicao (degrau da 6a no
// Geral). Quando NAO casa (classificacao null) -> alerta=true e projeta com o proprio
// % observado em todas as posicoes (fallback honesto, sem inventar degrau).
export function projetarParcelas(params: {
  grupo: SegmentoGrupo;
  valorBem: number;
  pctObservado: number;
  classificacao: Classificacao | null;
}): { parcelas: ProjecaoParcela[]; alerta: boolean } {
  const { grupo, valorBem, pctObservado, classificacao } = params;
  const teto = tetoDoGrupo(grupo);
  const alerta = classificacao === null;
  const parcelas: ProjecaoParcela[] = [];
  for (let p = 1; p <= teto; p++) {
    const pct = classificacao ? pctPosicao(grupo, classificacao, p) : pctObservado;
    parcelas.push({ posicao: p, pct, comissaoEsperada: round2(valorBem * pct) });
  }
  return { parcelas, alerta };
}

export function repasseConsorcioPromotor(comissaoEmpresa: number): number {
  return round2(comissaoEmpresa * FATOR_REPASSE_PROMOTOR_CONSORCIO);
}

export function repasseConsorcioGestor(comissaoEmpresa: number): number {
  return round2(comissaoEmpresa * FATOR_REPASSE_GESTOR_CONSORCIO);
}
