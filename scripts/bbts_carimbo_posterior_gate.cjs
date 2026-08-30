/*
 * GATE — o fechamento ANTIGO nao sobrescreve a linha que um fechamento
 * POSTERIOR ja carimbou.
 *
 * O CASO. Contrato vendido no fim de maio: a BBTS pagou o CREDITO dele no
 * fechamento de JUNHO e o SEGURO no de MAIO. Maio nunca foi importado. Importar
 * maio agora acharia a linha ja existente — o merge de daily_production_records
 * e por (company_id, proposal_number) e o dono FULL sobrescreve movement_date —
 * e a mesclaria, tirando o dinheiro de junho e a ancora daquele fechamento
 * deixaria de fechar. Medido em 30/08/2026: 255,26 de pagamento a vista e
 * 4.254,32 de producao.
 *
 * A DIVIDA QUE ISTO NAO PAGA. A tabela tem UMA linha por (empresa, proposta) e
 * UM carimbo; nao ha lugar para duas pernas em competencias diferentes. Esta
 * guarda so impede o estrago e devolve o tamanho do que ficou de fora. Ver
 * HANDOFF_ADS_ABRIL_MAIO.md.
 *
 * FIXTURES SINTETICAS: o repo e PUBLICO. Os contratos sao 90000001x e os valores
 * foram inventados; o que se preserva do caso real e a FORMA (uma proposta com
 * seguro nesta competencia e credito ja carimbado na seguinte).
 *
 * PROVA NOS DOIS SENTIDOS:
 *   [4] a guarda EXCLUI (e o dano sem ela e real, medido por ownedColumnsFor);
 *   [5] mutantes: carimbo igual, anterior e NULL NAO acionam — se acionassem, a
 *       guarda estaria barrando o que deve passar;
 *   [6] nenhuma opcao do importador libera a gravacao da proposta bloqueada;
 *   [7] CONTROLE POSITIVO: competencia sem nenhum carimbo posterior passa igual.
 *
 * self-contained: Supabase falso em memoria, importBbtsClosing REAL. Sem banco,
 * sem rede, sem caminho absoluto.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");

const {
  importBbtsClosing,
  BBTS_COMPANY_ID,
  BBTS_MASTER_KEY,
} = require("../lib/bbtsClosingImport.ts");
const {
  propostasAlvoDoFechamento,
  propostasComCarimboPosterior,
  competenciaCarimbo,
  textoRecusaCarimboPosterior,
} = require("../lib/bbts/carimboPosterior.ts");
const { ownedColumnsFor } = require("../lib/dailyRecordMerge.ts");

let falhas = 0;
const ok = (nome, fn) => {
  try { fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};
const okAsync = async (nome, fn) => {
  try { await fn(); console.log("  OK   " + nome); }
  catch (e) { falhas++; console.log("  FALHA " + nome + "\n         " + e.message); }
};

// ---------------------------------------------------------------------------
// Supabase falso: guarda as tabelas em memoria e CAPTURA os upserts por tabela,
// que e o que responde "esta linha chegou ao banco?".
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const upserts = {};
  function builder(nome) {
    const filtros = [];
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "in") return f.val.includes(v);
        return true;
      });
    const linhas = () => (db[nome] || []).filter(casa);
    const api = {
      select: () => api,
      eq(col, val) { filtros.push({ op: "eq", col, val }); return api; },
      in(col, val) { filtros.push({ op: "in", col, val }); return api; },
      is() { return api; },
      not() { return api; },
      or() { return api; },
      order: () => api,
      limit: () => api,
      range(from, to) { return Promise.resolve({ data: linhas().slice(from, to + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: linhas()[0] ?? { id: "import-falso" }, error: null }); },
      upsert(rows) {
        (upserts[nome] = upserts[nome] || []).push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve({ data: null, error: null });
      },
      insert() { return api; },
      update() { return api; },
      delete() { return { in: () => Promise.resolve({ data: null, error: null }) }; },
      then(resolve, reject) { return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject); },
    };
    return api;
  }
  return { from: (nome) => builder(nome), __upserts: upserts };
}

// ---------------------------------------------------------------------------
// CENARIO. Competencia entrando: 05/2026.
//   900000010 — SO seguro neste PDF; ja existe no banco carimbada em 06/2026,
//               carregando o dinheiro do fechamento de junho. E a bloqueada.
//   900000011 — credito + seguro, nao existe no banco. Entra.
//   900000012 — so credito, nao existe no banco. Entra.
// ---------------------------------------------------------------------------
const BLOQUEADA = "900000010";
const AVISTA_JUNHO = 255.26;
const BRUTO_JUNHO = 4254.32;

const linhaJaNoBanco = (carimbo) => ({
  id: "linha-existente",
  company_id: BBTS_COMPANY_ID,
  proposal_number: BLOQUEADA,
  bbts_competencia_fechamento: carimbo,
  movement_date: "2026-06-15",
  proposal_date: "2026-05-29",
  bbts_pag_avista: AVISTA_JUNHO,
  bbts_seguro_pago: 0,
  gross_value: BRUTO_JUNHO,
  assigned_promoter_id: "promotor-falso",
  original_promoter_id: "promotor-falso",
  promoter_source: "MANUAL_REASSIGNMENT",
  raw_payload: {},
});

const creditoRow = (contrato, pagAvista, vfin) => ({
  contrato,
  valor_financiado: vfin,
  pag_avista: pagAvista,
  data: "20/05/2026",
  taxa_relatorio: 2.87,
  srcc_cd: 2,
  chave_j: BBTS_MASTER_KEY,
  produto: "Consignado Novo",
  linha_credito: "Credito Novo",
  categoria: "INSS Novo",
  segmento: "PUBLICO",
  nr_convenio: "1640",
  juros_mensal: 1.85,
  parcelas: 96,
  prazo_operacao: 96,
  cancelamento: false,
});
const seguroRow = (contrato, valor, base) => ({
  contrato,
  valor_total_credito: base,
  tipo: "ESTOQUE D0",
  valor_seguro: valor,
  tratamento: "calculo",
});

const CREDITO = [creditoRow("900000011", 40, 4000), creditoRow("900000012", 60, 6000)];
const SEGURO = [seguroRow(BLOQUEADA, 4.25, BRUTO_JUNHO), seguroRow("900000011", 4, 4000)];

const inputMaio = () => ({
  year: 2026,
  month: 5,
  credito: JSON.parse(JSON.stringify(CREDITO)),
  seguro: JSON.parse(JSON.stringify(SEGURO)),
  prt: [],
  cabecalho: { rotulos: [], pagamentoAvt: 100, pagamentoPrt: 0, aberturaConta: 0, outrasDeducoes: 0, pagamentoTotal: 100 },
  seguro_pdf_ausente: false,
  _ancoras: {
    credito_propostas: 2,
    credito_valor_financiado: 10000,
    credito_pag_avista: 100,
    seguro_calculo: 8.25,
    seguro_total: 8.25,
    prt_valor: 0,
  },
});

const bancoCom = (linhas) => ({
  daily_production_records: linhas,
  j_keys: [{ j_key: BBTS_MASTER_KEY, promoter_id: null, key_type: "MASTER", active: true }],
  companies: [{ id: BBTS_COMPANY_ID, name: "ADS FIXTURE" }],
  bbts_rule_versions: [],
  daily_imports: [{ id: "import-falso" }],
});

/**
 * Roda o import REAL contra o banco falso e devolve o que chegou ao dpr.
 *
 * `dryRun: false` E OBRIGATORIO AQUI, e a primeira versao deste gate esqueceu:
 * `importBbtsClosing` roda em DRY-RUN POR PADRAO (opts?.dryRun !== false), entao
 * sem isto nenhuma linha era gravada e a secao [6] passava por VACUIDADE —
 * "a bloqueada nao foi gravada" era verdade porque NADA era gravado. As
 * assercoes de anti-vacuidade abaixo existem para que isso nao volte calado.
 */
async function rodarImport(linhasNoBanco, opts) {
  const sb = fakeSupabase(bancoCom(linhasNoBanco));
  const res = await importBbtsClosing(
    sb,
    inputMaio(),
    Object.assign({ dryRun: false, fileName: "fixture.pdf" }, opts || {})
  );
  const gravadas = (sb.__upserts["daily_production_records"] || []).map((r) => String(r.proposal_number));
  return { res, gravadas };
}

(async () => {
  console.log("GATE: fechamento antigo nao sobrescreve carimbo posterior\n");

  // =========================================================================
  console.log("[1] o conjunto ALVO inclui o seguro SEM credito no mes");
  // -------------------------------------------------------------------------
  // A bloqueada esta so no seguro. Um predicado que olhasse so o credito nao a
  // pegaria — e o dano aconteceria do mesmo jeito, pela linha SO-SEGURO.
  ok("propostasAlvoDoFechamento pega credito UNIAO seguro 'calculo'", () => {
    const alvo = propostasAlvoDoFechamento({ credito: CREDITO, seguro: SEGURO });
    assert.deepEqual([...alvo].sort(), ["900000010", "900000011", "900000012"]);
  });
  ok("seguro 'debito' (CANCELADO) NAO entra no alvo (vira debito, nao producao)", () => {
    const alvo = propostasAlvoDoFechamento({
      credito: [],
      seguro: [{ contrato: "900000099", tratamento: "debito" }],
    });
    assert.deepEqual(alvo, []);
  });

  // =========================================================================
  console.log("\n[2] o predicado, isolado");
  // -------------------------------------------------------------------------
  await okAsync("acha a proposta carimbada em competencia POSTERIOR", async () => {
    const sb = fakeSupabase(bancoCom([linhaJaNoBanco("2026-06-01")]));
    const r = await propostasComCarimboPosterior(sb, {
      companyId: BBTS_COMPANY_ID, year: 2026, month: 5,
      propostas: ["900000010", "900000011", "900000012"],
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].proposal_number, BLOQUEADA);
    assert.equal(r[0].carimbo_existente, "2026-06-01");
    assert.equal(r[0].competencia_entrando, "2026-05-01");
    assert.equal(r[0].bbts_pag_avista, AVISTA_JUNHO);
    assert.equal(r[0].gross_value, BRUTO_JUNHO);
  });
  await okAsync("a guarda LANCA quando nao pode ser avaliada (coluna ausente)", async () => {
    const sb = fakeSupabase(bancoCom([]));
    const original = sb.from;
    sb.from = (nome) => {
      if (nome !== "daily_production_records") return original(nome);
      const erro = { message: 'column daily_production_records.bbts_competencia_fechamento does not exist' };
      const api = { select: () => api, eq: () => api, in: () => Promise.resolve({ data: null, error: erro }) };
      return api;
    };
    let e = null;
    try {
      await propostasComCarimboPosterior(sb, { companyId: BBTS_COMPANY_ID, year: 2026, month: 5, propostas: ["900000010"] });
    } catch (err) { e = err; }
    assert.ok(e, "NAO lancou — ausencia de medicao teria virado aprovacao");
    assert.match(e.message, /migration 20260830_000001|nao pode ser avaliada/i);
  });

  // =========================================================================
  console.log("\n[3] a recusa diz o DANO EM NUMEROS");
  // -------------------------------------------------------------------------
  ok("o texto traz contrato, carimbo existente e os valores que seriam movidos", () => {
    const txt = textoRecusaCarimboPosterior({
      competencia: "2026-05-01",
      empresa: "ADS FIXTURE",
      totalAlvo: 3,
      campoConfirmacao: "confirmarPularCarimboPosterior",
      bloqueadas: [{
        proposal_number: BLOQUEADA, carimbo_existente: "2026-06-01",
        competencia_entrando: "2026-05-01", bbts_pag_avista: AVISTA_JUNHO,
        bbts_seguro_pago: 0, gross_value: BRUTO_JUNHO,
        movement_date: "2026-06-15", promoter_source: "MANUAL_REASSIGNMENT",
      }],
    });
    assert.match(txt, /RECUSADO/);
    assert.match(txt, /2026-05-01/);          // competencia entrando
    assert.match(txt, /ADS FIXTURE/);          // empresa
    assert.match(txt, new RegExp(BLOQUEADA));  // contrato
    assert.match(txt, /2026-06-01/);           // carimbo que ela ja tem
    assert.match(txt, /255,26/);               // valor movido
    assert.match(txt, /4\.254,32/);
    assert.match(txt, /1 de 3 proposta/);      // quantas ficariam de fora
    assert.match(txt, /confirmarPularCarimboPosterior=true/);
    // e o ponto que nao pode faltar: a confirmacao NAO grava a proposta.
    assert.match(txt, /NAO grava estas propostas/i);
  });

  // =========================================================================
  console.log("\n[4] a guarda EXCLUI — e o dano SEM ela e real");
  // -------------------------------------------------------------------------
  await okAsync("com carimbo posterior, a proposta NAO chega ao daily_production_records", async () => {
    const { res, gravadas } = await rodarImport([linhaJaNoBanco("2026-06-01")]);
    assert.equal(res.ancora_ok, true, "a ancora tinha de fechar — o cenario e valido");
    assert.equal(res.puladas_carimbo_posterior.length, 1);
    assert.equal(res.puladas_carimbo_posterior[0].proposal_number, BLOQUEADA);
    assert.ok(gravadas.length > 0, "NADA foi gravado — a assercao passaria por vacuidade");
    assert.ok(!gravadas.includes(BLOQUEADA), "a bloqueada FOI gravada — a guarda nao excluiu");
    assert.ok(gravadas.includes("900000011"), "o resto tinha de entrar");
    assert.ok(gravadas.includes("900000012"), "o resto tinha de entrar");
  });
  ok("SEM a guarda o estrago seria real: o dono FULL sobrescreve as 3 colunas do dano", () => {
    // Nao ha como 'desligar' a guarda por opcao — entao o dano se prova pelo
    // outro lado: as colunas que moveriam a linha SAO do dono FULL, logo o merge
    // as escreveria. Se um dia deixarem de ser, esta assercao cai e alguem
    // precisa reavaliar se a guarda ainda e necessaria.
    const rec = { company_id: BBTS_COMPANY_ID, proposal_number: BLOQUEADA, movement_date: "2026-05-15", gross_value: 0, bbts_pag_avista: 0, bbts_competencia_fechamento: "2026-05-01" };
    const owned = ownedColumnsFor("FULL", rec);
    for (const col of ["movement_date", "gross_value", "bbts_pag_avista", "bbts_competencia_fechamento"]) {
      assert.ok(owned.includes(col), `${col} NAO e do dono FULL — reavaliar a guarda`);
    }
  });
  await okAsync("a ANCORA continua saindo do PDF, nao do que sobrou apos a exclusao", async () => {
    // Se a exclusao entrasse na conta da ancora, ela fecharia sobre um documento
    // que nao e o que esta em disco — a conferencia viraria autoendosso.
    const { res } = await rodarImport([linhaJaNoBanco("2026-06-01")]);
    assert.equal(res.ancora_detalhe.seguro_calculo.obtido, 8.25, "a ancora do seguro perdeu a linha excluida");
    assert.equal(res.propostas, 2);
  });

  // =========================================================================
  console.log("\n[5] MUTANTES — o que NAO pode acionar a guarda");
  // -------------------------------------------------------------------------
  const naoAciona = async (rotulo, carimbo) => {
    await okAsync(rotulo, async () => {
      const { res, gravadas } = await rodarImport([linhaJaNoBanco(carimbo)]);
      assert.equal(res.puladas_carimbo_posterior.length, 0, "a guarda acionou onde NAO devia");
      assert.ok(gravadas.includes(BLOQUEADA), "a proposta deveria ter sido gravada");
    });
  };
  await naoAciona("carimbo IGUAL a competencia entrando NAO aciona (o predicado e '>', nao '>=')", "2026-05-01");
  await naoAciona("carimbo ANTERIOR NAO aciona (reimportar competencia velha e legitimo)", "2026-04-01");
  await naoAciona("carimbo NULL NAO aciona — o BURACO NOMEADO da guarda", null);
  ok("o buraco do NULL esta NOMEADO no codigo, nao so no handoff", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(require("node:path").join(__dirname, "..", "lib", "bbts", "carimboPosterior.ts"), "utf8");
    assert.match(src, /O BURACO DESTA GUARDA/, "o bloco que nomeia o buraco sumiu do modulo");
    assert.match(src, /NULL nao e "posterior"/, "a regra do NULL deixou de estar escrita");
  });

  // =========================================================================
  console.log("\n[6] NENHUMA opcao do importador libera a gravacao da bloqueada");
  // -------------------------------------------------------------------------
  // A confirmacao vive na ROTA e so libera o 409. O importador nao tem — e nao
  // pode ganhar — um caminho que grave a proposta bloqueada.
  const OPCOES = [
    ["padrao", {}],
    ["dryRun:false explicito", { dryRun: false }],
    ["com o nome da confirmacao da rota passado como opcao", { confirmarPularCarimboPosterior: true }],
    ["com uma flag generica de forcar", { force: true, overwrite: true }],
    ["com tolerancia frouxa", { tolerance: 999 }],
  ];
  for (const par of OPCOES) {
    await okAsync(`opcao '${par[0]}' NAO grava a bloqueada`, async () => {
      const { res, gravadas } = await rodarImport([linhaJaNoBanco("2026-06-01")], par[1]);
      // ANTI-VACUIDADE: "a bloqueada nao foi gravada" so significa alguma coisa
      // se o import TIVER gravado. Sem isto, dry-run silencioso faz tudo passar.
      assert.ok(gravadas.length > 0, "NADA foi gravado — a assercao passaria por vacuidade");
      assert.ok(!gravadas.includes(BLOQUEADA), "a bloqueada foi gravada — existe caminho de bypass");
      assert.equal(res.puladas_carimbo_posterior.length, 1);
    });
  }
  ok("a rota chama a guarda ANTES de importBbtsClosing, e o campo e '=== true'", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const src = fs.readFileSync(path.join(__dirname, "..", "app", "api", "import", "closing", "ads", "route.ts"), "utf8");
    const iGuarda = src.indexOf("propostasComCarimboPosterior");
    const iImport = src.indexOf("await importBbtsClosing");
    assert.ok(iGuarda > 0 && iImport > 0, "a rota nao chama mais a guarda ou o import");
    assert.ok(iGuarda < iImport, "a guarda passou a rodar DEPOIS do import — a recusa chegaria tarde");
    assert.match(src, /body\[CAMPO_CONFIRMACAO\] !== true/, "a confirmacao deixou de ser '=== true' literal");
    assert.match(src, /status: 409/, "a recusa deixou de ser 409");
    assert.ok(!/process\.env\.[A-Z_]*CARIMBO/.test(src), "a confirmacao virou variavel de ambiente");
  });

  // =========================================================================
  console.log("\n[7] CONTROLE POSITIVO — competencia limpa passa igual");
  // -------------------------------------------------------------------------
  await okAsync("banco VAZIO: nenhuma recusa, as 3 propostas entram", async () => {
    const { res, gravadas } = await rodarImport([]);
    assert.equal(res.puladas_carimbo_posterior.length, 0);
    assert.equal(res.ancora_ok, true);
    for (const c of ["900000010", "900000011", "900000012"]) {
      assert.ok(gravadas.includes(c), `${c} nao entrou numa competencia sem bloqueio`);
    }
  });
  await okAsync("linha existente de OUTRA proposta nao atrapalha", async () => {
    const outra = Object.assign(linhaJaNoBanco("2026-06-01"), { proposal_number: "900000099" });
    const { res, gravadas } = await rodarImport([outra]);
    assert.equal(res.puladas_carimbo_posterior.length, 0);
    assert.ok(gravadas.includes(BLOQUEADA));
  });
  ok("ANTI-VACUIDADE: o cenario do [4] e o do [7] diferem SO pelo carimbo", () => {
    // Se os dois cenarios fossem iguais, [4] passaria por acidente. A unica
    // diferenca entre eles e a linha pre-existente e o seu carimbo.
    const comBloqueio = bancoCom([linhaJaNoBanco("2026-06-01")]);
    const limpo = bancoCom([]);
    assert.equal(comBloqueio.daily_production_records.length, 1);
    assert.equal(limpo.daily_production_records.length, 0);
    assert.deepEqual(
      propostasAlvoDoFechamento(inputMaio()).sort(),
      ["900000010", "900000011", "900000012"]
    );
  });

  console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
  process.exit(falhas === 0 ? 0 : 1);
})();
