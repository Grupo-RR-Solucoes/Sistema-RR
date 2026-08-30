/* A RECUSA 409, com os PDFs REAIS e o banco REAL. READ-ONLY: chama so a guarda
 * (select) e o formatador do texto — NAO chama importBbtsClosing, NAO grava. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DL = "C:/Users/diego/Downloads";

(async () => {
  const { extractBbtsClosingFromPdfs } = require("@/lib/bbtsPdfExtract.ts");
  const { BBTS_COMPANY_ID } = require("@/lib/bbtsClosingImport.ts");
  const { propostasAlvoDoFechamento, propostasComCarimboPosterior, competenciaCarimbo, textoRecusaCarimboPosterior } = require("@/lib/bbts/carimboPosterior.ts");
  const { data: emp } = await sb.from("companies").select("name").eq("id", BBTS_COMPANY_ID).maybeSingle();
  const empresa = String(emp?.name || "ADS").trim();

  for (const [rot, fc, fsg] of [["MAIO", "ADS Maio 2026.pdf", "Seguro ADs Maio 2026.pdf"], ["ABRIL", "ADS Abril 2026.pdf", "Seguro ADS Abril 2026.pdf"]]) {
    const input = await extractBbtsClosingFromPdfs(new Uint8Array(fs.readFileSync(DL + "/" + fc)), new Uint8Array(fs.readFileSync(DL + "/" + fsg)));
    const alvo = propostasAlvoDoFechamento(input);
    const bloq = await propostasComCarimboPosterior(sb, { companyId: BBTS_COMPANY_ID, year: input.year, month: input.month, propostas: alvo });
    console.log(`\n${"=".repeat(78)}\n${rot} — competencia ${competenciaCarimbo(input.year, input.month)} | ${alvo.length} propostas alvo`);
    if (bloq.length === 0) { console.log("  HTTP 200 — nenhuma bloqueada, o import seguiria sem recusa."); continue; }
    console.log(`  HTTP 409 — corpo.error (o UNICO campo que a tela renderiza):\n`);
    const txt = textoRecusaCarimboPosterior({ competencia: competenciaCarimbo(input.year, input.month), empresa, bloqueadas: bloq, totalAlvo: alvo.length, campoConfirmacao: "confirmarPularCarimboPosterior" });
    console.log(txt.replace(/(.{1,76})(\s|$)/g, "  $1\n"));
    console.log(`  corpo.bloqueadas = ${JSON.stringify(bloq, null, 1)}`);
  }
  console.log("\nNADA FOI IMPORTADO. Nenhuma escrita — este diagnostico so faz select.");
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });
