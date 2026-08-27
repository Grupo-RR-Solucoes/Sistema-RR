/* READ-ONLY. Mapeamento da 3a matriz: EMPRESA x CATEGORIA DE DESPESA. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const n=v=>Number(v)||0, r2=v=>Math.round(v*100)/100, f=v=>n(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function pageAll(b){const a=[];for(let x=0;;x+=1000){const{data,error}=await b().range(x,x+999);if(error)throw new Error(error.message);a.push(...data);if(data.length<1000)break;}return a;}
(async()=>{
  const { data: comps } = await sb.from("companies").select("id,name,active");
  const nome=Object.fromEntries(comps.map(c=>[c.id,c.name]));

  console.log("=== (1) expense_categories ===");
  const cats = await pageAll(()=> sb.from("expense_categories").select("*").order("name"));
  console.log("colunas: " + Object.keys(cats[0]||{}).join(", "));
  console.log("total: " + cats.length + "  (ativas: " + cats.filter(c=>c.active!==false).length + ")");
  for (const c of cats) console.log(`  ${String(c.name).padEnd(34)} | ativa=${c.active} | default=${c.is_default} | id=${String(c.id).slice(0,8)}`);
  const catNome=Object.fromEntries(cats.map(c=>[c.id,c.name]));

  console.log("\n=== (2) financial_expenses: colunas e preenchimento ===");
  const exp = await pageAll(()=> sb.from("financial_expenses").select("*"));
  console.log("total de linhas: " + exp.length);
  if (!exp.length) { console.log(">>> TABELA VAZIA <<<"); return; }
  console.log("colunas: " + Object.keys(exp[0]).join(", "));
  for (const c of ["company_id","category_id","scope","amount","year","month","status","payment_date"]) {
    const nn = exp.filter(r=>r[c]!==null&&r[c]!==undefined).length;
    console.log(`  ${c.padEnd(16)} | nao-nulo em ${nn}/${exp.length}`);
  }
  const semEmp = exp.filter(r=>!r.company_id);
  console.log(`\n  linhas SEM company_id: ${semEmp.length} | valor ${f(semEmp.reduce((s,r)=>s+n(r.amount),0))}`);
  const scopes={}; for(const r of exp) scopes[r.scope??"(null)"]=(scopes[r.scope??"(null)"]||0)+1;
  console.log("  scope: " + JSON.stringify(scopes));
  console.log("\n  -- por scope: tem empresa? --");
  for (const sc of Object.keys(scopes)) {
    const rs = exp.filter(r=>(r.scope??"(null)")===sc);
    console.log(`    ${sc.padEnd(12)} | ${rs.length} linha(s) | com company_id: ${rs.filter(r=>r.company_id).length} | Sigma ${f(rs.reduce((s,r)=>s+n(r.amount),0))}`);
  }

  console.log("\n=== (3) HISTORICO: por competencia ===");
  const porComp={};
  for (const r of exp){ const k=`${r.year}-${String(r.month).padStart(2,"0")}`; const b=porComp[k]||(porComp[k]={n:0,v:0}); b.n++; b.v+=n(r.amount); }
  for (const [k,b] of Object.entries(porComp).sort()) console.log(`  ${k} | ${String(b.n).padStart(3)} linha(s) | ${f(b.v).padStart(14)}`);

  console.log("\n=== (3b) por CATEGORIA (historico inteiro), ordenado por valor ===");
  const porCat={};
  for (const r of exp){ const k=catNome[r.category_id]||"(sem categoria)"; const b=porCat[k]||(porCat[k]={n:0,v:0}); b.n++; b.v+=n(r.amount); }
  const total = exp.reduce((s,r)=>s+n(r.amount),0);
  let acum=0;
  for (const [k,b] of Object.entries(porCat).sort((a,c)=>c[1].v-a[1].v)) {
    acum+=b.v;
    console.log(`  ${k.padEnd(34)} | ${String(b.n).padStart(3)} | ${f(b.v).padStart(13)} | ${(b.v/total*100).toFixed(1).padStart(5)}% | acum ${(acum/total*100).toFixed(1)}%`);
  }
  console.log(`  ${"TOTAL".padEnd(34)} | ${String(exp.length).padStart(3)} | ${f(total).padStart(13)}`);

  console.log("\n=== (3c) por EMPRESA ===");
  const porEmp={};
  for (const r of exp){ const k=r.company_id?(nome[r.company_id]||r.company_id):">>> SEM EMPRESA <<<"; const b=porEmp[k]||(porEmp[k]={n:0,v:0}); b.n++; b.v+=n(r.amount); }
  for (const [k,b] of Object.entries(porEmp).sort((a,c)=>c[1].v-a[1].v)) console.log(`  ${k.padEnd(34)} | ${String(b.n).padStart(3)} | ${f(b.v).padStart(13)}`);
})().catch(e=>{console.error("ERRO:",e && e.stack||e);process.exit(1);});
