/*
 * GATE brechas #12/#13 — truncamento RR+ADS em projecao/metas + Caixa somando
 * daily. READ-ONLY, nao grava. Autossuficiente (nao precisa checkout do main):
 *
 * (#12a) loadPromoterAnalyticsBase junho SEM vs COM closedSource — o flip que o
 *        fix da projecao faz. Prova que os 4 duais deixam de truncar e passam a
 *        somar RR+ADS; e que em abril o unico delta e CHAVE MASTER (correcao,
 *        alinha com /promotores/DRE), nunca um promotor real.
 * (#12b) /api/metas junho ANTES (Map-overwrite) vs DEPOIS (soma) — faixa/repasse.
 * (#13)  nenhuma competencia fechada tem source='daily' (SELECT) e o payable so
 *        muda no mes ABERTO (nao exibido em competencia fechada). No-op hoje.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const { loadPromoterAnalyticsBase } = require(path.join(__dirname, "..", "lib", "promoterAnalytics.ts"));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const DUAIS = ["camila gomes", "maria leticia", "fabiana bezerra", "ketley", "kétley"];
let falhas = 0;
const check = (nome, ok) => { if (!ok) falhas++; console.log(`  ${ok ? "OK " : "XX "} ${nome}`); };
function faixaAtingida(p, b1, b2) { if (b2 > 0 && p >= b2) return "META2"; if (b1 > 0 && p >= b1) return "META1"; return "BASE"; }

(async () => {
  // ---------- #12a: projecao (loadPromoterAnalyticsBase) SEM vs COM closedSource ----------
  console.log("=== #12a projecao: SEM closedSource (main) vs COM (fix) ===");
  const rows = (b) => new Map(b.filteredSummaryRows.filter(r => r.active).map(r => [r.promoter_id, r]));
  for (const [y, m, src, esperado] of [[2026, 6, "fechamento", { "camila gomes": 146631.08, "maria leticia": 123792.69, "fabiana bezerra": 92000, "ketley": 22912.44 }], [2026, 4, "fechamento", null]]) {
    const sem = rows(await loadPromoterAnalyticsBase(sb, { year: y, month: m }));
    const com = rows(await loadPromoterAnalyticsBase(sb, { year: y, month: m, closed: true, closedSource: src }));
    const difs = [];
    for (const id of new Set([...sem.keys(), ...com.keys()])) {
      const a = +(sem.get(id)?.production_value || 0), b = +(com.get(id)?.production_value || 0);
      if (Math.abs(a - b) > 0.01) difs.push({ nome: (sem.get(id) || com.get(id)).promoter_name, a, b });
    }
    console.log(`\n  ${y}-${String(m).padStart(2, "0")}: ${difs.length} promotor(es) com producao diferente`);
    for (const d of difs.sort((x, y) => (y.b - y.a) - (x.b - x.a))) {
      const master = /CHAVE MASTER/i.test(d.nome);
      console.log(`    ${d.nome.slice(0, 40).padEnd(40)} main=${brl(d.a).padStart(12)} fix=${brl(d.b).padStart(12)} ${master ? "(CHAVE MASTER - correcao)" : ""}`);
    }
    if (esperado) {
      const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      for (const [chave, val] of Object.entries(esperado)) {
        const row = [...com.values()].find(r => norm(r.promoter_name).includes(chave));
        check(`${chave} soma RR+ADS = ${brl(val)}`, row && Math.abs(+row.production_value - val) < 0.01);
      }
    } else {
      // abril: TODO delta tem que ser CHAVE MASTER (nenhum promotor real muda)
      check("abril: todo delta e CHAVE MASTER (nenhum promotor real muda)", difs.every(d => /CHAVE MASTER/i.test(d.nome)));
    }
  }

  // ---------- #12b: /api/metas junho ANTES vs DEPOIS ----------
  console.log("\n=== #12b /api/metas junho: faixa/repasse dos 4 duais ===");
  const y = 2026, m = 6;
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map(proms.map(p => [p.id, p.name]));
  const { data: targets } = await sb.from("monthly_targets").select("promoter_id, meta_1, meta_2").eq("year", y).eq("month", m);
  const { data: pmr } = await sb.from("promoter_monthly_results").select("promoter_id, production_value").eq("year", y).eq("month", m).in("source", ["fechamento", "bbts"]);
  const oldT = new Map(targets.map(t => [t.promoter_id, t])), oldR = new Map(pmr.map(r => [r.promoter_id, r]));
  const newT = new Map(), newR = new Map();
  for (const t of targets) { const c = newT.get(t.promoter_id) || { meta_1: 0, meta_2: 0 }; c.meta_1 += +t.meta_1 || 0; c.meta_2 += +t.meta_2 || 0; newT.set(t.promoter_id, c); }
  for (const r of pmr) { const c = newR.get(r.promoter_id) || { production_value: 0 }; c.production_value += +r.production_value || 0; newR.set(r.promoter_id, c); }
  for (const id of [...new Set(pmr.map(r => r.promoter_id))].filter(i => DUAIS.some(d => (nome.get(i) || "").toLowerCase().includes(d)))) {
    const oT = oldT.get(id) || {}, nT = newT.get(id) || { meta_1: 0, meta_2: 0 };
    const oFa = faixaAtingida(+(oldR.get(id)?.production_value || 0), +oT.meta_1 || 0, +oT.meta_2 || 0);
    const nFa = faixaAtingida(newR.get(id).production_value, nT.meta_1, nT.meta_2);
    console.log(`  ${(nome.get(id) || "").padEnd(24)} prod ${brl(+(oldR.get(id)?.production_value || 0))} -> ${brl(newR.get(id).production_value)} | faixa ${oFa}${oFa !== nFa ? " -> " + nFa + " (REPASSE MUDA)" : " (igual)"}`);
  }

  // ---------- #13: Caixa ----------
  console.log("\n=== #13 Caixa: fechada com daily? + payable no-op ===");
  const { data: all } = await sb.from("promoter_monthly_results").select("year, month, source, final_commission_value");
  const comp = {};
  for (const r of all) { const k = `${r.year}-${String(r.month).padStart(2, "0")}`; (comp[k] = comp[k] || new Set()).add(r.source); }
  const FECH = new Set(["fechamento", "bbts", "cms"]);
  const fechadaComDaily = Object.values(comp).some(s => [...s].some(x => FECH.has(x)) && s.has("daily"));
  check("nenhuma competencia fechada tem source='daily'", !fechadaComDaily);
  const withD = {}, without = {};
  for (const r of all) { const k = `${r.year}-${String(r.month).padStart(2, "0")}`; withD[k] = (withD[k] || 0) + (+r.final_commission_value || 0); if (r.source !== "daily") without[k] = (without[k] || 0) + (+r.final_commission_value || 0); }
  const mudam = Object.keys(withD).filter(k => Math.round((withD[k] - (without[k] || 0)) * 100) / 100 !== 0);
  for (const k of mudam) console.log(`    payable ${k}: com daily ${brl(withD[k])} -> sem ${brl(without[k] || 0)} (competencia ABERTA; exibida so ao selecionar o mes seguinte)`);
  check("payable muda SO em competencia de source=daily (mes aberto)", mudam.every(k => comp[k] && comp[k].has("daily") && ![...comp[k]].some(x => FECH.has(x))));

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas})`));
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
