/*
 * GATE — O OVERRIDE DE VIGENCIA E O ANTEPARO DO BURACO (Fase 3, bloco 2).
 * 01/09/2026. READ-ONLY e SELF-CONTAINED: sem banco, sem env, sem PDF.
 *
 * POR QUE ELE EXISTE. Este e o unico ponto da frente da vigencia intra-mes capaz
 * de DERRUBAR PRODUCAO. Subir uma regua com override numa competencia que ainda
 * nao tem regua deixa o inicio do mes DESCOBERTO; o resolvedor lanca
 * TrpVigenciaGapError no primeiro contrato daquele pedaco e ele PROPAGA de
 * proposito — /promotores, /recebiveis e o motor caem. E o banco NAO cobre isso:
 * o ex_trp_vigencia_sem_overlap recusa fatias que se CRUZAM; buraco nao cruza
 * nada e passa liso. O EXCLUDE pega sobreposicao, nunca ausencia.
 *
 * BLOCOS
 *   1) A REGUA DE DATAS (validarOverrideNaJanela) + MUTACAO do `>` estrito.
 *   2) CAMINHO FELIZ: override valido -> o RPC recebe p_valid_from = OVERRIDE.
 *   3) O ANTEPARO (5.1): as 3 recusas de ESTADO + MUTACAO "sem anteparo", que
 *      prova que sem ele a chamada CHEGA ao RPC e o buraco nasce.
 *   4) CONTROLE POSITIVO: sem override, byte-identico ao de hoje — mesmos 11
 *      parametros, p_valid_from = janela derivada, e ZERO leitura extra.
 *   5) O FLUXO DELEGADO LE DO STAGING, nao do body + MUTACAO.
 *   6) A coluna atravessa staging (POST/GET) e a tela.
 */
require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  validarOverrideNaJanela,
  vigenciaDaCompetencia,
  subtraiUmDia,
} = require("../lib/trp/vigencia.ts");
const { commitTrpVersion } = require("../lib/trp/commitVersion.ts");
const { EXPECTED_PRODUCTS, TrpValidationError } = require("../lib/trp/parseTrpDraft.ts");

let falhas = 0;
function ok(cond, nome, det) {
  if (!cond) falhas += 1;
  console.log(`  ${cond ? "OK " : "XX "} ${nome}${det ? ` — ${det}` : ""}`);
}
const eq = (nome, got, want) => ok(got === want, nome, `got=${got} want=${want}`);
const linha = (c) => c.repeat(72);

const COMP = "2026-08";
const JAN = vigenciaDaCompetencia(COMP); // 2026-07-31 .. 2026-08-28
const OVER = "2026-08-05"; // a TRP39
const SOCIO = "50c10000-0000-4000-8000-000000000001";

/** Draft minimo VALIDO (11 produtos, 1 pct plausivel cada). Sem fixture em disco. */
function draftValido() {
  const d = { _meta: { regime: "VOLUME_5_FAIXAS", competencia: COMP } };
  for (const k of EXPECTED_PRODUCTS) d[k] = { celulas: [{ "Faixa 1": 0.05 }] };
  return d;
}

/**
 * Stub de Supabase: serve trp_rule_versions e captura a chamada do RPC.
 * `leiturasVersoes` conta quantas vezes o modulo consultou a tabela — e o que
 * prova que o caminho SEM override nao ganhou I/O nenhum.
 */
function stub(fatiasAtivas) {
  const st = { rpcCalls: [], leiturasVersoes: 0 };
  const sb = {
    from(tabela) {
      if (tabela === "trp_rule_versions") st.leiturasVersoes += 1;
      // HONRA o .order() que o modulo pede, na ordem em que ele pede — um stub
      // que ignora o order mede o STUB, nao o codigo. Foi o que aconteceu na 1a
      // versao deste gate: a recusa (c1) passou verde porque fatias[0] caiu na
      // fatia errada. O conserto foi no CODIGO (o maximo agora e calculado la),
      // e o fixture abaixo entrega as fatias na ordem ERRADA de proposito.
      const ordens = [];
      const q = {
        select: () => q,
        eq: () => q,
        order: (col, opts) => {
          ordens.push([col, opts && opts.ascending === true ? 1 : -1]);
          return q;
        },
        then: (resolve) => {
          let rows = (fatiasAtivas || []).slice();
          for (const [col, dir] of [...ordens].reverse()) {
            rows.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc(nome, params) {
      st.rpcCalls.push({ nome, params });
      return Promise.resolve({
        data: {
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          competencia: `${COMP}-01`,
          regime: params.p_regime,
          valid_from: params.p_valid_from,
          valid_until: params.p_valid_until,
          version_no: 2,
          is_active: true,
          uploaded_at: "2026-09-01T00:00:00.000Z",
        },
        error: null,
      });
    },
  };
  return { sb, st };
}

const FATIA_TRP38 = [
  { id: "38", version_no: 1, valid_from: JAN.validFrom, valid_until: JAN.validUntil },
];

async function tentar(input, fatias) {
  const { sb, st } = stub(fatias);
  try {
    const row = await commitTrpVersion(
      { competencia: COMP, regraJson: draftValido(), uploadedBy: SOCIO, ...input },
      sb,
    );
    return { ok: true, row, st };
  } catch (e) {
    return { ok: false, erro: e, st };
  }
}

console.log("===== GATE — override de vigencia + anteparo do buraco =====\n");

(async () => {
  // ============================================================== BLOCO 1
  console.log("1) A REGUA DE DATAS (validarOverrideNaJanela)");
  console.log(linha("-"));
  ok(JAN.validFrom === "2026-07-31" && JAN.validUntil === "2026-08-28",
    "a janela holiday-aware de 2026-08 e 31/07 a 28/08", `${JAN.validFrom}..${JAN.validUntil}`);

  eq("override valido (05/08) -> ACEITA", validarOverrideNaJanela(COMP, OVER).ok, true);
  const igual = validarOverrideNaJanela(COMP, JAN.validFrom);
  eq("override IGUAL ao inicio -> RECUSA", igual.ok, false);
  ok(/nao PARTE|não PARTE/.test(igual.motivo), "e o motivo diz que nao parte nada", igual.motivo);
  eq("override ANTES da janela -> RECUSA", validarOverrideNaJanela(COMP, "2026-07-30").ok, false);
  eq("override DEPOIS da janela -> RECUSA", validarOverrideNaJanela(COMP, "2026-08-29").ok, false);
  eq("ultimo dia da janela ainda ACEITA", validarOverrideNaJanela(COMP, JAN.validUntil).ok, true);
  eq("data inexistente no calendario -> RECUSA", validarOverrideNaJanela(COMP, "2026-02-31").ok, false);
  eq("formato invalido -> RECUSA", validarOverrideNaJanela(COMP, "05/08/2026").ok, false);

  // MUTACAO: `>=` no lugar do `>` estrito (aceitar o proprio inicio da janela).
  const mutanteNaoEstrito = (comp, ov) => {
    const j = vigenciaDaCompetencia(comp);
    return { ok: ov >= j.validFrom && ov <= j.validUntil };
  };
  ok(
    mutanteNaoEstrito(COMP, JAN.validFrom).ok !== validarOverrideNaJanela(COMP, JAN.validFrom).ok,
    "MUTACAO: sem o `>` estrito o inicio da janela seria ACEITO — vereditos divergem",
    `mutante=${mutanteNaoEstrito(COMP, JAN.validFrom).ok} real=${validarOverrideNaJanela(COMP, JAN.validFrom).ok}`
  );
  ok(
    mutanteNaoEstrito(COMP, OVER).ok === validarOverrideNaJanela(COMP, OVER).ok,
    "CONTROLE: no caso VALIDO os dois concordam (a mutacao so muda a fronteira)",
    `${OVER}`
  );

  // ============================================================== BLOCO 2
  console.log("\n2) CAMINHO FELIZ — o RPC recebe p_valid_from = OVERRIDE");
  console.log(linha("-"));
  {
    const r = await tentar({ validFromOverride: OVER }, FATIA_TRP38);
    ok(r.ok, "commitTrpVersion PASSA com override valido e fatia ativa cobrindo o inicio",
      r.ok ? "" : `${r.erro && r.erro.message}`);
    const p = r.st.rpcCalls[0] && r.st.rpcCalls[0].params;
    eq("chamou o RPC exatamente 1x", r.st.rpcCalls.length, 1);
    eq("p_valid_from = o OVERRIDE (nao a janela)", p && p.p_valid_from, OVER);
    eq("p_valid_until = o FIM da janela", p && p.p_valid_until, JAN.validUntil);
    ok(p && p.p_valid_from !== JAN.validFrom,
      "e NAO e o inicio da janela — e isso que faz o RPC PARTIR em vez de SUBSTITUIR",
      `${p && p.p_valid_from} != ${JAN.validFrom}`);
    ok(r.st.leiturasVersoes === 1,
      "leu trp_rule_versions 1x (o anteparo), nao mais que isso", `${r.st.leiturasVersoes}`);
  }

  // ============================================================== BLOCO 3
  console.log("\n3) O ANTEPARO DO BURACO (5.1) — as 3 recusas de ESTADO");
  console.log(linha("-"));
  {
    // (a) competencia SEM regua nenhuma: e o caso que o RPC nao ve (para ele e a
    //     SAIDA 0, que insere sem perguntar).
    const semFatia = await tentar({ validFromOverride: OVER }, []);
    ok(!semFatia.ok, "SEM fatia ativa -> RECUSA");
    ok(semFatia.erro instanceof TrpValidationError,
      "e recusa com TrpValidationError (a rota converte em 422, nada gravado)",
      semFatia.erro && semFatia.erro.name);
    eq("e o RPC NAO foi chamado", semFatia.st.rpcCalls.length, 0);
    ok(String(semFatia.erro.detalhe || "").includes(subtraiUmDia(OVER)),
      "a mensagem nomeia o pedaco que ficaria sem regua",
      `${JAN.validFrom} a ${subtraiUmDia(OVER)}`);

    // (b) ha fatia ativa, mas ela NAO cobre o inicio da janela (ja comeca depois).
    const naoCobre = await tentar({ validFromOverride: "2026-08-20" }, [
      { id: "x", version_no: 1, valid_from: "2026-08-10", valid_until: JAN.validUntil },
    ]);
    ok(!naoCobre.ok, "fatia ativa que NAO cobre o inicio da janela -> RECUSA");
    eq("e o RPC NAO foi chamado", naoCobre.st.rpcCalls.length, 0);

    // (c1) override ANTERIOR ao inicio da ultima fatia (o RPC recusaria; aqui a
    //      mensagem explica).
    // ORDEM DE ENTRADA DELIBERADAMENTE ERRADA (a fatia ANTIGA primeiro): e o que
    // o Postgres devolveria sem ORDER BY. Se o codigo tomasse fatias[0] em vez de
    // calcular o maximo, ele compararia contra a fatia de 31/07 e APROVARIA.
    const fixturePartida = [
      { id: "a", version_no: 1, valid_from: JAN.validFrom, valid_until: "2026-08-04" },
      { id: "b", version_no: 2, valid_from: "2026-08-05", valid_until: JAN.validUntil },
    ];
    const anterior = await tentar({ validFromOverride: "2026-08-03" }, fixturePartida);
    ok(!anterior.ok, "override ANTERIOR a fatia ativa mais recente -> RECUSA (competencia ja partida)");
    eq("e o RPC NAO foi chamado", anterior.st.rpcCalls.length, 0);
    ok(String(anterior.erro && anterior.erro.detalhe || "").includes("2026-08-05"),
      "e a recusa cita a fatia CERTA (a de 05/08), nao a primeira da lista",
      String(anterior.erro && anterior.erro.detalhe || "").slice(0, 60));

    // MUTACAO: tomar fatias[0] em vez do maximo. Com o MESMO fixture (ordem
    // errada), o mutante compara contra 31/07 e deixa passar.
    const mutanteUltima = fixturePartida[0];
    const realUltima = fixturePartida.reduce((a, b) => (b.valid_from > a.valid_from ? b : a));
    ok(mutanteUltima.valid_from !== realUltima.valid_from,
      "MUTACAO: fatias[0] e a fatia ERRADA neste fixture — o `>` da recusa mudaria de lado",
      `mutante=${mutanteUltima.valid_from} real=${realUltima.valid_from}`);
    ok("2026-08-03" > mutanteUltima.valid_from && "2026-08-03" <= realUltima.valid_from,
      "e com ela o override de 03/08 seria APROVADO — reescrevendo regua viva por baixo de outra");

    // (c2) override DEPOIS do fim da ultima fatia: buraco no MEIO do mes.
    const depois = await tentar({ validFromOverride: "2026-08-20" }, [
      { id: "a", version_no: 1, valid_from: JAN.validFrom, valid_until: "2026-08-10" },
    ]);
    ok(!depois.ok, "override alem do FIM da fatia ativa -> RECUSA (buraco no meio do mes)");
    eq("e o RPC NAO foi chamado", depois.st.rpcCalls.length, 0);

    // MUTACAO: "sem anteparo" — o commit de 31/08 com o p_valid_from trocado e
    // NENHUMA conferencia de estado. TEM de chegar ao RPC e abrir o buraco.
    const { sb: sbMut, st: stMut } = stub([]);
    await sbMut.rpc("trp_commit_version", {
      p_competencia: `${COMP}-01`,
      p_regime: "VOLUME_5_FAIXAS",
      p_valid_from: OVER, // sem conferir se alguem cobre 31/07..04/08
      p_valid_until: JAN.validUntil,
    });
    eq("MUTACAO sem anteparo: a chamada CHEGA ao RPC", stMut.rpcCalls.length, 1);
    eq("com o anteparo, a MESMA entrada nao chega", semFatia.st.rpcCalls.length, 0);
    ok(
      stMut.rpcCalls[0].params.p_valid_from > JAN.validFrom,
      "e o buraco seria real: a unica fatia comecaria em " + OVER + ", depois do inicio da janela " +
        JAN.validFrom + " — os dias " + JAN.validFrom + " a " + subtraiUmDia(OVER) + " sem regua",
    );
  }

  // ============================================================== BLOCO 4
  console.log("\n4) CONTROLE POSITIVO — SEM override, byte-identico ao de hoje");
  console.log(linha("-"));
  {
    const r = await tentar({}, FATIA_TRP38);
    ok(r.ok, "commitTrpVersion PASSA sem override");
    const p = r.st.rpcCalls[0] && r.st.rpcCalls[0].params;
    eq("p_valid_from = a janela DERIVADA", p && p.p_valid_from, JAN.validFrom);
    eq("p_valid_until = o fim da janela", p && p.p_valid_until, JAN.validUntil);
    eq("ZERO leitura de trp_rule_versions (nenhum I/O novo no caminho de sempre)",
      r.st.leiturasVersoes, 0);
    const chaves = Object.keys(p).sort().join(",");
    eq("os 11 parametros do RPC, os MESMOS de sempre (nenhum novo)", chaves,
      "p_competencia,p_notes,p_parser_version,p_regime,p_regra_json,p_source_filename," +
      "p_source_sha256,p_trp_doc_ref,p_uploaded_by,p_valid_from,p_valid_until");

    // null e "" tambem sao "sem override" — um input de data em branco nao pode
    // virar competencia partida.
    for (const vazio of [null, "", undefined]) {
      const rv = await tentar({ validFromOverride: vazio }, FATIA_TRP38);
      ok(rv.ok && rv.st.rpcCalls[0].params.p_valid_from === JAN.validFrom &&
        rv.st.leiturasVersoes === 0,
        `validFromOverride=${JSON.stringify(vazio)} e tratado como SEM override`);
    }
  }

  // ============================================================== BLOCO 5
  console.log("\n5) O FLUXO DELEGADO LE DO STAGING, nao do body");
  console.log(linha("-"));
  {
    const src = fs.readFileSync(path.join(ROOT, "app/api/trp/commit/route.ts"), "utf8");
    const ini = src.indexOf("if (body?.uploadId) {");
    const fim = src.indexOf("} else {", ini);
    ok(ini > 0 && fim > ini, "achei o ramo DELEGADO na rota", `[${ini}..${fim}]`);
    const ramo = src.slice(ini, fim);
    ok(ramo.includes("draftRow.valid_from_override"),
      "o ramo delegado le o override da LINHA do staging");
    ok(!/body\??\.?\.?validFromOverride/.test(ramo) && !ramo.includes("body.validFromOverride"),
      "e NAO le nada de override do corpo da requisicao (a invariante do arquivo)");
    ok(src.includes('"id, competencia, regra_draft, trp_doc_ref, source_filename, source_sha256, parser_version, status, valid_from_override"'),
      "e a coluna esta no SELECT do rascunho (senao viria undefined em silencio)");

    // MUTACAO: os dois leitores sobre a MESMA requisicao dao datas DIFERENTES.
    const draftRow = { valid_from_override: OVER };
    const body = { uploadId: "u1", validFromOverride: "2026-08-20" };
    const realLeitor = (r) => r.valid_from_override ?? null;
    const mutanteLeitor = (_r, b) => (b.validFromOverride ? String(b.validFromOverride) : null);
    ok(realLeitor(draftRow) !== mutanteLeitor(draftRow, body),
      "MUTACAO: ler do body traria uma data que ninguem revisou",
      `staging=${realLeitor(draftRow)} body=${mutanteLeitor(draftRow, body)}`);

    // E a tela nao manda override no delegado (so o uploadId).
    const ui = fs.readFileSync(path.join(ROOT, "components/trp/TrpUploadReview.tsx"), "utf8");
    ok(ui.includes("? { uploadId: currentUploadId }"),
      "a tela manda SO o uploadId no fluxo delegado");
  }

  // ============================================================== BLOCO 6
  console.log("\n6) A coluna atravessa: staging POST -> GET -> tela");
  console.log(linha("-"));
  {
    const post = fs.readFileSync(path.join(ROOT, "app/api/trp/staging/route.ts"), "utf8");
    ok(post.includes("valid_from_override: body?.validFromOverride ? String(body.validFromOverride) : null"),
      "staging POST grava a coluna (e trata \"\" como NULL)");
    ok(post.includes("uploaded_at, valid_from_override"),
      "a inbox do socio devolve a coluna (ele ve o rascunho partido ANTES de abrir)");
    const get = fs.readFileSync(path.join(ROOT, "app/api/trp/staging/[id]/route.ts"), "utf8");
    ok(get.includes("validFromOverride: row.valid_from_override ?? null"),
      "staging GET :id devolve o override para a revisao");
    const ui = fs.readFileSync(path.join(ROOT, "components/trp/TrpUploadReview.tsx"), "utf8");
    ok(ui.includes("setOverrideOn(false)") && ui.includes("setOverrideData(\"\")"),
      "upload fresco ZERA o override (ele nunca vem do PDF)");
    ok(ui.includes("trp-ov--ro"),
      "no delegado o campo e SO LEITURA em destaque (o que vale e o que esta guardado)");
  }

  console.log("\n" + (falhas === 0 ? "GATE OK (0 falhas)" : `GATE FALHOU (${falhas} falha(s))`));
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch((e) => {
  console.error("GATE FALHOU (excecao):", e && e.message ? e.message : e);
  process.exitCode = 1;
});
