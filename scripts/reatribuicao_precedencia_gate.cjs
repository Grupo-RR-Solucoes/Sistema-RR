/* ============================================================================
 * reatribuicao_precedencia_gate — o DIARIO vence a CHAVE J.
 *
 * Rodar:
 *   node scripts/reatribuicao_precedencia_gate.cjs
 *
 * A INVARIANTE (regra confirmada por Diego em 23/08/2026): quando uma proposta e
 * reatribuida manualmente, a producao pertence a quem RECEBEU a reatribuicao.
 * O campo que o financeiro edita e `daily_production_records.assigned_promoter_id`;
 * a CHAVE J continua no dono ORIGINAL. Logo o diario vence, e a chave J e
 * FALLBACK — vale so quando nao ha linha correspondente no diario.
 *
 * O DEFEITO (medido em 23/08/2026): closingMonthly.ts consultava o diario SO
 * para o contrato orfao de chave master (`contratos.filter(c => !c.promoterId)`)
 * e, para o resto, a chave J tinha a ultima palavra. Toda reatribuicao
 * promotor->promotor era DESFEITA no fechamento. Dano em jul/2026: 5 contratos,
 * R$ 49.105,56 no dono errado.
 *
 * OS BLOCOS (os dois lados no mesmo run):
 *   1. PURO         — resolvePromotorEfetivo: diario primeiro, chave J de resto,
 *                     null quando nenhum dos dois resolve.
 *   2. REGRA VELHA  — prova que a precedencia ANTIGA viola a invariante nos 5
 *                     contratos MEDIDOS, e que a NOVA a respeita. Sem este bloco
 *                     o gate nao distingue "esta certo" de "nao ha o que testar".
 *   3. FALLBACK     — competencia SEM diario (2026-01) tem de sair BYTE-IDENTICA
 *                     a regra velha. E o bloco que impede o conserto de evaporar
 *                     a producao dos meses anteriores ao diario (que so comeca
 *                     em 2026-03-31).
 *   4. SEM DUPLICATA— os tres consumidores do PMR chamam o helper; nenhum
 *                     reimplementa a precedencia.
 * ========================================================================== */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const HM = require("../lib/herancaMaster.ts");
const CPB = require("../lib/closingPromoterBase.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};
const brl = (n) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROOT = path.resolve(__dirname, "..");
const BBTS_KEY = "JJ552710";
const JUL = { year: 2026, month: 7 };
const SEM_DIARIO = { year: 2026, month: 1 }; // fechamento existe, diario nao

// Os 5 contratos MEDIDOS em 23/08/2026: reatribuidos promotor->promotor no
// diario ANTES da importacao do fechamento (04/08), e revertidos pela chave J.
// Trilha em proposal_reassignments. `deDaChave` = dono da CHAVE J (errado),
// `paraDoDiario` = quem recebeu a reatribuicao (certo).
const CASOS = [
  {
    ctr: "214022989",
    chave: "JH138321",
    liq: 25000.0,
    deDaChave: "CARLA MIRELLE SILVA",
    paraDoDiario: "MONICA PEREIRA",
  },
  {
    ctr: "219314256",
    chave: "JH138321",
    liq: 14000.0,
    deDaChave: "CARLA MIRELLE SILVA",
    paraDoDiario: "MONICA PEREIRA",
  },
  {
    ctr: "219262430",
    chave: "JJ211412",
    liq: 9000.0,
    deDaChave: "TACIANA MARIA GOMES DE MOURA",
    paraDoDiario: "MATHEUS AVELINO DA SILVA",
  },
  {
    ctr: "219315418",
    chave: "JH138321",
    liq: 645.56,
    deDaChave: "CARLA MIRELLE SILVA",
    paraDoDiario: "MONICA PEREIRA",
  },
  {
    ctr: "221184463",
    chave: "JH138321",
    liq: 460.0,
    deDaChave: "CARLA MIRELLE SILVA",
    paraDoDiario: "JESSICA DE ALBUQUERQUE BARBOSA ROCHA",
  },
];

const semAcento = (s) =>
  String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

// A precedencia ANTIGA, reproduzida literalmente para servir de contraprova.
// (era closingMonthly.ts:278-284, com o mapa montado so sobre as orfas)
const regraVelha = (c, donoDasOrfasApenas) => {
  if (c.promoterId) return c.promoterId;
  const h = donoDasOrfasApenas.get(`${c.companyId}|${String(c.contrato || "").trim()}`);
  return h == null ? null : h;
};

const naoBbts = (c) => semAcento(c.chaveJ) !== BBTS_KEY;

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — resolvePromotorEfetivo: o DIARIO vence, a CHAVE J e fallback");
  console.log(linha("="));
  const DIARIO = new Map([["co1|C1", "pid-do-diario"]]);
  ok(
    HM.resolvePromotorEfetivo(
      { promoterIdDaChave: "pid-da-chave", contrato: "C1", companyId: "co1" },
      DIARIO
    ) === "pid-do-diario",
    "diario VENCE a chave J quando os dois resolvem (o caso da reatribuicao)"
  );
  ok(
    HM.resolvePromotorEfetivo(
      { promoterIdDaChave: "pid-da-chave", contrato: "C9", companyId: "co1" },
      DIARIO
    ) === "pid-da-chave",
    "SEM linha no diario -> mantem a chave J (FALLBACK obrigatorio)"
  );
  ok(
    HM.resolvePromotorEfetivo({ promoterIdDaChave: null, contrato: "C1", companyId: "co1" }, DIARIO) ===
      "pid-do-diario",
    "chave MASTER/ausente + diario -> diario (a heranca de sempre)"
  );
  ok(
    HM.resolvePromotorEfetivo({ promoterIdDaChave: null, contrato: "C9", companyId: "co1" }, DIARIO) === null,
    "nenhum dos dois resolve -> null (contrato fica com a empresa, fora do PMR)"
  );
  ok(
    HM.resolvePromotorEfetivo(
      { promoterIdDaChave: "pid-da-chave", contrato: "C1", companyId: "OUTRA" },
      DIARIO
    ) === "pid-da-chave",
    "o casamento e por EMPRESA+contrato — empresa diferente nao rouba a linha"
  );
  ok(
    HM.resolvePromotorEfetivo(
      { promoterIdDaChave: "pid-da-chave", contrato: "", companyId: "co1" },
      DIARIO
    ) === "pid-da-chave",
    "contrato vazio nao consulta o diario -> chave J"
  );
  ok(
    HM.resolvePromotorEfetivo(
      { promoterIdDaChave: "pid-da-chave", contrato: " C1 ", companyId: "co1" },
      DIARIO
    ) === "pid-do-diario",
    "contrato com espaco nas pontas casa igual (trim)"
  );

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data: promsData } = await sb.from("promoters").select("id, name");
  const nomeDe = new Map((promsData || []).map((p) => [p.id, p.name]));

  // ---- 2. A REGRA VELHA VIOLA (prova que o teste tem poder) ----
  console.log("\n" + linha("="));
  console.log("2) REGRA VELHA — a precedencia ANTIGA punha os 5 contratos no dono errado");
  console.log(linha("="));
  const base = await CPB.loadClosingPromoterBase(sb, {
    year: JUL.year,
    month: JUL.month,
    companyId: null,
  });
  const contratos = base.contratos.filter(naoBbts);
  ok(contratos.length > 0, "ANTI-VACUIDADE: o fechamento de jul/2026 tem linhas", `linhas=${contratos.length}`);

  // mapa da regra VELHA: so as orfas de chave master
  const orfas = contratos.filter((c) => !c.promoterId && String(c.contrato || "").trim());
  const donoOrfas = await HM.buildDonoDoDiarioMap(sb, orfas, JUL.year, JUL.month);
  // mapa da regra NOVA: todas as linhas
  const donoTodas = await HM.buildDonoDoDiarioMap(sb, contratos, JUL.year, JUL.month);
  ok(
    donoTodas.size > donoOrfas.size,
    "ANTI-VACUIDADE: o mapa NOVO enxerga mais linhas que o VELHO",
    `novo=${donoTodas.size} velho=${donoOrfas.size}`
  );

  let achados = 0;
  let liqMovido = 0;
  for (const caso of CASOS) {
    const c = contratos.find((x) => String(x.contrato || "").trim() === caso.ctr);
    if (!c) {
      ok(false, `contrato ${caso.ctr} presente no fechamento de jul/2026`, "-> AUSENTE");
      continue;
    }
    achados += 1;
    const velho = regraVelha(c, donoOrfas);
    const novo = HM.resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      donoTodas
    );
    console.log(
      `   ${caso.ctr} ${String(c.chaveJ).padEnd(10)} ${brl(c.valorLiquido).padStart(11)}` +
        `  VELHA -> ${nomeDe.get(velho) || velho}  |  NOVA -> ${nomeDe.get(novo) || novo}`
    );
    ok(semAcento(c.chaveJ) === caso.chave, `   ${caso.ctr}: chave J e ${caso.chave}`);
    ok(Math.abs(c.valorLiquido - caso.liq) < 0.005, `   ${caso.ctr}: liquido ${brl(caso.liq)}`);
    ok(
      semAcento(nomeDe.get(velho)) === caso.deDaChave,
      `   ${caso.ctr}: a regra VELHA dava ao dono da CHAVE (${caso.deDaChave}) — ERRADO`
    );
    ok(
      semAcento(nomeDe.get(novo)) === caso.paraDoDiario,
      `   ${caso.ctr}: a regra NOVA da a quem RECEBEU (${caso.paraDoDiario})`
    );
    ok(velho !== novo, `   ${caso.ctr}: as duas regras DIVERGEM (se nao divergem, o caso nao testa nada)`);
    liqMovido += c.valorLiquido;
  }
  ok(
    achados === CASOS.length,
    "ANTI-VACUIDADE: os 5 contratos medidos estao no fechamento",
    `${achados}/${CASOS.length}`
  );
  ok(Math.abs(liqMovido - 49105.56) < 0.02, "o liquido que troca de dono e o medido", `R$ ${brl(liqMovido)}`);

  // Nenhuma OUTRA linha de julho pode se mover: o dano medido e exatamente 5.
  let divergentes = 0;
  for (const c of contratos) {
    const velho = regraVelha(c, donoOrfas);
    const novo = HM.resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      donoTodas
    );
    if (velho !== novo) divergentes += 1;
  }
  ok(
    divergentes === CASOS.length,
    "em jul/2026 mudam EXATAMENTE 5 linhas, nem mais nem menos",
    `divergentes=${divergentes}`
  );

  // ---- 3. FALLBACK — competencia SEM diario nao pode se mover ----
  console.log("\n" + linha("="));
  console.log(
    `3) FALLBACK — ${SEM_DIARIO.year}-${String(SEM_DIARIO.month).padStart(2, "0")} nao tem diario: nada pode mudar`
  );
  console.log(linha("="));
  const baseSD = await CPB.loadClosingPromoterBase(sb, {
    year: SEM_DIARIO.year,
    month: SEM_DIARIO.month,
    companyId: null,
  });
  const cSD = baseSD.contratos.filter(naoBbts);
  const orfasSD = cSD.filter((c) => !c.promoterId && String(c.contrato || "").trim());
  const donoOrfasSD = await HM.buildDonoDoDiarioMap(sb, orfasSD, SEM_DIARIO.year, SEM_DIARIO.month);
  const donoTodasSD = await HM.buildDonoDoDiarioMap(sb, cSD, SEM_DIARIO.year, SEM_DIARIO.month);
  let mudouSD = 0;
  let comChave = 0;
  for (const c of cSD) {
    if (c.promoterId) comChave += 1;
    const velho = regraVelha(c, donoOrfasSD);
    const novo = HM.resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      donoTodasSD
    );
    if (velho !== novo) mudouSD += 1;
  }
  console.log(
    `   linhas=${cSD.length}  com promotor pela CHAVE J=${comChave}  dono no diario=${donoTodasSD.size}`
  );
  ok(cSD.length > 100, "ANTI-VACUIDADE: a competencia sem diario tem linhas de verdade", `linhas=${cSD.length}`);
  ok(comChave > 100, "ANTI-VACUIDADE: essas linhas RESOLVEM pela chave J", `comChave=${comChave}`);
  ok(donoTodasSD.size === 0, "o diario nao cobre essa competencia (e o cenario do fallback)", `dono=${donoTodasSD.size}`);
  ok(mudouSD === 0, "NENHUMA linha muda de dono — o fallback preservou a chave J", `mudaram=${mudouSD}`);

  // ---- 4. SEM DUPLICATA ----
  console.log("\n" + linha("="));
  console.log("4) SEM DUPLICATA — os tres consumidores chamam o helper, ninguem reimplementa");
  console.log(linha("="));
  for (const rel of ["lib/closingMonthly.ts", "lib/bbtsOrchestrator.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(/resolvePromotorEfetivo\(/.test(src), `${rel} consome resolvePromotorEfetivo`);
    ok(/from "\.\/herancaMaster\.ts"/.test(src), `${rel} importa de herancaMaster.ts (fonte unica)`);
    ok(
      !/c\.promoterId\s*(\|\||\?\?)\s*heir/.test(src) &&
        !/if \(c\.promoterId\) return c\.promoterId/.test(src),
      `${rel} nao tem a precedencia antiga (chave J primeiro) escrita a mao`
    );
    ok(
      !/key_type === "MASTER"/.test(src),
      `${rel} nao recorta o diario por chave MASTER (era o recorte do defeito)`
    );
  }
  {
    const src = fs.readFileSync(path.join(ROOT, "lib/closingMonthly.ts"), "utf8");
    const chamadas = (src.match(/resolvePromotorEfetivo\(/g) || []).length;
    ok(
      chamadas >= 3,
      "closingMonthly usa o helper nos 3 sitios (PMR, dona-da-empresa, seguro avulso)",
      `chamadas=${chamadas}`
    );
    const mapas = (src.match(/buildDonoDoDiarioMap\(/g) || []).length;
    ok(mapas >= 3, "e monta o mapa do diario nos 3 sitios", `mapas=${mapas}`);
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
