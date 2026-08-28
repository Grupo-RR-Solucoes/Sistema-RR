/*
 * READ-ONLY. Conferencia do backfill 20260827_000004 ANTES de rodar o SQL.
 * Nao escreve nada: so SELECT, OpenAPI e leitura dos PDFs.
 *
 *   (1) esquema REAL de bbts_fechamento_totais (colunas, NOT NULL, defaults)
 *   (2) contagem de linhas AGORA
 *   (3) cabecalho extraido dos 2 PDFs pelo extrator do repo, LADO A LADO com o
 *       que o SQL escreve — divergencia de 1 centavo e motivo de parar
 *   (4) ancora: declarado no PDF x soma das linhas ja gravadas no banco
 */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// o que o SQL do backfill escreve, transcrito do arquivo da migration
const SQL = {
  "2026-06": { avt: 7707.03, prt: 7.01, abertura: 0.0, glosa: 0.0, total: 7714.04, arq: "Crédito ADS-BBTS.pdf" },
  "2026-07": { avt: 18737.33, prt: 7.01, abertura: 100.0, glosa: 0.0, total: 18844.34, arq: "pdf (1).pdf" },
};
const PDFS = {
  "2026-06": process.env.ADS_PDF_JUNHO || "C:/Users/diego/Downloads/Crédito ADS-BBTS.pdf",
  "2026-07": process.env.ADS_PDF_JULHO || "C:/Users/diego/Downloads/pdf (1).pdf",
};

// proximo dia 1 — janela de competencia NUNCA se monta concatenando "-31"
function proxComp(comp) {
  const [y, m] = comp.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

(async () => {
  const { extractBbtsCreditoPdf } = require("../lib/bbtsPdfExtract.ts");

  // ---------------------------------------------------------------- (1)
  console.log("========== (1) ESQUEMA REAL de bbts_fechamento_totais ==========");
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/openapi+json" },
  });
  const spec = await res.json();
  const def = spec.definitions && spec.definitions["bbts_fechamento_totais"];
  if (!def) {
    console.log("  TABELA NAO ENCONTRADA no OpenAPI (migration nao aplicada?)");
  } else {
    const cols = Object.keys(def.properties || {});
    console.log(`  colunas (${cols.length}): ${cols.join(", ")}`);
    console.log(`  required (NOT NULL sem default): ${JSON.stringify(def.required || [])}`);
    for (const [c, p] of Object.entries(def.properties || {})) {
      const extras = [];
      if (p.format) extras.push(`format=${p.format}`);
      if (p.default !== undefined) extras.push(`default=${JSON.stringify(p.default)}`);
      if (p.description) extras.push(`desc=${JSON.stringify(p.description)}`);
      console.log(`    ${c.padEnd(18)} ${extras.join(" | ")}`);
    }
  }

  // ---------------------------------------------------------------- (2)
  console.log("\n========== (2) LINHAS EM bbts_fechamento_totais AGORA ==========");
  const cAll = await sb.from("bbts_fechamento_totais").select("*", { count: "exact" });
  if (cAll.error) console.log(`  ERRO: ${cAll.error.code} ${cAll.error.message}`);
  else {
    console.log(`  tabela INTEIRA, sem filtro: ${cAll.count} linha(s)`);
    for (const r of cAll.data || []) console.log(`    ${JSON.stringify(r)}`);
  }

  // ---------------------------------------------------------------- (3)
  console.log("\n========== (3) PDF (extrator do repo) x SQL do backfill ==========");
  let divergencias = 0;
  const doPdf = {};
  for (const comp of Object.keys(SQL)) {
    const p = PDFS[comp];
    if (!fs.existsSync(p)) {
      console.log(`\n  ${comp}: ARQUIVO AUSENTE — ${p}`);
      divergencias += 1;
      continue;
    }
    const cred = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(p)));
    const cab = cred.cabecalho;
    doPdf[comp] = cab;
    const s = SQL[comp];
    const compPdf = `${cred.year}-${String(cred.month).padStart(2, "0")}`;
    console.log(`\n  ${comp}   (arquivo: ${p.split("/").pop()})`);
    console.log(`    competencia lida do PROPRIO PDF: ${compPdf}   ${compPdf === comp ? "confere" : "DIVERGE"}`);
    if (compPdf !== comp) divergencias += 1;
    const linhas = [
      ["pagamento_avt", cab.pagamentoAvt, s.avt],
      ["pagamento_prt", cab.pagamentoPrt, s.prt],
      ["abertura_conta", cab.aberturaConta, s.abertura],
      ["glosa", cab.outrasDeducoes, s.glosa],
      ["pagamento_total", cab.pagamentoTotal, s.total],
    ];
    console.log(`    ${"coluna".padEnd(17)} ${"PDF".padStart(12)} ${"SQL".padStart(12)}   delta`);
    for (const [nome, pdf, sql] of linhas) {
      const d = Math.round((Number(pdf) - Number(sql)) * 100) / 100;
      if (Math.abs(d) > 0.001) divergencias += 1;
      console.log(
        `    ${nome.padEnd(17)} ${f(pdf).padStart(12)} ${f(sql).padStart(12)}   ${d === 0 ? "0,00  bate" : `${f(d)}  DIVERGE`}`
      );
    }
    const soma = Math.round((cab.pagamentoAvt + cab.pagamentoPrt + cab.aberturaConta + cab.outrasDeducoes) * 100) / 100;
    const fecha = Math.abs(soma - cab.pagamentoTotal) < 0.005;
    console.log(`    identidade da soma no PDF: ${f(soma)} vs total ${f(cab.pagamentoTotal)}   ${fecha ? "FECHA" : "NAO FECHA"}`);
    if (!fecha) divergencias += 1;
    console.log(`    rotulos crus do PDF: ${JSON.stringify(cab.rotulos)}`);
  }
  console.log(`\n  >>> DIVERGENCIAS PDF x SQL: ${divergencias}`);

  // ---------------------------------------------------------------- (4)
  console.log("\n========== (4) ANCORA — declarado no PDF x linhas ja gravadas ==========");
  for (const comp of Object.keys(SQL)) {
    const cab = doPdf[comp];
    if (!cab) continue;
    const ini = `${comp}-01`;
    const fim = proxComp(comp);
    const { data, error } = await sb
      .from("daily_production_records")
      .select("proposal_number, bbts_pag_avista")
      .eq("company_id", ADS)
      .gte("movement_date", ini)
      .lt("movement_date", fim);
    if (error) throw error;
    const somaAvt = Math.round((data || []).reduce((a, r) => a + (Number(r.bbts_pag_avista) || 0), 0) * 100) / 100;
    const { data: prt, error: e2 } = await sb
      .from("bbts_prt_parcelas")
      .select("valor_parcela")
      .eq("company_id", ADS)
      .eq("competencia", ini);
    if (e2) throw e2;
    const somaPrt = Math.round((prt || []).reduce((a, r) => a + (Number(r.valor_parcela) || 0), 0) * 100) / 100;
    console.log(
      `  ${comp}  AVT declarado ${f(cab.pagamentoAvt).padStart(11)}  nas linhas ${f(somaAvt).padStart(11)}  delta ${f(
        somaAvt - cab.pagamentoAvt
      )}   |  PRT declarado ${f(cab.pagamentoPrt)}  nas parcelas ${f(somaPrt)}  delta ${f(somaPrt - cab.pagamentoPrt)}`
    );
  }
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
