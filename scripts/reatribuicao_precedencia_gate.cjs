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
 *   4. SEM DUPLICATA— TODOS os consumidores chamam o helper; nenhum reimplementa
 *                     a precedencia. A lista de sitios e COMPUTADA por varredura
 *                     de lib/, nao escrita a mao — ver o bloco.
 *   5. EXIBICAO     — o QUARTO sitio, lib/closingProposalRows.ts (aba
 *                     Detalhamento). Ficou com a regra VELHA de 23/08 a 28/08 e
 *                     fazia a TELA contradizer o contracheque. Bloco com prova
 *                     por mutacao E dois controles positivos.
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
  console.log("4) SEM DUPLICATA — a lista de consumidores e VARRIDA, e cada um chama o helper");
  console.log(linha("="));
  // A LISTA E COMPUTADA, NAO ESCRITA A MAO. Varre lib/ atras de QUALQUER arquivo
  // que decida dono de linha de fechamento, e exige que cada um chame o helper.
  // Escrita a mao, a lista envelhece em silencio: closingProposalRows decidia dono
  // desde sempre e NUNCA esteve nesta varredura — foi assim que o quarto sitio
  // passou cinco dias com a regra velha sem nenhum gate reclamar.
  const CONSUMIDORES = fs
    .readdirSync(path.join(ROOT, "lib"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `lib/${f}`)
    .filter((rel) => {
      if (rel === "lib/herancaMaster.ts") return false; // o helper da precedencia
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      // closingPromoterBase PRODUZ o promoterId da chave J; nao decide dono.
      if (/export async function loadClosingPromoterBase/.test(src)) return false;
      return /loadClosingPromoterBase\(/.test(src) && /promoterId/.test(src);
    });
  console.log(`   consumidores encontrados por varredura: ${CONSUMIDORES.join(", ")}`);
  ok(
    CONSUMIDORES.length >= 3,
    "ANTI-VACUIDADE: a varredura achou os consumidores (nao lista vazia)",
    `n=${CONSUMIDORES.length}`
  );
  ok(
    CONSUMIDORES.includes("lib/closingProposalRows.ts"),
    "a varredura cobre o sitio de EXIBICAO (o que ficou de fora ate 28/08/2026)"
  );
  for (const rel of CONSUMIDORES) {
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
  // OS DOIS LADOS COMPUTADOS NO MESMO RUN — nao uma constante congelada.
  // Ate 28/08/2026 este bloco exigia `chamadas >= 3` em closingMonthly, numero
  // escrito a mao quando havia 3 sitios la. O 62f65f7 (24/08) removeu o terceiro
  // (addSeguroAvulso, campo morto) e o gate ficou VERMELHO por 4 dias sem que
  // nada estivesse errado no codigo — a constante e que apodreceu.
  // A INVARIANTE DURAVEL: em todo consumidor, todo mapa montado e CONSUMIDO, e
  // toda decisao de dono passa pelo helper. Os dois numeros saem do MESMO run.
  {
    let mapasTotal = 0;
    let chamadasTotal = 0;
    for (const rel of CONSUMIDORES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const mapas = (src.match(/buildDonoDoDiarioMap\(/g) || []).length;
      const chamadas = (src.match(/resolvePromotorEfetivo\(/g) || []).length;
      mapasTotal += mapas;
      chamadasTotal += chamadas;
      ok(
        mapas >= 1 && chamadas >= 1,
        `${rel}: monta o mapa e consome o helper`,
        `mapas=${mapas} chamadas=${chamadas}`
      );
      ok(
        chamadas >= mapas,
        `${rel}: nenhum mapa montado fica SEM uso (mapa orfao = decisao tomada fora do helper)`,
        `mapas=${mapas} chamadas=${chamadas}`
      );
    }
    console.log(`   total na arvore: mapas=${mapasTotal} chamadas=${chamadasTotal}`);
    ok(chamadasTotal >= 4, "a arvore tem os QUATRO sitios de chamada", `chamadas=${chamadasTotal}`);
  }

  // ---- 5. EXIBICAO — o QUARTO sitio (lib/closingProposalRows.ts) ----
  // A TELA nao pode contradizer o CONTRACHEQUE. Este bloco roda a funcao REAL
  // (buildClosingProposalRows, a mesma que /api/commissions/proposals chama no
  // mes fechado) e confere DE QUEM e cada linha, alem da soma.
  console.log("\n" + linha("="));
  console.log("5) EXIBICAO — buildClosingProposalRows REAL: a tela concorda com o pagamento");
  console.log(linha("="));
  const CPR = require("../lib/closingProposalRows.ts");

  // A tela inclui as RESTRITAS (SRCC="Sim", status FATURAR) alem das pagaveis —
  // buildClosingProposalRows monta `belongsToPromoter` sobre os DOIS conjuntos.
  // Comparar contra `contratos` sozinho deixava 1 linha de fora e reprovava o
  // controle positivo por recorte errado do GATE, nao por defeito do codigo.
  const restritasRR = base.restritas.filter(naoBbts);
  const linhasTela = [...contratos, ...restritasRR];
  const donoTela = await HM.buildDonoDoDiarioMap(sb, linhasTela, JUL.year, JUL.month);
  const orfasTela = linhasTela.filter((c) => !c.promoterId && String(c.contrato || "").trim());
  const donoOrfasTela = await HM.buildDonoDoDiarioMap(sb, orfasTela, JUL.year, JUL.month);

  const idPorNome = new Map();
  for (const [id, nome] of nomeDe) idPorNome.set(semAcento(nome), id);
  const pidDe = (nome) => idPorNome.get(semAcento(nome)) || null;

  // 5a. MUTACAO — os 5 contratos medidos TROCAM de dono na tela.
  //     A prova por mutacao e COMPORTAMENTAL, nao textual: para cada caso, o
  //     contrato tem de ESTAR na tela de quem recebeu a reatribuicao e ESTAR
  //     AUSENTE da tela do dono da chave. Reverter belongsToPromoter para a
  //     precedencia antiga inverte AS DUAS assercoes de cada caso.
  console.log("\n   5a) MUTACAO — os 5 contratos reatribuidos trocam de dono NA TELA");
  const telaDe = new Map();
  const alvos = new Set();
  for (const c of CASOS) {
    alvos.add(semAcento(c.deDaChave));
    alvos.add(semAcento(c.paraDoDiario));
  }
  for (const nome of alvos) {
    const pid = pidDe(nome);
    if (!pid) {
      ok(false, `promotor ${nome} existe no cadastro`, "-> AUSENTE");
      continue;
    }
    telaDe.set(nome, await CPR.buildClosingProposalRows(sb, pid, JUL.year, JUL.month));
  }
  const contratosNaTela = (nome) =>
    new Set(
      (telaDe.get(nome) || [])
        .filter((r) => r.commission_rule_source === "fechamento")
        .map((r) => String(r.contract_number).trim())
    );
  let trocaram = 0;
  for (const caso of CASOS) {
    const doDono = contratosNaTela(semAcento(caso.paraDoDiario));
    const daChave = contratosNaTela(semAcento(caso.deDaChave));
    const entrou = doDono.has(caso.ctr);
    const saiu = !daChave.has(caso.ctr);
    if (entrou && saiu) trocaram += 1;
    ok(entrou, `   ${caso.ctr}: APARECE na tela de ${caso.paraDoDiario} (quem recebeu)`);
    ok(saiu, `   ${caso.ctr}: SUMIU da tela de ${caso.deDaChave} (dono so da CHAVE J)`);
  }
  ok(trocaram === CASOS.length, "os 5 contratos trocaram de tela", `${trocaram}/${CASOS.length}`);

  // 5b. CONTROLE POSITIVO 1 — quem NAO foi reatribuido nao pode se mexer.
  //     Sem este bloco, um belongsToPromoter que devolvesse `false` para tudo
  //     passaria em 5a (o contrato sumiria da tela do dono da chave e a
  //     assercao "SUMIU" ficaria verde por vacuidade).
  //     Escolhido por VARREDURA, nao a dedo: o promotor com mais linhas de
  //     fechamento em jul/2026 que nao aparece em nenhum dos 5 casos.
  console.log("\n   5b) CONTROLE POSITIVO — promotor cuja CHAVE J E o dono nao muda nada");
  const envolvidos = new Set([...alvos]);
  const porPromotor = new Map();
  for (const c of contratos) {
    const pid = HM.resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      donoTodas
    );
    if (!pid || envolvidos.has(semAcento(nomeDe.get(pid)))) continue;
    porPromotor.set(pid, (porPromotor.get(pid) || 0) + 1);
  }
  const [pidControle, nLinhas] =
    [...porPromotor.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  ok(!!pidControle, "ANTI-VACUIDADE: ha promotor de controle fora dos 5 casos", `linhas=${nLinhas}`);
  ok(nLinhas >= 5, "ANTI-VACUIDADE: o promotor de controle tem linhas de verdade", `linhas=${nLinhas}`);
  if (pidControle) {
    console.log(`      controle = ${nomeDe.get(pidControle)} (${nLinhas} linhas de fechamento)`);
    const velhaSet = new Set(
      linhasTela
        .filter((c) => regraVelha(c, donoOrfasTela) === pidControle)
        .map((c) => String(c.contrato || "").trim())
    );
    const novaSet = new Set(
      linhasTela
        .filter(
          (c) =>
            HM.resolvePromotorEfetivo(
              { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
              donoTela
            ) === pidControle
        )
        .map((c) => String(c.contrato || "").trim())
    );
    const iguais = velhaSet.size === novaSet.size && [...velhaSet].every((k) => novaSet.has(k));
    ok(
      iguais,
      "   regra VELHA e NOVA dao o MESMO conjunto p/ o promotor de controle",
      `velha=${velhaSet.size} nova=${novaSet.size}`
    );
    const telaControle = await CPR.buildClosingProposalRows(sb, pidControle, JUL.year, JUL.month);
    const naTela = new Set(
      telaControle
        .filter((r) => r.commission_rule_source === "fechamento")
        .map((r) => String(r.contract_number).trim())
    );
    ok(naTela.size > 0, "   a tela do controle NAO esta vazia (o conserto nao zerou ninguem)", `linhas=${naTela.size}`);
    ok(
      naTela.size === novaSet.size && [...novaSet].every((k) => naTela.has(k)),
      "   a tela do controle traz exatamente as linhas da chave J dele",
      `tela=${naTela.size} esperado=${novaSet.size}`
    );
  }

  // 5c. CONTROLE POSITIVO 2 — a ORFA de chave MASTER continua casando, e o
  //     FALLBACK a chave J sobrevive. Sem eles o conserto evaporaria producao:
  //     2.787 linhas de jan-mai/2026 nao tem NENHUMA linha no diario.
  console.log("\n   5c) CONTROLE POSITIVO — ORFA de chave MASTER e FALLBACK sem diario");
  const orfasComDono = linhasTela.filter(
    (c) =>
      !c.promoterId &&
      String(c.contrato || "").trim() &&
      donoTela.get(`${c.companyId}|${String(c.contrato).trim()}`)
  );
  ok(orfasComDono.length > 0, "ANTI-VACUIDADE: jul/2026 tem orfa de chave master herdada", `orfas=${orfasComDono.length}`);
  for (const c of orfasComDono.slice(0, 3)) {
    const pid = donoTela.get(`${c.companyId}|${String(c.contrato).trim()}`);
    const tela = await CPR.buildClosingProposalRows(sb, pid, JUL.year, JUL.month);
    const achou = tela.some(
      (r) =>
        r.commission_rule_source === "fechamento" &&
        String(r.contract_number).trim() === String(c.contrato).trim()
    );
    ok(achou, `   orfa ${c.contrato} (chave ${c.chaveJ}) aparece na tela de ${nomeDe.get(pid)}`);
  }
  {
    const cSDTela = [...cSD, ...baseSD.restritas.filter(naoBbts)];
    const comChaveSD = cSDTela.filter((c) => c.promoterId);
    const pidSD = comChaveSD.length ? comChaveSD[0].promoterId : null;
    ok(!!pidSD, "ANTI-VACUIDADE: 2026-01 tem promotor resolvido pela chave J");
    if (pidSD) {
      const telaSD = await CPR.buildClosingProposalRows(sb, pidSD, SEM_DIARIO.year, SEM_DIARIO.month);
      const nSD = telaSD.filter((r) => r.commission_rule_source === "fechamento").length;
      const esperadoSD = cSDTela.filter((c) => c.promoterId === pidSD).length;
      ok(
        nSD === esperadoSD && nSD > 0,
        `   2026-01 (sem diario): ${nomeDe.get(pidSD)} exibe as linhas da chave J`,
        `tela=${nSD} esperado=${esperadoSD}`
      );
    }
  }

  // 5d. INVARIANTE DA SOMA — o conserto muda DE QUEM e a linha, nunca o TOTAL.
  //     Sigma das linhas de fechamento da tela == comissao gravada no PMR
  //     (source 'fechamento'), somando as empresas. Se o rateio quebrar, cai aqui.
  console.log("\n   5d) INVARIANTE — Sigma das linhas da tela == total do PMR gravado");
  for (const nome of alvos) {
    const pid = pidDe(nome);
    if (!pid) continue;
    const { data: pmrRows } = await sb
      .from("promoter_monthly_results")
      .select("production_commission_value, insurance_commission_value")
      .eq("promoter_id", pid)
      .eq("year", JUL.year)
      .eq("month", JUL.month)
      .eq("source", "fechamento");
    const pmrCred = (pmrRows || []).reduce((t, r) => t + Number(r.production_commission_value || 0), 0);
    const pmrSeg = (pmrRows || []).reduce((t, r) => t + Number(r.insurance_commission_value || 0), 0);
    const linhasFech = (telaDe.get(nome) || []).filter((r) => r.commission_rule_source === "fechamento");
    const telaCred = linhasFech.reduce((t, r) => t + Number(r.promoter_commission_amount || 0), 0);
    const telaSeg = linhasFech.reduce((t, r) => t + Number(r.insurance_commission_amount || 0), 0);
    console.log(
      `      ${String(nomeDe.get(pid)).padEnd(38)} PMR ${brl(pmrCred).padStart(10)}/${brl(pmrSeg).padStart(9)}` +
        `   tela ${brl(telaCred).padStart(10)}/${brl(telaSeg).padStart(9)}  (${linhasFech.length} linhas)`
    );
    ok(Math.abs(telaCred - pmrCred) < 0.02, `   ${nomeDe.get(pid)}: credito da tela == PMR`, `d=${brl(telaCred - pmrCred)}`);
    ok(Math.abs(telaSeg - pmrSeg) < 0.02, `   ${nomeDe.get(pid)}: seguro da tela == PMR`, `d=${brl(telaSeg - pmrSeg)}`);
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
