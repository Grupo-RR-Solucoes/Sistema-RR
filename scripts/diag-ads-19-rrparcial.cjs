/* READ-ONLY. Item 3: o RR tem fechamento em partes? */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const one = await sb.from("monthly_closing_imports").select("*").limit(1);
  console.log("colunas de monthly_closing_imports:\n" + Object.keys(one.data[0]).join(", ") + "\n");

  const rows = await pageAll(()=> sb.from("monthly_closing_imports").select("company_id, year, month, status, file_name, produto, created_at").order("year").order("month"));
  const { data: comps } = await sb.from("companies").select("id,name,active");
  const nome = Object.fromEntries(comps.map(c=>[c.id,c.name]));
  const ativas = comps.filter(c=>c.active);

  console.log("=== assinatura 'produto' — distribuicao no historico inteiro ===");
  const p={}; for(const r of rows) p[r.produto ?? "(null)"]=(p[r.produto ?? "(null)"]||0)+1;
  for(const [k,v] of Object.entries(p).sort((a,b)=>b[1]-a[1])) console.log(`${k} | ${v}`);

  console.log("\n=== competencias de 2026: cobertura por empresa ATIVA e tipos de arquivo ===");
  console.log("competencia | empresas ATIVAS cobertas (de " + ativas.length + ") | arquivos | assinaturas");
  const byComp = {};
  for (const r of rows) { if (r.year !== 2026) continue; const k=`${r.year}-${String(r.month).padStart(2,"0")}`; (byComp[k]=byComp[k]||[]).push(r); }
  for (const [k, rs] of Object.entries(byComp).sort()) {
    const cob = new Set(rs.filter(r=>r.status==="COMPLETED" && ativas.some(a=>a.id===r.company_id)).map(r=>r.company_id));
    const sigs = [...new Set(rs.map(r=>r.produto ?? "(null)"))].sort().join(", ");
    const falta = ativas.filter(a=>!cob.has(a.id)).map(a=>a.name);
    console.log(`${k} | ${cob.size} | ${rs.length} | ${sigs}${falta.length?"   <<< FALTA: "+falta.join(", "):""}`);
  }

  console.log("\n=== arquivos NAO-'TODOS' (fechamento em partes) ===");
  const parciais = rows.filter(r=>r.produto && r.produto!=="TODOS");
  console.log("total: " + parciais.length);
  for (const r of parciais) console.log(`${r.year}-${String(r.month).padStart(2,"0")} | ${nome[r.company_id]} | produto=${r.produto} | ${r.file_name} | ${String(r.created_at).slice(0,19)}`);
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
