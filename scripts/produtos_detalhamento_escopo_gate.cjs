/* ============================================================================
 * produtos_detalhamento_escopo_gate — o detalhamento por produto so entrega a
 * linha de QUEM E DONO dela.
 *
 * Rodar:
 *   node scripts/produtos_detalhamento_escopo_gate.cjs
 *
 * A INVARIANTE, em duas metades que se sustentam:
 *   ESCOPO  — buildProdutoProposalRows exige promoterId e filtra na ORIGEM.
 *             Promotor A nunca recebe linha do promotor B, e o ?promoterId= de
 *             um promotor e DESCARTADO pela rota (promotorEfetivoDaSessao).
 *   CAMPO   — a comissao da EMPRESA so vai para quem podeVerComissaoDePromotor
 *             autoriza. O promotor ve o repasse DELE e mais nada.
 *
 * POR QUE O PAPEL `promotor` DA FALSE EM podeVerComissaoDePromotor: o direito
 * dele e sobre a comissao DELE, e isso e ESCOPO. Ligar o helper para `promotor`
 * o faria ver a comissao dos COLEGAS no instante em que alguem passasse um
 * ?promoterId= de outra pessoa. O bloco 2 prova as duas coisas juntas.
 *
 * ----------------------------------------------------------------------------
 * POR QUE CONJUNTO FABRICADO, E NAO "ATRIBUI EM PRODUCAO E DESFAZ" (escolha (b))
 * ----------------------------------------------------------------------------
 * Hoje ha ZERO linhas ASSIGNED: o builder devolveria vazio para todo mundo e o
 * gate passaria por VACUIDADE — "A nao ve linha de B" seria verdade porque nao
 * ha linha nenhuma. Entao alguma coisa tinha de ser fabricada.
 *
 * A alternativa era o gate ATRIBUIR uma linha real e desfazer. Recusada, e o
 * motivo e tecnico, nao estetico: o PostgREST nao expoe transacao. "Atribuir e
 * desfazer" sao dois writes independentes, e uma queda entre eles deixa uma
 * ATRIBUICAO DE VERDADE em producao — que muda repasse no proximo reconsolidar.
 * Um gate nao pode ter como pior caso "mexeu no dinheiro".
 *
 * O bloco 4 (banco) fica DECLARADO PENDENTE enquanto ninguem atribuir, mas nao
 * fica mudo: ele mede quantas linhas existem e quantas estao atribuidas, e
 * ACORDA sozinho — no dia em que houver ASSIGNED, ele passa a exercitar o
 * builder contra producao e a cobrar o isolamento com dado real.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const {
  podeVerComissaoDePromotor,
  promotorEfetivoDaSessao,
} = require("../lib/auth/visibilidadeComissao.ts");
const { buildProdutoProposalRows } = require("../lib/produtos/produtoProposalRows.ts");
const {
  resolveConsorcioBeneficiarioByProposta,
  computeConsorcioCommissionByBeneficiario,
  chaveProposta,
} = require("../lib/consorcio/fila.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};
const brl = (n) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const A = "promotor-A-0000-0000-000000000001";
const B = "promotor-B-0000-0000-000000000002";
const CO = "empresa-0000-0000-0000-000000000009";
const YEAR = 2026;
const MONTH = 7;
const COMP = "2026-07";

// ---- conjunto FABRICADO: 2 promotores, 3 produtos, 1 linha orfa ----
const ENTRIES = [
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "BBCAP", operation_number: "BB-A1", contract_number: "", j_key: null, commission_value: 100, gross_value: 1000, operation_date: "2026-07-10", metadata: { cpf_cliente: "111", codigo_produto: "Ourocap X", data_debito: "2026-07-11", valor_produto: 1000, login_agente: "999" } },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "BBCAP", operation_number: "BB-B1", contract_number: "", j_key: null, commission_value: 200, gross_value: 2000, operation_date: "2026-07-12", metadata: { cpf_cliente: "222" } },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-A1", contract_number: "", j_key: "JJ000001", commission_value: 25, gross_value: 0, operation_date: "2026-07-15", metadata: { agencia: "1234", produto_texto: "Ativacao PF" } },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-B1", contract_number: "", j_key: "JJ000002", commission_value: 25, gross_value: 0, operation_date: "2026-07-16", metadata: { agencia: "5678" } },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-ORFA", contract_number: "", j_key: null, commission_value: 25, gross_value: 0, operation_date: "2026-07-17", metadata: {} },
];
const FILA = [
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "BBCAP", operation_number: "BB-A1", contract_number: "", promoter_id: A, status: "ASSIGNED" },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "BBCAP", operation_number: "BB-B1", contract_number: "", promoter_id: B, status: "ASSIGNED" },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-A1", contract_number: "", promoter_id: A, status: "ASSIGNED" },
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-B1", contract_number: "", promoter_id: B, status: "ASSIGNED" },
  // PENDING com dono preenchido: NAO pode entrar — status manda.
  { year: YEAR, month: MONTH, company_id: CO, entry_type: "CONTA_CORRENTE", operation_number: "CC-ORFA", contract_number: "", promoter_id: A, status: "PENDING" },
  // ANCORAS de consorcio: a fonte do dono da PARCELA desde 23/08/2026. A carteira
  // ficou so com posicao/teto/valor — o promoter_id dela e retrato do import e
  // envelhecia. CS-ORFA fica de fora de proposito, para contar como sem dono.
  { company_id: CO, entry_type: "CONSORCIO", operation_number: "CS-A1", contract_number: "", promoter_id: A, status: "ASSIGNED" },
  { company_id: CO, entry_type: "CONSORCIO", operation_number: "CS-B1", contract_number: "", promoter_id: B, status: "ASSIGNED" },
];
const CARTEIRA = [
// promoter_id DE PROPOSITO NULO nas tres: e o estado real da producao (a carteira
// so ganha dono quando alguem RE-MATERIALIZA, o que so acontece no import). Se o
// builder voltasse a ler o dono daqui, o bloco 2 reprovaria na hora.
  { company_id: CO, proposta: "CS-A1", posicao: 3, teto_parcelas: 6, segmento_grupo: "GERAL", segmento_codigo: "DEMAIS", valor_bem: 50000, pct_comissao_ref: 0.004, comissao_recebida: 200, competencia_recebida: COMP, status: "RECEBIDA", promoter_id: null },
  { company_id: CO, proposta: "CS-B1", posicao: 1, teto_parcelas: 6, segmento_grupo: "IMOVEL", segmento_codigo: "IM240", valor_bem: 90000, pct_comissao_ref: 0.002, comissao_recebida: 180, competencia_recebida: COMP, status: "RECEBIDA", promoter_id: null },
  { company_id: CO, proposta: "CS-ORFA", posicao: 1, teto_parcelas: 6, segmento_grupo: "GERAL", segmento_codigo: "DEMAIS", valor_bem: 10000, pct_comissao_ref: 0.004, comissao_recebida: 40, competencia_recebida: COMP, status: "RECEBIDA", promoter_id: null },
];

/** Shim de leitura: devolve o conjunto fabricado, sem banco. */
function shimFabricado() {
  const tabela = {
    monthly_closing_entries: ENTRIES,
    product_line_assignments: FILA,
    carteira_consorcio: CARTEIRA,
  };
  return {
    from(nome) {
      const filtros = [];
      const api = {
        select: () => api,
        eq: (col, val) => {
          filtros.push((r) => String(r[col] ?? "") === String(val));
          return api;
        },
        in: (col, vals) => {
          filtros.push((r) => vals.includes(r[col]));
          return api;
        },
        order: () => api,
        range: (de, ate) => {
          const todas = (tabela[nome] || []).filter((r) => filtros.every((f) => f(r)));
          return Promise.resolve({ data: todas.slice(de, ate + 1), error: null });
        },
        // AWAITABLE sem .range(): resolveConsorcioBeneficiarioByProposta faz
        // `await supabase.from(...).select(...).eq(...)` direto.
        then: (resolve, reject) => {
          const todas = (tabela[nome] || []).filter((r) => filtros.every((f) => f(r)));
          return Promise.resolve({ data: todas, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

(async () => {
  // ---- 1. PURO — as duas metades da regra ----
  console.log(linha("="));
  console.log("1) PURO — escopo (quem) e campo (o que), sem banco");
  console.log(linha("="));
  ok(
    promotorEfetivoDaSessao({ role: "promotor", promoterIdDaSessao: A, promoterIdPedido: B }) === A,
    "promotor pedindo ?promoterId=<B> recebe o proprio id (param DESCARTADO)"
  );
  ok(
    promotorEfetivoDaSessao({ role: "socio", promoterIdDaSessao: null, promoterIdPedido: B }) === B,
    "socio escolhe pelo parametro"
  );
  ok(
    promotorEfetivoDaSessao({ role: "funcionario", promoterIdDaSessao: null, promoterIdPedido: A }) === A,
    "funcionario tambem"
  );
  for (const papel of ["supervisor", "gerente_regional", "gestor_consorcio", "papel_novo"]) {
    ok(
      promotorEfetivoDaSessao({ role: papel, promoterIdDaSessao: A, promoterIdPedido: A }) === undefined,
      `${papel} nao recebe carteira nenhuma (undefined)`
    );
  }
  ok(podeVerComissaoDePromotor("socio") === true, "CAMPO: socio ve comissao da empresa");
  ok(podeVerComissaoDePromotor("funcionario") === true, "CAMPO: funcionario tambem");
  ok(
    podeVerComissaoDePromotor("promotor") === false,
    "CAMPO: promotor NAO — o direito dele e escopo, nao campo (nao 'consertar')"
  );

  // O builder recusa chamada sem escopo. E a guarda, nao um default.
  let recusou = false;
  try {
    await buildProdutoProposalRows(shimFabricado(), {
      promoterId: "",
      year: YEAR,
      month: MONTH,
      incluirComissaoEmpresa: true,
    });
  } catch {
    recusou = true;
  }
  ok(recusou, "o builder RECUSA promoterId vazio (nao devolve 'tudo')");

  // ---- 2. ISOLAMENTO — A nao ve B, com dado dos dois no conjunto ----
  console.log("\n" + linha("="));
  console.log("2) ISOLAMENTO — A e B no mesmo conjunto; cada um so ve o seu");
  console.log(linha("="));
  const daA = await buildProdutoProposalRows(shimFabricado(), {
    promoterId: A,
    year: YEAR,
    month: MONTH,
    incluirComissaoEmpresa: false,
  });
  const daB = await buildProdutoProposalRows(shimFabricado(), {
    promoterId: B,
    year: YEAR,
    month: MONTH,
    incluirComissaoEmpresa: false,
  });
  console.log(
    `   A: ${daA.rows.length} linha(s) [${daA.rows.map((r) => r.operacao).join(", ")}]  total ${brl(daA.totais.total)}`
  );
  console.log(
    `   B: ${daB.rows.length} linha(s) [${daB.rows.map((r) => r.operacao).join(", ")}]  total ${brl(daB.totais.total)}`
  );
  ok(daA.rows.length === 3, "ANTI-VACUIDADE: A TEM linha para receber (3)", `${daA.rows.length}`);
  ok(daB.rows.length === 3, "ANTI-VACUIDADE: B tambem (3)", `${daB.rows.length}`);
  const opsB = new Set(daB.rows.map((r) => r.operacao));
  const vazou = daA.rows.filter((r) => opsB.has(r.operacao));
  ok(vazou.length === 0, "NENHUMA linha de B no resultado de A", vazou.map((r) => r.operacao).join(", "));
  ok(
    daA.rows.every((r) => r.operacao.includes("-A")),
    "todas as linhas de A sao de A",
    daA.rows.map((r) => r.operacao).join(", ")
  );
  ok(
    !daA.rows.some((r) => r.operacao === "CC-ORFA"),
    "linha PENDING com promoter_id preenchido NAO entra (status manda)"
  );
  ok(
    !daA.rows.some((r) => r.operacao === "CS-ORFA"),
    "parcela de consorcio sem dono NAO entra"
  );
  ok(
    daA.sem_atribuicao.conta_corrente === 1 && daA.sem_atribuicao.consorcio === 1,
    "e as orfas sao CONTADAS pela FILA (nao pela carteira defasada)",
    JSON.stringify(daA.sem_atribuicao)
  );
  // os tres produtos aparecem
  ok(
    new Set(daA.rows.map((r) => r.entry_type)).size === 3,
    "os TRES produtos vieram (BBCAP, CONTA_CORRENTE, CONSORCIO)"
  );
  // repasses: BBCAP/CC x 0,5833 ; consorcio x 0,40
  const bbA = daA.rows.find((r) => r.entry_type === "BBCAP");
  const csA = daA.rows.find((r) => r.entry_type === "CONSORCIO");
  ok(Math.abs(bbA.comissao_promotor - 58.33) < 0.005, "BBCAP 100,00 x 0,5833 = 58,33", brl(bbA.comissao_promotor));
  ok(Math.abs(csA.comissao_promotor - 80) < 0.005, "CONSORCIO 200,00 x 0,40 = 80,00", brl(csA.comissao_promotor));
  ok(csA.parcela === "3/6", "a carteira traz a POSICAO da parcela (3/6)", String(csA.parcela));

  // ---- 3. CAMPO — a comissao da EMPRESA some para quem nao tem direito ----
  console.log("\n" + linha("="));
  console.log("3) CAMPO — comissao da EMPRESA so para quem pode ver");
  console.log(linha("="));
  const comEmpresa = await buildProdutoProposalRows(shimFabricado(), {
    promoterId: A,
    year: YEAR,
    month: MONTH,
    incluirComissaoEmpresa: podeVerComissaoDePromotor("socio"),
  });
  const semEmpresa = await buildProdutoProposalRows(shimFabricado(), {
    promoterId: A,
    year: YEAR,
    month: MONTH,
    incluirComissaoEmpresa: podeVerComissaoDePromotor("promotor"),
  });
  ok(
    comEmpresa.rows.every((r) => typeof r.comissao_empresa === "number"),
    "ANTI-VACUIDADE: com socio, TODA linha traz comissao_empresa"
  );
  ok(
    semEmpresa.rows.every((r) => r.comissao_empresa === undefined),
    "com promotor, NENHUMA linha traz comissao_empresa"
  );
  ok(
    semEmpresa.rows.every((r) => typeof r.comissao_promotor === "number"),
    "mas o repasse DELE continua vindo (senao a tela dele fica vazia)"
  );
  ok(
    comEmpresa.rows.length === semEmpresa.rows.length,
    "o numero de LINHAS e o mesmo — muda o campo, nao o escopo",
    `${comEmpresa.rows.length} x ${semEmpresa.rows.length}`
  );
  // Nenhum campo de comissao de GESTOR em lugar nenhum do payload do promotor.
  const jsonPromotor = JSON.stringify(semEmpresa);
  ok(!/gestor/i.test(jsonPromotor), "nada de 'gestor' no payload do promotor");

  // ---- 4. BANCO — declarado PENDENTE ate haver atribuicao (acorda sozinho) ----
  console.log("\n" + linha("="));
  console.log("4) BANCO — o alcance real hoje");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data: fila } = await sb
    .from("product_line_assignments")
    .select("entry_type, status, promoter_id, year, month");
  const total = (fila || []).length;
  const assigned = (fila || []).filter((r) => r.status === "ASSIGNED" && r.promoter_id);
  const { count: nCarteira } = await sb
    .from("carteira_consorcio")
    .select("*", { count: "exact", head: true })
    .not("promoter_id", "is", null);
  console.log(`   fila: ${total} linha(s), ${assigned.length} ASSIGNED com dono`);
  console.log(`   carteira_consorcio com promoter_id: ${nCarteira ?? 0}`);
  ok(total > 0, "ANTI-VACUIDADE: HA linha de produto na fila (senao nao ha o que atribuir)", `${total}`);

  if (assigned.length === 0 && (nCarteira ?? 0) === 0) {
    console.log(
      "   PENDENTE: nenhuma linha atribuida ainda — o isolamento contra PRODUCAO nao foi\n" +
        "   exercitado. Os blocos 1-3 cobrem a regra com conjunto fabricado. Este bloco\n" +
        "   ACORDA sozinho no dia em que alguem atribuir na /produtos/atribuicao."
    );
  } else {
    const pids = [...new Set(assigned.map((r) => r.promoter_id))];
    console.log(`   promotores com linha atribuida: ${pids.length}`);
    let cruzou = 0;
    for (const pid of pids.slice(0, 5)) {
      const res = await buildProdutoProposalRows(sb, {
        promoterId: pid,
        year: 2026,
        month: 7,
        incluirComissaoEmpresa: true,
      });
      const outros = res.rows.filter((r) => false); // o builder ja filtra na origem
      void outros;
      console.log(`     ${pid}: ${res.rows.length} linha(s), total ${brl(res.totais.total)}`);
      for (const outro of pids.filter((x) => x !== pid)) {
        const doOutro = await buildProdutoProposalRows(sb, {
          promoterId: outro,
          year: 2026,
          month: 7,
          incluirComissaoEmpresa: true,
        });
        const ops = new Set(doOutro.rows.map((r) => `${r.entry_type}|${r.operacao}`));
        cruzou += res.rows.filter((r) => ops.has(`${r.entry_type}|${r.operacao}`)).length;
      }
    }
    ok(cruzou === 0, "PRODUCAO: nenhuma linha aparece para dois promotores", `cruzamentos=${cruzou}`);
  }

  // ---- 5. UMA FONTE PARA O DONO ----
  console.log("\n" + linha("="));
  console.log("5) UMA FONTE — o dono do builder e o dono do PAGAMENTO");
  console.log(linha("="));
  const YEAR_C = 2026;
  const MONTH_C = 7;
  const COMP_C = "2026-07";

  // A VERDADE do dono: a ancora. E a mesma funcao que
  // computeConsorcioCommissionByBeneficiario chama para pagar.
  const donoPorProposta = await resolveConsorcioBeneficiarioByProposta(sb);
  const ancorasAssigned = donoPorProposta.size;
  console.log(`   ancoras ASSIGNED (a verdade do dono): ${ancorasAssigned}`);
  ok(
    ancorasAssigned > 0,
    "ANTI-VACUIDADE: ha ancora ASSIGNED (senao nao ha dono a conferir)",
    `${ancorasAssigned}`
  );

  // Quais propostas TEM parcela na competencia (so essas aparecem no detalhamento).
  const { data: carteiraMes } = await sb
    .from("carteira_consorcio")
    .select("company_id, proposta")
    .eq("competencia_recebida", COMP_C);
  const propostasDoMes = new Set(
    (carteiraMes || []).map((r) => chaveProposta(r.company_id, r.proposta))
  );
  const comDono = [...propostasDoMes].filter((k) => donoPorProposta.has(k));
  console.log(
    `   propostas com parcela em ${COMP_C}: ${propostasDoMes.size}  com dono: ${comDono.length}`
  );
  ok(comDono.length > 0, "ANTI-VACUIDADE: ha proposta do mes COM dono", `${comDono.length}`);

  // Para cada promotor dono de alguma proposta do mes, o builder tem de devolver
  // EXATAMENTE as propostas dele — nem uma a mais, nem uma a menos.
  const promotoresDonos = [
    ...new Set(
      comDono
        .map((k) => donoPorProposta.get(k))
        .filter((b) => b && b.kind === "promotor")
        .map((b) => b.id)
    ),
  ];
  console.log(`   promotores donos de proposta do mes: ${promotoresDonos.length}`);
  ok(promotoresDonos.length > 0, "ANTI-VACUIDADE: ha promotor dono", `${promotoresDonos.length}`);

  let divergencias = 0;
  let totalBuilder = 0;
  for (const pid of promotoresDonos) {
    const res = await buildProdutoProposalRows(sb, {
      promoterId: pid,
      year: YEAR_C,
      month: MONTH_C,
      incluirComissaoEmpresa: true,
    });
    const doBuilder = res.rows.filter((r) => r.entry_type === "CONSORCIO");
    totalBuilder += doBuilder.reduce((a, r) => a + r.comissao_promotor, 0);
    // (a) toda linha que o builder deu a ele, a ANCORA tambem da
    for (const r of doBuilder) {
      const dono = [...donoPorProposta.entries()].find(
        ([k, b]) => k.endsWith(`|${r.operacao}`) && b.kind === "promotor" && b.id === pid
      );
      if (!dono) {
        divergencias += 1;
        console.log(`      DIVERGE: builder deu ${r.operacao} a ${pid}, a ancora nao`);
      }
    }
    // (b) toda proposta do mes que a ANCORA da a ele, o builder devolve
    const esperadas = comDono.filter((k) => {
      const b = donoPorProposta.get(k);
      return b && b.kind === "promotor" && b.id === pid;
    });
    const recebidas = new Set(doBuilder.map((r) => r.operacao));
    for (const k of esperadas) {
      const prop = k.split("|")[1];
      if (!recebidas.has(prop)) {
        divergencias += 1;
        console.log(`      DIVERGE: ancora deu ${prop} a ${pid}, o builder nao devolveu`);
      }
    }
  }
  ok(divergencias === 0, "ZERO divergencia de dono, proposta a proposta", `${divergencias}`);

  // (c) IDENTIDADE DE VALOR: o que o builder soma para os PROMOTORES tem de ser o
  //     mesmo que o pagamento soma para eles. Se os donos batem, o dinheiro bate.
  const pagamento = await computeConsorcioCommissionByBeneficiario(sb, {
    year: YEAR_C,
    month: MONTH_C,
  });
  let totalPagamento = 0;
  for (const v of pagamento.values()) {
    if (v.beneficiario.kind === "promotor") totalPagamento += v.consorcio;
  }
  const r2g = (v) => Math.round(v * 100) / 100;
  console.log(
    `   consorcio dos PROMOTORES — builder ${brl(r2g(totalBuilder))} x pagamento ${brl(r2g(totalPagamento))}`
  );
  ok(totalPagamento > 0, "ANTI-VACUIDADE: o pagamento tem valor de consorcio", brl(r2g(totalPagamento)));
  ok(
    Math.abs(r2g(totalBuilder) - r2g(totalPagamento)) < 0.05,
    "o consorcio que a TELA mostra = o que o PMR paga",
    `${brl(r2g(totalBuilder))} x ${brl(r2g(totalPagamento))}`
  );

  // (d) o dono NAO vem mais da carteira: prova pelo estado defasado dela.
  const { count: carteiraComDono } = await sb
    .from("carteira_consorcio")
    .select("*", { count: "exact", head: true })
    .not("promoter_id", "is", null);
  console.log(`   carteira_consorcio com promoter_id gravado: ${carteiraComDono ?? 0}`);
  if ((carteiraComDono ?? 0) === 0) {
    ok(
      totalBuilder > 0,
      "CONTRAPROVA: a carteira tem 0 donos gravados e o builder AINDA resolve (nao le de la)",
      brl(r2g(totalBuilder))
    );
  } else {
    console.log(
      "   (a carteira ja foi re-materializada; a contraprova pelo estado defasado\n" +
        "    nao se aplica mais — os itens (a) e (b) seguem cobrindo a identidade)"
    );
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
