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
  /**
   * Corte na competencia ATUAL, em DIAS DE PRODUCAO (posicao na janela), NAO em
   * dia do mes. null em "mes-cheio".
   *
   * O NOME ficou: renomear para `corteAtual` alcancaria 8 arquivos, entre eles
   * dois gates de outra frente (medida-c), e o ganho nao paga o risco agora.
   * Fica registrado que o campo mudou de UNIDADE em 03/08/2026 — quem ler
   * `diaCorteAtual: 2` deve entender "2 dias de producao", nao "dia 2".
   */
  diaCorteAtual: number | null;
  /**
   * N de HOJE (dias de producao decorridos) antes de qualquer limitacao
   * (Fase 2.1). Guardado para dar para explicar a diferenca quando
   * `limitadoPorDado` e true. Mesma unidade de diaCorteAtual.
   */
  diaHoje: number | null;
  /**
   * true quando o corte foi puxado para tras porque a competencia atual ainda
   * nao tem dado ate hoje (atraso de importacao). Ver ultimoDiaComDado.
   */
  limitadoPorDado: boolean;
  /**
   * Corte na competencia ANTERIOR, em dias de producao. Pode ser MENOR que o
   * atual: se o N de hoje e 21 e a janela anterior so tem 20 dias de producao,
   * cortar em 21 la nao existe -- o corte e clampado para 20, que e a janela
   * anterior inteira. null em "mes-cheio".
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
  | "base-negativa"  // M-1 < 0 -> variacao percentual existe mas engana
  // A competencia atual nao tem NENHUMA linha de origem: o zero e AUSENCIA DE
  // IMPORTACAO, nao resultado. O nome diz a CAUSA (nada foi importado), nao o
  // efeito (o valor deu zero) — sao situacoes diferentes e so uma esconde.
  | "atual-sem-importacao";

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

/**
 * FASE 2.1 — o maior dia-do-mes que TEM dado, dentre os informados.
 *
 * Recebe os dias (1..31) que tem PELO MENOS UMA linha na competencia corrente.
 * Devolve o MAIOR deles — nunca o primeiro buraco. A distincao importa: um
 * domingo ou feriado no meio do mes nao tem linha e NAO deve encurtar a janela;
 * so o fim da serie e que revela ate onde o dado realmente vai.
 *
 * `null` quando nao ha nenhum dia com dado (a competencia nao tem daily).
 */
export function ultimaPosicaoComDado(
  posicoes: Iterable<number> | null | undefined
): number | null {
  if (!posicoes) return null;
  let max: number | null = null;
  for (const d of posicoes) {
    const n = Math.trunc(Number(d));
    if (!Number.isFinite(n) || n < 1 || n > 31) continue;
    if (max == null || n > max) max = n;
  }
  return max;
}

export type ParametrosJanela = {
  competencia: Competencia;
  modo: ModoJanela;
  /**
   * N = quantos DIAS DE PRODUCAO da janela ja decorreram. Obrigatorio em
   * "ate-dia-N".
   *
   * NAO e o dia do mes. E a POSICAO na janela de producao: 1 = primeiro dia
   * util da janela (o ultimo dia util do mes ANTERIOR), 2 = o segundo, etc.
   * Vem de resolverJanelaRitmo(...).diasDecorridos — a mesma aritmetica que a
   * /projecao exibe como "N/total dias uteis".
   *
   * ATE 03/08/2026 este campo era o dia do mes, e o recorte comparava
   * `Number(data.slice(8,10)) <= N`. Como a COMPETENCIA sempre saiu da janela,
   * as duas coisas eram de familias diferentes: em ago/2026 as 32 linhas da
   * competencia estavam em 2026-07-31 (dia 31) e o corte era 3, entao nenhuma
   * sobrevivia e o card dava -100%. Ver lib/delta/recorteJanela.ts.
   */
  n?: number | null;
  /**
   * FASE 2.1 — dias-do-mes que TEM dado na competencia CORRENTE (>= 1 linha
   * cada). O corte vira min(hoje, maior dia com dado).
   *
   * POR QUE: o corte diz "ate o dia N"; o dado diz "ate o ultimo dia
   * importado". Se a diaria do mes corrente esta 3 dias atrasada, a ponta atual
   * cobre menos dias reais que a anterior mesmo com o mesmo N — e o card mostra
   * queda onde houve alta. Medido em 26/07/2026: com N=26 a producao do grupo
   * dava -10,6%; com as duas pontas em 1-23 (ultimo dia importado) da +3,0%.
   * O sinal inverte por atraso de carga, nao por desempenho.
   *
   * O DADO e por escopo (cada tela tem o seu conjunto), mas a REGRA mora aqui.
   * Consequencia aceita: num escopo que nao vendeu no ultimo dia importado, o N
   * recua um dia. A janela fica mais curta, porem CONTINUA IGUAL nos dois lados
   * e o rotulo mostra o N real — encurtar honestamente e melhor que comparar
   * janelas desiguais.
   *
   * CONTRATO — passe POSICOES da janela (1 = primeiro dia de producao), nao
   * dias do mes. Use posicoesComDado() de lib/delta/recorteJanela.ts.
   *
   * O CONTRATO ANTIGO PEDIA O CONTRARIO, e a razao morreu com o conserto: ele
   * exigia "SO os dias do MES-CALENDARIO, NAO o dia-cabeca", porque o
   * dia-cabeca da competencia de julho e 30/06 — dia-do-mes 30, que viraria o
   * maximo do conjunto e mascararia que a diaria so foi carregada ate o dia 23.
   * Era um remendo contra a propria mistura de familias. Em posicao o
   * dia-cabeca e 1, a MENOR de todas, e nao mascara nada: ele volta a poder ser
   * contado, que e o correto — producao daquele dia e producao da competencia.
   *
   * Ausente/vazio => sem limitacao (comportamento da Fase 2).
   */
  posicoesComDadoNaJanela?: Iterable<number> | null;
  /**
   * Total de DIAS DE PRODUCAO da janela de cada ponta (totalDiasDeProducao de
   * lib/delta/recorteJanela.ts). E o teto do clamp: pedir o 23o dia de producao
   * numa janela que so tem 21 nao existe.
   *
   * POR QUE VEM DE FORA E NAO E CALCULADO AQUI. Este modulo e uma FOLHA sem
   * imports, de proposito: e isso que permite `node --test` rodar
   * lib/__tests__/calcularDelta.test.ts nativamente, sem loader nem resolucao
   * de alias "@/". Importar recorteJanela (que importa trp/vigencia) quebrou o
   * suite na primeira tentativa deste conserto — o erro foi
   * ERR_MODULE_NOT_FOUND em '@/lib'. Quem chama ja tem a janela resolvida;
   * passar dois numeros e mais barato que perder a testabilidade do modulo.
   */
  totalAtual: number;
  totalAnterior: number;
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
  const {
    modo,
    n: nPedido,
    recorteIndisponivel,
    posicoesComDadoNaJanela,
    totalAtual,
    totalAnterior,
  } = params;

  if (modo === "mes-cheio" || recorteIndisponivel) {
    return {
      modo: "mes-cheio",
      diaCorteAtual: null,
      diaHoje: null,
      limitadoPorDado: false,
      diaCorteAnterior: null,
      clampado: false,
      recorteIndisponivel: recorteIndisponivel === true,
    };
  }

  // O TETO DE CADA PONTA agora e o total de DIAS DE PRODUCAO da janela dela, e
  // nao o numero de dias do mes-calendario. Janelas de meses diferentes tem
  // quantidades de dias uteis diferentes (jul/2026 tem 23, jun/2026 tem 21),
  // exatamente como fev tem menos dias que jan — o clamp continua existindo, so
  // passou a medir na unidade certa.
  const maxAtual = Math.max(1, Math.trunc(totalAtual));
  const maxAnterior = Math.max(1, Math.trunc(totalAnterior));

  // 1) N de hoje (dias de producao decorridos), sanitizado para a janela atual.
  const hoje = Math.min(Math.max(Math.trunc(nPedido ?? 0), 1), maxAtual);

  // 2) FASE 2.1 — nao adianta cortar no 18o dia de producao se o dado so vai
  //    ate o 15o.
  const ultimoDado = ultimaPosicaoComDado(posicoesComDadoNaJanela);
  const n = ultimoDado != null ? Math.min(hoje, ultimoDado) : hoje;

  // 3) clamp (Fase 2) — aplicado DEPOIS, sobre o N ja limitado.
  const nAnterior = Math.min(n, maxAnterior);

  return {
    modo: "ate-dia-N",
    diaCorteAtual: n,
    diaHoje: hoje,
    limitadoPorDado: n < hoje,
    diaCorteAnterior: nAnterior,
    clampado: nAnterior < n,
    recorteIndisponivel: false,
  };
}

const JANELA_CHEIA: Janela = {
  modo: "mes-cheio",
  diaCorteAtual: null,
  diaHoje: null,
  limitadoPorDado: false,
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
  /**
   * BORDA DE MES VAZIO — quantas LINHAS DE ORIGEM a competencia ATUAL tem,
   * antes de qualquer recorte por dia. `0` = nada foi importado nela.
   *
   * POR QUE ISTO PRECISOU ENTRAR NA ENTRADA. O helper recebia apenas o VALOR
   * agregado, e um valor `0` e ambiguo: pode ser "o mes nao vendeu" (informacao
   * real, que DEVE aparecer como queda) ou "o mes nao foi importado" (ausencia,
   * que nao e desempenho nenhum). Nada do que chegava aqui separava os dois —
   * `janela.recorteIndisponivel` nao serve, porque tambem fica true quando e a
   * ponta ANTERIOR que nao tem daily. Quem consulta o dado sabe a contagem; so
   * faltava ela viajar junto.
   *
   * CONTRATO: conte as linhas da COMPETENCIA INTEIRA, nao as do recorte. A
   * pergunta e "existe dado neste mes?", nao "existe dado ate o dia N" — essa
   * segunda ja e respondida pela Fase 2.1 (ver diasComDadoNoMesCorrente).
   *
   * Ausente/`null` => o chamador nao sabe informar e a borda NAO se aplica
   * (comportamento anterior preservado, bit a bit).
   */
  linhasOrigemAtual?: number | null;
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
  // BORDA DE MES VAZIO — zero SEM IMPORTACAO nao e queda.
  //
  // A DISTINCAO E O PONTO: producao legitimamente zero num mes QUE TEM dado
  // importado e informacao real e continua mostrando delta (-100%, e esta
  // certo: o mes existiu e nao vendeu). O que se esconde e o mes em que NADA
  // foi importado — ali o zero e ausencia de fato, nao resultado, e comparar
  // ausencia com um mes cheio produz "-100,0%" que le como colapso de vendas.
  //
  // Por isso a guarda exige as DUAS condicoes: valor zero E zero linha de
  // origem. So o valor nao basta; so a contagem tambem nao (um mes pode ter
  // linhas e somar zero).
  //
  // FICA ANTES das guardas do M-1 de proposito: quando a competencia atual nao
  // foi importada, ESSE e o diagnostico util ("falta importar a diaria"), e nao
  // "nao ha mes anterior". As duas escondem o badge igual; muda so o motivo que
  // fica registrado no payload.
  //
  // E o mesmo raciocinio da Fase 2.1, um degrau adiante: ela ja impedia que
  // dado PARCIAL fosse lido como queda (corte em min(hoje, ultimo dia com
  // dado)); faltava o caso em que nao ha dado NENHUM, onde nao existe dia para
  // onde recuar o corte e a Fase 2.1 nao tem o que fazer.
  if (base.valorAtual === 0 && params.linhasOrigemAtual === 0) {
    return { ...base, motivoOculto: "atual-sem-importacao" };
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
  /**
   * BORDA DE MES VAZIO — repassado tal qual para calcularDelta. Ver o contrato
   * completo em ParametrosDelta.linhasOrigemAtual.
   *
   * NAO da para derivar isto da propria serie: um ponto com `valor: 0` pode ser
   * mes vazio OU mes que nao vendeu, e a serie nao carrega essa diferenca. Duas
   * series do sistema chegam a esta funcao com o mes corrente ja materializado
   * em zero — producaoMensal do Dashboard (monthsSet.add(month)) e a serie
   * hibrida da /equipe (rangeMeses cobre ate o mes do refDate, e mes corrente
   * sem daily vira producao 0 / fonte "vazio"). Nas duas, o zero so se explica
   * com a contagem, que vem de fora.
   */
  linhasOrigemAtual?: number | null;
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
  const { serie, competencia, tipo, janela, linhasOrigemAtual } = params;
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
    linhasOrigemAtual,
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
 *   "3 dias"       -> recorte igual dos dois lados
 *   "3 x 2 dias"   -> clamp (a janela do M-1 tinha menos dias de producao)
 *   "mes cheio"    -> o recorte foi pedido mas o dado nao sustenta
 *
 * Deixou de ser "1-26" em 03/08/2026: aquele formato lia como intervalo de
 * DIAS DO MES, e o corte agora e quantidade de DIAS DE PRODUCAO. "1-26" com
 * corte por posicao seria a mesma mistura de familias, so que no rotulo.
 */
export function rotuloJanela(r: ResultadoDelta): string | null {
  const j = r.janela;
  if (j.recorteIndisponivel) return "mes cheio";
  if (j.modo !== "ate-dia-N") return null;
  if (j.clampado) return `${j.diaCorteAtual} x ${j.diaCorteAnterior} dias`;
  return `${j.diaCorteAtual} ${j.diaCorteAtual === 1 ? "dia" : "dias"}`;
}

// ============================================================================
// NOTAS DA JANELA "ate-dia-N" — o que ela corrige e o que NAO corrige
// ----------------------------------------------------------------------------
// CORRIGE (o motivo da Fase 2): o parcial-vs-cheio. Sem recorte, a ponta atual
// de um mes aberto e parcial e a anterior e cheia, e o card mostra uma queda
// que nao existe -- pior quanto mais cedo no mes.
//
// CORRIGE TAMBEM, desde 03/08/2026: o corte deixou de ser dia-do-mes e virou
// POSICAO NA JANELA (N dias de producao decorridos), via
// lib/delta/recorteJanela.ts. Isso fechou duas coisas de uma vez:
//
// 1) A MISTURA DE FAMILIAS, que era um defeito e nao um vies. A competencia
//    sempre saiu da janela; o corte saia do calendario. Em ago/2026 as 32
//    linhas elegiveis estavam em 2026-07-31 — competencia agosto pela janela,
//    dia 31 pelo calendario — e com corte 3 nenhuma sobrevivia: ponta atual
//    R$ 0,00, card anunciando -100% num mes com R$ 284.916,12 importados.
//
// 2) O VIES que esta nota ja media e classificava como aceitavel: 1..25 de
//    junho tem 19 dias uteis e 1..25 de julho tem 18 (dia 25 caiu num sabado),
//    ~5% na direcao do mes que comeca em dia pior. Comparar POSICAO contra
//    POSICAO elimina isso por construcao.
//
// 3) O PRIMEIRO DIA DA JANELA passou a CONTAR. Esta nota dizia que o dia-cabeca
//    (ultimo dia util do mes anterior, dia-do-mes 29/30/31) ficava de fora do
//    recorte "nos DOIS lados, simetricamente". Ficava — e era justamente por
//    ele ser lido no calendario. Em posicao ele e o dia 1. Simetria mantida,
//    perda de dado eliminada: a producao do dia-cabeca e producao da
//    competencia e agora entra no recorte como qualquer outra.
//
// CORRIGIDO ANTES, e continua valendo:
//
// 4) ATRASO DE IMPORTACAO — Fase 2.1. O corte e min(N de hoje, ultima posicao
//    com dado na janela corrente), via `posicoesComDadoNaJanela` em
//    resolverJanela. Fica o registro do que acontecia antes: em 26/07/2026 a
//    diaria de julho estava carregada ate 23/07 e o card mostrava -10,6%; com
//    as duas pontas na mesma janela curta, +3,0%. O sinal invertia por atraso
//    de carga, nao por desempenho.
//
// NAO CORRIGE, e e bom saber:
//
// 5) O RECORTE NAO RECONCILIA com o total "mes cheio" do mesmo card, e nao
//    deveria: um compara N dias das duas pontas, o outro soma a competencia
//    inteira. Numeros diferentes respondendo perguntas diferentes.
// ============================================================================
