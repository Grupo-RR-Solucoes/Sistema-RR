#!/usr/bin/env node
/**
 * scripts/trp_vigencia_regua_gate.cjs — PORTAO da VIGENCIA DA REGUA da TRP.
 * SELF-CONTAINED: fixture sintetica, funcao pura, sem banco e sem caminho
 * absoluto (escolherFatia e pura e vigenciaDaCompetencia nao toca banco).
 *
 * O QUE ELE GUARDA (decisao do Diego, 02/09/2026)
 * ----------------------------------------------
 * As janelas de competencia NAO particionam o calendario: entre o PENULTIMO dia
 * util de um mes (fim da janela de M) e o ULTIMO (inicio da janela de M+1)
 * sobram dias ORFAOS. Medido sobre 191 meses: 25 com orfao, 13,1%. Um
 * contract_date ali nao era coberto por fatia nenhuma e o resolvedor lancava
 * TrpVigenciaGapError, derrubando /promotores, /recebiveis e /dashboard.
 *
 * O conserto e o criterio de COBERTURA, na leitura, sem tocar linha gravada:
 *   a ULTIMA fatia ativa da competencia cobre ate o dia ANTERIOR ao valid_from
 *   da competencia seguinte; as demais mantem o limite GRAVADO.
 *
 * A vigencia da REGUA ficou separada da janela de PRODUCAO de proposito — sao
 * perguntas diferentes, e a assimetria esta no cabecalho de
 * lib/trp/vigenciaRegua.ts. O bloco F abaixo vigia os avisos que impedem a
 * proxima pessoa de "unificar" achando que e duplicacao.
 *
 * BLOCOS
 *   A. as 6 datas ORFAS de 2026-27 resolvem (datas COMPUTADAS no run).
 *   B. o orfao em dia UTIL (2024-05-30, Corpus Christi) tambem resolve.
 *   C. NAO afrouxou: buraco no MEIO da competencia continua lancando.
 *   D. nenhuma fatia encolhe, e SO a ultima estica.
 *   E. as tres conferencias de commitTrpVersion seguem no lugar, e a rigidez
 *      da (c) segue registrada como DELIBERADA.
 *   F. a divergencia esta registrada nos quatro lugares.
 *
 * MUTACOES (5), no JS emitido, cada uma exigindo alvo confirmado.
 * EXIT 0 so com os 6 blocos verdes.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const TEMPS = [];
let rootAtual = null;

const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const wd = (iso) => DIA[new Date(iso + "T12:00:00Z").getUTCDay()];
const add = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const proxComp = (c) => { let [y, m] = c.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, "0")}`; };

const ARQUIVOS = ["lib/trp/vigencia.ts", "lib/trp/vigenciaRegua.ts", "lib/trp/resolveTrpRegraDb.ts"];

function compilar() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".vregua-out-"));
  TEMPS.push(OUT);
  fs.writeFileSync(path.join(OUT, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: ARQUIVOS.map((f) => path.join(ROOT, f)),
  }));
  try { execSync(`npx tsc -p "${path.join(OUT, "tsconfig.json")}"`, { cwd: ROOT, stdio: "inherit" }); } catch (_e) {}
  if (!fs.existsSync(path.join(OUT, "lib/trp/resolveTrpRegraDb.js"))) {
    throw new Error("tsc nao emitiu resolveTrpRegraDb.js — o portao NAO passa sem medir");
  }
  return OUT;
}

function instalarResolver() {
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...rest) {
    if (r.startsWith("@/")) r = path.join(rootAtual, r.slice(2));
    return orig.call(this, r, ...rest);
  };
}

function carregar(OUT) {
  rootAtual = OUT;
  return {
    R: require(path.join(OUT, "lib/trp/resolveTrpRegraDb.js")),
    V: require(path.join(OUT, "lib/trp/vigencia.js")),
    VR: require(path.join(OUT, "lib/trp/vigenciaRegua.js")),
  };
}

/** Copia o OUT e aplica substituicao TEXTUAL num arquivo emitido.
 *  trocas === 0 => o chamador REPROVA (mutacao vazia e verde por vacuidade). */
function mutar(OUTBase, arquivo, de, para) {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".vregua-mut-"));
  TEMPS.push(OUT);
  fs.cpSync(OUTBase, OUT, { recursive: true });
  const alvo = path.join(OUT, arquivo);
  const src = fs.readFileSync(alvo, "utf8");
  const trocas = src.split(de).length - 1;
  fs.writeFileSync(alvo, src.split(de).join(para));
  return { OUT, trocas };
}

process.on("exit", () => {
  for (const d of TEMPS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) {} }
});

const falhas = [];
function ok(bloco, cond, msg) {
  console.log(`  ${cond ? "OK   " : "FALHA"} [${bloco}] ${msg}`);
  if (!cond) falhas.push(`[${bloco}] ${msg}`);
}
const lancou = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---------------------------------------------------------------------------
// FIXTURES SINTETICAS — competencias montadas a mao, no shape que o resolvedor
// devolve. Nenhum PDF, nenhum banco, nenhum id real.
// ---------------------------------------------------------------------------

/** Monta uma competencia com N fatias. `ordem` embaralha de proposito. */
function comp(V, competencia, pedacos, { ordem = "desc" } = {}) {
  const { validFrom, validUntil } = V.vigenciaDaCompetencia(competencia);
  const fatias = pedacos.map((p, i) => ({
    regra: { _meta: { competencia } },
    competenciaAlvo: competencia,
    competenciaFornecedora: competencia,
    isFallback: false,
    validFrom, validUntil,
    rowValidFrom: p.de, rowValidUntil: p.ate,
    fatiasAtivas: pedacos.length,
    competenciaPartida: pedacos.length > 1,
    versionId: `v${i + 1}`, versionNo: i + 1,
  }));
  fatias.sort((a, b) => (ordem === "desc" ? (a.rowValidFrom < b.rowValidFrom ? 1 : -1)
                                          : (a.rowValidFrom > b.rowValidFrom ? 1 : -1)));
  return { competenciaAlvo: competencia, validFrom, validUntil, partida: pedacos.length > 1, fatias };
}

/** As competencias com ORFAO num intervalo — COMPUTADAS, nunca cravadas. */
function orfasEntre(V, de, ate) {
  const out = [];
  let c = de;
  while (c <= ate) {
    const w = V.vigenciaDaCompetencia(c);
    const wp = V.vigenciaDaCompetencia(proxComp(c));
    let d = add(w.validUntil, 1);
    const orfas = [];
    while (d < wp.validFrom) { orfas.push(d); d = add(d, 1); }
    if (orfas.length) out.push({ comp: c, janela: w, orfas });
    c = proxComp(c);
  }
  return out;
}

function main() {
  instalarResolver();
  const OUT_LIMPO = compilar();
  const { R, V, VR } = carregar(OUT_LIMPO);

  // ----- A: as 6 orfas de 2026-27 -----------------------------------------
  console.log("\n[A] as datas ORFAS de 2026-2027 resolvem (datas computadas no run)");
  const orfas2627 = orfasEntre(V, "2026-01", "2027-12");
  const totalOrfas = orfas2627.reduce((n, x) => n + x.orfas.length, 0);
  ok("A", orfas2627.length === 3 && totalOrfas === 6,
    `o calendario ainda tem 3 competencias com orfao e 6 datas (achei ${orfas2627.length} e ${totalOrfas}) ` +
    `— se isto mudar, a fixture envelheceu e o resto do bloco nao vale`);
  for (const o of orfas2627) {
    // competencia com UMA fatia so, na vigencia canonica (mes NAO partido)
    const c1 = comp(V, o.comp, [{ de: o.janela.validFrom, ate: o.janela.validUntil }]);
    for (const d of o.orfas) {
      const e = lancou(() => R.escolherFatia(c1, d));
      const f = e ? null : R.escolherFatia(c1, d);
      ok("A", e === null && f !== null,
        `${o.comp}: ${d} (${wd(d)}) resolve${e ? ` — LANCOU ${e.name}` : ` na fatia v${f.versionNo}`}`);
    }
  }

  // ----- B: o orfao em dia UTIL (feriado) ----------------------------------
  console.log("\n[B] o orfao em dia UTIL — 2024-05-30 (Corpus Christi)");
  const w24 = V.vigenciaDaCompetencia("2024-05");
  const orfas24 = orfasEntre(V, "2024-05", "2024-05");
  ok("B", orfas24.length === 1 && orfas24[0].orfas.length === 1,
    `2024-05 tem exatamente 1 orfao (achei ${orfas24.length ? orfas24[0].orfas.length : 0})`);
  if (orfas24.length) {
    const d = orfas24[0].orfas[0];
    ok("B", wd(d) === "qui" && V.nationalHolidays(2024).has(d),
      `${d} e ${wd(d)} e FERIADO — e o unico formato que produz orfao em dia util`);
    const c24 = comp(V, "2024-05", [{ de: w24.validFrom, ate: w24.validUntil }]);
    const e = lancou(() => R.escolherFatia(c24, d));
    ok("B", e === null, `${d} resolve${e ? ` — LANCOU ${e.name}` : ""}`);
  }

  // ----- C: NAO afrouxou ---------------------------------------------------
  console.log("\n[C] buraco no MEIO da competencia continua LANCANDO");
  const w8 = V.vigenciaDaCompetencia("2026-08");
  const miolo = comp(V, "2026-08", [
    { de: w8.validFrom, ate: "2026-08-10" },
    { de: "2026-08-15", ate: w8.validUntil },
  ]);
  const eMiolo = lancou(() => R.escolherFatia(miolo, "2026-08-12"));
  ok("C", eMiolo !== null && eMiolo.name === "TrpVigenciaGapError",
    `12/08, entre as fatias 10 e 15, LANCA (${eMiolo && eMiolo.name})`);
  ok("C", lancou(() => R.escolherFatia(miolo, "2026-08-29")) === null,
    "e a CAUDA do mesmo mes (29/08) resolve — a extensao e so na cauda, nao tapa miolo");

  // ----- D: nenhuma encolhe, so a ultima estica -----------------------------
  console.log("\n[D] nenhuma fatia encolhe, e SO a ultima estica");
  // agosto/2026 REAL: v1 ate 04/08 (TRP38), v2 de 05/08 (TRP39). Ordem EMBARALHADA.
  const ago = comp(V, "2026-08",
    [{ de: w8.validFrom, ate: "2026-08-04" }, { de: "2026-08-05", ate: w8.validUntil }],
    { ordem: "asc" });
  const f04 = R.escolherFatia(ago, "2026-08-04");
  ok("D", f04 && f04.rowValidUntil === "2026-08-04",
    `04/08 fica na v1 (${f04 && f04.rowValidFrom}..${f04 && f04.rowValidUntil}) — fatia do MEIO nao esticou`);
  const f05 = R.escolherFatia(ago, "2026-08-05");
  ok("D", f05 && f05.rowValidFrom === "2026-08-05", "05/08 fica na v2 — a fronteira interna nao se moveu");
  const f29 = R.escolherFatia(ago, "2026-08-29");
  ok("D", f29 && f29.rowValidFrom === "2026-08-05",
    "29/08 (orfa) cai na ULTIMA fatia, mesmo com o fixture entregue FORA DE ORDEM");
  // max, nunca encolhe: valid_until gravado MAIOR que o calculado vence.
  const gravadoMaior = comp(V, "2026-08", [{ de: w8.validFrom, ate: "2026-09-15" }]);
  const fMaior = R.escolherFatia(gravadoMaior, "2026-09-10");
  ok("D", fMaior !== null,
    "um valid_until GRAVADO alem do calculado continua valendo (max, nunca substituicao)");
  // no-op onde nao ha orfao: julho/2026
  const w7 = V.vigenciaDaCompetencia("2026-07");
  ok("D", VR.vigenciaReguaDaCompetencia("2026-07").reguaUntil === w7.validUntil,
    `2026-07 e NO-OP: reguaUntil === validUntil (${w7.validUntil})`);
  ok("D", VR.vigenciaReguaDaCompetencia("2026-08").reguaUntil === add(V.vigenciaDaCompetencia("2026-09").validFrom, -1),
    "2026-08 estica ate o dia anterior ao valid_from de 2026-09");

  // ----- E: as tres conferencias do commit + a rigidez deliberada -----------
  console.log("\n[E] as tres conferencias de commitTrpVersion seguem no lugar");
  const cv = fs.readFileSync(path.join(ROOT, "lib/trp/commitVersion.ts"), "utf8");
  ok("E", /fatias\.length === 0/.test(cv), "(a) 'nenhuma fatia ativa' continua no codigo");
  ok("E", /cobreInicio/.test(cv), "(b) 'cobre o inicio da janela' continua no codigo");
  ok("E", /override > ultima\.valid_until/.test(cv), "(c) 'deixaria um BURACO' continua no codigo");
  ok("E", /RIGIDEZ E DELIBERADA|rigidez e deliberada/i.test(cv) && /30\/08/.test(cv),
    "a rigidez da (c) esta registrada como DELIBERADA, com o exemplo do override de 30/08");

  // ----- F: a divergencia esta registrada -----------------------------------
  console.log("\n[F] a divergencia esta registrada — para ninguem 'unificar' de volta");
  const vr = fs.readFileSync(path.join(ROOT, "lib/trp/vigenciaRegua.ts"), "utf8");
  ok("F", /perguntas diferentes/i.test(vr) && /assimetria/i.test(vr),
    "vigenciaRegua.ts explica que sao PERGUNTAS DIFERENTES e nomeia a assimetria");
  const vg = fs.readFileSync(path.join(ROOT, "lib/trp/vigencia.ts"), "utf8");
  ok("F", /vigenciaReguaDaCompetencia/.test(vg),
    "vigencia.ts avisa para nao usar a janela como cobertura de regua");
  const pm = fs.readFileSync(path.join(ROOT, "lib/projecaoMetas.ts"), "utf8");
  ok("F", /vigenciaReguaDaCompetencia/.test(pm) && /EMENDA/.test(pm),
    "projecaoMetas.ts tem a EMENDA — o 'um unico lugar' deixou de valer e esta dito");
  const bb = fs.readFileSync(path.join(ROOT, "lib/bbts/resolveBbtsRegra.ts"), "utf8");
  ok("F", /DESALINHAMENTO CONHECIDO/i.test(bb) && /maybeSingle/.test(bb),
    "resolveBbtsRegra.ts registra que 'espelho' deixou de valer na escolha de fatia por data");

  // ----- MUTACOES ----------------------------------------------------------
  console.log("\n[MUT] mutacao no JS emitido — 5 sentidos, cada um com alvo confirmado");
  const VREGUA = "lib/trp/vigenciaRegua.js";
  const RESOLV = "lib/trp/resolveTrpRegraDb.js";
  const orfa = orfas2627[0].orfas[0];
  const compOrfa = comp(V, orfas2627[0].comp,
    [{ de: orfas2627[0].janela.validFrom, ate: orfas2627[0].janela.validUntil }]);

  function mutacao(nome, arquivo, de, para, prova) {
    const m = mutar(OUT_LIMPO, arquivo, de, para);
    ok(nome, m.trocas > 0, `alvo encontrado em ${path.basename(arquivo)} (${m.trocas} troca)`);
    if (m.trocas === 0) return;
    const mods = carregar(m.OUT);
    prova(mods, nome);
    rootAtual = OUT_LIMPO;
  }

  // M1 — desfaz a extensao: A e B caem.
  mutacao("MUT1", VREGUA, "return reguaUntil > rowValidUntil ? reguaUntil : rowValidUntil;",
    "return rowValidUntil;", (m, n) => {
      const c1 = comp(m.V, orfas2627[0].comp, [{ de: orfas2627[0].janela.validFrom, ate: orfas2627[0].janela.validUntil }]);
      ok(n, lancou(() => m.R.escolherFatia(c1, orfa)) !== null,
        `sem a extensao, a orfa ${orfa} volta a LANCAR`);
    });

  // M2 — estende TODAS as fatias: D cai (o contrato de 04/08 escorrega).
  mutacao("MUT2", VREGUA, "if (!ehUltimaFatia)", "if (false)", (m, n) => {
    const a = comp(m.V, "2026-08",
      [{ de: w8.validFrom, ate: "2026-08-04" }, { de: "2026-08-05", ate: w8.validUntil }], { ordem: "asc" });
    // O DANO de esticar TODAS nao aparece em 04/08 (que ja e da v1); aparece numa
    // data da v2 sendo ENGOLIDA pela v1 estendida. Com a v1 valendo ate 30/08, o
    // `find` pode devolve-la para 20/08 — e o contrato de 20/08 passaria a ser
    // regido pela TRP38 no lugar da TRP39. Por isso o fixture vem FORA DE ORDEM:
    // se a extensao so estivesse na ultima fatia, a ordem nao importaria.
    const f = m.R.escolherFatia(a, "2026-08-20");
    ok(n, !(f && f.rowValidFrom === "2026-08-05"),
      `estendendo TODAS, 20/08 sai da v2 (foi para ${f ? f.rowValidFrom + ".." + f.rowValidUntil : "LANCOU"}, ` +
      `a certa comeca em 2026-08-05)`);
  });

  // M3 — max vira substituicao direta: D cai (o gravado maior e encolhido).
  mutacao("MUT3", VREGUA, "return reguaUntil > rowValidUntil ? reguaUntil : rowValidUntil;",
    "return reguaUntil;", (m, n) => {
      const g = comp(m.V, "2026-08", [{ de: w8.validFrom, ate: "2026-09-15" }]);
      ok(n, lancou(() => m.R.escolherFatia(g, "2026-09-10")) !== null,
        "sem o max, um valid_until gravado ALEM do calculado e ENCOLHIDO e a data cai fora");
    });

  // M4 — a ultima vira fatias[0]: D cai com o fixture fora de ordem.
  mutacao("MUT4", RESOLV, "comp.fatias.reduce((a, b) => (b.rowValidFrom > a.rowValidFrom ? b : a))",
    "comp.fatias[0]", (m, n) => {
      const a = comp(m.V, "2026-08",
        [{ de: w8.validFrom, ate: "2026-08-04" }, { de: "2026-08-05", ate: w8.validUntil }], { ordem: "asc" });
      // NAO lanca: entrega a regua ERRADA em silencio, que e pior. Com o fixture
      // fora de ordem, fatias[0] e a v1 (TRP38) — e e ELA que ganha a extensao,
      // entao 29/08 passa a ser regido pela TRP38 no lugar da TRP39. Dinheiro
      // errado sem sintoma. A assercao cobra a fatia CERTA, nao a excecao.
      const f = lancou(() => m.R.escolherFatia(a, "2026-08-29")) ? null : m.R.escolherFatia(a, "2026-08-29");
      ok(n, !(f && f.rowValidFrom === "2026-08-05"),
        `com fatias[0] e o fixture FORA DE ORDEM, 29/08 sai da fatia certa (foi para ` +
        `${f ? f.rowValidFrom + ".." + f.rowValidUntil : "LANCOU"}, a certa comeca em 2026-08-05)`);
    });

  // M5 — estende para ANTES do validUntil (tapa miolo): C cai.
  mutacao("MUT5", RESOLV, "data >= f.rowValidFrom", "data >= comp.validFrom", (m, n) => {
    const mi = comp(m.V, "2026-08",
      [{ de: w8.validFrom, ate: "2026-08-10" }, { de: "2026-08-15", ate: w8.validUntil }]);
    ok(n, lancou(() => m.R.escolherFatia(mi, "2026-08-12")) === null,
      "afrouxando o limite INFERIOR, o buraco do miolo (12/08) passa a resolver — era para LANCAR");
  });

  console.log("\n========================================");
  if (falhas.length === 0) {
    console.log("GATE vigencia da REGUA da TRP: PASSOU");
    console.log("  6 blocos; 5 mutacoes, todas com alvo confirmado.");
  } else {
    console.log(`GATE vigencia da REGUA da TRP: FALHOU (${falhas.length} assercao)`);
    for (const f of falhas) console.log(`  - ${f}`);
  }
  console.log("========================================");
  process.exit(falhas.length === 0 ? 0 : 1);
}

main();
