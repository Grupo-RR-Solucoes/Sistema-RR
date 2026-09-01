/*
 * GATE — VIGÊNCIA INTRA-MÊS da TRP (a TRP39 valendo a partir de 05/08/2026).
 * READ-ONLY. Não escreve nada, em lugar nenhum.
 *
 * CONTEXTO. A data de início da TRP39 (05/08/2026) só existe no e-mail da
 * Promotiva — nunca vai estar no PDF (decisão do Diego, 31/08: foi pontual e
 * não será corrigida na origem). A régua padrão (vigenciaDaCompetencia: último
 * dia útil do mês anterior → penúltimo dia útil do mês vigente) não tem como
 * derivá-la. Agosto/2026 passa a ter DUAS réguas ativas — TRP38 de 31/07 a 04/08
 * e TRP39 de 05/08 a 28/08. Medido em 31/08: 83 contratos RR até 04/08 (17
 * atingidos, -115,28 = o DANO) e 496 de 05/08 em diante (-1.397,87, legítimo).
 *
 * ESTADO (atualizado em 01/09/2026, depois da Fase 2). O índice antigo
 * uq_trp_rule_versions_active JÁ FOI DERRUBADO e o banco JÁ ACEITA vigência
 * partida (uq_trp_rule_versions_active_from + ex_trp_vigencia_sem_overlap).
 * Mesmo assim NENHUMA competência real está partida ainda: a TRP39 não subiu, e
 * só sobe na Fase 3. Por isso o CASO 1 continua rodando sobre FIXTURE — e o
 * bloco (D) diz em voz alta, a cada run, qual dos dois mundos está medindo.
 * Quando 2026-08 for partida de verdade, o (D) passa a listá-la e o CASO 1
 * ganha o par real ao lado da fixture.
 *
 * OS QUATRO BLOCOS (e por que são quatro):
 *
 *   A) TRANSIÇÃO — o resolvedor NOVO contra o resolvedor do COMMIT-BASE, os dois
 *      computados NESTE run, sobre o MESMO banco. O lado A não é constante
 *      congelada: é o arquivo real, extraído com `git show <base>:<path>` e
 *      carregado pelo _ts_register. Preferi `git show` a `git worktree` porque
 *      isola EXATAMENTE o arquivo que mudou — os imports (@/lib/trp/vigencia,
 *      @/lib/supabaseAdmin) resolvem contra a árvore atual, que não foi tocada.
 *      ASSERÇÃO DE TRANSIÇÃO: morre quando esta frente entrar em main (aí os
 *      dois lados viram o mesmo arquivo). O gate DETECTA isso e diz em voz alta,
 *      em vez de passar por vacuidade. Quem sobrevive ao merge é o bloco B.
 *
 *   B) INVARIANTE PERMANENTE — competência com UMA régua ativa resolve
 *      INDEPENDENTE da data. É a propriedade que torna esta mudança um no-op, e
 *      continua verdadeira para sempre. Mede versionId E o percentual de crédito
 *      saído do motor, dia a dia, em cada competência versionada.
 *
 *   C) O CASO CONCRETO, sobre FIXTURE — competência partida em duas fatias:
 *      03/08 e 04/08 têm de resolver a TRP38; 05/08 e 06/08, a TRP39; as
 *      fronteiras 31/07 e 28/08 idem; e um BURACO de vigência tem de FALHAR ALTO
 *      (TrpVigenciaGapError), nunca escolher "a fatia mais próxima".
 *
 *   D) AUSÊNCIA — o gate reprova quando não consegue MEDIR (sem service_role,
 *      sem TRP_SOURCE=db, zero competências versionadas, base-ref inexistente).
 *      Verde por vacuidade é o defeito que a varredura de 18/08 catalogou em 8
 *      gates; este não entra na lista.
 *
 * Uso:  node scripts/gate_trp_vigencia_intra_mes.cjs
 *       TRP_GATE_BASE_REF=<ref>  (default: origin/main)
 */
process.env.TRP_SOURCE = "db";
require("./_ts_register.cjs");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const RESOLVER_REL = "lib/trp/resolveTrpRegraDb.ts";
const BASE_REF = process.env.TRP_GATE_BASE_REF || "origin/main";

const novo = require("../lib/trp/resolveTrpRegraDb.ts");
const { calcularOperacao } = require("../lib/motor.ts");
const { vigenciaDaCompetencia, competenciaKey } = require("../lib/trp/vigencia.ts");

let falhas = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "OK " : "XX "} ${m}`);
  if (!c) falhas++;
};
const fatal = (m) => {
  console.error(`\n  XX FALHA ALTA (não consigo MEDIR): ${m}`);
  falhas++;
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function diasDaJanela(comp) {
  const { validFrom, validUntil } = vigenciaDaCompetencia(comp);
  const out = [];
  const d = new Date(`${validFrom}T00:00:00Z`);
  const fim = new Date(`${validUntil}T00:00:00Z`);
  while (d <= fim) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Carrega o resolvedor do commit-base a partir do git, sem checkout. */
function carregarResolvedorBase() {
  let sha;
  try {
    sha = execFileSync("git", ["rev-parse", "--verify", `${BASE_REF}^{commit}`], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch (e) {
    return { erro: `base-ref '${BASE_REF}' não resolve (${e.message.split("\n")[0]})` };
  }
  let fonte;
  try {
    fonte = execFileSync("git", ["show", `${sha}:${RESOLVER_REL}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return { erro: `não achei ${RESOLVER_REL} em ${BASE_REF} (${e.message.split("\n")[0]})` };
  }
  const atual = fs.readFileSync(path.join(ROOT, RESOLVER_REL), "utf8");
  const identico = fonte.replace(/\r\n/g, "\n") === atual.replace(/\r\n/g, "\n");

  // Fora do repo de propósito: dentro de scripts/ entraria no tsconfig.gates.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trp-vig-base-"));
  const arq = path.join(tmp, "resolveTrpRegraDb.base.ts");
  fs.writeFileSync(arq, fonte, "utf8");
  const mod = require(arq);
  return { mod, sha, identico, limpar: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/**
 * Client encadeável de mentira, para o CASO 1 (fixture) — sem banco.
 *
 * HONRA os .order() que o resolvedor pede, em ordem, e NÃO ordena por conta
 * própria. Isso é o que dá dente ao teste do tie-break da cascata: um stub que
 * ordenasse sozinho faria a asserção passar por construção, medindo o stub em
 * vez do código. (Foi exatamente o que aconteceu na 1ª versão deste gate: a
 * mutação que remove .order("valid_from") da cascata passou verde.)
 *
 * A ordem de entrada das linhas na fixture é, portanto, SIGNIFICATIVA: é o que
 * o Postgres devolveria sem ORDER BY.
 */
function stubClient(linhasPorCompetencia) {
  return {
    from() {
      const st = { comp: null, lt: null, limit: null, orders: [] };
      const q = {
        select() {
          return q;
        },
        eq(col, val) {
          if (col === "competencia") st.comp = val;
          return q;
        },
        lt(col, val) {
          if (col === "competencia") st.lt = val;
          return q;
        },
        order(col, opts) {
          st.orders.push([col, opts && opts.ascending === true ? 1 : -1]);
          return q;
        },
        limit(n) {
          st.limit = n;
          return q;
        },
        then(resolve) {
          let rows;
          if (st.comp) rows = (linhasPorCompetencia[st.comp] || []).slice();
          else {
            rows = [];
            for (const [c, rs] of Object.entries(linhasPorCompetencia)) {
              if (c < st.lt) rows.push(...rs);
            }
          }
          // sort ESTÁVEL (Array#sort é estável no V8) só pelas chaves pedidas.
          for (const [col, dir] of [...st.orders].reverse()) {
            rows.sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
          }
          if (st.limit) rows = rows.slice(0, st.limit);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

// ---------------------------------------------------------------------------

(async () => {
  console.log("===== GATE — vigência intra-mês da TRP (Fase 1: no-op provado) =====\n");

  // ---- D) AUSÊNCIA: sem isto, NADA foi medido -----------------------------
  console.log("===== (D) posso medir? =====");
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    fatal("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — trp_rule_versions é RLS default-deny, sem service_role não há o que medir");
    process.exit(1);
  }
  ok(process.env.TRP_SOURCE === "db", "TRP_SOURCE=db (senão o caminho DB nem é exercitado)");
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });

  const inv = await sb
    .from("trp_rule_versions")
    .select("competencia, version_no, is_active, valid_from, valid_until")
    .eq("is_active", true)
    .order("competencia", { ascending: true });
  if (inv.error) {
    fatal(`não consegui ler trp_rule_versions: ${inv.error.message}`);
    process.exit(1);
  }
  const competencias = [...new Set((inv.data || []).map((r) => competenciaKey(String(r.competencia))))];
  if (competencias.length === 0) {
    fatal("ZERO competências ativas em trp_rule_versions — o universo do bloco B seria vazio e o gate passaria por vacuidade");
    process.exit(1);
  }
  ok(true, `${competencias.length} competência(s) versionada(s): ${competencias.join(", ")}`);
  for (const r of inv.data) {
    const c = competenciaKey(String(r.competencia));
    const jan = vigenciaDaCompetencia(c);
    const propria = `${String(r.valid_from).slice(0, 10)}..${String(r.valid_until).slice(0, 10)}`;
    const janela = `${jan.validFrom}..${jan.validUntil}`;
    console.log(`       ${c} v${r.version_no}  própria ${propria}  janela ${janela}${propria === janela ? "" : "   <- RECORTADA (competência partida)"}`);
  }

  const partidasReais = competencias.filter(
    (c) => (inv.data || []).filter((r) => competenciaKey(String(r.competencia)) === c).length > 1,
  );
  console.log(
    partidasReais.length === 0
      ? "       nenhuma competência PARTIDA no banco. NÃO é mais o índice antigo impedindo — ele caiu na Fase 2 (01/09/2026); é a TRP39 que ainda não subiu. O CASO 1 roda sobre FIXTURE."
      : `       competências PARTIDAS no banco: ${partidasReais.join(", ")}`,
  );

  // ---- A) TRANSIÇÃO: novo x commit-base, no MESMO run ---------------------
  console.log(`\n===== (A) TRANSIÇÃO — resolvedor novo x ${BASE_REF}, mesmo banco, mesmo run =====`);
  const base = carregarResolvedorBase();
  if (base.erro) {
    fatal(`bloco A não pôde ser medido: ${base.erro}`);
  } else if (base.identico) {
    // Não é sucesso: é a asserção de transição tendo morrido. Dizer em voz alta.
    console.log(`  -- ${RESOLVER_REL} em ${BASE_REF} (${base.sha.slice(0, 7)}) é IDÊNTICO ao atual.`);
    console.log("  -- A asserção de TRANSIÇÃO deste bloco está MORTA (a frente entrou em main).");
    console.log("  -- Isto NÃO é uma medição. Quem prova o no-op daqui em diante é o bloco (B),");
    console.log("  -- que é invariante permanente. Aposente o bloco A, não o gate.");
  } else {
    console.log(`  -- base ${base.sha.slice(0, 7)} · comparando versionId dia a dia`);
    let pares = 0;
    let divergencias = 0;
    for (const comp of competencias) {
      const dias = diasDaJanela(comp);
      // lado A: o resolvedor antigo só sabe resolver por competência.
      const antigo = await base.mod.resolveTrpRegraDb({ competencia: comp }, sb);
      // lado B: carrega a competência 1x e escolhe por data EM MEMÓRIA — o
      // caminho REAL de produção (createTrpRegraDbPreloader faz preload async 1x
      // e getRegraSync por contrato; o motor nunca abre conexão por contrato).
      // Uma query por dia mediria a latência do banco, não o resolvedor.
      const compB = await novo.resolveTrpRegraDbCompetencia(comp, sb);
      for (const dia of dias) {
        const novoRes = novo.escolherFatia(compB, dia);
        pares++;
        const a = antigo ? antigo.versionId : null;
        const b = novoRes ? novoRes.versionId : null;
        if (a !== b) {
          divergencias++;
          if (divergencias <= 5) console.log(`     DIVERGE ${comp} ${dia}: base=${a} novo=${b}`);
        }
      }
    }
    ok(pares > 0, `${pares} par(es) (competência × dia da janela) comparados`);
    ok(divergencias === 0, `divergências de versionId contra ${BASE_REF}: ${divergencias} (esperado 0)`);
    base.limpar();
  }

  // ---- B) INVARIANTE: régua única => resolução independe da data ----------
  console.log("\n===== (B) INVARIANTE — competência de régua ÚNICA resolve independente da data =====");
  let medidos = 0;
  let quebras = 0;
  for (const comp of competencias) {
    const fatiasDaComp = (inv.data || []).filter((r) => competenciaKey(String(r.competencia)) === comp);
    if (fatiasDaComp.length !== 1) {
      console.log(`  -- ${comp} tem ${fatiasDaComp.length} fatias ativas — fora do universo desta invariante (é o CASO 1).`);
      continue;
    }
    // 1 query por competência + escolha SÍNCRONA por dia (caminho de produção).
    const carregada = await novo.resolveTrpRegraDbCompetencia(comp, sb);
    const semData = novo.escolherFatia(carregada, null);
    if (!semData) {
      fatal(`${comp} está ativa em trp_rule_versions mas o resolvedor devolveu null`);
      continue;
    }
    let quebrouComp = 0;
    for (const dia of diasDaJanela(comp)) {
      const comData = novo.escolherFatia(carregada, dia);
      medidos++;
      if (!comData || comData.versionId !== semData.versionId) {
        quebrouComp++;
        if (quebras + quebrouComp <= 5) {
          console.log(`     QUEBRA ${comp} ${dia}: sem data=${semData.versionId} com data=${comData && comData.versionId}`);
        }
      }
    }
    quebras += quebrouComp;
    ok(quebrouComp === 0, `${comp}: ${diasDaJanela(comp).length} dias resolvem a MESMA versão (v${semData.versionNo})`);
  }
  ok(medidos > 0, `${medidos} dia(s) medidos no total (universo não-vazio)`);
  ok(quebras === 0, `quebras da invariante: ${quebras} (esperado 0)`);

  // ---- B2) o percentual do MOTOR também não se move ------------------------
  console.log("\n===== (B2) INVARIANTE no DINHEIRO — percentual do motor, dia a dia =====");
  const compAlvo = competencias[competencias.length - 1];
  const fatiasAlvo = (inv.data || []).filter((r) => competenciaKey(String(r.competencia)) === compAlvo);
  if (fatiasAlvo.length !== 1) {
    console.log(`  -- ${compAlvo} está partida; bloco B2 usa competência de régua única.`);
  } else {
    const { buildTrpCreditProvider } = require("../lib/trp/creditTrpProvider.ts");
    const dias = diasDaJanela(compAlvo);
    const provider = await buildTrpCreditProvider(dias, sb);
    if (!provider) {
      fatal("buildTrpCreditProvider devolveu undefined com TRP_SOURCE=db — o caminho DB não foi exercitado");
    } else {
      // Um contrato-sonda IDÊNTICO em todos os dias: só a data muda. Se o
      // percentual variar, a escolha de fatia mexeu no dinheiro.
      const sonda = {
        valor_liquido: 10000,
        taxa_juros: 1.75,
        prazo: 84,
        production_value: 5_000_000,
        product_name: "CONSIGNADO INSS",
        operation_type: "NOVO",
      };
      const pcts = new Set();
      for (const dia of dias) {
        const r = calcularOperacao({ ...sonda, contract_date: dia }, { trpProvider: provider });
        pcts.add(Number(r.credito.percentual).toFixed(8));
      }
      ok(
        pcts.size === 1,
        `sonda idêntica em ${dias.length} dias de ${compAlvo}: ${pcts.size} percentual(is) distinto(s) — esperado 1 [${[...pcts].join(", ")}]`,
      );
    }
  }

  // ---- C) O CASO CONCRETO, sobre FIXTURE ----------------------------------
  console.log("\n===== (C) CASO CONCRETO (fixture) — 2026-08 partida: TRP38 até 04/08, TRP39 de 05/08 =====");
  const V38 = "aaaaaaaa-0000-0000-0000-000000000038";
  const V39 = "bbbbbbbb-0000-0000-0000-000000000039";
  const regra38 = { _meta: { competencia: "2026-08", regime: "VOLUME_5_FAIXAS", trp: "TRP38" } };
  const regra39 = { _meta: { competencia: "2026-08", regime: "VOLUME_5_FAIXAS", trp: "TRP39" } };
  const fx = stubClient({
    "2026-08-01": [
      { id: V38, competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-04", regra_json: regra38 },
      { id: V39, competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-28", regra_json: regra39 },
    ],
  });

  for (const [dia, esperado, rotulo] of [
    ["2026-07-31", V38, "TRP38 (fronteira de abertura)"],
    ["2026-08-03", V38, "TRP38"],
    ["2026-08-04", V38, "TRP38 (último dia da fatia)"],
    ["2026-08-05", V39, "TRP39 (primeiro dia da fatia)"],
    ["2026-08-06", V39, "TRP39"],
    ["2026-08-28", V39, "TRP39 (fronteira de fechamento)"],
  ]) {
    const r = await novo.resolveTrpRegraDb({ competencia: "2026-08", contractDate: dia }, fx);
    ok(r && r.versionId === esperado, `${dia} -> ${rotulo}  [obtido ${r ? r.regra._meta.trp : "null"}]`);
    if (r) ok(r.competenciaPartida === true, `${dia} carimba competenciaPartida=true (o PMR grava NULL + trp_multi_versao)`);
  }

  const semDataPartida = await novo.resolveTrpRegraDb({ competencia: "2026-08" }, fx);
  ok(
    semDataPartida && semDataPartida.versionId === V39,
    `sem data -> a fatia de MAIOR valid_from (TRP39)  [obtido ${semDataPartida ? semDataPartida.regra._meta.trp : "null"}]`,
  );

  // BURACO: a fatia de 03/08 não existe. Tem de FALHAR ALTO, não escolher perto.
  const fxBuraco = stubClient({
    "2026-08-01": [
      { id: V39, competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-28", regra_json: regra39 },
    ],
  });
  let lancou = null;
  try {
    await novo.resolveTrpRegraDb({ competencia: "2026-08", contractDate: "2026-08-03" }, fxBuraco);
  } catch (e) {
    lancou = e;
  }
  ok(
    lancou instanceof novo.TrpVigenciaGapError,
    `buraco de vigência (03/08 sem fatia) LANÇA TrpVigenciaGapError em vez de pagar pela régua errada  [${lancou ? lancou.name : "NÃO LANÇOU"}]`,
  );

  // BURACO A DIREITA: a ultima fatia termina ANTES do fim da janela (28/08) e um
  // contrato cai no vao. Sem esta assercao, o rowValidUntil da linha nao seria
  // carregado por NADA — a busca em ordem decrescente acerta a fatia mesmo com o
  // limite superior errado, e uma mutacao que trocasse rowValidUntil pela janela
  // do mes passava VERDE (medido: mutacao M5, 31/08).
  const fxBuracoDireita = stubClient({
    "2026-08-01": [
      { id: V38, competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-04", regra_json: regra38 },
      { id: V39, competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-20", regra_json: regra39 },
    ],
  });
  let lancouDir = null;
  try {
    await novo.resolveTrpRegraDb({ competencia: "2026-08", contractDate: "2026-08-25" }, fxBuracoDireita);
  } catch (e) {
    lancouDir = e;
  }
  ok(
    lancouDir instanceof novo.TrpVigenciaGapError,
    `buraco à DIREITA (última fatia acaba 20/08, contrato de 25/08) LANÇA em vez de esticar a régua  [${lancouDir ? lancouDir.name : "NÃO LANÇOU"}]`,
  );

  // Régua única na fixture: a data não pode mudar nada (a invariante, offline).
  const fxUnica = stubClient({
    "2026-08-01": [
      { id: V39, competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-28", regra_json: regra39 },
    ],
  });
  const ids = new Set();
  for (const dia of ["2026-07-31", "2026-08-03", "2026-08-05", "2026-08-28"]) {
    const r = await novo.resolveTrpRegraDb({ competencia: "2026-08", contractDate: dia }, fxUnica);
    ids.add(r && r.versionId);
  }
  const semDataUnica = await novo.resolveTrpRegraDb({ competencia: "2026-08" }, fxUnica);
  ids.add(semDataUnica && semDataUnica.versionId);
  ok(ids.size === 1 && ids.has(V39), `régua ÚNICA cobrindo a janela: 4 datas + sem-data resolvem a MESMA versão (${ids.size} distinta(s))`);
  ok(semDataUnica.competenciaPartida === false, "régua única carimba competenciaPartida=false");

  // Cascata com a competência ANTERIOR partida: vale a ÚLTIMA fatia dela.
  // ORDEM DE ENTRADA DELIBERADA: a fatia ERRADA (TRP38) vem primeiro. Sem o
  // .order("valid_from") da cascata, o .limit(1) pegaria ela — e é o que este
  // caso tem de acusar. Foi assim que a mutação do tie-break passou a reprovar.
  const fxCascata = stubClient({
    "2026-08-01": [
      { id: V38, competencia: "2026-08-01", version_no: 1, valid_from: "2026-07-31", valid_until: "2026-08-04", regra_json: regra38 },
      { id: V39, competencia: "2026-08-01", version_no: 2, valid_from: "2026-08-05", valid_until: "2026-08-28", regra_json: regra39 },
    ],
  });
  const casc = await novo.resolveTrpRegraDb({ competencia: "2026-09" }, fxCascata);
  ok(
    casc && casc.versionId === V39 && casc.isFallback === true,
    `cascata de 2026-09 sobre agosto PARTIDO pega a ÚLTIMA fatia (TRP39), não uma arbitrária  [obtido ${casc ? casc.regra._meta.trp : "null"}, fallback=${casc && casc.isFallback}]`,
  );

  console.log(`\n===== RESULTADO: ${falhas === 0 ? "PASSOU" : `${falhas} FALHA(S)`} =====`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\nXX ERRO NÃO TRATADO:", e && e.stack ? e.stack : e);
  process.exit(1);
});
