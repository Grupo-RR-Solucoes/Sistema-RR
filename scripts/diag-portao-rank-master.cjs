/*
 * DIAG 31/07/2026 — PORTAO do "rank sem master" (commit e133868, PR #123).
 * Mede o ANTES x DEPOIS do filtro is_master no rank da /projecao. READ-ONLY.
 *
 * O QUE MEDE, na competencia 2026-07: (1) producao total do grupo com e sem os
 * masters no rank; (2) meta do grupo ADS com e sem; (3) contagem de "em risco";
 * (4) o % projetado por CNPJ, para ver o tratamento de meta zero.
 *
 * RESULTADO EM 31/07/2026:
 *   - PRODUCAO: rank 54 -> 49 (5 masters ativos removidos), producao
 *     6.072.963,64 -> 6.072.963,64, DELTA 0,00. Os 5 masters tem producao
 *     atribuida 0,00 cada. Confirma: muda a LISTA, nao os numeros.
 *   - META ADS: 896.000,00 -> 596.000,00 (sai a master MARIA EDUARDA, meta
 *     300.000,00). ATENCAO: o commit original dizia "300k -> 0" porque em
 *     17/07/2026 a master ERA o rank inteiro da ADS; hoje ha 6 promotores ADS
 *     com meta propria somando 596k. O efeito "meta do grupo vai a zero" NAO
 *     acontece mais.
 *   - EM RISCO: 20 -> 19. Delta -1, mesma causa de sempre (so a master ADS tem
 *     meta). A base absoluta e que mudou (era 22 -> 21 em 17/07).
 *   - DIVISAO POR ZERO: nao existe. meta 0 -> percent_projetado null
 *     (projecaoMetas.ts:374/493/520) -> semaforo "sem_meta" (:167) -> a tela
 *     imprime "—" (app/projecao/page.tsx:149 pctTxt) e "Sem meta" (:345).
 *     Em 31/07 nenhum CNPJ esta com meta 0, entao todos mostram % normal.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { loadPromoterAnalyticsBase } = require("../lib/promoterAnalytics.ts");
const { buildProjecaoMetas, consolidarGrupoEquipe, promotoresEmRisco } = require("../lib/projecaoMetas.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const brl = n => Number(n).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const Y=2026,M=7;
(async()=>{
  console.log(`PORTAO — competencia ${Y}-${String(M).padStart(2,"0")} | medido em 31/07/2026\n`);
  const base = await loadPromoterAnalyticsBase(sb,{year:Y,month:M});
  const isM = id => base.promoterById.get(id)?.is_master === true;
  const ativos = base.filteredSummaryRows.filter(r=>r.active);
  const antes  = ativos;                      // sem o filtro (estado pre-fix)
  const depois = ativos.filter(r=>!isM(r.promoter_id)); // com o filtro (codigo atual)
  const masters = ativos.filter(r=>isM(r.promoter_id));

  console.log(`=== 1) PRODUCAO TOTAL DO GRUPO ===`);
  const prodAntes  = antes.reduce((a,r)=>a+Number(r.production_value??0),0);
  const prodDepois = depois.reduce((a,r)=>a+Number(r.production_value??0),0);
  console.log(`  linhas no rank: antes ${antes.length} -> depois ${depois.length} (masters removidos: ${masters.length})`);
  console.log(`  producao (production_value) antes  = ${brl(prodAntes)}`);
  console.log(`  producao (production_value) depois = ${brl(prodDepois)}`);
  console.log(`  DELTA = ${brl(prodAntes-prodDepois)}`);
  console.log(`  producao atribuida a masters: ${masters.map(m=>`${m.promoter_name}=${brl(m.production_value??0)}`).join(" | ")||"(nenhum)"}`);
  const res = await buildProjecaoMetas(sb,{year:Y,month:M});
  const cons = consolidarGrupoEquipe(res);
  console.log(`  consolidarGrupoEquipe (codigo atual): producao ${brl(cons.producao_acumulada)} | projecao ${brl(cons.projecao)} | meta ${brl(cons.meta)}`);

  console.log(`\n=== 2) META DO GRUPO ADS ===`);
  const ads = (base.companies||[]).find(c=>/ADS/i.test(c.name));
  const adsAntes  = antes.filter(r=>r.company_id===ads.id);
  const adsDepois = depois.filter(r=>r.company_id===ads.id);
  const mAntes  = adsAntes.reduce((a,r)=>a+Number(r.target_value??0),0);
  const mDepois = adsDepois.reduce((a,r)=>a+Number(r.target_value??0),0);
  console.log(`  ${ads.name}: rank ${adsAntes.length} -> ${adsDepois.length}`);
  console.log(`  meta ADS antes  = ${brl(mAntes)}`);
  console.log(`  meta ADS depois = ${brl(mDepois)}`);
  for (const r of adsAntes.filter(r=>isM(r.promoter_id))) console.log(`    master removida: ${r.promoter_name} meta=${brl(r.target_value??0)}`);
  console.log(`  promotores ADS com meta (pos-fix): ${adsDepois.filter(r=>Number(r.target_value??0)>0).length} de ${adsDepois.length}`);

  console.log(`\n=== 3) EM RISCO (semaforo vermelho) ===`);
  const riscoDepois = promotoresEmRisco(res).length;
  const mastersComMeta = masters.filter(r=>Number(r.target_value??0)>0);
  console.log(`  em risco DEPOIS (codigo atual) = ${riscoDepois}`);
  console.log(`  masters ativos COM meta = ${mastersComMeta.length} -> ${mastersComMeta.map(r=>`${r.promoter_name} meta=${brl(r.target_value??0)}`).join(" | ")||"(nenhum)"}`);
  console.log(`  em risco ANTES = ${riscoDepois + mastersComMeta.length} (master com meta e producao 0 => 0% => vermelho)`);

  console.log(`\n=== 4) % PROJETADO quando meta = 0 ===`);
  const grupos = require("../lib/projecaoMetas.ts").agruparPorCnpj(res);
  for (const g of grupos) console.log(`  ${String(g.company_name).padEnd(26)} meta=${brl(g.meta).padStart(14)} projecao=${brl(g.projecao).padStart(14)} percent_projetado=${JSON.stringify(g.percent_projetado)} semaforo=${g.semaforo}`);
})();
