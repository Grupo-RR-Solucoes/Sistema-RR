#!/usr/bin/env node
/*
 * scripts/gate_desconto_piso.cjs — O DESCONTO QUE O PISO NAO DEIXOU ACONTECER.
 *
 * A REGRA DEFENDIDA (decisao Diego, 20/08/2026): piso zerou o repasse => a
 * parcela de desconto NAO e consumida. Nao e `max(0, final - desconto)`.
 *
 * O QUE PODE DAR ERRADO, e e por isso que este portao existe:
 *   1. LEITURA FROUXA do flag. `piso_zerou` e null em quase todo o historico;
 *      `!piso_zerou` ou `piso_zerou !== false` classificaria o passado inteiro
 *      como zerado e "descobriria" descontos nao cobrados que sempre foram
 *      cobrados. E a mesma armadilha do `trp_multi_versao`, ja documentada.
 *   2. DUAS IMPLEMENTACOES. Se o ledgerHealth (a tela) contasse por conta
 *      propria em vez de consumir a mesma funcao do consolidador (o banco), a
 *      tela e o dado divergiriam em silencio. Este portao amarra os dois no
 *      MESMO numero.
 *   3. A marcacao comer o `notes` de alguem, ou nao ser reversivel.
 *
 * O portao tem os DOIS lados no mesmo run: a regra real e o mutante do FONTE
 * REAL (scripts/_mutanteTs.cjs). Nenhuma constante congelada de dinheiro — o
 * numero do banco e recomputado aqui e conferido contra o ledgerHealth, nao
 * contra um valor cravado.
 *
 * modo: needs-db (le PMR e promoter_discounts; sem banco, REPROVA).
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { carregaReal, carregaMutante, ROOT } = require("./_mutanteTs.cjs");

const MODULO = "lib/piso/descontoNaoAplicado.ts";
const falhas = [];
const ok = (n, cond, msg) => {
  console.log(`  ${cond ? "OK   " : "FALHA"} [${n}] ${msg}`);
  if (!cond) falhas.push(`[${n}] ${msg}`);
};

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// FIXTURE — desenhada para separar o estrito do frouxo. As tres linhas de PMR
// cobrem os tres estados que a coluna assume no banco de verdade.
const PMR = [
  { promoter_id: "P-ZERADO", year: 2026, month: 8, piso_zerou: true },
  { promoter_id: "P-LEGADO", year: 2026, month: 8, piso_zerou: null },   // historico
  { promoter_id: "P-NORMAL", year: 2026, month: 8, piso_zerou: false },
];
const DESCONTOS = [
  { id: "d1", promoter_id: "P-ZERADO", year: 2026, month: 8, amount: 3.14, discount_type: "CANCELAMENTO_SEGURO" },
  { id: "d2", promoter_id: "P-LEGADO", year: 2026, month: 8, amount: 100, discount_type: "ADIANTAMENTO" },
  { id: "d3", promoter_id: "P-NORMAL", year: 2026, month: 8, amount: 200, discount_type: "ADIANTAMENTO" },
  // mesma pessoa zerada, mas em OUTRA competencia: nao entra
  { id: "d4", promoter_id: "P-ZERADO", year: 2026, month: 7, amount: 50, discount_type: "ADIANTAMENTO" },
  // desconto da EMPRESA: nao reduz o repasse do promotor, o piso nao o alcanca
  { id: "d5", promoter_id: "P-ZERADO", year: 2026, month: 8, amount: 999, apply_to_company: true },
];

const ids = (lista) => lista.map((x) => x.desconto_id).sort().join(",");

async function main() {
  console.log("\n=== GATE desconto x piso ===");
  const real = carregaReal(MODULO);

  console.log("\n[A] a regra, com o FONTE REAL");
  const achados = real.descontosNaoAplicadosPorPiso(PMR, DESCONTOS);
  ok("A1", ids(achados) === "d1", `so o desconto do promotor com piso_zerou===true (achei: ${ids(achados) || "nada"})`);
  ok("A2", achados.length === 1 && achados[0].valor === 3.14, "o valor vem da linha, nao de constante");
  ok("A3", achados.every((a) => a.competencia === "2026-08"), "competencia e a DO desconto (nunca 'a proxima')");
  ok("A4", !achados.some((a) => a.desconto_id === "d5"), "apply_to_company=true fica FORA");
  ok("A5", !achados.some((a) => a.desconto_id === "d4"), "desconto de outra competencia fica FORA");
  ok("A6", real.STATUS_NAO_APLICADO_PISO === "WAIVED",
    "o status cabe no CHECK existente (PENDING|APPLIED|WAIVED|CANCELLED) — sem migration nova");

  console.log("\n[A'] a marcacao no `notes` e reversivel e nao come texto humano");
  const humano = "Combinado com a promotora em 12/08.";
  const marcado = real.notasComMarcador(humano, "2026-08");
  ok("A7", marcado.indexOf(humano) >= 0, "o texto humano sobrevive a marcacao");
  ok("A8", marcado.indexOf(real.MARCADOR_PISO) >= 0, "o marcador entra");
  ok("A9", real.notasSemMarcador(marcado) === humano, "desmarcar devolve EXATAMENTE o texto humano");
  const duasVezes = real.notasComMarcador(marcado, "2026-08");
  ok("A10", duasVezes.split(real.MARCADOR_PISO).length - 1 === 1, "marcar 2x nao empilha o marcador");
  ok("A11", real.marcadaPeloPiso({ notes: humano }) === false,
    "waiver escrito por gente NAO e reconhecido como nosso (a reversao nao o toca)");

  console.log("\n[MUT] quebrando a regra de proposito — o portao TEM de ficar vermelho");
  const mutantes = [
    {
      nome: "le o flag de forma frouxa (!== false)",
      trocas: [[".filter((r) => r.piso_zerou === true) // regra 1 — estrito", ".filter((r) => r.piso_zerou !== false)"]],
      // o legado (null) passaria a entrar: d2 apareceria
      espera: (lista) => ids(lista) !== "d1",
    },
    {
      nome: "ignora apply_to_company",
      trocas: [["if (d.apply_to_company === true) continue; // regra 3", ""]],
      espera: (lista) => ids(lista) !== "d1",
    },
    {
      nome: "casa so por promotor, esquecendo a competencia",
      trocas: [
        ['.map((r) => `${r.promoter_id}|${r.year}|${r.month}`)', '.map((r) => `${r.promoter_id}`)'],
        ['if (!zerados.has(`${d.promoter_id}|${d.year}|${d.month}`)) continue; // regra 2', 'if (!zerados.has(`${d.promoter_id}`)) continue;'],
      ],
      espera: (lista) => ids(lista) !== "d1",
    },
  ];
  for (const m of mutantes) {
    let pegou = false, detalhe = "";
    try {
      const mut = carregaMutante(MODULO, m.trocas);
      pegou = m.espera(mut.descontosNaoAplicadosPorPiso(PMR, DESCONTOS));
    } catch (e) {
      detalhe = " (" + e.message.split("\n")[0] + ")";
    }
    ok("MUT", pegou, `mutante "${m.nome}" e PEGO pelas assercoes${detalhe}`);
  }

  console.log("\n[B] o banco: a mesma regra, e UMA implementacao so");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    ok("B0", false, "credencial do Supabase ausente — needs-db sem banco REPROVA");
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    async function todas(t, sel) {
      let out = [], from = 0;
      for (;;) {
        const { data, error } = await sb.from(t).select(sel).range(from, from + 999);
        if (error) throw new Error(`${t}: ${error.message}`);
        out = out.concat(data || []);
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      return out;
    }
    const pmr = await todas("promoter_monthly_results", "promoter_id, year, month, piso_zerou");
    const desc = await todas("promoter_discounts", "id, promoter_id, year, month, amount, apply_to_company, status, notes, discount_type");
    const reaisAgora = real.descontosNaoAplicadosPorPiso(pmr, desc);
    const total = reaisAgora.reduce((s, a) => s + a.valor, 0);
    console.log(`       casos reais hoje: ${reaisAgora.length}   total nao cobrado: R$ ${total.toFixed(2)}`);
    for (const a of reaisAgora) console.log(`         ${a.competencia}  ${a.promoter_id.slice(0, 8)}  R$ ${a.valor.toFixed(2)}  ${a.discount_type}`);

    // NAO-VACUIDADE: sem nenhum piso_zerou=true no banco, tudo acima passaria
    // por vazio e o portao nao estaria medindo nada de real.
    const zerados = pmr.filter((r) => r.piso_zerou === true).length;
    ok("B1", zerados > 0,
      `existe piso_zerou=true no banco (${zerados}) — sem isso o lado B passaria por vacuidade`);

    // UMA IMPLEMENTACAO SO: o ledgerHealth tem de contar o MESMO que a funcao.
    let health = null;
    try {
      require("./_ts_register.cjs");
      health = require("@/lib/diagnostico/ledgerHealth");
    } catch (e) {
      ok("B2", false, "nao consegui carregar o ledgerHealth: " + e.message.split("\n")[0]);
    }
    if (health && health.buildLedgerHealth) {
      const h = await health.buildLedgerHealth(sb);
      const chk = (h.checks || []).find((c) => c.id === "desconto_nao_cobrado_por_piso");
      ok("B2", !!chk, "o ledgerHealth publica o item `desconto_nao_cobrado_por_piso`");
      if (chk) {
        ok("B3", chk.count === reaisAgora.length,
          `a tela conta o MESMO que a regra (ledgerHealth=${chk.count}, regra=${reaisAgora.length})`);
        ok("B4", chk.severity === "info",
          `severidade 'info' (nao e defeito, e a regra funcionando) — achei '${chk.severity}'`);
        const d = Array.isArray(chk.detalhe) ? chk.detalhe : [];
        ok("B5", d.every((x) => x.competencia && x.promotor && typeof x.valor === "number"),
          "o detalhe traz competencia, promotor e valor (foi o que se pediu)");
      }
    }

    // PARCELA DE PLANO caindo no piso e o caso que ainda nao existe e que
    // merece decisao. Nao reprova — AVISA, com o numero na mao.
    const porId = new Map(desc.map((d) => [d.id, d]));
    const dePlano = reaisAgora.filter((a) => Number((porId.get(a.desconto_id) || {}).installments || 1) > 1);
    console.log(`       parcelas de PLANO (installments > 1) alcancadas pelo piso: ${dePlano.length}` +
      (dePlano.length ? "   <<< a cauda NAO desloca sozinha — decisao pendente" : "   (nenhuma: so cobranca avulsa 1/1)"));
  }

  console.log("\n" + "=".repeat(60));
  if (falhas.length === 0) {
    console.log("GATE desconto x piso: PASSOU");
    process.exitCode = 0;
    return;
  }
  console.log(`GATE desconto x piso: REPROVOU (${falhas.length})`);
  for (const f of falhas) console.log("  - " + f);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("GATE desconto x piso: ERRO", e.message);
  process.exitCode = 1;
});
