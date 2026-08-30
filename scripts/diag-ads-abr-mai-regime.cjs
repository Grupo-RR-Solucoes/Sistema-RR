/* FASE A p3 (parte 2) — o REGIME canonico de abril e maio, e o que a
 * reconsolidacao (chamada pela rota logo apos gravar) faria. dryRun=true:
 * calcula e devolve o plano SEM gravar e SEM apagar (contrato da funcao). */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { detectMonthRegime } = require("@/lib/cmsMonthly.ts");
  const { reconsolidarCompetenciaFechada } = require("@/lib/reconsolidarCompetencia.ts");
  for (const [y, m] of [[2026,4],[2026,5],[2026,6],[2026,7]]) {
    const reg = await detectMonthRegime(sb, y, m);
    console.log(`\n=== ${y}-${String(m).padStart(2,"0")} regime canonico: ${JSON.stringify(reg)}`);
    try {
      const plano = await reconsolidarCompetenciaFechada(sb, { year: y, month: m, dryRun: true });
      console.log(`    reconsolidacao (dryRun): ${JSON.stringify(plano).slice(0, 400)}`);
    } catch (e) { console.log(`    reconsolidacao LANCOU: ${e.message.slice(0, 200)}`); }
  }

  // intersecao seguro x credito em abril e maio (quem vira linha SO-SEGURO)
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const nums = async (arq, rx) => new Set((await extractLinesFromPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/" + arq)))).filter(l => rx.test(l)).map(l => l.match(/^(\d{6,9})/)?.[1]).filter(Boolean));
  for (const [rot, cred, seg] of [["ABRIL","ADS Abril 2026.pdf","Seguro ADS Abril 2026.pdf"],["MAIO","ADS Maio 2026.pdf","Seguro ADs Maio 2026.pdf"]]) {
    const c = await nums(cred, /^\d{6,}\s+R\$/), s = await nums(seg, /^\d{6,9}\s+R\$/);
    const soSeguro = [...s].filter(x => !c.has(x));
    console.log(`\n=== ${rot}: credito=${c.size} seguro=${s.size} | seguro SEM credito no mes (viram linha SO-SEGURO na chave MASTER): ${soSeguro.length} -> ${soSeguro.join(", ") || "-"}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
