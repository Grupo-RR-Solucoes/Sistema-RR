/*
 * GATE — PISO DE PRODUCAO NO MOTOR: o piso zera o REPASSE e nao toca a EMPRESA.
 *
 * SELF-CONTAINED e OFFLINE: nao toca banco nenhum. Monta um Supabase FALSO em
 * memoria e roda a funcao REAL consolidateMonthlyFromClosing duas vezes sobre o
 * MESMO fechamento sintetico — uma SEM os fatores do piso, outra COM — e compara
 * os dois payloads.
 *
 * POR QUE VIVO-x-VIVO E NAO NUMERO CONGELADO: os dois lados sao computados neste
 * mesmo run, pelo mesmo codigo. Um valor esperado escrito a mao viraria constante
 * congelada no dia em que a regua de repasse mudar.
 *
 * ANTI-VACUIDADE (o bloco que impede o gate de passar sem medir nada):
 *   - SEM piso, os dois promotores abaixo do piso precisam receber ALGO > 0.
 *     Se o fixture parar de produzir repasse, o "com piso da zero" passaria por
 *     vacuidade — zero contra zero.
 *   - O promotor ACIMA do piso precisa receber ALGO > 0 nos DOIS lados.
 *   - O fixture precisa ter seguro > 0, senao "o piso zera o seguro" nao mede nada.
 *
 * PROVAS (exit 0 = todas passam; exit 2 = alguma falhou):
 *   A) ANTI-VACUIDADE: sem piso, os tres recebem > 0 e ha seguro > 0 na mesa.
 *   B) COM piso, quem esta ABAIXO recebe ZERO — credito E seguro.
 *   C) COM piso, quem esta ACIMA do piso fica BYTE-IDENTICO.
 *   D) A COMISSAO DA EMPRESA nao muda em nenhum dos dois lados: production_value,
 *      insured_production_value, proposal_count e a comissao-empresa de seguro
 *      (diagnostico `seguro_empresa`) ficam identicos. O piso e regra de REPASSE.
 *   E) RASTRO: a linha zerada sai com piso_zerou = true e discount_value = 0; a
 *      linha de quem esta acima sai com piso_zerou = false.
 *   F) O BLOCO F decide certo: resolverPiso sobre a producao consolidada produz
 *      fator 0 para os dois abaixo e 1 para o de cima, e a UNIAO do universo
 *      alcanca quem NAO tem contrato (so seguro avulso / nada) — o furo do
 *      bbtsOrchestrator:170.
 *   G) CONTRATO DE INJECAO: com regua vigente e sem fator, o consolidador LANCA;
 *      com PISO_ALLOW_RR_PURE=1 ele segue e devolve AVISO em vez de lancar.
 */
require("./_ts_register.cjs");

const { consolidateMonthlyFromClosing } = require("../lib/closingMonthly.ts");
const { resolverPiso, PISO_TABELA } = require("../lib/pisoProducao.ts");

const YEAR = 2026;
const MONTH = 7;
const CO_RR = "company-rr-1";

// Dois ABAIXO do piso e um ACIMA. Perfil CLT_FIXO 0,1666 nos tres — igual ao das
// duas promotoras reais, para o gate exercitar o mesmo ramo do resolvedor
// (proposalDetailing:614-623, onde o volume NAO importa).
const ABAIXO_1 = "promotor-abaixo-1";
const ABAIXO_2 = "promotor-abaixo-2";
const ACIMA = "promotor-acima";
const SEM_CONTRATO = "promotor-sem-contrato"; // alcancado pela regua, sem fechamento
const SHARE = 0.1666;
const PISO = 150000;

let falhas = 0;
function ok(nome, cond, detalhe) {
  if (cond) console.log(`  ok   ${nome}`);
  else {
    falhas += 1;
    console.log(`  FALHA ${nome}${detalhe !== undefined ? ` -> ${detalhe}` : ""}`);
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
// Supabase FALSO — o subconjunto do query-builder que o consolidador RR usa.
// Tabela desconhecida devolve [] (o consolidador tolera), nunca undefined.
// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  return {
    from(tabela) {
      const filtros = [];
      const casa = (r) =>
        filtros.every((f) => {
          const v = r[f.col];
          if (f.op === "eq") return v === f.val;
          if (f.op === "in") return f.val.includes(v);
          if (f.op === "lte") return String(v ?? "") <= String(f.val);
          if (f.op === "gte") return String(v ?? "") >= String(f.val);
          if (f.op === "lt") return String(v ?? "") < String(f.val);
          if (f.op === "neq") return v !== f.val;
          return true;
        });
      const linhas = () => (db[tabela] || []).filter(casa);
      const api = {
        select: () => api,
        eq(col, val) { filtros.push({ op: "eq", col, val }); return api; },
        in(col, val) { filtros.push({ op: "in", col, val }); return api; },
        lte(col, val) { filtros.push({ op: "lte", col, val }); return api; },
        gte(col, val) { filtros.push({ op: "gte", col, val }); return api; },
        lt(col, val) { filtros.push({ op: "lt", col, val }); return api; },
        neq(col, val) { filtros.push({ op: "neq", col, val }); return api; },
        not: () => api,
        is: () => api,
        order: () => api,
        limit: () => api,
        range(from, to) {
          return Promise.resolve({ data: linhas().slice(from, to + 1), error: null });
        },
        maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
        single() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        then(resolve, reject) {
          try { return resolve({ data: linhas(), error: null }); } catch (e) { return reject(e); }
        },
      };
      return api;
    },
  };
}

/** Uma linha CASH do fechamento, no formato que closingPromoterBase le. */
function cash(id, pid, jkey, liquido, comissaoPf, comissaoSeguro) {
  return {
    id,
    company_id: CO_RR,
    year: YEAR,
    month: MONTH,
    entry_type: "CASH",
    contract_number: id,
    j_key: jkey,
    product_name: "CONSIGNADO",
    net_value: liquido,
    insurance_value: 0,
    commission_value: comissaoPf,
    metadata: {
      "CHAVE J": jkey,
      CONTRATO: id,
      "VALOR LIQUIDO": liquido,
      "COMISSAO PF": comissaoPf,
      "COMISSAO SEGURO": comissaoSeguro,
      "PROD. SEGURADA": comissaoSeguro > 0 ? "SIM" : "NAO",
      "% A VISTA": 0.03, // fora da faixa 5,80% => acordo base do profile (CLT_FIXO)
      "RESTRICAO SRCC": "NAO",
      _pid: pid, // so para o fixture ficar legivel; o codigo nao le isto
    },
  };
}

const REGUA = {
  id: "regua-gate",
  competencia_inicio: "2026-01-01",
  competencia_fim: null,
  regra: {
    piso: PISO,
    comparacao: "MENOR_QUE",
    base_calculo: "PRODUCAO_LIQUIDA_FECHAMENTO",
    escopo_producao: "CONSOLIDADO_RR_ADS",
    zera: ["CREDITO", "SEGURO"],
  },
  scope: { promoter_ids: [ABAIXO_1, ABAIXO_2, SEM_CONTRATO] },
};

function baseDb(comRegua) {
  return {
    // Producao: os dois de baixo abaixo de 150k, o de cima acima.
    monthly_closing_entries: [
      cash("C-1", ABAIXO_1, "JA111111", 85390.0, 2748.0, 120.0),
      cash("C-2", ABAIXO_2, "JA222222", 64794.66, 2296.0, 80.0),
      cash("C-3", ACIMA, "JA333333", 200000.0, 5000.0, 300.0),
    ],
    j_keys: [
      { j_key: "JA111111", promoter_id: ABAIXO_1, key_type: "INDIVIDUAL" },
      { j_key: "JA222222", promoter_id: ABAIXO_2, key_type: "INDIVIDUAL" },
      { j_key: "JA333333", promoter_id: ACIMA, key_type: "INDIVIDUAL" },
    ],
    promoters: [
      { id: ABAIXO_1, name: "ABAIXO UM" },
      { id: ABAIXO_2, name: "ABAIXO DOIS" },
      { id: ACIMA, name: "ACIMA" },
      { id: SEM_CONTRATO, name: "SEM CONTRATO" },
    ],
    companies: [{ id: CO_RR, group_name: "Grupo RR" }],
    promoter_share_profile: [ABAIXO_1, ABAIXO_2, ACIMA, SEM_CONTRATO].map((id) => ({
      promoter_id: id,
      profile_type: "CLT_FIXO",
      fixed_percent: SHARE,
      scale_id: null,
    })),
    share_scale: [],
    share_scale_tier: [],
    daily_production_records: [],
    monthly_targets: [],
    promoter_goal_repasse: [],
    promoter_agreements: [],
    [PISO_TABELA]: comRegua ? [REGUA] : [],
  };
}

/** Producao consolidada no formato do bloco F (aqui so RR; ADS vazia). */
function producoesDoFixture() {
  return [
    { promoterId: ABAIXO_1, fechamento: 85390.0, diario: 85390.0 },
    { promoterId: ABAIXO_2, fechamento: 64794.66, diario: 64794.66 },
    { promoterId: ACIMA, fechamento: 200000.0, diario: 200000.0 },
    { promoterId: SEM_CONTRATO, fechamento: 0, diario: 0 },
  ];
}

const porPid = (res) => new Map(res.payload.map((r) => [r.promoter_id, r]));
const tabPorPid = (res) => new Map(res.table.map((r) => [r.promoter_id, r]));

async function main() {
  // =========================================================================
  console.log("\nF) o bloco F decide certo (resolverPiso sobre o consolidado)");
  // =========================================================================
  const plano = await resolverPiso(fakeSupabase(baseDb(true)), {
    year: YEAR,
    month: MONTH,
    producoes: producoesDoFixture(),
  });
  ok("regua resolvida", plano.regua && plano.regua.piso === PISO);
  ok("ABAIXO_1 -> fator credito 0", plano.fatorCreditoByPromoter.get(ABAIXO_1) === 0);
  ok("ABAIXO_1 -> fator seguro 0", plano.fatorSeguroByPromoter.get(ABAIXO_1) === 0);
  ok("ABAIXO_2 -> fator credito 0", plano.fatorCreditoByPromoter.get(ABAIXO_2) === 0);
  ok(
    "ACIMA nao e alcancado pela regua (nem entra no mapa)",
    plano.fatorCreditoByPromoter.get(ACIMA) === undefined
  );
  ok(
    "`get(ACIMA) ?? 1` = 1 — e assim que o motor le",
    (plano.fatorCreditoByPromoter.get(ACIMA) ?? 1) === 1
  );
  ok(
    "SEM_CONTRATO (fora de `pids`) E alcancado: producao 0 < piso -> fator 0",
    plano.fatorCreditoByPromoter.get(SEM_CONTRATO) === 0
  );
  ok(
    "PRODUTO fica de pe (zera[] nao inclui PRODUTO)",
    plano.fatorProdutoByPromoter.get(ABAIXO_1) === 1
  );

  // =========================================================================
  console.log("\nRodando o consolidador REAL duas vezes (sem piso x com piso)");
  // =========================================================================
  const semPiso = await consolidateMonthlyFromClosing(fakeSupabase(baseDb(false)), {
    year: YEAR,
    month: MONTH,
    dryRun: true,
  });
  const comPiso = await consolidateMonthlyFromClosing(fakeSupabase(baseDb(true)), {
    year: YEAR,
    month: MONTH,
    dryRun: true,
    fatorCreditoByPromoter: plano.fatorCreditoByPromoter,
    fatorSeguroByPromoter: plano.fatorSeguroByPromoter,
  });
  const S = porPid(semPiso);
  const C = porPid(comPiso);
  const St = tabPorPid(semPiso);
  const Ct = tabPorPid(comPiso);
  for (const [nome, pid] of [["ABAIXO_1", ABAIXO_1], ["ABAIXO_2", ABAIXO_2], ["ACIMA", ACIMA]]) {
    const s = S.get(pid);
    console.log(
      `   ${nome.padEnd(9)} sem piso: prod ${s.production_value} credito ${s.production_commission_value.toFixed(4)} seguro ${s.insurance_commission_value.toFixed(4)} final ${s.final_commission_value.toFixed(4)}`
    );
  }

  // =========================================================================
  console.log("\nA) ANTI-VACUIDADE — sem piso ha dinheiro na mesa");
  // =========================================================================
  ok("os 3 promotores existem no payload", S.size === 3, `size=${S.size}`);
  ok("ABAIXO_1 recebe > 0 sem piso", S.get(ABAIXO_1).final_commission_value > 0, S.get(ABAIXO_1).final_commission_value);
  ok("ABAIXO_2 recebe > 0 sem piso", S.get(ABAIXO_2).final_commission_value > 0, S.get(ABAIXO_2).final_commission_value);
  ok("ACIMA recebe > 0 sem piso", S.get(ACIMA).final_commission_value > 0, S.get(ACIMA).final_commission_value);
  ok(
    "ha SEGURO na mesa (senao 'o piso zera o seguro' nao mede nada)",
    S.get(ABAIXO_1).insurance_commission_value > 0 && St.get(ABAIXO_1).seguro_empresa > 0,
    `${S.get(ABAIXO_1).insurance_commission_value} / ${St.get(ABAIXO_1).seguro_empresa}`
  );
  ok(
    "credito sem piso = comissao-empresa x acordo (o repasse e real)",
    Math.abs(S.get(ABAIXO_1).production_commission_value - 2748.0 * SHARE) < 1e-9,
    S.get(ABAIXO_1).production_commission_value
  );

  // =========================================================================
  console.log("\nB) COM piso, quem esta ABAIXO recebe ZERO (credito E seguro)");
  // =========================================================================
  for (const [nome, pid] of [["ABAIXO_1", ABAIXO_1], ["ABAIXO_2", ABAIXO_2]]) {
    const c = C.get(pid);
    ok(`${nome}: credito = 0`, c.production_commission_value === 0, c.production_commission_value);
    ok(`${nome}: seguro = 0`, c.insurance_commission_value === 0, c.insurance_commission_value);
    ok(`${nome}: final = 0`, c.final_commission_value === 0, c.final_commission_value);
  }

  // =========================================================================
  console.log("\nC) COM piso, quem esta ACIMA fica BYTE-IDENTICO");
  // =========================================================================
  ok(
    "ACIMA: payload identico sem piso x com piso",
    JSON.stringify({ ...S.get(ACIMA), calculated_at: null }) ===
      JSON.stringify({ ...C.get(ACIMA), calculated_at: null }),
    JSON.stringify(C.get(ACIMA))
  );

  // =========================================================================
  console.log("\nD) a comissao da EMPRESA nao muda (piso e regra de REPASSE)");
  // =========================================================================
  for (const [nome, pid] of [["ABAIXO_1", ABAIXO_1], ["ABAIXO_2", ABAIXO_2], ["ACIMA", ACIMA]]) {
    ok(
      `${nome}: production_value identico`,
      S.get(pid).production_value === C.get(pid).production_value,
      `${S.get(pid).production_value} x ${C.get(pid).production_value}`
    );
    ok(
      `${nome}: insured_production_value + proposal_count identicos`,
      S.get(pid).insured_production_value === C.get(pid).insured_production_value &&
        S.get(pid).proposal_count === C.get(pid).proposal_count
    );
    ok(
      `${nome}: comissao-EMPRESA de seguro identica (seguro_empresa, BRUTA)`,
      St.get(pid).seguro_empresa === Ct.get(pid).seguro_empresa,
      `${St.get(pid).seguro_empresa} x ${Ct.get(pid).seguro_empresa}`
    );
    ok(
      `${nome}: penetracao identica (o piso nao mexe na faixa)`,
      S.get(pid).insurance_penetration_percent === C.get(pid).insurance_penetration_percent
    );
  }

  // =========================================================================
  console.log("\nE) rastro na linha");
  // =========================================================================
  ok("ABAIXO_1: piso_zerou = true", C.get(ABAIXO_1).piso_zerou === true);
  ok("ABAIXO_2: piso_zerou = true", C.get(ABAIXO_2).piso_zerou === true);
  ok("ACIMA: piso_zerou = false", C.get(ACIMA).piso_zerou === false);
  ok("ABAIXO_1: discount_value = 0 (o desconto NAO aconteceu)", C.get(ABAIXO_1).discount_value === 0);
  ok("sem piso: ninguem sai marcado", [...S.values()].every((r) => r.piso_zerou === false));

  // =========================================================================
  console.log("\nG) contrato de injecao (fail-loud + valvula)");
  // =========================================================================
  delete process.env.PISO_ALLOW_RR_PURE;
  const msg = await lancouAsync(() =>
    consolidateMonthlyFromClosing(fakeSupabase(baseDb(true)), {
      year: YEAR,
      month: MONTH,
      dryRun: true,
    })
  );
  ok(
    "regua vigente + fator ausente -> LANCA (ate em dryRun)",
    !!msg && /consolidateMonthlyGroup/.test(msg),
    msg
  );
  process.env.PISO_ALLOW_RR_PURE = "1";
  const comValvula = await consolidateMonthlyFromClosing(fakeSupabase(baseDb(true)), {
    year: YEAR,
    month: MONTH,
    dryRun: true,
  });
  ok(
    "PISO_ALLOW_RR_PURE=1 -> nao lanca e AVISA",
    (comValvula.avisos || []).some((a) => /PISO IGNORADO/.test(a)),
    JSON.stringify(comValvula.avisos)
  );
  ok(
    "com a valvula o repasse NAO e zerado (por isso o aviso importa)",
    porPid(comValvula).get(ABAIXO_1).final_commission_value > 0
  );
  delete process.env.PISO_ALLOW_RR_PURE;
  const semRegua = await consolidateMonthlyFromClosing(fakeSupabase(baseDb(false)), {
    year: YEAR,
    month: MONTH,
    dryRun: true,
  });
  ok(
    "sem regua vigente: nao lanca e nao avisa nada de piso",
    !(semRegua.avisos || []).some((a) => /PISO/.test(a)),
    JSON.stringify(semRegua.avisos)
  );

  console.log(
    falhas === 0
      ? "\nGATE OK — o piso zera o repasse, nao toca a empresa, e quem esta acima nao se move."
      : `\nGATE REPROVADO — ${falhas} falha(s).`
  );
  process.exit(falhas === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("ERRO INESPERADO:", e);
  process.exit(2);
});
