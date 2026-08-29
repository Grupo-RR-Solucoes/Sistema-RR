/* ============================================================================
 * agregado_orfao_gate — a METADE CI-AVEL da defesa do agregado orfao.
 *
 * Rodar:
 *   node scripts/agregado_orfao_gate.cjs
 *
 * SELF-CONTAINED pelos TRES criterios do runner: nao chama createClient, nao le
 * .env, nao le nada fora do repo. Tudo aqui roda numa maquina com o repo clonado
 * e mais nada — inclusive no CI.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO. A primeira versao era um gate so, e ele
 * lia o xlsx de C:/Users/diego/Downloads e chamava createClient: needs-local +
 * needs-db, ou seja, NUNCA rodaria no CI. Um gate que so roda quando alguem
 * lembra de rodar a mao e meio gate. Entao o que NAO precisa de banco nem de
 * arquivo externo foi separado para ca, e o que precisa ficou em
 * scripts/cancel_agregado_orfao_gate.cjs (needs-local, registrado com o motivo
 * escrito). Esta metade e a que o CI executa em todo push.
 *
 * A INVARIANTE: nenhuma competencia pode ficar com AGREGADO ORFAO — linha em
 * fechamento_mensal_empresa com valor e ZERO linhas em monthly_closing_entries.
 * Medido em 28/08/2026: 2025-02 RR ALAGOAS 1 tem operacoes=6.491 e
 * valor_liquido=97.535,61 com zero detalhe; das 100 linhas de FME e a unica
 * quebrada (2023-12 AL1 tambem esta sem entries, mas com o agregado ZERADO — nao
 * e perda, e o vigia TEM de distinguir os dois).
 *
 * OS BLOCOS:
 *   1. ORDEM   — no fonte do import, o delete do detalhe legado vem DEPOIS do
 *                insert, tem `.neq(importId)` e o guard de rowsToInsert; e o
 *                recorte AMPLO continua la (reimportar ainda SUBSTITUI).
 *   2. RECUSA  — a funcao POST REAL do cancel contra o espelho, com os tres
 *                controles positivos que impedem isto de virar trava geral.
 *   3. VIGIA   — 'agregado_sem_detalhe' acende para o agregado COM VALOR e fica
 *                quieto para o ZERADO, em dados controlados.
 *   4. TROCA DE DONO — a memoria da troca (registrarTrocaDeDono) nasce ANTES do
 *                delete-and-replace, e o check 'debito_auto_trocou_dono' a le. O
 *                controle positivo do NO-OP e a assercao mais importante do
 *                arquivo: rodada que nao muda nada NAO pode escrever linha, senao
 *                o vigia vira ruido e alguem o desliga.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("node:module");
const { createFakeFechamento } = require("./_fakeFechamento.cjs");

const linha = (c) => c.repeat(84);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "lib/monthlyClosingImport.ts"), "utf8");

function stubModule(spec, exports) {
  const p = require.resolve(spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// Cliente de LEITURA de mentira para as tabelas que NAO estao no espelho
// (companies, daily_production_records). Mesma tecnica de
// ads_import_so_credito_gate.cjs:58-77 — `single`/`maybeSingle` devolvem OBJETO.
function stubReal(tabelas) {
  const build = (table, unico) =>
    new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "then") {
            const linhas = tabelas[table] ?? [];
            const data = unico ? linhas[0] ?? null : linhas;
            return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
          }
          if (typeof p === "symbol") return undefined;
          const nome = String(p);
          return () => build(table, unico || nome === "single" || nome === "maybeSingle");
        },
      }
    );
  return { from: (table) => build(table, false) };
}

// FIXTURE — modela RR ALAGOAS 1 sem ler o banco. O nome importa: as assercoes
// cobram que a recusa e o achado do vigia NOMEIEM a empresa.
const EMP = {
  id: "b0000000-0000-0000-0000-000000000001",
  cnpj: "48.357.275/0001-03",
  name: "RR ALAGOAS 1",
};
const REAL = stubReal({
  companies: [EMP],
  daily_production_records: [], // checarAds da ADS: sem linhas, count 0
});

(async () => {
  // ---- 1. ORDEM ----
  console.log(linha("="));
  console.log("1) ORDEM — no import, o delete do detalhe legado vem DEPOIS do insert");
  console.log(linha("="));

  // ANCORAS UNICAS E CONTADAS. `insert(slice)` aparece DUAS vezes no arquivo — a
  // outra e a de syncProductLines — e ancorar nela dava um offset ANTERIOR ao
  // delete: a assercao de ordem passava COM O CODIGO DEFEITUOSO. A ancora do loop
  // legado e `rowsToInsert.slice(`, e o gate CONTA as ocorrencias para a ancora
  // nao poder deslizar de novo em silencio.
  const nInsertLegado = (SRC.match(/rowsToInsert\.slice\(/g) || []).length;
  const nDelete = (SRC.match(/entry_type\.not\.in\.\(BBCAP,CONTA_CORRENTE,CONSORCIO\)/g) || []).length;
  const iInsert = SRC.indexOf("rowsToInsert.slice(");
  const iDelete = SRC.indexOf('.or("entry_type.is.null,entry_type.not.in.(BBCAP,CONTA_CORRENTE,CONSORCIO)")');
  ok(nInsertLegado === 1, "ANTI-DESLIZE: a ancora do insert legado e UNICA", `n=${nInsertLegado}`);
  ok(nDelete === 1, "ANTI-DESLIZE: a ancora do delete legado e UNICA", `n=${nDelete}`);
  ok(iInsert > 0, "ANTI-VACUIDADE: achei o insert em chunk das entries legadas", `pos=${iInsert}`);
  ok(iDelete > 0, "ANTI-VACUIDADE: achei o delete do detalhe legado", `pos=${iDelete}`);
  ok(iDelete > iInsert, "o DELETE vem DEPOIS do INSERT (janela reversivel)", `insert=${iInsert} delete=${iDelete}`);

  const bloco = SRC.slice(Math.max(0, iDelete - 1200), iDelete + 200);
  ok(
    /\.neq\("monthly_closing_import_id", importId\)/.test(bloco),
    "o delete exclui as linhas RECEM-INSERIDAS (.neq monthly_closing_import_id)"
  );
  ok(
    /\.eq\("company_id", company\.id\)/.test(bloco) &&
      /\.eq\("year", targetYear\)/.test(bloco) &&
      /\.eq\("month", targetMonth\)/.test(bloco),
    "o RECORTE AMPLO (company+year+month) continua — reimport ainda SUBSTITUI"
  );
  ok(
    !/\.delete\(\)[\s\S]{0,200}\.eq\("monthly_closing_import_id"/.test(SRC),
    "o delete NAO foi estreitado para `.eq(importId)` (deixaria duplicata viva)"
  );
  ok(
    /if \(rowsToInsert\.length > 0\) \{[\s\S]{0,400}\.delete\(\)/.test(SRC),
    "o delete so roda quando HA substituto (guard rowsToInsert.length > 0)"
  );

  // ---- 2. RECUSA ----
  console.log("\n" + linha("="));
  console.log("2) RECUSA — POST real de /api/import/closing/cancel contra o espelho");
  console.log(linha("="));

  const ALVO = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const OUTRO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  const montar = ({ comOutro, fmeZerada }) => ({
    monthly_closing_entries: [
      ...Array.from({ length: 300 }, (_, i) => ({
        id: `alvo-${i}`, monthly_closing_import_id: ALVO,
        company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2025, month: 2,
        entry_type: "CASH", commission_value: 1, sheet_name: "A Vista",
      })),
      ...(comOutro
        ? Array.from({ length: 120 }, (_, i) => ({
            id: `outro-${i}`, monthly_closing_import_id: OUTRO,
            company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2025, month: 2,
            entry_type: "PRT", commission_value: 2, sheet_name: "PRT",
          }))
        : []),
      // VIZINHA — competencia sadia, intocavel.
      ...Array.from({ length: 90 }, (_, i) => ({
        id: `vizinha-${i}`, monthly_closing_import_id: OUTRO,
        company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2026, month: 5,
        entry_type: "CASH", commission_value: 7, sheet_name: "A Vista",
      })),
    ],
    fechamento_mensal_empresa: [
      {
        id: "fme-2025-02", empresa_cnpj: EMP.cnpj, ano: 2025, mes: 2,
        operacoes: fmeZerada ? 0 : 6491,
        valor_liquido: fmeZerada ? 0 : 97535.61,
        valor_avista: fmeZerada ? 0 : 56535.69, valor_seguro: fmeZerada ? 0 : 2549.61,
      },
      {
        id: "fme-2026-05", empresa_cnpj: EMP.cnpj, ano: 2026, mes: 5,
        operacoes: 5970, valor_liquido: 60765.54, valor_avista: 25762.88, valor_seguro: 562.37,
      },
    ],
    monthly_closing_imports: [
      { id: ALVO, company_id: EMP.id, year: 2025, month: 2, file_name: "alvo.xlsx", status: "PROCESSING", created_at: "2026-05-01T00:00:00Z" },
      { id: OUTRO, company_id: EMP.id, year: 2025, month: 2, file_name: "outro.xlsx", status: "COMPLETED", created_at: "2026-04-01T00:00:00Z" },
    ],
  });

  let clienteAtual = null;
  stubModule("@/lib/auth/guards", {
    withSocioAdmin: async () => ({
      user: { session: { appUser: { email: "gate@local" } } },
      supabase: clienteAtual,
    }),
    apiGuardErrorResponse: (e) => ({
      status: 500,
      json: async () => ({ error: String((e && e.message) || e) }),
    }),
  });
  // reconsolidarCompetenciaFechada NAO toca fechamento_mensal_empresa — os UNICOS
  // `.from()` de lib/reconsolidarCompetencia.ts sao promoter_monthly_results.
  stubModule("@/lib/reconsolidarCompetencia", {
    reconsolidarCompetenciaFechada: async () => ({ stub: true }),
  });
  const cancelRota = require(path.join("..", "app", "api", "import", "closing", "cancel", "route.ts"));

  const rodarCancel = async (semente, body) => {
    clienteAtual = createFakeFechamento(REAL, semente);
    const resp = await cancelRota.POST({ json: async () => body });
    const corpo = typeof resp.json === "function" ? await resp.json() : resp;
    return { status: resp.status, corpo, cli: clienteAtual };
  };
  const contarEnt = (cli, y, m) =>
    cli._rows("monthly_closing_entries").filter((r) => r.year === y && r.month === m).length;
  const fmeDe = (cli, y, m) =>
    cli._rows("fechamento_mensal_empresa").find((r) => r.ano === y && r.mes === m);

  console.log("\n   2a) RECUSA: cancelar deixaria 0 entries e o agregado tem valor");
  {
    const { status, corpo, cli } = await rodarCancel(montar({ comOutro: false, fmeZerada: false }), { importId: ALVO });
    console.log(`      status=${status}`);
    console.log(`      error: ${String(corpo.error || "").slice(0, 140)}...`);
    ok(status === 409, "   status 409 (recusa)", `status=${status}`);
    ok(corpo.confirmacao_necessaria === true, "   pede confirmacao explicita");
    ok(/6491/.test(String(corpo.error)), "   o `error` traz as OPERACOES do agregado (6491)");
    ok(/97\.535,61/.test(String(corpo.error)), "   o `error` traz o VALOR LIQUIDO (97.535,61)");
    ok(/RR ALAGOAS 1/.test(String(corpo.error)), "   o `error` nomeia a EMPRESA");
    ok(/02\/2025/.test(String(corpo.error)), "   o `error` nomeia a COMPETENCIA");
    ok(contarEnt(cli, 2025, 2) === 300, "   NADA foi apagado", `entries=${contarEnt(cli, 2025, 2)}`);
    ok(
      cli._rows("monthly_closing_imports").find((r) => r.id === ALVO).status === "PROCESSING",
      "   o import continua PROCESSING (a recusa nao destravou pela metade)"
    );
  }

  console.log("\n   2b) CONTROLE POSITIVO: cancel que NAO deixa orfao continua passando");
  {
    const semente = montar({ comOutro: true, fmeZerada: false });
    const antesVizinha = 90;
    const { status, corpo, cli } = await rodarCancel(semente, { importId: ALVO });
    console.log(`      status=${status}  corpo=${JSON.stringify(corpo).slice(0, 110)}`);
    ok(status === 200 || corpo.success === true, "   o cancel PASSOU", `status=${status}`);
    ok(contarEnt(cli, 2025, 2) === 120, "   apagou so as do import cancelado", `restam=${contarEnt(cli, 2025, 2)}`);
    ok(
      cli._rows("monthly_closing_imports").find((r) => r.id === ALVO).status === "CANCELLED",
      "   o import ficou CANCELLED (destravou o zumbi)"
    );
    ok(contarEnt(cli, 2026, 5) === antesVizinha, "   competencia VIZINHA intacta (contagem)", `${antesVizinha} -> ${contarEnt(cli, 2026, 5)}`);
    const fv = fmeDe(cli, 2026, 5);
    ok(
      Number(fv.operacoes) === 5970 && Number(fv.valor_liquido) === 60765.54,
      "   agregado da VIZINHA byte-identico (nao houve recomposicao)",
      `operacoes=${fv.operacoes} liquido=${fv.valor_liquido}`
    );
    const fa = fmeDe(cli, 2025, 2);
    ok(
      Number(fa.operacoes) === 6491 && Number(fa.valor_liquido) === 97535.61,
      "   agregado da PROPRIA competencia tambem intacto (NAO recompomos)",
      `operacoes=${fa.operacoes}`
    );
  }

  console.log("\n   2c) CONTROLE POSITIVO: FME ZERADA nao trava (o caso 2023-12 AL1)");
  {
    const { status, corpo, cli } = await rodarCancel(montar({ comOutro: false, fmeZerada: true }), { importId: ALVO });
    console.log(`      status=${status}  corpo=${JSON.stringify(corpo).slice(0, 110)}`);
    ok(status === 200 || corpo.success === true, "   o cancel PASSOU (agregado sem dinheiro)", `status=${status}`);
    ok(contarEnt(cli, 2025, 2) === 0, "   apagou normalmente", `restam=${contarEnt(cli, 2025, 2)}`);
  }

  console.log("\n   2d) a confirmacao explicita destrava (nunca e padrao ligado)");
  {
    const sem = await rodarCancel(montar({ comOutro: false, fmeZerada: false }), { importId: ALVO, confirmarAgregadoOrfao: false });
    ok(sem.status === 409, "   confirmarAgregadoOrfao=false NAO destrava", `status=${sem.status}`);
    const com = await rodarCancel(montar({ comOutro: false, fmeZerada: false }), { importId: ALVO, confirmarAgregadoOrfao: true });
    ok(com.status === 200 || com.corpo.success === true, "   confirmarAgregadoOrfao=true destrava", `status=${com.status}`);
    ok(contarEnt(com.cli, 2025, 2) === 0, "   e ai sim apaga (a decisao fica com quem confirmou)");
  }

  // ---- 3. VIGIA ----
  console.log("\n" + linha("="));
  console.log("3) VIGIA — detectFechamentoParcial: 'agregado_sem_detalhe'");
  console.log(linha("="));
  const { detectFechamentoParcial } = require(path.join("..", "lib", "diagnostico", "fechamentoParcial.ts"));
  const acharCheck = (res) => res.find((c) => c.id === "agregado_sem_detalhe");

  console.log("\n   3a) 2025-02 (com valor) acende; 2023-12 (zerada) nao");
  {
    const semente = {
      monthly_closing_entries: Array.from({ length: 40 }, (_, i) => ({
        id: `viva-${i}`, monthly_closing_import_id: "im-1",
        company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2026, month: 5,
        entry_type: "CASH", commission_value: 1, sheet_name: "A Vista",
      })),
      fechamento_mensal_empresa: [
        { id: "f1", empresa_cnpj: EMP.cnpj, ano: 2025, mes: 2, operacoes: 6491, valor_liquido: 97535.61, valor_avista: 56535.69, valor_seguro: 2549.61 },
        { id: "f2", empresa_cnpj: EMP.cnpj, ano: 2023, mes: 12, operacoes: 0, valor_liquido: 0, valor_avista: 0, valor_seguro: 0 },
        { id: "f3", empresa_cnpj: EMP.cnpj, ano: 2026, mes: 5, operacoes: 5970, valor_liquido: 60765.54, valor_avista: 25762.88, valor_seguro: 562.37 },
      ],
      monthly_closing_imports: [],
    };
    const res = await detectFechamentoParcial(createFakeFechamento(REAL, semente));
    // AUSENCIA DO CHECK E FALHA, NAO EXCECAO: vermelho por crash nao diz QUANTAS
    // assercoes o conserto sustenta.
    const check = acharCheck(res) || { severity: "(ausente)", count: -1, detalhe: [] };
    const comps = (check.detalhe || []).map((d) => d.competencia);
    console.log(`      severity=${check.severity}  count=${check.count}  competencias=${JSON.stringify(comps)}`);
    ok(acharCheck(res) !== undefined, "   o check existe no detector");
    ok(check.severity === "erro", "   severity e 'erro' (nao e descontinuidade, e perda)", `sev=${check.severity}`);
    ok(check.count === 1, "   ACENDE exatamente 1 vez", `count=${check.count}`);
    ok(comps.includes("2025-02"), "   ACENDE para 2025-02 (agregado com valor, zero detalhe)");
    ok(!comps.includes("2023-12"), "   NAO acende para 2023-12 (FME zerada — nao ha detalhe a perder)");
    ok(!comps.includes("2026-05"), "   NAO acende para competencia COM detalhe");
    const achado = (check.detalhe || [])[0] || {};
    ok(Number(achado.operacoes) === 6491, "   o achado traz as OPERACOES", `operacoes=${achado.operacoes}`);
    ok(Number(achado.valor_liquido) === 97535.61, "   o achado traz o VALOR LIQUIDO", `liquido=${achado.valor_liquido}`);
    ok(String(achado.empresa) === "RR ALAGOAS 1", "   o achado NOMEIA a empresa", `empresa=${achado.empresa}`);
  }

  console.log("\n   3b) MUTACAO DO ESTADO: dar detalhe a 2025-02 APAGA o vigia");
  {
    const semente = {
      monthly_closing_entries: [
        { id: "x1", monthly_closing_import_id: "im-9", company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2025, month: 2, entry_type: "CASH", commission_value: 1, sheet_name: "A Vista" },
      ],
      fechamento_mensal_empresa: [
        { id: "f1", empresa_cnpj: EMP.cnpj, ano: 2025, mes: 2, operacoes: 6491, valor_liquido: 97535.61, valor_avista: 0, valor_seguro: 0 },
      ],
      monthly_closing_imports: [],
    };
    const check = acharCheck(await detectFechamentoParcial(createFakeFechamento(REAL, semente))) || { count: -1 };
    console.log(`      count=${check.count}`);
    ok(check.count === 0, "   com UMA linha de detalhe o vigia NAO acende", `count=${check.count}`);
  }

  // ---- 4. TROCA DE DONO — a memoria nasce ANTES do delete ----
  // A gravacao dos debitos AUTO e delete-and-replace e NADA sobrevive a ela: o
  // proprio debito so tem o dono ATUAL, promoter_debit_sources cai por CASCADE, as
  // parcelas nascem no mesmo run e audit_logs tinha zero linhas de debito. Por isso
  // a memoria tem de ser escrita ANTES do delete — e e isso que este bloco cobra.
  console.log("\n" + linha("="));
  console.log("4) TROCA DE DONO — registrarTrocaDeDono + o check 'debito_auto_trocou_dono'");
  console.log(linha("="));

  const RES = require(path.join("..", "lib", "debitInsuranceResolver.ts"));
  const SRC_RES = fs.readFileSync(path.join(ROOT, "lib/debitInsuranceResolver.ts"), "utf8");

  // 4a. ESTATICO — a memoria nasce ANTES do delete, nos DOIS sitios.
  //     E a assercao que pega a mutacao "voltar o select para .select('id')" e a
  //     mutacao "chamar o helper depois do delete".
  console.log("\n   4a) ESTATICO: a captura vem ANTES do delete, nos dois resolvedores");
  {
    const nSelect = (SRC_RES.match(/\.select\("id, promoter_id, total_amount"\)/g) || []).length;
    const nChamada = (SRC_RES.match(/await registrarTrocaDeDono\(/g) || []).length;
    const nDelete = (SRC_RES.match(/from\("promoter_debits"\)\.delete\(\)/g) || []).length;
    ok(nSelect === 2, "os DOIS sitios capturam dono+valor antes de apagar", `n=${nSelect}`);
    ok(nChamada === 2, "os DOIS sitios chamam registrarTrocaDeDono", `n=${nChamada}`);
    ok(nDelete === 2, "ANTI-DESLIZE: ha exatamente 2 deletes de promoter_debits", `n=${nDelete}`);
    // ORDEM: cada chamada tem de vir antes do delete que a acompanha.
    let ordemOk = true;
    let cursor = 0;
    for (let i = 0; i < 2; i++) {
      const iCall = SRC_RES.indexOf("await registrarTrocaDeDono(", cursor);
      const iDel = SRC_RES.indexOf('from("promoter_debits").delete()', cursor);
      if (!(iCall > 0 && iDel > 0 && iCall < iDel)) ordemOk = false;
      cursor = iDel + 1;
    }
    ok(ordemOk, "em AMBOS, a chamada vem ANTES do delete (memoria antes da destruicao)");
  }

  // 4b. CONTROLE POSITIVO — A ASSERCAO MAIS IMPORTANTE DO CONJUNTO.
  //     Rodada que NAO muda nada NAO pode escrever linha. Um helper que gravasse
  //     sempre passaria em 4c e encheria o diagnostico a CADA import: o vigia
  //     viraria ruido e alguem o desligaria — o modo de falha que esta frente
  //     inteira combate. Provado com o caso REAL: jun e jul, hoje, zero promotores
  //     mudam (medido em 28/08/2026, dry-run dos dois resolvedores).
  console.log("\n   4b) CONTROLE POSITIVO (o mais importante): no-op NAO escreve linha");
  {
    const P1 = "11111111-1111-1111-1111-111111111111";
    const P2 = "22222222-2222-2222-2222-222222222222";
    // O caso REAL de jun/2026: 17 debitos, R$ 899,21, identicos antes e depois.
    const antesJun = [
      { promoter_id: P1, total_amount: 320.04 },
      { promoter_id: P2, total_amount: 218.23 },
    ];
    const depoisJun = [
      { promoterId: P1, total: 320.04 },
      { promoterId: P2, total: 218.23 },
    ];
    const cli = createFakeFechamento(REAL, { monthly_closing_entries: [], fechamento_mensal_empresa: [], monthly_closing_imports: [], audit_logs: [] });
    const r = await RES.registrarTrocaDeDono(cli, {
      year: 2026, month: 6, origem: "RR", createdBy: "gate", antes: antesJun, depois: depoisJun,
    });
    const linhas = cli._rows("audit_logs");
    console.log(`      mudancas detectadas=${r.mudancas}   linhas em audit_logs=${linhas.length}`);
    ok(r.mudancas === 0, "   no-op: ZERO mudancas detectadas", `n=${r.mudancas}`);
    ok(linhas.length === 0, "   no-op: NENHUMA linha escrita em audit_logs", `n=${linhas.length}`);

    // E a ordem das linhas nao pode inventar mudanca (o helper agrega por promotor).
    const cli2 = createFakeFechamento(REAL, { monthly_closing_entries: [], fechamento_mensal_empresa: [], monthly_closing_imports: [], audit_logs: [] });
    const r2 = await RES.registrarTrocaDeDono(cli2, {
      year: 2026, month: 6, origem: "RR", createdBy: "gate",
      antes: [...antesJun].reverse(), depois: depoisJun,
    });
    ok(r2.mudancas === 0 && cli2._rows("audit_logs").length === 0, "   ordem diferente NAO inventa mudanca");

    // Centavo nao e troca de dono.
    const cli3 = createFakeFechamento(REAL, { monthly_closing_entries: [], fechamento_mensal_empresa: [], monthly_closing_imports: [], audit_logs: [] });
    const r3 = await RES.registrarTrocaDeDono(cli3, {
      year: 2026, month: 6, origem: "RR", createdBy: "gate",
      antes: [{ promoter_id: P1, total_amount: 320.04 }],
      depois: [{ promoterId: P1, total: 320.042 }],
    });
    ok(r3.mudancas === 0 && cli3._rows("audit_logs").length === 0, "   diferenca de centavo NAO conta como troca");
  }

  // 4c. MUTACAO / DETECCAO — quando o dono MUDA, a linha nasce, e com o dano dentro.
  console.log("\n   4c) DETECCAO: dono muda -> UMA linha, com quem->quem e quanto");
  {
    const P1 = "11111111-1111-1111-1111-111111111111";
    const P2 = "22222222-2222-2222-2222-222222222222";
    const cli = createFakeFechamento(REAL, { monthly_closing_entries: [], fechamento_mensal_empresa: [], monthly_closing_imports: [], audit_logs: [] });
    const r = await RES.registrarTrocaDeDono(cli, {
      year: 2026, month: 7, origem: "RR", createdBy: "rotina-automatica",
      antes: [{ promoter_id: P1, total_amount: 185.33 }],
      depois: [{ promoterId: P2, total: 185.33 }],
    });
    const linhas = cli._rows("audit_logs");
    const l = linhas[0] || {};
    const pl = (l && l.payload) || {};
    console.log(`      mudancas=${r.mudancas}  linhas=${linhas.length}  action=${l.action}`);
    console.log(`      description: ${l.description}`);
    ok(r.mudancas === 2, "   detecta as DUAS pontas (sai de um, entra no outro)", `n=${r.mudancas}`);
    ok(linhas.length === 1, "   escreve UMA linha por rodada, nao uma por debito", `n=${linhas.length}`);
    ok(l.action === RES.AUDIT_TROCA_DONO, "   action e a constante unica", `action=${l.action}`);
    ok(l.entity_name === "promoter_debits", "   entity_name = promoter_debits");
    ok(String(l.created_by) === "rotina-automatica", "   guarda QUEM RODOU (separa import de script manual)", `created_by=${l.created_by}`);
    ok(Number(pl.year) === 2026 && Number(pl.month) === 7, "   payload traz a competencia");
    ok(String(pl.origem) === "RR", "   payload traz a origem (RR/ADS)");
    const mud = Array.isArray(pl.mudancas) ? pl.mudancas : [];
    const saiu = mud.find((m) => m.promoter_id_antes === P1);
    const entrou = mud.find((m) => m.promoter_id_depois === P2);
    ok(!!saiu && Number(saiu.valor_antes) === 185.33, "   payload diz de QUEM saiu, e quanto", `${saiu && saiu.valor_antes}`);
    ok(!!entrou && Number(entrou.valor_depois) === 185.33, "   payload diz para QUEM foi, e quanto", `${entrou && entrou.valor_depois}`);
  }

  // 4d. O CHECK — le audit_logs, filtra por action, e NAO confunde com o resto.
  //     audit_logs e COMPARTILHADA (481 linhas em 28/08/2026, quase todas de
  //     promotores/MANUAL_CHANGE): sem o filtro por action o check seria falso
  //     positivo permanente.
  console.log("\n   4d) O CHECK: severity 'info', le a action certa, ignora as outras");
  {
    const base = {
      monthly_closing_entries: [
        { id: "e1", monthly_closing_import_id: "i1", company_id: EMP.id, company_cnpj: EMP.cnpj, year: 2026, month: 5, entry_type: "CASH", commission_value: 1, sheet_name: "A Vista" },
      ],
      fechamento_mensal_empresa: [
        { id: "f1", empresa_cnpj: EMP.cnpj, ano: 2026, mes: 5, operacoes: 10, valor_liquido: 100, valor_avista: 100, valor_seguro: 0 },
      ],
      monthly_closing_imports: [],
    };
    const agora = new Date().toISOString();
    // (i) so RUIDO de outras entidades -> count 0
    const cliRuido = createFakeFechamento(REAL, {
      ...base,
      audit_logs: [
        { id: "a1", entity_name: "promotores", action: "MANUAL_CHANGE", description: "x", payload: {}, created_by: "diego", created_at: agora },
        { id: "a2", entity_name: "app_users", action: "user_created", description: "y", payload: {}, created_by: "diego", created_at: agora },
      ],
    });
    const cRuido = (await detectFechamentoParcial(cliRuido)).find((c) => c.id === "debito_auto_trocou_dono") || { count: -1, severity: "(ausente)" };
    console.log(`      so ruido: count=${cRuido.count}  severity=${cRuido.severity}`);
    ok(cRuido.severity === "info", "   severity e 'info' (nao e perda nem descontinuidade)", `sev=${cRuido.severity}`);
    ok(cRuido.count === 0, "   NAO acende com linhas de OUTRAS actions (tabela compartilhada)", `count=${cRuido.count}`);

    // (ii) com a linha certa -> count 1, com o detalhe legivel
    const cliTroca = createFakeFechamento(REAL, {
      ...base,
      audit_logs: [
        { id: "a1", entity_name: "promotores", action: "MANUAL_CHANGE", description: "x", payload: {}, created_by: "diego", created_at: agora },
        {
          id: "a3", entity_name: "promoter_debits", action: RES.AUDIT_TROCA_DONO,
          description: "2026-07 CANCELAMENTO_SEGURO (RR): 1 debito(s) mudaram de dono no reprocessamento.",
          payload: { year: 2026, month: 7, origem: "RR", debit_type: "CANCELAMENTO_SEGURO", mudancas: [{ promoter_id_antes: "p1", promoter_id_depois: "p2", valor_antes: 185.33, valor_depois: 185.33 }] },
          created_by: "rotina-automatica", created_at: agora,
        },
      ],
    });
    const cTroca = (await detectFechamentoParcial(cliTroca)).find((c) => c.id === "debito_auto_trocou_dono") || { count: -1, detalhe: [] };
    const d0 = (cTroca.detalhe || [])[0] || {};
    console.log(`      com a linha: count=${cTroca.count}  detalhe=${JSON.stringify(d0).slice(0, 120)}`);
    ok(cTroca.count === 1, "   ACENDE com a action certa", `count=${cTroca.count}`);
    ok(String(d0.competencia) === "2026-07", "   o detalhe traz a competencia", `${d0.competencia}`);
    ok(String(d0.quem_rodou) === "rotina-automatica", "   o detalhe traz QUEM RODOU", `${d0.quem_rodou}`);
    ok(Number(d0.debitos_que_mudaram) === 1, "   o detalhe conta os debitos que mudaram");
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
