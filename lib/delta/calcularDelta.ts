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
// JANELA (Fase 2): competencia FECHADA compara mes-cheio vs mes-cheio; ABERTA
// recorta as duas pontas no mesmo dia-do-mes ("ate-dia-N"). Ver ModoJanela e
// resolverJanela. Onde o dado nao tem data por linha nas duas pontas, o modo
// cai para mes-cheio e a tela ROTULA -- nunca se inventa um recorte.
// ============================================================================

export type Competencia = { year: number; month: number };

/**
 * Janela de comparacao (Fase 2).
 *
 *   "mes-cheio"  -> competencia inteira dos dois lados. Correto quando a
 *                   competencia atual esta FECHADA (as duas pontas sao totais
 *                   finais), e e tambem o FALLBACK quando o recorte por dia nao
 *                   e possivel (ver abaixo).
 *   "ate-dia-N"  -> so os registros com dia-do-mes <= N, nos DOIS lados. E o
 *                   modo do mes ABERTO: sem ele a ponta atual e parcial e a
 *                   anterior e cheia, e o card mostra uma queda que nao existe.
 *
 * QUANDO O RECORTE NAO E POSSIVEL: exige dado com DATA POR LINHA nas duas
 * pontas. Metrica cuja ponta anterior vive num agregado mensal (o fechamento
 * por empresa, por exemplo) nao tem dia nenhum para cortar -- ai o modo cai
 * para "mes-cheio" e a tela ROTULA isso. Nunca inventar um recorte que o dado
 * nao sustenta.
 */
export type ModoJanela = "mes-cheio" | "ate-dia-N";

export type Janela = {
  modo: ModoJanela;
  /** Dia de corte na competencia ATUAL. null em "mes-cheio". */
  diaCorteAtual: number | null;
  /**
   * Dia de corte na competencia ANTERIOR. Pode ser MENOR que o atual: se hoje e
   * 31 e o mes anterior tem 30 dias, cortar em 31 la nao existe -- o corte e
   * clampado para 30, que e o mes anterior inteiro. null em "mes-cheio".
   */
  diaCorteAnterior: number | null;
  /** true quando o clamp acima reduziu o N da ponta anterior. */
  clampado: boolean;
  /**
   * true quando o recorte foi PEDIDO mas o dado nao sustentou e caiu para
   * mes-cheio. A tela usa para rotular "mes cheio" e nao mentir que a janela
   * e igual dos dois lados.
   */
  recorteIndisponivel: boolean;
};

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
  /** Janela usada nas duas pontas (Fase 2). Ver ModoJanela. */
  janela: Janela;
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

/** Ultimo dia do mes (28/29/30/31), com ano bissexto correto. */
export function ultimoDiaDoMes(comp: Competencia): number {
  // day 0 do mes seguinte = ultimo dia deste mes.
  return new Date(Date.UTC(comp.year, comp.month, 0)).getUTCDate();
}

export type ParametrosJanela = {
  competencia: Competencia;
  modo: ModoJanela;
  /** Dia de hoje (1..31). Obrigatorio em "ate-dia-N". */
  dia?: number | null;
  /**
   * true quando quem chama JA SABE que nao consegue recortar (falta dado com
   * data por linha em alguma das pontas). Forca mes-cheio e marca o motivo.
   */
  recorteIndisponivel?: boolean;
};

/**
 * Resolve a janela ANTES da consulta -- quem chama precisa dos dois N para
 * montar os filtros. Aqui mora o CLAMP de fim de mes.
 *
 * O clamp e assimetrico de proposito: o N da ponta atual e o dia de hoje; o da
 * ponta anterior e min(hoje, ultimo dia do mes anterior). Ex.: hoje 31/07 vs
 * junho (30 dias) -> atual corta em 31, anterior corta em 30 = junho inteiro.
 * Sem o clamp o filtro `dia <= 31` em junho simplesmente nunca casaria com o
 * dia 31 (que nao existe) -- daria no mesmo por acidente, mas o campo
 * `clampado` deixa explicito que a janela NAO e identica, e a tela pode dizer.
 */
export function resolverJanela(params: ParametrosJanela): Janela {
  const { competencia, modo, dia, recorteIndisponivel } = params;

  if (modo === "mes-cheio" || recorteIndisponivel) {
    return {
      modo: "mes-cheio",
      diaCorteAtual: null,
      diaCorteAnterior: null,
      clampado: false,
      recorteIndisponivel: recorteIndisponivel === true,
    };
  }

  const anterior = competenciaAnterior(competencia);
  const maxAtual = ultimoDiaDoMes(competencia);
  const maxAnterior = ultimoDiaDoMes(anterior);

  // dia de hoje, sanitizado para o intervalo valido do mes corrente.
  const n = Math.min(Math.max(Math.trunc(dia ?? 0), 1), maxAtual);
  const nAnterior = Math.min(n, maxAnterior);

  return {
    modo: "ate-dia-N",
    diaCorteAtual: n,
    diaCorteAnterior: nAnterior,
    clampado: nAnterior < n,
    recorteIndisponivel: false,
  };
}

const JANELA_CHEIA: Janela = {
  modo: "mes-cheio",
  diaCorteAtual: null,
  diaCorteAnterior: null,
  clampado: false,
  recorteIndisponivel: false,
};

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
  /**
   * Janela usada para produzir os dois valores (de resolverJanela). Omitir =
   * mes-cheio. NAO recorta nada aqui: quem consulta o dado aplica o filtro; o
   * helper so registra qual janela foi usada, para o badge poder rotular.
   */
  janela?: Janela;
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
    janela: params.janela ?? JANELA_CHEIA,
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
  /**
   * Janela com que a SERIE foi montada. Quem monta a serie ja aplicou o
   * recorte nos dois pontos; aqui so viaja junto para o badge rotular.
   */
  janela?: Janela;
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
  const { serie, competencia, tipo, janela } = params;
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
    janela,
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

/**
 * Rotulo curto da JANELA, para o card nao mentir sobre o que esta comparando.
 * null = nao precisa dizer nada (competencia fechada comparando dois totais
 * finais e o caso normal; anotar "mes cheio" ali so poluiria).
 *
 *   "1-26"      -> recorte igual dos dois lados
 *   "1-26 x 30" -> clamp de fim de mes (o M-1 tinha menos dias)
 *   "mes cheio" -> o recorte foi pedido mas o dado nao sustenta
 */
export function rotuloJanela(r: ResultadoDelta): string | null {
  const j = r.janela;
  if (j.recorteIndisponivel) return "mes cheio";
  if (j.modo !== "ate-dia-N") return null;
  if (j.clampado) return `1-${j.diaCorteAtual} x 1-${j.diaCorteAnterior}`;
  return `1-${j.diaCorteAtual}`;
}

// ============================================================================
// NOTAS DA JANELA "ate-dia-N" — o que ela corrige e o que NAO corrige
// ----------------------------------------------------------------------------
// CORRIGE (o motivo da Fase 2): o parcial-vs-cheio. Sem recorte, a ponta atual
// de um mes aberto e parcial e a anterior e cheia, e o card mostra uma queda
// que nao existe -- pior quanto mais cedo no mes.
//
// NAO CORRIGE, e e bom saber:
//
// 1) DIA-DO-MES NAO E DIA UTIL. O corte e por dia do calendario (decisao
//    Diego). Meses comecam em dias da semana diferentes, entao 1..N de um mes
//    pode ter mais dias uteis que 1..N do outro. Medido em 2026: 1..25 de junho
//    tem 19 dias uteis e 1..25 de julho tem 18 (dia 25 caiu num sabado) -- um
//    vies residual de ~5% na direcao do mes com menos dias uteis. Um recorte
//    por INDICE DE DIA UTIL (reusando productionBusinessWindow/countBusinessDays
//    de lib/trp/vigencia.ts, ja holiday-aware) eliminaria isso; fica anotado
//    como opcao, nao como pendencia.
//
// 2) ATRASO DE IMPORTACAO. O corte diz "ate o dia N"; o dado diz "ate o ultimo
//    dia importado". Se a diaria do mes corrente esta 3 dias atrasada, a ponta
//    atual cobre menos dias reais que a anterior mesmo com o mesmo N. Quem
//    quiser janela de verdade igual precisa cortar pelo ultimo dia COM DADO do
//    mes corrente, nao pelo dia de hoje.
//
// 3) O PRIMEIRO DIA DA JANELA DE COMPETENCIA. A competencia do sistema comeca
//    no ultimo dia util do mes anterior (getProductionWindow), cujo dia-do-mes
//    e alto (29, 30, 31). Com corte <= N (N tipicamente < 29) esse dia fica de
//    fora -- nos DOIS lados, simetricamente. Por isso o recorte nao reconcilia
//    com o total "mes cheio" do mesmo card, e nao deveria mesmo.
// ============================================================================
