// ============================================================================
// REGRA DE OURO — esta e a UNICA funcao que calcula delta (variacao vs mes
// anterior) no sistema. NENHUMA tela recalcula delta inline.
//
// Toda tela que mostrar "^12,4% vs junho" num card CHAMA daqui. Se voce esta
// escrevendo `(atual - anterior) / anterior` em qualquer outro arquivo, pare:
// o numero vai divergir do resto do sistema no primeiro caso de borda.
//
// POR QUE ISSO E UMA REGRA E NAO UMA PREFERENCIA
// ---------------------------------------------------------------------------
// O sistema ja teve o bug historico do Dashboard R$ 1.729 vs Projecao R$ 3.879:
// duas telas mostrando "a producao do mes" com numeros diferentes porque cada
// uma leu a sua fonte (PMR estatico x daily vivo). Um delta calculado tela-a-
// tela reproduz o mesmo bug com uma camada de tinta por cima -- e pior, porque
// um delta errado parece plausivel (ninguem confere "% vs mes anterior" de
// cabeca, como confere um total).
//
// A GARANTIA DE "MESMA FONTE, MESMA METRICA"
// ---------------------------------------------------------------------------
// O delta so e honesto se as DUAS pontas forem a mesma metrica conceitual,
// medida do mesmo jeito. Producao-empresa vs producao-empresa. Comissao-
// promotor vs comissao-promotor. Nunca uma ponta em PMR e a outra em daily com
// conceitos diferentes.
//
// Este modulo entrega essa garantia de duas formas, em ordem de preferencia:
//
//   1) deltaDaSerie()  -- PREFERIDA. Recebe UMA serie mensal (construida por um
//      unico caminho de codigo) e extrai as duas pontas dela. As pontas sao a
//      mesma metrica por CONSTRUCAO: sairam do mesmo array, montado pela mesma
//      expressao. E a garantia mais forte que existe -- estrutural, nao por
//      convencao.
//
//   2) calcularDelta() -- quando nao ha serie (ex.: metrica cuja fonte muda com
//      o regime da competencia e precisa ser resolvida uma vez por mes). Aqui a
//      responsabilidade de usar a MESMA definicao nas duas pontas e de quem
//      chama; por isso o resultado carrega `fonteAtual`/`fonteAnterior` e o
//      flag `fontesDivergentes`, para a tela poder ser honesta sobre isso.
//
// Modulo PURO: sem I/O, sem Supabase, sem React. Testavel isoladamente
// (lib/__tests__/calcularDelta.test.ts) e reusavel no servidor e no cliente.
//
// FASE 1 = mes-cheio vs mes-cheio. O recorte por dia (comparar so os N
// primeiros dias uteis dos dois meses, para o mes ABERTO nao aparecer como
// queda falsa) e a Fase 2 -- ver TODO-FASE-2 no fim do arquivo.
// ============================================================================

export type Competencia = { year: number; month: number };

/** up = subiu, down = caiu, flat = variacao despreziel (nao merece seta). */
export type DirecaoDelta = "up" | "down" | "flat";

/**
 * Natureza da metrica -- muda a ARITMETICA, nao so o rotulo.
 *
 *   "valor"      -> grandeza somavel (R$, contagem). A variacao util e RELATIVA
 *                   (deltaPct): "producao subiu 12,4%".
 *   "percentual" -> a metrica JA e um percentual (penetracao, % da meta). A
 *                   variacao util e ABSOLUTA, em PONTOS PERCENTUAIS (deltaAbs):
 *                   "penetracao subiu 2,3 p.p.". Dizer que uma penetracao de
 *                   18% "subiu 12%" e ambiguo (12% relativo? 12 p.p.?) --
 *                   por isso a distincao mora aqui, decidida uma vez.
 *
 * CONTRATO DE UNIDADE para "percentual": os valores entram em PONTOS
 * PERCENTUAIS (18,4 e nao 0,184). Quem tiver fracao 0..1 multiplica por 100
 * ANTES de chamar. As duas pontas na mesma unidade, sempre.
 */
export type TipoMetrica = "valor" | "percentual";

/** Por que o delta nao aparece. `null` quando `mostrar === true`. */
export type MotivoOculto =
  | "sem-atual"      // metrica do mes corrente indisponivel
  | "sem-anterior"   // nao ha competencia anterior consolidada (ex.: jan/2026)
  | "base-zero"      // M-1 = 0 -> divisao por zero (delta seria +infinito)
  | "base-negativa"; // M-1 < 0 -> variacao percentual existe mas engana

export type ResultadoDelta = {
  valorAtual: number | null;
  valorAnterior: number | null;
  /** atual - anterior. Em R$/contagem para "valor"; em p.p. para "percentual". */
  deltaAbs: number | null;
  /** Variacao relativa em %, 1 casa. Sempre null quando tipo = "percentual". */
  deltaPct: number | null;
  direcao: DirecaoDelta;
  /** A tela SO renderiza o badge quando isto e true. */
  mostrar: boolean;
  motivoOculto: MotivoOculto | null;
  tipo: TipoMetrica;
  competenciaAtual: Competencia;
  competenciaAnterior: Competencia;
  /** Nome do mes anterior por extenso, minusculo: "junho". Para "vs junho". */
  labelAnterior: string;
  /** Rotulo da fonte de cada ponta (quando informado por quem chama). */
  fonteAtual: string | null;
  fonteAnterior: string | null;
  /**
   * true quando as duas pontas vieram de fontes diferentes (ex.: mes corrente
   * ABERTO no daily vivo x M-1 FECHADO no PMR). O delta continua valido -- e a
   * mesma metrica conceitual, medida pela fonte que vale em cada regime -- mas
   * a tela deve poder sinalizar. Nunca esconda isso do usuario final.
   */
  fontesDivergentes: boolean;
};

// ---------------------------------------------------------------------------
// Constantes das decisoes (Diego)
// ---------------------------------------------------------------------------

/**
 * Abaixo deste modulo de variacao a direcao vira "flat" (marcador neutro, sem
 * seta). Evita o "^0,0%" absurdo: uma seta verde apontando para cima ao lado de
 * um numero que arredonda para zero. Unidade: mesma do numero exibido (% para
 * "valor", p.p. para "percentual").
 */
export const LIMIAR_FLAT = 0.05;

/** Casas decimais do percentual exibido. */
export const CASAS_PCT = 1;

/** Casas decimais do delta absoluto (dinheiro / p.p.). */
export const CASAS_ABS = 2;

const MESES_EXTENSO = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// ---------------------------------------------------------------------------
// Helpers de competencia
// ---------------------------------------------------------------------------

/**
 * Competencia imediatamente anterior. Vira o ano corretamente:
 * jan/2026 -> dez/2025 (que e justamente onde o delta some, porque o ledger
 * PMR nasce em jan/2026 e nao ha M-1 consolidado).
 */
export function competenciaAnterior(comp: Competencia): Competencia {
  if (comp.month <= 1) return { year: comp.year - 1, month: 12 };
  return { year: comp.year, month: comp.month - 1 };
}

/** "junho" — nome por extenso, minusculo, para o rotulo "vs junho". */
export function nomeMesExtenso(month: number): string {
  return MESES_EXTENSO[(((month - 1) % 12) + 12) % 12] ?? "";
}

export function mesmaCompetencia(a: Competencia, b: Competencia): boolean {
  return a.year === b.year && a.month === b.month;
}

function arredondar(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function ehNumeroFinito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------------------
// O calculo
// ---------------------------------------------------------------------------

export type ParametrosDelta = {
  /** Competencia do valor ATUAL. A anterior e derivada dela. */
  competencia: Competencia;
  valorAtual: number | null | undefined;
  /**
   * Valor da competencia anterior, resolvido pela MESMA definicao de metrica.
   * `null`/`undefined` = nao ha M-1 consolidado -> delta nao aparece.
   */
  valorAnterior: number | null | undefined;
  tipo?: TipoMetrica;
  /** Rotulo da fonte de cada ponta ("pmr", "daily", "fechamento", "cms"...). */
  fonteAtual?: string | null;
  fonteAnterior?: string | null;
};

/**
 * Calcula o delta entre a competencia corrente e a imediatamente anterior.
 *
 * Casos de borda (decisoes do Diego, aplicadas aqui e em lugar nenhum mais):
 *   - M-1 ausente        -> mostrar = false, motivo "sem-anterior"
 *   - M-1 = 0            -> mostrar = false, motivo "base-zero" (evita +infinito)
 *   - M-1 < 0            -> mostrar = false, motivo "base-negativa"
 *   - valor atual ausente-> mostrar = false, motivo "sem-atual"
 *   - |variacao| < 0,05  -> direcao "flat" (mostra, mas sem seta)
 *
 * A direcao sai do numero JA ARREDONDADO: se a tela exibe "0,0%", a direcao e
 * flat. Nunca uma seta verde ao lado de um zero.
 */
export function calcularDelta(params: ParametrosDelta): ResultadoDelta {
  const tipo: TipoMetrica = params.tipo ?? "valor";
  const competenciaAtual = params.competencia;
  const anterior = competenciaAnterior(competenciaAtual);

  const fonteAtual = params.fonteAtual ?? null;
  const fonteAnterior = params.fonteAnterior ?? null;

  const base: ResultadoDelta = {
    valorAtual: ehNumeroFinito(params.valorAtual) ? params.valorAtual : null,
    valorAnterior: ehNumeroFinito(params.valorAnterior) ? params.valorAnterior : null,
    deltaAbs: null,
    deltaPct: null,
    direcao: "flat",
    mostrar: false,
    motivoOculto: null,
    tipo,
    competenciaAtual,
    competenciaAnterior: anterior,
    labelAnterior: nomeMesExtenso(anterior.month),
    fonteAtual,
    fonteAnterior,
    fontesDivergentes:
      fonteAtual != null && fonteAnterior != null && fonteAtual !== fonteAnterior,
  };

  if (base.valorAtual == null) {
    return { ...base, motivoOculto: "sem-atual" };
  }
  if (base.valorAnterior == null) {
    return { ...base, motivoOculto: "sem-anterior" };
  }
  if (base.valorAnterior === 0) {
    return { ...base, motivoOculto: "base-zero" };
  }
  if (base.valorAnterior < 0) {
    return { ...base, motivoOculto: "base-negativa" };
  }

  const diff = base.valorAtual - base.valorAnterior;

  if (tipo === "percentual") {
    // Metrica ja e percentual: a variacao util e em PONTOS PERCENTUAIS.
    // deltaPct fica null de proposito -- "a penetracao subiu X%" e ambiguo.
    const deltaAbs = arredondar(diff, CASAS_PCT);
    return {
      ...base,
      deltaAbs,
      deltaPct: null,
      direcao: Math.abs(deltaAbs) < LIMIAR_FLAT ? "flat" : deltaAbs > 0 ? "up" : "down",
      mostrar: true,
    };
  }

  const deltaPct = arredondar((diff / base.valorAnterior) * 100, CASAS_PCT);
  return {
    ...base,
    deltaAbs: arredondar(diff, CASAS_ABS),
    deltaPct,
    direcao: Math.abs(deltaPct) < LIMIAR_FLAT ? "flat" : deltaPct > 0 ? "up" : "down",
    mostrar: true,
  };
}

// ---------------------------------------------------------------------------
// Caminho PREFERIDO: delta a partir de uma serie mensal canonica
// ---------------------------------------------------------------------------

/**
 * Um ponto de serie mensal. `fonte` viaja junto de proposito: e ela que permite
 * detectar comparacao cross-source (ver `fontesDivergentes`).
 */
export type PontoSerie = {
  year: number;
  month: number;
  valor: number | null;
  fonte?: string | null;
};

export type ParametrosDeltaSerie = {
  /** Serie mensal montada por UM unico caminho de codigo. */
  serie: readonly PontoSerie[];
  /** Competencia corrente (o ponto "atual" da serie). */
  competencia: Competencia;
  tipo?: TipoMetrica;
};

/**
 * Extrai as duas pontas da MESMA serie e delega o calculo a calcularDelta().
 *
 * Esta e a forma preferida: como os dois pontos sairam do mesmo array, montado
 * pela mesma expressao, sao a mesma metrica conceitual por CONSTRUCAO -- nao
 * por convencao nem por disciplina de quem chama.
 *
 * Ponto ausente na serie (ou com valor null) = M-1 nao consolidado -> o delta
 * nao aparece. E exatamente o comportamento desejado para jan/2026, cujo M-1
 * (dez/2025) nao existe no ledger PMR.
 */
export function deltaDaSerie(params: ParametrosDeltaSerie): ResultadoDelta {
  const { serie, competencia, tipo } = params;
  const anterior = competenciaAnterior(competencia);

  const achar = (c: Competencia) =>
    serie.find((p) => p.year === c.year && p.month === c.month) ?? null;

  const pAtual = achar(competencia);
  const pAnterior = achar(anterior);

  return calcularDelta({
    competencia,
    valorAtual: pAtual?.valor ?? null,
    valorAnterior: pAnterior?.valor ?? null,
    tipo,
    fonteAtual: pAtual?.fonte ?? null,
    fonteAnterior: pAnterior?.fonte ?? null,
  });
}

// ---------------------------------------------------------------------------
// Formatacao — tambem centralizada, para o badge ficar igual em toda tela
// ---------------------------------------------------------------------------

/**
 * Texto do delta, ja com sinal e unidade: "+12,4%", "-3,1%", "+2,3 p.p.".
 * Retorna null quando nao ha delta para mostrar.
 */
export function formatarDelta(r: ResultadoDelta): string | null {
  if (!r.mostrar) return null;

  const n = r.tipo === "percentual" ? r.deltaAbs : r.deltaPct;
  if (n == null) return null;

  const abs = Math.abs(n).toFixed(CASAS_PCT).replace(".", ",");
  const sinal = r.direcao === "flat" ? "" : n > 0 ? "+" : "-";
  const unidade = r.tipo === "percentual" ? " p.p." : "%";

  return `${sinal}${abs}${unidade}`;
}

/** "vs junho" — rotulo da ponta de comparacao, nome derivado da competencia. */
export function rotuloComparacao(r: ResultadoDelta): string {
  return `vs ${r.labelAnterior}`;
}

// ============================================================================
// TODO-FASE-2 — RECORTE POR DIA (mes ABERTO)
// ----------------------------------------------------------------------------
// Na Fase 1 o delta e MES-CHEIO vs MES-CHEIO. Em competencia FECHADA isso ja e
// 100% correto. Em competencia ABERTA a ponta atual e PARCIAL (producao ate
// hoje) e a anterior e CHEIA -- entao o delta aparece artificialmente negativo,
// e quanto mais cedo no mes, pior.
//
// A Fase 2 corrige comparando janelas iguais. ATENCAO ao desenho: comparar
// "dia 1 a 25 de julho vs dia 1 a 25 de junho" (dia-do-mes CALENDARIO) NAO
// resolve -- introduz um vies proprio. Medido nos dados reais de 2026:
//
//     2026-06: dia 25 = quinta   -> 19 dias uteis de 1 a 25
//     2026-07: dia 25 = SABADO   -> 18 dias uteis de 1 a 25
//
// Sao 18 dias de trabalho contra 19: vies embutido de -5,3%, na direcao errada.
// Alem disso a competencia do sistema NAO e o mes calendario -- getProduction-
// Window (lib/productionPeriod.ts) define a janela do ultimo dia util do mes
// anterior ao ultimo dia util do mes corrente.
//
// O recorte correto e por INDICE DE DIA UTIL DECORRIDO dentro da janela de
// producao ("os N primeiros dias uteis de cada competencia"), reusando
// productionBusinessWindow/countBusinessDays de lib/trp/vigencia.ts, que ja sao
// holiday-aware.
//
// Pre-requisitos conhecidos da Fase 2:
//   - daily_production_records so cobre abr/2026 em diante (jan/fev/mar/mai sem
//     daily) -> onde nao houver daily nas DUAS pontas, o delta cai para
//     mes-cheio e a tela precisa rotular qual regua usou.
//   - o contador de dias uteis decorridos tem off-by-one conhecido (inclui o dia
//     corrente nao-fechado no divisor); corrigir ANTES de usa-lo aqui, senao o
//     vies entra nas duas pontas sem se cancelar (M-1 e passado e completo).
// ============================================================================
