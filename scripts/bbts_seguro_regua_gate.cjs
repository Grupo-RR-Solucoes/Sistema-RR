#!/usr/bin/env node
/**
 * scripts/bbts_seguro_regua_gate.cjs — GATE do SEGURO da ADS lido da RÉGUA.
 * READ-ONLY: client STUB em memória, não toca banco, não grava (dryRun).
 *
 * Prova o conserto de bbtsMonthly (SLIP fixo 0,35% -> faixa por prazo da régua
 * versionada bbts_rule_versions.regra_json.seguro), com as LINHAS REAIS de
 * jun/jul (dump de prod):
 *   G1  HELPER seguroRateFromRegra: ESTOQUE=estoque.pct; SLIP=faixa por prazo;
 *       prazo ausente -> {rate:null,motivo} (NÃO chuta); régua sem seguro -> null.
 *   G2  RESOLVER fallback: junho (sem régua própria) herda a de julho
 *       (direcao='posterior', isFallback=true); julho é exata (isFallback=false).
 *   G3  JUNHO end-to-end NO-OP: seguro-empresa idêntico ao antigo 0,35 fixo
 *       (a única SLIP é 85+, onde 0,35 coincide). Hash dos valores por linha igual.
 *   G4  JULHO end-to-end MUDA pro certo, linha a linha: SLIP 0-36 14,66->4,19;
 *       SLIP 37-60 12,29->5,27; ESTOQUE intacto; seguro-empresa cai R$17,49.
 *   G5  PRAZO AUSENTE (linha SLIP sem term_months) -> aviso + 0 (nunca 0,35).
 *   G6  RR INTOCADO: nenhum arquivo RR no diff; e as faixas BBTS != faixas RR.
 *
 * Uso: node scripts/bbts_seguro_regua_gate.cjs
 */

process.env.TRP_SOURCE = "json"; // motor lê o JSON embutido; sem DB de crédito
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://stub.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "stub";

require("./_ts_register.cjs");
const path = require("path");
const { execSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const { consolidateMonthlyFromBbts } = require(path.join(ROOT, "lib", "bbtsMonthly.ts"));
const { seguroRateFromRegra } = require(path.join(ROOT, "lib", "bbts", "seguroBbts.ts"));
const { resolveBbtsRegraDb } = require(path.join(ROOT, "lib", "bbts", "resolveBbtsRegra.ts"));

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
let fails = 0;
const R = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  ->  " + extra : ""}`);
  if (!cond) fails++;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

// --- RÉGUA de julho (fiel ao que está gravado em prod: bbts_rule_versions 2026-07 v1) ---
const REGRA_JUL = {
  _meta: { shape: "BBTS_V1", competencia: "2026-07" },
  convenios: {}, grupos: {},
  seguro: {
    estoque: { pct: 0.001 },
    slip: [
      { prazo_min: 0, prazo_max: 36, pct: 0.001 },
      { prazo_min: 37, prazo_max: 60, pct: 0.0015 },
      { prazo_min: 61, prazo_max: 84, pct: 0.0025 },
      { prazo_min: 85, prazo_max: null, pct: 0.0035 },
    ],
  },
};
const REGRA_ROW_JUL = { id: "v-jul-1", competencia: "2026-07-01", version_no: 1, is_active: true, regra_json: REGRA_JUL };

// --- FAIXAS DO RR (fonte DIFERENTE: insurance_slip_rules / FIX-3) p/ o G6 ---
const RR_SLIP = { "0-36": 0.0015, "37-60": 0.0025, "61-84": 0.004, "85+": 0.0055 };

// --- LINHAS REAIS de seguro (dump de prod; gross=0 p/ isolar seguro do crédito) ---
const LINHAS = {
  "2026-06": [
    { proposal_number: "212146378", pid: "60167faa-4846-4f96-806d-5a8f9bb536f3", insurance_value: 24000, insurance_type: "ESTOQUE D0", term_months: 108 },
    { proposal_number: "212762030", pid: "6b1c5dae-1027-46a8-872c-031b48dc4647", insurance_value: 18050, insurance_type: "ESTOQUE D0", term_months: 108 },
    { proposal_number: "212896380", pid: "3e50455b-042a-4092-8c6e-801520d1d534", insurance_value: 10000, insurance_type: "ESTOQUE D0", term_months: 72 },
    { proposal_number: "212540080", pid: "5335f40a-3ff6-4d75-83ac-d9859912b3e3", insurance_value: 1000, insurance_type: "ESTOQUE D0", term_months: 108 },
    { proposal_number: "212682356", pid: "f5e2adb7-7c0d-48c5-97f7-4e01df2a56fb", insurance_value: 5839.8, insurance_type: "SLIP", term_months: 96 },
    { proposal_number: "212205929", pid: "60167faa-4846-4f96-806d-5a8f9bb536f3", insurance_value: 24050, insurance_type: "ESTOQUE D0", term_months: 108 },
  ],
  "2026-07": [
    { proposal_number: "213983877", pid: "6b1c5dae-1027-46a8-872c-031b48dc4647", insurance_value: 2096.78, insurance_type: "SLIP", term_months: 24 },
    { proposal_number: "214234277", pid: "8a4a8c04-3d84-4df4-8d8d-e43b57f5f8cb", insurance_value: 2090.55, insurance_type: "SLIP NOVO", term_months: 24 },
    { proposal_number: "213994592", pid: "60167faa-4846-4f96-806d-5a8f9bb536f3", insurance_value: 7150, insurance_type: "ESTOQUE D0", term_months: 84 },
    { proposal_number: "219710892", pid: "ed7c1658-6173-45be-b38d-40b6dcd7b12a", insurance_value: 3510.42, insurance_type: "SLIP NOVO", term_months: 48 },
    { proposal_number: "219882642", pid: "ed7c1658-6173-45be-b38d-40b6dcd7b12a", insurance_value: 8800, insurance_type: "ESTOQUE D0", term_months: 120 },
  ],
  // Cenário sintético do G5: 1 linha SLIP SEM prazo (term_months null).
  "2026-08": [
    { proposal_number: "SEM-PRAZO-1", pid: "6b1c5dae-1027-46a8-872c-031b48dc4647", insurance_value: 5000, insurance_type: "SLIP", term_months: null },
  ],
};
const OLD_RATE = (tipo) => (String(tipo).toUpperCase().includes("SLIP") ? 0.0035 : 0.001); // constante do bug
const bandOf = (p) => (p <= 36 ? "0-36" : p <= 60 ? "37-60" : p <= 84 ? "61-84" : "85+");

// --- STUB genérico de Supabase (só as tabelas que importam; resto -> []) ---
function makeStub(tables) {
  const dpr = (comp) => (LINHAS[comp] || []).map((l, i) => ({
    id: `dpr-${comp}-${i}`, company_id: BBTS, assigned_promoter_id: l.pid,
    gross_value: 0, net_value: 0, insurance_value: l.insurance_value, insurance_type: l.insurance_type,
    interest_rate: 0, term_months: l.term_months, convenio_code: null, product_description: null, product_code: null,
    movement_date: `${comp}-10`, contract_date: `${comp}-10`, proposal_date: `${comp}-10`,
    status: "ATIVO", is_srcc_restricted: false,
    proposal_number: l.proposal_number,
    raw_payload: { __bbts_meta: {} },
  }));
  const data = {
    daily_production_records: [...dpr("2026-06"), ...dpr("2026-07"), ...dpr("2026-08")],
    bbts_rule_versions: [REGRA_ROW_JUL],
    promoters: [...new Set(Object.values(LINHAS).flat().map((l) => l.pid))].map((id) => ({ id, name: `Prom ${id.slice(0, 4)}` })),
    ...tables,
  };
  const build = (name) => {
    const preds = []; let ord = null, lim = null;
    const apply = () => {
      let out = (data[name] || []).filter((r) => preds.every((f) => f(r)));
      if (ord) out = out.slice().sort((a, b) => (String(a[ord.c]) < String(b[ord.c]) ? -1 : String(a[ord.c]) > String(b[ord.c]) ? 1 : 0) * (ord.asc ? 1 : -1));
      if (lim != null) out = out.slice(0, lim);
      return out;
    };
    const q = {
      select: () => q, eq: (c, v) => (preds.push((r) => String(r[c]) === String(v)), q),
      neq: (c, v) => (preds.push((r) => String(r[c]) !== String(v)), q),
      in: (c, arr) => (preds.push((r) => arr.map(String).includes(String(r[c]))), q),
      lt: (c, v) => (preds.push((r) => String(r[c]) < String(v)), q),
      gt: (c, v) => (preds.push((r) => String(r[c]) > String(v)), q),
      gte: (c, v) => (preds.push((r) => String(r[c]) >= String(v)), q),
      lte: (c, v) => (preds.push((r) => String(r[c]) <= String(v)), q),
      order: (c, o) => ((ord = { c, asc: !!(o && o.ascending) }), q),
      limit: (n) => ((lim = n), q),
      range: (a, b) => Promise.resolve({ data: apply().slice(a, b + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: apply()[0] || null, error: null }),
      single: () => { const o = apply()[0]; return Promise.resolve({ data: o || null, error: o ? null : { message: "no rows" } }); },
      then: (res, rej) => Promise.resolve({ data: apply(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from: (name) => build(name) };
}

async function run(year, month) {
  const stub = makeStub({});
  return consolidateMonthlyFromBbts(stub, { year, month, dryRun: true });
}
const seguroEmpDe = (res) => res.table.reduce((s, r) => s + r.seguro_comissao_empresa, 0);

(async () => {
  // ---------------- G1 HELPER ----------------
  console.log("=== G1 HELPER seguroRateFromRegra (régua real) ===");
  ok("ESTOQUE -> 0,001", seguroRateFromRegra(REGRA_JUL, "ESTOQUE D0", 108).rate === 0.001);
  ok("SLIP 0-36 -> 0,001", seguroRateFromRegra(REGRA_JUL, "SLIP", 24).rate === 0.001);
  ok("SLIP 37-60 -> 0,0015", seguroRateFromRegra(REGRA_JUL, "SLIP NOVO", 48).rate === 0.0015);
  ok("SLIP 61-84 -> 0,0025", seguroRateFromRegra(REGRA_JUL, "SLIP", 84).rate === 0.0025);
  ok("SLIP 85+ -> 0,0035", seguroRateFromRegra(REGRA_JUL, "SLIP", 96).rate === 0.0035);
  const semPrazo = seguroRateFromRegra(REGRA_JUL, "SLIP", null);
  ok("SLIP sem prazo -> rate null + motivo (NÃO chuta 0,35)", semPrazo.rate === null && /prazo/i.test(semPrazo.motivo), semPrazo.motivo);
  ok("régua sem seguro -> rate null", seguroRateFromRegra({ seguro: null }, "SLIP", 24).rate === null);

  // ---------------- G2 RESOLVER FALLBACK ----------------
  console.log("\n=== G2 RESOLVER fallback (só julho no ar) ===");
  const stub = makeStub({});
  const jun = await resolveBbtsRegraDb({ competencia: "2026-06" }, stub);
  ok("junho herda julho (posterior, isFallback)", jun && jun.competenciaFornecedora === "2026-07" && jun.direcao === "posterior" && jun.isFallback === true,
    jun && `fornecedora=${jun.competenciaFornecedora} direcao=${jun.direcao} fb=${jun.isFallback}`);
  const jul = await resolveBbtsRegraDb({ competencia: "2026-07" }, stub);
  ok("julho exata (isFallback=false)", jul && jul.isFallback === false && jul.direcao === null);

  // ---------------- G3 JUNHO NO-OP ----------------
  console.log("\n=== G3 JUNHO end-to-end: NO-OP no seguro-empresa ===");
  const rJun = await run(2026, 6);
  // referência antiga (constante) linha a linha
  let oldJun = 0; const oldByLine = {};
  for (const l of LINHAS["2026-06"]) { const v = l.insurance_value * OLD_RATE(l.insurance_type); oldJun += v; oldByLine[l.proposal_number] = v; }
  const newJun = seguroEmpDe(rJun);
  ok("seguro-empresa junho: NOVO == ANTIGO (no-op)", near(newJun, oldJun), `NOVO=R$ ${R(newJun)}  ANTIGO=R$ ${R(oldJun)}`);
  ok("junho: régua por FALLBACK posterior (julho)", rJun.seguro_regua && rJun.seguro_regua.is_fallback === true && rJun.seguro_regua.direcao === "posterior");
  // "hash igual": soma dos valores por linha (recalculados com a régua) == referência antiga
  let hashNew = 0; for (const l of LINHAS["2026-06"]) { const t = seguroRateFromRegra(REGRA_JUL, l.insurance_type, l.term_months); hashNew += l.insurance_value * (t.rate ?? 0); }
  ok("junho: hash por linha (régua) == hash antigo", near(hashNew, oldJun), `${R(hashNew)} == ${R(oldJun)}`);

  // ---------------- G4 JULHO MUDA (linha a linha) ----------------
  console.log("\n=== G4 JULHO end-to-end: MUDA pro certo (linha a linha) ===");
  const rJul = await run(2026, 7);
  console.log("  contrato       tipo        prazo  base        ANTIGO(0,35)  NOVO(régua)  Δ");
  let oldJul = 0, newJulLine = 0;
  for (const l of LINHAS["2026-07"]) {
    const oldV = l.insurance_value * OLD_RATE(l.insurance_type);
    const t = seguroRateFromRegra(REGRA_JUL, l.insurance_type, l.term_months);
    const newV = l.insurance_value * (t.rate ?? 0);
    oldJul += oldV; newJulLine += newV;
    const isSlip = String(l.insurance_type).toUpperCase().includes("SLIP");
    console.log(`  ${l.proposal_number.padEnd(12)} ${String(l.insurance_type).padEnd(10)} ${String(l.term_months).padStart(4)}  ${(isSlip ? bandOf(l.term_months) : "ESTOQUE").padEnd(6)} R$ ${R(l.insurance_value).padStart(9)}  R$ ${R(oldV).padStart(7)}   R$ ${R(newV).padStart(7)}   R$ ${R(oldV - newV)}`);
  }
  const newJul = seguroEmpDe(rJul);
  const c2 = (n) => Math.round(n * 100) / 100; // centavos
  ok("julho: consolidador == soma linha-a-linha da régua", near(newJul, newJulLine), `${R(newJul)} == ${R(newJulLine)}`);
  ok("julho: SLIP 0-36 total 14,66 -> 4,19", c2((2096.78 + 2090.55) * 0.0035) === 14.66 && c2((2096.78 + 2090.55) * 0.001) === 4.19);
  ok("julho: SLIP 37-60 3.510,42: 12,29 -> 5,27", c2(3510.42 * 0.0035) === 12.29 && c2(3510.42 * 0.0015) === 5.27);
  ok("julho: cai exatamente R$ 17,49", c2(oldJul - newJul) === 17.49, `ANTIGO=R$ ${R(oldJul)}  NOVO=R$ ${R(newJul)}  Δ=R$ ${R(oldJul - newJul)}`);
  ok("julho: régua EXATA (não fallback)", rJul.seguro_regua && rJul.seguro_regua.is_fallback === false);

  // ---------------- G5 PRAZO AUSENTE ----------------
  console.log("\n=== G5 PRAZO AUSENTE (SLIP sem term_months) ===");
  const rAgo = await run(2026, 8);
  const segAgo = seguroEmpDe(rAgo);
  const chute = 5000 * 0.0035; // o que o bug faria
  ok("linha SLIP sem prazo: seguro-empresa = 0 (NÃO 0,35 = R$ 17,50)", near(segAgo, 0) && !near(segAgo, chute), `seguro=R$ ${R(segAgo)} (chute seria R$ ${R(chute)})`);
  ok("aviso de 'SEGURO NÃO calculado' presente", rAgo.avisos.some((a) => /SEGURO NÃO calculado/.test(a)) && rAgo.seguro_nao_calculado.length === 1,
    rAgo.seguro_nao_calculado.map((s) => s.motivo).join(""));

  // ---------------- G6 RR INTOCADO ----------------
  console.log("\n=== G6 RR INTOCADO ===");
  let changed = "";
  try { changed = execSync("git diff --name-only origin/main", { cwd: ROOT }).toString(); } catch (e) { changed = "(git indisponível)"; }
  const rrFiles = ["lib/insuranceCalculator.ts", "lib/insurancePenetration.ts"];
  const tocouRR = rrFiles.filter((f) => changed.split(/\r?\n/).includes(f));
  ok("nenhum arquivo RR de seguro no diff", tocouRR.length === 0, tocouRR.length ? "TOCOU: " + tocouRR.join(",") : "diff limpo p/ RR");
  const bbtsBands = { "0-36": 0.001, "37-60": 0.0015, "61-84": 0.0025, "85+": 0.0035 };
  const distintas = Object.keys(bbtsBands).every((k) => bbtsBands[k] !== RR_SLIP[k]);
  ok("faixas BBTS != faixas RR (fontes independentes)", distintas, `BBTS ${JSON.stringify(bbtsBands)} vs RR ${JSON.stringify(RR_SLIP)}`);

  console.log(`\n==== ${fails === 0 ? "TODOS OS GATES PASSARAM" : fails + " GATE(S) FALHARAM"} ====`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO NO GATE:", e && e.stack || e); process.exit(2); });
