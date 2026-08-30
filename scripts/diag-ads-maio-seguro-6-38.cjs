/* O seguro que FICA DE FORA com a exclusao da 212021557, e a prova de que a
 * passada 2 nao escreveu nada. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
(async () => {
  const { extractBbtsSeguroPdf } = require("@/lib/bbtsPdfExtract.ts");
  const s = await extractBbtsSeguroPdf(new Uint8Array(fs.readFileSync("C:/Users/diego/Downloads/Seguro ADs Maio 2026.pdf")));
  console.log("As 6 linhas do seguro de MAIO:");
  let soma = 0;
  for (const r of s.rows) { soma += r.valor_seguro; console.log(`  ${r.contrato}  ${r.valor_seguro.toFixed(2).padStart(7)}  base ${r.valor_total_credito}`); }
  console.log(`  TOTAL ${soma.toFixed(2)} (ancora do PDF ${s.totalAnchor})`);
  const fora = s.rows.find(r => r.contrato === "212021557");
  console.log(`\n  A EXCLUIDA 212021557 carrega R$ ${fora ? fora.valor_seguro.toFixed(2) : "?"} de comissao de seguro.`);
  console.log(`  Gravado no diario: ${(soma - (fora ? fora.valor_seguro : 0)).toFixed(2)} | FICA DE FORA: ${fora ? fora.valor_seguro.toFixed(2) : "0"}`);

  console.log("\n=== PROVA de que o dry-run NAO escreveu ===");
  for (const [ini, fim, rot] of [["2026-05-01","2026-05-31","MAIO"],["2026-06-01","2026-06-30","junho"]]) {
    const { count } = await sb.from("daily_production_records").select("id", { count: "exact", head: true }).eq("company_id", ADS).gte("movement_date", ini).lte("movement_date", fim);
    console.log(`  daily da ADS em ${rot}: ${count} linha(s)`);
  }
  const { data: tot } = await sb.from("bbts_fechamento_totais").select("competencia").order("competencia");
  console.log(`  bbts_fechamento_totais: ${(tot||[]).map(r=>r.competencia).join(", ")}`);
  const { data: prt } = await sb.from("bbts_prt_parcelas").select("competencia");
  const porc = {}; for (const r of prt||[]) porc[r.competencia]=(porc[r.competencia]||0)+1;
  console.log(`  bbts_prt_parcelas: ${JSON.stringify(porc)}`);
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
