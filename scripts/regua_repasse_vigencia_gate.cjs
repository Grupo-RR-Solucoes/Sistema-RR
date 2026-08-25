/*
 * GATE — a regua de repasse (Frente C) e lida por VIGENCIA, nao por competencia
 * exata.
 *
 * SELF-CONTAINED e OFFLINE: Supabase FALSO em memoria + fetchPromoterShareData
 * e consolidateMonthlyFromClosing REAIS.
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * A regua e PERMANENTE por decisao de Diego: vale ate ele definir outra. Ate
 * 25/08/2026 a leitura era `.eq("competencia", competencia)` — a Frente C
 * SUMIA em todo mes sem cadastro, sem erro e sem aviso, caindo na cascata de
 * profile. Foi o que aconteceu em jul/2026: promoter_goal_repasse tem 19
 * linhas, so de 2026-05 e 2026-06; em julho o mapa vinha vazio e os 114
 * contratos elegiveis resolveram PROFILE_VARIAVEL_FALLBACK / PROFILE_DEFAULT.
 * Medido: com a regua vigente, julho ganha R$ 863,90 e sobe de 26 para 28
 * promotores batendo com a planilha do financeiro.
 *
 * OS TRES CASOS (anti-vacuidade: o cenario TEM de ter os tres)
 *   1) competencia COM regua propria .......... le a DELA
 *   2) competencia SEM regua .................. le a ANTERIOR mais recente
 *   3) competencia ANTERIOR a primeira regua .. NAO le nenhuma
 * E o quarto, que e o caso de julho:
 *   4) competencia POSTERIOR a ultima regua ... le a ultima (carry-forward)
 *
 * ORDEM DO BANCO NAO DECIDE: o cenario devolve as linhas em ordem INVERTIDA e
 * o gate roda as duas ordens. Confiar no filtro/ordem da query para vigencia ja
 * deu ruim neste repo (regua de 2026-08 alcancando jun/abr num dry-run do piso).
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

process.env.PISO_ALLOW_RR_PURE = "1";

const { fetchPromoterShareData } = require("../lib/proposalDetailing.ts");
const { consolidateMonthlyFromClosing } = require("../lib/closingMonthly.ts");
const { baseRepasseAvistaRR } = require("../lib/tetoAvistaRR.ts");

const CO = "company-1";
const PID = "promotor-regua";
const JKEY = "J0000001";

// Duas reguas, com pct_base DIFERENTES (senao o gate nao distingue nada).
const REGUA_MAIO = { competencia: "2026-05-01", pct_base: 0.5, pct_meta1: 0.51, pct_meta2: 0.52 };
const REGUA_JULHO = { competencia: "2026-07-01", pct_base: 0.7, pct_meta1: 0.71, pct_meta2: 0.72 };

// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const upserts = [];
  function builder(nome) {
    const filtros = [];
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "neq") return v !== f.val;
        if (f.op === "in") return f.val.includes(v);
        if (f.op === "is") return v === null || v === undefined;
        if (f.op === "lte") return v <= f.val;
        if (f.op === "gte") return v >= f.val;
        if (f.op === "lt") return v < f.val;
        if (f.op === "gt") return v > f.val;
        return true;
      });
    const linhas = () => (db[nome] || []).filter(casa);
    const api = {
      select: () => api,
      eq(col, val) { filtros.push({ op: "eq", col, val }); return api; },
      neq(col, val) { filtros.push({ op: "neq", col, val }); return api; },
      in(col, val) { filtros.push({ op: "in", col, val }); return api; },
      is(col) { filtros.push({ op: "is", col }); return api; },
      not() { return api; },
      lte(col, val) { filtros.push({ op: "lte", col, val }); return api; },
      gte(col, val) { filtros.push({ op: "gte", col, val }); return api; },
      lt(col, val) { filtros.push({ op: "lt", col, val }); return api; },
      gt(col, val) { filtros.push({ op: "gt", col, val }); return api; },
      or() { return api; },
      order: () => api,
      limit: () => api,
      maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
      range(from, to) { return Promise.resolve({ data: linhas().slice(from, to + 1), error: null }); },
      upsert(rows) { upserts.push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve({ data: null, error: null }); },
      insert() { return Promise.resolve({ data: null, error: null }); },
      delete() { return { in: () => Promise.resolve({ data: null, error: null }) }; },
      then(resolve, reject) { return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject); },
    };
    return api;
  }
  return { from: (nome) => builder(nome), __upserts: upserts };
}

const LIQ = 10000;
const PCT_FAIXA = 0.06; // faixa 5,80 — e onde a escala da Frente C age

const cash = (contrato, year, month) => ({
  id: `cash-${contrato}`,
  company_id: CO,
  year,
  month,
  entry_type: "CASH",
  sheet_name: "A Vista ",
  contract_number: contrato,
  j_key: JKEY,
  product_name: "2882",
  net_value: LIQ,
  insurance_value: 0,
  commission_value: LIQ * PCT_FAIXA,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": JKEY,
    "% A VISTA": PCT_FAIXA,
    "COMISSÃO PF": LIQ * PCT_FAIXA,
    "VALOR LÍQUIDO": LIQ,
    "COMISSÃO SEGURO": 0,
    "VALOR SEGURO": 0,
    "% PENETRAÇÃO": 0,
    "RESTRIÇÃO SRCC": "Não",
    "PROD. SEGURADA": "Não",
    "DESCRIÇÃO DO PRODUTO": "2882",
  },
});

const baseDB = (reguas, entries) => ({
  monthly_closing_entries: entries,
  companies: [{ id: CO, name: "RR TESTE", group_name: "Grupo RR" }],
  promoters: [{ id: PID, name: "PROMOTOR REGUA" }],
  j_keys: [{ j_key: JKEY, promoter_id: PID, key_type: "INDIVIDUAL" }],
  daily_production_records: [],
  monthly_targets: [],
  promoter_goal_repasse: reguas.map((r) => ({ promoter_id: PID, ...r })),
  promoter_share_profile: [],
  share_scale: [],
  share_scale_tier: [],
  promoter_monthly_results: [],
  promoter_agreements: [],
  insurance_slip_rules: [],
});

// ---------------------------------------------------------------------------
const falhas = [];
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perto = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function checa(nome, ok, detalhe) {
  console.log(`${ok ? "  OK  " : "  X   "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}

async function reguaLida(year, month, ordem) {
  const sb = fakeSupabase(baseDB(ordem, []));
  const share = await fetchPromoterShareData(sb, [PID], year, month, [CO]);
  const g = share.goalRepasseMap.get(PID);
  return g ? Number(g.pct_base) : null;
}

(async () => {
  // Ordem INVERTIDA de proposito: a mais nova primeiro.
  const ORDEM_INVERTIDA = [REGUA_JULHO, REGUA_MAIO];
  const ORDEM_DIRETA = [REGUA_MAIO, REGUA_JULHO];

  // -- ANTI-VACUIDADE ---------------------------------------------------------
  console.log("== ANTI-VACUIDADE — o cenario distingue as duas reguas?");
  checa("as duas reguas tem pct_base DIFERENTES", REGUA_MAIO.pct_base !== REGUA_JULHO.pct_base, `${REGUA_MAIO.pct_base} vs ${REGUA_JULHO.pct_base}`);
  checa("e ha competencia ANTERIOR a primeira regua para testar o caso 3", "2026-04-01" < REGUA_MAIO.competencia);
  if (REGUA_MAIO.pct_base === REGUA_JULHO.pct_base) {
    console.log("\nGATE VACUO. REPROVADO.");
    process.exit(2);
  }

  // -- OS QUATRO CASOS, NAS DUAS ORDENS --------------------------------------
  for (const [rotulo, ordem] of [["ordem INVERTIDA (mais nova primeiro)", ORDEM_INVERTIDA], ["ordem direta", ORDEM_DIRETA]]) {
    console.log(`\n== OS CASOS — ${rotulo}`);
    const c1 = await reguaLida(2026, 7, ordem);
    checa("(1) 2026-07 TEM regua propria -> le a DELA (0,70)", c1 === REGUA_JULHO.pct_base, `leu ${c1}`);
    const c2 = await reguaLida(2026, 6, ordem);
    checa("(2) 2026-06 NAO tem regua -> le a ANTERIOR mais recente (maio, 0,50)", c2 === REGUA_MAIO.pct_base, `leu ${c2}`);
    checa("(2) e NAO a de julho, que e POSTERIOR", c2 !== REGUA_JULHO.pct_base);
    const c3 = await reguaLida(2026, 4, ordem);
    checa("(3) 2026-04 e ANTERIOR a primeira regua -> NENHUMA", c3 === null, `leu ${c3}`);
    const c4 = await reguaLida(2026, 8, ordem);
    checa("(4) 2026-08 e POSTERIOR a ultima -> carry-forward (julho, 0,70)", c4 === REGUA_JULHO.pct_base, `leu ${c4}`);
  }

  // -- FIM A FIM: o valor do repasse muda mesmo ------------------------------
  console.log("\n== FIM A FIM — o consolidador REAL usa a regua vigente");
  const baseCapada = baseRepasseAvistaRR(LIQ * PCT_FAIXA, PCT_FAIXA, { year: 2026, month: 6 });
  const sbJun = fakeSupabase(baseDB(ORDEM_INVERTIDA, [cash("C0000001", 2026, 6)]));
  const resJun = await consolidateMonthlyFromClosing(sbJun, { year: 2026, month: 6, dryRun: true });
  const jun = (resJun?.table ?? []).find((t) => t.promoter_id === PID);
  checa(
    "jun/2026 (sem regua propria) repassa pela de MAIO",
    perto(jun?.production_commission_value, baseCapada * REGUA_MAIO.pct_base),
    `${brl(jun?.production_commission_value)} vs ${brl(baseCapada * REGUA_MAIO.pct_base)}`
  );
  checa(
    "e NAO pela de julho",
    !perto(jun?.production_commission_value, baseCapada * REGUA_JULHO.pct_base),
    `julho daria ${brl(baseCapada * REGUA_JULHO.pct_base)}`
  );

  const sbJul = fakeSupabase(baseDB(ORDEM_INVERTIDA, [cash("C0000002", 2026, 7)]));
  const resJul = await consolidateMonthlyFromClosing(sbJul, { year: 2026, month: 7, dryRun: true });
  const jul = (resJul?.table ?? []).find((t) => t.promoter_id === PID);
  checa(
    "jul/2026 (com regua propria) repassa pela DELA",
    perto(jul?.production_commission_value, baseCapada * REGUA_JULHO.pct_base),
    `${brl(jul?.production_commission_value)} vs ${brl(baseCapada * REGUA_JULHO.pct_base)}`
  );

  const sbAbr = fakeSupabase(baseDB(ORDEM_INVERTIDA, [cash("C0000003", 2026, 4)]));
  const resAbr = await consolidateMonthlyFromClosing(sbAbr, { year: 2026, month: 4, dryRun: true });
  const abr = (resAbr?.table ?? []).find((t) => t.promoter_id === PID);
  checa(
    "abr/2026 (anterior a toda regua) NAO usa escala nenhuma",
    !perto(abr?.production_commission_value, baseCapada * REGUA_MAIO.pct_base) &&
      !perto(abr?.production_commission_value, baseCapada * REGUA_JULHO.pct_base),
    `${brl(abr?.production_commission_value)} — maio daria ${brl(baseCapada * REGUA_MAIO.pct_base)}, julho ${brl(baseCapada * REGUA_JULHO.pct_base)}`
  );
  checa("e mesmo assim PAGA (cai na cascata de profile, nao em zero)", Number(abr?.production_commission_value ?? 0) > 0, brl(abr?.production_commission_value));

  checa("dryRun nao gravou nada", sbJun.__upserts.length === 0 && sbJul.__upserts.length === 0 && sbAbr.__upserts.length === 0);

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — regua propria vence, sem regua herda a anterior, antes da primeira nao ha regua, e a ordem do banco nao decide.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
