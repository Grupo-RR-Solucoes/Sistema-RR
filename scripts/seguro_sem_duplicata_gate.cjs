/*
 * GATE — o seguro do fechamento sai do CASH e SO do CASH.
 *
 * SELF-CONTAINED e OFFLINE: Supabase FALSO em memoria + a funcao REAL
 * consolidateMonthlyFromClosing (que chama loadClosingPromoterBase real).
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * Ate 24/08/2026 o motor somava `seguroEmpresaEmbutido + seguroEmpresaAvulso`.
 * O "avulso" eram as linhas entry_type='INSURANCE' sheet_name='A Vista ', que
 * NAO sao uma segunda fonte: o importador (monthlyClosingImport.ts:1075-1101)
 * emite DUAS entries da MESMA linha da aba "A Vista" — uma CASH com a comissao
 * PF e uma INSURANCE com a comissao de seguro. O seguro saia DOBRADO e o share
 * o dividia de volta pela metade.
 *
 * Medido no banco em 24/08/2026, casando por (company_id, contrato):
 *   jun/2026  194 de 194 linhas INSURANCE tem par no CASH, valor identico
 *   jul/2026  184 de 184, idem
 * O PMR de jul/2026 tinha 4.453,78 de seguro; sem a duplicata da 2.224,43.
 *
 * OS DOIS LADOS, NO MESMO RUN (nada congelado):
 *   A) COM a duplicata  -> o cenario reproduz o valor DOBRADO, computado aqui
 *      pela regra antiga (embutido + avulso) x share.
 *   B) SEM a duplicata  -> o motor REAL devolve embutido x share.
 *   C) A != B, senao o gate seria vacuo (o cenario nao distinguiria as duas).
 *   D) ANTI-VACUIDADE: o run exige que exista linha INSURANCE COM par no CASH.
 *      Sem isso nao ha duplicata para testar e o gate passa por vazio.
 *   E) SRCC RESTRITA: a duplicata contrabandeava seguro de proposta restrita.
 *      O embutido exclui as restritas (elas ficam fora do agregado); a gemea
 *      INSURANCE nao carrega essa marca e era atribuida assim mesmo. SEVERINA
 *      em jun/2026 recebia seguro com embutido 0,00 — o valor vinha INTEIRO de
 *      uma restrita (contrato 211317389, R$ 22,11); em jul/2026 o mesmo com o
 *      220065875 (R$ 2,76). O gate prova que o promotor que SO tem restrita
 *      fica com seguro 0,00.
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

process.env.PISO_ALLOW_RR_PURE = "1";

const { consolidateMonthlyFromClosing } = require("../lib/closingMonthly.ts");

const YEAR = 2026;
const MONTH = 7;
const CO = "company-1";
const P_SEGURO = "promotor-com-seguro";
const P_RESTRITA = "promotor-so-restrita";

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
      lte(col, val) {
        filtros.push({ op: "lte", col, val });
        return api;
      },
      gte(col, val) {
        filtros.push({ op: "gte", col, val });
        return api;
      },
      lt(col, val) {
        filtros.push({ op: "lt", col, val });
        return api;
      },
      gt(col, val) {
        filtros.push({ op: "gt", col, val });
        return api;
      },
      or() {
        return api;
      },
      order: () => api,
      limit: () => api,
      maybeSingle() {
        return Promise.resolve({ data: linhas()[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: linhas()[0] ?? null, error: null });
      },
      range(from, to) {
        return Promise.resolve({ data: linhas().slice(from, to + 1), error: null });
      },
      upsert(rows) {
        upserts.push(...(Array.isArray(rows) ? rows : [rows]));
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
  return { from: (nome) => builder(nome), __upserts: upserts };
}

// ---------------------------------------------------------------------------
// CENARIO — uma empresa, jul/2026.
//   P_SEGURO   3 contratos pagaveis; 2 com seguro embutido (200,00 + 100,00).
//              Penetracao alta o bastante para cair na faixa de 50%.
//   P_RESTRITA 1 contrato SRCC="Sim" com seguro 22,11 (o caso SEVERINA).
// Para CADA linha CASH com seguro existe a gemea INSURANCE sheet_name="A Vista "
// com o MESMO valor — exatamente o que o importador produz.
// ---------------------------------------------------------------------------
const SEGURO_A = 200;
const SEGURO_B = 100;
const SEGURO_RESTRITA = 22.11;

const cash = (contrato, chaveJ, liquido, pf, seguro, srcc, segurada) => ({
  id: `cash-${contrato}`,
  company_id: CO,
  year: YEAR,
  month: MONTH,
  entry_type: "CASH",
  sheet_name: "A Vista ",
  contract_number: contrato,
  j_key: chaveJ,
  product_name: "CREDITO CONSIGNADO",
  net_value: liquido,
  insurance_value: seguro * 10,
  commission_value: pf,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": chaveJ,
    "% A VISTA": 0.058,
    "COMISSÃO PF": pf,
    "VALOR LÍQUIDO": liquido,
    "COMISSÃO SEGURO": seguro,
    "VALOR SEGURO": seguro * 10,
    "% PENETRAÇÃO": 0.5,
    "RESTRIÇÃO SRCC": srcc ? "Sim" : "Não",
    "PROD. SEGURADA": segurada ? "Sim" : "Não",
    "DESCRIÇÃO DO PRODUTO": "CREDITO CONSIGNADO",
  },
});

/** A GEMEA que o importador emite da MESMA linha (buildEntriesForRow:1095). */
const gemeaInsurance = (linhaCash) => ({
  ...linhaCash,
  id: `ins-${linhaCash.contract_number}`,
  entry_type: "INSURANCE",
  commission_value: Number(linhaCash.metadata["COMISSÃO SEGURO"]),
});

const CASH_ROWS = [
  cash("C0000001", "J0000001", 100000, 5800, SEGURO_A, false, true),
  cash("C0000002", "J0000001", 100000, 5800, SEGURO_B, false, true),
  cash("C0000003", "J0000001", 20000, 1160, 0, false, false),
  cash("C0000009", "J0000002", 30000, 0, SEGURO_RESTRITA, true, true),
];

const DB = {
  monthly_closing_entries: [
    ...CASH_ROWS,
    // Gemeas INSURANCE — so onde ha comissao de seguro (o importador descarta a
    // gemea de valor zero em buildBaseEntry:996).
    ...CASH_ROWS.filter((r) => Number(r.metadata["COMISSÃO SEGURO"]) > 0).map(gemeaInsurance),
  ],
  promoters: [
    { id: P_SEGURO, name: "PROMOTOR COM SEGURO" },
    { id: P_RESTRITA, name: "PROMOTOR SO COM RESTRITA" },
  ],
  j_keys: [
    { j_key: "J0000001", promoter_id: P_SEGURO, key_type: "INDIVIDUAL" },
    { j_key: "J0000002", promoter_id: P_RESTRITA, key_type: "INDIVIDUAL" },
  ],
  daily_production_records: [],
  monthly_targets: [],
  promoter_monthly_results: [],
  promoter_profiles: [],
  promoter_share_scales: [],
  promoter_agreements: [],
  insurance_slip_rules: [],
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
  // -- D) ANTI-VACUIDADE ------------------------------------------------------
  console.log("== D) ANTI-VACUIDADE — existe gemea INSURANCE com par no CASH?");
  const chaveDe = (r) => `${r.company_id}|${String(r.metadata.CONTRATO).trim()}`;
  const cashKeys = new Set(
    DB.monthly_closing_entries.filter((r) => r.entry_type === "CASH").map(chaveDe)
  );
  const insRows = DB.monthly_closing_entries.filter(
    (r) => r.entry_type === "INSURANCE" && r.sheet_name === "A Vista "
  );
  const comPar = insRows.filter((r) => cashKeys.has(chaveDe(r)));
  const somaDuplicata = comPar.reduce((s, r) => s + Number(r.commission_value), 0);
  checa(
    "ha linha INSURANCE 'A Vista ' com par no CASH (senao nao ha duplicata a testar)",
    comPar.length > 0 && comPar.length === insRows.length,
    `${comPar.length} de ${insRows.length} linhas, Sigma ${brl(somaDuplicata)}`
  );
  if (!comPar.length) {
    console.log("\nGATE VACUO — o cenario nao tem duplicata. REPROVADO.");
    process.exit(2);
  }
  const restritaDuplicada = comPar.find((r) => r.metadata["RESTRIÇÃO SRCC"] === "Sim");
  checa(
    "e ha gemea INSURANCE de proposta SRCC RESTRITA (o caso SEVERINA)",
    !!restritaDuplicada,
    restritaDuplicada ? `contrato ${restritaDuplicada.metadata.CONTRATO} ${brl(restritaDuplicada.commission_value)}` : "AUSENTE"
  );

  // -- B) O motor REAL --------------------------------------------------------
  console.log("\n== B) O MOTOR REAL (dryRun) — seguro so do embutido");
  const sb = fakeSupabase(DB);
  const res = await consolidateMonthlyFromClosing(sb, {
    year: YEAR,
    month: MONTH,
    dryRun: true,
  });
  const table = res?.table ?? [];
  const doSeguro = table.find((t) => t.promoter_id === P_SEGURO);
  const soRestrita = table.find((t) => t.promoter_id === P_RESTRITA);
  checa("o promotor com seguro esta na tabela", !!doSeguro);
  const share = Number(doSeguro?.seguro_share ?? 0);
  const embutido = SEGURO_A + SEGURO_B;
  const semDup = embutido * share;
  const comDup = (embutido + somaDuplicata) * share; // a regra ANTIGA, computada aqui
  console.log(
    `     share ${share} | embutido ${brl(embutido)} | duplicata ${brl(somaDuplicata)}`
  );
  checa(
    "seguro_empresa == embutido (a duplicata NAO entra)",
    perto(doSeguro?.seguro_empresa, embutido),
    `${brl(doSeguro?.seguro_empresa)} vs ${brl(embutido)}`
  );
  checa(
    "insurance_commission == embutido x share",
    perto(doSeguro?.insurance_commission_value, semDup),
    `${brl(doSeguro?.insurance_commission_value)} vs ${brl(semDup)}`
  );

  // -- A + C) o lado ANTIGO, no mesmo run ------------------------------------
  console.log("\n== A+C) O LADO ANTIGO (embutido + avulso) x O DE AGORA");
  console.log(`     COM a duplicata daria ${brl(comDup)} | SEM da ${brl(semDup)}`);
  checa(
    "os dois lados sao DIFERENTES (senao o cenario nao distingue nada)",
    !perto(comDup, semDup),
    `delta ${brl(comDup - semDup)}`
  );
  checa(
    "o motor devolve o lado SEM duplicata, nao o COM",
    perto(doSeguro?.insurance_commission_value, semDup) &&
      !perto(doSeguro?.insurance_commission_value, comDup)
  );

  // -- E) SRCC restrita -------------------------------------------------------
  // ATENCAO A VACUIDADE: com o conserto, P_RESTRITA nao aparece NA TABELA — ele
  // some do agregado inteiro, porque a restrita nunca entrou no CASH agregado e
  // nao ha mais addSeguroAvulso para criar a entrada dele via getAgg. Por isso a
  // prova nao pode ser "o campo dele e 0": um `undefined` passaria por acidente.
  // As provas abaixo dizem o que de fato aconteceu.
  console.log("\n== E) SRCC='Sim' — a restrita nao vira seguro de ninguem");
  console.log(
    `     pela regra ANTIGA o P_RESTRITA entraria no agregado via addSeguroAvulso, ` +
      `com seguro_empresa ${brl(SEGURO_RESTRITA)}`
  );
  checa(
    "o promotor que SO tem proposta restrita nao existe no agregado",
    soRestrita === undefined,
    soRestrita === undefined
      ? "ausente da tabela"
      : `presente com ${brl(soRestrita.insurance_commission_value)}`
  );
  const totalSeguro = table.reduce((s, t) => s + Number(t.insurance_commission_value || 0), 0);
  checa(
    "o seguro da restrita nao reaparece em NINGUEM",
    perto(totalSeguro, semDup),
    `Sigma da competencia ${brl(totalSeguro)} vs embutido-pagavel x share ${brl(semDup)}`
  );
  checa(
    "e a restrita vale o bastante para o teste nao ser vacuo",
    SEGURO_RESTRITA > 0 && !perto(totalSeguro, semDup + SEGURO_RESTRITA * share),
    `se ela entrasse, o total seria ${brl(semDup + SEGURO_RESTRITA * share)}`
  );

  // -- F) campo fantasma ------------------------------------------------------
  console.log("\n== F) o diagnostico nao devolve mais campo morto");
  checa(
    "`seguro_avulso` saiu do retorno (nada de campo fantasma)",
    !("seguro_avulso" in (res || {})),
    Object.keys(res || {}).join(", ")
  );
  checa("dryRun nao gravou nada", sb.__upserts.length === 0, `${sb.__upserts.length} upserts`);

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — o seguro sai do embutido no CASH, a duplicata nao entra, e a restrita nao vira repasse.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
