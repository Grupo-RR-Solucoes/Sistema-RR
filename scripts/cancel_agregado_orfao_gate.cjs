/* ============================================================================
 * cancel_agregado_orfao_gate — NENHUMA competencia pode ficar com AGREGADO
 * ORFAO: linha em fechamento_mensal_empresa sem uma unica entry de detalhe.
 *
 * Rodar:
 *   node scripts/cancel_agregado_orfao_gate.cjs
 *
 * O DANO MEDIDO (28/08/2026): 2025-02 RR ALAGOAS 1 tem
 * `fechamento_mensal_empresa` com operacoes=6.491 e valor_liquido=97.535,61 e
 * ZERO linhas em monthly_closing_entries. Varridas as 100 linhas de FME, e a
 * UNICA competencia quebrada (2023-12 AL1 tambem esta sem entries, mas com FME
 * legitimamente ZERADA: operacoes=0, valor_liquido=0,00 — nao e perda).
 *
 * A CAUSA, em duas metades:
 *   (H1) o IMPORT apagava o detalhe legado ANTES de inserir o novo
 *        (monthlyClosingImport.ts), deixando a competencia vazia numa janela;
 *   (H2) o CANCEL apaga as entries do import e NAO recompoe o agregado
 *        (cancel/route.ts:49-57; reconsolidarCompetenciaFechada so toca
 *        promoter_monthly_results — linhas 194 e 247 sao os unicos `.from`).
 *
 * O RECORTE AMPLO DO DELETE DO IMPORT E DELIBERADO e NAO foi mexido: reimportar
 * a competencia SUBSTITUI o detalhe legado. Medido: 2026-01 AL1 tem 14 imports
 * COMPLETED e 6.433 entries legadas de UM UNICO import. O que mudou foi a ORDEM.
 *
 * OS BLOCOS:
 *   1. ORDEM      — no fonte do import, o delete vem DEPOIS do insert, carrega
 *                   `.neq(importId)` e o guard de `rowsToInsert.length > 0`; e o
 *                   recorte amplo continua la (nao viramos `.eq(importId)`).
 *   2. TRACE      — o import REAL roda contra o espelho e o observador prova que
 *                   a contagem de entries NUNCA passa por zero tendo comecado
 *                   com detalhe. Reverter a ordem faz a contagem tocar o zero.
 *   3. RECUSA     — a funcao POST REAL do cancel recusa (409) quando apagar
 *                   deixaria o agregado orfao, com o dano em numeros no campo
 *                   `error`. Tres controles positivos impedem que isto vire uma
 *                   trava geral: cancel legitimo passa, FME zerada nao trava, e
 *                   a competencia vizinha sai byte-identica.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");

const linha = (c) => c.repeat(84);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "lib/monthlyClosingImport.ts"), "utf8");

(async () => {
  // ---- 1. ORDEM ----
  console.log(linha("="));
  console.log("1) ORDEM — no import, o delete do detalhe legado vem DEPOIS do insert");
  console.log(linha("="));

  // ANCORAS UNICAS. `insert(slice)` aparece DUAS vezes no arquivo — a outra e a de
  // syncProductLines (:754), e ancorar nela dava um offset ANTERIOR ao delete: a
  // assercao de ordem passava mesmo com o codigo defeituoso. A ancora do loop
  // legado e `rowsToInsert.slice(`, que so existe la; e o gate agora CONTA as
  // ocorrencias, para a ancora nao poder deslizar de novo em silencio.
  const nInsertLegado = (SRC.match(/rowsToInsert\.slice\(/g) || []).length;
  const nDelete = (SRC.match(/entry_type\.not\.in\.\(BBCAP,CONTA_CORRENTE,CONSORCIO\)/g) || []).length;
  const iInsert = SRC.indexOf("rowsToInsert.slice(");
  const iDelete = SRC.indexOf('.or("entry_type.is.null,entry_type.not.in.(BBCAP,CONTA_CORRENTE,CONSORCIO)")');
  ok(nInsertLegado === 1, "ANTI-DESLIZE: a ancora do insert legado e UNICA", `n=${nInsertLegado}`);
  ok(nDelete === 1, "ANTI-DESLIZE: a ancora do delete legado e UNICA", `n=${nDelete}`);
  ok(iInsert > 0, "ANTI-VACUIDADE: achei o insert em chunk das entries legadas", `pos=${iInsert}`);
  ok(iDelete > 0, "ANTI-VACUIDADE: achei o delete do detalhe legado", `pos=${iDelete}`);
  ok(iDelete > iInsert, "o DELETE vem DEPOIS do INSERT (janela reversivel)", `insert=${iInsert} delete=${iDelete}`);

  const bloco = SRC.slice(iDelete - 1200, iDelete + 200);
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

  // ---- 2. TRACE — o import REAL contra o espelho ----
  console.log("\n" + linha("="));
  console.log("2) TRACE — importMonthlyClosingWorkbook REAL: a contagem nunca toca o zero");
  console.log(linha("="));

  const { createClient } = require("@supabase/supabase-js");
  const { createFakeFechamento } = require("./_fakeFechamento.cjs");
  const Module = require("node:module");

  function stubModule(spec, exports) {
    const p = require.resolve(spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec);
    const m = new Module(p);
    m.filename = p;
    m.loaded = true;
    m.exports = exports;
    require.cache[p] = m;
  }
  stubModule("@/lib/reconsolidarCompetencia", {
    reconsolidarCompetenciaFechada: async () => ({ stub: true }),
  });

  const real = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const ARQ = path.join(
    "C:/Users/diego/Downloads/RRCRED/Relatório de Produção/ALAGOAS",
    "C23677_48357275000103_Todos_2_2025.xlsx"
  );
  const temArquivo = fs.existsSync(ARQ);
  // ANTI-VACUIDADE: sem o arquivo o bloco NAO passa em silencio — reprova.
  ok(temArquivo, "ANTI-VACUIDADE: o arquivo TODOS de referencia esta em disco", ARQ);
  if (!temArquivo) {
    console.log("\n" + linha("="));
    console.log(`GATE: ${falhas} FALHA(S)`);
    process.exit(1);
  }

  const { data: cos } = await real.from("companies").select("id, name, cnpj");
  const AL1 = cos.find((c) => String(c.name).toUpperCase().includes("ALAGOAS 1"));

  // Semente: a competencia JA TEM detalhe de um import anterior.
  const IMPORT_ANTIGO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const ANTIGAS = 400;
  const semente = {
    monthly_closing_entries: Array.from({ length: ANTIGAS }, (_, i) => ({
      id: `antiga-${i}`,
      monthly_closing_import_id: IMPORT_ANTIGO,
      company_id: AL1.id,
      company_cnpj: AL1.cnpj,
      year: 2025,
      month: 2,
      entry_type: i % 3 === 0 ? "CASH" : i % 3 === 1 ? "PRT" : "INSURANCE",
      commission_value: 1,
      sheet_name: "A Vista",
    })),
    fechamento_mensal_empresa: [
      { id: "fme-1", empresa_cnpj: AL1.cnpj, ano: 2025, mes: 2, valor_liquido: 97535.61, operacoes: ANTIGAS },
    ],
    monthly_closing_imports: [
      { id: IMPORT_ANTIGO, company_id: AL1.id, year: 2025, month: 2, file_name: "antigo.xlsx", status: "COMPLETED", codigo_arquivo: "C00000" },
    ],
  };

  const fake = createFakeFechamento(real, semente);
  // A lib pega o cliente por getSupabaseAdmin() — injeto o espelho por stub,
  // ANTES do require (mesma tecnica de ads_import_so_credito_gate.cjs:243).
  stubModule("@/lib/supabaseAdmin", { getSupabaseAdmin: () => fake });
  const { importMonthlyClosingWorkbook } = require(path.join("..", "lib", "monthlyClosingImport.ts"));

  let erroImport = null;
  try {
    await importMonthlyClosingWorkbook({
      fileBase64: fs.readFileSync(ARQ).toString("base64"),
      fileName: path.basename(ARQ),
      year: 2025,
      month: 2,
      companyId: AL1.id,
      createdBy: "gate@local",
    });
  } catch (e) {
    erroImport = e;
  }

  const tr = fake._store.get("__trace") || [];
  console.log(`   escritas em monthly_closing_entries observadas: ${tr.length}`);
  for (const t of tr.slice(0, 12)) console.log(`      ${t.op.padEnd(7)} ${t.antes} -> ${t.depois}`);
  if (tr.length > 12) console.log(`      ... (+${tr.length - 12})`);
  if (erroImport) console.log(`   NOTA: o import terminou com erro: ${erroImport.message}`);

  ok(tr.length > 0, "ANTI-VACUIDADE: o import REAL escreveu em monthly_closing_entries", `escritas=${tr.length}`);
  const tocouZero = tr.some((t) => t.depois === 0);
  ok(!tocouZero, "a contagem de entries NUNCA chega a ZERO durante o import");
  const final = fake._rows("monthly_closing_entries").length;
  const sobrouAntiga = fake._rows("monthly_closing_entries").filter(
    (r) => r.monthly_closing_import_id === IMPORT_ANTIGO
  ).length;
  console.log(`   estado final: ${final} entries   (das antigas: ${sobrouAntiga})`);
  ok(final > 0, "a competencia terminou COM detalhe", `entries=${final}`);
  ok(
    sobrouAntiga === 0,
    "as entries do import ANTERIOR foram substituidas (o recorte amplo faz trabalho)",
    `sobraram=${sobrouAntiga}`
  );

  // ---- 3. RECUSA — o cancel nao deixa agregado orfao ----
  // Quatro cenarios contra a funcao POST REAL da rota. O que separa este bloco de
  // uma trava burra sao os TRES controles positivos: cancel legitimo continua
  // passando, FME zerada nao trava, e competencia vizinha nao e tocada.
  console.log("\n" + linha("="));
  console.log("3) RECUSA — POST real de /api/import/closing/cancel");
  console.log(linha("="));

  const ALVO = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const OUTRO = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  // Monta um espelho por cenario: as entries da competencia 2025-02 vem SO do
  // import ALVO (ou tambem do OUTRO, no controle positivo), mais uma competencia
  // VIZINHA (2026-05) que nao pode ser tocada por nada disto.
  const montar = ({ comOutro, fmeZerada }) => ({
    monthly_closing_entries: [
      ...Array.from({ length: 300 }, (_, i) => ({
        id: `alvo-${i}`, monthly_closing_import_id: ALVO,
        company_id: AL1.id, company_cnpj: AL1.cnpj, year: 2025, month: 2,
        entry_type: "CASH", commission_value: 1, sheet_name: "A Vista",
      })),
      ...(comOutro
        ? Array.from({ length: 120 }, (_, i) => ({
            id: `outro-${i}`, monthly_closing_import_id: OUTRO,
            company_id: AL1.id, company_cnpj: AL1.cnpj, year: 2025, month: 2,
            entry_type: "PRT", commission_value: 2, sheet_name: "PRT",
          }))
        : []),
      // VIZINHA — competencia sadia, intocavel.
      ...Array.from({ length: 90 }, (_, i) => ({
        id: `vizinha-${i}`, monthly_closing_import_id: OUTRO,
        company_id: AL1.id, company_cnpj: AL1.cnpj, year: 2026, month: 5,
        entry_type: "CASH", commission_value: 7, sheet_name: "A Vista",
      })),
    ],
    fechamento_mensal_empresa: [
      {
        id: "fme-2025-02", empresa_cnpj: AL1.cnpj, ano: 2025, mes: 2,
        operacoes: fmeZerada ? 0 : 6491,
        valor_liquido: fmeZerada ? 0 : 97535.61,
        valor_avista: fmeZerada ? 0 : 56535.69, valor_seguro: fmeZerada ? 0 : 2549.61,
      },
      {
        id: "fme-2026-05", empresa_cnpj: AL1.cnpj, ano: 2026, mes: 5,
        operacoes: 5970, valor_liquido: 60765.54, valor_avista: 25762.88, valor_seguro: 562.37,
      },
    ],
    monthly_closing_imports: [
      { id: ALVO, company_id: AL1.id, year: 2025, month: 2, file_name: "alvo.xlsx", status: "PROCESSING", created_at: "2026-05-01T00:00:00Z" },
      { id: OUTRO, company_id: AL1.id, year: 2025, month: 2, file_name: "outro.xlsx", status: "COMPLETED", created_at: "2026-04-01T00:00:00Z" },
    ],
  });

  // A rota pega o cliente do proprio guard. Um stub por cenario.
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
  const cancelRota = require(path.join("..", "app", "api", "import", "closing", "cancel", "route.ts"));

  const rodarCancel = async (semente, body) => {
    clienteAtual = createFakeFechamento(real, semente);
    const resp = await cancelRota.POST({ json: async () => body });
    const corpo = typeof resp.json === "function" ? await resp.json() : resp;
    return { status: resp.status, corpo, cli: clienteAtual };
  };

  const contarEnt = (cli, y, m) =>
    cli._rows("monthly_closing_entries").filter((r) => r.year === y && r.month === m).length;
  const fmeDe = (cli, y, m) =>
    cli._rows("fechamento_mensal_empresa").find((r) => r.ano === y && r.mes === m);

  // 3a. RECUSA — cancelar zeraria a competencia e ha agregado com valor.
  console.log("\n   3a) RECUSA: cancelar deixaria 0 entries e o agregado tem valor");
  {
    const semente = montar({ comOutro: false, fmeZerada: false });
    const { status, corpo, cli } = await rodarCancel(semente, { importId: ALVO });
    console.log(`      status=${status}`);
    console.log(`      error: ${String(corpo.error || "").slice(0, 150)}...`);
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

  // 3b. CONTROLE POSITIVO — cancel LEGITIMO segue funcionando.
  //     Sem este bloco, uma trava geral (recusar sempre) passaria em 3a.
  console.log("\n   3b) CONTROLE POSITIVO: cancel que NAO deixa orfao continua passando");
  {
    const semente = montar({ comOutro: true, fmeZerada: false });
    const antesVizinha = contarEnt(createFakeFechamento(real, semente), 2026, 5);
    const { status, corpo, cli } = await rodarCancel(semente, { importId: ALVO });
    console.log(`      status=${status}  corpo=${JSON.stringify(corpo).slice(0, 120)}`);
    ok(status === 200 || corpo.success === true, "   o cancel PASSOU", `status=${status}`);
    ok(contarEnt(cli, 2025, 2) === 120, "   apagou so as do import cancelado", `restam=${contarEnt(cli, 2025, 2)}`);
    ok(
      cli._rows("monthly_closing_imports").find((r) => r.id === ALVO).status === "CANCELLED",
      "   o import ficou CANCELLED (destravou o zumbi)"
    );
    // CONTROLE POSITIVO — a competencia VIZINHA sai byte-identica.
    const vizinhaDepois = cli._rows("monthly_closing_entries").filter((r) => r.year === 2026 && r.month === 5);
    ok(vizinhaDepois.length === antesVizinha, "   competencia VIZINHA intacta (contagem)", `${antesVizinha} -> ${vizinhaDepois.length}`);
    const fmeVizinha = fmeDe(cli, 2026, 5);
    ok(
      Number(fmeVizinha.operacoes) === 5970 && Number(fmeVizinha.valor_liquido) === 60765.54,
      "   agregado da VIZINHA byte-identico (nao houve recomposicao)",
      `operacoes=${fmeVizinha.operacoes} liquido=${fmeVizinha.valor_liquido}`
    );
    const fmeAlvo = fmeDe(cli, 2025, 2);
    ok(
      Number(fmeAlvo.operacoes) === 6491 && Number(fmeAlvo.valor_liquido) === 97535.61,
      "   agregado da PROPRIA competencia tambem intacto (NAO recompomos)",
      `operacoes=${fmeAlvo.operacoes}`
    );
  }

  // 3c. CONTROLE POSITIVO — FME zerada nao e dano, entao nao pode travar.
  //     E o caso de 2023-12 AL1 (operacoes=0, valor_liquido=0,00).
  console.log("\n   3c) CONTROLE POSITIVO: FME ZERADA nao trava (o caso 2023-12 AL1)");
  {
    const semente = montar({ comOutro: false, fmeZerada: true });
    const { status, corpo, cli } = await rodarCancel(semente, { importId: ALVO });
    console.log(`      status=${status}  corpo=${JSON.stringify(corpo).slice(0, 120)}`);
    ok(status === 200 || corpo.success === true, "   o cancel PASSOU (agregado sem dinheiro)", `status=${status}`);
    ok(contarEnt(cli, 2025, 2) === 0, "   apagou normalmente", `restam=${contarEnt(cli, 2025, 2)}`);
  }

  // 3d. A confirmacao explicita destrava — e SO ela.
  console.log("\n   3d) a confirmacao explicita destrava (nunca e padrao ligado)");
  {
    const semente = montar({ comOutro: false, fmeZerada: false });
    const semConfirmar = await rodarCancel(semente, { importId: ALVO, confirmarAgregadoOrfao: false });
    ok(semConfirmar.status === 409, "   confirmarAgregadoOrfao=false NAO destrava", `status=${semConfirmar.status}`);
    const comConfirmar = await rodarCancel(montar({ comOutro: false, fmeZerada: false }), {
      importId: ALVO,
      confirmarAgregadoOrfao: true,
    });
    ok(
      comConfirmar.status === 200 || comConfirmar.corpo.success === true,
      "   confirmarAgregadoOrfao=true destrava",
      `status=${comConfirmar.status}`
    );
    ok(
      contarEnt(comConfirmar.cli, 2025, 2) === 0,
      "   e ai sim apaga (a decisao fica com quem confirmou)"
    );
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
