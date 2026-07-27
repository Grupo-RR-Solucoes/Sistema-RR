// ============================================================================
// SONDA — o 2882 esta sendo roteado para a tabela do INSS?
//
// Hipotese do Diego: 2882 (CONSIGNADO CORRENTISTA NOVO) e consignado generico,
// nao INSS. Se o roteador o mandar para INSS por padrao, um contrato de 108
// parcelas falha o lookup — a tabela do INSS vale "48 a 84 meses", enquanto
// Demais Convenios Publicos vai ate 120.
//
// O QUE O CODIGO JA DIZ (lib/motor.ts:415): o roteamento para INSS acontece
// por convenio 1640 OU descricao contendo "INSS" — NAO pelo codigo do produto.
// Sem esses dois, a linha cai em PUBLICO_GERAL ou PRIVADO (motor.ts:427).
//
// Entao a pergunta que so o dado responde: as 99 linhas do 2882 com prazo
// 108/96 tem convenio 1640, ou descricao com "INSS"? Se tiverem, a hipotese se
// confirma. Se nao, o roteamento esta certo e a causa e outra.
//
// Somente leitura.
// ============================================================================
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

for (const arquivo of [".env", ".env.local"]) {
  const p = path.join(__dirname, "..", arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const CHAVES_AVISTA = ["% A VISTA", "% À VISTA", "% A VISTA EMPRESA", "% AVISTA", "Percentual A Vista"];
function temTaxa(r) {
  const raw = r.raw_payload || {};
  for (const k of CHAVES_AVISTA) {
    if (raw[k] != null && String(raw[k]).trim() !== "") {
      const n = Number(String(raw[k]).replace("%", "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) return true;
    }
  }
  return r.company_received_percent != null && Number(r.company_received_percent) > 0;
}

const norm = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// Espelha inferCreditTable SO no ramo que interessa (motor.ts:415 e :427).
function rotaProvavel(r) {
  const desc = norm(r.product_description);
  const conv = String(r.convenio_code ?? "").trim();
  if (conv === "1640" || desc.includes("INSS")) return "INSS_*";
  if (conv === "1078" || desc.includes("SIAPE") || desc.includes("MPDG")) return "SIAPE";
  return "PUBLICO_GERAL / PRIVADO";
}

async function lerTudo(colunas, filtros) {
  const passo = 1000;
  let de = 0;
  const saida = [];
  for (;;) {
    let q = supabase.from("daily_production_records").select(colunas).range(de, de + passo - 1);
    for (const f of filtros) q = q[f.op](...f.args);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

(async () => {
  const linhas = await lerTudo(
    "movement_date, status, product_code, product_description, convenio_code, convenio_segment, term_months, net_value, company_received_percent, raw_payload",
    [
      { op: "gte", args: ["movement_date", "2026-03-01"] },
      { op: "lt", args: ["movement_date", "2026-08-10"] },
    ]
  );

  const emProducao = linhas.filter((r) => norm(r.status).includes("PRODUC"));
  const semTaxa = emProducao.filter((r) => !temTaxa(r));
  const do2882 = semTaxa.filter((r) => String(r.product_code) === "2882");

  console.log("=".repeat(76));
  console.log("SONDA — roteamento do produto 2882");
  console.log("=".repeat(76));
  console.log(`linhas em Producao: ${emProducao.length} · sem taxa: ${semTaxa.length} · sem taxa e 2882: ${do2882.length}\n`);

  console.log("DESCRICAO do 2882 (todas as linhas do produto, com ou sem taxa):");
  const descr = new Map();
  for (const r of emProducao.filter((r) => String(r.product_code) === "2882")) {
    const k = String(r.product_description || "(vazia)");
    descr.set(k, (descr.get(k) || 0) + 1);
  }
  for (const [k, n] of [...descr.entries()].sort((a, b) => b[1] - a[1])) {
    const temInss = norm(k).includes("INSS") ? "  <-- CONTEM 'INSS'" : "";
    console.log(`  ${String(n).padStart(4)} x  ${k}${temInss}`);
  }

  console.log("\nCONVENIO das linhas 2882 SEM taxa:");
  const conv = new Map();
  for (const r of do2882) {
    const k = `${r.convenio_code ?? "(nulo)"} · ${r.convenio_segment ?? "-"}`;
    if (!conv.has(k)) conv.set(k, { n: 0, net: 0, prazos: new Set() });
    const a = conv.get(k);
    a.n += 1;
    a.net += Number(r.net_value || 0);
    a.prazos.add(r.term_months);
  }
  for (const [k, v] of [...conv.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const inss = k.startsWith("1640") ? "  <-- CONVENIO INSS" : "";
    console.log(
      `  ${String(v.n).padStart(4)} linhas · R$ ${v.net.toLocaleString("pt-BR", { minimumFractionDigits: 2 }).padStart(14)} · conv ${k}${inss}`
    );
    console.log(`         prazos: ${[...v.prazos].sort((a, b) => a - b).join(", ")}`);
  }

  console.log("\nROTA PROVAVEL (espelhando motor.ts:415/427) das 2882 sem taxa:");
  const rotas = new Map();
  for (const r of do2882) {
    const k = rotaProvavel(r);
    if (!rotas.has(k)) rotas.set(k, { n: 0, prazoMaior84: 0 });
    const a = rotas.get(k);
    a.n += 1;
    if (Number(r.term_months) > 84) a.prazoMaior84 += 1;
  }
  for (const [k, v] of rotas.entries()) {
    console.log(`  ${k.padEnd(26)} ${String(v.n).padStart(4)} linhas · com prazo > 84: ${v.prazoMaior84}`);
  }

  console.log("\nCOMPARACAO — linhas 2882 COM taxa (as que funcionam):");
  const com2882 = emProducao.filter((r) => String(r.product_code) === "2882" && temTaxa(r));
  const rotasOk = new Map();
  for (const r of com2882) {
    const k = `${rotaProvavel(r)} | prazo ${Number(r.term_months) > 84 ? ">84" : "<=84"}`;
    rotasOk.set(k, (rotasOk.get(k) || 0) + 1);
  }
  for (const [k, n] of [...rotasOk.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} x  ${k}`);
  }

  console.log("\nAMOSTRA de 5 linhas 2882 sem taxa:");
  for (const r of do2882.slice(0, 5)) {
    console.log(
      `  ${r.movement_date} · prazo ${r.term_months} · conv ${r.convenio_code ?? "nulo"} · seg ${r.convenio_segment ?? "-"} · ${r.product_description}`
    );
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
