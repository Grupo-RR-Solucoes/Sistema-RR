/* READ-ONLY. A forma real do dado nas competencias que o Diego vai conferir. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100;
const f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const cel=v=>Math.abs(n(v))<0.005?"—":f(v);
(async()=>{
  for (const [y,m] of [[2026,8],[2026,6],[2026,5]]) {
    const p = await buildFinancialAnalytics(sb,{year:y,month:m});
    const d = p.detalhamento, s = p.summary;
    console.log(`\n${"=".repeat(78)}`);
    console.log(`CAIXA ${p.selectedPeriod.label}`);
    console.log("=".repeat(78));
    for (const lado of ["entrada","saida","despesa"]) {
      const mz = d[lado];
      console.log(`\n-- ${mz.titulo} — ${mz.subtitulo}`);
      if (!mz.linhas.length) { console.log(`   (vazia) ESTADO VAZIO na tela: "Nenhuma despesa lancada na competencia ${p.selectedPeriod.label}."`); }
      else {
        console.log("   " + ["empresa".padEnd(28),...mz.colunas.map(c=>c.rotulo.slice(0,13).padStart(13)),"TOTAL".padStart(13)].join(" |"));
        for (const l of mz.linhas) console.log("   " + [(l.avulso?"* ":"  ")+l.rotulo.slice(0,26).padEnd(26),...mz.colunas.map(c=>cel(l.celulas[c.chave]).padStart(13)),f(l.total).padStart(13)].join(" |"));
        console.log("   " + ["TOTAL".padEnd(28),...mz.colunas.map(c=>cel(mz.totaisColuna[c.chave]).padStart(13)),f(mz.total).padStart(13)].join(" |"));
      }
      console.log(`   conferencia: matriz ${f(mz.total)} · card ${f(mz.cardTotal)} · delta ${f(mz.delta)}  ${Math.abs(mz.delta)<0.005?"[FECHA]":">>> NAO FECHA <<<"}`);
    }
    const calc = r2(d.entrada.total - d.saida.total - d.despesa.total);
    console.log(`\n-- SALDO: ${f(d.entrada.total)} - ${f(d.saida.total)} - ${f(d.despesa.total)} = ${f(calc)}`);
    console.log(`   card "Saldo" = ${f(s.operatingResult)}  ${Math.abs(calc-s.operatingResult)<0.005?"[FECHA]":">>> NAO FECHA <<<"}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
