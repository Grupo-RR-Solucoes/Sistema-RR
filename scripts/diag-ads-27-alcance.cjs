/* READ-ONLY. B.3 — alcance dos cancelamentos de seguro da ADS por competencia. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const n = v => Number(v)||0;
const f = v => n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  // DAILY_CANCEL = o caminho da ADS (resolveAdsCancelDebits). CLOSING_INSURANCE = RR.
  const asg = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").eq("source_kind","DAILY_CANCEL"));
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("source_kind","DAILY_CANCEL"));
  const deb = await pageAll(()=> sb.from("promoter_debits").select("*").eq("company_id",ADS));
  const debById = new Map(deb.map(r=>[r.id,r]));

  console.log("=== CANCELAMENTOS DE SEGURO DA ADS (source_kind=DAILY_CANCEL) ===\n");
  console.log("-- na FILA (sem dono, status PENDING) --");
  const fila = {};
  for (const r of asg) { const k=`${r.year}-${String(r.month).padStart(2,"0")}`; const b=fila[k]||(fila[k]={n:0,v:0,ops:[]}); b.n++; b.v+=n(r.estorno_amount); b.ops.push(`${r.operation}=${f(r.estorno_amount)}`); }
  for (const [k,b] of Object.entries(fila).sort()) console.log(`${k} | ${b.n} op(s) | ${f(b.v)} | ${b.ops.join(", ")}`);

  console.log("\n-- RESOLVIDOS (viraram debito ao promotor) --");
  const res = {};
  for (const r of src) {
    const d = debById.get(r.debit_id); if (!d) continue;
    const k=`${d.start_year}-${String(d.start_month).padStart(2,"0")}`;
    const b=res[k]||(res[k]={n:0,v:0,ops:[]}); b.n++; b.v+=n(r.estorno_amount); b.ops.push(`${r.operation}=${f(r.estorno_amount)}`);
  }
  for (const [k,b] of Object.entries(res).sort()) console.log(`${k} | ${b.n} op(s) | ${f(b.v)} | ${b.ops.join(", ")}`);

  console.log("\n=== TOTAL por competencia (fila + resolvidos) ===");
  const comps = [...new Set([...Object.keys(fila), ...Object.keys(res)])].sort();
  let tot=0;
  console.log("competencia | ops | Sigma estorno | destino");
  for (const k of comps) {
    const a=fila[k]||{n:0,v:0}, b=res[k]||{n:0,v:0};
    tot += a.v+b.v;
    console.log(`${k} | ${a.n+b.n} | ${f(a.v+b.v)} | fila=${a.n} (${f(a.v)}) / debitados=${b.n} (${f(b.v)})`);
  }
  console.log(`TOTAL | ${f(tot)}`);

  console.log("\n=== O SISTEMA INFLA A PRODUCAO POR CAUSA DISSO? ===");
  console.log("Os cancelados NAO entram em daily_production_records (seguroByContrato so recebe 'calculo').");
  const { data: d } = await sb.from("daily_production_records").select("proposal_number, bbts_seguro_pago")
    .eq("company_id",ADS).in("proposal_number", asg.map(r=>r.operation).concat(src.map(r=>r.operation)));
  console.log("linhas de daily da ADS para os contratos cancelados: " + (d||[]).length);
  for (const r of (d||[])) console.log(`   ${r.proposal_number} | bbts_seguro_pago=${f(r.bbts_seguro_pago)}  <- valor da competencia ORIGINAL, nao do cancelamento`);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
