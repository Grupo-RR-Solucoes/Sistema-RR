/*
 * PROVA de que o fix candidate-list NAO vaza para o PMR de mes FECHADO.
 *
 * Roda reconsolidarCompetenciaFechada em DRY-RUN (calcula o payload exato do
 * PMR fechado, RR+ADS via orquestrador, sem gravar/apagar NADA) e imprime um
 * hash deterministico do payload. Rodar no codigo PRE-fix e POS-fix: os hashes
 * tem que ser IGUAIS. Relevante porque a linha ADS do fechado (bbtsMonthly)
 * PASSA por calcularOperacao — o hash prova que nenhum contrato ADS de mes
 * fechado mudou de numero com o candidate-list.
 *
 * Uso: TRP_SOURCE=db node scripts/prova_pmr_fechado_hash.cjs <ano> <mes>
 */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";
require("./_ts_register.cjs");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { reconsolidarCompetenciaFechada } = require("../lib/reconsolidarCompetencia.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Remove campos volateis (timestamps de calculo) e ordena chaves — o hash so
// pode variar se um NUMERO variar.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      if (/_at$/.test(k)) continue;
      out[k] = canonical(value[k]);
    }
    return out;
  }
  return value;
}

async function main() {
  const year = Number(process.argv[2]);
  const month = Number(process.argv[3]);
  if (!year || !month) { console.error("uso: prova_pmr_fechado_hash.cjs <ano> <mes>"); process.exit(3); }

  const res = await reconsolidarCompetenciaFechada(sb, { year, month, dryRun: true });
  if (!res.ran) {
    console.log(`${res.competencia}: regime '${res.regime}' — ${res.motivo}`);
    process.exit(0);
  }
  const payload = (res.payload || [])
    .map(canonical)
    .sort((a, b) => `${a.promoter_id}|${a.company_id}`.localeCompare(`${b.promoter_id}|${b.company_id}`));
  const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  console.log(`${res.competencia}: regime '${res.regime}' dry_run promotores=${res.promotores} linhas=${payload.length}`);
  console.log(`HASH PMR FECHADO ${res.competencia}: ${hash}`);
}

main().catch((e) => { console.error("ERRO:", (e && e.message) || e); process.exit(3); });
