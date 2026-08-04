// ============================================================================
// lib/bbts/normalizarTextoPdf.ts — a LACUNA de glifo do PDF da BBTS.
//
// O QUE ACONTECE NO PDF (medido em 03/08/2026 sobre o fechamento de julho).
// A fonte do relatorio (g_d0_f2) usa LIGADURAS. O glifo da ligadura nao tem
// entrada no ToUnicode, entao o pdf.js emite um item de texto com UM caractere
// U+0000 no lugar dela, entre os dois pedacos da palavra:
//
//    "Corren" + <U+0000> + "sta"      36x   -> Correntista   (ligadura "ti")
//    "Bene"   + <U+0000> + "cio"       8x   -> Beneficio     (ligadura "fi")
//    "Automa" + <U+0000> + "co,"       7x   -> Automatico    (ligadura "ti")
//    "Automa" + <U+0000> + "co"        4x   -> Automatico
//    "corren" + <U+0000> + "sta"       4x   -> correntista
//
// O item do NUL tem str.length = 1, height 6.75 e width 3.7606 (nos casos "ti")
// ou 3.5728 (no caso "fi") — a largura SEPARA as duas classes, mas nada no
// arquivo NOMEIA a ligadura. A fonte embarcada so exporia o nome do glifo via
// render (page.commonObjs), que nao esta disponivel no servidor.
//
// O QUE ESTE MODULO FAZ, E O QUE ELE SE RECUSA A FAZER.
// Ele usa o unico sinal confiavel: a POSICAO. O NUL diz "aqui faltou exatamente
// um glifo". Entao:
//   - junta os pedacos SEM o espaco espurio que o join(" ") metia no lugar
//     (era dai que saia "Automa co", com espaco no meio da palavra);
//   - marca a lacuna com U+FFFD (REPLACEMENT CHARACTER, o marcador padrao de
//     "havia algo aqui e nao sei o que");
//   - devolve a LISTA de lacunas, para quem grava poder registrar.
//
// Ele NAO CHUTA a letra — mas ELEGE quando ha prova. A diferenca e o
// vocabulario ATESTADO: se exatamente uma ligadura produz palavra que outra
// fonte do sistema ja registrou, a lacuna vira letra e a fonte fica no
// registro da decisao. Se duas produzem, ou nenhuma, a lacuna FICA. Ver o
// bloco ELEICAO POR EVIDENCIA, mais abaixo, que e onde essa regra mora.
//
// ESTE PARAGRAFO JA DISSE O CONTRARIO, e o registro fica: ate 03/08/2026 o
// modulo so marcava a lacuna e delegava TODA resolucao ao consumidor, na hora
// de comparar. A medicao derrubou esse desenho — as palavras quebradas nunca
// aparecem integras no proprio PDF, entao "deixa o consumidor resolver"
// significava, na pratica, gravar "Corren<lacuna>sta" em 40 linhas e exibir
// isso na tela. A eleicao por evidencia entrou para resolver na GRAVACAO o que
// tem prova, mantendo a recusa para o que nao tem.
//
// O CONSUMIDOR CONTINUA TOLERANTE, para o que a eleicao recusou: `contemTermo`
// e `casaExpressao` expandem a lacuna sobre o conjunto FECHADO de ligaduras
// latinas. Isso e um fato tipografico de 9 itens, nao um vocabulario de
// produtos: nao cresce quando a BBTS lancar um produto novo.
//
// APOSENTA o `.replace(/Corren\s*sta/gi, "Correntista")` que vivia em
// bbtsPdfExtract.ts:116 — remendo manual para UMA palavra, enquanto outras 5
// ocorrencias do mesmo fenomeno seguiam quebradas no mesmo arquivo.
// ============================================================================

// FONTE 100% ASCII, DE PROPOSITO. Os caracteres deste modulo (NUL, zero-width,
// combinantes, U+FFFD) sao construidos por String.fromCharCode em vez de
// escritos literalmente. Escrever o byte direto no .ts torna o arquivo BINARIO
// para o git e o grep — foi o que aconteceu na primeira versao deste arquivo — e
// um copy-paste o perde em silencio, que e o mesmo tipo de falha invisivel que
// este modulo existe para consertar.
const ch = (n: number) => String.fromCharCode(n);
const faixa = (a: number, b: number) => ch(a) + "-" + ch(b);

/** Marcador de glifo perdido. U+FFFD = REPLACEMENT CHARACTER. */
export const LACUNA = ch(0xfffd);

/** Caracteres que o PDF injeta e que NAO sao texto: controle + zero-width. */
const CLASSE_INVISIVEL = "[" + faixa(0x0000, 0x001f) + faixa(0x200b, 0x200d) + ch(0xfeff) + "]";
const INVISIVEIS = new RegExp(CLASSE_INVISIVEL, "g");
const SO_INVISIVEIS = new RegExp("^" + CLASSE_INVISIVEL + "+$");
const COMBINANTES = new RegExp("[" + faixa(0x0300, 0x036f) + "]", "g");

/**
 * Ligaduras latinas que um PDF pode emitir como glifo unico sem ToUnicode.
 * Conjunto FECHADO e tipografico — nao e vocabulario. Ordem: mais longas antes.
 */
export const LIGADURAS = ["ffi", "ffl", "ff", "fi", "fl", "ti", "tt", "st", "ct"] as const;

export type Lacuna = {
  /** indice no texto devolvido onde esta o marcador. */
  pos: number;
  /** os caracteres ao redor, para o log identificar o caso. */
  contexto: string;
};

export type TextoNormalizado = {
  /** texto com os pedacos juntos e LACUNA onde faltou glifo. */
  texto: string;
  lacunas: Lacuna[];
};

/**
 * Junta os fragmentos de uma celula do PDF preservando a informacao da lacuna.
 *
 * @param fragmentos itens de texto JA na ordem de leitura (cima->baixo, esq->dir).
 *
 * REGRA DE ESPACO: fragmentos normais sao separados por espaco (era o
 * comportamento do join(" ") e continua valendo — "Consignado -" + "Novo" sao
 * palavras distintas). Ao redor de uma LACUNA, NAO: ali os pedacos sao da MESMA
 * palavra, e o espaco e que produzia "Automa co".
 */
export function juntarFragmentosPdf(fragmentos: readonly string[]): TextoNormalizado {
  const partes: string[] = [];
  let colarProximo = false;

  for (const bruto of fragmentos) {
    const cru = String(bruto ?? "");
    if (cru.length > 0 && SO_INVISIVEIS.test(cru)) {
      if (partes.length === 0) partes.push("");
      partes[partes.length - 1] += LACUNA;
      colarProximo = true;
      continue;
    }
    const limpo = cru.replace(INVISIVEIS, "").trim();
    if (!limpo) continue;
    if (colarProximo && partes.length > 0) {
      partes[partes.length - 1] += limpo;
      colarProximo = false;
    } else {
      partes.push(limpo);
    }
  }

  const texto = partes.join(" ").replace(/\s+/g, " ").trim();
  const lacunas: Lacuna[] = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === LACUNA) {
      lacunas.push({ pos: i, contexto: texto.slice(Math.max(0, i - 6), i + 7) });
    }
  }
  return { texto, lacunas };
}

/** MAIUSCULA sem acento — a forma que os matchers comparam. LACUNA preservada. */
export function normalizarParaBusca(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(COMBINANTES, "")
    .trim()
    .toUpperCase();
}

/** Todas as leituras possiveis de um texto com lacunas, sobre LIGADURAS. */
function expansoes(s: string): string[] {
  const i = s.indexOf(LACUNA);
  if (i < 0) return [s];
  const saida: string[] = [];
  for (const lig of LIGADURAS) {
    for (const resto of expansoes(s.slice(0, i) + lig.toUpperCase() + s.slice(i + 1))) {
      saida.push(resto);
    }
  }
  return saida;
}

/**
 * `texto` contem `termo`, tolerando LACUNAs?
 *
 * Sem lacuna, e um includes(). Com lacuna, cada marcador e expandido sobre
 * LIGADURAS e o includes e testado em cada expansao. Basta UMA casar.
 *
 * Por que expandir aqui e nao na gravacao: aqui a resposta e binaria (casa ou
 * nao) e uma expansao errada nao vira dado gravado. Na gravacao seria preciso
 * ELEGER uma expansao, que e exatamente o chute que este modulo recusa.
 */
export function contemTermo(texto: unknown, termo: string): boolean {
  const t = normalizarParaBusca(texto);
  const alvo = normalizarParaBusca(termo);
  if (!t.includes(LACUNA)) return t.includes(alvo);
  return expansoes(t).some((c) => c.includes(alvo));
}

/**
 * `texto` casa a expressao? Mesma tolerancia de contemTermo, para os matchers
 * que hoje usam regex (ex.: /\bCDC\b/, /\bSALARIO\b/).
 */
export function casaExpressao(texto: unknown, rx: RegExp): boolean {
  const t = normalizarParaBusca(texto);
  if (!t.includes(LACUNA)) return rx.test(t);
  return expansoes(t).some((c) => rx.test(c));
}

// ============================================================================
// ELEICAO POR EVIDENCIA (03/08/2026) — quando a lacuna pode virar letra.
//
// MEDIDO ANTES DE ESCREVER, e e o que justifica a uniao de fontes:
//   - o PDF do FECHAMENTO tem 1205 itens de texto e 59 com caractere de
//     controle. As palavras quebradas (CORRENTISTA, AUTOMATICO, BENEFICIO)
//     aparecem SEMPRE quebradas: ZERO ocorrencia integra. Vocabulario tirado so
//     do proprio PDF reconstroi NADA.
//   - o PDF da TABELA (regua da competencia) tem ZERO caractere de controle e
//     atesta AUTOMATICO (2x), BENEFICIO (5x), PORTABILIDADE (9x) — mas nao
//     CORRENTISTA, que nao e vocabulario de tabela.
//   - o corpus do BANCO (product_description das linhas nao-ADS, que vem de
//     XLSX e nunca passou por PDF) atesta as tres: CORRENTISTA 1713x,
//     AUTOMATICO 89x, BENEFICIO 105x. Sao 10 palavras distintas no total.
//
// A REGRA: expande a lacuna sobre LIGADURAS; para cada expansao, olha a PALAVRA
// que contem a lacuna e pergunta se o vocabulario a atesta.
//   exatamente 1 ligadura atestada -> ELEGE, e registra QUAL fonte atestou;
//   2 ou mais ligaduras atestadas  -> AMBIGUA, mantem a lacuna;
//   nenhuma                        -> SEM_ATESTACAO, mantem a lacuna.
//
// POR QUE O VOCABULARIO E PEQUENO DE PROPOSITO (10 palavras hoje). Um dicionario
// de portugues resolveria mais casos e erraria em silencio: com vocabulario
// grande, quase toda expansao acha alguma palavra e a "eleicao" vira chute com
// cara de prova. O corpus do proprio sistema e fechado, se mantem sozinho (um
// produto novo entra na primeira venda) e falha do lado seguro.
//
// SE UM PRODUTO SO EXISTIR NA ADS E NUNCA NO RR, o corpus nao o atesta e a
// LACUNA SE MANTEM. Isso e o comportamento CORRETO, nao um buraco a tapar: a
// alternativa e alguem escrever uma lista fixa de palavras aqui, que e
// exatamente o que este modulo existe para nao ter. Se voce esta lendo isto
// pensando em "melhorar" com um array de strings — nao. Alimente o corpus.
// ============================================================================

/** De onde veio a atestacao de uma palavra. */
export type FonteAtestacao = "corpus-banco" | "regua-competencia" | "celula-integra-pdf";

/** palavra normalizada -> fontes que a atestam. */
export type Vocabulario = Map<string, FonteAtestacao[]>;

/**
 * Monta o vocabulario a partir de textos JA atestados (sem lacuna).
 * PURO: recebe os textos prontos; nao le banco, nao abre PDF.
 */
export function construirVocabulario(
  entradas: ReadonlyArray<{ textos: readonly (string | null | undefined)[]; fonte: FonteAtestacao }>
): Vocabulario {
  const v: Vocabulario = new Map();
  for (const { textos, fonte } of entradas) {
    for (const t of textos) {
      const n = normalizarParaBusca(t);
      if (!n || n.includes(LACUNA)) continue;   // texto com lacuna NAO atesta nada
      for (const w of n.split(/[^A-Z0-9]+/)) {
        if (w.length < 3) continue;
        const atual = v.get(w);
        if (!atual) v.set(w, [fonte]);
        else if (!atual.includes(fonte)) atual.push(fonte);
      }
    }
  }
  return v;
}

export type ResultadoEleicao = "reconstruida" | "ambigua" | "sem-atestacao";

export type DecisaoLacuna = {
  resultado: ResultadoEleicao;
  /** a palavra como estava, com a lacuna. */
  palavra: string;
  /** ligadura eleita (so em "reconstruida"). */
  ligadura?: string;
  /** fontes que atestaram a palavra eleita. */
  fontes?: FonteAtestacao[];
  /** em "ambigua": as ligaduras que empataram. */
  candidatas?: string[];
};

export type TextoResolvido = {
  texto: string;
  decisoes: DecisaoLacuna[];
};

/**
 * A palavra (token de letras/digitos) que contem o indice i.
 *
 * ATENCAO A CAIXA: o texto aqui e o ORIGINAL do PDF — minusculas e acentuado
 * ("Corren", "Automa"). Testar a fronteira com /[A-Z0-9]/ fazia a palavra
 * colapsar na propria lacuna e TODA eleicao virava "sem-atestacao" (52 de 52
 * na primeira rodada). A classe tem de aceitar minuscula e acento.
 */
function palavraEm(t: string, i: number): { ini: number; fim: number } {
  const ehLetra = (c: string) => /[\p{L}\p{N}]/u.test(c) || c === LACUNA;
  let ini = i;
  let fim = i;
  while (ini > 0 && ehLetra(t[ini - 1])) ini--;
  while (fim < t.length - 1 && ehLetra(t[fim + 1])) fim++;
  return { ini, fim: fim + 1 };
}

/**
 * Resolve as lacunas de um texto contra o vocabulario. NUNCA inventa: so troca
 * a lacuna por letra quando UMA unica ligadura produz palavra atestada.
 *
 * PURO: o vocabulario entra por parametro. Quem o monta (do banco, da regua, do
 * proprio PDF) e o importador — ver lib/bbtsClosingImport.ts.
 */
export function resolverLacunas(texto: string, vocab: Vocabulario): TextoResolvido {
  let t = texto;
  const decisoes: DecisaoLacuna[] = [];
  let guarda = 0;

  while (t.includes(LACUNA) && guarda++ < 20) {
    const i = t.indexOf(LACUNA);
    const { ini, fim } = palavraEm(t, i);
    const palavra = t.slice(ini, fim);
    const palavraNorm = normalizarParaBusca(palavra);
    const idxNaPalavra = palavraNorm.indexOf(LACUNA);

    const atestadas: Array<{ lig: string; fontes: FonteAtestacao[] }> = [];
    if (idxNaPalavra >= 0) {
      for (const lig of LIGADURAS) {
        const cand =
          palavraNorm.slice(0, idxNaPalavra) + lig.toUpperCase() + palavraNorm.slice(idxNaPalavra + 1);
        if (cand.includes(LACUNA)) continue;      // outra lacuna na mesma palavra: resolve na proxima volta
        const fontes = vocab.get(cand);
        if (fontes && fontes.length) atestadas.push({ lig, fontes: [...fontes] });
      }
    }

    if (atestadas.length === 1) {
      const { lig, fontes } = atestadas[0];
      // preserva a caixa do trecho seguinte: "Corren"+ti+"sta" -> minusculas.
      const reposta = t.slice(0, i) + lig + t.slice(i + 1);
      decisoes.push({ resultado: "reconstruida", palavra, ligadura: lig, fontes });
      t = reposta;
    } else if (atestadas.length > 1) {
      decisoes.push({ resultado: "ambigua", palavra, candidatas: atestadas.map((a) => a.lig) });
      t = t.slice(0, i) + MARCA_RESOLVIDA + t.slice(i + 1);
    } else {
      decisoes.push({ resultado: "sem-atestacao", palavra });
      t = t.slice(0, i) + MARCA_RESOLVIDA + t.slice(i + 1);
    }
  }

  // devolve as lacunas nao resolvidas ao marcador canonico
  t = t.split(MARCA_RESOLVIDA).join(LACUNA);
  return { texto: t, decisoes };
}

/** Marcador interno para nao reprocessar a mesma lacuna no laco. */
const MARCA_RESOLVIDA = ch(0x0001);
