/*
 * DIAG 31/07/2026 — a producao SEM promotor ("nao atribuidas"), que alimenta o
 * projetarMaster / naoAtribuido da /projecao. READ-ONLY.
 *
 * O QUE MEDE: (1) linhas do diario com assigned_promoter_id NULL + elegiveis,
 * agrupadas por competencia; (2) producao atribuida a promotor is_master;
 * (3) o que buildProjecaoMetas.naoAtribuido devolve em mai/jun/jul; (4) as
 * linhas de updated_at mais recente (indicio de atribuicao recente).
 *
 * RESULTADO EM 31/07/2026:
 *   - NULL + elegivel: ZERO em toda competencia. O 0,00 que os gates mediam e
 *     VERDADE, nao falha de carregamento — mas deixa projetarMaster sem
 *     cobertura com valor != 0.
 *   - existem 32 linhas NULL no diario (Sigma 427.518,40), TODAS descartadas pela
 *     elegibilidade: 28 Cancelado, 2 Em Aberto, 2 Producao com
 *     is_srcc_restricted=true (props 214230035 e 219558614).
 *   - master: so 3 linhas em 2026-04, 6.069,56.
 *   - naoAtribuido = {acumulada:0, projecao:0, count:0} em 2026-05/06/07.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { getProductionPeriodFromValue } = require("../lib/productionPeriod.ts");
const { buildProjecaoMetas, consolidarGrupoEquipe } = require("../lib/projecaoMetas.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const brl = n => Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const elig = r => { const s=String(r.status??"").normalize("NFD").replace(/[̀-ͯ]/g,"").trim().toUpperCase(); return (s==="PRODUCAO"||s==="PRODUCTION")&&r.is_srcc_restricted!==true; };
async function todas(t,c){const o=[];for(let p=0;;p++){const{data,error}=await sb.from(t).select(c).range(p*1000,p*1000+999);if(error)throw error;o.push(...(data??[]));if(!data||data.length<1000)break;}return o;}
(async()=>{
  const rows = await todas("daily_production_records","id, company_id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, updated_at");
  console.log(`diario total = ${rows.length} linhas\n`);

  // 1) NULL por competencia (o criterio do projetarMaster)
  const porComp = new Map();
  for (const r of rows) {
    if (r.assigned_promoter_id) continue;
    if (!elig(r)) continue;
    const c = getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date);
    if (!c) continue;
    const k = `${c.year}-${String(c.month).padStart(2,"0")}`;
    const cur = porComp.get(k) ?? {n:0,soma:0};
    porComp.set(k,{n:cur.n+1,soma:cur.soma+Number(r.net_value??0)});
  }
  console.log("1) assigned_promoter_id NULL + elegivel, POR COMPETENCIA:");
  if (porComp.size===0) console.log("   (nenhuma em nenhuma competencia)");
  for (const [k,v] of [...porComp].sort()) console.log(`   ${k}: ${v.n} linha(s), ${brl(v.soma)}`);

  // 2) atribuidas a promotor MASTER (outro conceito de "nao atribuida")
  const proms = await todas("promoters","id, name, is_master, company_id");
  const masters = new Set(proms.filter(p=>p.is_master).map(p=>p.id));
  console.log(`\n2) promotores is_master = ${masters.size}`);
  const porCompMaster = new Map();
  for (const r of rows) {
    if (!r.assigned_promoter_id || !masters.has(r.assigned_promoter_id)) continue;
    if (!elig(r)) continue;
    const c = getProductionPeriodFromValue(r.movement_date)||getProductionPeriodFromValue(r.contract_date)||getProductionPeriodFromValue(r.proposal_date);
    if (!c) continue;
    const k = `${c.year}-${String(c.month).padStart(2,"0")}`;
    const cur = porCompMaster.get(k) ?? {n:0,soma:0};
    porCompMaster.set(k,{n:cur.n+1,soma:cur.soma+Number(r.net_value??0)});
  }
  console.log("   producao atribuida a chave MASTER, por competencia:");
  if (porCompMaster.size===0) console.log("   (nenhuma)");
  for (const [k,v] of [...porCompMaster].sort()) console.log(`   ${k}: ${v.n} linha(s), ${brl(v.soma)}`);

  // 3) o valor 63.952,12 existe em algum recorte?
  const alvo = 63952.12;
  console.log(`\n3) procurando 63.952,12 / 4 propostas:`);
  for (const [k,v] of [...porComp,...porCompMaster]) if (Math.abs(v.soma-alvo)<1) console.log(`   BATE em ${k}: ${v.n} linhas ${brl(v.soma)}`);

  // 4) o motor, por competencia
  console.log("\n4) buildProjecaoMetas.naoAtribuido por competencia (o que a tela le):");
  for (const m of [5,6,7]) {
    const r = await buildProjecaoMetas(sb,{year:2026,month:m});
    const c = consolidarGrupoEquipe(r);
    console.log(`   2026-${String(m).padStart(2,"0")}: fechado=${r.fechado} nao_atribuido=${JSON.stringify(c.nao_atribuido)}`);
  }

  // 5) quando as ultimas NULL foram atribuidas
  const recentes = rows.filter(r=>r.assigned_promoter_id&&r.updated_at).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,5);
  console.log("\n5) 5 linhas com updated_at mais recente (indicio de atribuicao recente):");
  for (const r of recentes) console.log(`   ${String(r.updated_at).slice(0,19)} | net ${brl(r.net_value)} | mov ${r.movement_date}`);
})();
