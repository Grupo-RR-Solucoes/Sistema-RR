/* O DRE para 2026-05 e 2026-06, pela funcao REAL. READ-ONLY. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
(async () => {
  const { buildDre } = require("@/lib/dre.ts");
  for (const [y, m] of [[2026, 5], [2026, 6]]) {
    console.log("\n" + "=".repeat(72));
    console.log(`DRE ${y}-${String(m).padStart(2, "0")}`);
    console.log("=".repeat(72));
    // POSICIONAL, nao objeto: buildDre(supabase, year, month). Passar {year,month}
    // faz `year && month` dar falso e cair no periods[0] — o mes fechado MAIS
    // RECENTE. Foi o que aconteceu na 1a medicao: maio e junho vieram identicos,
    // os dois com os 19.048,86 de JULHO.
    const d = await buildDre(sb, y, m);
    console.log(`  closed=${d.closed} | periodo devolvido: ${d.period ? d.period.key : "null"}`);
    console.log(`  GRUPO: ${JSON.stringify(d.group)}`.slice(0, 600));
    for (const c of d.companies || []) {
      const ehAds = String(c.company_id || c.id) === ADS;
      console.log(`  ${ehAds ? ">>> ADS" : "    "} ${String(c.name || c.company_name).padEnd(26)} ${JSON.stringify(c).slice(0, 320)}`);
    }
    if (d.alerts && d.alerts.length) for (const a of d.alerts) console.log(`  ALERTA: ${String(a).slice(0, 160)}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
