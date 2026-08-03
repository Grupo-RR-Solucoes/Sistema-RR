// ============================================================================
// lib/delta/recorteJanela.ts — o RECORTE do delta, na MESMA familia da
// competencia.
//
// O DEFEITO QUE ISTO FECHA (03/08/2026). A competencia de um registro sempre foi
// decidida pela JANELA de producao (getProductionPeriodFromValue: do ultimo dia
// util do mes anterior ao ultimo dia util do mes vigente). Mas o recorte do
// delta — "compare so os primeiros N dias das duas pontas" — era feito por
// DIA DO MES, lido com `Number(data.slice(8, 10))`. Duas familias diferentes na
// mesma conta.
//
// Em ago/2026 isso zerou a ponta atual: as 32 linhas elegiveis da competencia
// tinham movement_date 2026-07-31 (a producao do dia so sobe no dia seguinte).
// Pela janela sao agosto — passavam no filtro de competencia. Pelo calendario o
// dia extraido e 31, o corte era 3 (dia de hoje), e `31 <= 3` e falso: nenhuma
// linha sobrevivia. Ponta atual R$ 0,00 contra R$ 853.044,40 de julho, e o card
// anunciava -100% de queda num mes que tinha R$ 284.916,12 importados.
//
// A REGRA NOVA: o corte e POSICAO DENTRO DA JANELA. "Os N primeiros dias de
// producao" — 1 = o primeiro dia util da janela (que e o ultimo dia util do mes
// ANTERIOR, o "dia-cabeca"), 2 = o segundo, e assim por diante. O mesmo N nas
// duas pontas. Como a posicao nasce da mesma janela que decide a competencia,
// nenhuma linha aprovada no filtro pode ser descartada pelo corte por pertencer
// a "outro mes" — o que era exatamente o defeito.
//
// ISTO JA ESTAVA PREVISTO. lib/delta/calcularDelta.ts registrava, na nota (1) do
// rodape: "DIA-DO-MES NAO E DIA UTIL... Um recorte por INDICE DE DIA UTIL
// (reusando productionBusinessWindow/countBusinessDays de lib/trp/vigencia.ts,
// ja holiday-aware) eliminaria isso; fica anotado como opcao, nao como
// pendencia." Virou pendencia no dia em que a producao inteira caiu no
// dia-cabeca. A nota (1) tambem media o vies que isto elimina de quebra: 1..25
// de junho tem 19 dias uteis e 1..25 de julho tem 18, ~5% de vies estrutural na
// direcao do mes que comeca em dia pior.
//
// E RESOLVE DE RAIZ O QUE O PREFIXO DE MES REMENDAVA. Os detectores de "dias com
// dado" filtravam por `bruta.startsWith(prefixoMesCorrente)` com a justificativa
// escrita em app/api/dashboard/route.ts:850-852: "O 'dia-cabeca' que a janela
// herda do mes anterior (30/06 na competencia de julho) tem dia-do-mes 30 e
// viraria o maximo, mascarando que a diaria so foi carregada ate o dia 23". Era
// um remendo: jogar fora o primeiro dia da janela para impedir que o numero
// dele, grande por ser do mes passado, fosse confundido com um dia adiantado
// deste mes. Com POSICAO nao ha confusao possivel — o dia-cabeca e a posicao 1,
// a menor de todas, e passa a poder ser contado como o que e.
//
// Modulo PURO (sem I/O, sem Supabase, sem React), como o calcularDelta.
// ============================================================================

import { countBusinessDays, productionBusinessWindow, ymd } from "@/lib/trp/vigencia";

export type CompetenciaJanela = { year: number; month: number };

/** Linha de daily pelo que o recorte REALMENTE le: a cascata de datas. */
export type LinhaComData = {
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
};

type JanelaCache = {
  start: Date;
  end: Date;
  total: number;
  holidays: Set<string>;
};

// A janela de uma competencia e deterministica (so depende de ano/mes e do
// calendario nacional), entao memoizar e seguro e evita recalcular feriados a
// cada uma das ~800 linhas de um laco.
const CACHE = new Map<string, JanelaCache>();

function janelaDe(comp: CompetenciaJanela): JanelaCache {
  const chave = `${comp.year}-${comp.month}`;
  const hit = CACHE.get(chave);
  if (hit) return hit;
  const j = productionBusinessWindow(comp.year, comp.month);
  CACHE.set(chave, j);
  return j;
}

/** Total de dias de producao (dias uteis) da janela da competencia. */
export function totalDiasDeProducao(comp: CompetenciaJanela): number {
  return janelaDe(comp).total;
}

/**
 * Os dois totais que resolverJanela precisa para clampar (a competencia e a
 * anterior). Existe para o chamador nao repetir a derivacao da competencia
 * anterior em cada sitio — e porque calcularDelta e uma FOLHA sem imports (ver
 * ParametrosJanela.totalAtual) e nao pode calcular isto sozinho.
 */
export function totaisDaJanela(comp: CompetenciaJanela): {
  totalAtual: number;
  totalAnterior: number;
} {
  const anterior =
    comp.month <= 1 ? { year: comp.year - 1, month: 12 } : { year: comp.year, month: comp.month - 1 };
  return { totalAtual: totalDiasDeProducao(comp), totalAnterior: totalDiasDeProducao(anterior) };
}

/**
 * A data que representa o registro. MESMA cascata que decide a competencia em
 * getProductionPeriodFromValue (movement -> contract -> proposal). Manter as
 * duas coisas na mesma cascata e metade do conserto: a outra metade e a posicao.
 */
export function dataDoRegistro(r: LinhaComData): string | null {
  const bruta = r.movement_date || r.contract_date || r.proposal_date;
  const m = String(bruta ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/**
 * A POSICAO da data dentro da janela da competencia: 1 = primeiro dia de
 * producao (o dia-cabeca), 2 = segundo, ...
 *
 *   0     -> a data e ANTERIOR ao inicio da janela (fora, pelo comeco).
 *   null  -> data ausente ou ilegivel.
 *
 * DATA EM DIA NAO-UTIL: recebe a posicao do dia util imediatamente ANTERIOR
 * (countBusinessDays e inclusivo e nao conta o proprio sabado). Isso e
 * proposital — um registro datado de sabado pertence ao periodo ja decorrido,
 * e nao a um dia que nao existe na contagem. Monotono: data maior nunca tem
 * posicao menor.
 *
 * DATA DEPOIS DO FIM DA JANELA: fica presa no total. As duas janelas do sistema
 * nao terminam no mesmo dia — getProductionWindow (que decide a competencia)
 * vai ate o ULTIMO dia util do mes, e productionBusinessWindow (que conta o
 * ritmo) para no PENULTIMO. Um registro do ultimo dia util cai nessa fresta.
 * Prender no total o mantem DENTRO quando N ja chegou ao fim da janela, que e o
 * unico momento em que ele poderia aparecer — e o mantem fora enquanto N e
 * menor, que e o correto (ainda nao chegamos la). Sem isso, o registro sumiria
 * do recorte no fim do mes, trocando um defeito de borda por outro.
 */
export function posicaoNaJanela(
  comp: CompetenciaJanela,
  iso: string | null | undefined
): number | null {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const j = janelaDe(comp);
  if (d < j.start) return 0;
  const alvo = d > j.end ? j.end : d;
  return countBusinessDays(j.start, alvo, j.holidays);
}

/**
 * O RECORTE da competencia: um objeto que sabe dizer se um registro esta dentro
 * dos N primeiros dias de producao.
 *
 * `n` null/<=0 => `dentro()` responde true para TUDO que esta na janela (nenhum
 * corte pedido), preservando o contrato do `ateDia: null` que este helper
 * substitui.
 */
export type RecorteJanela = {
  competencia: CompetenciaJanela;
  /** N pedido, ja limitado ao total de dias de producao da janela. */
  n: number | null;
  total: number;
  /** Ultimo dia (YYYY-MM-DD) que ainda entra no recorte. null = sem corte. */
  limite: string | null;
  posicao(r: LinhaComData): number | null;
  dentro(r: LinhaComData): boolean;
};

export function recorteDaJanela(
  comp: CompetenciaJanela,
  n: number | null | undefined
): RecorteJanela {
  const j = janelaDe(comp);
  const nEfetivo = n == null || n <= 0 ? null : Math.min(Math.trunc(n), j.total);

  let limite: string | null = null;
  if (nEfetivo != null) {
    // Caminha do inicio ate achar o N-esimo dia util. Barato (<= 23 iteracoes)
    // e roda uma vez por recorte, nao por linha.
    let d = new Date(j.start.getTime());
    let vistos = 0;
    while (d <= j.end) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6 && !j.holidays.has(ymd(d))) {
        vistos += 1;
        if (vistos === nEfetivo) {
          limite = ymd(d);
          break;
        }
      }
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    }
  }

  const posicao = (r: LinhaComData) => posicaoNaJanela(comp, dataDoRegistro(r));

  return {
    competencia: comp,
    n: nEfetivo,
    total: j.total,
    limite,
    posicao,
    dentro(r: LinhaComData) {
      if (nEfetivo == null) return true;
      const p = posicao(r);
      return p != null && p >= 1 && p <= nEfetivo;
    },
  };
}

/**
 * As POSICOES da janela que tem ao menos um registro — substituto direto do
 * `diasComDadoNoMesCorrente` (que era dia-do-mes e por isso precisava excluir o
 * dia-cabeca por prefixo; ver o cabecalho deste arquivo).
 *
 * Alimenta resolverJanela para o corte virar min(N de hoje, ultima posicao com
 * dado) — a defesa contra atraso de importacao ser lido como queda.
 */
export function posicoesComDado(
  rows: readonly LinhaComData[],
  comp: CompetenciaJanela,
  elegivel?: (r: LinhaComData) => boolean
): Set<number> {
  const out = new Set<number>();
  for (const r of rows) {
    if (elegivel && !elegivel(r)) continue;
    const p = posicaoNaJanela(comp, dataDoRegistro(r));
    if (p != null && p >= 1) out.add(p);
  }
  return out;
}
