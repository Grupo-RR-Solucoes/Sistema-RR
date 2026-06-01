// FIX-8 — Correcao das 2 props Credito Salario da Thaynara com a_vista STALE.
// Props 208996235 e 210464220: company_received_percent gravado = 4,34% (Faixa 2,
// valor velho que bloqueava a regra importada por precedencia stored>imported).
// Correto = 4,48% (Faixa 3), confirmado pelo PDF oficial TRP 2026/187 (3.2,
// 4,30-4,75%) e pela tabela importada. Share preservado (0,75 = ACORDO_FIXO).
//
// Escopo: SOMENTE estas 2 props + re-ajuste por DELTA do PMR da Thaynara.
// NAO toca em nenhuma outra proposta nem em outro promotor.
// Idempotente: so age se avista atual == 4,34.
// Backup previo: scratch/sistema_rr/fix8_backup_thaynara.json
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const ENV="C:/Users/diego/Documents/Codex/2026-04-20-files-mentioned-by-the-user-sistema/repo/Sistema-RR-main/.env.local";
const env=Object.fromEntries(fs.readFileSync(ENV,"utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const THAY="357d85d6-84e9-46d0-a5c1-31cdb893d355";
const PROPS=["208996235","210464220"];
const AVISTA_OK=4.48, AVISTA_STALE=4.34;
const round2=(n)=>Math.round(n*100)/100;
const round4=(n)=>Math.round(n*1e4)/1e4;

const { data: rows }=await sb.from("daily_production_records")
  .select("id, proposal_number, net_value, company_received_percent, promoter_commission_percent, promoter_commission_amount, assigned_promoter_id")
  .in("proposal_number",PROPS);

let delta=0; const antes=[]; const depois=[];
for(const r of rows){
  if(String(r.assigned_promoter_id)!==THAY){ console.log(`SKIP ${r.proposal_number}: nao e da Thaynara`); continue; }
  antes.push({prop:r.proposal_number, avista:r.company_received_percent, promPct:r.promoter_commission_percent, promAmt:r.promoter_commission_amount});
  if(Math.abs(Number(r.company_received_percent)-AVISTA_STALE)>0.001){
    console.log(`SKIP ${r.proposal_number}: avista atual=${r.company_received_percent} (nao e 4,34 — ja corrigido?)`);
    continue;
  }
  const share=round4(Number(r.promoter_commission_percent)/Number(r.company_received_percent)); // 0.75
  const newPct=round4(AVISTA_OK*share);                 // 3.36
  const newAmt=round2(Number(r.net_value)*(AVISTA_OK/100)*share);
  delta+=newAmt-Number(r.promoter_commission_amount);
  const { error }=await sb.from("daily_production_records")
    .update({ company_received_percent:AVISTA_OK, promoter_commission_percent:newPct, promoter_commission_amount:newAmt })
    .eq("id", r.id).eq("proposal_number", r.proposal_number);
  if(error) throw error;
  depois.push({prop:r.proposal_number, avista:AVISTA_OK, promPct:newPct, promAmt:newAmt});
}
delta=round2(delta);
console.log("Delta credito aplicado:", delta);

// PMR: ajuste por delta (preserva tudo o mais; nao re-agrega outros promotores)
if(delta!==0){
  const { data: pmr }=await sb.from("promoter_monthly_results")
    .select("production_commission_value, final_commission_value")
    .eq("promoter_id",THAY).eq("year",2026).eq("month",4).maybeSingle();
  const newProd=round2(Number(pmr.production_commission_value)+delta);
  const newFinal=round2(Number(pmr.final_commission_value)+delta);
  const { error }=await sb.from("promoter_monthly_results")
    .update({ production_commission_value:newProd, final_commission_value:newFinal })
    .eq("promoter_id",THAY).eq("year",2026).eq("month",4);
  if(error) throw error;
  console.log(`PMR production ${pmr.production_commission_value} -> ${newProd}`);
  console.log(`PMR final ${pmr.final_commission_value} -> ${newFinal}`);
} else {
  console.log("Delta=0: nada a aplicar no PMR (idempotente).");
}

// verificacao depois
const { data: after }=await sb.from("daily_production_records")
  .select("proposal_number, company_received_percent, promoter_commission_percent, promoter_commission_amount")
  .in("proposal_number",PROPS);
const { data: pmrAfter }=await sb.from("promoter_monthly_results")
  .select("production_commission_value, insurance_commission_value, final_commission_value")
  .eq("promoter_id",THAY).eq("year",2026).eq("month",4).maybeSingle();
console.log("\n=== DEPOIS ===");
console.table(after);
console.log("PMR Thaynara:", JSON.stringify(pmrAfter));
