/* ============================================================================
 * heranca_master_janela_gate — a HERANCA MASTER decide competencia pela JANELA.
 *
 * Rodar:
 *   node scripts/heranca_master_janela_gate.cjs
 *
 * A INVARIANTE: se a linha do diario e da competencia X pela JANELA de producao,
 * a heranca master TEM de enxerga-la ao consolidar X. Filtrar por mes de
 * CALENDARIO (movement_date.startsWith("2026-07")) descarta as linhas do
 * dia-cabeca da janela — o ultimo dia util do mes anterior.
 *
 * O DEFEITO (medido em 17/08/2026): closingMonthly.ts:147 e a copia literal em
 * bbtsOrchestrator.ts:130 filtravam por prefixo de mes. Em jul/2026 (janela
 * 30/06 -> 30/07) as 26 linhas de 2026-06-30 ficavam invisiveis: o contrato de
 * chave master seguia orfao e a producao nao pousava no promotor. Dano medido:
 * R$ 45.582,69 em 5 promotores.
 *
 * OS BLOCOS (os dois lados no mesmo run):
 *   1. PURO         — pertenceACompetencia (o unico ponto de decisao do helper)
 *                     aceita o dia-cabeca e rejeita o dia que ja e do mes seguinte.
 *   2. REGRA VELHA  — prova que o criterio ANTIGO viola a invariante, com o caso
 *                     medido. Sem este bloco o gate nao distingue "esta certo" de
 *                     "nao ha o que testar".
 *   3. BANCO        — as 6 propostas medidas de 2026-06-30 entram no heir map de
 *                     jul/2026 produzido pelo PROPRIO helper de producao.
 *   4. SEM DUPLICATA— nenhum dos dois consumidores tem filtro de competencia
 *                     proprio; os dois consomem o helper.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const HM = require("../lib/herancaMaster.ts");
const PP = require("../lib/productionPeriod.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const ROOT = path.resolve(__dirname, "..");
const JUL = { year: 2026, month: 7 };

// As 6 linhas medidas: competencia jul/2026 pela janela, movement_date 30/06.
// Perdidas pelo criterio de calendario. Valor e dono conferidos contra a
// planilha do financeiro em 17/08/2026.
const CASOS_30_06 = [
  { prop: "214029141", valor: 6100.0, quem: "CAMILA GOMES" },
  { prop: "214020491", valor: 1107.04, quem: "CAMILA GOMES" },
  { prop: "214044087", valor: 7100.0, quem: "REBECA ARAUJO" },
  { prop: "214049021", valor: 7804.44, quem: "CLEVITON ARAUJO" },
  { prop: "214055382", valor: 2471.21, quem: "GLEICE KAMILA" },
  { prop: "214079296", valor: 21000.0, quem: "JUSSARA DA SILVA" },
];

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — pertenceACompetencia usa a JANELA, nao o mes do calendario");
  console.log(linha("="));
  const win = PP.getProductionWindow(2026, 7);
  console.log(`   janela de jul/2026: ${win.start} -> ${win.endExclusive} (fim exclusivo)`);
  ok(
    HM.pertenceACompetencia("2026-06-30", 2026, 7) === true,
    "2026-06-30 pertence a jul/2026 (o dia-cabeca da janela — o caso do defeito)"
  );
  ok(
    HM.pertenceACompetencia("2026-07-15", 2026, 7) === true,
    "2026-07-15 pertence a jul/2026 (meio da janela)"
  );
  ok(
    HM.pertenceACompetencia("2026-07-31", 2026, 7) === false,
    "2026-07-31 NAO pertence a jul/2026 (ja e o dia-cabeca de agosto)"
  );
  ok(
    HM.pertenceACompetencia("2026-07-31", 2026, 8) === true,
    "2026-07-31 pertence a ago/2026"
  );
  ok(
    HM.pertenceACompetencia(null, 2026, 7) === false,
    "data ausente -> false (nao inventa competencia)"
  );
  // Concordancia com a regua canonica do resto do sistema, varrendo o ano.
  let divergencias = 0;
  let checadas = 0;
  for (let d = new Date(Date.UTC(2026, 0, 1)); d <= new Date(Date.UTC(2026, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const comp = PP.getProductionPeriodFromValue(iso);
    if (!comp) continue;
    checadas += 1;
    if (HM.pertenceACompetencia(iso, comp.year, comp.month) !== true) {
      divergencias += 1;
      if (divergencias <= 5) console.log(`      DIVERGE: ${iso} -> competencia ${comp.year}-${comp.month}`);
    }
  }
  console.log(`   datas checadas: ${checadas}`);
  ok(divergencias === 0, "concorda com getProductionPeriodFromValue no ano inteiro", `divergencias=${divergencias}`);
  ok(checadas > 300, "ANTI-VACUIDADE: o laco varreu o ano inteiro", `checadas=${checadas}`);

  // ---- 2. A REGRA VELHA VIOLA (prova que o teste tem poder) ----
  console.log("\n" + linha("="));
  console.log("2) REGRA VELHA — o criterio de CALENDARIO violava a invariante");
  console.log(linha("="));
  const criterioVelho = (mov, year, month) =>
    String(mov || "").startsWith(`${year}-${String(month).padStart(2, "0")}`);
  const iso = "2026-06-30";
  const compReal = PP.getProductionPeriodFromValue(iso);
  console.log(`   ${iso}: competencia pela janela = ${compReal.year}-${compReal.month}`);
  console.log(`   criterio VELHO (startsWith "2026-07") -> ${criterioVelho(iso, 2026, 7) ? "DENTRO" : "FORA"}`);
  console.log(`   criterio NOVO  (janela)               -> ${HM.pertenceACompetencia(iso, 2026, 7) ? "DENTRO" : "FORA"}`);
  ok(compReal.year === 2026 && compReal.month === 7, "a linha E de julho pela competencia");
  ok(criterioVelho(iso, 2026, 7) === false, "a regra VELHA descartava a linha (era o defeito)");
  ok(HM.pertenceACompetencia(iso, 2026, 7) === true, "a regra NOVA mantem a linha");

  // ---- 3. BANCO — o heir map REAL do helper de producao ----
  console.log("\n" + linha("="));
  console.log("3) BANCO — as 6 linhas medidas de 30/06 entram no heir map de jul/2026");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const orfaos = CASOS_30_06.map((c) => ({ contrato: c.prop, companyId: null }));
  const heir = await HM.buildDonoDoDiarioMap(sb, orfaos, JUL.year, JUL.month);
  console.log(`   heir map devolveu ${heir.size} entrada(s) para ${orfaos.length} orfaos`);
  const nomes = new Map();
  {
    const pids = [...new Set([...heir.values()])];
    if (pids.length) {
      const { data } = await sb.from("promoters").select("id, name").in("id", pids);
      for (const p of data || []) nomes.set(p.id, p.name);
    }
  }
  let achados = 0;
  for (const c of CASOS_30_06) {
    const hit = [...heir.entries()].find(([k]) => k.endsWith(`|${c.prop}`));
    if (hit) achados += 1;
    ok(
      !!hit,
      `prop ${c.prop} (${c.quem}, R$ ${c.valor.toFixed(2)}) herdada`,
      hit ? `-> ${nomes.get(hit[1]) || hit[1]}` : "-> AUSENTE do heir map"
    );
  }
  ok(achados === CASOS_30_06.length, "todas as 6 propostas medidas foram herdadas", `${achados}/${CASOS_30_06.length}`);

  // ---- 4. SEM DUPLICATA ----
  console.log("\n" + linha("="));
  console.log("4) SEM DUPLICATA — os dois consumidores usam o helper, nao copia propria");
  console.log(linha("="));
  for (const rel of ["lib/closingMonthly.ts", "lib/bbtsOrchestrator.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const temPrefixo = /movement_date[^\n]*startsWith\(/.test(src);
    const consome = /buildDonoDoDiarioMap\(/.test(src) && /from "\.\/herancaMaster\.ts"/.test(src);
    ok(!temPrefixo, `${rel} nao filtra movement_date por prefixo de mes`);
    ok(consome, `${rel} consome buildDonoDoDiarioMap de herancaMaster.ts`);
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
