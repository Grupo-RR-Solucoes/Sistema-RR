// ============================================================================
// scripts/gate_daily_nao_toca_ads.cjs — prova que a rota de calculo DIARIA do RR
// (app/api/calculate/monthly/route.ts) nao alcanca mais a ADS.
//
// Replica as DUAS formas das queries de escopo da rota (a ANTIGA, cega a
// empresas, e a NOVA com a trava semAds) contra o banco real e conta quantas
// linhas da ADS cada uma traria, no cenario que causava o estrago:
// companyId ausente -> scopeIds = null -> escopo global.
//
// PASSA quando a forma NOVA traz 0 promotores e 0 registros da ADS (logo, 0
// upserts com company_id = ADS em promoter_monthly_results) e a ANTIGA traz > 0
// (senao o gate nao estaria provando nada).
//
//   node scripts/gate_daily_nao_toca_ads.cjs
// ============================================================================

const fs = require("fs");
const path = require("path");

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const { createClient } = require("@supabase/supabase-js");
const { BBTS_COMPANY_ID } = require("./_bbts_company_id.cjs");

const YEAR = Number(process.env.BBTS_YEAR || 2026);
const MONTH = Number(process.env.BBTS_MONTH || 7);

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const start = `${YEAR}-${String(MONTH).padStart(2, "0")}-01`;
  const endM = MONTH === 12 ? 1 : MONTH + 1;
  const endY = MONTH === 12 ? YEAR + 1 : YEAR;
  const end = `${endY}-${String(endM).padStart(2, "0")}-01`;

  // scopeIds = null (companyId ausente: o auto-recalculo pos-import).
  const scopeIds = null;
  const semAds = (query, col) =>
    scopeIds ? query.in(col, scopeIds.filter((id) => id !== BBTS_COMPANY_ID)) : query.neq(col, BBTS_COMPANY_ID);

  const count = async (build) => {
    const { data, error } = await build();
    if (error) throw new Error(error.message);
    return data;
  };

  // --- promoters ---
  const promAntigo = await count(() => sb.from("promoters").select("id, company_id").eq("active", true));
  const promNovo = await count(() => semAds(sb.from("promoters").select("id, company_id").eq("active", true), "company_id"));

  // --- daily_production_records ---
  const recAntigo = await count(() =>
    sb.from("daily_production_records").select("id, company_id").gte("movement_date", start).lt("movement_date", end)
  );
  const recNovo = await count(() =>
    semAds(
      sb.from("daily_production_records").select("id, company_id").gte("movement_date", start).lt("movement_date", end),
      "company_id"
    )
  );

  const ads = (rows) => rows.filter((r) => r.company_id === BBTS_COMPANY_ID).length;

  console.log(`### GATE — rota diaria do RR nao toca a ADS — ${YEAR}-${String(MONTH).padStart(2, "0")} ###\n`);
  console.log("cenario: companyId ausente -> scopeIds = null -> escopo GLOBAL\n");
  console.log("                                 ANTIGO (cego)      NOVO (com trava)");
  console.log(`promoters ADS no escopo........  ${String(ads(promAntigo)).padStart(6)}            ${String(ads(promNovo)).padStart(6)}`);
  console.log(`promoters TOTAL no escopo......  ${String(promAntigo.length).padStart(6)}            ${String(promNovo.length).padStart(6)}`);
  console.log(`daily_records ADS no escopo....  ${String(ads(recAntigo)).padStart(6)}            ${String(ads(recNovo)).padStart(6)}`);
  console.log(`daily_records TOTAL no escopo..  ${String(recAntigo.length).padStart(6)}            ${String(recNovo.length).padStart(6)}`);

  const naoAdsAntigo = promAntigo.length - ads(promAntigo);
  const naoAdsRecAntigo = recAntigo.length - ads(recAntigo);
  const problemas = [];
  if (ads(promNovo) !== 0) problemas.push(`NOVO ainda traz ${ads(promNovo)} promotor(es) da ADS`);
  if (ads(recNovo) !== 0) problemas.push(`NOVO ainda traz ${ads(recNovo)} registro(s) da ADS`);
  if (ads(promAntigo) === 0 && ads(recAntigo) === 0)
    problemas.push("ANTIGO nao trazia ADS nenhuma — o gate nao esta provando nada (sem ADS na competencia?)");
  // A trava tem de ser CIRURGICA: nao pode derrubar nada que nao seja da ADS.
  if (promNovo.length !== naoAdsAntigo) problemas.push(`NOVO mexeu em promotores NAO-ADS: ${promNovo.length} != ${naoAdsAntigo}`);
  if (recNovo.length !== naoAdsRecAntigo) problemas.push(`NOVO mexeu em registros NAO-ADS: ${recNovo.length} != ${naoAdsRecAntigo}`);

  console.log("");
  if (problemas.length) {
    console.log("FALHOU:");
    for (const p of problemas) console.log("  - " + p);
    process.exit(1);
  }
  console.log("PASSOU: a ADS saiu do escopo da rota diaria (0 promotores, 0 registros)");
  console.log("        e NADA fora da ADS mudou (contagens nao-ADS identicas).");
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
