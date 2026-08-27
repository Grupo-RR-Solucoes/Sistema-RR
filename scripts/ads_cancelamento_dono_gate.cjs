/*
 * GATE — a rotina de cancelamento da ADS casa o dono, nao duplica, e nao invade o RR.
 *
 * POR QUE ESTE GATE EXISTE, e nao e pelos R$ 1,40.
 *
 * O valor em jogo hoje e irrisorio: UM cancelamento de R$ 1,40. A frente nao e sobre
 * esse numero — e sobre ELIMINAR O PASSO MANUAL. Ate aqui, quem descobria de quem
 * era o contrato cancelado e abatia na planilha era o financeiro, a mao, todo mes. A
 * rotina automatica assume esse passo. O que este gate protege e a CONFIANCA nessa
 * automacao: no dia em que ela lancar debito errado, em duplicidade, ou em quem nao
 * deve, o financeiro volta a fazer a mao — e a frente inteira se perde.
 *
 * O QUE ELE ASSERE, com os dois lados computados no MESMO run (nenhuma constante
 * congelada — o esperado sai sempre do dado de producao):
 *
 *   1. CASA O DONO. A operacao 211689509 (jul/2026) resolve para o promotor cuja
 *      producao esta em cms_promoter_entries. Ate 27/08/2026 a cascata da ADS olhava
 *      SO `daily.assigned_promoter_id` e essa operacao ficava na fila mesmo tendo
 *      dono — a regressao a proteger e alguem tirar o degrau `cms` da cascata.
 *
 *   2. NAO INVENTA DONO. As operacoes 209867885 e 209621970 (jun/2026) NAO existem
 *      em fonte nenhuma — 0 linhas em daily, cms, bbts_prt_parcelas e
 *      monthly_closing_entries. O promotor NUNCA recebeu comissao por elas, entao
 *      nao ha o que estornar: debita-las seria cobranca indevida. Elas TEM de
 *      continuar na fila.
 *
 *      LIMITE MEDIDO DESTA ASSERCAO: ela NAO pega um resolvedor ganancioso que
 *      aceite chave MASTER. Testado por mutacao em 27/08/2026 — trocar
 *      `key_type === "INDIVIDUAL"` por qualquer chave manteve o gate VERDE, porque
 *      as duas operacoes de junho nao tem chave J NENHUMA (0 linhas em daily e cms),
 *      entao o ramo da chave nem executa. Para cobrir isso seria preciso um caso com
 *      chave MASTER que NAO seja resolvido antes pelo cms — nao existe no dado de
 *      hoje. Fica declarado em vez de alegado.
 *
 *   3. NAO DUPLICA. Rodar a mesma competencia duas vezes produz o MESMO conjunto —
 *      mesmo numero de debitos, mesmas operacoes, mesmo total. (A gravacao real e
 *      delete-and-replace dos AUTO da competencia; aqui a asercao e sobre o PLANO,
 *      que e o que decide o que sera gravado.)
 *
 *   4. NAO ALCANCA O RR. O plano da ADS so pode conter debitos cujo companyId e o da
 *      ADS. O RR tem resolvedor proprio (resolveInsuranceDebits, chamado pelo import
 *      do fechamento do RR); se os dois passarem a lancar sobre a mesma operacao, o
 *      promotor e debitado duas vezes pelo mesmo cancelamento.
 *
 *   5. O INATIVO PARA, COM AVISO — e o caso e REAL, nao sintetico. 212540080 e um
 *      contrato da ADS cujo dono (ANA CLARA) saiu em 13/06/2026; um cancelamento
 *      dele hoje chega DEPOIS da saida, logo o debito seria da empresa. O gate trava
 *      os DOIS modos de falhar em silencio: lancar assim mesmo em quem nao tem mais
 *      repasse de onde descontar, ou sumir com o item sem ninguem saber que existiu.
 *      Exige tambem que a fila carregue MOTIVO e que o aviso NOMEIE a operacao.
 *      Mais um CONTROLE: o caso de promotor ativo tem de continuar lancando — senao
 *      a regra teria virado trava geral.
 *
 *   6. `promotorInativoNaData` exercitada nos dois sentidos com casos sinteticos
 *      (incluindo o de saida SEM data, que NAO deve mandar para a empresa).
 *
 * needs-db: createClient, dado de PRODUCAO.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const {
  resolveAdsCancelDebits,
  promotorInativoNaData,
} = require("../lib/debitInsuranceResolver.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const f = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let falhas = 0;
const ok = (nome, fn) => {
  try {
    fn();
    console.log("  OK   " + nome);
  } catch (e) {
    falhas++;
    console.log("  FALHA " + nome + "\n         " + e.message);
  }
};

// Casos REAIS de producao. Os valores vem do PDF de fechamento da ADS.
const COM_DONO = [{ contrato: "211689509", valor_seguro: -1.4, tipo: "ESTOQUE D0" }];
const SEM_FONTE = [
  { contrato: "209867885", valor_seguro: -20.7, tipo: "ESTOQUE D0" },
  { contrato: "209621970", valor_seguro: -20.83, tipo: "ESTOQUE D0" },
];

async function main() {
  console.log("GATE: cancelamento da ADS — casa o dono, nao duplica, nao invade o RR\n");

  // ---------------------------------------------------------------- (1) casa
  const p1 = await resolveAdsCancelDebits(sb, {
    year: 2026,
    month: 7,
    debitos: COM_DONO,
    dryRun: true,
  });
  ok("(1) 211689509 acha dono pela producao do cms (nao fica na fila)", () => {
    assert.equal(p1.fila.length, 0, `ficou ${p1.fila.length} na fila: ${p1.fila.map((r) => r.operation).join(",")}`);
    assert.equal(p1.debits.length, 1, `esperava 1 debito, veio ${p1.debits.length}`);
    const d = p1.debits[0];
    assert.ok(d.promoterId, "debito sem promoterId");
    assert.equal(
      d.sources[0].resolvedVia,
      "cms",
      `resolvido via "${d.sources[0].resolvedVia}" — o degrau cms saiu da cascata?`
    );
  });

  // ------------------------------------------------- (2) nao inventa dono
  const p2 = await resolveAdsCancelDebits(sb, {
    year: 2026,
    month: 6,
    debitos: SEM_FONTE,
    dryRun: true,
  });
  ok("(2) as 2 sem producao NAO viram debito (seria cobranca indevida)", () => {
    assert.equal(
      p2.debits.length,
      0,
      `inventou ${p2.debits.length} debito(s): ${p2.debits.map((d) => d.promoterName).join(", ")}`
    );
    assert.equal(p2.fila.length, 2, `esperava 2 na fila, veio ${p2.fila.length}`);
    const ops = p2.fila.map((r) => String(r.operation)).sort();
    assert.deepEqual(ops, ["209621970", "209867885"]);
  });

  // ------------------------------------------------------- (3) nao duplica
  const p3a = await resolveAdsCancelDebits(sb, { year: 2026, month: 7, debitos: COM_DONO, dryRun: true });
  const p3b = await resolveAdsCancelDebits(sb, { year: 2026, month: 7, debitos: COM_DONO, dryRun: true });
  ok("(3) rodar duas vezes produz o MESMO plano (nao duplica)", () => {
    assert.equal(p3a.debits.length, p3b.debits.length, "numero de debitos mudou entre as duas rodadas");
    const tot = (p) => Math.round(p.debits.reduce((a, d) => a + Number(d.total || 0), 0) * 100) / 100;
    assert.equal(tot(p3a), tot(p3b), `total mudou: ${f(tot(p3a))} vs ${f(tot(p3b))}`);
    const ops = (p) => p.debits.flatMap((d) => d.sources.map((s) => String(s.operation))).sort();
    assert.deepEqual(ops(p3a), ops(p3b), "conjunto de operacoes mudou entre as rodadas");
  });

  // --------------------------------------------------- (4) nao alcanca o RR
  ok("(4) todo debito do plano e da ADS (nao invade o RR)", () => {
    for (const p of [p1, p2, p3a]) {
      for (const d of p.debits) {
        assert.equal(
          d.companyId,
          ADS,
          `debito com companyId ${d.companyId} — o resolvedor da ADS nao pode lancar fora dela`
        );
      }
      for (const r of p.fila) {
        assert.equal(r.companyId, ADS, `fila com companyId ${r.companyId}`);
      }
    }
  });

  // ------------------------------- (5) o INATIVO para, com aviso — CASO REAL
  // 212540080 e um contrato REAL da ADS cujo dono (ANA CLARA) saiu em 13/06/2026.
  // Se ele for cancelado hoje, o debito chega DEPOIS da saida dela -> pela regra e
  // da empresa. O que este caso trava sao os DOIS modos de falhar em silencio:
  //   - lancar assim mesmo, em quem nao tem mais repasse de onde descontar;
  //   - sumir com o item, sem ninguem saber que existiu.
  const pInat = await resolveAdsCancelDebits(sb, {
    year: 2026,
    month: 7,
    debitos: [{ contrato: "212540080", valor_seguro: -1.0, tipo: "ESTOQUE D0" }],
    dryRun: true,
  });
  ok("(5) promotor INATIVO: NAO lanca debito", () => {
    assert.equal(
      pInat.debits.length,
      0,
      `lancou ${pInat.debits.length} debito(s) em quem ja saiu: ` +
        pInat.debits.map((d) => d.promoterName).join(", ")
    );
  });
  ok("(5) promotor INATIVO: o item NAO some — fica na fila", () => {
    assert.equal(pInat.fila.length, 1, `esperava 1 na fila, veio ${pInat.fila.length}`);
    assert.equal(String(pInat.fila[0].operation), "212540080");
  });
  ok("(5) promotor INATIVO: a fila carrega MOTIVO explicito", () => {
    const m = String(pInat.fila[0].motivo || "");
    assert.ok(m.length > 0, "item pendente SEM motivo — silencio e exatamente o que este gate proibe");
    assert.match(m, /inativo/i, `o motivo nao menciona inatividade: "${m}"`);
    assert.match(m, /empresa/i, `o motivo nao diz de quem e o debito: "${m}"`);
  });
  ok("(5) promotor INATIVO: sobe AVISO nomeando a operacao", () => {
    const av = (pInat.avisos || []).join(" | ");
    assert.match(av, /212540080/, `nenhum aviso cita a operacao: "${av}"`);
    assert.match(av, /PENDENTE/, `o aviso nao se anuncia como pendencia: "${av}"`);
  });
  ok("(5) CONTROLE: promotor ATIVO continua lancando (a regra nao virou trava geral)", () => {
    assert.equal(p1.debits.length, 1, "o caso de promotor ativo parou de lancar");
    assert.equal(p1.fila.length, 0);
  });

  // --------------------------------------- (6) o criterio do inativo funciona
  ok("(6) inativo ANTES do debito -> true; DEPOIS -> false; ativo -> false", () => {
    assert.equal(
      promotorInativoNaData({ active: false, dismissed_at: "2026-05-10" }, "2026-06-01"),
      true,
      "desativado em maio, debito em junho: deveria ser da empresa"
    );
    assert.equal(
      promotorInativoNaData({ active: false, dismissed_at: "2026-07-20" }, "2026-06-01"),
      false,
      "desativado DEPOIS do debito: ainda era dele"
    );
    assert.equal(promotorInativoNaData({ active: true, dismissed_at: null }, "2026-06-01"), false);
    assert.equal(
      promotorInativoNaData({ active: false, dismissed_at: null }, "2026-06-01"),
      false,
      "sem data de saida nao se afirma que ja estava fora"
    );
    assert.equal(promotorInativoNaData(undefined, "2026-06-01"), false);
  });

  console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
