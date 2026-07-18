// ============================================================================
// tetoAvistaRR — FONTE UNICA e VERSIONADA do teto de a-vista da RR (5,80%).
//
// CONCEITO (nao confundir com o teto da EMPRESA):
//   - Teto RR 5,80% (ESTE arquivo): limite OPERACIONAL da RR sobre o percentual
//     de a-vista que remunera o PROMOTOR. A Promotiva paga ate 6%; a RR limita
//     a visao do promotor a 5,80% e o spread fica com a empresa. O excedente
//     vira DIFERIDO (100% empresa).
//   - Teto da EMPRESA 6,00% (lib/promotivaCashPolicy.ts, consumido pelo
//     motor via cashCapPercent): quanto a PROMOTIVA paga a RR. Outra entidade,
//     outro proposito, ja versionado por effectiveFrom la.
//   Os dois valem 5,8/6,0 hoje por coincidencia de numero, NAO por serem a
//   mesma regra. NAO unificar. O motor NAO importa este arquivo.
//
// POR QUE NAO REUSEI O promotivaCashPolicy: aquele arquivo responde "quanto a
// Promotiva paga" (e hoje diz 6,00% fixo desde 202604). Hospedar o teto RR la
// dentro misturaria duas entidades num arquivo com nome de uma so, e um
// effectiveFrom novo do lado Promotiva passaria a mexer no teto RR sem querer.
// Semantica diferente => fonte separada, mesmo formato (effectiveFrom).
//
// UNIDADES: ha dois dialetos vivos no codigo. DECIMAL (0.058) em bbtsMonthly,
// closingMonthly e promoterAnalytics; PERCENTUAL (5.8) em proposalDetailing.
// Este modulo serve os dois, para nao forcar conversao no call site (que e
// justamente onde nascem os erros de 100x).
//
// COMO ADICIONAR UM TETO NOVO: acrescente um snapshot com effectiveFrom
// AAAAMM. Antes de fazer isso, LEIA a nota "CORRENTE" abaixo — ha call sites
// sem competencia que passariam a ler o teto novo para dados antigos.
// ============================================================================

/**
 * Competencia de referencia. "CORRENTE" = sem competencia no call site, usa o
 * snapshot mais recente. Marcador GREPPAVEL de proposito: quando existir mais
 * de um snapshot, `grep -rn '"CORRENTE"'` lista exatamente os pontos que
 * precisam passar a competencia de verdade para nao datar errado o passado.
 * Com UM unico snapshot (hoje), "CORRENTE" e sempre correto.
 */
export type CompetenciaTeto = { year: number; month: number } | "CORRENTE";

type TetoSnapshot = {
  /** AAAAMM inclusivo. */
  effectiveFrom: number;
  /** Teto em DECIMAL (0.058 = 5,80%). */
  percent: number;
  note: string;
};

/**
 * Historico do teto RR, do mais antigo para o mais novo.
 *
 * effectiveFrom 200001 e um PISO DELIBERADO: o repo nunca teve outro valor que
 * 5,80% (medido — TETO_AVISTA, FAIXA_580 e os literais 5.8/0.058 batiam todos),
 * entao um piso baixo reproduz o comportamento antigo em QUALQUER competencia,
 * inclusive nas auditorias historicas. Se o teto ja foi outro antes de 2026,
 * isso e desconhecido AQUI — acrescente o snapshot quando souber.
 */
const TETO_AVISTA_RR: ReadonlyArray<TetoSnapshot> = [
  {
    effectiveFrom: 200001,
    percent: 0.058,
    note:
      "Teto operacional RR de 5,80% sobre o a-vista que remunera o promotor. " +
      "Unico valor conhecido no repo ate 07/2026; excedente vira diferido.",
  },
];

/** Tolerancia para comparar percentual de ponto flutuante, em DECIMAL. */
export const TETO_EPS_DECIMAL = 0.00001;

function snapshotDe(comp: CompetenciaTeto): TetoSnapshot {
  const ultimo = TETO_AVISTA_RR[TETO_AVISTA_RR.length - 1];
  if (comp === "CORRENTE") return ultimo;

  const code = comp.year * 100 + comp.month;
  let sel = TETO_AVISTA_RR[0];
  for (const s of TETO_AVISTA_RR) {
    if (s.effectiveFrom <= code) sel = s;
  }
  return sel;
}

/** Teto em DECIMAL (0.058). */
export function tetoAvistaRR(comp: CompetenciaTeto): number {
  return snapshotDe(comp).percent;
}

/**
 * Teto em PERCENTUAL (5.8).
 *
 * ATENCAO ao float: `0.058 * 100` em IEEE-754 da 5.800000000000001, NAO 5.8.
 * Sem o arredondamento abaixo o cap percentual passaria a limitar em
 * 5.800000000000001 e devolveria valores diferentes do literal 5.8 antigo
 * para todo percentual acima do teto (medido: 6202 divergencias no gate).
 * O toFixed(10) mata o residuo sem inventar precisao.
 */
export function tetoAvistaRRPercent(comp: CompetenciaTeto): number {
  return Number((snapshotDe(comp).percent * 100).toFixed(10));
}

/** Aplica o teto a um percentual DECIMAL, com piso em 0. */
export function capAvistaRR(percentDecimal: number, comp: CompetenciaTeto): number {
  const v = Number.isFinite(percentDecimal) ? percentDecimal : 0;
  return Math.min(Math.max(v, 0), tetoAvistaRR(comp));
}

/** Aplica o teto a um percentual em unidade PERCENTUAL (0..100), piso em 0. */
export function capAvistaRRPercent(percent: number, comp: CompetenciaTeto): number {
  const v = Number.isFinite(percent) ? percent : 0;
  return Math.min(Math.max(v, 0), tetoAvistaRRPercent(comp));
}

/**
 * O percentual (DECIMAL) esta NA faixa do teto? Classificador, NAO cap — nao
 * altera valor nenhum, so rotula (isFaixa580). Usa tolerancia porque o dado
 * vem de divisao de float.
 */
export function isFaixaTetoAvistaRR(
  percentDecimal: number,
  comp: CompetenciaTeto
): boolean {
  const v = Number.isFinite(percentDecimal) ? percentDecimal : 0;
  return v >= tetoAvistaRR(comp) - TETO_EPS_DECIMAL;
}

/** Idem, para entrada em unidade PERCENTUAL (0..100). */
export function isFaixaTetoAvistaRRPercent(
  percent: number,
  comp: CompetenciaTeto
): boolean {
  const v = Number.isFinite(percent) ? percent : 0;
  return isFaixaTetoAvistaRR(v / 100, comp);
}

/** Snapshots crus (gate/diagnostico). */
export function tetoAvistaRRSnapshots(): ReadonlyArray<TetoSnapshot> {
  return TETO_AVISTA_RR;
}
