/*
 * GATE — closingProposalRows: o PMR do promotor e a SOMA das linhas, nao a primeira.
 *
 * SELF-CONTAINED e OFFLINE: nao toca banco nenhum. Monta um Supabase FALSO em
 * memoria e roda a funcao REAL do repo (buildClosingProposalRows), que por sua
 * vez chama loadClosingPromoterBase real.
 *
 * POR QUE ELE EXISTE
 * ------------------
 * Ate 24/08/2026 a funcao fazia `.find(r => r.source === 'fechamento')` e
 * descartava as demais linhas em silencio. Duas linhas 'fechamento' NAO sao
 * estado invalido: o PMR tem uma linha POR EMPRESA. Medido no banco em
 * jul/2026: 13 promotores com mais de uma, e em 11 deles a PRIMEIRA que voltava
 * era a de PRODUTO (credito 0) — o rateio inteiro zerava e a aba Detalhamento
 * exibia 0,00 nos dois cards de comissao com o topo somando certo.
 *
 * OS DOIS LADOS, COMPUTADOS NO MESMO RUN (nenhuma constante congelada):
 *   A) promotor com UMA linha  -> SOMA == PRIMEIRA. Nada muda para quem nao tem
 *      duplicata. Se algum dia divergir, a mudanca vazou para quem nao devia.
 *   B) promotor com DUAS       -> SOMA == credito+seguro somados do PMR, e
 *      DIFERENTE da primeira linha. E o lado que reprova se alguem voltar ao
 *      `.find()`: sem esta desigualdade o gate seria vacuo.
 *   C) o mesmo para as linhas 'bbts' (ADS), que tinham o gemeo exato do defeito.
 *   D) SRCC="Sim" continua com repasse 0 e fora da base do rateio.
 *   E) as colunas de PRODUTO (consorcio/bbcap/conta corrente) NAO entram no
 *      rateio das propostas de credito — elas tem cards proprios na aba.
 *
 * ANTI-VACUIDADE: o run exige que existam, ao mesmo tempo, promotor com 2+
 * linhas E promotor com 1. Se o cenario perder um dos dois lados o gate REPROVA
 * em vez de passar testando metade.
 *
 * CENARIO — espelha o caso MEDIDO da THAYNARA em jul/2026 (numeros reais):
 *   P_DOIS  PMR fechamento RR ALAGOAS 1   cred      0,00  seg     0,00  consorcio 2.568,04
 *           PMR fechamento RR PERNAMBUCO  cred  8.802,93  seg 1.121,91
 *           PMR bbts       ADS            cred    500,00  seg    40,00
 *           PMR bbts       ADS (2a linha) cred    100,00  seg    10,00
 *   P_UM    PMR fechamento RR ALAGOAS 2   cred  1.000,00  seg   100,00
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

const { buildClosingProposalRows } = require("../lib/closingProposalRows.ts");
const { BBTS_COMPANY_ID } = require("../lib/bbtsMonthly.ts");

const YEAR = 2026;
const MONTH = 7;
const AL1 = "company-al1";
const AL2 = "company-al2";
const PE = "company-pe";
const P_DOIS = "promotor-duas-linhas";
const P_UM = "promotor-uma-linha";

// ---------------------------------------------------------------------------
// Supabase FALSO — so o subconjunto do query-builder que estas funcoes usam.
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  function builder(nome) {
    const filtros = [];
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "neq") return v !== f.val;
        if (f.op === "in") return f.val.includes(v);
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
      order: () => api,
      range(from, to) {
        return Promise.resolve({ data: linhas().slice(from, to + 1), error: null });
      },
      then(resolve, reject) {
        return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: (nome) => builder(nome) };
}

// ---------------------------------------------------------------------------
// CENARIO
// ---------------------------------------------------------------------------
const PMR = [
  // P_DOIS — duas linhas 'fechamento' (uma por empresa). A de AL1 e a linha de
  // PRODUTO: credito 0 e consorcio 2.568,04. Foi ela que o `.find()` pegava.
  {
    promoter_id: P_DOIS, company_id: AL1, year: YEAR, month: MONTH, source: "fechamento",
    production_commission_value: 0, insurance_commission_value: 0, consorcio_commission_value: 2568.04,
  },
  {
    promoter_id: P_DOIS, company_id: PE, year: YEAR, month: MONTH, source: "fechamento",
    production_commission_value: 8802.93, insurance_commission_value: 1121.91, consorcio_commission_value: 0,
  },
  // P_DOIS — duas linhas 'bbts' (ADS), o gemeo do mesmo defeito.
  {
    promoter_id: P_DOIS, company_id: BBTS_COMPANY_ID, year: YEAR, month: MONTH, source: "bbts",
    production_commission_value: 500, insurance_commission_value: 40, consorcio_commission_value: 0,
  },
  {
    promoter_id: P_DOIS, company_id: BBTS_COMPANY_ID, year: YEAR, month: MONTH, source: "bbts",
    production_commission_value: 100, insurance_commission_value: 10, consorcio_commission_value: 0,
  },
  // P_UM — uma linha so. Tem que sair identico ao de antes da mudanca.
  {
    promoter_id: P_UM, company_id: AL2, year: YEAR, month: MONTH, source: "fechamento",
    production_commission_value: 1000, insurance_commission_value: 100, consorcio_commission_value: 0,
  },
];

const linhaCash = (companyId, chaveJ, contrato, pf, seguro, srcc) => ({
  id: `cash-${contrato}`,
  company_id: companyId,
  contract_number: contrato,
  j_key: chaveJ,
  product_name: "CREDITO CONSIGNADO",
  year: YEAR,
  month: MONTH,
  entry_type: "CASH",
  net_value: pf * 20,
  insurance_value: seguro * 10,
  commission_value: pf,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": chaveJ,
    "% A VISTA": 0.058,
    "COMISSÃO PF": pf,
    "VALOR LÍQUIDO": pf * 20,
    "COMISSÃO SEGURO": seguro,
    "VALOR SEGURO": seguro * 10,
    "% PENETRAÇÃO": 0.214380107695807,
    "RESTRIÇÃO SRCC": srcc ? "Sim" : "Não",
    "DESCRIÇÃO DO PRODUTO": "CREDITO CONSIGNADO",
  },
});

const DB = {
  promoter_monthly_results: PMR,
  promoters: [
    { id: P_DOIS, name: "PROMOTOR DE DUAS EMPRESAS" },
    { id: P_UM, name: "PROMOTOR DE UMA EMPRESA" },
  ],
  j_keys: [
    { j_key: "J0000001", promoter_id: P_DOIS, key_type: "INDIVIDUAL" },
    { j_key: "J0000002", promoter_id: P_UM, key_type: "INDIVIDUAL" },
  ],
  monthly_closing_entries: [
    // P_DOIS: dois pagaveis (PF 708,10 e 1.369,40) + uma restrita SRCC="Sim".
    linhaCash(PE, "J0000001", "220641347", 708.1, 60, false),
    linhaCash(PE, "J0000001", "219247636", 1369.4, 40, false),
    linhaCash(PE, "J0000001", "214259757", 2315.22, 0, true),
    // P_UM: dois pagaveis.
    linhaCash(AL2, "J0000002", "300000001", 400, 25, false),
    linhaCash(AL2, "J0000002", "300000002", 600, 75, false),
  ],
  daily_production_records: [
    // ADS de P_DOIS — duas linhas, base do rateio 'bbts'.
    {
      id: "ads-1", company_id: BBTS_COMPANY_ID, assigned_promoter_id: P_DOIS, proposal_number: "A1",
      contract_number: "A1", product_description: "ADS", gross_value: 30000, net_value: 30000,
      insurance_value: 900, interest_rate: 1.8, term_months: 84, installments: 84, status: "FECHADO",
      is_srcc_restricted: false, movement_date: "2026-07-15", contract_date: "2026-07-15",
      proposal_date: "2026-07-15", raw_payload: {},
    },
    {
      id: "ads-2", company_id: BBTS_COMPANY_ID, assigned_promoter_id: P_DOIS, proposal_number: "A2",
      contract_number: "A2", product_description: "ADS", gross_value: 10000, net_value: 10000,
      insurance_value: 300, interest_rate: 1.8, term_months: 84, installments: 84, status: "FECHADO",
      is_srcc_restricted: false, movement_date: "2026-07-16", contract_date: "2026-07-16",
      proposal_date: "2026-07-16", raw_payload: {},
    },
  ],
};

// ---------------------------------------------------------------------------
const falhas = [];
const brl = (n) =>
  Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perto = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function checa(nome, ok, detalhe) {
  console.log(`${ok ? "  OK  " : "  X   "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}

const somaFonte = (source, campo, promoterId) =>
  PMR.filter((r) => r.source === source && r.promoter_id === promoterId).reduce(
    (s, r) => s + Number(r[campo] || 0),
    0
  );
/** O que o `.find()` devolvia: a PRIMEIRA linha da fonte, na ordem do banco. */
const primeiraFonte = (source, campo, promoterId) => {
  const r = PMR.find((x) => x.source === source && x.promoter_id === promoterId);
  return Number(r?.[campo] || 0);
};

(async () => {
  const sb = fakeSupabase(DB);

  // -- ANTI-VACUIDADE: os dois lados existem no MESMO run --------------------
  const contagem = (promoterId, source) =>
    PMR.filter((r) => r.promoter_id === promoterId && r.source === source).length;
  const comDuas = contagem(P_DOIS, "fechamento");
  const comUma = contagem(P_UM, "fechamento");
  console.log("== ANTI-VACUIDADE");
  checa(
    "o run tem promotor com 2+ linhas 'fechamento' E promotor com exatamente 1",
    comDuas >= 2 && comUma === 1,
    `duas=${comDuas} uma=${comUma}`
  );
  if (comDuas < 2 || comUma !== 1) {
    console.log("\nGATE VACUO — o cenario perdeu um dos dois lados. REPROVADO.");
    process.exit(2);
  }

  // -- A) promotor com UMA linha: nada pode mudar ----------------------------
  console.log("\n== A) promotor com UMA linha 'fechamento' (nao pode mudar nada)");
  const rowsUm = await buildClosingProposalRows(sb, P_UM, YEAR, MONTH);
  const credUm = rowsUm.reduce((s, r) => s + Number(r.promoter_commission_amount || 0), 0);
  const segUm = rowsUm.reduce((s, r) => s + Number(r.insurance_commission_amount || 0), 0);
  const credUmAntes = primeiraFonte("fechamento", "production_commission_value", P_UM);
  const segUmAntes = primeiraFonte("fechamento", "insurance_commission_value", P_UM);
  checa("SOMA == PRIMEIRA (credito)", perto(credUm, credUmAntes), `${brl(credUm)} vs ${brl(credUmAntes)}`);
  checa("SOMA == PRIMEIRA (seguro)", perto(segUm, segUmAntes), `${brl(segUm)} vs ${brl(segUmAntes)}`);
  checa("as 2 propostas continuam na lista", rowsUm.length === 2, `${rowsUm.length} linhas`);

  // -- B) promotor com DUAS linhas: a soma, e diferente da primeira ----------
  console.log("\n== B) promotor com DUAS linhas 'fechamento' (o caso THAYNARA)");
  const rowsDois = await buildClosingProposalRows(sb, P_DOIS, YEAR, MONTH);
  const rrRows = rowsDois.filter((r) => r.commission_rule_source === "fechamento");
  const credDois = rrRows.reduce((s, r) => s + Number(r.promoter_commission_amount || 0), 0);
  const segDois = rrRows.reduce((s, r) => s + Number(r.insurance_commission_amount || 0), 0);
  const credEsperado = somaFonte("fechamento", "production_commission_value", P_DOIS);
  const segEsperado = somaFonte("fechamento", "insurance_commission_value", P_DOIS);
  const credAntes = primeiraFonte("fechamento", "production_commission_value", P_DOIS);
  checa(
    "SOMA das linhas rateadas == credito somado do PMR",
    perto(credDois, credEsperado),
    `${brl(credDois)} vs ${brl(credEsperado)}`
  );
  checa(
    "SOMA das linhas rateadas == seguro somado do PMR",
    perto(segDois, segEsperado),
    `${brl(segDois)} vs ${brl(segEsperado)}`
  );
  checa(
    "a SOMA e DIFERENTE da primeira linha (senao o gate nao pegaria o `.find()`)",
    !perto(credEsperado, credAntes),
    `soma ${brl(credEsperado)} vs primeira ${brl(credAntes)}`
  );
  checa("nenhum card zera", credDois > 0 && segDois > 0, `credito ${brl(credDois)} seguro ${brl(segDois)}`);

  // -- C) o mesmo para as linhas 'bbts' (ADS) --------------------------------
  console.log("\n== C) linhas 'bbts' (ADS) — mesmo defeito, mesma prova");
  const adsRows = rowsDois.filter((r) => r.commission_rule_source === "bbts");
  const credAds = adsRows.reduce((s, r) => s + Number(r.promoter_commission_amount || 0), 0);
  const segAds = adsRows.reduce((s, r) => s + Number(r.insurance_commission_amount || 0), 0);
  const credAdsEsperado = somaFonte("bbts", "production_commission_value", P_DOIS);
  const segAdsEsperado = somaFonte("bbts", "insurance_commission_value", P_DOIS);
  const credAdsAntes = primeiraFonte("bbts", "production_commission_value", P_DOIS);
  checa(
    "SOMA das linhas ADS == credito somado do PMR bbts",
    perto(credAds, credAdsEsperado),
    `${brl(credAds)} vs ${brl(credAdsEsperado)}`
  );
  checa(
    "SOMA das linhas ADS == seguro somado do PMR bbts",
    perto(segAds, segAdsEsperado),
    `${brl(segAds)} vs ${brl(segAdsEsperado)}`
  );
  checa(
    "a SOMA bbts e DIFERENTE da primeira linha",
    !perto(credAdsEsperado, credAdsAntes),
    `soma ${brl(credAdsEsperado)} vs primeira ${brl(credAdsAntes)}`
  );

  // -- D) SRCC="Sim": repasse 0 e fora da base do rateio ---------------------
  console.log("\n== D) SRCC='Sim' — produzida, nao paga");
  const restrita = rrRows.find((r) => String(r.srcc_restriction).toUpperCase().startsWith("SIM"));
  checa("a linha restrita existe no cenario", !!restrita, restrita ? restrita.contract_number : "AUSENTE");
  checa("repasse da restrita e 0", !!restrita && perto(restrita.promoter_commission_amount, 0));
  checa(
    "a restrita nao consumiu rateio (a soma dos pagaveis ja bate com o PMR)",
    perto(credDois, credEsperado)
  );

  // -- E) produto nao entra no rateio de credito -----------------------------
  console.log("\n== E) colunas de PRODUTO ficam fora do rateio das propostas");
  const consorcio = PMR.filter((r) => r.promoter_id === P_DOIS).reduce(
    (s, r) => s + Number(r.consorcio_commission_value || 0),
    0
  );
  checa("o consorcio do PMR existe no cenario", consorcio > 0, brl(consorcio));
  checa(
    "e NAO esta somado nas propostas de credito",
    perto(credDois, credEsperado) && !perto(credDois, credEsperado + consorcio),
    `propostas ${brl(credDois)} | consorcio ${brl(consorcio)} fora`
  );

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log(
    "APROVADO — a soma das linhas do PMR chega inteira nas propostas, e quem tem uma linha so nao mudou."
  );
})().catch((e) => {
  console.error("ERRO no gate:", e?.message ?? e);
  process.exit(2);
});
