import { todayInFortaleza } from "@/lib/dateFortaleza";
import { countBusinessDays, productionBusinessWindow } from "@/lib/trp/vigencia";

// ============================================================
// JANELA DE RITMO — fonte UNICA da aritmetica de dias uteis da projecao.
//
// Extraido VERBATIM de lib/projecaoMetas.ts (frente do divisor de ritmo). Existia
// uma SEGUNDA copia em lib/equipe/teamProduction.ts que divergiu: ficou com
// "refDate >= end" e decrementava o proprio campo exibido. Duas copias da mesma
// regra = a divergencia Dashboard x Projecao de volta. Agora ha UMA.
//
// DOIS conceitos distintos, nao os confunda:
//
// (1) diasDecorridos = dias uteis da janela ja VENCIDOS, HOJE INCLUIDO. E o que a
//     tela exibe ("23/23" no dia 30/07). Resultado puro de countBusinessDays,
//     NUNCA decrementado.
// (2) diasParaRitmo = o DIVISOR da projecao = diasDecorridos MENOS o dia corrente,
//     quando a competencia esta ABERTA e hoje e dia util. Motivo: a producao de
//     hoje so entra no sistema amanha, entao o dia corrente esta no denominador
//     sem estar no numerador — sem tirar, o divisor conta 1 a mais e a projecao
//     vem subestimada. Fim de semana/feriado ja nao contam (nada a subtrair).
//
// countBusinessDays e inclusivo nas duas pontas; reusa a fn (== 1) para "hoje e
// dia util" em vez de exportar um isBusinessDay novo. NAO toca o numerador
// (o acumulado), preservando a paridade com a "Producao do grupo" do Dashboard.
// ============================================================

export type JanelaRitmo = {
  /** Inicio da janela de producao RR (ultimo dia util do mes anterior). */
  start: Date;
  /** Fim da janela (penultimo dia util do mes vigente). */
  end: Date;
  /** Dias uteis TOTAIS da janela (o denominador do "N/total"). */
  total: number;
  holidays: Set<string>;
  /** "Hoje" normalizado a meia-noite UTC (o mesmo usado no recorte do acumulado). */
  refDate: Date;
  /** EXIBIDO: dias uteis vencidos, HOJE INCLUIDO. Nunca decrementado. */
  diasDecorridos: number;
  /** DIVISOR do ritmo: decorridos menos o dia corrente (aberto + hoje dia util). */
  diasParaRitmo: number;
  /** COMPLETA so quando refDate PASSA de end (ou o regime ja fechou). */
  periodoCompleto: boolean;
};

/**
 * Resolve a janela de producao do mes + a aritmetica de dias uteis da projecao.
 *
 * @param opts.closed   regime da competencia !== "open" (fechado => sempre completo).
 * @param opts.referenceDate  "hoje" a forcar (testes/gates). Default: fuso Fortaleza.
 */
export function resolverJanelaRitmo(
  year: number,
  month: number,
  opts: { closed: boolean; referenceDate?: Date }
): JanelaRitmo {
  // "Hoje" (refDate) no fuso America/Fortaleza por padrao, NAO UTC. Em UTC, as 21h
  // BRT o dia ja virava o seguinte e contava 1 dia util a mais. Normaliza para
  // meia-noite UTC (idempotente para quem ja passa a data normalizada).
  const refDate = opts.referenceDate
    ? new Date(
        Date.UTC(
          opts.referenceDate.getUTCFullYear(),
          opts.referenceDate.getUTCMonth(),
          opts.referenceDate.getUTCDate()
        )
      )
    : todayInFortaleza();

  const { start, end, total, holidays } = productionBusinessWindow(year, month);
  const elapsedEnd = refDate < start ? null : refDate > end ? end : refDate;
  // COMPLETA so quando a data de referencia PASSA do fim da janela. Em refDate ==
  // end (ultimo dia da janela) a competencia AINDA esta aberta e ainda extrapola:
  // a producao daquele dia so entra no sistema no dia seguinte.
  const periodoCompleto = opts.closed || refDate > end;
  const diasDecorridos = elapsedEnd ? countBusinessDays(start, elapsedEnd, holidays) : 0;
  const hojeEhDiaUtil = countBusinessDays(refDate, refDate, holidays) === 1;
  const diasParaRitmo =
    !periodoCompleto && hojeEhDiaUtil ? Math.max(0, diasDecorridos - 1) : diasDecorridos;

  return { start, end, total, holidays, refDate, diasDecorridos, diasParaRitmo, periodoCompleto };
}

/**
 * Ritmo linear a partir de uma janela ja resolvida: acumulado / diasParaRitmo *
 * total. Periodo completo devolve o proprio acumulado; divisor 0 devolve 0.
 * MESMA formula que a /projecao e a /equipe usam — nenhuma das duas divide na mao.
 */
export function projetarPorRitmo(janela: JanelaRitmo, acum: number): number {
  if (janela.periodoCompleto) return acum;
  return janela.diasParaRitmo > 0 ? (acum / janela.diasParaRitmo) * janela.total : 0;
}
