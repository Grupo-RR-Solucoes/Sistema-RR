/*
 * GATE — applyProdutoRepasseAoPmr escreve UMA linha por chave, nunca N.
 *
 * SELF-CONTAINED e OFFLINE: Supabase FALSO em memoria + a funcao REAL
 * applyProdutoRepasseAoPmr (que chama computeProductCommissionByBeneficiario e
 * buildDonaCompanyMapDoMes reais).
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * Os buckets de produto sao chaveados por `beneficiario|company_id da LINHA`.
 * `empresaDe()` manda todos para a empresa DONA do promotor. Ate 24/08/2026 o
 * codigo empurrava um update POR BUCKET: promotor com produto em 3 empresas
 * virava 3 linhas com a MESMA (promoter_id, year, month, company_id) no MESMO
 * upsert, e o Postgres recusa o lote inteiro com
 *   "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * O reconsolidar aborta NO MEIO: o grupo RR+ADS ja gravou producao e seguro, e
 * quem recompoe o final com os produtos e este passo. Medido em jul/2026 depois
 * do abort: 19 linhas com final sem a parcela de produto (-516,06), 17 orfas
 * "so produto" nao reconciliadas.
 *
 * MEDIDO no banco em 24/08/2026:
 *   jul/2026  28 buckets -> 21 chaves finais -> 5 COLAPSOS
 *             (JENIFFER e BIANCA com 3 buckets; JARLES, JAMERSON e MAYANNE com 2)
 *   jun/2026   8 buckets ->  8 chaves finais -> 0 colapsos  (por isso passou)
 *
 * OS DOIS LADOS, NO MESMO RUN:
 *   A) promotor com produto em UMA empresa -> identico ao de antes.
 *   B) promotor com produto em TRES empresas (o caso JENIFFER: AL3+AL1+AL2) ->
 *      UMA linha na empresa dona, com a SOMA dos tres.
 *   C) ANTI-VACUIDADE: o cenario tem de ter os DOIS — promotor que colapsa e
 *      promotor que nao. Sem isso o gate testa metade e passa.
 *   D) CONTRAPROVA: o gate refaz aqui a montagem ANTIGA (uma linha por bucket)
 *      e prova que ELA produz chave repetida — se nao produzisse, o cenario nao
 *      distinguiria o conserto do defeito.
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

const { applyProdutoRepasseAoPmr } = require("../lib/produtoAssignments.ts");

const YEAR = 2026;
const MONTH = 7;
const AL1 = "company-al1";
const AL2 = "company-al2";
const AL3 = "company-al3";
// COLAPSA: produto em AL3 + AL1 + AL2, e a empresa DONA (onde ele produziu
// credito) e a AL3. Espelha a JENIFFER de jul/2026.
const P_TRES = "promotor-tres-empresas";
// NAO COLAPSA: produto so na AL1, que tambem e a dona dele.
const P_UMA = "promotor-uma-empresa";

// ---------------------------------------------------------------------------
// Supabase FALSO
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const upsertBatches = []; // { tabela, rows, onConflict }
  function builder(nome) {
    const filtros = [];
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "neq") return v !== f.val;
        if (f.op === "in") return f.val.includes(v);
        if (f.op === "is") return v === null || v === undefined;
        return true;
      });
    const linhas = () => (db[nome] || []).filter(casa);
    const api = {
      select: () => api,
      eq(col, val) {
        filtros.push({ op: "eq", col, val });
        return api;
      },
      neq(col, val) {
        filtros.push({ op: "neq", col, val });
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
      not() {
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle() {
        return Promise.resolve({ data: linhas()[0] ?? null, error: null });
      },
      range(from, to) {
        return Promise.resolve({ data: linhas().slice(from, to + 1), error: null });
      },
      /**
       * UPSERT COM A TRAVA DO POSTGRES. Duas linhas com a mesma chave de
       * onConflict no MESMO lote devolvem o erro real, com a mensagem real —
       * e o que faz este gate valer alguma coisa: sem isto o fake aceitaria a
       * duplicata em silencio e o defeito passaria verde.
       */
      upsert(rows, opts) {
        const arr = Array.isArray(rows) ? rows : [rows];
        const cols = String(opts?.onConflict || "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        upsertBatches.push({ tabela: nome, rows: arr, onConflict: cols });
        if (cols.length) {
          const vistas = new Set();
          for (const r of arr) {
            const k = cols.map((c) => String(r[c] ?? "null")).join("|");
            if (vistas.has(k)) {
              return Promise.resolve({
                data: null,
                error: {
                  code: "21000",
                  message:
                    "ON CONFLICT DO UPDATE command cannot affect row a second time",
                },
              });
            }
            vistas.add(k);
          }
        }
        db[nome] = db[nome] || [];
        for (const r of arr) {
          const idx = db[nome].findIndex((x) => cols.every((c) => (x[c] ?? null) === (r[c] ?? null)));
          if (idx >= 0) db[nome][idx] = { ...db[nome][idx], ...r };
          else db[nome].push({ id: `id-${db[nome].length + 1}`, ...r });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert() {
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        return { in: () => Promise.resolve({ data: null, error: null }) };
      },
      then(resolve, reject) {
        return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: (nome) => builder(nome), __db: db, __upserts: upsertBatches };
}

// ---------------------------------------------------------------------------
// CENARIO
// ---------------------------------------------------------------------------
const linhaProduto = (companyId, entryType, operacao, contrato, valor) => ({
  id: `e-${entryType}-${operacao}`,
  company_id: companyId,
  year: YEAR,
  month: MONTH,
  entry_type: entryType,
  operation_number: operacao,
  contract_number: contrato,
  commission_value: valor,
});

const atribuicao = (companyId, entryType, operacao, contrato, promoterId) => ({
  company_id: companyId,
  year: YEAR,
  month: MONTH,
  entry_type: entryType,
  operation_number: operacao,
  contract_number: contrato,
  promoter_id: promoterId,
  assigned_app_user_id: null,
  status: "ASSIGNED",
});

// Só BBCAP e CONTA_CORRENTE: sao os EVENTO_UNICO_ENTRY_TYPES que
// fetchProductEntries le. (O consorcio vem de outra fonte — a carteira — e nao
// e necessario para produzir o colapso: bastam buckets em empresas diferentes.)
//
// P_TRES: BBCAP na AL3 + CONTA_CORRENTE na AL1 + CONTA_CORRENTE na AL2 -> 3 buckets.
// P_UMA:  CONTA_CORRENTE so na AL1 -> 1 bucket.
const COM_BBCAP_AL3 = 32; // comissao-EMPRESA; o repasse e um fator dela
const COM_CC_AL1 = 25;
const COM_CC_AL2 = 25;
const COM_CC_UMA = 50;
const ENTRIES = [
  linhaProduto(AL3, "BBCAP", "OP-1", "CT-1", COM_BBCAP_AL3),
  linhaProduto(AL1, "CONTA_CORRENTE", "OP-2", "CT-2", COM_CC_AL1),
  linhaProduto(AL2, "CONTA_CORRENTE", "OP-3", "CT-3", COM_CC_AL2),
  linhaProduto(AL1, "CONTA_CORRENTE", "OP-4", "CT-4", COM_CC_UMA),
];
const ATRIBUICOES = [
  atribuicao(AL3, "BBCAP", "OP-1", "CT-1", P_TRES),
  atribuicao(AL1, "CONTA_CORRENTE", "OP-2", "CT-2", P_TRES),
  atribuicao(AL2, "CONTA_CORRENTE", "OP-3", "CT-3", P_TRES),
  atribuicao(AL1, "CONTA_CORRENTE", "OP-4", "CT-4", P_UMA),
];

// O fechamento decide a empresa DONA: P_TRES produziu na AL3, P_UMA na AL1.
const cash = (companyId, contrato, chaveJ, liquido, pf) => ({
  id: `cash-${contrato}`,
  company_id: companyId,
  year: YEAR,
  month: MONTH,
  entry_type: "CASH",
  sheet_name: "A Vista ",
  contract_number: contrato,
  j_key: chaveJ,
  net_value: liquido,
  insurance_value: 0,
  commission_value: pf,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": chaveJ,
    "% A VISTA": 0.058,
    "COMISSÃO PF": pf,
    "VALOR LÍQUIDO": liquido,
    "COMISSÃO SEGURO": 0,
    "VALOR SEGURO": 0,
    "% PENETRAÇÃO": 0,
    "RESTRIÇÃO SRCC": "Não",
    "PROD. SEGURADA": "Não",
    "DESCRIÇÃO DO PRODUTO": "CREDITO CONSIGNADO",
  },
});

const DB = {
  monthly_closing_entries: [
    ...ENTRIES,
    cash(AL3, "C-100", "J0000001", 100000, 5800),
    cash(AL1, "C-200", "J0000002", 50000, 2900),
  ],
  product_line_assignments: ATRIBUICOES,
  promoters: [
    { id: P_TRES, name: "PROMOTOR DE TRES EMPRESAS" },
    { id: P_UMA, name: "PROMOTOR DE UMA EMPRESA" },
  ],
  j_keys: [
    { j_key: "J0000001", promoter_id: P_TRES, key_type: "INDIVIDUAL" },
    { j_key: "J0000002", promoter_id: P_UMA, key_type: "INDIVIDUAL" },
  ],
  daily_production_records: [],
  // As linhas de PMR que o grupo ja gravou (producao/seguro), onde o produto entra.
  promoter_monthly_results: [
    {
      id: "pmr-1",
      promoter_id: P_TRES,
      company_id: AL3,
      year: YEAR,
      month: MONTH,
      source: "fechamento",
      production_commission_value: 1000,
      insurance_commission_value: 50,
      bbcap_commission_value: 0,
      conta_corrente_commission_value: 0,
      consorcio_commission_value: 0,
      lob_commission_value: 0,
      final_commission_value: 1050,
    },
    {
      id: "pmr-2",
      promoter_id: P_UMA,
      company_id: AL1,
      year: YEAR,
      month: MONTH,
      source: "fechamento",
      production_commission_value: 500,
      insurance_commission_value: 25,
      bbcap_commission_value: 0,
      conta_corrente_commission_value: 0,
      consorcio_commission_value: 0,
      lob_commission_value: 0,
      final_commission_value: 525,
    },
  ],
};

// ---------------------------------------------------------------------------
const falhas = [];
const brl = (n) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perto = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function checa(nome, ok, detalhe) {
  console.log(`${ok ? "  OK  " : "  X   "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}

(async () => {
  const { computeProductCommissionByBeneficiario } = require("../lib/produtoAssignments.ts");
  const { buildDonaCompanyMapDoMes } = require("../lib/closingMonthly.ts");

  const sbLeitura = fakeSupabase(DB);
  const buckets = await computeProductCommissionByBeneficiario(sbLeitura, {
    year: YEAR,
    month: MONTH,
  });
  const dona = await buildDonaCompanyMapDoMes(sbLeitura, { year: YEAR, month: MONTH });
  const porPromotor = [...buckets.values()]
    .filter((v) => v.beneficiario.kind !== "gestao")
    .map((v) => ({ ...v, promoter_id: v.beneficiario.id }));
  const empresaDe = (v) => dona.get(v.promoter_id) ?? v.company_id;

  // -- C) ANTI-VACUIDADE ------------------------------------------------------
  console.log("== C) ANTI-VACUIDADE — o cenario tem colapso E nao-colapso?");
  const porChave = new Map();
  for (const v of porPromotor) {
    const k = `${v.promoter_id}|${empresaDe(v) ?? "null"}`;
    (porChave.get(k) ?? porChave.set(k, []).get(k)).push(v);
  }
  const colapsos = [...porChave.entries()].filter(([, v]) => v.length > 1);
  const semColapso = [...porChave.entries()].filter(([, v]) => v.length === 1);
  console.log(
    `     ${porPromotor.length} buckets -> ${porChave.size} chaves finais | ${colapsos.length} com colapso, ${semColapso.length} sem`
  );
  checa(
    "ha promotor cujos buckets COLAPSAM (3 empresas numa dona so)",
    colapsos.some(([, v]) => v.length >= 3),
    colapsos.map(([k, v]) => `${k.split("|")[0]}=${v.length} buckets`).join(", ") || "NENHUM"
  );
  checa("e ha promotor SEM colapso (1 bucket)", semColapso.length > 0, `${semColapso.length}`);
  if (!colapsos.some(([, v]) => v.length >= 3) || !semColapso.length) {
    console.log("\nGATE VACUO — o cenario perdeu um dos dois lados. REPROVADO.");
    process.exit(2);
  }

  // -- D) CONTRAPROVA: a montagem ANTIGA produz chave repetida ---------------
  console.log("\n== D) CONTRAPROVA — a montagem ANTIGA (uma linha por bucket)");
  const linhasAntigas = porPromotor.map((v) => ({
    promoter_id: v.promoter_id,
    company_id: empresaDe(v),
    year: YEAR,
    month: MONTH,
  }));
  const vistas = new Set();
  let repetidasAntes = 0;
  for (const r of linhasAntigas) {
    const k = `${r.promoter_id}|${r.company_id}|${r.year}|${r.month}`;
    if (vistas.has(k)) repetidasAntes += 1;
    vistas.add(k);
  }
  checa(
    "a montagem antiga produz chave REPETIDA (senao o cenario nao pega o defeito)",
    repetidasAntes > 0,
    `${linhasAntigas.length} linhas, ${repetidasAntes} repeticao(oes)`
  );

  // -- A + B) a funcao REAL --------------------------------------------------
  console.log("\n== A+B) A FUNCAO REAL — uma linha por chave");
  const sb = fakeSupabase(DB);
  const res = await applyProdutoRepasseAoPmr(sb, { year: YEAR, month: MONTH });

  const lotes = sb.__upserts.filter((b) => b.tabela === "promoter_monthly_results");
  let repetidaNoLote = 0;
  for (const lote of lotes) {
    const v = new Set();
    for (const r of lote.rows) {
      const k = lote.onConflict.map((c) => String(r[c] ?? "null")).join("|");
      if (v.has(k)) repetidaNoLote += 1;
      v.add(k);
    }
  }
  checa(
    "nenhum lote de upsert tem chave repetida",
    repetidaNoLote === 0,
    `${lotes.length} lote(s), ${lotes.reduce((s, l) => s + l.rows.length, 0)} linha(s), ${repetidaNoLote} repetida(s)`
  );

  const gravadas = sb.__db.promoter_monthly_results;
  const doTres = gravadas.filter((r) => r.promoter_id === P_TRES);
  const doUma = gravadas.filter((r) => r.promoter_id === P_UMA);
  checa("o promotor de TRES empresas tem UMA linha so", doTres.length === 1, `${doTres.length} linha(s)`);
  checa(
    "e ela esta na empresa DONA (AL3, onde ele produziu credito)",
    doTres[0]?.company_id === AL3,
    String(doTres[0]?.company_id)
  );
  // ESPERADO derivado da regua REAL (repassePromotor), nao de constante colada.
  const { repassePromotor } = require("../lib/produtoRepasse.ts");
  const espBbcap = repassePromotor(COM_BBCAP_AL3);
  const espCc = repassePromotor(COM_CC_AL1) + repassePromotor(COM_CC_AL2);
  const esperadoTres = espBbcap + espCc;
  const somaTres =
    Number(doTres[0]?.bbcap_commission_value || 0) +
    Number(doTres[0]?.conta_corrente_commission_value || 0) +
    Number(doTres[0]?.consorcio_commission_value || 0) +
    Number(doTres[0]?.lob_commission_value || 0);
  checa(
    "com a SOMA dos tres buckets, coluna por coluna",
    perto(doTres[0]?.bbcap_commission_value, espBbcap) &&
      perto(doTres[0]?.conta_corrente_commission_value, espCc),
    `bbcap ${brl(doTres[0]?.bbcap_commission_value)} (esp ${brl(espBbcap)}) + cc ${brl(doTres[0]?.conta_corrente_commission_value)} (esp ${brl(espCc)}, = AL1 + AL2) = ${brl(somaTres)}`
  );
  checa(
    "a conta corrente e a SOMA de DUAS empresas, nao a de uma so",
    !perto(doTres[0]?.conta_corrente_commission_value, repassePromotor(COM_CC_AL1)),
    `${brl(doTres[0]?.conta_corrente_commission_value)} != ${brl(repassePromotor(COM_CC_AL1))} (uma empresa so)`
  );
  checa(
    "e o final = producao + seguro + produtos",
    perto(doTres[0]?.final_commission_value, 1000 + 50 + esperadoTres),
    `${brl(doTres[0]?.final_commission_value)} vs ${brl(1000 + 50 + esperadoTres)}`
  );

  // A) o lado que NAO pode mudar
  const espUma = repassePromotor(COM_CC_UMA);
  checa("o promotor de UMA empresa continua com UMA linha", doUma.length === 1, `${doUma.length}`);
  checa(
    "na mesma empresa, com o mesmo valor de sempre",
    doUma[0]?.company_id === AL1 && perto(doUma[0]?.conta_corrente_commission_value, espUma),
    `${String(doUma[0]?.company_id)} cc ${brl(doUma[0]?.conta_corrente_commission_value)} (esp ${brl(espUma)})`
  );
  checa(
    "e o final dele = 500 + 25 + o produto",
    perto(doUma[0]?.final_commission_value, 525 + espUma),
    `${brl(doUma[0]?.final_commission_value)} vs ${brl(525 + espUma)}`
  );

  // -- diagnostico -----------------------------------------------------------
  console.log("\n== diagnostico do retorno");
  checa(
    "`promotores` conta PROMOTORES DISTINTOS, nao buckets",
    res.promotores === 2,
    `${res.promotores} (buckets seriam ${porPromotor.length})`
  );
  checa(
    "`chaves` tem uma entrada por linha final",
    res.chaves.size === porChave.size,
    `${res.chaves.size} vs ${porChave.size}`
  );

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — uma linha por chave final, com a soma dos buckets, e quem nao colapsa nao mudou.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
