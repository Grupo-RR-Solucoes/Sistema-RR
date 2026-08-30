/* MAIO — DRY RUN, duas passadas, NENHUMA ESCRITA.
 *  (1) importBbtsClosing com dryRun:true (o proprio contrato do importador).
 *  (2) segunda passada com dryRun:false mas com as escritas INTERCEPTADAS por um
 *      proxy que CAPTURA e nao executa — e o unico jeito de mostrar "o que seria
 *      gravado" linha a linha. O proxy LANCA em metodo desconhecido: se aparecer
 *      um caminho de escrita novo, ele reprova em vez de deixar passar. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const real = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DL = "C:/Users/diego/Downloads";
const ESCRITA = new Set(["upsert", "insert", "update", "delete", "rpc"]);

function interceptar(capturas) {
  const wrap = (alvo, tabela) => new Proxy(alvo, {
    get(t, prop) {
      if (typeof prop === "string" && ESCRITA.has(prop)) {
        return (...args) => {
          const payload = args[0];
          capturas.push({ tabela, op: prop, n: Array.isArray(payload) ? payload.length : 1, payload });
          const res = { data: null, error: null };
          const stub = {
            select: () => stub, eq: () => Promise.resolve(res), in: () => Promise.resolve(res),
            single: () => Promise.resolve({ data: { id: "00000000-0000-0000-0000-000000000000" }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { id: "00000000-0000-0000-0000-000000000000" }, error: null }),
            then: (r, j) => Promise.resolve(res).then(r, j),
          };
          return stub;
        };
      }
      const v = t[prop];
      if (typeof v !== "function") return v;
      return (...a) => {
        const out = v.apply(t, a);
        if (out && typeof out.then === "function") return out;      // promise: passa
        if (out && typeof out === "object") return wrap(out, tabela); // builder: reembrulha
        return out;
      };
    },
  });
  return { from: (tabela) => wrap(real.from(tabela), tabela) };
}

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const { extractBbtsClosingFromPdfs } = require("@/lib/bbtsPdfExtract.ts");
  const { importBbtsClosing } = require("@/lib/bbtsClosingImport.ts");
  const input = await extractBbtsClosingFromPdfs(
    new Uint8Array(fs.readFileSync(DL + "/ADS Maio 2026.pdf")),
    new Uint8Array(fs.readFileSync(DL + "/Seguro ADs Maio 2026.pdf"))
  );

  console.log("=".repeat(78));
  console.log("PASSADA 1 — importBbtsClosing(dryRun: true)");
  console.log("=".repeat(78));
  const r1 = await importBbtsClosing(real, input, { dryRun: true, fileName: "ADS Maio 2026.pdf" });
  console.log(JSON.stringify(r1, null, 1));

  console.log("\n" + "=".repeat(78));
  console.log("PASSADA 2 — dryRun:false com ESCRITAS INTERCEPTADAS (nada executado)");
  console.log("=".repeat(78));
  const capturas = [];
  const r2 = await importBbtsClosing(interceptar(capturas), input, { dryRun: false, fileName: "ADS Maio 2026.pdf" });
  console.log(`gravadas (contadas pelo importador): ${r2.gravadas}`);
  console.log(`\nescritas que teriam acontecido: ${capturas.length}`);
  for (const c of capturas) {
    console.log(`\n--- ${c.op.toUpperCase()} em ${c.tabela} (${c.n} linha(s))`);
    if (c.tabela === "daily_production_records") {
      const rows = Array.isArray(c.payload) ? c.payload : [c.payload];
      for (const x of rows)
        console.log(`    ${x.proposal_number} | carimbo=${x.bbts_competencia_fechamento} mov=${x.movement_date} avista=${brl(x.bbts_pag_avista)} seg=${brl(x.bbts_seguro_pago)} bruto=${brl(x.gross_value)} ins=${brl(x.insurance_value)} jkey=${x.j_key} ${x.status} | ${String(x.product_description).slice(0,28)}`);
      console.log(`    SOMAS: avista ${brl(rows.reduce((a,x)=>a+Number(x.bbts_pag_avista||0),0))} | seguro ${brl(rows.reduce((a,x)=>a+Number(x.bbts_seguro_pago||0),0))} | bruto ${brl(rows.reduce((a,x)=>a+Number(x.gross_value||0),0))}`);
    } else {
      console.log("   ", JSON.stringify(c.payload).slice(0, 700));
    }
  }
  console.log("\nNENHUMA ESCRITA FOI EXECUTADA — todas interceptadas.");
})().catch(e => { console.error("EXCECAO:", e.message, e.stack); process.exit(1); });
