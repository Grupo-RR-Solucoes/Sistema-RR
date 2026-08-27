/* READ-ONLY. O 1,40 virou debito E continua na fila ao mesmo tempo? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name");
  const pn=Object.fromEntries(proms.map(p=>[p.id,p.name]));
  const { data: comps } = await sb.from("companies").select("id,name");
  const cn=Object.fromEntries(comps.map(c=>[c.id,c.name]));

  console.log("=== A: o DEBITO existe? (promoter_debits + sources) ===");
  const src = await pageAll(()=> sb.from("promoter_debit_sources").select("*").eq("operation","211689509"));
  console.log(`  promoter_debit_sources com operacao 211689509: ${src.length}`);
  for (const s of src) {
    const { data: d } = await sb.from("promoter_debits").select("*").eq("id",s.debit_id);
    const r=(d||[])[0];
    console.log(`     debit_id=${String(s.debit_id).slice(0,8)} | ${r?pn[r.promoter_id]:"?"} | ${f(r?.total_amount)} | ${cn[r?.company_id]} | ${r?.start_year}-${String(r?.start_month).padStart(2,"0")} | ${r?.status}`);
  }
  const di = await pageAll(()=> sb.from("promoter_discounts").select("*").eq("year",2026).eq("month",7).in("debit_id", src.map(s=>s.debit_id)));
  console.log(`  parcelas em promoter_discounts: ${di.length} -> ${di.map(x=>`${pn[x.promoter_id]} ${f(x.amount)}`).join(", ")}`);

  console.log("\n=== B: e ele TAMBEM esta na fila? ===");
  const fila = await pageAll(()=> sb.from("promoter_debit_assignments").select("*").order("year").order("month"));
  console.log(`  promoter_debit_assignments: ${fila.length} linha(s)`);
  console.log("  comp | origem | operacao | chave_j | estorno | status | promoter_id");
  for (const r of fila) console.log(`   ${r.year}-${String(r.month).padStart(2,"0")} | ${String(r.source_kind).padEnd(18)} | ${String(r.operation).padEnd(11)} | ${String(r.chave_j ?? "-").padEnd(10)} | ${f(r.estorno_amount).padStart(8)} | ${String(r.status).padEnd(8)} | ${r.promoter_id?pn[r.promoter_id]:"NULO"}`);

  const naFila = fila.find(r=>String(r.operation)==="211689509");
  const temDebito = src.length>0;
  console.log(`\n  >>> 211689509: tem DEBITO? ${temDebito?"SIM":"NAO"} | esta na FILA? ${naFila?`SIM (status ${naFila.status})`:"NAO"} <<<`);
  if (temDebito && naFila) console.log("  >>> OS DOIS AO MESMO TEMPO: a rotina resolveu mas NAO FECHOU a linha da fila <<<");

  console.log("\n=== C: a tela le a fila de onde? (o que ela mostra) ===");
  console.log("  A captura mostra 211689509 com CHAVE J '-' e ORIGEM 'ADS'.");
  console.log(`  Na tabela: chave_j = ${naFila?JSON.stringify(naFila.chave_j):"-"} | source_kind = ${naFila?naFila.source_kind:"-"}`);
  console.log("  => bate com a linha da FILA, nao com o debito.");

  console.log("\n=== D: o outro item, 211780610 ===");
  const o2 = fila.find(r=>String(r.operation)==="211780610");
  if (o2) {
    console.log(`  ${o2.year}-${String(o2.month).padStart(2,"0")} | ${o2.source_kind} | chave_j=${o2.chave_j} | ${f(o2.estorno_amount)} | ${o2.status}`);
    const { data: c } = await sb.from("cms_promoter_entries").select("promoter_id,j_key").eq("contract_number","211780610");
    console.log(`  no cms: ${(c||[]).map(x=>`${pn[x.promoter_id]} (j_key ${x.j_key})`).join(", ") || "nao existe"}`);
    const { data: s2 } = await sb.from("promoter_debit_sources").select("*").eq("operation","211780610");
    console.log(`  tem debito? ${(s2||[]).length? "SIM" : "NAO"}`);
  }
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
