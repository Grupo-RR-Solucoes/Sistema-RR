/*
 * GATE — VENDA PROPRIA DE GESTAO: o repasse de quem NAO e promotor sai do PMR.
 *
 * SELF-CONTAINED e OFFLINE: nao toca banco nenhum. Monta um Supabase FALSO em
 * memoria e roda as funcoes REAIS do repo (applyProdutoRepasseAoPmr,
 * applyVendaPropriaGestao, computeConsorcioGestorPayout).
 *
 * PROVAS (exit 0 = todas passam; exit 2 = alguma falhou):
 *   A) NO-OP: com venda_propria = false em TODOS e nenhuma linha atribuida a gestao,
 *      o payload do PMR e o payout dos 10% ficam EXATAMENTE como antes da frente, e
 *      gestao_venda_propria nasce VAZIA. E o gate que o Diego pediu.
 *   B) ISOLAMENTO: ligando a venda propria e atribuindo UMA proposta ao gestor, o
 *      payload do PMR continua BYTE-IDENTICO ao do cenario A (o promotor nao perde
 *      nem ganha nada) e o valor dele aparece em gestao_venda_propria.
 *   C) 40% + 10% = 50% SEM REGRA NOVA: na proposta que o gestor vendeu, a venda
 *      propria da 0,40 x comissao-empresa e a fatia dela no payout da 0,10 x a mesma
 *      base — somando 0,50. O payout NAO muda entre A e B (a base sempre somou todas
 *      as parcelas, atribuidas ou nao).
 *   D) TRAVA DE COERENCIA: linha atribuida a gestao com o flag DESLIGADO nao vira
 *      pagamento fantasma — nao entra no PMR nem na venda propria (ignoradas_sem_flag).
 *   E) RECONCILIACAO: devolvendo a proposta ao balde, a linha de venda propria da
 *      competencia e APAGADA (o gestor para de ver uma venda que deixou de ser dele).
 */
require("./_ts_register.cjs");

const { applyProdutoRepasseAoPmr } = require("../lib/produtoAssignments.ts");
const { applyVendaPropriaGestao } = require("../lib/gestaoVendaPropria.ts");
const { computeConsorcioGestorPayout } = require("../lib/consorcio/gestorPayout.ts");

const YEAR = 2026;
const MONTH = 6;
const C1 = "company-1";
const PROMOTOR = "promotor-1";
const GESTOR = "appuser-gestor-1";

// ---------------------------------------------------------------------------
// Supabase FALSO — so o subconjunto do query-builder que estas funcoes usam.
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const log = { upserts: {}, inserts: {}, deletes: {} };

  function builder(nome) {
    const filtros = [];
    let limite = null;
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "in") return f.val.includes(v);
        if (f.op === "is") return v === null || v === undefined;
        if (f.op === "not_is") return v !== null && v !== undefined;
        return true;
      });
    const linhas = () => {
      const out = (db[nome] || []).filter(casa);
      return limite === null ? out : out.slice(0, limite);
    };
    const api = {
      select() {
        return api;
      },
      eq(col, val) {
        filtros.push({ op: "eq", col, val });
        return api;
      },
      in(col, val) {
        filtros.push({ op: "in", col, val });
        return api;
      },
      is(col) {
        filtros.push({ op: "is", col });
        return api;
      },
      not(col, _op) {
        filtros.push({ op: "not_is", col });
        return api;
      },
      order() {
        return api;
      },
      range(from, to) {
        const todas = linhas();
        return Promise.resolve({ data: todas.slice(from, to + 1), error: null });
      },
      limit(n) {
        limite = n;
        return api;
      },
      maybeSingle() {
        const todas = linhas();
        return Promise.resolve({ data: todas[0] ?? null, error: null });
      },
      insert(rows) {
        const arr = Array.isArray(rows) ? rows : [rows];
        db[nome] = db[nome] || [];
        for (const r of arr) db[nome].push({ id: `id-${db[nome].length + 1}-${nome}`, ...r });
        (log.inserts[nome] = log.inserts[nome] || []).push(...arr);
        return Promise.resolve({ data: null, error: null });
      },
      upsert(rows, opts) {
        const arr = Array.isArray(rows) ? rows : [rows];
        const chaves = String(opts?.onConflict || "").split(",").map((c) => c.trim()).filter(Boolean);
        db[nome] = db[nome] || [];
        for (const r of arr) {
          const idx = db[nome].findIndex((x) =>
            chaves.every((k) => (x[k] ?? null) === (r[k] ?? null))
          );
          if (idx >= 0) db[nome][idx] = { ...db[nome][idx], ...r };
          else db[nome].push({ id: `id-${db[nome].length + 1}-${nome}`, ...r });
        }
        (log.upserts[nome] = log.upserts[nome] || []).push(...arr);
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        const del = {
          in(col, vals) {
            const antes = db[nome] || [];
            db[nome] = antes.filter((r) => !vals.includes(r[col]));
            (log.deletes[nome] = log.deletes[nome] || []).push(...vals);
            return Promise.resolve({ data: null, error: null });
          },
          not(col) {
            db[nome] = [];
            return Promise.resolve({ data: null, error: null });
          },
        };
        return del;
      },
      then(resolve, reject) {
        return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }

  return { from: (nome) => builder(nome), __db: db, __log: log };
}

// ---------------------------------------------------------------------------
// CENARIO — junho/2026, uma empresa.
//   BBCAP  B1 comissao-empresa 1000,00  -> promotor (x 0,5833 = 583,30)
//   CONTA  K1 comissao-empresa  500,00  -> promotor (x 0,5833 = 291,65)
//   CONSORCIO P1 PARC1 comissao 200,00  -> promotor (x 0,40   =  80,00)
//   CONSORCIO P2 PARC1 comissao 100,00  -> o dono VARIA por cenario
// Base do payout: 200 + 100 = 300,00 -> gestor_10 = 30,00 em TODOS os cenarios.
// ---------------------------------------------------------------------------
const ENTRIES = [
  { company_id: C1, year: YEAR, month: MONTH, entry_type: "BBCAP", operation_number: "B1", contract_number: "", commission_value: 1000, gross_value: 0, metadata: null },
  { company_id: C1, year: YEAR, month: MONTH, entry_type: "CONTA_CORRENTE", operation_number: "K1", contract_number: "", commission_value: 500, gross_value: 0, metadata: null },
  { company_id: C1, year: YEAR, month: MONTH, entry_type: "CONSORCIO", operation_number: "P1", contract_number: "R|PARC1", commission_value: 200, gross_value: 100000, metadata: null },
  { company_id: C1, year: YEAR, month: MONTH, entry_type: "CONSORCIO", operation_number: "P2", contract_number: "R|PARC1", commission_value: 100, gross_value: 50000, metadata: null },
];

const ancora = (proposta, dono) => ({
  id: `fila-${proposta}`,
  company_id: C1,
  year: YEAR,
  month: MONTH,
  entry_type: "CONSORCIO",
  operation_number: proposta,
  contract_number: "",
  promoter_id: dono && dono.kind === "promotor" ? dono.id : null,
  assigned_app_user_id: dono && dono.kind === "gestao" ? dono.id : null,
  status: dono ? "ASSIGNED" : "PENDING",
  source: "MANUAL",
});

const eventoUnico = (entry_type, op) => ({
  id: `fila-${op}`,
  company_id: C1,
  year: YEAR,
  month: MONTH,
  entry_type,
  operation_number: op,
  contract_number: "",
  promoter_id: PROMOTOR,
  assigned_app_user_id: null,
  status: "ASSIGNED",
  source: "MANUAL",
});

function montaCenario({ donoP2, vendaPropriaLigada, vendaPropriaExistente }) {
  return fakeSupabase({
    monthly_closing_entries: ENTRIES,
    product_line_assignments: [
      eventoUnico("BBCAP", "B1"),
      eventoUnico("CONTA_CORRENTE", "K1"),
      ancora("P1", { kind: "promotor", id: PROMOTOR }),
      ancora("P2", donoP2),
    ],
    promoter_monthly_results: [
      {
        id: "pmr-1",
        promoter_id: PROMOTOR,
        company_id: C1,
        year: YEAR,
        month: MONTH,
        source: "fechamento",
        production_commission_value: 5000,
        insurance_commission_value: 250,
      },
    ],
    app_users: [
      {
        id: GESTOR,
        role: "gestor_consorcio",
        venda_propria: vendaPropriaLigada === true,
        active: true,
        created_at: "2026-01-01",
      },
    ],
    gestao_venda_propria: vendaPropriaExistente || [],
    consorcio_gestor_payout: [],
  });
}

async function roda(cenario) {
  const sb = montaCenario(cenario);
  const produtos = await applyProdutoRepasseAoPmr(sb, { year: YEAR, month: MONTH });
  const vp = await applyVendaPropriaGestao(sb, {
    year: YEAR,
    month: MONTH,
    buckets: produtos.gestao,
  });
  const payout = await computeConsorcioGestorPayout(sb, { year: YEAR, month: MONTH });
  const pmr = (sb.__log.upserts.promoter_monthly_results || [])
    .map((r) => JSON.stringify(r))
    .sort();
  return { sb, produtos, vp, payout, pmr };
}

// ---------------------------------------------------------------------------
const falhas = [];
const ok = [];
function conf(nome, cond, detalhe) {
  if (cond) ok.push(nome);
  else falhas.push(`${nome}${detalhe ? " — " + detalhe : ""}`);
}
const r2 = (v) => Math.round(v * 100) / 100;

(async () => {
  // ---- A) NO-OP: ninguem com venda propria, P2 no balde ----
  const A = await roda({ donoP2: null, vendaPropriaLigada: false });
  conf("A1 PMR do promotor gravado", A.pmr.length === 1, `linhas=${A.pmr.length}`);
  const pmrA = JSON.parse(A.pmr[0]);
  conf(
    "A2 PMR = 583,30 BBCAP + 291,65 CC + 80,00 consorcio",
    pmrA.bbcap_commission_value === 583.3 &&
      pmrA.conta_corrente_commission_value === 291.65 &&
      pmrA.consorcio_commission_value === 80,
    JSON.stringify(pmrA)
  );
  conf(
    "A3 final recompoe producao + seguro + produtos",
    pmrA.final_commission_value === r2(5000 + 250 + 583.3 + 291.65 + 80),
    String(pmrA.final_commission_value)
  );
  conf("A4 nenhum bucket de gestao", A.produtos.gestao.length === 0);
  conf("A5 gestao_venda_propria VAZIA", A.vp.linhas.length === 0 && A.vp.total === 0);
  conf("A6 payout dos 10% = 30,00 sobre base 300,00", A.payout.total_10 === 30, String(A.payout.total_10));

  // ---- B) venda propria LIGADA, P2 atribuida ao gestor ----
  const B = await roda({
    donoP2: { kind: "gestao", id: GESTOR },
    vendaPropriaLigada: true,
  });
  conf(
    "B1 PMR do promotor BYTE-IDENTICO ao cenario A",
    JSON.stringify(B.pmr) === JSON.stringify(A.pmr),
    `A=${A.pmr[0]} B=${B.pmr[0]}`
  );
  conf("B2 um bucket de gestao", B.produtos.gestao.length === 1, `n=${B.produtos.gestao.length}`);
  conf(
    "B3 venda propria = 40,00 (0,40 x 100,00) para o gestor",
    B.vp.linhas.length === 1 &&
      B.vp.linhas[0].app_user_id === GESTOR &&
      B.vp.linhas[0].consorcio === 40 &&
      B.vp.linhas[0].final === 40,
    JSON.stringify(B.vp.linhas)
  );
  conf(
    "B4 role_snapshot carimbado",
    B.vp.linhas[0] && B.vp.linhas[0].role_snapshot === "gestor_consorcio"
  );
  conf(
    "B5 gravou em gestao_venda_propria, NUNCA no PMR",
    (B.sb.__log.upserts.gestao_venda_propria || []).length === 1 &&
      (B.sb.__log.upserts.promoter_monthly_results || []).every((r) => r.promoter_id === PROMOTOR)
  );

  // ---- C) 40% + 10% = 50% sem regra nova ----
  conf(
    "C1 payout INALTERADO entre A e B (base independe da atribuicao)",
    B.payout.total_10 === A.payout.total_10 && B.payout.total_10 === 30,
    `A=${A.payout.total_10} B=${B.payout.total_10}`
  );
  const vendaPropriaP2 = B.vp.linhas[0].consorcio; // 0,40 x 100
  const gestaoSobreP2 = r2(100 * 0.1); // a fatia de P2 dentro do payout
  conf(
    "C2 na venda dele: 40,00 + 10,00 = 50,00 (50% de 100,00)",
    r2(vendaPropriaP2 + gestaoSobreP2) === 50,
    `${vendaPropriaP2} + ${gestaoSobreP2}`
  );

  // ---- D) trava de coerencia: atribuido a gestao, mas flag DESLIGADO ----
  const D = await roda({
    donoP2: { kind: "gestao", id: GESTOR },
    vendaPropriaLigada: false,
  });
  conf(
    "D1 PMR do promotor segue BYTE-IDENTICO",
    JSON.stringify(D.pmr) === JSON.stringify(A.pmr)
  );
  conf(
    "D2 nada pago: 0 linhas de venda propria, 1 ignorada",
    D.vp.linhas.length === 0 && D.vp.ignoradas_sem_flag === 1,
    JSON.stringify({ linhas: D.vp.linhas.length, ign: D.vp.ignoradas_sem_flag })
  );
  conf("D3 nada gravado em gestao_venda_propria", !(D.sb.__log.upserts.gestao_venda_propria || []).length);

  // ---- E) reconciliacao: a proposta volta ao balde, a linha antiga sai ----
  const E = await roda({
    donoP2: null,
    vendaPropriaLigada: true,
    vendaPropriaExistente: [
      {
        id: "vp-antiga",
        app_user_id: GESTOR,
        company_id: C1,
        year: YEAR,
        month: MONTH,
        consorcio_commission_value: 40,
        final_commission_value: 40,
      },
    ],
  });
  conf("E1 nenhuma linha nova de venda propria", E.vp.linhas.length === 0);
  conf(
    "E2 a linha ORFA foi apagada",
    (E.sb.__log.deletes.gestao_venda_propria || []).includes("vp-antiga") &&
      (E.sb.__db.gestao_venda_propria || []).length === 0,
    JSON.stringify(E.sb.__db.gestao_venda_propria)
  );

  // ---- relatorio ----
  const linha = (c) => c.repeat(74);
  console.log(linha("="));
  console.log("GATE — VENDA PROPRIA DE GESTAO (self-contained, sem banco)");
  console.log(linha("="));
  for (const n of ok) console.log("  OK    " + n);
  for (const f of falhas) console.log("  FALHA " + f);
  console.log(linha("-"));
  console.log(`  ${ok.length} passaram, ${falhas.length} falharam`);
  console.log(linha("="));
  process.exit(falhas.length === 0 ? 0 : 2);
})().catch((e) => {
  console.error("ERRO NO GATE:", e);
  process.exit(2);
});
