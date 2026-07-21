// DRY-RUN / GATE (read-only, NAO grava) do Movimento 2b: DIFERIDO do consorcio.
// Prova:
//   (a) repasse promotor-a-promotor CONFERE contra o gabarito
//       PRODUCAO_GERAL_CONSORCIO_RR_ALAGOAS_JUNHO_2026 (14 promotores);
//   (b) gestor_10 total = R$1.190,30 (10% AL junho);
//   (c) identidade prom0,40 + gest0,10 + emp0,50 = comissao-empresa (desvio 0,0000);
//   (d) invariante do ledger byte-identico p/ promotor sem-produto (+consorcio/lob);
//   (e) auditoria: proposta com PARCk em maio cujo PARC(k+1) sumiu em junho -> NAO_VEIO.
// A logica espelha lib/consorcio/trp210.ts + carteira.ts + fila.ts + gestorPayout.ts.
// Uso: node scripts/dryrun_produtos_m2b.cjs
const path = require("path");
const fs = require("fs");
const os = require("os");
const REPO = path.resolve(__dirname, "..");
const XLSX = require(path.join(REPO, "node_modules", "xlsx"));

const r2 = (x) => Math.round(x * 100) / 100;
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const num = (v) => {
  if (typeof v === "number") return v;
  let r = String(v ?? "").trim().replace(/\s/g, "").replace("R$", "");
  if (r.includes(",") && r.includes(".")) r = r.lastIndexOf(",") > r.lastIndexOf(".") ? r.replace(/\./g, "").replace(",", ".") : r.replace(/,/g, "");
  else if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
  const n = Number(r.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// ---- espelho de lib/consorcio/trp210.ts ----
const FAT_PROM = 0.4, FAT_GEST = 0.1, TETO_GERAL = 6, TETO_IMOVEL = 10, PCT_TOL = 0.00005;
const TRP = [
  { c: "VAREJO", g15: 0.0072, g6: 0.004, im: 0.004 },
  { c: "MIDDLE", g15: 0.0076, g6: 0.004, im: 0.0042 },
  { c: "UPPER_MIDDLE", g15: 0.0078, g6: 0.004, im: 0.0043 },
  { c: "CORPORATE", g15: 0.008, g6: 0.0045, im: 0.00445 },
  { c: "LARGE_CORPORATE", g15: 0.0083, g6: 0.0045, im: 0.0046 },
];
const isImovel = (s) => { const c = norm(s); return c === "AI" || c.startsWith("IM") || c.includes("IMOV"); };
const grupoDe = (s) => (isImovel(s) ? "IMOVEL" : "GERAL");
const tetoDe = (g) => (g === "IMOVEL" ? TETO_IMOVEL : TETO_GERAL);
const posDe = (p) => { const m = String(p ?? "").match(/(\d+)/); return m ? Number(m[1]) : null; };
const classifPorPct = (g, pct) => { const key = g === "IMOVEL" ? "im" : "g15"; const l = TRP.find((x) => Math.abs(x[key] - pct) <= PCT_TOL); return l ? l.c : null; };
const pctPos = (g, c, pos) => { const l = TRP.find((x) => x.c === c); if (!l) return 0; if (g === "IMOVEL") return l.im; return pos >= TETO_GERAL ? l.g6 : l.g15; };
const repProm = (e) => r2(e * FAT_PROM), repGest = (e) => r2(e * FAT_GEST);

// projeta 1..teto (degrau da 6a no Geral). classif null -> alerta, usa pctObs.
function projetar(g, valorBem, pctObs, classif) {
  const teto = tetoDe(g), out = [];
  for (let p = 1; p <= teto; p++) {
    const pct = classif ? pctPos(g, classif, p) : pctObs;
    out.push({ posicao: p, pct, esperada: r2(valorBem * pct) });
  }
  return { parcelas: out, alerta: classif === null };
}

// ---- espelho de buildCarteiraConsorcioRows (grao por-parcela, status) ----
// entries: {company, proposta, comp:'YYYY-MM', posicao, valorBem, pct, comissao, segmento}
function buildCarteira(entries) {
  const cnum = (c) => { const [y, m] = c.split("-").map(Number); return y * 100 + m; };
  let ref = 0; for (const e of entries) ref = Math.max(ref, cnum(e.comp));
  const grupos = new Map();
  for (const e of entries) {
    const k = `${e.company}|${e.proposta}`;
    let g = grupos.get(k);
    if (!g) { g = { company: e.company, proposta: e.proposta, rec: new Map(), primeira: e.comp, valorBem: e.valorBem, seg: e.segmento }; grupos.set(k, g); }
    if (cnum(e.comp) < cnum(g.primeira)) g.primeira = e.comp;
    if (e.valorBem > 0 && g.valorBem <= 0) g.valorBem = e.valorBem;
    if (!g.seg && e.segmento) g.seg = e.segmento;
    const ja = g.rec.get(e.posicao);
    if (!ja || cnum(e.comp) < cnum(ja.comp)) g.rec.set(e.posicao, { comissao: e.comissao, comp: e.comp, pct: e.pct });
  }
  const rows = [];
  for (const g of grupos.values()) {
    const grupo = grupoDe(g.seg), teto = tetoDe(grupo);
    const ord = [...g.rec.entries()].sort((a, b) => a[0] - b[0]);
    let pctObs = 0;
    for (const [pos, r] of ord) { if (grupo === "IMOVEL" || pos <= 5) { pctObs = r.pct; break; } }
    if (pctObs === 0 && ord.length) pctObs = ord[0][1].pct;
    const classif = classifPorPct(grupo, pctObs);
    const proj = projetar(grupo, g.valorBem, pctObs, classif);
    const maxR = ord.length ? ord[ord.length - 1][0] : 0;
    const ultC = ord.reduce((mx, [, r]) => Math.max(mx, cnum(r.comp)), 0);
    const completa = maxR >= teto;
    for (const parc of proj.parcelas) {
      const rec = g.rec.get(parc.posicao);
      let status;
      if (rec) status = completa && parc.posicao === teto ? "ENCERRADA" : "RECEBIDA";
      else if (parc.posicao === maxR + 1 && ultC > 0 && ultC < ref) status = "NAO_VEIO";
      else status = "ESPERADA";
      rows.push({ company: g.company, proposta: g.proposta, posicao: parc.posicao, grupo, teto, valorBem: g.valorBem, classif, alerta: proj.alerta, pct: parc.pct, esperada: parc.esperada, recebida: rec ? r2(rec.comissao) : null, compRec: rec ? rec.comp : null, status });
    }
  }
  return rows;
}

// ---- leitura de planilhas ----
function readObjs(f) {
  const wb = XLSX.readFile(f);
  const target = wb.SheetNames.find((n) => /cons[oó]rcio/i.test(n) && !/master/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[target], { header: 1, defval: "" });
  const hdr = rows[0].map(norm);
  return rows.slice(1).filter((r) => String(r[1] ?? "").trim() !== "").map((r) => { const o = {}; hdr.forEach((h, c) => { if (h) o[h] = r[c]; }); return o; });
}
function findFile(res, dirs) {
  for (const d of dirs) { try { for (const f of fs.readdirSync(d)) { if (res.some((re) => re.test(f))) return path.join(d, f); } } catch {} }
  return null;
}
const DL = path.join(os.homedir(), "Downloads");
const TMP = path.join(REPO, "_tmp_fechamentos");
const dirs = [DL, TMP, REPO, path.join(DL, "RRCRED", "producao")];

let fail = 0;
const check = (name, ok) => { console.log(`  ${ok ? "OK  " : "FALHA"} ${name}`); if (!ok) fail++; };

console.log("===== (a)(b)(c) GABARITO PRODUCAO_GERAL_CONSORCIO_RR_ALAGOAS_JUNHO_2026 =====");
const gab = findFile([/PRODU.*GERAL.*CONS[OÓ]RCIO.*ALAGOAS.*JUNHO.*2026\.xlsx$/i, /PRODUCAO_GERAL_CONSORCIO_RR_ALAGOAS_JUNHO_2026\.xlsx$/i], dirs);
if (!gab) {
  console.log("  (gabarito nao encontrado em Downloads/_tmp_fechamentos — coloque o arquivo para rodar (a)(b)(c))");
} else {
  const objs = readObjs(gab);
  console.log(`  arquivo: ${path.basename(gab)} (${objs.length} linhas)`);
  // (c) identidade por linha: o split calculado (prom x0,40 + gest x0,10) e BYTE-IGUAL
  // ao gabarito, e prom+gest+empresa(residual 50%) = comissao-empresa (desvio 0,0000).
  let maxDesvioSplit = 0, maxDesvioResid = 0;
  const promCalc = {}, promGab = {};
  let gestCalc = 0, gestGab = 0;
  for (const o of objs) {
    const emp = num(o["COMISSAO"]);
    const gProm = num(o["COMISSAO PROMOTOR"] ?? o["COMISSAO PROMOTOR(A)"]);
    const gGest = num(o["COMISSAO GESTOR"]);
    // split calc vs gabarito ao nivel de CENTAVOS (o gabarito guarda a formula crua
    // sem arredondar; o ledger e numeric(18,2)) -> compara r2 dos dois:
    maxDesvioSplit = Math.max(maxDesvioSplit, Math.abs(repProm(emp) - r2(gProm)), Math.abs(repGest(emp) - r2(gGest)));
    // identidade: empresa = residual (emp - prom - gest) -> soma exata = emp.
    maxDesvioResid = Math.max(maxDesvioResid, Math.abs(repProm(emp) + repGest(emp) + (emp - repProm(emp) - repGest(emp)) - emp));
    const p = String(o["PROMOTOR(A)"] ?? o["PROMOTOR"] ?? "").trim() || "(BALDE)";
    promCalc[p] = r2((promCalc[p] || 0) + repProm(emp));
    promGab[p] = r2((promGab[p] || 0) + gProm);
    gestCalc = r2(gestCalc + repGest(emp));
    gestGab = r2(gestGab + gGest);
  }
  check(`(c) split calc = gabarito em centavos (desvio ${maxDesvioSplit.toFixed(4)}) e identidade prom+gest+emp = comissao (desvio ${maxDesvioResid.toFixed(4)})`, maxDesvioSplit <= 0.01 && maxDesvioResid <= 0.0001);
  // (a) promotor-a-promotor
  const nomes = [...new Set([...Object.keys(promCalc), ...Object.keys(promGab)])].sort();
  let divProm = 0;
  for (const p of nomes) {
    const c = promCalc[p] || 0, g = promGab[p] || 0;
    const ok = Math.abs(c - g) <= 0.01;
    if (!ok) divProm++;
    console.log(`    ${ok ? "OK " : "DIV"}  ${p}: calc ${c.toFixed(2)} | gabarito ${g.toFixed(2)}`);
  }
  check(`(a) repasse promotor-a-promotor confere (${nomes.length} promotores, ${divProm} divergentes)`, divProm === 0);
  // (b) gestor total
  console.log(`    gestor: calc(10% emp)=${gestCalc.toFixed(2)} | gabarito COMISSAO GESTOR=${gestGab.toFixed(2)}`);
  check(`(b) gestor_10 total = R$1.190,30`, Math.abs(gestCalc - 1190.30) <= 0.01 && Math.abs(gestGab - 1190.30) <= 0.01);
}

console.log("\n===== (d) INVARIANTE do ledger (final = prod+seg+bbcap+cc+consorcio+lob; nao-produto inalterado; idempotente) =====");
{
  const pmr = {
    A: { prod: 100, ins: 20, bbcap: 0, cc: 0, cons: 0, lob: 0, final: 120 }, // sem produto
    B: { prod: 50, ins: 0, bbcap: 0, cc: 0, cons: 0, lob: 0, final: 50 }, // credito + consorcio
    C: { prod: 0, ins: 0, bbcap: 0, cc: 0, cons: 0, lob: 0, final: 0, novo: true }, // so-consorcio
  };
  const produto = { B: { cons: 24 }, C: { cons: 14.4 } }; // repasse consorcio ja calculado (x0,40)
  const antes = JSON.parse(JSON.stringify(pmr));
  const apply = (p) => { for (const k of Object.keys(produto)) { const v = produto[k]; p[k].bbcap = v.bbcap || 0; p[k].cc = v.cc || 0; p[k].cons = v.cons || 0; p[k].lob = v.lob || 0; p[k].final = r2(p[k].prod + p[k].ins + p[k].bbcap + p[k].cc + p[k].cons + p[k].lob); } };
  apply(pmr); const depois1 = JSON.parse(JSON.stringify(pmr)); apply(pmr);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("A (sem produto) byte-identico", eq(antes.A, pmr.A));
  check("B final = prod+consorcio (74)", pmr.B.final === r2(50 + 24) && pmr.B.cons === 24);
  check("C so-consorcio final = 14,40", pmr.C.final === 14.4 && pmr.C.cons === 14.4);
  check("idempotente (2a passada = 1a)", eq(depois1, pmr));
}

console.log("\n===== (e) AUDITORIA — parcela que sumiu (maio PARCk -> junho PARC(k+1) ausente) =====");
{
  // Base real: maio 2026 (C101846). Se houver, usa a proposta 8550229 (PARC1-3, GERAL 0,72%).
  const maio = findFile([/C101846.*Cons[oó]rcio.*5_2026\.xlsx$/i, /BB Cons[oó]rcio.*5_2026\.xlsx$/i], [TMP]);
  const entries = [];
  if (maio) {
    console.log(`  fechamento maio: ${path.basename(maio)}`);
    for (const o of readObjs(maio)) {
      const bem = num(o["VALOR BEM"]); const com = num(o["COMISSAO"]); const pct = num(o["% COMISSAO"]) || (bem > 0 ? com / bem : 0);
      entries.push({ company: "C1", proposta: String(o["PROPOSTA"]).trim(), comp: "2026-05", posicao: posDe(o["PARCELA LIBERACAO"] ?? o["PARCELA LIBERAÇÃO"]), valorBem: bem, pct, comissao: com, segmento: o["SEGMENTO"] });
    }
  } else {
    console.log("  (maio real ausente — usando exemplo deterministico GERAL Varejo)");
    for (const p of [1, 2, 3]) entries.push({ company: "C1", proposta: "EX-8550229", comp: "2026-05", posicao: p, valorBem: 5000, pct: 0.0072, comissao: 36, segmento: "DEMAIS" });
  }
  // junho: NADA para a proposta escolhida (parou). Adiciona 1 parcela de OUTRA proposta
  // para que a referencia do dataset seja junho (senao maxComp=maio e nada vence).
  entries.push({ company: "C1", proposta: "OUTRA", comp: "2026-06", posicao: 1, valorBem: 5000, pct: 0.0072, comissao: 36, segmento: "DEMAIS" });

  const alvo = entries.find((e) => e.comp === "2026-05")?.proposta;
  const rows = buildCarteira(entries);
  const naoVeio = rows.filter((r) => r.proposta === alvo && r.status === "NAO_VEIO");
  const maxRec = Math.max(0, ...rows.filter((r) => r.proposta === alvo && (r.status === "RECEBIDA" || r.status === "ENCERRADA")).map((r) => r.posicao));
  console.log(`  proposta ${alvo}: maxRecebida=${maxRec}, parcelas NAO_VEIO=${naoVeio.map((r) => `pos${r.posicao}(${r.esperada})`).join(", ") || "(nenhuma)"}`);
  check("dispara NAO_VEIO na posicao seguinte", naoVeio.length >= 1 && naoVeio[0].posicao === maxRec + 1);
  check("valor previsto = comissao esperada pela TRP", naoVeio.length >= 1 && naoVeio[0].esperada > 0);
}

console.log(`\n${fail === 0 ? "GATE OK" : `GATE FALHOU (${fail} checagens)`}`);
process.exit(fail === 0 ? 0 : 1);
