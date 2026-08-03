/* ============================================================================
 * pmr_aberto_sem_daily_gate — a guarda que impede o FOSSIL de voltar.
 *
 * INVARIANTE: nenhuma linha de promoter_monthly_results em competencia cujo
 * regime seja 'open'. Mes aberto e do pipeline DIARIO; o PMR e o ledger do mes
 * FECHADO.
 *
 * Rodar:
 *   node scripts/pmr_aberto_sem_daily_gate.cjs
 *
 * ONDE A ASSERCAO VIVE (e por que nao e aqui)
 *   A regra mora em lib/diagnostico/ledgerHealth.ts, check 'aberto_com_daily'
 *   — o IRMAO do 'fechado_com_daily' que ja existia la. Este arquivo so a
 *   CONSOME. Escrever a regra aqui criaria uma segunda resposta para "o PMR
 *   esta limpo?", e o cabecalho do ledgerHealth registra que este codebase ja
 *   pagou caro por copias divergentes de logica de regime. Como bonus, o vigia
 *   ja e exposto pelo /api/diagnostico: a regra passa a valer na TELA tambem,
 *   nao so no terminal.
 *
 * POR QUE TRES BLOCOS, E NAO SO O DA PRODUCAO
 *   Um gate que so afirma "o banco esta limpo" passa por VACUIDADE no dia em
 *   que a competencia certa deixar de ser varrida — foi assim que o
 *   vw_team_production passou verde com 0 linhas. Entao aqui os DOIS lados sao
 *   computados no MESMO run, contra stub em memoria:
 *     1. POSITIVO  — linha de PMR em competencia 'open' -> tem que ACENDER.
 *     2. CONTROLE  — a MESMA linha em competencia FECHADA -> 'aberto_com_daily'
 *                    apaga e 'fechado_com_daily' acende. Prova que os dois
 *                    irmaos sao complementares, e que o novo nao e um check que
 *                    acende sempre.
 *     3. PRODUCAO  — o banco de verdade: tem que dar 0.
 *
 * HISTORIA (2026-08-03)
 *   8 linhas source='daily' em 2026-07 (ADS), gravadas em 20/07/2026 11:54 UTC
 *   pela rota diaria do RR, ~4h ANTES da trava semAds (commit 4c064ee). Como
 *   lib/historicoMensal.ts:101 devolve o PMR ANTES de tentar o daily, a linha
 *   bloqueava o fallback: a serie de julho da /projecao e da /equipe mostrava
 *   R$ 400.228,79 onde o daily ao vivo dava R$ 753.955,30, e a producao RR
 *   desses 10 promotores (R$ 234.156,95) sumia inteira. Decisao Diego: apagar
 *   sem regravar. Este gate FALHA enquanto as 8 existirem — de proposito.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildLedgerHealth } = require("../lib/diagnostico/ledgerHealth.ts");

const linha = (c) => c.repeat(78);
const checkDe = (health, id) => health.checks.find((c) => c.id === id) || { count: -1, detalhe: [] };

// --- STUB de Supabase em memoria (mesmo idioma de bbts_seguro_regua_gate.cjs) ---
function makeStub(tables) {
  const data = { ...tables };
  const build = (name) => {
    const preds = [];
    const apply = () => (data[name] || []).filter((r) => preds.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (c, v) => (preds.push((r) => String(r[c]) === String(v)), q),
      neq: (c, v) => (preds.push((r) => String(r[c]) !== String(v)), q),
      in: (c, arr) => (preds.push((r) => arr.map(String).includes(String(r[c]))), q),
      order: () => q,
      limit: () => q,
      range: (a, b) => Promise.resolve({ data: apply().slice(a, b + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: apply()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: apply(), error: null }).then(res, rej),
    };
    return q;
  };
  return {
    from: (name) => build(name),
    // Camadas 1/2 sao auxiliares e o ledgerHealth as embrulha em try/catch:
    // no stub elas reportam erro no proprio check, sem derrubar o vigia.
    rpc: () => Promise.resolve({ data: null, error: { message: "stub sem rpc" } }),
  };
}

const PROMOTOR = "11111111-1111-1111-1111-111111111111";
const EMPRESA = "22222222-2222-2222-2222-222222222222";
const linhaPmr = (year, month) => ({
  promoter_id: PROMOTOR,
  company_id: EMPRESA,
  year,
  month,
  source: "daily",
  final_commission_value: 0,
});
const baseStub = {
  companies: [{ id: EMPRESA, active: true, group_name: "Grupo RR" }],
  promoters: [{ id: PROMOTOR, is_master: false }],
  cms_imports: [],
  monthly_closing_imports: [],
  trp_rule_versions: [],
  promoter_monthly_results: [],
};

(async () => {
  let falhas = 0;

  // ---- 1. POSITIVO: o detector ACENDE em competencia aberta ----
  console.log(linha("="));
  console.log("1) POSITIVO — linha de PMR em competencia 'open' tem que ACENDER");
  console.log(linha("="));
  const aberto = await buildLedgerHealth(
    makeStub({ ...baseStub, promoter_monthly_results: [linhaPmr(2026, 7)] })
  );
  const cAberto = checkDe(aberto, "aberto_com_daily");
  const bAberto = checkDe(aberto, "fechado_com_daily");
  console.log(`   aberto_com_daily  = ${cAberto.count}  (esperado 1)`);
  console.log(`   fechado_com_daily = ${bAberto.count}  (esperado 0 — a competencia NAO esta fechada)`);
  console.log(`   detalhe: ${JSON.stringify(cAberto.detalhe)}`);
  const ok1 = cAberto.count === 1 && bAberto.count === 0;
  console.log(`   -> ${ok1 ? "OK" : "FALHOU"}`);
  if (!ok1) falhas++;

  // ---- 2. CONTROLE: a MESMA linha em competencia FECHADA nao acende o novo ----
  console.log("\n" + linha("="));
  console.log("2) CONTROLE — a MESMA linha em competencia FECHADA troca de irmao");
  console.log(linha("="));
  const fechado = await buildLedgerHealth(
    makeStub({
      ...baseStub,
      promoter_monthly_results: [linhaPmr(2026, 5)],
      monthly_closing_imports: [{ company_id: EMPRESA, year: 2026, month: 5, status: "COMPLETED" }],
    })
  );
  const cFechado = checkDe(fechado, "aberto_com_daily");
  const bFechado = checkDe(fechado, "fechado_com_daily");
  console.log(`   aberto_com_daily  = ${cFechado.count}  (esperado 0 — a competencia esta fechada)`);
  console.log(`   fechado_com_daily = ${bFechado.count}  (esperado 1 — o irmao que ja existia)`);
  const ok2 = cFechado.count === 0 && bFechado.count === 1;
  console.log(`   -> ${ok2 ? "OK" : "FALHOU"}`);
  if (!ok2) falhas++;

  // ---- 3. PRODUCAO: o banco de verdade ----
  console.log("\n" + linha("="));
  console.log("3) PRODUCAO — nenhuma linha de PMR em competencia 'open'");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const real = await buildLedgerHealth(sb);
  const cReal = checkDe(real, "aberto_com_daily");
  console.log(`   aberto_com_daily = ${cReal.count}  (esperado 0)`);
  if (cReal.count > 0) {
    const porComp = new Map();
    for (const v of cReal.detalhe) {
      const k = `${v.competencia} | source=${v.source}`;
      porComp.set(k, (porComp.get(k) || 0) + 1);
    }
    for (const [k, n] of porComp) console.log(`      ${k}: ${n} linha(s)`);
    console.log("      Mes aberto nao tem ledger. Apagar as linhas (sem regravar):");
    console.log("      delete from public.promoter_monthly_results where year=<Y> and month=<M>;");
  }
  const ok3 = cReal.count === 0;
  console.log(`   -> ${ok3 ? "OK" : "FALHOU"}`);
  if (!ok3) falhas++;

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
