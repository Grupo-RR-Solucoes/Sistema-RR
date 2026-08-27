/* READ-ONLY. Ha contrato na ADS (ou cms) cujo dono esta INATIVO? Serve de caso real p/ gate. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS="375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f=v=>(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: proms } = await sb.from("promoters").select("id,name,active,dismissed_at");
  const inat=new Map(proms.filter(p=>p.active===false).map(p=>[p.id,p]));
  console.log(`inativos: ${inat.size}`);

  const d = await pageAll(()=> sb.from("daily_production_records").select("proposal_number,assigned_promoter_id,movement_date").eq("company_id",ADS));
  const comInat = d.filter(r=>inat.has(r.assigned_promoter_id));
  console.log(`\n=== contratos na ADS com dono INATIVO: ${comInat.length} de ${d.length} ===`);
  for (const r of comInat.slice(0,12)) { const p=inat.get(r.assigned_promoter_id); console.log(`  ${r.proposal_number} | mov=${r.movement_date} | ${p.name} (saiu ${p.dismissed_at})`); }

  const cms = await pageAll(()=> sb.from("cms_promoter_entries").select("contract_number,promoter_id,prod_year,prod_month"));
  const cmsInat = cms.filter(r=>inat.has(r.promoter_id));
  console.log(`\n=== contratos no cms com dono INATIVO: ${cmsInat.length} de ${cms.length} ===`);
  for (const r of cmsInat.slice(0,8)) { const p=inat.get(r.promoter_id); console.log(`  ${r.contract_number} | cms ${r.prod_year}-${String(r.prod_month).padStart(2,"0")} | ${p.name} (saiu ${p.dismissed_at})`); }
  if (cmsInat.length) console.log(`\n  >>> USAR NO GATE: ${cmsInat[0].contract_number} (dono ${inat.get(cmsInat[0].promoter_id).name}, saiu ${inat.get(cmsInat[0].promoter_id).dismissed_at}) <<<`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
