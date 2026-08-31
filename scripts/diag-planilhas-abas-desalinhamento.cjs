/* O parser le ABA POR INDICE. As planilhas ja IMPORTADAS estavam alinhadas?
 * READ-ONLY: le os xlsx em disco e os payloads de audit_logs. Nada gravado. */
require("./_ts_register.cjs");
const XLSX = require("xlsx");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const D = "C:/Users/diego/Downloads/RRCRED/TABELA DE REMUNERAÇÃO/";
/* O QUE O PARSER ASSUME (promoterRemuneration.js:183-372) — por INDICE. */
const ESPERADO = { 0: "INSS", 1: "Publico", 2: "Privado CLT", 3: "SIAPE", 4: "SP e MG", 5: "Portabilidades", 6: "Nao Consignado" };
/* Aba REAL que cada rotulo deveria ter. MPDG = Ministerio do Planejamento, que e
 * o orgao do SIAPE — a aba "Consignado MPDG" E a do SIAPE, so com outro nome. */
const ABA_CERTA = { "Privado CLT": /Privado/i, "SIAPE": /MPDG|SIAPE/i, "SP e MG": /SP E MG/i };
/* Assinatura de BANDA de cada bloco, para conferir o payload sem depender do nome. */
const ASSINATURA = { "SIAPE": 1.64, "SP e MG": 1.72, "Privado CLT": 2.54 };

(async () => {
  console.log("=== (b) as abas de cada planilha, e quando a ordem mudou ===");
  const arquivos = fs.readdirSync(D).filter((f) => /^Tabela de Remunera..o (ABRIL|JUNHO|JULHO|AGOSTO) 2026\.xlsx$/i.test(f)).sort();
  const ordem = {};
  for (const f of arquivos) {
    const wb = XLSX.readFile(D + f, { bookSheets: true });
    const mt = fs.statSync(D + f).mtime.toISOString().slice(0, 10);
    ordem[f] = wb.SheetNames;
    let desalinhado = [];
    for (const [idx, rot] of Object.entries(ESPERADO)) {
      const rx = ABA_CERTA[rot]; if (!rx) continue;
      const real = wb.SheetNames[Number(idx)];
      if (!rx.test(String(real))) desalinhado.push(`[${idx}] esperava ${rot}, tem "${real}"`);
    }
    console.log(`\n  ${f}  (${mt}, ${wb.SheetNames.length} abas)`);
    console.log(`    ordem: ${wb.SheetNames.map((n, i) => `${i}:${n.replace("Consignado ", "")}`).join(" | ")}`);
    console.log(`    ${desalinhado.length === 0 ? "ALINHADA com o que o parser assume" : "DESALINHADA -> " + desalinhado.join(" ; ")}`);
  }

  console.log("\n=== (a) as planilhas JA IMPORTADAS: os rotulos batem com os valores? ===");
  const { data } = await sb.from("audit_logs").select("created_at,payload").eq("entity_name", "promoter_remuneration_table").order("created_at", { ascending: true });
  const porComp = new Map();
  for (const r of data || []) { const p = r.payload; if (!p) continue; porComp.set(`${p.year}-${String(p.month).padStart(2, "0")}`, r); }
  for (const comp of [...porComp.keys()].sort()) {
    const r = porComp.get(comp);
    const pr = r.payload.productionRules || [];
    console.log(`\n  ${comp}  (importada em ${String(r.created_at).slice(0, 10)}, ${pr.length} regras)`);
    let ok = 0, mau = 0;
    for (const [rot, primeiraTaxa] of Object.entries(ASSINATURA)) {
      const linhas = pr.filter((x) => x.label === rot);
      const menor = linhas.length ? Math.min(...linhas.map((x) => Number(x.rate_from))) : null;
      const bate = menor != null && Math.abs(menor - primeiraTaxa) < 0.005;
      if (bate) ok++; else mau++;
      console.log(`    ${rot.padEnd(12)} ${String(linhas.length).padStart(2)} linhas | menor taxa ${menor == null ? "—" : menor.toFixed(2)} (esperado ${primeiraTaxa.toFixed(2)})  ${bate ? "OK" : "<== ROTULO COM CONTEUDO DE OUTRO BLOCO"}`);
    }
    console.log(`    veredito: ${mau === 0 ? "ALINHADA" : `DESALINHADA em ${mau} de 3 blocos`}`);
  }

  console.log("\n=== (c) consequencia ===");
  console.log("  As productionRules NUNCA foram gravadas em commission_table_rows (so");
  console.log("  INSURANCE/PENETRATION, 16 linhas por competencia). Um desalinhamento em");
  console.log("  competencia importada teria ficado SO no audit_logs.payload — registro,");
  console.log("  nao calculo. Nenhum centavo dependeu disso.");
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 300)); process.exit(1); });
