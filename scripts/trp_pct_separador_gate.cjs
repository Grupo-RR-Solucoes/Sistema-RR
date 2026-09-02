#!/usr/bin/env node
/**
 * scripts/trp_pct_separador_gate.cjs — PORTAO do separador decimal do percentual
 * do PDF da TRP. SELF-CONTAINED: fixture SINTETICA (o repo e publico e os PDFs da
 * TRP nao estao nele), sem banco, sem caminho absoluto.
 *
 * DECISAO QUE ELE GUARDA (Diego, 02/09/2026): o PDF da TRP pode escrever o
 * percentual com VIRGULA ("2,44%") ou com PONTO ("10.23%") e o sistema tem de ler
 * os dois. Nao e caso especial da TRP40 — e o formato que o documento pode usar.
 * A regua da ambiguidade do milhar esta escrita em lib/trp/pctTrp.ts.
 *
 * ---------------------------------------------------------------------------
 * A LICAO QUE ESTE PORTAO CARREGA (por que existe o bloco 7)
 * ---------------------------------------------------------------------------
 * A PRIMEIRA versao deste conserto montou as regexes de taxa com template
 * literal CRU. Em template literal, `\s` avalia para "s": as regexes viraram
 * `(...)%s*as*(...)%` e pararam de casar EM SILENCIO. O estrago nao foi na TRP40
 * (o alvo do conserto) — foi nas CINCO TRPs antigas, que ja estao no banco:
 *   - `celulas_taxa_prazo` virou `celulas_prazo` em 8 produtos;
 *   - `tx_juros_min` SUMIU de INSS_RENOV e ADIANTAMENTO_13 (e o piso de taxa da
 *     categoria: sem ele o gate B do motor para de barrar contrato fora da faixa);
 *   - o CONSIG_PRIVADO passou a acusar "heranca de prazo NAO validada".
 * O `tsc` ficou VERDE (a expressao e valida, so significa outra coisa) e o olho
 * nao pegou. Quem pegou foi a MEDICAO DE NAO-REGRESSAO: rodar o extrator sobre
 * TRP35..39 antes e depois e exigir regua identica. `String.raw` resolveu.
 *
 * Medir os 5 PDFs e caro e depende de arquivo fora do repo. O bloco 7 abaixo
 * assere as duas regexes DIRETO, com fixture: se alguem trocar `String.raw` por
 * template literal cru, o portao derruba na hora, no CI, sem PDF nenhum.
 *
 * ---------------------------------------------------------------------------
 * BLOCOS
 *   A. VIRGULA CONTINUA. A fixture em virgula produz a regua esperada, valor a
 *      valor. (A nao-regressao real sobre TRP35..39 foi MEDIDA no conserto:
 *      5/5 identicas byte a byte, `regraDraft` e `conferir`, sha conferido.
 *      Aqui fica a FORMA, que o CI consegue rodar sempre.)
 *   B. PONTO PASSA. A MESMA regua escrita com ponto nas colunas de faixa — a
 *      forma exata da TRP40, onde a coluna de taxa vem com virgula e a de faixa
 *      com ponto NA MESMA LINHA — produz regua IDENTICA a de (A).
 *   C. >= 100 REPROVA, nao normaliza. No token isolado e dentro da matriz.
 *   D. "1.234" LANCA. Nao adivinha entre 1,234 e 1234.
 *   E. AS ANCORAS NAO AFROUXARAM. Aceitar mais forma de VALOR nao aceita mais
 *      forma de LINHA (a licao dos tres layouts da BBTS).
 *   F. MUTACAO, TRES SENTIDOS, sobre o JS EMITIDO do proprio sitio:
 *        F1. tirar o PONTO da forma   -> a fixture da TRP40 (B) TEM de cair;
 *        F2. tirar a VIRGULA da forma -> a fixture das antigas (A) TEM de cair;
 *        F3. aceitar o ponto SEM o teto de 100 -> um valor ABSURDO passa. Prova
 *            que quem recusa e o teto, e nao a sorte da fixture.
 *      Se a substituicao textual nao achar o alvo, o portao REPROVA em vez de
 *      dar a mutacao por feita: mutacao que nao mutou nada e verde por vacuidade.
 *   G. AS REGEXES DE TAXA CASAM (a licao acima), incluindo `\s` vivo no source.
 *
 * EXIT 0 so com os 7 blocos verdes.
 * Uso: node scripts/trp_pct_separador_gate.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const COMPETENCIA = "2026-09";

// ---------------------------------------------------------------------------
// FIXTURE SINTETICA — numeros INVENTADOS, forma fiel. O repo e publico.
//
// Uma tabela so, renderizada DUAS vezes (virgula e ponto). E isso que torna a
// assercao de (B) forte: nao e "o ponto tambem parseia", e "o ponto produz a
// MESMA regua". Se as duas grafias divergissem num digito, (B) cai.
//
// A coluna de TAXA (campo `pre`) fica SEMPRE em virgula: e exatamente a mistura
// da TRP40 — mesma linha, dois separadores — a forma que derrubou o parser.
// ---------------------------------------------------------------------------

const HDR_FAIXA = "Taxa de Juros Prazo Faixa 1 Faixa 2 Faixa 3 Faixa 4 Faixa 5";
const HDR_GERAL = "Taxa de Juros Prazo Geral";

const FIXTURE = [
  {
    anchor: "1.2 INSS Novo", key: "INSS_NOVO", hdr: HDR_FAIXA,
    rows: [
      { pre: "18 a 47", pcts: [1.11, 1.12, 1.13, 1.14, 1.15] },
      { pre: "48 a 60", pcts: [2.21, 2.22, 2.23, 2.24, 2.25] },
    ],
  },
  {
    anchor: "1.3 INSS Renovacao", key: "INSS_RENOV", hdr: HDR_FAIXA,
    rows: [{ pre: "A partir de 1,00% 61 a 84", pcts: [3.31, 3.32, 3.33, 3.34, 3.35] }],
  },
  {
    anchor: "1.4 Convenio Publico Geral", key: "CONSIG_PUBLICO", hdr: HDR_FAIXA,
    rows: [
      { pre: "1,75% a 1,77% A partir de 36", pcts: [0.83, 0.83, 0.89, 0.89, 0.89] },
      // 10.23 e o caso que o Diego citou: com ponto, 2 casas -> leitura unica.
      { pre: "a partir de 2,48%", pcts: [9.54, 9.54, 10.23, 10.23, 10.23] },
    ],
  },
  {
    anchor: "1.5 SIAPE", key: "SIAPE", hdr: HDR_FAIXA,
    rows: [{ pre: "1,64% a 1,67% A partir de 48", pcts: [0.94, 0.95, 0.97, 1.02, 1.03] }],
  },
  {
    anchor: "1.6 Convenio SP e MG", key: "CONSIG_SP_MG", hdr: HDR_FAIXA,
    rows: [{ pre: "1,66% a 1,79% A partir de 36", pcts: [0.99, 0.99, 1.06, 1.06, 1.06] }],
  },
  {
    anchor: "1.7 Consignado Privado", key: "CONSIG_PRIVADO", hdr: HDR_FAIXA,
    rows: [{ pre: "A partir de 2,54% 18 a 35", pcts: [0.78, 0.79, 0.81, 0.85, 0.86] }],
  },
  {
    anchor: "2.2 Portabilidade Publico", key: "PORTAB_PUBLICO", hdr: HDR_GERAL,
    prazoIsolado: "A partir de 48",
    rows: [{ pre: "1,73% a 1,89%", pcts: [0.72] }],
  },
  {
    anchor: "2.2 Portabilidade Privado", key: "PORTAB_PRIVADO", hdr: HDR_GERAL,
    prazoIsolado: "A partir de 36",
    rows: [{ pre: "2,54% a 2,99%", pcts: [0.45] }],
  },
  {
    anchor: "3.2 Nao Consignado - Automatico", key: "NAO_CONSIGNADO", hdr: HDR_FAIXA,
    prazoIsolado: "A partir de 13",
    rows: [{ pre: "2,89% a 3,39%", pcts: [1.56, 1.58, 1.62, 1.70, 1.74] }],
  },
  {
    anchor: "3.3 Adiantamento 13 Salario", key: "ADIANTAMENTO_13", hdr: HDR_FAIXA,
    rows: [{ pre: "A partir de 3,25% A partir de 5", pcts: [4.11, 4.12, 4.13, 4.14, 4.15] }],
  },
  {
    anchor: "3.4 FGTS", key: "FGTS", hdr: HDR_GERAL,
    rows: [{ pre: ">= R$ 1 mil", pcts: [5.55] }],
  },
];

/**
 * Renderiza a fixture em LINHAS.
 *   sep      — separador decimal das colunas de FAIXA ("," ou ".").
 *   opcoes.truncar — { key, n }: da a esse produto so `n` percentuais por linha
 *                    (linha incompleta; usado no bloco E).
 *   opcoes.strays  — linhas soltas com percentual, injetadas FORA de secao de
 *                    produto (usado no bloco E).
 */
function render(sep, opcoes = {}) {
  const n = (v) => v.toFixed(2).replace(".", sep);
  const out = ["Tabela de Repasse ao Promotor - fixture sintetica"];
  for (const s of opcoes.strays || []) out.push(s);
  for (const p of FIXTURE) {
    out.push(p.anchor);
    out.push(p.hdr);
    if (p.prazoIsolado) out.push(p.prazoIsolado);
    for (const r of p.rows) {
      const trunc = opcoes.truncar && opcoes.truncar.key === p.key ? opcoes.truncar.n : r.pcts.length;
      out.push(`${r.pre} ${r.pcts.slice(0, trunc).map((v) => n(v) + "%").join(" ")}`);
    }
    out.push("Condicoes de uso da tabela:");
    for (const s of opcoes.strays || []) out.push(s);
  }
  return out;
}

/** A regua esperada, direto da tabela: produto -> lista achatada de decimais. */
function esperado() {
  const map = {};
  for (const p of FIXTURE) {
    map[p.key] = p.rows.flatMap((r) => r.pcts.map((v) => Number((v / 100).toFixed(6))));
  }
  return map;
}

const FAIXA_KEYS = ["Faixa 1", "Faixa 2", "Faixa 3", "Faixa 4", "Faixa 5", "pct_geral"];

/** Achata os percentuais de um regraDraft: produto -> lista, na ordem. */
function achatar(regraDraft) {
  const out = {};
  for (const [k, v] of Object.entries(regraDraft)) {
    if (k === "_meta") continue;
    const arr = Object.values(v).find(Array.isArray) || [];
    out[k] = arr.flatMap((cel) => FAIXA_KEYS.filter((f) => cel[f] !== undefined).map((f) => cel[f]));
  }
  return out;
}

/** Nome do array de celulas de um produto no draft ("celulas_taxa_prazo" etc). */
function tipoDeCelula(regraDraft, produto) {
  const p = regraDraft[produto] || {};
  return Object.keys(p).find((k) => Array.isArray(p[k])) || null;
}

// ---------------------------------------------------------------------------
// Compilacao do sitio + carga (variante LIMPA e variantes MUTANTES)
// ---------------------------------------------------------------------------

const ARQUIVOS = [
  "lib/trp/pctTrp.ts",
  "lib/trp/parseTrpPdf.ts",
  "lib/trp/parseTrpDraft.ts",
  "lib/trp/vigencia.ts",
];
const TEMPS = [];
let rootAtual = null;

function compilar() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-pctgate-out-"));
  TEMPS.push(OUT);
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false, declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: ARQUIVOS.map((f) => path.join(ROOT, f)),
  };
  const cfg = path.join(OUT, "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" }); } catch (_e) {}
  if (!fs.existsSync(path.join(OUT, "lib/trp/parseTrpDraft.js"))) {
    throw new Error("tsc nao emitiu parseTrpDraft.js — o portao NAO pode passar sem medir");
  }
  return OUT;
}

function instalarResolver() {
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req.startsWith("@/")) req = path.join(rootAtual, req.slice(2));
    return orig.call(this, req, ...rest);
  };
}

function carregar(OUT) {
  rootAtual = OUT;
  return {
    draft: require(path.join(OUT, "lib/trp/parseTrpDraft.js")),
    pct: require(path.join(OUT, "lib/trp/pctTrp.js")),
  };
}

/**
 * Copia o OUT compilado e aplica uma substituicao TEXTUAL no JS emitido de
 * pctTrp.js. Devolve { OUT, trocas }. `trocas === 0` significa mutacao VAZIA —
 * o chamador REPROVA em vez de dar a mutacao por feita.
 */
function mutar(OUTBase, de, para) {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-pctgate-mut-"));
  TEMPS.push(OUT);
  fs.cpSync(OUTBase, OUT, { recursive: true });
  const alvo = path.join(OUT, "lib/trp/pctTrp.js");
  const src = fs.readFileSync(alvo, "utf8");
  const trocas = src.split(de).length - 1;
  fs.writeFileSync(alvo, src.split(de).join(para));
  return { OUT, trocas };
}

process.on("exit", () => {
  for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});

// ---------------------------------------------------------------------------

const falhas = [];
function ok(bloco, cond, msg) {
  console.log(`  ${cond ? "OK   " : "FALHA"} [${bloco}] ${msg}`);
  if (!cond) falhas.push(`[${bloco}] ${msg}`);
}

function lancou(fn) {
  try { fn(); return null; } catch (e) { return e; }
}

function main() {
  instalarResolver();
  const OUT_LIMPO = compilar();
  const { draft: mod, pct } = carregar(OUT_LIMPO);
  const esp = esperado();
  const totalEsperado = Object.values(esp).flat().length;
  const draftDe = (m, sep, opcoes) =>
    m.buildTrpDraftFromLines(render(sep, opcoes), { competencia: COMPETENCIA });

  // ----- A: VIRGULA CONTINUA -----------------------------------------------
  console.log("\n[A] VIRGULA continua funcionando");
  const dVirgula = draftDe(mod, ",");
  const aVirgula = achatar(dVirgula.regraDraft);
  let aOK = true;
  for (const k of Object.keys(esp)) {
    if (JSON.stringify(aVirgula[k]) !== JSON.stringify(esp[k])) {
      aOK = false;
      console.log(`       ${k}: esperado ${JSON.stringify(esp[k])} obtido ${JSON.stringify(aVirgula[k])}`);
    }
  }
  ok("A", aOK, `os 11 produtos batem valor a valor contra a tabela da fixture`);
  ok("A", dVirgula.confianca.provado.totalPct === totalEsperado,
    `totalPct = ${dVirgula.confianca.provado.totalPct} (esperado ${totalEsperado})`);

  // ----- B: PONTO PASSA, e da a MESMA regua ---------------------------------
  console.log("\n[B] PONTO passa — e produz regua IDENTICA a da virgula");
  const dPonto = draftDe(mod, ".");
  ok("B", JSON.stringify(dPonto.regraDraft) === JSON.stringify(dVirgula.regraDraft),
    "regraDraft(ponto) === regraDraft(virgula): mesmos numeros, duas grafias");
  ok("B", achatar(dPonto.regraDraft).CONSIG_PUBLICO.includes(0.1023),
    "'10.23%' le 0.1023 (dez virgula vinte e tres), nao 1023");
  ok("B", JSON.stringify(dPonto.confianca.conferir) === JSON.stringify(dVirgula.confianca.conferir),
    "a lista 'conferir' tambem e identica — o ambar nao muda com a grafia");

  // ----- C: >= 100 REPROVA (nao normaliza) ----------------------------------
  console.log("\n[C] >= 100 REPROVA — recusa, nao normaliza");
  const e100 = lancou(() => pct.pctToDec("234,56"));
  ok("C", !!e100 && e100.name === "TrpPctError" && /RECUSADA/.test(e100.message),
    `token '234,56' recusado no sitio (${e100 && e100.message})`);
  ok("C", pct.pctToDec("99,99") === 0.9999,
    "o vizinho de baixo (99,99) continua passando — o teto nao e largo demais");
  const eMatriz = lancou(() =>
    mod.buildTrpDraftFromLines(render(",").map((l) => l.replace("1,11%", "150,75%")), { competencia: COMPETENCIA }));
  ok("C", !!eMatriz && eMatriz.name === "TrpValidationError",
    `dentro da matriz vira erro VISIVEL (${eMatriz && eMatriz.name}), nao valor gravado`);
  ok("C", !!eMatriz && /RECUSADA|recusada/.test(String(eMatriz.detalhe || "") + eMatriz.message),
    "a mensagem diz RECUSADA — o token nao foi 'consertado' tirando o separador");

  // ----- D: "1.234" LANCA ----------------------------------------------------
  console.log("\n[D] '1.234' LANCA — nao adivinha entre 1,234 e 1234");
  const eAmb = lancou(() => pct.pctToDec("1.234"));
  ok("D", !!eAmb && eAmb.name === "TrpPctError" && /amb/i.test(eAmb.message),
    `'1.234' lancou (${eAmb && eAmb.message})`);
  ok("D", pct.pctToDec("10.23") === 0.1023,
    "'10.23' NAO e ambiguo (2 casas nao formam grupo de milhar) e passa");
  ok("D", pct.pctToDec("1,234") === 0.01234,
    "'1,234' com VIRGULA nunca foi ambiguo e segue lendo 1,234%");
  const eAmb2 = lancou(() =>
    mod.buildTrpDraftFromLines(render(",").map((l) => l.replace("1,11%", "1.234%")), { competencia: COMPETENCIA }));
  ok("D", !!eAmb2 && eAmb2.name === "TrpValidationError",
    `dentro da matriz a ambiguidade tambem para tudo (${eAmb2 && eAmb2.name})`);

  // ----- E: AS ANCORAS NAO AFROUXARAM ---------------------------------------
  console.log("\n[E] aceitar mais forma de VALOR nao aceita mais forma de LINHA");
  const strays = [
    "Custo de Processamento: Ate 2.5% ou R$ 5,00",
    "Rentabilidade referencial 12.50% ao ano",
    "Indice de reajuste 4.75%",
  ];
  const dStrays = mod.buildTrpDraftFromLines(render(".", { strays }), { competencia: COMPETENCIA });
  ok("E", JSON.stringify(dStrays.regraDraft) === JSON.stringify(dVirgula.regraDraft),
    "percentual com ponto FORA de secao de produto segue ignorado (ancoras/STOP intactos)");
  const eInc = lancou(() => draftDe(mod, ".", { truncar: { key: "INSS_NOVO", n: 3 } }));
  ok("E", !!eInc && (eInc.name === "TrpParseError" || eInc.name === "TrpValidationError"),
    `linha de faixa incompleta continua reprovando, mesmo com ponto (${eInc && eInc.name})`);
  const eIncV = lancou(() => draftDe(mod, ",", { truncar: { key: "INSS_NOVO", n: 3 } }));
  ok("E", !!eIncV, "e reprovava antes tambem, com virgula — a guarda nao e nova nem seletiva");

  // ----- F: MUTACAO, TRES SENTIDOS ------------------------------------------
  console.log("\n[F] MUTACAO no JS emitido do proprio sitio — tres sentidos");

  // F1 — tira o PONTO da forma: a fixture da TRP40 (B) tem de cair.
  const m1 = mutar(OUT_LIMPO, "[.,]", "[,]");
  ok("F1", m1.trocas > 0, `a mutacao achou o alvo em pctTrp.js (${m1.trocas} troca) — nao passa por vacuidade`);
  if (m1.trocas > 0) {
    const mm1 = carregar(m1.OUT);
    const eM1 = lancou(() => draftDe(mm1.draft, "."));
    ok("F1", eM1 !== null, `sem o ponto, a fixture da TRP40 CAI (${eM1 && eM1.name}: ${eM1 && eM1.message})`);
    ok("F1", lancou(() => draftDe(mm1.draft, ",")) === null,
      "e a fixture em virgula segue de pe — a mutacao atingiu SO o ponto");
  }

  // F2 — tira a VIRGULA da forma: a fixture das antigas (A) tem de cair.
  const m2 = mutar(OUT_LIMPO, "[.,]", "[.]");
  ok("F2", m2.trocas > 0, `a mutacao achou o alvo em pctTrp.js (${m2.trocas} troca)`);
  if (m2.trocas > 0) {
    const mm2 = carregar(m2.OUT);
    const eM2 = lancou(() => draftDe(mm2.draft, ","));
    ok("F2", eM2 !== null, `sem a virgula, a fixture das TRPs antigas CAI (${eM2 && eM2.name}: ${eM2 && eM2.message})`);
  }

  // F3 — aceita o ponto SEM o teto de 100: um valor ABSURDO passa.
  //      Prova que quem recusa e o TETO, e nao a sorte da fixture.
  const ABSURDO = "1234.56"; // ponto, 2 casas -> nao e ambiguo; 1234,56% e absurdo
  const eAbs = lancou(() => pct.pctToDec(ABSURDO));
  ok("F3", !!eAbs && /RECUSADA/.test(eAbs.message),
    `no codigo LIMPO, '${ABSURDO}' e recusado pelo teto (${eAbs && eAbs.message})`);
  const m3 = mutar(OUT_LIMPO, "PCT_MAX_EXCLUSIVO = 100", "PCT_MAX_EXCLUSIVO = Infinity");
  ok("F3", m3.trocas > 0, `a mutacao achou o teto em pctTrp.js (${m3.trocas} troca)`);
  if (m3.trocas > 0) {
    const mm3 = carregar(m3.OUT);
    const vAbs = lancou(() => mm3.pct.pctToDec(ABSURDO));
    const passou = vAbs === null;
    ok("F3", passou,
      `sem o teto, '${ABSURDO}' PASSA e vira ${passou ? mm3.pct.pctToDec(ABSURDO) : "(ainda recusado)"} ` +
      `— o teto de 100 e o que recusa, nao a fixture`);
  }

  // ----- G: AS REGEXES DE TAXA CASAM (a licao do \s) -------------------------
  console.log("\n[G] as regexes de taxa CASAM — a regressao do \\s nao volta calada");
  const { TX_FAIXA_RE, TX_ABERTA_RE } = mod;
  ok("G", TX_FAIXA_RE instanceof RegExp && TX_ABERTA_RE instanceof RegExp,
    "as duas regexes de taxa estao exportadas e sao RegExp");
  ok("G", /\\s/.test(TX_FAIXA_RE.source) && /\\s/.test(TX_ABERTA_RE.source),
    "o `\\s` SOBREVIVEU ao template literal (String.raw); em template cru viraria 's'");
  ok("G", TX_FAIXA_RE.test("1,75% a 1,77%") && TX_FAIXA_RE.test("1.75% a 1.77%"),
    "faixa fechada casa nas DUAS grafias");
  ok("G", TX_ABERTA_RE.test("A partir de 2,48%") && TX_ABERTA_RE.test("A partir de 2.48%"),
    "faixa aberta casa nas DUAS grafias");
  ok("G", !TX_FAIXA_RE.test("1,75%as1,77%"),
    "e NAO casa a forma que o `\\s` comido produziria ('%as%') — controle negativo");
  // e o efeito no draft: e exatamente o que a regressao apagou.
  ok("G", tipoDeCelula(dVirgula.regraDraft, "CONSIG_PUBLICO") === "celulas_taxa_prazo",
    `CONSIG_PUBLICO e 'celulas_taxa_prazo' (a regressao do \\s virava 'celulas_prazo')`);
  ok("G", dVirgula.regraDraft.ADIANTAMENTO_13.tx_juros_min === 0.0325 &&
          dVirgula.regraDraft.INSS_RENOV.tx_juros_min === 0.01,
    "tx_juros_min DERIVADO existe em ADIANTAMENTO_13 (0.0325) e INSS_RENOV (0.01) — a regressao o apagava");
  const celPub = Object.values(dVirgula.regraDraft.CONSIG_PUBLICO).find(Array.isArray)[0];
  ok("G", celPub.tx_min === 0.0175 && celPub.tx_max === 0.0177,
    "a faixa de taxa da celula foi LIDA (0,0175-0,0177), nao so inferida");

  console.log("\n========================================");
  if (falhas.length === 0) {
    console.log("GATE separador decimal do pct da TRP: PASSOU");
    console.log("  7 blocos; mutacao em 3 sentidos, todas com alvo confirmado.");
  } else {
    console.log(`GATE separador decimal do pct da TRP: FALHOU (${falhas.length} assercao)`);
    for (const f of falhas) console.log(`  - ${f}`);
  }
  console.log("========================================");
  process.exit(falhas.length === 0 ? 0 : 1);
}

main();
