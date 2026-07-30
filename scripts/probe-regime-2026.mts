import fs from "node:fs"; import path from "node:path"; import { createClient } from "@supabase/supabase-js";
for (const a of [".env.local",".env"]) { const p=path.join(process.cwd(),a); if(!fs.existsSync(p))continue;
 for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"");}}
const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
console.log("regime REAL por competencia (lib/cmsMonthly.detectMonthRegime):");
for (const m of [1,2,3,4,5,6,7]) {
  const r = await detectMonthRegime(sb as any, 2026, m);
  console.log(`   2026-${String(m).padStart(2,"0")}: ${r}${r!=="open"?"   <- FECHADA":""}`);
}
const {data:act}=await sb.from("companies").select("id,name").eq("active",true);
console.log(`\nempresas ativas: ${(act||[]).length} -> ${(act||[]).map((e:any)=>e.name).join(", ")}`);
