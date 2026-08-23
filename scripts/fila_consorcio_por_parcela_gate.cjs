/* ============================================================================
 * fila_consorcio_por_parcela_gate — a fila do consorcio lista PARCELA, mas
 * atribui PROPOSTA.
 *
 * Rodar:
 *   node scripts/fila_consorcio_por_parcela_gate.cjs
 *
 * A INVARIANTE, em duas metades que se contradizem se lidas rapido:
 *   A TELA lista uma linha por PARCELA — a mesma quebra do fechamento manual,
 *   que e como o financeiro confere.
 *   A FILA atribui por PROPOSTA — a ancora nao muda, e uma atribuicao vale para
 *   todas as parcelas daquela proposta, inclusive as futuras.
 * As duas convivem porque todas as parcelas de uma proposta carregam o MESMO
 * `operation_number`: o POST e identico venha ele de qual linha vier.
 *
 * O DEFEITO (decisao Diego, 23/08/2026): a fila agregava por proposta e ESCONDIA
 * linha. Medido nos arquivos da Promotiva — julho (C115867) tem 39 parcelas em 33
 * propostas, entao 6 linhas sumiam; junho (C107347) tinha 37 em 37, uma parcela
 * cada, e por isso o defeito nao aparecia la.
 *
 * OS BLOCOS:
 *   1. BANCO/PARCELA — as 39 parcelas regulares de 2026-07 viram 39 linhas.
 *   2. PROPOSTA MANDA — as N linhas de uma proposta tem o MESMO operation_number
 *                       (e o que faz "atribuir uma" ser "atribuir todas") e a
 *                       tela as marca com parcela_seq/parcela_total.
 *   3. SEM LANCAMENTO — as 11 ancoras sem parcela no mes continuam listadas, em
 *                       lista SEPARADA, e seguem atribuiveis.
 *   4. VAZAMENTO      — gestor_consorcio nao recebe comissao_promotor em nenhuma
 *                       das listas novas. E a regressao que o cb6e067 causou uma
 *                       vez; mexer na rota nao pode reabri-la.
 *   5. INTOCADOS      — BBCAP e CONTA CORRENTE seguem 1 linha = 1 evento.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { montarPayloadFilaAtribuicao } = require("../lib/produtos/filaAtribuicao.ts");
const { fetchConsorcioEntries, isRegular } = require("../lib/consorcio/fila.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const YEAR = 2026;
const MONTH = 7;

// Varredura por chave COM VALOR (nao so nome): o payload tem um booleano de
// render cuja chave contem o termo. Mesmo criterio do
// produtos_visibilidade_comissao_gate.
function varre(o, termo, caminho = "", achados = []) {
  if (o === null || typeof o !== "object") return achados;
  if (Array.isArray(o)) {
    o.forEach((v, i) => varre(v, termo, `${caminho}[${i}]`, achados));
    return achados;
  }
  for (const [k, v] of Object.entries(o)) {
    const p = caminho ? `${caminho}.${k}` : k;
    const carregaValor = typeof v === "number" || typeof v === "string";
    if (k.includes(termo) && carregaValor) achados.push(p);
    varre(v, termo, p, achados);
  }
  return achados;
}

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const comoSocio = await montarPayloadFilaAtribuicao(sb, {
    year: YEAR,
    month: MONTH,
    role: "socio",
    escopo: "TODOS",
  });
  const g = comoSocio.grupos;

  // ---- 1. BANCO/PARCELA ----
  console.log(linha("="));
  console.log("1) PARCELA — a fila lista o que o fechamento manual mostra");
  console.log(linha("="));
  const entries = await fetchConsorcioEntries(sb, { year: YEAR, month: MONTH });
  const regulares = entries.filter(isRegular);
  const propostas = new Set(regulares.map((e) => String(e.operation_number)));
  console.log(
    `   master: parcelas=${entries.length} regulares=${regulares.length} propostas=${propostas.size}`
  );
  console.log(
    `   fila:   linhas de parcela=${g.consorcio.length}  ancoras sem lancamento=${(g.consorcio_sem_lancamento || []).length}`
  );
  ok(regulares.length > 0, "ANTI-VACUIDADE: ha parcela regular no mes", `${regulares.length}`);
  ok(
    regulares.length > propostas.size,
    "ANTI-VACUIDADE: ha proposta com MAIS DE UMA parcela (senao agregar nao esconderia nada)",
    `${regulares.length} parcelas / ${propostas.size} propostas`
  );
  ok(
    g.consorcio.length === regulares.length,
    "a fila tem UMA linha por parcela regular",
    `${g.consorcio.length} x ${regulares.length}`
  );
  ok(
    g.consorcio.length !== propostas.size,
    "e NAO uma por proposta (era o defeito)",
    `${g.consorcio.length} x ${propostas.size}`
  );
  // toda linha traz a parcela DELA e os valores DELA
  const semRotulo = g.consorcio.filter((r) => !r.detalhe || !r.detalhe.parcela_rotulo);
  ok(semRotulo.length === 0, "toda linha traz o rotulo da propria parcela", `${semRotulo.length} sem`);
  const somaFila = g.consorcio.reduce((a, r) => a + Number(r.detalhe.comissao_empresa || 0), 0);
  const somaMaster = regulares.reduce((a, e) => a + Number(e.commission_value || 0), 0);
  ok(
    Math.abs(somaFila - somaMaster) < 0.02,
    "a soma das parcelas da tela = a soma da master (nada duplicado, nada perdido)",
    `${somaFila.toFixed(2)} x ${somaMaster.toFixed(2)}`
  );

  // ---- 2. PROPOSTA MANDA ----
  console.log("\n" + linha("="));
  console.log("2) PROPOSTA MANDA — N linhas, 1 atribuicao");
  console.log(linha("="));
  const porProposta = new Map();
  for (const r of g.consorcio) {
    const l = porProposta.get(r.operation_number) || [];
    l.push(r);
    porProposta.set(r.operation_number, l);
  }
  const multi = [...porProposta.entries()].filter(([, l]) => l.length > 1);
  console.log(`   propostas na tela: ${porProposta.size}  com mais de 1 parcela: ${multi.length}`);
  for (const [prop, l] of multi.slice(0, 4))
    console.log(
      `     ${prop}: ${l.length} linhas  seq=[${l.map((x) => x.parcela_seq).join(",")}]  ` +
        `parcelas=[${l.map((x) => x.detalhe.parcela_rotulo).join(",")}]`
    );
  ok(multi.length > 0, "ANTI-VACUIDADE: ha proposta com mais de uma linha na tela", `${multi.length}`);
  // o que faz "atribuir uma" ser "atribuir todas": mesma chave no POST
  let chaveDivergente = 0;
  for (const [, l] of multi) {
    const chaves = new Set(l.map((x) => `${x.company_id}|${x.operation_number}`));
    if (chaves.size !== 1) chaveDivergente += 1;
  }
  ok(
    chaveDivergente === 0,
    "todas as linhas da MESMA proposta tem a MESMA chave de atribuicao",
    `divergentes=${chaveDivergente}`
  );
  // ids unicos (senao o React reusa linha e a tela mente)
  const ids = g.consorcio.map((r) => r.id);
  ok(new Set(ids).size === ids.length, "cada linha tem id UNICO", `${new Set(ids).size}/${ids.length}`);
  // e o status/dono e o MESMO nas irmas (vem da ancora)
  let donoDivergente = 0;
  for (const [, l] of multi) {
    if (new Set(l.map((x) => `${x.status}|${x.beneficiario_value}`)).size !== 1) donoDivergente += 1;
  }
  ok(
    donoDivergente === 0,
    "irmas compartilham status e dono (a ancora e uma so)",
    `divergentes=${donoDivergente}`
  );
  // a tela consegue AVISAR
  ok(
    multi.every(([, l]) => l.every((x) => x.mesma_proposta === true && x.parcela_total === l.length)),
    "as irmas vem marcadas (mesma_proposta + parcela_total) para a tela avisar"
  );
  const solo = [...porProposta.values()].filter((l) => l.length === 1).flat();
  ok(
    solo.every((x) => x.mesma_proposta === false),
    "proposta com 1 parcela NAO e marcada (aviso so onde ha o que avisar)",
    `${solo.length} solo`
  );

  // ---- 3. SEM LANCAMENTO ----
  console.log("\n" + linha("="));
  console.log("3) SEM LANCAMENTO — separadas, listadas, atribuiveis");
  console.log(linha("="));
  const sem = g.consorcio_sem_lancamento || [];
  console.log(`   ancoras sem parcela em ${comoSocio.competencia}: ${sem.length}`);
  console.log(`     ${sem.slice(0, 8).map((r) => r.operation_number).join(", ")}`);
  ok(sem.length > 0, "ANTI-VACUIDADE: ha ancora sem parcela no mes", `${sem.length}`);
  ok(
    sem.every((r) => r.sem_lancamento === true && r.detalhe === null),
    "vem marcadas e sem detalhe (nao inventam valor)"
  );
  ok(
    sem.every((r) => r.entry_type === "CONSORCIO" && r.operation_number),
    "seguem ATRIBUIVEIS (tem entry_type e proposta para o POST)"
  );
  const opsParcela = new Set(g.consorcio.map((r) => r.operation_number));
  const cruzou = sem.filter((r) => opsParcela.has(r.operation_number));
  ok(
    cruzou.length === 0,
    "NENHUMA aparece nas duas listas (separacao real, nao rotulo)",
    cruzou.map((r) => r.operation_number).join(", ")
  );
  // o total fecha: parcelas + sem lancamento = ancoras
  const { data: ancoras } = await sb
    .from("product_line_assignments")
    .select("operation_number")
    .eq("entry_type", "CONSORCIO");
  ok(
    porProposta.size + sem.length === (ancoras || []).length,
    "propostas com parcela + sem lancamento = TODAS as ancoras (nenhuma sumiu)",
    `${porProposta.size} + ${sem.length} = ${(ancoras || []).length}`
  );

  // ---- 4. VAZAMENTO ----
  console.log("\n" + linha("="));
  console.log("4) VAZAMENTO — o gestor continua sem a comissao do promotor");
  console.log(linha("="));
  const comoGestor = await montarPayloadFilaAtribuicao(sb, {
    year: YEAR,
    month: MONTH,
    role: "gestor_consorcio",
    escopo: "CONSORCIO",
  });
  const vazou = varre(comoGestor, "comissao_promotor");
  const achou = varre(comoSocio, "comissao_promotor");
  console.log(
    `   gestor: parcelas=${comoGestor.grupos.consorcio.length} ` +
      `sem lancamento=${(comoGestor.grupos.consorcio_sem_lancamento || []).length}`
  );
  ok(
    comoGestor.grupos.consorcio.length > 0,
    "ANTI-VACUIDADE: o payload do gestor TEM linhas (senao nao ha o que vazar)",
    `${comoGestor.grupos.consorcio.length}`
  );
  ok(vazou.length === 0, "ZERO comissao_promotor COM VALOR no payload do gestor", vazou.slice(0, 5).join(", "));
  ok(achou.length > 0, "e o socio recebe (o teste tem poder)", `${achou.length} ocorrencias`);
  ok(
    comoGestor.grupos.consorcio.every((r) => typeof r.detalhe.comissao_gestor === "number"),
    "o gestor continua vendo a comissao DELE, por parcela"
  );
  ok(
    comoGestor.grupos.consorcio.every((r) => typeof r.detalhe.comissao_empresa === "number"),
    "e a da EMPRESA, que e a base do calculo dele"
  );

  // ---- 5. INTOCADOS ----
  console.log("\n" + linha("="));
  console.log("5) INTOCADOS — BBCAP e Conta Corrente seguem 1 linha = 1 evento");
  console.log(linha("="));
  const { data: euEntries } = await sb
    .from("monthly_closing_entries")
    .select("entry_type, operation_number")
    .eq("year", YEAR)
    .eq("month", MONTH)
    .in("entry_type", ["BBCAP", "CONTA_CORRENTE"]);
  const nBb = (euEntries || []).filter((r) => r.entry_type === "BBCAP").length;
  const nCc = (euEntries || []).filter((r) => r.entry_type === "CONTA_CORRENTE").length;
  console.log(`   master: BBCAP=${nBb} CONTA_CORRENTE=${nCc}`);
  console.log(`   fila:   BBCAP=${g.bbcap.length} CONTA_CORRENTE=${g.conta_corrente.length}`);
  ok(nBb > 0 && nCc > 0, "ANTI-VACUIDADE: ha linha de evento unico no mes", `${nBb}/${nCc}`);
  ok(g.bbcap.length === nBb, "BBCAP: 1 linha na fila por linha na master", `${g.bbcap.length} x ${nBb}`);
  ok(
    g.conta_corrente.length === nCc,
    "CONTA CORRENTE: idem",
    `${g.conta_corrente.length} x ${nCc}`
  );
  ok(
    g.bbcap.every((r) => r.parcela_seq === undefined) &&
      g.conta_corrente.every((r) => r.parcela_seq === undefined),
    "e nao ganharam campo de parcela (nao sao diferidos)"
  );

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
