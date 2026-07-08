// ============================================================
// SÉRIE MENSAL HÍBRIDA — jan/2026 → competência corrente, por promotor.
//
// PROBLEMA (provado): daily_production_records só tem abr/2026 em diante; a
// produção dos meses fechados vive em promoter_monthly_results (PMR). Ler só o
// daily deixa jan/fev/mar/mai zerados na série histórica.
//
// REGRA HÍBRIDA (fronteira = mês corrente):
//   - mês CORRENTE (aberto) .......... daily ao vivo (como hoje).
//   - meses ANTERIORES (fechados) .... PMR.production_value; fallback daily se
//     o mês não tiver PMR; 0 se não houver nem PMR nem daily.
//
// Compartilhada por /projecao (agregarHistoricoMensal) e /equipe (monthlySeries)
// — MESMA fronteira e MESMA janela, para as duas telas ficarem coerentes. Função
// PURA (sem I/O): os motores buscam os dados e injetam aqui.
// ============================================================

export type SerieFonte = "pmr" | "daily" | "vazio";

export type SerieMesPonto = {
  year: number;
  month: number;
  label: string; // "jan/26"
  producao: number;
  penetracao_seg: number | null; // fração 0-1 (null = sem base)
  fonte: SerieFonte;
};

/** Acumulador de daily por (promotor, competência). */
export type DailyAcc = { net: number; gross: number; insuredGross: number };
/** Ponto de PMR por (promotor, competência). */
export type PmrPonto = { production: number; penetracao: number | null };

const MESES_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const SERIE_INICIO = { year: 2026, month: 1 };

export function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}
export function ymLabel(year: number, month: number): string {
  return `${MESES_ABBR[month - 1]}/${String(year).slice(-2)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function penDaily(acc: DailyAcc | undefined): number | null {
  return acc && acc.gross > 0 ? acc.insuredGross / acc.gross : null;
}

/** Competências de (fromY,fromM) até (toY,toM) inclusive, sem buracos. */
export function rangeMeses(fromY: number, fromM: number, toY: number, toM: number) {
  const out: Array<{ year: number; month: number }> = [];
  let y = fromY;
  let m = fromM;
  for (let guard = 0; guard < 600; guard++) {
    if (y > toY || (y === toY && m > toM)) break;
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Série híbrida por promotor. Retorna Map<promoter_id, SerieMesPonto[]>, cada
 * lista cobrindo jan/2026 → competência de refDate na MESMA ordem (usada como
 * eixo comum para agregar por estado/supervisor).
 */
export function serieHibridaPorPromotor(args: {
  dailyByPromoterYm: Map<string, Map<string, DailyAcc>>;
  pmrByPromoterYm: Map<string, Map<string, PmrPonto>>;
  promoterIds: Iterable<string>;
  refDate: Date;
}): Map<string, SerieMesPonto[]> {
  const { dailyByPromoterYm, pmrByPromoterYm, promoterIds, refDate } = args;
  const range = rangeMeses(
    SERIE_INICIO.year,
    SERIE_INICIO.month,
    refDate.getUTCFullYear(),
    refDate.getUTCMonth() + 1
  );
  const curKey = ymKey(refDate.getUTCFullYear(), refDate.getUTCMonth() + 1);

  const out = new Map<string, SerieMesPonto[]>();
  for (const pid of new Set(promoterIds)) {
    const dInner = dailyByPromoterYm.get(pid);
    const pInner = pmrByPromoterYm.get(pid);
    const pts = range.map(({ year, month }) => {
      const k = ymKey(year, month);
      const base = { year, month, label: ymLabel(year, month) };
      // Mês CORRENTE (aberto) → daily ao vivo.
      if (k === curKey) {
        const acc = dInner?.get(k);
        if (acc) return { ...base, producao: round2(acc.net), penetracao_seg: penDaily(acc), fonte: "daily" as SerieFonte };
        return { ...base, producao: 0, penetracao_seg: null, fonte: "vazio" as SerieFonte };
      }
      // Mês FECHADO → PMR; fallback daily; senão vazio.
      const pmr = pInner?.get(k);
      if (pmr) return { ...base, producao: round2(pmr.production), penetracao_seg: pmr.penetracao, fonte: "pmr" as SerieFonte };
      const acc = dInner?.get(k);
      if (acc) return { ...base, producao: round2(acc.net), penetracao_seg: penDaily(acc), fonte: "daily" as SerieFonte };
      return { ...base, producao: 0, penetracao_seg: null, fonte: "vazio" as SerieFonte };
    });
    out.set(pid, pts);
  }
  return out;
}

/** Ponto de série agregada de um GRUPO (estado/supervisor/time). */
export type SerieGrupoPonto = {
  year: number;
  month: number;
  label: string;
  producao: number;
  penetracao_seg: number | null; // ponderada por produção (Σ pen·prod / Σ prod)
};

/**
 * Agrega várias séries de promotor (MESMA janela/ordem) num grupo: soma a
 * produção e pondera a penetração pela produção. Master já deve estar fora.
 */
export function agregarSerieGrupo(seriesDePromotores: SerieMesPonto[][]): SerieGrupoPonto[] {
  const first = seriesDePromotores.find((s) => s.length > 0);
  if (!first) return [];
  return first.map((_, i) => {
    let prod = 0;
    let penNum = 0;
    let penDen = 0;
    const ref = first[i];
    for (const s of seriesDePromotores) {
      const p = s[i];
      if (!p) continue;
      prod += p.producao;
      if (p.penetracao_seg != null && p.producao > 0) {
        penNum += p.penetracao_seg * p.producao;
        penDen += p.producao;
      }
    }
    return {
      year: ref.year,
      month: ref.month,
      label: ref.label,
      producao: round2(prod),
      penetracao_seg: penDen > 0 ? penNum / penDen : null,
    };
  });
}
