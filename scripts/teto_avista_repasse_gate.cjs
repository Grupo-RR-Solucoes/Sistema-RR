/*
 * GATE — o REPASSE ao promotor sai da comissao-empresa TRAZIDA AO TETO 5,80%.
 *
 * SELF-CONTAINED e OFFLINE: Supabase FALSO em memoria + a funcao REAL
 * consolidateMonthlyFromClosing (que chama loadClosingPromoterBase real).
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * Ate 25/08/2026 closingMonthly fazia `a.avista += c.comissaoEmpresaAvista *
 * acordo`, com a comissao CRUA. A Promotiva paga ate 6,00%; a RR remunera o
 * promotor sobre 5,80% e o spread fica com a empresa. Como o campo
 * `comissaoEmpresaAvista` vem PRE-teto (medido: em 296 de 296 contratos acima
 * do teto ele e igual a liquido x %empresa, e em 0 de 296 igual a liquido x
 * 5,80%), o promotor era pago sobre 6,00%:
 *   jul/2026  101 contratos, R$ 1.047,30 a mais
 *   jun/2026   96 contratos, R$   950,26
 *   abr/2026   99 contratos, R$   955,88
 * O gemeo da ADS ja capava (bbtsMonthly:262) — por isso a ADS batia com o
 * financeiro e o RR nao.
 *
 * POR QUE NAO BASTA capAvistaRR: aquele helper capa um PERCENTUAL. Aqui a base
 * e um VALOR EM R$ ja apurado a 6,00%. O cap tem de ser PROPORCIONAL
 * (valor x teto/%empresa) — e o que baseRepasseAvistaRR faz.
 *
 * AS PROVAS (nada congelado — o share sai de um run de CONTROLE no mesmo gate)
 *   A) ANTI-VACUIDADE: o cenario tem contrato ACIMA do teto E contrato NO/ABAIXO.
 *      Sem os dois lados o gate nao distingue nada e reprova por vazio.
 *   B) CONTROLE: um run so com o contrato abaixo do teto revela o share
 *      efetivo (s = repasse / base). Nenhuma constante de acordo neste arquivo.
 *   C) O motor REAL devolve repasse == base CAPADA x s.
 *   D) E NAO devolve base CRUA x s — e os dois numeros sao diferentes.
 *   E) O contrato NO teto (5,80%) e o ABAIXO (3,34%) nao encolhem um centavo.
 *   F) Unidade de baseRepasseAvistaRR: proporcionalidade, no-op e guardas.
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

process.env.PISO_ALLOW_RR_PURE = "1";

const { consolidateMonthlyFromClosing } = require("../lib/closingMonthly.ts");
const { baseRepasseAvistaRR, tetoAvistaRR } = require("../lib/tetoAvistaRR.ts");

const YEAR = 2026;
const MONTH = 7;
const COMP = { year: YEAR, month: MONTH };
const TETO = tetoAvistaRR(COMP);
const CO = "company-1";
const PID = "promotor-teto";
const JKEY = "J0000001";

// ---------------------------------------------------------------------------
// Supabase FALSO — so o subconjunto do query-builder que o motor usa.
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

// ---------------------------------------------------------------------------
// CENARIO — um promotor, jul/2026, tres contratos de MESMO liquido para que a
// unica variavel seja o percentual.
//   ACIMA  6,00%  -> PF 600,00 ; base do repasse tem de virar 580,00
//   NO     5,80%  -> PF 580,00 ; intacto (esta NO teto, nao acima)
//   ABAIXO 3,34%  -> PF 334,00 ; intacto (e o run de CONTROLE)
// Sem seguro: este gate mede credito.
// ---------------------------------------------------------------------------
const LIQUIDO = 10000;
const PCT_ACIMA = 0.06;
const PCT_NO = 0.058;
const PCT_ABAIXO = 0.0334;
const PF_ACIMA = LIQUIDO * PCT_ACIMA; // 600,00
const PF_NO = LIQUIDO * PCT_NO; // 580,00
const PF_ABAIXO = LIQUIDO * PCT_ABAIXO; // 334,00

const cash = (contrato, pct, pf) => ({
  id: `cash-${contrato}`,
  company_id: CO,
  year: YEAR,
  month: MONTH,
  entry_type: "CASH",
  sheet_name: "A Vista ",
  contract_number: contrato,
  j_key: JKEY,
  product_name: "CREDITO CONSIGNADO",
  net_value: LIQUIDO,
  insurance_value: 0,
  commission_value: pf,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": JKEY,
    "% A VISTA": pct,
    "COMISSÃO PF": pf,
    "VALOR LÍQUIDO": LIQUIDO,
    "COMISSÃO SEGURO": 0,
    "VALOR SEGURO": 0,
    "% PENETRAÇÃO": 0,
    "RESTRIÇÃO SRCC": "Não",
    "PROD. SEGURADA": "Não",
    "DESCRIÇÃO DO PRODUTO": "CREDITO CONSIGNADO",
  },
});

const C_ACIMA = cash("C0000001", PCT_ACIMA, PF_ACIMA);
const C_NO = cash("C0000002", PCT_NO, PF_NO);
const C_ABAIXO = cash("C0000003", PCT_ABAIXO, PF_ABAIXO);

const baseDB = (entries) => ({
  monthly_closing_entries: entries,
  companies: [{ id: CO, name: "RR TESTE", group_name: "Grupo RR" }],
  promoters: [{ id: PID, name: "PROMOTOR TETO" }],
  j_keys: [{ j_key: JKEY, promoter_id: PID, key_type: "INDIVIDUAL" }],
  daily_production_records: [],
  monthly_targets: [],
  promoter_goal_repasse: [],
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

async function repasseDe(entries) {
  const sb = fakeSupabase(baseDB(entries));
  const res = await consolidateMonthlyFromClosing(sb, { year: YEAR, month: MONTH, dryRun: true });
  const row = (res?.table ?? []).find((t) => t.promoter_id === PID);
  return { row, upserts: sb.__upserts.length };
}

(async () => {
  console.log(`== teto vigente em ${YEAR}-${String(MONTH).padStart(2, "0")}: ${(TETO * 100).toFixed(2)}%`);

  // -- A) ANTI-VACUIDADE ------------------------------------------------------
  console.log("\n== A) ANTI-VACUIDADE — o cenario tem os DOIS lados?");
  const cenario = [C_ACIMA, C_NO, C_ABAIXO];
  const acima = cenario.filter((c) => Number(c.metadata["% A VISTA"]) > TETO + 1e-9);
  const naoAcima = cenario.filter((c) => Number(c.metadata["% A VISTA"]) <= TETO + 1e-9);
  checa("ha contrato ACIMA do teto", acima.length > 0, `${acima.length} (pct ${acima.map((c) => (c.metadata["% A VISTA"] * 100).toFixed(2)).join(", ")}%)`);
  checa("ha contrato NO teto ou ABAIXO", naoAcima.length >= 2, `${naoAcima.length} (pct ${naoAcima.map((c) => (c.metadata["% A VISTA"] * 100).toFixed(2)).join(", ")}%)`);
  checa("e um deles esta EXATAMENTE no teto (o caso de borda do float)", naoAcima.some((c) => perto(c.metadata["% A VISTA"], TETO)));
  if (!acima.length || naoAcima.length < 2) {
    console.log("\nGATE VACUO — o cenario nao distingue capado de nao-capado. REPROVADO.");
    process.exit(2);
  }

  // -- B) CONTROLE: o share efetivo, medido, sem constante no arquivo --------
  console.log("\n== B) CONTROLE — run so com o contrato ABAIXO do teto (nao ha o que capar)");
  const ctrl = await repasseDe([C_ABAIXO]);
  checa("o promotor aparece no run de controle", !!ctrl.row);
  const s = Number(ctrl.row?.production_commission_value ?? 0) / PF_ABAIXO;
  checa("o share efetivo e um numero util (0 < s <= 1)", s > 0 && s <= 1, `s = ${s}`);
  console.log(`     repasse do controle ${brl(ctrl.row?.production_commission_value)} sobre PF ${brl(PF_ABAIXO)}`);
  if (!(s > 0 && s <= 1)) {
    console.log("\nGATE SEM REFERENCIA — o controle nao revelou o share. REPROVADO.");
    process.exit(2);
  }

  // -- C + D) o motor REAL x os dois lados, no mesmo run ----------------------
  console.log("\n== C+D) O MOTOR REAL — base CAPADA x base CRUA");
  const baseCapada = baseRepasseAvistaRR(PF_ACIMA, PCT_ACIMA, COMP) + PF_NO + PF_ABAIXO;
  const baseCrua = PF_ACIMA + PF_NO + PF_ABAIXO;
  const esperadoCapado = baseCapada * s;
  const esperadoCru = baseCrua * s;
  console.log(`     base capada ${brl(baseCapada)} -> ${brl(esperadoCapado)}   |   base crua ${brl(baseCrua)} -> ${brl(esperadoCru)}`);
  checa("os dois lados sao DIFERENTES (senao o cenario nao prova nada)", !perto(esperadoCapado, esperadoCru), `delta ${brl(esperadoCru - esperadoCapado)}`);
  const full = await repasseDe(cenario);
  checa("o promotor aparece no run do cenario", !!full.row);
  checa(
    "repasse == base CAPADA x share",
    perto(full.row?.production_commission_value, esperadoCapado),
    `${brl(full.row?.production_commission_value)} vs ${brl(esperadoCapado)}`
  );
  checa(
    "repasse != base CRUA x share (o bug antigo)",
    !perto(full.row?.production_commission_value, esperadoCru),
    `crua daria ${brl(esperadoCru)}`
  );

  // -- E) quem NAO esta acima do teto nao encolhe -----------------------------
  console.log("\n== E) contrato NO teto e ABAIXO do teto ficam INTACTOS");
  const soNo = await repasseDe([C_NO]);
  checa("contrato a 5,80% repassa sobre os 5,80% inteiros", perto(soNo.row?.production_commission_value, PF_NO * s), `${brl(soNo.row?.production_commission_value)} vs ${brl(PF_NO * s)}`);
  checa("contrato a 3,34% repassa sobre os 3,34% inteiros", perto(ctrl.row?.production_commission_value, PF_ABAIXO * s), `${brl(ctrl.row?.production_commission_value)} vs ${brl(PF_ABAIXO * s)}`);
  const soAcima = await repasseDe([C_ACIMA]);
  checa(
    "contrato a 6,00% repassa sobre 5,80% (encolhe)",
    perto(soAcima.row?.production_commission_value, PF_NO * s) && !perto(soAcima.row?.production_commission_value, PF_ACIMA * s),
    `${brl(soAcima.row?.production_commission_value)} — a 6,00% daria ${brl(PF_ACIMA * s)}`
  );

  // -- F) unidade de baseRepasseAvistaRR -------------------------------------
  console.log("\n== F) baseRepasseAvistaRR — proporcionalidade, no-op e guardas");
  checa("600,00 a 6,00% -> 580,00 (proporcional, nao Math.min)", perto(baseRepasseAvistaRR(600, 0.06, COMP), 580), `${brl(baseRepasseAvistaRR(600, 0.06, COMP))}`);
  checa("580,00 a 5,80% -> 580,00 (no-op no teto)", perto(baseRepasseAvistaRR(580, 0.058, COMP), 580));
  checa("334,00 a 3,34% -> 334,00 (no-op abaixo)", perto(baseRepasseAvistaRR(334, 0.0334, COMP), 334));
  checa("percentual 0 -> devolve o valor intacto (nao inventa cap)", perto(baseRepasseAvistaRR(123.45, 0, COMP), 123.45));
  checa("percentual NaN -> devolve o valor intacto", perto(baseRepasseAvistaRR(123.45, Number.NaN, COMP), 123.45));
  checa("valor NaN -> 0", perto(baseRepasseAvistaRR(Number.NaN, 0.06, COMP), 0));
  // a razao tem de ser exatamente teto/pct, para qualquer percentual acima
  const razaoOk = [0.059, 0.06, 0.0815, 0.1].every((pct) => perto(baseRepasseAvistaRR(LIQUIDO * pct, pct, COMP), LIQUIDO * TETO));
  checa("qualquer pct acima do teto cai para liquido x 5,80%", razaoOk, "testados 5,90 / 6,00 / 8,15 / 10,00%");

  checa("dryRun nao gravou nada", full.upserts === 0 && ctrl.upserts === 0, `${full.upserts + ctrl.upserts} upserts`);

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — o repasse sai da comissao-empresa trazida ao teto 5,80%; quem ja estava no teto ou abaixo nao muda.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
