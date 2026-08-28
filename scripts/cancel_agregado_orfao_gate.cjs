/* ============================================================================
 * cancel_agregado_orfao_gate — a metade que NAO cabe no CI.
 *
 * Rodar:
 *   node scripts/cancel_agregado_orfao_gate.cjs
 *
 * needs-local + needs-db, e por isso o CI NUNCA executa este arquivo:
 *   - le C:/Users/diego/Downloads/... (o xlsx do fechamento de 2025-02 AL1, que
 *     nao esta versionado e nao pode estar: 1,7 MB de dado de cliente);
 *   - chama createClient para medir o estado de PRODUCAO.
 * As duas provas daqui so acontecem quando ALGUEM RODA A MAO. Isso esta dito com
 * todas as letras no `motivo` do registro em scripts/run_all_gates.cjs, e e uma
 * limitacao real, nao um detalhe: o bloco 2 (o vigia acendendo em PRODUCAO) e
 * justamente o que impede o check de nascer verde por vacuidade, e ele nao roda
 * em push nenhum.
 *
 * O QUE E CI-AVEL FOI SEPARADO em scripts/agregado_orfao_gate.cjs
 * (self-contained, 38 assercoes): as ancoras no fonte do import, a funcao POST
 * REAL do cancel contra o espelho com os tres controles positivos, e o vigia
 * contra dados controlados. Aquele arquivo e o que roda em todo push.
 *
 * OS BLOCOS QUE SOBRARAM AQUI:
 *   1. TRACE     — importMonthlyClosingWorkbook REAL, com o arquivo REAL, contra
 *                  o espelho scripts/_fakeFechamento.cjs, com um observador que
 *                  registra a contagem de monthly_closing_entries apos CADA
 *                  escrita. A invariante: a contagem nunca toca ZERO tendo
 *                  comecado com detalhe. Reverter a ordem do import faz o trace
 *                  mostrar `delete 400 -> 0` antes de qualquer insert.
 *   2. PRODUCAO  — o vigia 'agregado_sem_detalhe' acende para 2025-02 RR
 *                  ALAGOAS 1 AGORA, e NAO acende para 2023-12 AL1 (FME zerada).
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("node:module");
const { createClient } = require("@supabase/supabase-js");
const { createFakeFechamento } = require("./_fakeFechamento.cjs");

const linha = (c) => c.repeat(84);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const ROOT = path.resolve(__dirname, "..");

function stubModule(spec, exports) {
  const p = require.resolve(spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

(async () => {
  stubModule("@/lib/reconsolidarCompetencia", {
    reconsolidarCompetenciaFechada: async () => ({ stub: true }),
  });

  const real = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // ---- 1. TRACE ----
  console.log(linha("="));
  console.log("1) TRACE — importMonthlyClosingWorkbook REAL: a contagem nunca toca o zero");
  console.log(linha("="));

  const ARQ = path.join(
    "C:/Users/diego/Downloads/RRCRED/Relatório de Produção/ALAGOAS",
    "C23677_48357275000103_Todos_2_2025.xlsx"
  );
  const temArquivo = fs.existsSync(ARQ);
  // ANTI-VACUIDADE: sem o arquivo o bloco NAO passa em silencio — reprova.
  ok(temArquivo, "ANTI-VACUIDADE: o arquivo TODOS de referencia esta em disco", ARQ);
  if (!temArquivo) {
    console.log("\n" + linha("="));
    console.log(`GATE: ${falhas} FALHA(S)`);
    process.exit(1);
  }

  const { data: cos } = await real.from("companies").select("id, name, cnpj");
  const AL1 = cos.find((c) => String(c.name).toUpperCase().includes("ALAGOAS 1"));

  // Semente: a competencia JA TEM detalhe de um import anterior.
  const IMPORT_ANTIGO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const ANTIGAS = 400;
  const semente = {
    monthly_closing_entries: Array.from({ length: ANTIGAS }, (_, i) => ({
      id: `antiga-${i}`,
      monthly_closing_import_id: IMPORT_ANTIGO,
      company_id: AL1.id,
      company_cnpj: AL1.cnpj,
      year: 2025,
      month: 2,
      entry_type: i % 3 === 0 ? "CASH" : i % 3 === 1 ? "PRT" : "INSURANCE",
      commission_value: 1,
      sheet_name: "A Vista",
    })),
    fechamento_mensal_empresa: [
      { id: "fme-1", empresa_cnpj: AL1.cnpj, ano: 2025, mes: 2, valor_liquido: 97535.61, operacoes: ANTIGAS },
    ],
    monthly_closing_imports: [
      { id: IMPORT_ANTIGO, company_id: AL1.id, year: 2025, month: 2, file_name: "antigo.xlsx", status: "COMPLETED", codigo_arquivo: "C00000" },
    ],
  };

  const fake = createFakeFechamento(real, semente);
  // A lib pega o cliente por getSupabaseAdmin() — injeto o espelho por stub,
  // ANTES do require.
  stubModule("@/lib/supabaseAdmin", { getSupabaseAdmin: () => fake });
  const { importMonthlyClosingWorkbook } = require(path.join("..", "lib", "monthlyClosingImport.ts"));

  let erroImport = null;
  try {
    await importMonthlyClosingWorkbook({
      fileBase64: fs.readFileSync(ARQ).toString("base64"),
      fileName: path.basename(ARQ),
      year: 2025,
      month: 2,
      companyId: AL1.id,
      createdBy: "gate@local",
    });
  } catch (e) {
    erroImport = e;
  }

  const tr = fake._store.get("__trace") || [];
  console.log(`   escritas em monthly_closing_entries observadas: ${tr.length}`);
  for (const t of tr.slice(0, 6)) console.log(`      ${t.op.padEnd(7)} ${t.antes} -> ${t.depois}`);
  if (tr.length > 6) console.log(`      ... (+${tr.length - 6})`);
  if (erroImport) console.log(`   NOTA: o import terminou com erro: ${erroImport.message}`);

  ok(tr.length > 0, "ANTI-VACUIDADE: o import REAL escreveu em monthly_closing_entries", `escritas=${tr.length}`);
  ok(!tr.some((t) => t.depois === 0), "a contagem de entries NUNCA chega a ZERO durante o import");
  const final = fake._rows("monthly_closing_entries").length;
  const sobrouAntiga = fake._rows("monthly_closing_entries").filter(
    (r) => r.monthly_closing_import_id === IMPORT_ANTIGO
  ).length;
  console.log(`   estado final: ${final} entries   (das antigas: ${sobrouAntiga})`);
  ok(final > 0, "a competencia terminou COM detalhe", `entries=${final}`);
  ok(
    sobrouAntiga === 0,
    "as entries do import ANTERIOR foram substituidas (o recorte amplo faz trabalho)",
    `sobraram=${sobrouAntiga}`
  );

  // ---- 2. PRODUCAO ----
  console.log("\n" + linha("="));
  console.log("2) PRODUCAO — o vigia acende para 2025-02 RR ALAGOAS 1 AGORA");
  console.log(linha("="));
  {
    const { detectFechamentoParcial } = require(path.join("..", "lib", "diagnostico", "fechamentoParcial.ts"));
    const res = await detectFechamentoParcial(real);
    const check = res.find((c) => c.id === "agregado_sem_detalhe") || { count: -1, detalhe: [] };
    const comps = (check.detalhe || []).map((d) => `${d.empresa} ${d.competencia}`);
    console.log(`   count=${check.count}  ${JSON.stringify(comps)}`);
    // Esta e a assercao que NAO tem equivalente no gate self-contained: la o dano
    // e uma FIXTURE, aqui e o BANCO. Se o count vier 0, ou o dano sumiu (e o gate
    // deve ser revisto) ou o check esta vazio — nos dois casos, reprovar.
    ok(check.count >= 1, "ANTI-VACUIDADE: acende em producao (o dano existe hoje)", `count=${check.count}`);
    ok(
      comps.some((c) => c.includes("2025-02") && c.includes("RR ALAGOAS 1")),
      "e o achado e 2025-02 RR ALAGOAS 1"
    );
    ok(!comps.some((c) => c.includes("2023-12")), "e 2023-12 AL1 NAO aparece em producao (FME zerada)");
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
