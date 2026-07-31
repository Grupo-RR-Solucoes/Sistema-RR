/*
 * DIAG 31/07/2026 — existe trilha de auditoria de ATRIBUICAO? READ-ONLY.
 *
 * O QUE MEDE: prova que proposal_reassignments e audit_logs existem em prod e
 * lista o historico de proposal_reassignments (daily_production_record_id,
 * from_promoter_id, to_promoter_id, reason, changed_by, changed_at), por dia.
 * from_promoter_id NULL significa literalmente "estava NAO ATRIBUIDA".
 * Depois filtra as saidas de NULL ocorridas em 2026-07-31.
 *
 * RESULTADO EM 31/07/2026:
 *   - proposal_reassignments EXISTE, 232 linhas (migration
 *     20260420_000001_rr_foundation.sql:55). audit_logs tambem existe.
 *     daily_production_records NAO tem previous_promoter_id.
 *   - saidas de NULL em 31/07: 4 linhas, soma 40.521,15, movement_date
 *     2026-07-30 -> NAO sao as 4 do print de 30/07 11h19 (aquela producao nem
 *     existia ainda). Ver diag-hist-atribuicao2.cjs, que fecha a conta.
 *
 * A RESPOSTA (medida no script 2): as 4 nao atribuidas do print eram
 *   220630899  25.400,00 | 221118266     552,12
 *   221116417  27.000,00 | 221153183  11.000,00   -> SOMA 63.952,12
 * atribuidas em 30/07/2026 17h47-17h49 por financeiro@rrcred.srv.br.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const brl = n => Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function todas(t,c){const o=[];for(let p=0;;p++){const{data,error}=await sb.from(t).select(c).range(p*1000,p*1000+999);if(error)throw error;o.push(...(data??[]));if(!data||data.length<1000)break;}return o;}
(async()=>{
  // 1) a tabela existe/tem dados em prod?
  const ra = await sb.from("proposal_reassignments").select("*").limit(1);
  console.log(`proposal_reassignments -> ${ra.error ? "ERRO: "+ra.error.message : "OK, colunas: "+Object.keys(ra.data?.[0]??{}).join(", ")}`);
  const al = await sb.from("audit_logs").select("*").limit(1);
  console.log(`audit_logs             -> ${al.error ? "ERRO: "+al.error.message : "OK, colunas: "+Object.keys(al.data?.[0]??{}).join(", ")}`);
  if (ra.error) return;

  const todosRe = await todas("proposal_reassignments","id, daily_production_record_id, from_promoter_id, to_promoter_id, reason, changed_by, changed_at");
  console.log(`\nlinhas em proposal_reassignments (total): ${todosRe.length}`);
  if (todosRe.length === 0) { console.log("TABELA VAZIA em producao."); return; }
  const porDia = new Map();
  for (const r of todosRe) { const d=String(r.changed_at??"").slice(0,10); porDia.set(d,(porDia.get(d)??0)+1); }
  console.log("por dia:"); for (const [d,n] of [...porDia].sort()) console.log(`  ${d}: ${n}`);

  // 2) as que SAIRAM de NULL (nao atribuida -> promotor) em 2026-07-31
  const alvo = todosRe.filter(r => !r.from_promoter_id && String(r.changed_at??"").startsWith("2026-07-31"));
  console.log(`\nfrom_promoter_id NULL (estava NAO ATRIBUIDA) e changed_at em 2026-07-31: ${alvo.length} linha(s)`);
  if (alvo.length === 0) return;
  const recs = await todas("daily_production_records","id, proposal_number, net_value, movement_date, status, is_srcc_restricted, company_id");
  const byId = new Map(recs.map(r=>[r.id,r]));
  let soma = 0;
  for (const r of alvo.sort((a,b)=>String(a.changed_at).localeCompare(String(b.changed_at)))) {
    const d = byId.get(r.daily_production_record_id);
    const v = Number(d?.net_value??0); soma += v;
    console.log(`  ${String(r.changed_at).slice(0,19)} | prop ${String(d?.proposal_number??"?").padEnd(12)} | ${brl(v).padStart(12)} | mov ${d?.movement_date??"?"} | st=${d?.status??"?"} | by=${r.changed_by??"-"} | reason=${r.reason??"-"}`);
  }
  console.log(`  SOMA = ${brl(soma)}  (alvo 63.952,12 -> ${Math.abs(soma-63952.12)<0.02?"BATE":"NAO bate"})`);
})();
