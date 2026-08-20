/*
 * GATE — PISO DE PRODUCAO PARA O REPASSE: o LEITOR da regua, antes de ele morder
 * qualquer numero.
 *
 * SELF-CONTAINED e OFFLINE: nao toca banco nenhum. Monta um Supabase FALSO em
 * memoria e roda as funcoes REAIS de lib/pisoProducao.ts.
 *
 * PROVAS (exit 0 = todas passam; exit 2 = alguma falhou):
 *   A) A regua SEEDADA e lida. A forma exata do
 *      scripts/sql/2026-08-18_piso_producao_repasse.sql atravessa parseReguaPiso
 *      e sai tipada: piso 150000, MENOR_QUE, base do FECHAMENTO, zera
 *      [CREDITO, SEGURO] (SEM produto), 2 alcancados.
 *   B) O leitor LANCA no que nao reconhece — base, comparacao, alvo de zera,
 *      chave de escopo desconhecida, escopo aceito-mas-nao-implementado, scope
 *      vazio. Silencio em qualquer um desses e pagamento errado.
 *   C) O VEREDICTO: abaixo do piso zera credito e seguro; PRODUTO fica de pe
 *      (nao esta em zera[]); acima do piso nada e zerado.
 *   D) A FRONTEIRA: R$ 150.000,00 EXATOS PAGAM com MENOR_QUE e ZERAM com
 *      MENOR_OU_IGUAL. LILIAN fechou 2026-05 a R$ 66,98 do piso — a diferenca
 *      entre '<' e '<=' ja teve consequencia real.
 *   E) FLOAT NAO DECIDE DINHEIRO: uma soma que cai em 149999.99999999997 e
 *      arredondada para 150000,00 e PAGA. Sem o round2 o piso zeraria por erro
 *      de ponto flutuante.
 *   F) A BASE E DADO: com a MESMA producao (numeros medidos de LILIAN 2026-04,
 *      fechamento 115.030,26 x diario 137.620,26) as duas bases concordam; num
 *      caso em volta dos 150k elas DIVERGEM, e quem decide e a regua.
 *   G) FAIL-LOUD do A2: alcancado sem producao consolidada LANCA — nao vira
 *      "zero por ignorancia".
 *   H) VIGENCIA: escolhe a regua certa por competencia, devolve null quando nao
 *      ha, e LANCA com duas vigencias abertas ao mesmo tempo.
 *   I) SEM FK, MAS SEM SILENCIO: promoter_id do scope que nao existe em
 *      promoters LANCA (o jsonb nao tem integridade referencial).
 *   J) CONTRATO DE INJECAO: assertPisoInjetado passa sem regua e com fator, e
 *      LANCA quando ha regua e o fator nao foi injetado.
 *   K) NO-OP: sem regua vigente os mapas saem VAZIOS, e `map.get(pid) ?? 1` da
 *      1 — que e exatamente o que os consolidadores farao.
 *   L) AINDA DESLIGADO: nenhum arquivo de lib/ ou app/ importa lib/pisoProducao.
 *      O modulo existe para ser revisado, nao para estar em producao. Este teste
 *      deve ser APAGADO no commit que ligar o piso.
 */
require("./_ts_register.cjs");

const fs = require("node:fs");
const path = require("node:path");

const {
  parseReguaPiso,
  montarPlanoPiso,
  planoPisoVazio,
  resolverReguaPisoVigente,
  competenciaExigePiso,
  assertPisoInjetado,
  competenciaParaData,
  PISO_TABELA,
} = require("../lib/pisoProducao.ts");

const ROOT = path.resolve(__dirname, "..");

const LILIAN = "c8925313-09fb-49c1-b677-e00402181a9a";
const MARIA = "bf872c4a-7288-40f8-b53f-43b79218d643";

let falhas = 0;
function ok(nome, cond, detalhe) {
  if (cond) {
    console.log(`  ok   ${nome}`);
  } else {
    falhas += 1;
    console.log(`  FALHA ${nome}${detalhe ? ` -> ${detalhe}` : ""}`);
  }
}
/** Roda `fn` e devolve a mensagem do erro, ou null se nao lancou. */
function lancou(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return String(e.message || e);
  }
}
async function lancouAsync(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e.message || e);
  }
}

// ---------------------------------------------------------------------------
// Supabase FALSO — so o subconjunto do query-builder que o leitor usa:
// from().select().lte().order() e from().select().in().
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas, erros) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const falhaPor = erros || {};
  return {
    from(tabela) {
      const filtros = [];
      const api = {
        select() {
          return api;
        },
        lte(col, val) {
          filtros.push((r) => String(r[col] ?? "") <= String(val));
          return api;
        },
        in(col, vals) {
          filtros.push((r) => vals.includes(r[col]));
          return api;
        },
        order() {
          return api;
        },
        then(resolve, reject) {
          try {
            if (falhaPor[tabela]) {
              return resolve({ data: null, error: { message: falhaPor[tabela] } });
            }
            const linhas = (db[tabela] || []).filter((r) => filtros.every((f) => f(r)));
            return resolve({ data: linhas, error: null });
          } catch (e) {
            return reject(e);
          }
        },
      };
      return api;
    },
  };
}

// A LINHA EXATA que o SQL do passo 3 grava. Se o SQL mudar e isto nao, o gate
// deixa de provar o que diz provar.
const LINHA_SEEDADA = {
  id: "regua-seed",
  competencia_inicio: "2026-08-01",
  competencia_fim: null,
  regra: {
    piso: 150000.0,
    comparacao: "MENOR_QUE",
    base_calculo: "PRODUCAO_LIQUIDA_FECHAMENTO",
    escopo_producao: "CONSOLIDADO_RR_ADS",
    zera: ["CREDITO", "SEGURO"],
  },
  scope: { promoter_ids: [LILIAN, MARIA] },
};

const PROMOTERS_OK = [{ id: LILIAN }, { id: MARIA }];

function comRegra(mods) {
  return { ...LINHA_SEEDADA, regra: { ...LINHA_SEEDADA.regra, ...mods } };
}
function comScope(scope) {
  return { ...LINHA_SEEDADA, scope };
}

async function main() {
  // =========================================================================
  console.log("\nA) a regua SEEDADA e lida e sai tipada");
  // =========================================================================
  const regua = parseReguaPiso(LINHA_SEEDADA);
  ok("piso = 150000", regua.piso === 150000, String(regua.piso));
  ok("comparacao = MENOR_QUE", regua.comparacao === "MENOR_QUE", regua.comparacao);
  ok(
    "base = PRODUCAO_LIQUIDA_FECHAMENTO",
    regua.baseCalculo === "PRODUCAO_LIQUIDA_FECHAMENTO",
    regua.baseCalculo
  );
  ok(
    "zera = CREDITO + SEGURO, SEM produto",
    regua.zera.length === 2 && regua.zera.includes("CREDITO") && regua.zera.includes("SEGURO"),
    JSON.stringify(regua.zera)
  );
  ok("2 alcancados", regua.promoterIds.length === 2, JSON.stringify(regua.promoterIds));

  // =========================================================================
  console.log("\nB) o leitor LANCA no que nao reconhece");
  // =========================================================================
  ok(
    "base desconhecida lanca",
    /base_calculo. desconhecida/.test(lancou(() => parseReguaPiso(comRegra({ base_calculo: "CHUTE" }))) || ""),
    lancou(() => parseReguaPiso(comRegra({ base_calculo: "CHUTE" })))
  );
  ok(
    "comparacao desconhecida lanca",
    !!lancou(() => parseReguaPiso(comRegra({ comparacao: "QUASE" })))
  );
  ok(
    "alvo de zera desconhecido lanca",
    !!lancou(() => parseReguaPiso(comRegra({ zera: ["CREDITO", "FERIAS"] })))
  );
  ok("zera vazio lanca", !!lancou(() => parseReguaPiso(comRegra({ zera: [] }))));
  ok("piso negativo lanca", !!lancou(() => parseReguaPiso(comRegra({ piso: -1 }))));
  ok(
    "escopo_producao desconhecido lanca",
    !!lancou(() => parseReguaPiso(comRegra({ escopo_producao: "SO_RR" })))
  );
  ok(
    "chave de escopo desconhecida lanca",
    !!lancou(() => parseReguaPiso(comScope({ cor_do_cracha: ["azul"] })))
  );
  const msgNaoImpl = lancou(() => parseReguaPiso(comScope({ profile_types: ["CLT_FIXO"] })));
  ok(
    "escopo ACEITO no banco mas NAO implementado lanca (nao e ignorado)",
    !!msgNaoImpl && /NAO IMPLEMENTADA/.test(msgNaoImpl),
    msgNaoImpl
  );
  ok("scope vazio lanca", !!lancou(() => parseReguaPiso(comScope({}))));
  ok(
    "promoter_ids vazio lanca",
    !!lancou(() => parseReguaPiso(comScope({ promoter_ids: [] })))
  );
  ok("regra ausente lanca", !!lancou(() => parseReguaPiso({ id: "x", scope: LINHA_SEEDADA.scope })));

  // =========================================================================
  console.log("\nC) o veredicto: abaixo zera credito+seguro, produto fica de pe");
  // =========================================================================
  // Numeros MEDIDOS no PMR de 2026-06 (source='fechamento').
  const planoJun = montarPlanoPiso(regua, [
    { promoterId: LILIAN, fechamento: 98548.32, diario: 98548.32 },
    { promoterId: MARIA, fechamento: 140800.0, diario: 140800.0 },
  ]);
  ok("LILIAN abaixo do piso", planoJun.fatorCreditoByPromoter.get(LILIAN) === 0);
  ok("LILIAN seguro zerado", planoJun.fatorSeguroByPromoter.get(LILIAN) === 0);
  ok(
    "LILIAN PRODUTO INTACTO (nao esta em zera[])",
    planoJun.fatorProdutoByPromoter.get(LILIAN) === 1
  );
  ok("MARIA abaixo do piso", planoJun.fatorCreditoByPromoter.get(MARIA) === 0);
  ok("2 veredictos", planoJun.veredictos.length === 2);

  // 2026-03, as duas ACIMA do piso (medido; regime cms, aqui so a aritmetica).
  const planoMar = montarPlanoPiso(regua, [
    { promoterId: LILIAN, fechamento: 155449.01, diario: 155449.01 },
    { promoterId: MARIA, fechamento: 202113.25, diario: 202113.25 },
  ]);
  ok(
    "acima do piso: nada zerado",
    planoMar.fatorCreditoByPromoter.get(LILIAN) === 1 &&
      planoMar.fatorSeguroByPromoter.get(LILIAN) === 1 &&
      planoMar.fatorCreditoByPromoter.get(MARIA) === 1
  );

  // =========================================================================
  console.log("\nD) a fronteira: 150.000,00 EXATOS");
  // =========================================================================
  const exato = [
    { promoterId: LILIAN, fechamento: 150000.0, diario: 150000.0 },
    { promoterId: MARIA, fechamento: 150000.0, diario: 150000.0 },
  ];
  ok(
    "MENOR_QUE: o valor exato do piso PAGA",
    montarPlanoPiso(regua, exato).fatorCreditoByPromoter.get(LILIAN) === 1
  );
  const reguaLE = parseReguaPiso(comRegra({ comparacao: "MENOR_OU_IGUAL" }));
  ok(
    "MENOR_OU_IGUAL: o valor exato do piso ZERA",
    montarPlanoPiso(reguaLE, exato).fatorCreditoByPromoter.get(LILIAN) === 0
  );
  // 2026-05 medido: LILIAN 150.066,98 — R$ 66,98 acima.
  ok(
    "150.066,98 paga (a folga real de LILIAN em 2026-05)",
    montarPlanoPiso(regua, [
      { promoterId: LILIAN, fechamento: 150066.98, diario: 150066.98 },
      { promoterId: MARIA, fechamento: 0, diario: 0 },
    ]).fatorCreditoByPromoter.get(LILIAN) === 1
  );

  // =========================================================================
  console.log("\nE) float nao decide dinheiro");
  // =========================================================================
  const sujo = 149999.99999999997; // o que uma soma de numeric(18,2) produz
  ok("float sujo != 150000 antes do round", sujo !== 150000, String(sujo));
  ok(
    "arredondado para 150.000,00 -> PAGA",
    montarPlanoPiso(regua, [
      { promoterId: LILIAN, fechamento: sujo, diario: sujo },
      { promoterId: MARIA, fechamento: 0, diario: 0 },
    ]).fatorCreditoByPromoter.get(LILIAN) === 1
  );

  // =========================================================================
  console.log("\nF) a BASE e dado — e as duas bases divergem de verdade");
  // =========================================================================
  // Medido em 2026-04: LILIAN fechamento 115.030,26 x diario 137.620,26.
  const abr = [
    { promoterId: LILIAN, fechamento: 115030.26, diario: 137620.26 },
    { promoterId: MARIA, fechamento: 145900.0, diario: 145900.0 },
  ];
  const reguaDiario = parseReguaPiso(comRegra({ base_calculo: "PRODUCAO_VALIDA_DIARIO" }));
  ok(
    "2026-04: as duas bases concordam (as duas abaixo do piso)",
    montarPlanoPiso(regua, abr).fatorCreditoByPromoter.get(LILIAN) === 0 &&
      montarPlanoPiso(reguaDiario, abr).fatorCreditoByPromoter.get(LILIAN) === 0
  );
  // Mesma DIFERENCA medida (22.590,00), deslocada para cima do piso: agora a
  // escolha da base MUDA o pagamento.
  const emVolta = [
    { promoterId: LILIAN, fechamento: 140000.0, diario: 162590.0 },
    { promoterId: MARIA, fechamento: 0, diario: 0 },
  ];
  ok(
    "em volta dos 150k as bases DIVERGEM: fechamento zera, diario paga",
    montarPlanoPiso(regua, emVolta).fatorCreditoByPromoter.get(LILIAN) === 0 &&
      montarPlanoPiso(reguaDiario, emVolta).fatorCreditoByPromoter.get(LILIAN) === 1
  );
  ok(
    "o veredicto registra QUAL base decidiu",
    montarPlanoPiso(regua, emVolta).veredictos[0].baseCalculo === "PRODUCAO_LIQUIDA_FECHAMENTO" &&
      montarPlanoPiso(regua, emVolta).veredictos[0].producao === 140000.0
  );

  // =========================================================================
  console.log("\nG) fail-loud: alcancado sem producao consolidada LANCA");
  // =========================================================================
  const msgSemProd = lancou(() =>
    montarPlanoPiso(regua, [{ promoterId: LILIAN, fechamento: 10, diario: 10 }])
  );
  ok(
    "falta MARIA na lista -> lanca (nao vira zero por ignorancia)",
    !!msgSemProd && msgSemProd.includes(MARIA),
    msgSemProd
  );

  // =========================================================================
  console.log("\nH) vigencia");
  // =========================================================================
  const dbUmaRegua = { [PISO_TABELA]: [LINHA_SEEDADA], promoters: PROMOTERS_OK };
  const sbUma = fakeSupabase(dbUmaRegua);
  const vig = await resolverReguaPisoVigente(sbUma, { year: 2026, month: 8 });
  ok("2026-08 resolve a regua", !!vig && vig.piso === 150000);
  ok(
    "2026-07 (antes do inicio) devolve null",
    (await resolverReguaPisoVigente(sbUma, { year: 2026, month: 7 })) === null
  );
  ok("competenciaParaData(2026,8) = 2026-08-01", competenciaParaData(2026, 8) === "2026-08-01");

  const encerrada = { ...LINHA_SEEDADA, id: "encerrada", competencia_fim: "2026-09-01" };
  const sbEncerrada = fakeSupabase({ [PISO_TABELA]: [encerrada], promoters: PROMOTERS_OK });
  ok(
    "vigencia encerrada em 2026-09 nao alcanca 2026-10",
    (await resolverReguaPisoVigente(sbEncerrada, { year: 2026, month: 10 })) === null
  );
  ok(
    "vigencia encerrada em 2026-09 AINDA alcanca 2026-09",
    !!(await resolverReguaPisoVigente(sbEncerrada, { year: 2026, month: 9 }))
  );

  const sbDuas = fakeSupabase({
    [PISO_TABELA]: [LINHA_SEEDADA, { ...LINHA_SEEDADA, id: "regua-2", competencia_inicio: "2026-06-01" }],
    promoters: PROMOTERS_OK,
  });
  const msgDuas = await lancouAsync(() => resolverReguaPisoVigente(sbDuas, { year: 2026, month: 8 }));
  ok("duas vigencias abertas LANCAM", !!msgDuas && /SIMULTANEAS/.test(msgDuas), msgDuas);

  const sbErro = fakeSupabase(dbUmaRegua, { [PISO_TABELA]: "permission denied" });
  ok(
    "erro de leitura LANCA (nao vira 'sem regua')",
    !!(await lancouAsync(() => resolverReguaPisoVigente(sbErro, { year: 2026, month: 8 })))
  );

  ok(
    "competenciaExigePiso: true em 2026-08",
    (await competenciaExigePiso(sbUma, { year: 2026, month: 8 })) === true
  );
  ok(
    "competenciaExigePiso: false em 2026-07",
    (await competenciaExigePiso(sbUma, { year: 2026, month: 7 })) === false
  );

  // =========================================================================
  console.log("\nI) sem FK, mas sem silencio");
  // =========================================================================
  const sbIdErrado = fakeSupabase({
    [PISO_TABELA]: [LINHA_SEEDADA],
    promoters: [{ id: LILIAN }], // MARIA nao existe
  });
  const msgFk = await lancouAsync(() => resolverReguaPisoVigente(sbIdErrado, { year: 2026, month: 8 }));
  ok(
    "promoter_id inexistente no scope LANCA",
    !!msgFk && msgFk.includes(MARIA) && /FK/.test(msgFk),
    msgFk
  );

  // =========================================================================
  console.log("\nJ) contrato de injecao (o fail-loud dos consolidadores)");
  // =========================================================================
  ok(
    "sem regua: nao lanca",
    !lancou(() =>
      assertPisoInjetado({ funcao: "consolidateMonthlyFromClosing", year: 2026, month: 8, temRegua: false, fatorInjetado: false })
    )
  );
  ok(
    "com regua E com fator: nao lanca",
    !lancou(() =>
      assertPisoInjetado({ funcao: "consolidateMonthlyFromClosing", year: 2026, month: 8, temRegua: true, fatorInjetado: true })
    )
  );
  const msgContrato = lancou(() =>
    assertPisoInjetado({ funcao: "consolidateMonthlyFromClosing", year: 2026, month: 8, temRegua: true, fatorInjetado: false })
  );
  ok(
    "com regua e SEM fator: LANCA apontando o orquestrador",
    !!msgContrato && /consolidateMonthlyGroup/.test(msgContrato) && /2026-08/.test(msgContrato),
    msgContrato
  );

  // =========================================================================
  console.log("\nK) no-op: sem regua os mapas saem vazios e o motor le 1");
  // =========================================================================
  const vazio = planoPisoVazio();
  ok("plano vazio nao tem regua", vazio.regua === null);
  ok("mapas vazios", vazio.fatorCreditoByPromoter.size === 0 && vazio.veredictos.length === 0);
  ok(
    "`map.get(pid) ?? 1` = 1 (o que os consolidadores farao)",
    (vazio.fatorCreditoByPromoter.get(LILIAN) ?? 1) === 1
  );
  ok(
    "montarPlanoPiso(null, ...) tambem e no-op",
    montarPlanoPiso(null, []).fatorCreditoByPromoter.size === 0
  );

  // =========================================================================
  console.log("\nL) o piso ainda esta DESLIGADO no caminho de producao");
  // =========================================================================
  // APAGAR ESTE BLOCO no commit que ligar o piso — ele prova o contrario do que
  // aquele commit vai fazer, e um gate que sobrevive a propria premissa vira
  // ruido vermelho.
  const importadores = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (nome === "node_modules" || nome === ".next") continue;
        varrer(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(nome)) continue;
      if (p.endsWith(path.join("lib", "pisoProducao.ts"))) continue;
      if (fs.readFileSync(p, "utf8").includes("pisoProducao")) {
        importadores.push(path.relative(ROOT, p));
      }
    }
  };
  for (const dir of ["lib", "app"]) {
    const alvo = path.join(ROOT, dir);
    if (fs.existsSync(alvo)) varrer(alvo);
  }
  ok(
    "nenhum arquivo de lib/ ou app/ importa lib/pisoProducao",
    importadores.length === 0,
    importadores.join(", ")
  );

  // =========================================================================
  console.log(
    falhas === 0
      ? "\nGATE OK — o leitor do piso esta provado e AINDA nao ligado."
      : `\nGATE REPROVADO — ${falhas} falha(s).`
  );
  process.exit(falhas === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("ERRO INESPERADO:", e);
  process.exit(2);
});
