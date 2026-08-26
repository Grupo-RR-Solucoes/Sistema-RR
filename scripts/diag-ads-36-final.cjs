/* READ-ONLY. Antes/depois da grandeza nova, por competencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const pc=(d,b)=>b?((d/b)*100).toFixed(2)+"%":"-";
// ANTES = medido com a arvore limpa, so para EXIBIR
const ANTES = {
  "2026-06": { net: 249566.80, emp: 188290.69, seg: 6901.97 },
  "2026-07": { net: 266406.26, emp: 209014.87, seg: 4470.16 },
  "2026-08": { net: 299736.82, emp: 232525.62, seg: 5131.69 },
};
(async()=>{
  console.log("competencia | campo | ANTES | DEPOIS | delta | %");
  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const k=`${y}-${String(m).padStart(2,"0")}`;
    const s=(await buildFinancialAnalytics(sb,{year:y,month:m})).summary;
    const a=ANTES[k];
    const linhas=[["Recebido",a.net,s.receivedNet],["Comissoes recebidas",a.emp,s.receivedEmpresa],["Seguro recebido",a.seg,s.receivedInsurance]];
    for (const [nome,ant,dep] of linhas) console.log(`  ${k} | ${nome.padEnd(20)} | ${f(ant).padStart(12)} | ${f(dep).padStart(12)} | ${f(dep-ant).padStart(12)} | ${pc(dep-ant,ant)}`);
    console.log(`  ${k} | ${"Saldo (operatingResult)".padEnd(20)} | ${"".padStart(12)} | ${f(s.operatingResult).padStart(12)} |`);
    console.log("");
  }
  console.log("=== a ADS de julho pela grandeza nova ===");
  console.log("  a-vista (bbts_pag_avista) = 18.737,33");
  console.log("  PRT (bbts_prt_parcelas)   =      7,01");
  console.log("  Abertura de Conta         =     0,00  <- decidida SIM, mas sem coluna no banco");
  console.log("  SEGURO                    =     0,00  <- decidido NAO (card proprio)");
  console.log("  TOTAL ADS no card         = 18.744,34");
  console.log("  TOTAL se a Abertura entrar= 18.844,34  <- exatamente o TOTAL do PDF");
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
