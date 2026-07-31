/*
 * GATE — /projecao rank sem master (bug geral). MUDA A LISTA: o master sai do
 * rank das 5 empresas. READ-ONLY (le prod).
 *
 * MEDE DELTA, NAO VALOR ABSOLUTO. A primeira versao (17/07/2026) cravou os
 * numeros daquele dia — "ADS rank = 0", "meta do grupo ADS = 0", "em risco 22
 * -> 21" — e passou a falhar sozinha quando a ADS ganhou promotores reais com
 * meta propria (em 31/07/2026 ja eram 6, somando 596k). O efeito do fix nunca
 * mudou; o que envelheceu foi a fotografia. Por isso, aqui, NENHUMA assercao
 * depende de quantos promotores uma empresa tem hoje:
 *
 *   - producao total do grupo   : delta EXATAMENTE 0,00
 *   - linhas do rank            : cai exatamente o nº de masters ATIVOS
 *   - meta do grupo             : cai exatamente a soma das metas parkeadas em masters
 *   - em risco                  : cai exatamente o nº de masters ATIVOS COM meta
 *   - nenhum is_master === true no rank
 *
 * Se um dia nao houver master ativo em alguma empresa, os deltas viram 0 e o
 * gate segue passando — o que se afirma e a IGUALDADE, nao a quantidade.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe, promotoresEmRisco } = require("../lib/projecaoMetas.ts");
const { loadPromoterAnalyticsBase } = require("../lib/promoterAnalytics.ts");
const { competenciaDaDataContrato } = require("../lib/motor.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const YEAR = 2026;
const MONTH = 7;

let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "XX "} ${m}`); if (!c) falhas++; };
const elig = r => { const s = String(r.status || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim(); return (s === "PRODUCAO" || s === "PRODUCTION") && r.is_srcc_restricted !== true; };
const brl = n => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// dinheiro em CENTAVOS inteiros: "delta exatamente 0,00" nao pode depender de float
const cents = n => Math.round(Number(n ?? 0) * 100);
const soma = (rows, campo) => rows.reduce((a, r) => a + cents(r[campo]), 0);

(async () => {
  const { data: cos } = await sb.from("companies").select("id,name").in("name", ["RR ALAGOAS 1", "RR ALAGOAS 2", "RR ALAGOAS 3", "RR PERNAMBUCO", "ADS Consultoria Negocial"]);
  const order = ["RR ALAGOAS 1", "RR ALAGOAS 2", "RR ALAGOAS 3", "RR PERNAMBUCO", "ADS Consultoria Negocial"];
  cos.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  console.log(`GATE rank sem master — competencia ${YEAR}-${String(MONTH).padStart(2, "0")} — assercoes por DELTA\n`);
  console.log("=== A) por empresa: rank cai exatamente o nº de masters ativos ===");
  for (const c of cos) {
    const base = await loadPromoterAnalyticsBase(sb, { year: YEAR, month: MONTH, companyId: c.id });
    const isM = id => base.promoterById.get(id)?.is_master === true;
    const ativos = base.filteredSummaryRows.filter(r => r.active);
    const masters = ativos.filter(r => isM(r.promoter_id));
    const esperado = ativos.length - masters.length;

    const res = await buildProjecaoMetas(sb, { year: YEAR, month: MONTH, companyId: c.id });
    const semMaster = res.promotores.every(p => !isM(p.promoter_id));

    // producao e meta: ANTES (com masters) x DEPOIS (sem), em centavos
    const prodAntes = soma(ativos, "production_value");
    const prodDepois = soma(ativos.filter(r => !isM(r.promoter_id)), "production_value");
    const metaMasters = soma(masters, "target_value");
    const metaAntes = soma(ativos, "target_value");
    const metaDepois = soma(ativos.filter(r => !isM(r.promoter_id)), "target_value");
    const grp = consolidarGrupoEquipe(res); // nao pode lancar, mesmo com rank vazio

    console.log(`  ${c.name.padEnd(24)} rank ${ativos.length} -> ${res.promotores.length} (masters ativos: ${masters.length}) | meta ${brl(metaAntes / 100)} -> ${brl(metaDepois / 100)} | prod delta ${brl((prodAntes - prodDepois) / 100)}`);
    ok(res.promotores.length === esperado, `${c.name}: rank cai exatamente ${masters.length} (master(s) ativo(s)) -> ${res.promotores.length}==${esperado}`);
    ok(semMaster, `${c.name}: NENHUM is_master no rank`);
    ok(prodAntes - prodDepois === 0, `${c.name}: producao delta EXATAMENTE 0,00 (veio ${brl((prodAntes - prodDepois) / 100)})`);
    ok(metaAntes - metaDepois === metaMasters, `${c.name}: meta cai exatamente a soma parkeada nos masters (${brl(metaMasters / 100)})`);
    ok(grp && Number.isFinite(grp.producao_acumulada) && Number.isFinite(grp.meta), `${c.name}: consolidarGrupoEquipe roda com rank de ${res.promotores.length} linha(s), sem quebrar`);
    // meta 0 nunca vira divisao por zero
    ok(grp.meta > 0 ? grp.percent_projetado !== null : grp.percent_projetado === null,
      `${c.name}: meta ${grp.meta > 0 ? ">0 -> percent numerico" : "= 0 -> percent null (semaforo ${grp.semaforo})"}`);
  }

  console.log("\n=== B) GLOBAL: producao inalterada, meta e risco caem exatamente o parkeado nos masters ===");
  const baseG = await loadPromoterAnalyticsBase(sb, { year: YEAR, month: MONTH });
  const isMG = id => baseG.promoterById.get(id)?.is_master === true;
  const ativosG = baseG.filteredSummaryRows.filter(r => r.active);
  const mastersG = ativosG.filter(r => isMG(r.promoter_id));
  const mastersComMeta = mastersG.filter(r => cents(r.target_value) > 0);

  const prodAntesG = soma(ativosG, "production_value");
  const prodDepoisG = soma(ativosG.filter(r => !isMG(r.promoter_id)), "production_value");
  const metaMastersG = soma(mastersG, "target_value");
  const metaAntesG = soma(ativosG, "target_value");
  const metaDepoisG = soma(ativosG.filter(r => !isMG(r.promoter_id)), "target_value");

  const resG = await buildProjecaoMetas(sb, { year: YEAR, month: MONTH });
  const riscoG = promotoresEmRisco(resG);

  console.log(`  rank global   : ${ativosG.length} -> ${resG.promotores.length} (masters ativos: ${mastersG.length})`);
  console.log(`  producao      : ${brl(prodAntesG / 100)} -> ${brl(prodDepoisG / 100)}  (delta ${brl((prodAntesG - prodDepoisG) / 100)})`);
  console.log(`  meta          : ${brl(metaAntesG / 100)} -> ${brl(metaDepoisG / 100)}  (parkeado em masters: ${brl(metaMastersG / 100)})`);
  console.log(`  em risco      : ${riscoG.length + mastersComMeta.length} -> ${riscoG.length}  (masters ativos COM meta: ${mastersComMeta.length})`);
  for (const m of mastersComMeta) console.log(`    master com meta: ${m.promoter_name} meta=${brl(cents(m.target_value) / 100)} producao=${brl(cents(m.production_value) / 100)}`);

  ok(resG.promotores.length === ativosG.length - mastersG.length, `rank global cai exatamente ${mastersG.length}`);
  ok(prodAntesG - prodDepoisG === 0, `producao total do grupo: delta EXATAMENTE 0,00 (veio ${brl((prodAntesG - prodDepoisG) / 100)})`);
  ok(metaAntesG - metaDepoisG === metaMastersG, `meta do grupo cai exatamente o parkeado nos masters (${brl(metaMastersG / 100)})`);
  ok(riscoG.every(p => !isMG(p.promoter_id)), `nenhum master no 'em risco' pos-fix`);
  // O delta do risco NAO se afirma por soma (isso seria tautologia: antes :=
  // depois + n). Afirma-se a PREMISSA que o torna verdadeiro: todo master ativo
  // com meta tem producao 0 -> projecao 0 -> 0% -> vermelho garantido antes do
  // fix; e todo master ativo SEM meta cai em "sem_meta", que nunca entra no
  // risco. Com as duas verdadeiras, o delta e exatamente mastersComMeta.length.
  ok(mastersComMeta.every(m => cents(m.production_value) === 0),
    `todo master ativo COM meta tem producao 0,00 -> seria vermelho antes do fix (${mastersComMeta.length} master(es))`);
  ok(mastersG.filter(m => cents(m.target_value) === 0).every(m => cents(m.production_value) === 0),
    `master ativo SEM meta -> "sem_meta", fora do risco nas duas pontas (${mastersG.length - mastersComMeta.length} master(es))`);

  // C) producao atribuida a master no diario da competencia: tem que ser 0
  console.log("\n=== C) o diario confirma: master nao tem producao atribuida ===");
  const { data: mrows } = await sb.from("promoters").select("id").eq("is_master", true);
  const mid = new Set((mrows || []).map(m => m.id));
  const { data: d } = await sb.from("daily_production_records").select("assigned_promoter_id,net_value,status,is_srcc_restricted,movement_date,contract_date,proposal_date");
  const comp = `${YEAR}-${String(MONTH).padStart(2, "0")}`;
  const masterProd = (d || []).filter(r => {
    const dt = r.movement_date || r.contract_date || r.proposal_date;
    return competenciaDaDataContrato(dt ? String(dt).slice(0, 10) : null) === comp && mid.has(r.assigned_promoter_id) && elig(r);
  });
  console.log(`  linhas de ${comp} atribuidas a master (elegiveis): ${masterProd.length} | soma ${brl(masterProd.reduce((a, r) => a + Number(r.net_value ?? 0), 0))}`);
  ok(masterProd.reduce((a, r) => a + cents(r.net_value), 0) === 0, `producao atribuida a master = 0,00 -> e por isso que o delta de producao e 0`);

  console.log("\n===================== VEREDITO =====================");
  if (falhas === 0) {
    console.log("  OK — todos os deltas conferem: producao 0,00; rank -nº masters; meta -parkeado; risco -masters com meta; nenhum master no rank.");
    process.exit(0);
  }
  console.log(`  FALHA — ${falhas} assercao(oes).`);
  process.exit(2);
})().catch(e => { console.error("ERRO INFRA:", e); process.exit(3); });
