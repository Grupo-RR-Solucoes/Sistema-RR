// ============================================================================
// PROBE 3a — da para recortar COMISSAO por dia, como ja se recorta producao?
//
// A tese do Diego: hoje comissao bruta e comissao de seguro caem em mes-cheio
// porque a ponta M-1 vem de agregado mensal (fechamento_mensal_empresa /
// cms_promoter_entries), que nao tem data por linha. Mas o daily de junho
// existe. Se a comissao for calculavel POR REGISTRO, recortar 1..N e possivel
// nas duas pontas.
//
// O QUE ESTE PROBE MEDE (nao opina, conta):
//   1. Ha daily nas duas competencias? Quantas linhas, que dias cobrem?
//   2. A comissao-EMPRESA e por registro? Ou seja: quantos registros carregam
//      a propria taxa a vista (raw_payload "% A VISTA" ou company_received_
//      percent), e quantos dependem do derive — que usa a producao MENSAL do
//      grupo e portanto muda quando a janela encolhe.
//   3. As colunas de comissao do promotor/seguro vem preenchidas no daily?
//   4. Quanto da o mes cheio pelo daily contra o fechamento (ground truth)?
//      Se divergir muito, o M-1 do card nao bate com o numero que o Diego
//      conhece — e isso precisa ser dito, nao escondido.
//
// Somente leitura. Nao grava nada.
// ============================================================================
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function carregarEnv() {
  // .env.local ganha do .env (mesma precedencia do Next).
  for (const arquivo of [".env", ".env.local"]) {
    const p = path.join(__dirname, "..", arquivo);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
carregarEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const brl = (n) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Espelha toPercentRate: aceita 5,8 (percentual) ou 0,058 (fracao).
function taxa(v) {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace("%", "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

const CHAVES_AVISTA = [
  "% A VISTA",
  "% À VISTA",
  "% A VISTA EMPRESA",
  "% AVISTA",
  "Percentual A Vista",
];

function taxaDoPayload(raw) {
  if (!raw || typeof raw !== "object") return 0;
  for (const k of CHAVES_AVISTA) {
    if (raw[k] != null) {
      const t = taxa(raw[k]);
      if (t > 0) return t;
    }
  }
  return 0;
}

async function lerTudo(tabela, colunas, filtros) {
  const passo = 1000;
  let de = 0;
  const out = [];
  for (;;) {
    let q = supabase.from(tabela).select(colunas).range(de, de + passo - 1);
    for (const f of filtros || []) q = q[f.op](...f.args);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return out;
}

// Elegibilidade: espelha isProductionStatus + descarte de cancelado/SRCC do
// dashboard. Aproximacao declarada — a implementacao real reusa os helpers.
function elegivel(r) {
  const st = String(r.status || "").toUpperCase();
  const producao = st.includes("PRODUC") || st.includes("PRODUÇ");
  if (!producao) return false;
  if (r.cancellation_date) return false;
  if (r.is_srcc_restricted === true) return false;
  return true;
}

function competenciaDe(mov) {
  const s = String(mov || "");
  if (s.length < 7) return null;
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
}

(async () => {
  const COMPS = [
    { year: 2026, month: 6, nome: "junho/2026" },
    { year: 2026, month: 7, nome: "julho/2026" },
  ];

  const linhas = await lerTudo(
    "daily_production_records",
    "company_id, status, is_srcc_restricted, net_value, movement_date, cancellation_date, company_received_percent, promoter_commission_amount, insurance_commission_amount, insurance_value, has_insurance, raw_payload",
    [{ op: "gte", args: ["movement_date", "2026-05-25"] }, { op: "lt", args: ["movement_date", "2026-08-10"] }]
  );

  console.log("=".repeat(74));
  console.log("PROBE 3a — comissao recortavel por dia?");
  console.log("=".repeat(74));
  console.log(`linhas lidas no intervalo 2026-05-25..2026-08-10: ${linhas.length}`);

  for (const comp of COMPS) {
    const doMes = linhas.filter((r) => {
      const c = competenciaDe(r.movement_date);
      return c && c.year === comp.year && c.month === comp.month;
    });
    const validas = doMes.filter(elegivel);

    const dias = new Set(
      validas.map((r) => Number(String(r.movement_date).slice(8, 10))).filter((d) => d >= 1 && d <= 31)
    );
    const diasOrdenados = [...dias].sort((a, b) => a - b);

    let comTaxaPropria = 0;
    let semTaxaPropria = 0;
    let netComTaxa = 0;
    let netSemTaxa = 0;
    let comissaoEmpresaPropria = 0;
    let promotorSoma = 0;
    let promotorNulos = 0;
    let seguroSoma = 0;
    let seguroNulos = 0;

    for (const r of validas) {
      const net = num(r.net_value);
      const t = taxaDoPayload(r.raw_payload) || taxa(r.company_received_percent);
      const usavel = t > 0 && t <= 0.065;
      if (usavel) {
        comTaxaPropria += 1;
        netComTaxa += net;
        comissaoEmpresaPropria += net * Math.min(t, 0.058);
      } else {
        semTaxaPropria += 1;
        netSemTaxa += net;
      }
      if (r.promoter_commission_amount == null) promotorNulos += 1;
      else promotorSoma += num(r.promoter_commission_amount);
      if (r.insurance_commission_amount == null) seguroNulos += 1;
      else seguroSoma += num(r.insurance_commission_amount);
    }

    const net = validas.reduce((s, r) => s + num(r.net_value), 0);

    console.log("\n" + "-".repeat(74));
    console.log(`${comp.nome}`);
    console.log("-".repeat(74));
    console.log(`  linhas na competencia .......... ${doMes.length} (elegiveis: ${validas.length})`);
    console.log(`  dias-do-mes com dado ........... ${diasOrdenados.length ? `${diasOrdenados[0]}..${diasOrdenados[diasOrdenados.length - 1]} (${diasOrdenados.length} dias)` : "NENHUM"}`);
    console.log(`  producao (net) ................. R$ ${brl(net)}`);
    console.log("");
    console.log(`  TAXA A VISTA POR REGISTRO (define se da para recortar):`);
    console.log(`    com taxa propria ............. ${comTaxaPropria} linhas · R$ ${brl(netComTaxa)} de net`);
    console.log(`    SEM taxa (cai no derive) ..... ${semTaxaPropria} linhas · R$ ${brl(netSemTaxa)} de net`);
    const pctSem = validas.length ? (semTaxaPropria / validas.length) * 100 : 0;
    console.log(`    -> ${pctSem.toFixed(1)}% das linhas dependem da producao MENSAL do grupo`);
    console.log(`    comissao-empresa das linhas com taxa propria: R$ ${brl(comissaoEmpresaPropria)}`);
    console.log("");
    console.log(`  COLUNAS DE COMISSAO NO DAILY:`);
    console.log(`    promoter_commission_amount ... soma R$ ${brl(promotorSoma)} · nulos: ${promotorNulos}/${validas.length}`);
    console.log(`    insurance_commission_amount .. soma R$ ${brl(seguroSoma)} · nulos: ${seguroNulos}/${validas.length}`);

    // Recorte 1..N para N = ultimo dia com dado da competencia corrente.
    for (const n of [15, 20, 23, 25]) {
      const cortadas = validas.filter((r) => {
        const d = Number(String(r.movement_date).slice(8, 10));
        return d >= 1 && d <= n;
      });
      const netN = cortadas.reduce((s, r) => s + num(r.net_value), 0);
      const promN = cortadas.reduce((s, r) => s + num(r.promoter_commission_amount), 0);
      const segN = cortadas.reduce((s, r) => s + num(r.insurance_commission_amount), 0);
      console.log(
        `  corte 1-${String(n).padStart(2)} .... ${String(cortadas.length).padStart(4)} linhas · net R$ ${brl(netN).padStart(14)} · com.promotor R$ ${brl(promN).padStart(12)} · seguro R$ ${brl(segN).padStart(10)}`
      );
    }
  }

  // ---- ground truth do fechamento, para medir a distancia ----
  console.log("\n" + "=".repeat(74));
  console.log("GROUND TRUTH (fechamento_mensal_empresa) — o M-1 que o card usa hoje");
  console.log("=".repeat(74));
  const fech = await lerTudo(
    "fechamento_mensal_empresa",
    "ano, mes, valor_avista, valor_seguro",
    [{ op: "in", args: ["mes", [6, 7]] }, { op: "eq", args: ["ano", 2026] }]
  );
  for (const m of [6, 7]) {
    const doMes = fech.filter((r) => Number(r.mes) === m);
    const avista = doMes.reduce((s, r) => s + num(r.valor_avista), 0);
    const seguro = doMes.reduce((s, r) => s + num(r.valor_seguro), 0);
    console.log(
      `  ${String(m).padStart(2, "0")}/2026 · linhas ${doMes.length} · valor_avista R$ ${brl(avista)} · valor_seguro R$ ${brl(seguro)}`
    );
  }
  console.log("");
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
