// SOMENTE LEITURA — quem perde linha por ler contract_date SEM fallback.
import fs from "node:fs"; import path from "node:path"; import { createClient } from "@supabase/supabase-js";
for (const a of [".env.local",".env"]) { const p=path.join(process.cwd(),a); if(!fs.existsSync(p))continue;
 for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");}}
process.env.TRP_SOURCE="db";
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const brl=(n:number)=>Number(n||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const p2=(n:number)=>String(n).padStart(2,"0");
const {data:emps}=await sb.from("companies").select("id,name");
const nome=new Map((emps||[]).map((e:any)=>[e.id,e.name]));
async function pag<T>(f:()=>any):Promise<T[]>{let de=0;const o:T[]=[];for(;;){const{data,error}=await f().order("id").range(de,de+999);if(error)throw new Error(error.message);o.push(...((data||[])as T[]));if(!data||data.length<1000)break;de+=1000;}return o;}
const todos=await pag<any>(()=>sb.from("daily_production_records").select("id, company_id, proposal_number, net_value, status, is_srcc_restricted, movement_date, contract_date, proposal_date"));
const comp=(r:any)=>{const p=getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date);return p?`${p.year}-${p2(p.month)}`:"??";};
const semCD=todos.filter(r=>!r.contract_date);
console.log("=".repeat(96));
console.log("LINHAS DA DIARIA SEM contract_date — as que os leitores sem fallback perdem");
console.log("=".repeat(96));
console.log(`\ntotal na diaria: ${todos.length}   sem contract_date: ${semCD.length}   (${((semCD.length/todos.length)*100).toFixed(1)}%)`);
const porComp=new Map<string,{n:number;net:number;prod:number;netProd:number}>();
for(const r of semCD){const k=comp(r);const a=porComp.get(k)||{n:0,net:0,prod:0,netProd:0};a.n++;a.net+=num(r.net_value);
 const eh=String(r.status??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().startsWith("PRODU");
 if(eh&&r.is_srcc_restricted!==true){a.prod++;a.netProd+=num(r.net_value);} porComp.set(k,a);}
console.log("\ncomp     linhas sem CD   net             dessas em PRODUCAO   net em PRODUCAO");
for(const [k,v] of [...porComp.entries()].sort())
  console.log(`${k}  ${String(v.n).padStart(13)}   R$ ${brl(v.net).padStart(14)}   ${String(v.prod).padStart(18)}   R$ ${brl(v.netProd)}`);
const porEmp=new Map<string,number>();
for(const r of semCD) porEmp.set(String(nome.get(r.company_id)),(porEmp.get(String(nome.get(r.company_id)))||0)+1);
console.log("\npor empresa:");
for(const [k,v] of [...porEmp.entries()].sort((a,b)=>b[1]-a[1])) console.log(`   ${String(v).padStart(5)}  ${k}`);
