/* ============================================================================
 * carteira_consorcio_dono_ancora_gate — a carteira do promotor sai da ANCORA,
 * nao da coluna defasada.
 *
 * Rodar:
 *   node scripts/carteira_consorcio_dono_ancora_gate.cjs
 *
 * A INVARIANTE: quem e dono da parcela e a ANCORA (product_line_assignments, via
 * resolveConsorcioBeneficiarioByProposta) — a MESMA fonte que o pagamento e o
 * detalhamento usam. A coluna carteira_consorcio.promoter_id NAO decide nada.
 *
 * O DEFEITO (medido em 23/08/2026): a rota
 * app/api/promotores/consorcio-carteira filtrava por
 * `.eq("promoter_id", promoterId)`. Essa coluna e um RETRATO DO IMPORT —
 * materializarCarteiraConsorcio so roda no import de fechamento, e atribuir na
 * fila nao re-materializa. Resultado: 27 ancoras ASSIGNED contra 316 linhas de
 * carteira com promoter_id NULO, e a carteira do promotor (PromotorView:517)
 * aparecia VAZIA para todo mundo, com a atribuicao feita e o PMR pagando certo.
 *
 * O gate exercita `filtrarCarteiraDoPromotor`, a MESMA funcao que a rota chama —
 * nao uma copia da regra.
 *
 * OS BLOCOS:
 *   1. PURO        — a regra de dono sobre um conjunto fabricado: promotor dono
 *                    recebe, promotor sem ancora recebe vazio, A nao recebe de B,
 *                    proposta de GESTAO nao vai para promotor nenhum.
 *   2. CONTRAPROVA — o filtro ANTIGO (pela coluna) devolve VAZIO no mesmo
 *                    conjunto. Sem este bloco o gate nao distingue "o conserto
 *                    funciona" de "nao havia defeito".
 *   3. BANCO       — contra producao: quem tem ancora recebe parcela, quem nao
 *                    tem recebe vazio, e nenhuma parcela aparece para dois.
 * ========================================================================== */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const {
  resolveConsorcioBeneficiarioByProposta,
  chaveProposta,
} = require("../lib/consorcio/fila.ts");
const { filtrarCarteiraDoPromotor } = require("../lib/consorcio/carteira.ts");

const linha = (c) => c.repeat(78);
let falhas = 0;
const ok = (cond, rotulo, extra) => {
  console.log(`   ${cond ? "OK    " : "FALHOU"} | ${rotulo}${extra ? "  " + extra : ""}`);
  if (!cond) falhas++;
};

const A = "prom-A";
const B = "prom-B";
const G = "gestao-1";
const CO = "co-1";

(async () => {
  // ---- 1. PURO ----
  console.log(linha("="));
  console.log("1) PURO — o dono sai da ancora, sobre conjunto fabricado");
  console.log(linha("="));
  // promoter_id NULO nas cinco, como esta na producao: se a funcao voltar a ler
  // a coluna, este bloco reprova na hora.
  const carteira = [
    { company_id: CO, proposta: "P-A", posicao: 1, promoter_id: null },
    { company_id: CO, proposta: "P-A", posicao: 2, promoter_id: null },
    { company_id: CO, proposta: "P-B", posicao: 1, promoter_id: null },
    { company_id: CO, proposta: "P-GESTAO", posicao: 1, promoter_id: null },
    { company_id: CO, proposta: "P-ORFA", posicao: 1, promoter_id: null },
  ];
  const dono = new Map([
    [chaveProposta(CO, "P-A"), { kind: "promotor", id: A }],
    [chaveProposta(CO, "P-B"), { kind: "promotor", id: B }],
    [chaveProposta(CO, "P-GESTAO"), { kind: "gestao", id: G }],
    // P-ORFA de proposito FORA do mapa (ancora PENDING).
  ]);

  const daA = filtrarCarteiraDoPromotor(carteira, dono, A);
  const daB = filtrarCarteiraDoPromotor(carteira, dono, B);
  const semAncora = filtrarCarteiraDoPromotor(carteira, dono, "prom-SEM-NADA");
  console.log(`   A: ${daA.length}  B: ${daB.length}  promotor sem ancora: ${semAncora.length}`);
  ok(daA.length === 2, "ANTI-VACUIDADE: A recebe as 2 parcelas da proposta dele", `${daA.length}`);
  ok(daA.every((r) => r.proposta === "P-A"), "e SO as dele");
  ok(daB.length === 1, "B recebe a dele", `${daB.length}`);
  ok(
    !daA.some((r) => daB.some((x) => x.proposta === r.proposta)),
    "A nao recebe parcela de B"
  );
  ok(semAncora.length === 0, "promotor SEM ancora recebe VAZIO", `${semAncora.length}`);
  ok(
    !daA.some((r) => r.proposta === "P-GESTAO") && !daB.some((r) => r.proposta === "P-GESTAO"),
    "proposta de GESTAO nao vai para promotor nenhum"
  );
  ok(
    !daA.some((r) => r.proposta === "P-ORFA") && !daB.some((r) => r.proposta === "P-ORFA"),
    "proposta com ancora PENDING nao vai para ninguem"
  );
  ok(filtrarCarteiraDoPromotor(carteira, dono, "").length === 0, "promoterId vazio -> vazio");

  // ---- 2. CONTRAPROVA ----
  console.log("\n" + linha("="));
  console.log("2) CONTRAPROVA — o filtro pela COLUNA nao acha nada");
  console.log(linha("="));
  const filtroAntigo = (rows, pid) => rows.filter((r) => r.promoter_id === pid);
  const antigoA = filtroAntigo(carteira, A);
  console.log(`   filtro antigo (.eq promoter_id) para A: ${antigoA.length} linha(s)`);
  ok(
    antigoA.length === 0,
    "o filtro ANTIGO devolve VAZIO com a coluna nula (era o defeito)",
    `${antigoA.length}`
  );
  ok(
    daA.length > 0 && antigoA.length === 0,
    "MESMO conjunto: ancora acha 2, coluna acha 0 (o teste tem poder)",
    `${daA.length} x ${antigoA.length}`
  );

  // ---- 3. BANCO ----
  console.log("\n" + linha("="));
  console.log("3) BANCO — contra producao");
  console.log(linha("="));
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const [carteiraRes, donoReal] = await Promise.all([
    sb.from("carteira_consorcio").select("company_id, proposta, posicao, promoter_id"),
    resolveConsorcioBeneficiarioByProposta(sb),
  ]);
  const linhasCarteira = carteiraRes.data || [];
  const total = linhasCarteira.length;
  const comColuna = linhasCarteira.filter((r) => r.promoter_id).length;
  const donosPromotor = [...donoReal.values()].filter((b) => b.kind === "promotor");
  console.log(
    `   carteira: ${total} linhas (${comColuna} com promoter_id gravado)  ` +
      `ancoras ASSIGNED: ${donoReal.size} (${donosPromotor.length} de promotor)`
  );
  ok(total > 0, "ANTI-VACUIDADE: ha linha na carteira", `${total}`);
  ok(donoReal.size > 0, "ANTI-VACUIDADE: ha ancora ASSIGNED", `${donoReal.size}`);

  // ANTI-VACUIDADE FORTE: ha ancora ASSIGNED QUE TEM parcela na carteira.
  const propostasNaCarteira = new Set(
    linhasCarteira.map((r) => chaveProposta(r.company_id, r.proposta))
  );
  const ancorasComParcela = [...donoReal.entries()].filter(
    ([k, b]) => b.kind === "promotor" && propostasNaCarteira.has(k)
  );
  ok(
    ancorasComParcela.length > 0,
    "ANTI-VACUIDADE: ha ancora de PROMOTOR com parcela na carteira",
    `${ancorasComParcela.length}`
  );

  const pids = [...new Set(ancorasComParcela.map(([, b]) => b.id))];
  let comLinha = 0;
  const vistas = new Map();
  for (const pid of pids) {
    const minhas = filtrarCarteiraDoPromotor(linhasCarteira, donoReal, pid);
    if (minhas.length > 0) comLinha += 1;
    for (const r of minhas) {
      const k = `${r.company_id}|${r.proposta}|${r.posicao}`;
      const s = vistas.get(k) || new Set();
      s.add(pid);
      vistas.set(k, s);
    }
  }
  console.log(`   promotores com ancora+parcela: ${pids.length}  com linha: ${comLinha}`);
  ok(comLinha === pids.length, "TODOS recebem as parcelas deles", `${comLinha}/${pids.length}`);
  const duplicadas = [...vistas.entries()].filter(([, s]) => s.size > 1);
  ok(duplicadas.length === 0, "NENHUMA parcela aparece para dois promotores", `${duplicadas.length}`);

  const antigoTotal = pids.reduce(
    (a, pid) => a + linhasCarteira.filter((r) => r.promoter_id === pid).length,
    0
  );
  const novoTotal = pids.reduce(
    (a, pid) => a + filtrarCarteiraDoPromotor(linhasCarteira, donoReal, pid).length,
    0
  );
  console.log(`   parcelas entregues — filtro antigo: ${antigoTotal}   pela ancora: ${novoTotal}`);
  ok(novoTotal > 0, "a carteira do promotor deixou de vir vazia", `${novoTotal} parcelas`);
  if (comColuna === 0) {
    ok(
      antigoTotal === 0,
      "CONTRAPROVA em producao: o filtro antigo entregaria ZERO (a coluna esta nula)",
      `${antigoTotal}`
    );
  } else {
    console.log(
      "   (a coluna ja foi re-materializada; a contraprova pelo estado defasado\n" +
        "    nao se aplica mais — os blocos 1 e 2 seguem cobrindo a regra)"
    );
  }

  const { data: todosProms } = await sb.from("promoters").select("id").limit(200);
  const semAncoraReal = (todosProms || []).map((p) => p.id).filter((id) => !pids.includes(id));
  if (semAncoraReal.length > 0) {
    const r = filtrarCarteiraDoPromotor(linhasCarteira, donoReal, semAncoraReal[0]);
    ok(r.length === 0, "promotor SEM ancora recebe vazio (producao)", `${r.length}`);
  }

  console.log("\n" + linha("="));
  console.log(falhas === 0 ? "GATE: PASSOU" : `GATE: ${falhas} FALHA(S)`);
  console.log(linha("="));
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
