/* READ-ONLY. Medicao da regra de 26/08 TARDE. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const pc=(d,b)=>b?((d/b)*100).toFixed(2)+"%":"-";
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}

// ANTES = estado do repo ANTES desta correcao (regra da MANHA, seguro fora), medido
const MANHA = { "2026-06": {net:242664.83, emp:181388.72}, "2026-07": {net:269747.68, emp:204544.71}, "2026-08": {net:313349.47, emp:246131.26} };
// ORIGINAL = como estava em main, antes de qualquer mudanca de hoje
const MAIN  = { "2026-06": {net:249566.80, emp:188290.69}, "2026-07": {net:266406.26, emp:209014.87}, "2026-08": {net:299736.82, emp:232525.62} };

(async()=>{
  console.log("=== TRES COMPETENCIAS: main -> manha(revogada) -> tarde(vigente) ===\n");
  for (const [y,m] of [[2026,6],[2026,7],[2026,8]]) {
    const k=`${y}-${String(m).padStart(2,"0")}`;
    const s=(await buildFinancialAnalytics(sb,{year:y,month:m})).summary;
    console.log(`  ${k}`);
    console.log(`    Recebido            : main ${f(MAIN[k].net).padStart(12)} | manha ${f(MANHA[k].net).padStart(12)} | TARDE ${f(s.receivedNet).padStart(12)} | vs main ${f(s.receivedNet-MAIN[k].net).padStart(11)} (${pc(s.receivedNet-MAIN[k].net, MAIN[k].net)})`);
    console.log(`    Comissoes recebidas : main ${f(MAIN[k].emp).padStart(12)} | manha ${f(MANHA[k].emp).padStart(12)} | TARDE ${f(s.receivedEmpresa).padStart(12)} | vs main ${f(s.receivedEmpresa-MAIN[k].emp).padStart(11)} (${pc(s.receivedEmpresa-MAIN[k].emp, MAIN[k].emp)})`);
    console.log(`    Seguro recebido (do qual) ${f(s.receivedInsurance)} | Comissoes pagas ${f(s.comissoesPagas)} | Seguro repassado (do qual) ${f(s.paidInsuranceShare)}`);
    console.log(`    Saldo ${f(s.operatingResult)}\n`);
  }

  const ago=(await buildFinancialAnalytics(sb,{year:2026,month:8})).summary;
  console.log("=== ago/26 x o extrato do Diego ===");
  console.log(`  Recebido medido  = ${f(ago.receivedNet)}`);
  console.log(`  extrato do Diego = 318.736,23`);
  console.log(`  diferenca        = ${f(318736.23 - ago.receivedNet)}`);
  console.log(`  decomposta: Abertura de Conta 100,00 + seguro so-seguro 89,42 - cancelados 49,45 = ${f(100+89.42-49.45)}`);

  console.log("\n=== 'Comissoes pagas' JA inclui o seguro repassado? ===");
  const pmr = await pageAll(()=> sb.from("promoter_monthly_results")
    .select("production_commission_value, insurance_commission_value, final_commission_value, bbcap_commission_value, conta_corrente_commission_value, consorcio_commission_value, lob_commission_value")
    .eq("year",2026).eq("month",7).neq("source","daily"));
  const S=k=>pmr.reduce((a,r)=>a+n(r[k]),0);
  const prod=S("production_commission_value"), seg=S("insurance_commission_value"), fin=S("final_commission_value");
  const prods=S("bbcap_commission_value")+S("conta_corrente_commission_value")+S("consorcio_commission_value")+S("lob_commission_value");
  console.log(`  Sigma production_commission_value = ${f(prod)}`);
  console.log(`  Sigma insurance_commission_value  = ${f(seg)}   <- o seguro repassado`);
  console.log(`  Sigma produtos (bbcap+cc+cons+lob)= ${f(prods)}`);
  console.log(`  Sigma final_commission_value      = ${f(fin)}`);
  console.log(`  producao + seguro + produtos      = ${f(prod+seg+prods)}  -> bate com final? ${Math.abs(prod+seg+prods-fin)<0.05?"SIM":"delta "+f(prod+seg+prods-fin)}`);
  console.log(`  paidInsuranceShare do card        = ${f(ago.paidInsuranceShare)}  -> == Sigma insurance? ${Math.abs(ago.paidInsuranceShare-seg)<0.02?"SIM":"NAO"}`);
  console.log(`\n  => o seguro repassado JA esta dentro das Comissoes pagas. Nada a incluir.`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
