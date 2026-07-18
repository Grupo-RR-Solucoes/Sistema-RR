/*
 * GATE — /projecao rank sem master (bug geral). MUDA A LISTA: o master sai do rank
 * das 5 empresas. READ-ONLY (le prod). Prova: master fora do rank; numeros de
 * producao/projecao INALTERADOS (master produz 0); ADS rank vazio nao quebra;
 * meta do grupo ADS cai 300k->0 (a meta da empresa estava parkeada no master).
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe, promotoresEmRisco } = require("../lib/projecaoMetas.ts");
const { loadPromoterAnalyticsBase } = require("../lib/promoterAnalytics.ts");
const { competenciaDaDataContrato } = require("../lib/motor.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let falhas=0; const ok=(c,m)=>{console.log(`  ${c?"OK ":"XX "} ${m}`); if(!c)falhas++;};
const elig=r=>{const s=String(r.status||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().trim(); return (s==="PRODUCAO"||s==="PRODUCTION")&&r.is_srcc_restricted!==true;};

(async()=>{
  const {data:cos}=await sb.from("companies").select("id,name").in("name",["RR ALAGOAS 1","RR ALAGOAS 2","RR ALAGOAS 3","RR PERNAMBUCO","ADS Consultoria Negocial"]);
  const order=["RR ALAGOAS 1","RR ALAGOAS 2","RR ALAGOAS 3","RR PERNAMBUCO","ADS Consultoria Negocial"];
  cos.sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name));

  console.log("=== A) as 5 empresas: master sai do rank (antes -> depois) ===");
  for(const c of cos){
    const base = await loadPromoterAnalyticsBase(sb, {year:2026, month:7, companyId:c.id});
    const isM = id => base.promoterById.get(id)?.is_master === true;
    const antes = base.filteredSummaryRows.filter(r=>r.active).length;
    const depois = base.filteredSummaryRows.filter(r=>r.active && !isM(r.promoter_id)).length;
    const res = await buildProjecaoMetas(sb, {year:2026, month:7, companyId:c.id});
    const semMaster = res.promotores.every(p=>!isM(p.promoter_id));
    console.log(`  ${c.name.padEnd(24)} rank ${antes} -> ${depois} | buildProjecao.promotores=${res.promotores.length}`);
    ok(antes-depois===1, `${c.name}: exatamente 1 master removido`);
    ok(res.promotores.length===depois, `${c.name}: buildProjecao bate com o filtrado (${res.promotores.length}==${depois})`);
    ok(semMaster, `${c.name}: NENHUM master no rank`);
  }

  // B) ADS rank VAZIO nao quebra
  console.log("\n=== B) ADS rank vazio nao quebra ===");
  const ads = cos.find(c=>/ADS/.test(c.name));
  const resAds = await buildProjecaoMetas(sb, {year:2026, month:7, companyId:ads.id});
  ok(resAds.promotores.length===0, `ADS rank = 0 promotores`);
  const grpAds = consolidarGrupoEquipe(resAds); // nao deve lancar
  const riscoAds = promotoresEmRisco(resAds);
  ok(Array.isArray(riscoAds) && riscoAds.length===0, `ADS em risco = 0 (sem throw)`);
  ok(grpAds && Number.isFinite(grpAds.producao_acumulada), `ADS consolidarGrupoEquipe roda (producao=${grpAds.producao_acumulada}, meta=${grpAds.meta})`);
  ok(grpAds.meta===0, `ADS meta do grupo AGORA = 0 (antes 300000; a meta da empresa estava na master) -> MUDA numero de META`);

  // C) producao/projecao INALTERADOS: nenhum master tem producao atribuida
  console.log("\n=== C) producao/projecao inalterados (master produz 0) ===");
  const {data:masters}=await sb.from("promoters").select("id").eq("is_master",true);
  const mid=new Set(masters.map(m=>m.id));
  const {data:d}=await sb.from("daily_production_records").select("assigned_promoter_id,net_value,status,is_srcc_restricted,movement_date,contract_date,proposal_date");
  const julMasterProd=d.filter(r=>{const dt=r.movement_date||r.contract_date||r.proposal_date; return competenciaDaDataContrato(dt?String(dt).slice(0,10):null)==="2026-07" && mid.has(r.assigned_promoter_id) && elig(r);});
  ok(julMasterProd.length===0, `0 linhas de julho atribuidas a master (elegiveis) -> remover master NAO muda producao/projecao`);

  // D) em risco GLOBAL cai 1 (so a Maria Eduarda master tinha meta)
  console.log("\n=== D) em risco global -1 (so a master ADS tinha meta) ===");
  const resG = await buildProjecaoMetas(sb, {year:2026, month:7});
  const riscoG = promotoresEmRisco(resG);
  const {data:mt}=await sb.from("monthly_targets").select("promoter_id,meta").eq("year",2026).eq("month",7);
  const masterComMeta=(mt||[]).filter(m=>mid.has(m.promoter_id) && Number(m.meta)>0);
  const semMasterNoRisco = riscoG.every(p=>!mid.has(p.promoter_id));
  console.log(`  em risco global AGORA: ${riscoG.length} | antes (com masters vermelhos): ${riscoG.length+masterComMeta.length}`);
  ok(masterComMeta.length===1, `apenas 1 master tem meta jul (a ADS R$300k) -> em risco cai exatamente 1`);
  ok(semMasterNoRisco, `nenhum master no 'em risco' pos-fix`);

  console.log("\n===================== VEREDITO =====================");
  if(falhas===0){console.log("  OK — master fora do rank das 5; producao/projecao inalterados; ADS vazio nao quebra; meta grupo ADS 300k->0; em risco -1.");process.exit(0);}
  else{console.log(`  FALHA — ${falhas} assercao(oes).`);process.exit(2);}
})().catch(e=>{console.error("ERRO INFRA:",e);process.exit(3);});
