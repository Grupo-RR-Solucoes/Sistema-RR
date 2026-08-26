/* READ-ONLY. A matriz fecha com os cards? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const p = await buildFinancialAnalytics(sb,{year:y,month:m});
    const k=`${y}-${String(m).padStart(2,"0")}`;
    for (const lado of ["entrada","saida"]) {
      const mz=p.detalhamento[lado];
      console.log(`\n##### ${k} — ${mz.titulo} (${mz.subtitulo}) #####`);
      const cols=mz.colunas;
      console.log(["empresa".padEnd(34),...cols.map(c=>c.rotulo.padStart(13)),"TOTAL".padStart(14)].join(" |"));
      for (const l of mz.linhas) {
        console.log([(l.avulso?"* ":"  ")+l.rotulo.slice(0,32).padEnd(32),...cols.map(c=>f(l.celulas[c.chave]).padStart(13)),f(l.total).padStart(14)].join(" |"));
      }
      console.log(["TOTAL".padEnd(34),...cols.map(c=>f(mz.totaisColuna[c.chave]).padStart(13)),f(mz.total).padStart(14)].join(" |"));
      const ok = Math.abs(mz.delta)<0.005;
      console.log(`  conferencia: matriz ${f(mz.total)} · card ${f(mz.cardTotal)} · delta ${f(mz.delta)}  ${ok?"[FECHA]":">>> NAO FECHA <<<"}`);
      const detalhe = mz.linhas.filter(l=>l.outrosDetalhe.some(o=>o.valor!==0));
      if (detalhe.length) { console.log("  expansao de 'Outros':"); for (const l of detalhe) console.log(`    ${l.rotulo.slice(0,30)}: ` + l.outrosDetalhe.filter(o=>o.valor!==0).map(o=>`${o.rotulo}=${f(o.valor)}`).join(" · ")); }
    }
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
