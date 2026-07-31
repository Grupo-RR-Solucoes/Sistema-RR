/*
 * DIAG 31/07/2026 — RECONCILIACAO FECHADA dos R$ 63.952,12. READ-ONLY.
 *
 * O QUE MEDE: le proposal_reassignments (a trilha de auditoria) e lista TODAS as
 * mudancas de 29 e 30/07/2026, separando as que saem de NULL (nao atribuida ->
 * promotor) das que sao remanejo entre promotores. Depois soma as saidas de NULL
 * posteriores ao horario do print (30/07/2026 11h19) e recorta as que ja
 * existiam naquela hora (movement_date <= 2026-07-29).
 *
 * RESULTADO EM 31/07/2026 — bate AO CENTAVO, sem tolerancia e sem combinatoria:
 *   as 4 "nao atribuidas" que a /projecao exibia em 30/07/2026 11h19 sao
 *     220630899  25.400,00 | mov 2026-07-29 | 30/07 17:47:46
 *     221118266     552,12 | mov 2026-07-29 | 30/07 17:48:06
 *     221116417  27.000,00 | mov 2026-07-29 | 30/07 17:48:52
 *     221153183  11.000,00 | mov 2026-07-29 | 30/07 17:49:12
 *     ------------------------------------------ SOMA 63.952,12
 *   atribuidas manualmente por financeiro@rrcred.srv.br em 30/07/2026
 *   17h47-17h49 — na MESMA tarde do print, ~6h30 depois. Fluxo normal.
 *
 * A 5a mudanca daquele dia (30/07 17:52:17, prop 221184463, 460,00) tem
 * from=promotor: e remanejo entre promotores, NAO sai de NULL, e por isso fica
 * de fora da conta.
 *
 * O lote AUTO_J_KEY de 31/07 12:01:39 nao tinha relacao nenhuma — ver o aviso
 * em scripts/diag-reconciliar-63952.cjs sobre reconciliar por soma.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const brl = n => Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
async function todas(t,c){const o=[];for(let p=0;;p++){const{data,error}=await sb.from(t).select(c).range(p*1000,p*1000+999);if(error)throw error;o.push(...(data??[]));if(!data||data.length<1000)break;}return o;}
(async()=>{
  const re = await todas("proposal_reassignments","id, daily_production_record_id, from_promoter_id, to_promoter_id, reason, changed_by, changed_at");
  const recs = await todas("daily_production_records","id, proposal_number, net_value, movement_date, status, is_srcc_restricted");
  const byId = new Map(recs.map(r=>[r.id,r]));
  const linha = (r) => { const d=byId.get(r.daily_production_record_id);
    return `  ${String(r.changed_at).slice(0,19)} | prop ${String(d?.proposal_number??"?").padEnd(12)} | ${brl(d?.net_value??0).padStart(12)} | mov ${d?.movement_date??"?"} | st=${String(d?.status??"?").padEnd(10)} | from=${r.from_promoter_id?"promotor":"NULL"} | by=${r.changed_by??"-"}`; };

  for (const dia of ["2026-07-29","2026-07-30"]) {
    const doDia = re.filter(r=>String(r.changed_at??"").startsWith(dia)).sort((a,b)=>String(a.changed_at).localeCompare(String(b.changed_at)));
    console.log(`\n=== TODAS as mudancas de ${dia} (${doDia.length}) ===`);
    for (const r of doDia) console.log(linha(r));
    const deNull = doDia.filter(r=>!r.from_promoter_id);
    const soma = deNull.reduce((a,r)=>a+Number(byId.get(r.daily_production_record_id)?.net_value??0),0);
    console.log(`  -> saindo de NULL: ${deNull.length} linha(s), soma ${brl(soma)}`);
  }

  // as que estavam NULL na foto de 30/07 11h19: saem de NULL em qualquer momento POSTERIOR
  const pos = re.filter(r=>!r.from_promoter_id && String(r.changed_at) >= "2026-07-30T11:19:00")
                .sort((a,b)=>String(a.changed_at).localeCompare(String(b.changed_at)));
  console.log(`\n=== NULL -> promotor a partir de 2026-07-30 11h19 (${pos.length}) ===`);
  let s=0; for (const r of pos){ const d=byId.get(r.daily_production_record_id); s+=Number(d?.net_value??0); console.log(linha(r)); }
  console.log(`  SOMA TOTAL = ${brl(s)}   | alvo 63.952,12 -> ${Math.abs(s-63952.12)<0.02?"BATE":"NAO bate"}`);
  const antesDoPrint = pos.filter(r=>String(byId.get(r.daily_production_record_id)?.movement_date??"") <= "2026-07-29");
  const s2 = antesDoPrint.reduce((a,r)=>a+Number(byId.get(r.daily_production_record_id)?.net_value??0),0);
  console.log(`  subconjunto com movement_date <= 2026-07-29 (existia na hora do print): ${antesDoPrint.length} linha(s), soma ${brl(s2)} -> ${Math.abs(s2-63952.12)<0.02?"BATE":"NAO bate"}`);
})();
