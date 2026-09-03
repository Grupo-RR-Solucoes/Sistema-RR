/* ============================================================================
 * produto_pmr_empresa_dona_gate — o repasse de produto vai para a linha de PMR
 * do promotor, nao para uma linha nova na empresa do produto.
 *
 * Rodar:
 *   node scripts/produto_pmr_empresa_dona_gate.cjs
 *
 * A INVARIANTE: um promotor tem UMA linha de PMR por competencia com
 * source='fechamento', na empresa DONA dele (computeDonaCompanyMap). O repasse de
 * produto entra NESSA linha.
 *
 * O DEFEITO (medido em 24/08/2026): applyProdutoRepasseAoPmr gravava com
 * `company_id` da LINHA DE PRODUTO. O consorcio inteiro e da AL1; quem tem
 * credito noutra empresa recebia uma SEGUNDA linha, porque o UNIQUE do PMR e
 * (promoter_id, year, month, company_id). Nasceram 16 linhas assim em 23/08
 * 23:08, e 13 promotores ficaram com 2+ linhas de fechamento.
 *
 * O ESTRAGO NAO E COSMETICO: closingProposalRows:73 faz
 * `(pmrRows||[]).find(r => r.source === "fechamento")` SEM ORDER BY. Pegando a
 * linha so-produto, `fechCredit` sai 0 e a aba Detalhamento zera a comissao de
 * TODAS as propostas do promotor — 4 zerados (THAYNARA, MAYANNE, ERIVAN,
 * JAMERSON) e outros 9 certos so pela ordem fisica da tabela.
 *
 * OS BLOCOS:
 *   1. ANTI-VACUIDADE — ha promotor com produto em empresa DIFERENTE da dona
 *      (senao o conserto nao teria o que consertar).
 *   2. A REGRA VELHA VIOLA — com `company_id` da linha de produto, a chave do
 *      upsert NAO e a da linha do promotor: seria linha nova. Contraprova.
 *   3. O CONSERTO — a chave que applyProdutoRepasseAoPmr passa a usar aponta
 *      para a linha que JA existe, e o `chaves` devolvido (o que o reconciliador
 *      le) vem com a empresa dona, inclusive em dryRun.
 *   4. LEITOR POR EMPRESA — filtrar o PMR pela empresa dona acha o produto.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildDonaCompanyMapDoMes } = require("../lib/closingMonthly.ts");
const {
  applyProdutoRepasseAoPmr,
  computeProductCommissionByBeneficiario,
} = require("../lib/produtoAssignments.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};
const brl = (n) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const YEAR = 2026;
const MONTH = 7;
// Onde procurar o cenario de COLAPSO quando ele nao estiver na competencia deste
// gate. Nao e "meses quaisquer": e a janela em que existe atribuicao de produto
// (2026-04 e o primeiro fechamento com produto desdobrado).
const COMPETENCIAS_VARRIDAS = [
  [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8],
];
// Os 4 medidos em 24/08: a aba Detalhamento zerou a comissao deles.
const ZERADOS = ["THAYNARA", "MAYANNE", "ERIVAN", "JAMERSON"];

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data: proms } = await sb.from("promoters").select("id, name");
  const nome = new Map((proms || []).map((p) => [p.id, p.name]));
  const { data: cos } = await sb.from("companies").select("id, name");
  const coNome = new Map((cos || []).map((c) => [c.id, c.name]));

  const dona = await buildDonaCompanyMapDoMes(sb, { year: YEAR, month: MONTH });
  const produto = await computeProductCommissionByBeneficiario(sb, { year: YEAR, month: MONTH });
  const porPromotor = [...produto.values()].filter((v) => v.beneficiario.kind === "promotor");

  // ---- 1. ANTI-VACUIDADE ----
  console.log(linha("="));
  console.log("1) ANTI-VACUIDADE — ha produto em empresa DIFERENTE da dona");
  console.log(linha("="));
  const divergentes = porPromotor.filter((v) => {
    const d = dona.get(v.beneficiario.id);
    return d && v.company_id !== d;
  });
  console.log(`   promotores com produto: ${porPromotor.length}  com empresa != dona: ${divergentes.length}`);
  for (const v of divergentes.slice(0, 6))
    console.log(
      `     ${String(nome.get(v.beneficiario.id)).slice(0, 34).padEnd(35)} produto em ` +
        `${String(coNome.get(v.company_id)).padEnd(15)} dona ${coNome.get(dona.get(v.beneficiario.id))}`
    );
  ok(porPromotor.length > 0, "ANTI-VACUIDADE: ha promotor com produto", `${porPromotor.length}`);
  ok(
    divergentes.length > 0,
    "ANTI-VACUIDADE: ha promotor cuja empresa de produto NAO e a dona",
    `${divergentes.length}`
  );
  const zeradosPresentes = ZERADOS.filter((n) =>
    divergentes.some((v) => String(nome.get(v.beneficiario.id) || "").includes(n))
  );
  ok(
    zeradosPresentes.length === ZERADOS.length,
    "os 4 promotores medidos estao entre eles",
    zeradosPresentes.join(", ")
  );

  // ---- 2. A REGRA VELHA VIOLA ----
  console.log("\n" + linha("="));
  console.log("2) REGRA VELHA — a empresa da LINHA DE PRODUTO criaria linha nova");
  console.log(linha("="));
  const { data: pmr } = await sb
    .from("promoter_monthly_results")
    .select("promoter_id, company_id, source, production_commission_value")
    .eq("year", YEAR)
    .eq("month", MONTH)
    .eq("source", "fechamento");
  // A linha "de verdade" do promotor: a que tem credito.
  const comCredito = new Map();
  for (const r of pmr || []) {
    if (Number(r.production_commission_value || 0) > 0) comCredito.set(r.promoter_id, r.company_id);
  }
  let violaria = 0;
  for (const v of divergentes) {
    const real = comCredito.get(v.beneficiario.id);
    if (real && real !== v.company_id) violaria += 1;
  }
  ok(
    violaria > 0,
    "a regra VELHA apontaria para empresa != a da linha com credito (linha nova)",
    `${violaria} promotores`
  );

  // ---- 3. O CONSERTO ----
  console.log("\n" + linha("="));
  console.log("3) CONSERTO — a chave do upsert aponta para a linha DONA");
  console.log(linha("="));
  // dryRun: NAO grava, e devolve `chaves` — que e o que o reconciliador le.
  const res = await applyProdutoRepasseAoPmr(sb, { year: YEAR, month: MONTH, dryRun: true });
  console.log(`   dryRun: promotores=${res.promotores}  chaves=${res.chaves.size}  gravadas=${res.atualizadas + res.inseridas}`);
  ok(res.atualizadas === 0 && res.inseridas === 0, "dryRun NAO grava");
  ok(
    res.chaves.size > 0,
    "dryRun devolve `chaves` (o reconciliador precisa delas para nao apagar ninguem)",
    `${res.chaves.size}`
  );
  // `res.promotores` conta BUCKETS (beneficiario, company_id) — o mesmo promotor
  // aparece uma vez por empresa em que tem produto. O conserto e justamente
  // COLAPSAR esses buckets numa unica linha de PMR, a da empresa dona. Entao a
  // assercao certa e contra promotores DISTINTOS, nao contra os buckets: se
  // `chaves` tivesse o tamanho dos buckets, o defeito estaria de volta.
  const pidsDistintos = new Set(porPromotor.map((v) => v.beneficiario.id));
  console.log(
    `   buckets (beneficiario, empresa do produto)=${res.promotores}  ` +
      `promotores DISTINTOS=${pidsDistintos.size}  chaves de PMR=${res.chaves.size}`
  );
  ok(
    res.chaves.size === pidsDistintos.size,
    "UMA chave de PMR por promotor DISTINTO",
    `${res.chaves.size} x ${pidsDistintos.size}`
  );
  // ANTI-VACUIDADE — REESCRITA em 03/09/2026, e a reescrita e o achado.
  //
  // Estava assim: `res.promotores > pidsDistintos.size` ("ha COLAPSO real").
  // Ela REPROVAVA todo dia, e nao por regressao: VARRI as competencias e o
  // cenario de colapso NAO EXISTE em nenhuma —
  //     2026-04: 0 buckets  | 2026-05: 0  | 2026-06: 13 -> 13 chaves
  //     2026-07: 22 -> 22   | 2026-08: 0
  // Nenhum promotor teve produto em DUAS empresas na mesma competencia, nunca.
  // Era uma guarda amarrada a um formato de dado que o banco nao produz — ela
  // nao vigiava nada, so ficava vermelha, e vermelho permanente e ruido que
  // ensina a ignorar o painel.
  //
  // O QUE FICA NO LUGAR, em dois pedacos, porque afrouxar era a saida errada:
  //   (1) nao-vacuidade DO QUE E PROVAVEL: tem de haver bucket para medir. Sem
  //       isto o gate passaria feliz num mes sem produto nenhum — que e
  //       exatamente o mes 2026-08 de hoje.
  //   (2) uma VARREDURA que continua procurando o colapso em todas as
  //       competencias. Enquanto nao existir, o gate DIZ que a assercao de
  //       colapso nao foi exercitada (nao finge que foi). No dia em que existir,
  //       ele REPROVA cobrando que o gate aponte para aquele mes — que e quando
  //       a assercao passa a valer alguma coisa.
  ok(
    res.promotores > 0,
    "ANTI-VACUIDADE: ha bucket de produto para medir nesta competencia",
    `${res.promotores} buckets`
  );
  const colapsoAqui = res.promotores > pidsDistintos.size;
  console.log(
    colapsoAqui
      ? `   [colapso] ${MONTH}/${YEAR} TEM colapso — a assercao de 1 chave por promotor foi exercitada de verdade`
      : `   [colapso] ${MONTH}/${YEAR} NAO tem colapso (1 bucket por promotor): a assercao de colapso ` +
        `passa por 1:1, nao por conserto. Varrendo as demais competencias...`
  );
  if (!colapsoAqui) {
    const achados = [];
    for (const [yy, mm] of COMPETENCIAS_VARRIDAS) {
      if (yy === YEAR && mm === MONTH) continue;
      try {
        const r2 = await applyProdutoRepasseAoPmr(sb, { year: yy, month: mm, dryRun: true });
        const distintos2 = new Set([...r2.chaves].map((k) => k.split("|")[0])).size;
        console.log(`      ${yy}-${String(mm).padStart(2, "0")}: buckets=${r2.promotores} chaves=${r2.chaves.size}`);
        if (r2.promotores > distintos2) achados.push(`${yy}-${String(mm).padStart(2, "0")}`);
      } catch (e) {
        console.log(`      ${yy}-${String(mm).padStart(2, "0")}: nao mediu (${String(e.message).slice(0, 60)})`);
      }
    }
    ok(
      achados.length === 0,
      "o colapso NAO existe em competencia nenhuma (se existir, este gate tem de apontar para ela)",
      achados.length ? `APONTE O GATE PARA: ${achados.join(", ")}` : "varredura limpa"
    );
  }
  let naDona = 0;
  let foraDaDona = 0;
  for (const k of res.chaves) {
    const [pid, cid] = k.split("|");
    const d = dona.get(pid);
    if (!d) continue; // promotor so-produto: sem dona a resolver (fallback legitimo)
    if (cid === d) naDona += 1;
    else {
      foraDaDona += 1;
      console.log(`      FORA DA DONA: ${nome.get(pid)}  chave=${coNome.get(cid)}  dona=${coNome.get(d)}`);
    }
  }
  ok(naDona > 0, "ANTI-VACUIDADE: ha chave conferida contra a dona", `${naDona}`);
  ok(foraDaDona === 0, "TODA chave aponta para a empresa DONA", `fora=${foraDaDona}`);

  // ---- 4. LEITOR POR EMPRESA ----
  console.log("\n" + linha("="));
  console.log("4) LEITOR POR EMPRESA — filtrar pela dona acha o valor");
  console.log(linha("="));
  // Simula o leitor: para cada promotor com produto, a chave que o upsert usa tem
  // de casar com a linha que TEM credito (a que os leitores por empresa acham).
  let casam = 0;
  let naoCasam = 0;
  for (const k of res.chaves) {
    const [pid, cid] = k.split("|");
    const real = comCredito.get(pid);
    if (!real) continue; // promotor so-produto
    if (real === cid) casam += 1;
    else {
      naoCasam += 1;
      console.log(`      NAO CASA: ${nome.get(pid)}  upsert=${coNome.get(cid)}  linha com credito=${coNome.get(real)}`);
    }
  }
  console.log(`   promotores com credito no PMR: ${casam + naoCasam}`);
  ok(casam > 0, "ANTI-VACUIDADE: ha promotor com credito para casar", `${casam}`);
  ok(
    naoCasam === 0,
    "o produto cai na MESMA linha do credito (o .find() acha a certa)",
    `naoCasam=${naoCasam}`
  );

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
