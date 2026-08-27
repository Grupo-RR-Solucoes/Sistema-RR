/* READ-ONLY. Os DOIS mecanismos de desativacao: promoters vs app_users. Concordam? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: au1 } = await sb.from("app_users").select("*").limit(1);
  console.log("=== app_users: colunas ===");
  console.log("  " + Object.keys(au1[0]||{}).join(", "));
  const au = await pageAll(()=> sb.from("app_users").select("id, email, full_name, role, promoter_id, active, created_at"));
  console.log(`\n  total: ${au.length} | active=true: ${au.filter(u=>u.active===true).length} | active=false: ${au.filter(u=>u.active===false).length}`);
  const comProm = au.filter(u=>u.promoter_id);
  console.log(`  com promoter_id vinculado: ${comProm.length}`);
  console.log(`     desses, DESATIVADOS (active=false): ${comProm.filter(u=>u.active===false).length}`);
  console.log("\n  >>> app_users NAO TEM coluna de DATA de desativacao (ver lista acima) <<<");

  const proms = await pageAll(()=> sb.from("promoters").select("id,name,active,status,dismissed_at"));
  const pm=new Map(proms.map(p=>[p.id,p]));
  console.log("\n=== promoters: 14 desligados, com DATA ===");
  console.log(`  status ACTIVE: ${proms.filter(p=>p.status==="ACTIVE").length} | DISMISSED: ${proms.filter(p=>p.status==="DISMISSED").length}`);
  console.log(`  dismissed_at preenchido: ${proms.filter(p=>p.dismissed_at).length}`);

  console.log("\n=== OS DOIS CONCORDAM? (so para promotores com app_user) ===");
  console.log("promotor | promoters.active | app_users.active | dismissed_at | CONCORDAM?");
  let diverge=0, semUser=0;
  for (const p of proms) {
    const u = au.find(x=>x.promoter_id===p.id);
    if (!u) { semUser++; continue; }
    const ok = (p.active===true) === (u.active===true);
    if (!ok) diverge++;
    if (!ok || p.active===false) console.log(`  ${String(p.name).slice(0,30).padEnd(30)} | ${String(p.active).padEnd(5)} | ${String(u.active).padEnd(5)} | ${p.dismissed_at ?? "-"} | ${ok?"sim":">>> DIVERGEM <<<"}`);
  }
  console.log(`\n  promotores SEM app_user: ${semUser}/${proms.length}`);
  console.log(`  divergencias entre os dois campos: ${diverge}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
