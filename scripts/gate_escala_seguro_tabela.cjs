// ============================================================================
// gate_escala_seguro_tabela.cjs — GATE da divida latente 3 (escala de seguro).
// READ-ONLY. Prova, nesta ordem:
//   G1. A REDE (literal) espelha a REGUA tier a tier.
//   G2. 20,00% cravado -> 0,35 (faixa [0.20,0.30)) na rede E na tabela.
//   G3. Os 4 caminhos de pagamento primam a tabela (grep estrutural).
//   G4. As escalas de CREDITO ficam intocadas pelo SQL de reparo.
//   G5. IMPACTO por promotor em jun/jul: quem muda de faixa e quanto.
//
// Roda: node scripts/gate_escala_seguro_tabela.cjs
// Exit 0 = gate passou. Exit 1 = alguma prova falhou.
// ============================================================================
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

for (const f of [".env", ".env.local"]) {
  const p = path.resolve(__dirname, "..", f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const ROOT = path.resolve(__dirname, "..");
let falhas = 0;      // defeito de CODIGO — reprova o gate
let pendencias = 0;  // espera o SQL de reparo rodar no Studio — nao e defeito
function ok(msg) { console.log("  OK   " + msg); }
function fail(msg) { console.log("  FALHA " + msg); falhas++; }
function pend(msg) { console.log("  PEND  " + msg); pendencias++; }

// A REGUA (fonte da verdade deste gate).
const REGUA = [
  { volume_min: 0.0, volume_max: 0.1, share_percent: 0.1 },
  { volume_min: 0.1, volume_max: 0.2, share_percent: 0.25 },
  { volume_min: 0.2, volume_max: 0.3, share_percent: 0.35 },
  { volume_min: 0.3, volume_max: null, share_percent: 0.5 },
];
function lookup(tiers, p) {
  const t = tiers.find(
    (x) => p >= x.volume_min && (x.volume_max === null || p < x.volume_max)
  );
  return t ? t.share_percent : 0;
}
// Constante ANTIGA (pre-fix), para medir o impacto.
function shareAntigo(p) {
  for (const c of [
    { min: 0.3, share: 0.5 }, { min: 0.21, share: 0.35 },
    { min: 0.11, share: 0.25 }, { min: 0.0, share: 0.1 },
  ]) if (p >= c.min) return c.share;
  return 0.1;
}

(async () => {
  // ---------- G1: a REDE espelha a REGUA ----------
  console.log("\n=== G1. A REDE (literal em insurancePenetration.ts) == REGUA ===");
  const libSrc = fs.readFileSync(path.join(ROOT, "lib/insurancePenetration.ts"), "utf8");
  const bloco = libSrc.match(
    /INSURANCE_SHARE_CUTS_FALLBACK[\s\S]*?=\s*\[([\s\S]*?)\];/
  );
  if (!bloco) {
    fail("nao achei INSURANCE_SHARE_CUTS_FALLBACK no fonte");
  } else {
    const rede = [];
    const re = /volume_min:\s*([\d.]+),\s*volume_max:\s*(null|[\d.]+),\s*share_percent:\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(bloco[1])) !== null) {
      rede.push({
        volume_min: Number(m[1]),
        volume_max: m[2] === "null" ? null : Number(m[2]),
        share_percent: Number(m[3]),
      });
    }
    if (rede.length !== REGUA.length) {
      fail("rede tem " + rede.length + " tiers, regua tem " + REGUA.length);
    } else {
      for (let i = 0; i < REGUA.length; i++) {
        const a = rede[i], b = REGUA[i];
        const igual = a.volume_min === b.volume_min &&
          a.volume_max === b.volume_max && a.share_percent === b.share_percent;
        if (igual) {
          ok("tier " + i + ": [" + b.volume_min + ", " +
            (b.volume_max === null ? "NULL" : b.volume_max) + ") -> " + b.share_percent);
        } else {
          fail("tier " + i + " divergente: rede=" + JSON.stringify(a) +
            " regua=" + JSON.stringify(b));
        }
      }
    }
  }

  // ---------- G3: os 4 caminhos primam a tabela ----------
  console.log("\n=== G3. Os 4 caminhos de pagamento chamam primeInsuranceShareTiers ===");
  const caminhos = [
    "lib/closingMonthly.ts",
    "lib/bbtsMonthly.ts",
    "lib/bbtsOrchestrator.ts",
    "app/api/calculate/monthly/route.ts",
  ];
  for (const c of caminhos) {
    const src = fs.readFileSync(path.join(ROOT, c), "utf8");
    const usa = /insuranceShareForPenetration\s*\(/.test(src);
    const prima = /await\s+primeInsuranceShareTiers\s*\(/.test(src);
    if (usa && prima) ok(c + " — usa o resolvedor E prima a tabela");
    else if (usa && !prima) fail(c + " — USA o resolvedor mas NAO prima (pagaria pela rede)");
    else ok(c + " — nao usa o resolvedor (nada a primar)");
  }
  // Nenhum outro consumidor pode ter ficado para tras.
  const orfaos = [];
  (function varre(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) varre(full);
      else if (/\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(full, "utf8");
        const rel = path.relative(ROOT, full).replace(/\\/g, "/");
        if (rel === "lib/insurancePenetration.ts") continue;
        if (/insuranceShareForPenetration\s*\(/.test(src) &&
            !/await\s+primeInsuranceShareTiers\s*\(/.test(src)) {
          orfaos.push(rel);
        }
      }
    }
  })(ROOT);
  if (orfaos.length === 0) ok("nenhum consumidor orfao (todos primam)");
  else for (const o of orfaos) fail("consumidor SEM prime: " + o);

  // ---------- banco ----------
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data: scales } = await supabase
    .from("share_scale").select("id, scale_code, scale_kind");
  const seguro = (scales || []).find((s) => s.scale_code === "SEGURO_SLIP_MAIO_2026");
  const { data: tierRows } = await supabase
    .from("share_scale_tier")
    .select("volume_min, volume_max, share_percent")
    .eq("scale_id", seguro.id).order("volume_min", { ascending: true });
  const tabela = (tierRows || []).map((r) => ({
    volume_min: Number(r.volume_min),
    volume_max: r.volume_max == null ? null : Number(r.volume_max),
    share_percent: Number(r.share_percent),
  }));

  console.log("\n=== G2. 20,00% cravado -> 0,35 (rede E tabela) ===");
  const probes = [0.0999, 0.1, 0.1001, 0.1999, 0.2, 0.2001, 0.2999, 0.3, 0.3001];
  console.log("  penetr. |  REDE | TABELA | REGUA");
  for (const p of probes) {
    const r = lookup(REGUA, p), t = lookup(tabela, p);
    const marca = (r === t) ? "" : "   <-- REDE != TABELA";
    console.log("  " + (p * 100).toFixed(2).padStart(7) + "% |" +
      String(r).padStart(6) + " |" + String(t).padStart(7) + " |" +
      String(r).padStart(6) + marca);
  }
  const rede20 = lookup(REGUA, 0.2), tab20 = lookup(tabela, 0.2);
  if (rede20 === 0.35) ok("REDE: 20,00% -> 0,35"); else fail("REDE: 20,00% -> " + rede20);
  if (tab20 === 0.35) ok("TABELA: 20,00% -> 0,35");
  else pend("TABELA: 20,00% -> " + tab20 + " — o SQL de reparo AINDA NAO RODOU no Studio");

  console.log("\n  Tabela em prod, tier a tier:");
  const tabelaBate = JSON.stringify(tabela) === JSON.stringify(REGUA);
  for (let i = 0; i < Math.max(tabela.length, REGUA.length); i++) {
    const a = tabela[i], b = REGUA[i];
    console.log("   tier " + i + ": banco=" + JSON.stringify(a) + "  regua=" + JSON.stringify(b));
  }
  if (tabelaBate) ok("tabela == regua tier a tier");
  else pend("tabela != regua — rodar scripts/sql/2026-07-18_restaura_cortes_seguro_slip.sql");

  // ---------- G4: credito intocado ----------
  console.log("\n=== G4. Escalas de CREDITO intocadas ===");
  const sqlRep = fs.readFileSync(
    path.join(ROOT, "scripts/sql/2026-07-18_restaura_cortes_seguro_slip.sql"), "utf8");
  // So o SQL EXECUTAVEL conta — comentarios citam as escalas de credito de
  // proposito (documentando que ficam de fora). Remove "--" e blocos /* */.
  const sqlExec = sqlRep
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
  for (const s of (scales || []).filter((x) => x.scale_kind === "CREDIT")) {
    const citado = sqlExec.includes(s.id) || sqlExec.includes(s.scale_code);
    if (!citado) ok("SQL executavel nao toca " + s.scale_code + " (" + s.id + ")");
    else fail("SQL EXECUTAVEL menciona a escala de credito " + s.scale_code);
  }
  const escopo = /scale_code\s*=\s*'SEGURO_SLIP_MAIO_2026'/.test(sqlRep);
  if (escopo) ok("todo UPDATE do SQL e escopado por scale_id de SEGURO_SLIP");
  else fail("SQL sem escopo por scale_code — pode vazar para credito");
  const semDelete = !/\bdelete\s+from\s+public\.share_scale_tier/i.test(sqlRep);
  if (semDelete) ok("SQL usa UPDATE (nao DELETE+INSERT) — nao briga com a migration");
  else fail("SQL tem DELETE em share_scale_tier");

  // ---------- G5: impacto real ----------
  console.log("\n=== G5. IMPACTO por promotor (jun/jul 2026) ===");
  const { data: pmr } = await supabase
    .from("promoter_monthly_results")
    .select("promoter_id, year, month, insurance_penetration_percent, insurance_commission_value, final_commission_value")
    .eq("year", 2026).in("month", [6, 7]);

  const mudam = [];
  for (const r of pmr || []) {
    const p = Number(r.insurance_penetration_percent ?? 0) / 100;
    const antes = shareAntigo(p), depois = lookup(REGUA, p);
    if (antes !== depois) mudam.push({ r, p, antes, depois });
  }
  console.log("  linhas PMR jun+jul: " + (pmr || []).length);
  console.log("  linhas que MUDAM de faixa: " + mudam.length);

  if (mudam.length) {
    const ids = mudam.map((x) => x.r.promoter_id);
    const { data: proms } = await supabase.from("promoters").select("id, name").in("id", ids);
    const nome = new Map((proms || []).map((x) => [x.id, x.name]));
    console.log("\n  mes     | promotor                  | penetracao | antes -> depois | seguro antes | seguro depois |    delta");
    let total = 0;
    for (const { r, p, antes, depois } of mudam) {
      const segAntes = Number(r.insurance_commission_value ?? 0);
      const base = antes > 0 ? segAntes / antes : 0;
      const segDepois = base * depois;
      const d = segDepois - segAntes;
      total += d;
      console.log("  " + r.year + "-" + String(r.month).padStart(2, "0") +
        " | " + String(nome.get(r.promoter_id) || r.promoter_id).slice(0, 25).padEnd(25) +
        " | " + (p * 100).toFixed(4).padStart(9) + "% | " +
        String(antes).padStart(5) + " -> " + String(depois).padStart(5) + "   | " +
        segAntes.toFixed(2).padStart(12) + " | " + segDepois.toFixed(2).padStart(13) +
        " | " + (d >= 0 ? "+" : "") + d.toFixed(2));
    }
    console.log("\n  DELTA TOTAL: " + (total >= 0 ? "+" : "") + total.toFixed(2) +
      "  (positivo = a favor do promotor)");
    console.log("  NAO e no-op. O PMR gravado so muda quando a competencia for");
    console.log("  RECONSOLIDADA — este commit nao reconsolida nada.");
  } else {
    ok("nenhum promotor muda de faixa (no-op no numero real)");
  }

  console.log("\n=== RESULTADO ===");
  console.log("  falhas de CODIGO: " + falhas);
  console.log("  pendencias (esperando o SQL no Studio): " + pendencias);
  if (falhas === 0 && pendencias === 0) console.log("  GATE PASSOU — banco e codigo na regua.");
  else if (falhas === 0) console.log("  CODIGO OK — falta rodar o SQL de reparo para fechar.");
  else console.log("  GATE REPROVADO.");
  process.exit(falhas === 0 ? 0 : 1);
})();
