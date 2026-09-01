// ============================================================================
// _ledgerProtegido.ts — o LEDGER de conteudo aprovado dos arquivos que decidem
// dinheiro. Casa de UMA regra so, consumida pela G5 de gate_teto_avista_rr.ts.
//
// POR QUE EXISTE. Ate 31/08/2026 a G5 provava "lib/motor.ts NAO foi tocado
// nesta branch" com `git diff --name-only origin/main...HEAD`. Isso tem dois
// buracos, os DOIS medidos:
//
//   1. NAO TEM DENTES EM MAIN. Em main, HEAD == origin/main, o diff sai VAZIO e
//      a assercao nao mede NADA. Ela so protegia enquanto existisse branch — e
//      13 commits ja tocaram lib/motor.ts na historia sem deixar registro do
//      porque.
//   2. NAO VE ARVORE DE TRABALHO. A forma de TRES pontos compara o merge-base
//      com o HEAD COMMITADO. Rodar os gates antes de commitar dava VERDE que
//      nao cobria a mudanca — foi o que custou a rodada do PR #203.
//
// O QUE MUDOU. A pergunta deixou de ser "foi tocado?" (que so tem resposta
// dentro de uma branch) e passou a ser "o conteudo de hoje e o conteudo
// APROVADO?" — que tem resposta sempre, inclusive em main, e que enxerga o
// disco, nao o commit.
//
// O QUE ISSO AFROUXA, dito sem suavizar (decisao do Diego, 31/08/2026):
//   Antes era TRAVA: mexeu no motor, reprova, ponto. Agora e PEDAGIO. O portao
//   passa a garantir que ALGUEM OLHOU E ESCREVEU — nao que a mudanca e segura.
//   Um hash nao le semantica: se a entrada disser "e so assinatura" e a
//   aritmetica tiver mudado, ISTO AQUI PASSA. A defesa e o corpo obrigar a
//   nomear linha a linha, um humano conferir contra o diff, e o CODEOWNERS
//   (.github/CODEOWNERS) exigir revisao de quem nao escreveu a entrada.
//
// A REGRA DE OURO CONTINUA, herdada de _diffContraRef.ts: COMPARACAO QUE NAO
// PODE SER FEITA REPROVA. Ausencia de medicao nao e aprovacao. Nada aqui
// engole erro de git num catch silencioso.
// ============================================================================

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/** Arquivo protegido -> entrada do ledger que o aprova. Correspondencia 1:1:
 *  protegido sem entrada REPROVA, e entrada sem protegido REPROVA. */
export const ARQUIVOS_PROTEGIDOS: ReadonlyArray<{ arquivo: string; entrada: string }> = [
  { arquivo: "lib/motor.ts", entrada: "scripts/motor-protegido/lib_motor.ts.md" },
  {
    arquivo: "lib/promotivaCashPolicy.ts",
    entrada: "scripts/motor-protegido/lib_promotivaCashPolicy.ts.md",
  },
];

/** As tres secoes que o corpo TEM de ter, nao-vazias. O portao nao le semantica,
 *  mas exige que a pergunta tenha sido respondida. Comparacao e sem acento e
 *  sem caixa (ver `chaveSecao`). */
export const SECOES_OBRIGATORIAS = [
  "O QUE MUDOU",
  "POR QUE NAO TOCA O TETO DA EMPRESA",
  "O QUE MUDA DE COMPORTAMENTO",
] as const;

// ---------------------------------------------------------------------------
// Impressao
// ---------------------------------------------------------------------------

/**
 * CRLF (e CR solto) -> LF. NAO E DETALHE: medido em 31/08/2026 nesta base,
 * core.autocrlf=true e SEM .gitattributes, com 709 de 1211 arquivos-fonte ja em
 * CRLF no disco da maquina de desenvolvimento. O CI roda em Linux, com LF. Um
 * sha256 de bytes CRUS divergiria entre as duas SEM nenhuma mudanca de
 * conteudo — o gemeo exato do verde falso que este ledger veio consertar.
 */
export function normalizarEol(texto: string): string {
  return texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Impressao do conteudo aprovado: "sha256:<64 hex>" sobre o texto normalizado. */
export function impressaoDe(conteudo: string): string {
  return "sha256:" + createHash("sha256").update(normalizarEol(conteudo), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Leitura de uma entrada
// ---------------------------------------------------------------------------

export interface EntradaLida {
  arquivo: string | null;
  impressao: string | null;
  aprovado: string | null;
  frente: string | null;
  /** Tudo depois do separador `---`, cru. */
  corpo: string;
  /** Titulos de secao (`## ...`) encontrados, ja em chave normalizada. */
  secoes: string[];
  /** Secoes obrigatorias ausentes OU presentes-e-vazias. */
  secoesFaltando: string[];
  /** Problemas de FORMA (cabecalho malformado). Vazio = entrada bem-formada. */
  problemas: string[];
}

/**
 * Marcas de acento combinantes (U+0300..U+036F), que sobram depois do NFD.
 * Montada por `new RegExp` com escape ASCII de proposito: um literal com os
 * caracteres combinantes crus fica INVISIVEL no diff e depende da codificacao
 * do checkout — e este arquivo decide se o motor entra ou nao.
 */
const ACENTOS_COMBINANTES = new RegExp("[\\u0300-\\u036f]", "g");

/** Sem acento, sem caixa, espacos colapsados — para casar titulo de secao. */
function chaveSecao(s: string): string {
  return s
    .normalize("NFD")
    .replace(ACENTOS_COMBINANTES, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Assinatura do CORPO para detectar "trocou so o hash". Colapsa TODO espaco em
 * um so e tira acento/caixa: mexer so em espaco em branco ou em acento NAO
 * conta como corpo novo. Deixar isso frouxo seria oferecer a saida que a
 * condicao 3 existe para fechar.
 */
export function assinaturaCorpo(corpo: string): string {
  const canon = normalizarEol(corpo)
    .normalize("NFD")
    .replace(ACENTOS_COMBINANTES, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return createHash("sha256").update(canon, "utf8").digest("hex");
}

export function lerEntrada(texto: string): EntradaLida {
  const t = normalizarEol(texto);
  const problemas: string[] = [];

  const sep = t.indexOf("\n---");
  if (sep < 0) {
    return {
      arquivo: null, impressao: null, aprovado: null, frente: null,
      corpo: "", secoes: [], secoesFaltando: [...SECOES_OBRIGATORIAS],
      problemas: ["falta o separador '---' entre cabecalho e corpo"],
    };
  }
  const cabecalho = t.slice(0, sep);
  const corpo = t.slice(t.indexOf("\n", sep + 1) + 1);

  const campo = (nome: string): string | null => {
    const m = cabecalho.match(new RegExp("^" + nome + "\\s*:\\s*(.+)$", "mi"));
    return m ? m[1].trim() : null;
  };

  const arquivo = campo("arquivo");
  const impressao = campo("impressao");
  const aprovado = campo("aprovado");
  const frente = campo("frente");

  if (!arquivo) problemas.push("cabecalho sem 'arquivo:'");
  if (!impressao) problemas.push("cabecalho sem 'impressao:'");
  else if (!/^sha256:[0-9a-f]{64}$/.test(impressao)) {
    problemas.push(`'impressao:' malformada ('${impressao}') — esperado sha256:<64 hex>`);
  }
  if (!aprovado) problemas.push("cabecalho sem 'aprovado:'");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(aprovado)) {
    problemas.push(`'aprovado:' deve ser YYYY-MM-DD (veio '${aprovado}')`);
  }
  if (!frente) problemas.push("cabecalho sem 'frente:' (a branch/PR que aprovou)");

  // Secoes: titulo `## X` ate o proximo `## ` ou o fim.
  const secoes: string[] = [];
  const conteudoPorSecao = new Map<string, string>();
  const linhas = corpo.split("\n");
  let atual: string | null = null;
  let buf: string[] = [];
  const fecha = () => {
    if (atual !== null) conteudoPorSecao.set(atual, buf.join("\n").trim());
    buf = [];
  };
  for (const l of linhas) {
    const m = l.match(/^##+\s+(.*)$/);
    if (m) {
      fecha();
      atual = chaveSecao(m[1]);
      secoes.push(atual);
    } else if (atual !== null) {
      buf.push(l);
    }
  }
  fecha();

  const secoesFaltando = SECOES_OBRIGATORIAS.filter((s) => {
    const k = chaveSecao(s);
    const c = conteudoPorSecao.get(k);
    return c === undefined || c.length === 0;
  });

  return { arquivo, impressao, aprovado, frente, corpo, secoes, secoesFaltando, problemas };
}

// ---------------------------------------------------------------------------
// A entrada como estava no ref de referencia (para a condicao "trocou so o hash")
// ---------------------------------------------------------------------------

export type EntradaEmRef =
  | { estado: "ok"; texto: string }
  /** O ref resolve, mas a entrada ainda nao existe la: e a PRIMEIRA aprovacao. */
  | { estado: "ausente" }
  /** Nao deu para medir. O chamador REPROVA com esta mensagem — regra de ouro. */
  | { estado: "naoMediu"; mensagem: string };

/**
 * Le a entrada como ela esta em `ref` (tipicamente origin/main), para comparar
 * com a da arvore. Serve SO a condicao 3 ("hash novo com corpo intacto
 * REPROVA"), que por natureza so acontece durante uma branch: em main os dois
 * lados sao o mesmo arquivo e a comparacao e no-op. Isso e deliberado — a
 * protecao PERMANENTE e a impressao x arquivo, que vale em main.
 *
 * Distingue "ref nao resolve" (nao mediu -> REPROVA) de "arquivo nao existe no
 * ref" (primeira aprovacao -> segue), porque tratar os dois igual seria
 * exatamente engolir a ausencia de medicao.
 */
export function lerEntradaEmRef(cwd: string, ref: string, caminho: string): EntradaEmRef {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref + "^{commit}"], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    const primeira = String(err.stderr || err.message || e).trim().split("\n")[0];
    return {
      estado: "naoMediu",
      mensagem:
        "COMPARACAO DE ENTRADA NAO REALIZADA — '" + ref + "' nao resolve neste checkout. " +
        "NAO foi verificado se o corpo da entrada mudou junto com a impressao; este bloco " +
        "nao mediu nada e por isso REPROVA. Isto NAO significa que a entrada esta correta. " +
        "Causa tipica: checkout raso (actions/checkout com fetch-depth: 1) — use " +
        "fetch-depth: 0. git: " + primeira,
    };
  }
  // Ref existe. O arquivo existe NELE?
  try {
    execFileSync("git", ["cat-file", "-e", ref + ":" + caminho], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return { estado: "ausente" };
  }
  try {
    const texto = execFileSync("git", ["show", ref + ":" + caminho], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
    });
    return { estado: "ok", texto };
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    const primeira = String(err.stderr || err.message || e).trim().split("\n")[0];
    return {
      estado: "naoMediu",
      mensagem:
        "COMPARACAO DE ENTRADA NAO REALIZADA — 'git show " + ref + ":" + caminho +
        "' falhou. Este bloco nao mediu nada e por isso REPROVA. git: " + primeira,
    };
  }
}
