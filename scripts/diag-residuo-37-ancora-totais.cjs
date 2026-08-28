/* READ-ONLY. ITEM 2 + ITEM 4.
   Para cada PDF de credito da ADS em disco: extrai os 5 totalizadores e confere
   o DECLARADO contra a SOMA DAS LINHAS ja gravadas no banco. Emite o SQL do
   backfill no fim. Nada e escrito. */
require("./_ts_register.cjs");
const fs = require("fs"); const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
// 1o dia da competencia SEGUINTE. Montar "${comp}-31" a mao devolve data invalida
// em meses de 30 dias e o filtro cai para ZERO linha em silencio — foi assim que
// esta medicao inventou uma divergencia de R$ 7.707,03 em 2026-06 na 1a rodada.
const proxComp = (y, m) => (m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`);

(async () => {
  const { extractBbtsCreditoPdf } = require("../lib/bbtsPdfExtract.ts");
  const { extractText, getDocumentProxy } = require("unpdf");

  // acha TODO PDF de credito da ADS em disco (teste objetivo: tem "Pagamento AVT")
  const dirs = ["C:/Users/diego/Downloads", "C:/Users/diego/Documents/Codex/2026-04-20-files-mentioned-by-the-user-sistema/repo/Sistema-RR-main"];
  const cand = [];
  for (const d of dirs) { let e = []; try { e = fs.readdirSync(d); } catch { continue; } for (const x of e) if (/\.pdf$/i.test(x)) cand.push(path.join(d, x)); }
  const creditos = [];
  for (const p of cand) {
    try {
      const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(p)));
      const t = String((await extractText(doc, { mergePages: true })).text || "");
      if (/Pagamento\s*AVT/i.test(t)) creditos.push(p);
    } catch {}
  }
  console.log(`### ITEM 2 — PDFs de CREDITO da ADS em disco: ${creditos.length}`);
  for (const p of creditos) console.log(`    ${p}`);

  const sqlVals = [];
  console.log(`\n### ITEM 4 — ANCORA: declarado no PDF x soma das linhas no BANCO\n`);
  console.log("comp     | AVT declarado   AVT nas linhas    delta | PRT declarado   PRT nas linhas   delta | Abertura   Glosa    Total");
  let batem = 0, divergem = 0; const div = [];
  for (const p of creditos) {
    const c = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(p)));
    const comp = `${c.year}-${String(c.month).padStart(2, "0")}`;
    const { data: linhas } = await sb.from("daily_production_records")
      .select("bbts_pag_avista").eq("company_id", ADS)
      .gte("movement_date", `${comp}-01`).lt("movement_date", proxComp(c.year, c.month)).not("bbts_pag_avista", "is", null);
    const somaAvt = (linhas || []).reduce((a, r) => a + (Number(r.bbts_pag_avista) || 0), 0);
    const { data: prt } = await sb.from("bbts_prt_parcelas").select("valor_parcela").eq("company_id", ADS).eq("competencia", `${comp}-01`);
    const somaPrt = (prt || []).reduce((a, r) => a + (Number(r.valor_parcela) || 0), 0);
    const dAvt = Math.round((somaAvt - c.cabecalho.pagamentoAvt) * 100) / 100;
    const dPrt = Math.round((somaPrt - c.cabecalho.pagamentoPrt) * 100) / 100;
    const ok = Math.abs(dAvt) <= 0.01 && Math.abs(dPrt) <= 0.01;
    if (ok) batem++; else { divergem++; div.push({ comp, dAvt, dPrt, decAvt: c.cabecalho.pagamentoAvt, somaAvt, decPrt: c.cabecalho.pagamentoPrt, somaPrt }); }
    console.log(`${comp}  | ${f(c.cabecalho.pagamentoAvt).padStart(13)} ${f(somaAvt).padStart(16)} ${f(dAvt).padStart(8)} | ${f(c.cabecalho.pagamentoPrt).padStart(13)} ${f(somaPrt).padStart(15)} ${f(dPrt).padStart(7)} | ${f(c.cabecalho.aberturaConta).padStart(8)} ${f(c.cabecalho.outrasDeducoes).padStart(7)} ${f(c.cabecalho.pagamentoTotal).padStart(10)}  ${ok ? "BATE" : "<<< DIVERGE"}`);
    sqlVals.push(`  ('${ADS}', date '${comp}-01', ${c.cabecalho.pagamentoAvt.toFixed(2)}, ${c.cabecalho.pagamentoPrt.toFixed(2)}, ${c.cabecalho.aberturaConta.toFixed(2)}, ${c.cabecalho.outrasDeducoes.toFixed(2)}, ${c.cabecalho.pagamentoTotal.toFixed(2)}, '${path.basename(p).split("'").join("''")}')`);
  }
  console.log(`\n>>> BATEM: ${batem}   DIVERGEM: ${divergem}`);
  for (const d of div) console.log(`    ${d.comp}: AVT declarado ${f(d.decAvt)} x linhas ${f(d.somaAvt)} (delta ${f(d.dAvt)}) | PRT declarado ${f(d.decPrt)} x linhas ${f(d.somaPrt)} (delta ${f(d.dPrt)})`);

  console.log(`\n### SQL DO BACKFILL (${sqlVals.length} competencias) ###\n`);
  console.log("insert into bbts_fechamento_totais");
  console.log("  (company_id, competencia, pagamento_avt, pagamento_prt, abertura_conta, glosa, pagamento_total, arquivo_origem)");
  console.log("values");
  console.log(sqlVals.join(",\n"));
  console.log(`on conflict (company_id, competencia) do update set
  pagamento_avt = excluded.pagamento_avt, pagamento_prt = excluded.pagamento_prt,
  abertura_conta = excluded.abertura_conta, glosa = excluded.glosa,
  pagamento_total = excluded.pagamento_total, arquivo_origem = excluded.arquivo_origem,
  updated_at = now();`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
