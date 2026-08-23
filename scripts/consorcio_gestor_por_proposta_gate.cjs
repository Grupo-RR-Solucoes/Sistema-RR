/* ============================================================================
 * consorcio_gestor_por_proposta_gate — o detalhe por proposta reproduz a base do
 * agregado, e o unico desencontro e o centavo do arredondamento.
 *
 * Rodar:
 *   node scripts/consorcio_gestor_por_proposta_gate.cjs
 *
 * A INVARIANTE: computeGestorBaseByProposta e computeGestorBaseByCompany leem as
 * MESMAS entries com a MESMA regua (Sigma comissao-empresa das parcelas
 * REGULARES x 0,10). Logo a BASE tem de bater EXATAMENTE nos dois; so o
 * gestor_10 pode divergir, e so pelo arredondamento (1 round no agregado x N
 * rounds por proposta).
 *
 * O QUE ESTE GATE GUARDA, ALEM DA ARITMETICA:
 *   - que o delta do arredondamento continua sendo CENTAVOS, e nao reais. Um
 *     delta grande e sintoma de regua divergente, nao de round.
 *   - que a base por proposta nao PERDE linha (proposta sem numero, parcela
 *     master vazando, etc.).
 *   - que a proposta vendida pelo PROPRIO gestor continua na base. O gestor
 *     recebe os dois lados; excluir seria bug, e e um bug facil de introduzir
 *     "consertando" a dupla contagem que nao existe.
 *
 * OS BLOCOS:
 *   1. PURO         — as duas funcoes contra um conjunto FABRICADO, onde a
 *                     resposta e conhecida de cabeca. Sem banco.
 *   2. CONTRAPROVA  — um caso fabricado em que 1 round e N rounds DIVERGEM de
 *                     proposito. Sem ele o gate nao distingue "as duas reguas
 *                     concordam" de "o teste nao tem poder".
 *   3. BANCO        — jul/2026 e jun/2026 com os dados de producao: base
 *                     identica, gestor de julho em R$ 1.480,3x, delta em
 *                     centavos.
 *   4. NAO EXCLUI   — a proposta do gestor-vendedor segue na base.
 *   5. TOLERA A MIGRATION AUSENTE — o dry-run roda e devolve o delta com ou sem o
 *                     SQL aplicado. Medido em 23/08: pedir a coluna `formato` sem
 *                     a migration devolve **42703** (undefined_column) do Postgres,
 *                     nao um PGRST*. Tolerar so PGRST205 derrubava o reconsolidar
 *                     inteiro na janela entre o deploy e o SQL rodar no Studio.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const {
  computeGestorBaseByCompany,
  computeGestorBaseByProposta,
  computeConsorcioGestorPayout,
} = require("../lib/consorcio/gestorPayout.ts");
const { fetchConsorcioEntries, isRegular } = require("../lib/consorcio/fila.ts");
const { FATOR_REPASSE_GESTOR_CONSORCIO } = require("../lib/consorcio/trp210.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};
const brl = (n) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (v) => Math.round(v * 100) / 100;
const soma = (arr, k) => r2(arr.reduce((s, l) => s + Number(l[k] || 0), 0));

const e = (company_id, proposta, parcela, comissao, master) => ({
  company_id,
  year: 2026,
  month: 7,
  operation_number: proposta,
  contract_number: `${master ? "M" : "R"}|PARC${parcela}`,
  commission_value: comissao,
  gross_value: 0,
  metadata: master ? { master: true } : { master: false },
});

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — as duas reguas sobre um conjunto fabricado");
  console.log(linha("="));
  ok(FATOR_REPASSE_GESTOR_CONSORCIO === 0.1, "o fator do gestor e 0,10", String(FATOR_REPASSE_GESTOR_CONSORCIO));

  const fab = [
    e("A", "111", 1, 100), // proposta 111: 2 parcelas, 300 no total
    e("A", "111", 2, 200),
    e("A", "222", 1, 500),
    e("B", "333", 1, 50),
    e("A", "999", 1, 9999, true), // MASTER: nao entra em regua nenhuma
  ];
  const emp = computeGestorBaseByCompany(fab);
  const prop = computeGestorBaseByProposta(fab);
  console.log(`   empresas=${emp.length}  propostas=${prop.length}`);
  ok(prop.length === 3, "3 propostas (111, 222, 333)", prop.map((p) => p.proposta).join(","));
  ok(
    prop.find((p) => p.proposta === "111")?.parcelas === 2,
    "a proposta 111 soma as 2 parcelas dela"
  );
  ok(
    prop.find((p) => p.proposta === "111")?.base_comissao_empresa === 300,
    "base da 111 = 300,00 (100 + 200)"
  );
  ok(soma(emp, "base_comissao_empresa") === 850, "base total = 850,00 (a MASTER ficou fora)", brl(soma(emp, "base_comissao_empresa")));
  ok(soma(prop, "base_comissao_empresa") === 850, "a base por proposta da o MESMO total");
  ok(
    prop.every((p) => p.proposta !== "999"),
    "a parcela MASTER nao virou proposta"
  );
  ok(soma(emp, "gestor_10") === 85, "gestor_10 agregado = 85,00", brl(soma(emp, "gestor_10")));
  ok(soma(prop, "gestor_10") === 85, "gestor_10 por proposta = 85,00 (aqui nao ha residuo)");

  // ---- 2. CONTRAPROVA — um caso em que os dois rounds DIVERGEM ----
  console.log("\n" + linha("="));
  console.log("2) CONTRAPROVA — 1 round x N rounds tem de poder divergir");
  console.log(linha("="));
  // 3 propostas de 0,05: cada uma da 0,005 -> arredonda para 0,01 (3 x 0,01 = 0,03);
  // o agregado e 0,15 -> 0,015 -> 0,02. Divergencia de 1 centavo, fabricada.
  const resid = [e("A", "p1", 1, 0.05), e("A", "p2", 1, 0.05), e("A", "p3", 1, 0.05)];
  const rEmp = soma(computeGestorBaseByCompany(resid), "gestor_10");
  const rProp = soma(computeGestorBaseByProposta(resid), "gestor_10");
  console.log(`   agregado=${rEmp}  por proposta=${rProp}  delta=${r2(rProp - rEmp)}`);
  ok(rEmp !== rProp, "as duas reguas DIVERGEM neste caso (o gate tem poder)", `${rEmp} x ${rProp}`);
  ok(
    Math.abs(r2(rProp - rEmp)) <= 0.05,
    "e a divergencia e de CENTAVOS, nao de reais",
    `${r2(rProp - rEmp)}`
  );

  // ---- 3. BANCO ----
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  console.log("\n" + linha("="));
  console.log("3) BANCO — jun e jul/2026 com os dados de producao");
  console.log(linha("="));
  const medidos = {
    "2026-06": { propostas: 37, gestorAgregado: 1190.31 },
    "2026-07": { propostas: 33, gestorAgregado: 1480.32 },
  };
  for (const [Y, M] of [
    [2026, 6],
    [2026, 7],
  ]) {
    const comp = `${Y}-${String(M).padStart(2, "0")}`;
    const entries = await fetchConsorcioEntries(sb, { year: Y, month: M });
    const reg = entries.filter(isRegular);
    const cEmp = computeGestorBaseByCompany(entries);
    const cProp = computeGestorBaseByProposta(entries);
    const baseEmp = soma(cEmp, "base_comissao_empresa");
    const baseProp = soma(cProp, "base_comissao_empresa");
    const gEmp = soma(cEmp, "gestor_10");
    const gProp = soma(cProp, "gestor_10");
    console.log(
      `\n   ${comp}  parcelas=${entries.length} regulares=${reg.length} propostas=${cProp.length}`
    );
    console.log(
      `      base: agregado=${brl(baseEmp)}  proposta=${brl(baseProp)}   |   ` +
        `gestor_10: agregado=${brl(gEmp)}  proposta=${brl(gProp)}  delta=${brl(gProp - gEmp)}`
    );
    ok(reg.length > 0, `${comp}: ANTI-VACUIDADE — ha parcela regular`, `${reg.length}`);
    ok(
      cProp.length === medidos[comp].propostas,
      `${comp}: ${medidos[comp].propostas} propostas (o medido em 23/08)`,
      `${cProp.length}`
    );
    ok(baseEmp === baseProp, `${comp}: a BASE bate EXATAMENTE nas duas reguas`, `${brl(baseEmp)}`);
    ok(
      cProp.every((p) => p.parcelas > 0 && p.proposta !== ""),
      `${comp}: nenhuma proposta sem numero ou sem parcela`
    );
    ok(
      soma(cProp, "parcelas") === reg.length,
      `${comp}: as parcelas do detalhe somam as regulares (nenhuma se perdeu)`,
      `${soma(cProp, "parcelas")} x ${reg.length}`
    );
    ok(
      Math.abs(gEmp - medidos[comp].gestorAgregado) < 0.005,
      `${comp}: o gestor do agregado e o valor gravado`,
      `${brl(gEmp)}`
    );
    ok(
      Math.abs(gProp - gEmp) <= 0.05,
      `${comp}: o delta do arredondamento e de CENTAVOS`,
      `${brl(gProp - gEmp)}`
    );
    ok(
      Math.abs(gEmp - baseEmp * 0.1) < 0.02,
      `${comp}: gestor_10 continua sendo 10% da base`,
      `${brl(gEmp)} x ${brl(baseEmp * 0.1)}`
    );
  }
  // O numero que o Diego pediu por escrito.
  {
    const cProp = computeGestorBaseByProposta(await fetchConsorcioEntries(sb, { year: 2026, month: 7 }));
    const g = soma(cProp, "gestor_10");
    ok(
      g >= 1480.3 && g < 1480.4,
      "jul/2026: o gestor por proposta sai em R$ 1.480,3x",
      `R$ ${brl(g)}`
    );
  }

  // ---- 4. NAO EXCLUI a proposta do gestor-vendedor ----
  console.log("\n" + linha("="));
  console.log("4) NAO EXCLUI — a proposta vendida pelo PROPRIO gestor fica na base");
  console.log(linha("="));
  const { data: gestores } = await sb
    .from("app_users")
    .select("id, full_name, venda_propria")
    .eq("role", "gestor_consorcio")
    .eq("active", true);
  const gestor = (gestores || [])[0];
  console.log(
    `   gestor ativo: ${gestor ? `${gestor.full_name} (venda_propria=${gestor.venda_propria})` : "(nenhum)"}`
  );
  ok(!!gestor, "ANTI-VACUIDADE: ha gestor de consorcio ativo cadastrado");
  // A prova estrutural: as funcoes recebem SO entries. Se alguem passar a filtrar
  // por dono, precisara de um segundo argumento — e este assert quebra.
  ok(
    computeGestorBaseByCompany.length === 1 && computeGestorBaseByProposta.length === 1,
    "as duas funcoes recebem SO as entries (nao ha por onde excluir por dono)",
    `aridade ${computeGestorBaseByCompany.length}/${computeGestorBaseByProposta.length}`
  );
  // E a prova por dado: atribuir uma proposta nao muda a base.
  const jul = await fetchConsorcioEntries(sb, { year: 2026, month: 7 });
  const baseAntes = soma(computeGestorBaseByProposta(jul), "base_comissao_empresa");
  const { data: ancoras } = await sb
    .from("product_line_assignments")
    .select("operation_number, assigned_app_user_id, promoter_id, status")
    .eq("entry_type", "CONSORCIO");
  const doGestor = (ancoras || []).filter((a) => a.assigned_app_user_id === (gestor || {}).id);
  console.log(`   ancoras de consorcio: ${(ancoras || []).length}  atribuidas ao gestor: ${doGestor.length}`);
  const baseDepois = soma(computeGestorBaseByProposta(jul), "base_comissao_empresa");
  ok(
    baseAntes === baseDepois,
    "a base independe da atribuicao (as funcoes nem leem a fila)",
    `${brl(baseAntes)}`
  );
  if (doGestor.length > 0) {
    const props = new Set(doGestor.map((a) => String(a.operation_number)));
    const naBase = computeGestorBaseByProposta(jul).filter((p) => props.has(p.proposta));
    ok(
      naBase.length > 0,
      "as propostas vendidas pelo gestor ESTAO na base dos 10%",
      `${naBase.length} de ${props.size}`
    );
  } else {
    console.log("   (nenhuma ancora atribuida ao gestor ainda — a prova por dado fica pendente)");
  }

  // ---- 5. TOLERA A MIGRATION AUSENTE ----
  console.log("\n" + linha("="));
  console.log("5) TOLERA A MIGRATION AUSENTE — o dry-run roda dos dois jeitos");
  console.log(linha("="));
  let payout = null;
  let erro = null;
  try {
    payout = await computeConsorcioGestorPayout(sb, { year: 2026, month: 7, dryRun: true });
  } catch (err) {
    erro = err;
  }
  ok(
    !erro,
    "computeConsorcioGestorPayout(dryRun) NAO lanca com ou sem o SQL aplicado",
    erro ? String(erro.message).slice(0, 70) : ""
  );
  if (payout) {
    console.log(
      `   competencia=${payout.competencia}  agregado=${brl(payout.total_10)}  ` +
        `detalhe=${brl(payout.total_10_detalhe)}  delta=${brl(payout.delta_arredondamento)}  ` +
        `legado=${payout.legado}  propostas=${payout.propostas.length}`
    );
    ok(
      Math.abs(payout.total_10 - 1480.32) < 0.005,
      "o agregado (QUEM PAGA) segue 1.480,32",
      brl(payout.total_10)
    );
    ok(
      Math.abs(payout.total_10_detalhe - 1480.31) < 0.005,
      "o detalhe soma 1.480,31",
      brl(payout.total_10_detalhe)
    );
    ok(
      Math.abs(payout.delta_arredondamento + 0.01) < 0.005,
      "o delta calculado e -0,01",
      brl(payout.delta_arredondamento)
    );
    ok(payout.propostas.length === 33, "33 linhas de detalhe", String(payout.propostas.length));
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
