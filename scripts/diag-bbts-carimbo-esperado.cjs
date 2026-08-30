/* Confere, ANTES de rodar a migration, quais numeros a verificacao dela deve
 * devolver. Reproduz em leitura o que os backfills (2) e (3) vao gravar.
 * READ-ONLY, nada e escrito. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ALVO = "5240028e-464b-428a-870d-86576c31dfc6";

(async () => {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("daily_production_records")
      .select("id, company_id, bbts_pag_avista, bbts_seguro_pago, movement_date")
      .or("bbts_pag_avista.neq.0,bbts_seguro_pago.neq.0")
      .range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const comValor = all.filter((r) => (Number(r.bbts_pag_avista) || 0) !== 0 || (Number(r.bbts_seguro_pago) || 0) !== 0);
  console.log("linhas com valor de fechamento em TODO o banco:", comValor.length);
  const empresas = new Map();
  for (const r of comValor) empresas.set(r.company_id, (empresas.get(r.company_id) || 0) + 1);
  console.log("por empresa:");
  for (const [k, v] of empresas) console.log(`  ${k}: ${v}`);

  // o que o backfill (2) alcanca
  const dia15 = comValor.filter((r) => /^\d{4}-\d{2}-15$/.test(String(r.movement_date || "").slice(0, 10)));
  const semCarimbo = comValor.filter((r) => !/^\d{4}-\d{2}-15$/.test(String(r.movement_date || "").slice(0, 10)));
  console.log(`\nbackfill (2) — movement_date dia 15: alcanca ${dia15.length} linha(s)`);
  console.log(`sobram sem carimbo: ${semCarimbo.length}`);
  for (const r of semCarimbo) console.log(`  ${String(r.id).slice(0, 8)}  mov=${r.movement_date}  avista=${r.bbts_pag_avista}  seguro=${r.bbts_seguro_pago}  ${r.id === ALVO ? "<- alvo do backfill (3)" : "<<< NAO COBERTO — o CHECK vai reprovar"}`);

  // o resultado esperado da verificacao (b)
  const porComp = new Map();
  for (const r of comValor) {
    const d = String(r.movement_date || "").slice(0, 10);
    const k = /^\d{4}-\d{2}-15$/.test(d) ? d.slice(0, 7) + "-01" : (r.id === ALVO ? "2026-07-01" : null);
    if (!k) continue;
    const a = porComp.get(k) || { n: 0, avt: 0, seg: 0 };
    a.n++; a.avt += Number(r.bbts_pag_avista) || 0; a.seg += Number(r.bbts_seguro_pago) || 0;
    porComp.set(k, a);
  }
  console.log("\nRESULTADO ESPERADO da verificacao (b) da migration:");
  console.log("  comp        | linhas | avt           | seguro");
  for (const [k, a] of [...porComp].sort())
    console.log(`  ${k}  | ${String(a.n).padStart(6)} | ${f(a.avt).padStart(13)} | ${f(a.seg).padStart(9)}`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
