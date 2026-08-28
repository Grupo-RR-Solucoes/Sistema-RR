#!/usr/bin/env node
/* ============================================================================
 * GATE — a matriz de ENTRADA do /financeiro nao pode mentir no gesto que a
 * explica.
 *
 * DUAS IDENTIDADES, cobradas em TODA linha:
 *   (I)  Sigma(outrosDetalhe) == celulas.outros
 *   (II) Sigma(celulas)       == total da linha
 *
 * POR QUE A (I) EXISTE. "Outros" e uma coluna AGREGADA e `expansivel`: quando o
 * leitor a abre, a tela TROCA a coluna pelas linhas do detalhe
 * (app/financeiro/page.tsx:163-167). Valor que entre na celula sem entrada
 * NOMEADA no detalhe simplesmente SOME da tela expandida — e a coluna Total
 * continua com ele. Nao e cosmetico: e a tabela afirmando duas coisas
 * diferentes sobre o mesmo dinheiro.
 *
 * O DEFEITO QUE ISTO VIGIA (medido em 28/08/2026, /api/financeiro 2026-08, logo
 * depois do backfill dos totais da NF):
 *
 *     ADS Consultoria Negocial
 *       celulas.outros        = 100,00     <- Abertura de Conta
 *       Sigma(outrosDetalhe)  =   0,00     (bbcap, conta_corrente, dental, lob, credito)
 *       delta                 = -100,00
 *       Sigma(celulas) = total = 19.048,86 (a (II) fechava; so a (I) quebrava)
 *
 * A causa era a linha da ADS computar os dois lados INDEPENDENTEMENTE, enquanto
 * a linha do RR DERIVA a celula do detalhe (`outros.reduce`). Conserto: a
 * Abertura de Conta virou COLUNA PROPRIA (decisao do Diego, 28/08).
 *
 * SELF-CONTAINED: nao chama createClient, nao le arquivo fora do repo. Roda
 * buildFinancialAnalytics REAL contra um cliente de leitura semeado a mao.
 *
 * NAO E VACUIDADE — tres controles positivos:
 *   - uma linha do RR com "Outros" != 0 E detalhe != 0 (AL2: 488,75 = 475,00 de
 *     conta corrente + 13,75 de LOB). Sem ela, a (I) passaria com 0 == 0.
 *   - a linha de LANCAMENTOS AVULSOS, que legitimamente usa "Outros" com
 *     detalhe por categoria — o contrato sendo CUMPRIDO, nao uma excecao.
 *   - a linha da ADS com a coluna `abertura` != 0, senao a coluna nova poderia
 *     estar sempre vazia e ninguem notaria.
 *
 * ARESTA CONHECIDA, nomeada: `fecharLinha` (financialAnalytics.ts:632-653)
 * devolve residuo de centavo para a MAIOR celula da linha, e o fechamento da
 * matriz (:1487-1500) pode reaplica-lo. Se algum dia a maior celula de uma linha
 * for `outros`, a (I) cai por 1 centavo. Isso NAO e falso positivo: seria o
 * residuo entrando numa coluna agregada sem entrada no detalhe. A resposta certa
 * e manter o residuo fora de coluna expansivel, nao afrouxar a assercao.
 * ==========================================================================*/
require("./_ts_register.cjs");
const Module = require("node:module");

const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let falhas = 0;
let total = 0;
function ok(cond, msg, extra) {
  total += 1;
  if (cond) console.log(`  OK    ${msg}`);
  else {
    falhas += 1;
    console.log(`  FALHA ${msg}${extra ? `\n        ${extra}` : ""}`);
  }
}

// ---- cliente de LEITURA semeado a mao -------------------------------------
// Ignora filtros de proposito: cada tabela devolve exatamente as linhas
// semeadas, e o recorte de competencia fica por conta do codigo sob teste.
// fetchAllRows pagina de 1000 em 1000 e para quando vem menos que isso — com
// conjuntos pequenos, uma pagina basta.
function stubClient(tabelas) {
  const build = (t) =>
    new Proxy(
      {},
      {
        get(_x, p) {
          if (p === "then") {
            return (res, rej) => Promise.resolve({ data: tabelas[t] ?? [], error: null }).then(res, rej);
          }
          if (typeof p === "symbol") return undefined;
          return () => build(t);
        },
      }
    );
  return { from: (t) => build(t) };
}

const CNPJ = {
  al1: "48.357.275/0001-03",
  al2: "56.140.658/0001-53",
  al3: "55.867.409/0001-00",
  pe: "51.457.289/0001-03",
};
function fechamento(cnpj, o) {
  return {
    empresa_cnpj: cnpj,
    ano: 2026,
    mes: 7,
    valor_avista: o.avista ?? 0,
    valor_diferido: o.prt ?? 0,
    valor_seguro: o.seguro ?? 0,
    valor_estorno: o.estorno ?? 0,
    valor_renovacao: 0,
    valor_liquido: 0,
    valor_consorcio: o.consorcio ?? 0,
    valor_bbcap: o.bbcap ?? 0,
    valor_conta_corrente: o.cc ?? 0,
    valor_dental: 0,
    valor_lob: o.lob ?? 0,
    valor_credito: 0,
  };
}

const TABELAS = {
  companies: [
    { id: "c1", name: "RR ALAGOAS 1", cnpj: CNPJ.al1, active: true },
    { id: "c2", name: "RR ALAGOAS 2", cnpj: CNPJ.al2, active: true },
    { id: "c3", name: "RR ALAGOAS 3", cnpj: CNPJ.al3, active: true },
    { id: "c4", name: "RR PERNAMBUCO", cnpj: CNPJ.pe, active: true },
    { id: ADS, name: "ADS Consultoria Negocial", cnpj: "65.286.915/0001-50", active: false },
  ],
  fechamento_mensal_empresa: [
    fechamento(CNPJ.al1, { avista: 38697.17, prt: 34419.19, seguro: 696.9, consorcio: 14803.21, cc: 150, estorno: 73.75 }),
    // CONTROLE POSITIVO: "Outros" 488,75 = 475,00 (conta corrente) + 13,75 (LOB)
    fechamento(CNPJ.al2, { avista: 46660.15, prt: 4092.09, seguro: 835.12, cc: 475, lob: 13.75, estorno: 265.73 }),
    fechamento(CNPJ.al3, { avista: 79964.98, prt: 731.63, seguro: 1977.83, bbcap: 86.7, cc: 300, estorno: 27.42 }),
    fechamento(CNPJ.pe, { avista: 62071.63, prt: 12563.39, seguro: 1621.84, estorno: 56.86 }),
  ],
  // ADS: as tres fontes que a linha dela usa
  daily_production_records: [
    { bbts_pag_avista: 18737.33, bbts_seguro_pago: 204.52, movement_date: "2026-07-15", contract_date: null, proposal_date: null },
  ],
  bbts_prt_parcelas: [{ competencia: "2026-07-01", valor_parcela: 7.01 }],
  bbts_fechamento_totais: [{ competencia: "2026-07-01", abertura_conta: 100 }],
  // CONTROLE POSITIVO: a linha de avulsos usa "Outros" com detalhe por categoria
  receita_lancamento_manual: [
    { ano: 2026, mes: 8, valor: 250, data_credito: "2026-08-10", company_id: null, categoria: "CONSORCIO", descricao: "x" },
    { ano: 2026, mes: 8, valor: 90, data_credito: "2026-08-12", company_id: null, categoria: "AJUSTE", descricao: "y" },
  ],
};

function stubModule(spec, exports) {
  const p = require.resolve(spec);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

(async () => {
  const client = stubClient(TABELAS);
  // A ADS e lida por getSupabaseAdmin (bbts_prt_parcelas tem RLS default-deny e
  // o cliente da pagina nao a alcanca — ver HANDOFF_ADS_FECHAMENTO_CAIXA §17).
  stubModule("@/lib/supabaseAdmin", { getSupabaseAdmin: () => client, hasSupabaseEnv: () => true });

  const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");
  const fin = await buildFinancialAnalytics(client, { year: 2026, month: 8 });
  const m = fin.detalhamento.entrada;
  const chaves = m.colunas.map((c) => c.chave);

  console.log(`\n(A) COLUNAS: ${chaves.join(" | ")}`);
  ok(
    JSON.stringify(chaves) === JSON.stringify(["avista", "prt", "seguro", "abertura", "consorcio", "outros", "ajustes"]),
    "a coluna `abertura` existe e esta ENTRE `seguro` e `consorcio`",
    JSON.stringify(chaves)
  );
  const colAbertura = m.colunas.find((c) => c.chave === "abertura");
  ok(
    !!colAbertura && /bbts_fechamento_totais/.test(String(colAbertura.fonte)),
    "a fonte da coluna `abertura` nomeia bbts_fechamento_totais",
    JSON.stringify(colAbertura && colAbertura.fonte)
  );
  const colOutros = m.colunas.find((c) => c.chave === "outros");
  ok(colOutros && colOutros.expansivel === true, "a coluna `outros` continua expansivel (o gesto existe)");
  ok(
    !!colOutros && !/^fechamento_mensal_empresa \(por CNPJ\)$/.test(String(colOutros.fonte)) &&
      /receita_lancamento_manual/.test(String(colOutros.fonte)),
    "a fonte de `outros` cobre TODAS as linhas da coluna, nao so as do RR",
    JSON.stringify(colOutros && colOutros.fonte)
  );

  console.log(`\n(B) AS ${m.linhas.length} LINHAS, celula a celula`);
  let quebrasI = 0;
  let quebrasII = 0;
  for (const l of m.linhas) {
    const somaDet = r2((l.outrosDetalhe || []).reduce((a, d) => a + (Number(d.valor) || 0), 0));
    const outros = r2(l.celulas.outros);
    const somaCel = r2(Object.values(l.celulas).reduce((a, v) => a + (Number(v) || 0), 0));
    const tot = r2(l.total);
    const i = somaDet === outros;
    const ii = somaCel === tot;
    if (!i) quebrasI += 1;
    if (!ii) quebrasII += 1;
    console.log(
      `    ${String(l.rotulo).padEnd(46).slice(0, 46)} outros=${f(outros).padStart(10)} ` +
        `Sigma(det)=${f(somaDet).padStart(10)} ${i ? "(I) ok " : "(I) QUEBRA"}  ` +
        `Sigma(cel)=${f(somaCel).padStart(12)} total=${f(tot).padStart(12)} ${ii ? "(II) ok" : "(II) QUEBRA"}`
    );
  }
  ok(quebrasI === 0, "(I) Sigma(outrosDetalhe) == celulas.outros em TODA linha", `linhas quebradas: ${quebrasI}`);
  ok(quebrasII === 0, "(II) Sigma(celulas) == total em TODA linha", `linhas quebradas: ${quebrasII}`);

  console.log("\n(C) CONTROLES POSITIVOS — sem eles o gate passa por vacuidade");
  const comOutros = m.linhas.filter((l) => r2(l.celulas.outros) !== 0);
  ok(
    comOutros.length >= 2,
    "ha ao menos DUAS linhas com `outros` != 0 (uma do RR e a de avulsos)",
    `linhas com outros != 0: ${comOutros.map((l) => `${l.rotulo}=${f(l.celulas.outros)}`).join(" | ")}`
  );
  const al2 = m.linhas.find((l) => /ALAGOAS 2/.test(l.rotulo));
  const detAl2 = (al2 && al2.outrosDetalhe.filter((d) => Number(d.valor) !== 0)) || [];
  ok(
    !!al2 && r2(al2.celulas.outros) === 488.75 && detAl2.length === 2,
    "RR ALAGOAS 2: outros 488,75 com DUAS entradas nomeadas no detalhe",
    `outros=${al2 && f(al2.celulas.outros)} detalhe=${JSON.stringify(detAl2)}`
  );
  const avulsos = m.linhas.find((l) => l.avulso === true);
  ok(
    !!avulsos && r2(avulsos.celulas.outros) === 340 && (avulsos.outrosDetalhe || []).length === 2,
    "a linha de avulsos usa `outros` COM detalhe por categoria (o contrato cumprido)",
    `outros=${avulsos && f(avulsos.celulas.outros)} detalhe=${JSON.stringify(avulsos && avulsos.outrosDetalhe)}`
  );

  console.log("\n(D) A LINHA DA ADS");
  const ads = m.linhas.find((l) => String(l.chave) === ADS);
  ok(!!ads, "a linha da ADS existe na matriz");
  if (ads) {
    console.log(`    celulas: ${JSON.stringify(ads.celulas)}`);
    console.log(`    outrosDetalhe: ${JSON.stringify(ads.outrosDetalhe)}`);
    ok(r2(ads.celulas.abertura) === 100, "a Abertura de Conta esta na COLUNA `abertura` (100,00)", f(ads.celulas.abertura));
    ok(r2(ads.celulas.outros) === 0, "`outros` da ADS voltou a ZERO", f(ads.celulas.outros));
    ok(r2(ads.total) === 19048.86, "o total da linha da ADS nao mudou: 19.048,86", f(ads.total));
  }
  ok(
    r2(m.totaisColuna.abertura) === 100,
    "totaisColuna.abertura soma a coluna nova (100,00)",
    f(m.totaisColuna.abertura)
  );

  console.log(`\n=== ${total - falhas}/${total} asserçoes ===`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
