// ============================================================================
// SONDA — as linhas sem taxa que estao ACIMA do piso de prazo da categoria.
//
// As abaixo do piso ja estao resolvidas: prazo minimo e condicao de
// elegibilidade (TRP pag.3), pisos catalogados no D29, com precedente do Diego
// em 01/06. Zerar ali e CORRETO.
//
// Sobram as que passam do piso e mesmo assim ficaram sem taxa. Para o INSS o
// caso e gritante: a TRP38 TEM celula "Acima de 84" (3,21 / 3,23 / 3,34 /
// 3,48 / 3,52). Se a linha esta sem taxa, nao e piso — e falha de busca.
//
// O que a sonda faz:
//   1. lista as linhas do INSS com prazo > 84
//   2. generaliza: TODAS as linhas sem taxa acima do piso da propria categoria
//   3. abre a regua versionada (trp_rule_versions) das competencias envolvidas
//      e mostra se a faixa "Acima de 84" existe de fato no JSON
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

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
// Espelha normalizeConvenioCode do motor: mata zeros a esquerda.
const convNorm = (v) => {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const n = Math.trunc(Number(t));
  return Number.isFinite(n) && n >= 0 ? String(n) : t;
};
const CHAVES = ["% A VISTA", "% À VISTA", "% A VISTA EMPRESA", "% AVISTA", "Percentual A Vista"];
function temTaxa(r) {
  const raw = r.raw_payload || {};
  for (const k of CHAVES) {
    if (raw[k] != null && String(raw[k]).trim() !== "") {
      const n = Number(String(raw[k]).replace("%", "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) return true;
    }
  }
  return r.company_received_percent != null && Number(r.company_received_percent) > 0;
}
const RENOV = ["2881", "2891", "2890", "2996"];
const SP_MG = new Set(["1075", "1076", "1077", "1079", "1080"]);

/** Aproximacao de inferCreditTable, AGORA com normalizacao de convenio. */
function tabela(r) {
  const prod = String(r.product_code ?? "").trim();
  const desc = norm(r.product_description);
  const conv = convNorm(r.convenio_code);
  const renov = RENOV.includes(prod);
  if (desc.includes("FGTS")) return "FGTS";
  if (desc.includes("13")) return "ADIANTAMENTO_13";
  if (prod === "2787" || prod === "2887" || desc.includes("PORTABILIDADE")) return "PORTABILIDADE";
  if (conv === "1640" || desc.includes("INSS")) return renov ? "INSS_RENOVACAO" : "INSS_NOVO";
  if (conv === "1078" || desc.includes("SIAPE") || desc.includes("MPDG")) return "SIAPE";
  if (SP_MG.has(conv)) return "SP_MG";
  return "PUBLICO_GERAL/PRIVADO";
}

/** Pisos catalogados no D29 (condicao de elegibilidade, TRP pag.3). */
const PISO = {
  INSS_NOVO: 48,
  INSS_RENOVACAO: 48,
  SIAPE: 48,
  SP_MG: 36,
  "PUBLICO_GERAL/PRIVADO": 36,
  FGTS: 36,
  ADIANTAMENTO_13: 5,
  PORTABILIDADE: 36,
};

async function lerTudo(tabelaNome, colunas, filtros) {
  const passo = 1000;
  let de = 0;
  const saida = [];
  for (;;) {
    let q = supabase.from(tabelaNome).select(colunas).range(de, de + passo - 1);
    for (const f of filtros || []) q = q[f.op](...f.args);
    const { data, error } = await q;
    if (error) throw new Error(`${tabelaNome}: ${error.message}`);
    saida.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return saida;
}

(async () => {
  const linhas = await lerTudo(
    "daily_production_records",
    "proposal_number, movement_date, status, product_code, product_description, convenio_code, term_months, interest_rate, net_value, gross_value, company_received_percent, raw_payload",
    [
      { op: "gte", args: ["movement_date", "2026-03-01"] },
      { op: "lt", args: ["movement_date", "2026-08-10"] },
    ]
  );

  const semTaxa = linhas
    .filter((r) => norm(r.status).includes("PRODUC"))
    .filter((r) => !temTaxa(r))
    .map((r) => ({ ...r, tabela: tabela(r), comp: String(r.movement_date).slice(0, 7) }));

  const acima = semTaxa.filter((r) => {
    const piso = PISO[r.tabela];
    return piso != null && Number(r.term_months) >= piso;
  });
  const abaixo = semTaxa.length - acima.length;

  console.log("=".repeat(96));
  console.log("SONDA — sem taxa ACIMA do piso de prazo (as abaixo do piso ja estao resolvidas)");
  console.log("=".repeat(96));
  console.log(`sem taxa em Producao: ${semTaxa.length}  ·  abaixo do piso (OK, fora de escopo): ${abaixo}  ·  ACIMA do piso: ${acima.length}\n`);

  console.log("--- 1. AS DO INSS COM PRAZO > 84 (a pergunta central) ---");
  console.log("proposta      comp     conv    prod   prazo   juros    financiado      tabela");
  console.log("-".repeat(96));
  const inss84 = acima.filter((r) => r.tabela.startsWith("INSS") && Number(r.term_months) > 84);
  let netInss84 = 0;
  for (const r of inss84.sort((a, b) => a.movement_date.localeCompare(b.movement_date))) {
    netInss84 += Number(r.net_value || 0);
    console.log(
      `${String(r.proposal_number).padEnd(13)} ${r.comp}  ${convNorm(r.convenio_code).padStart(6)}  ${String(r.product_code).padStart(5)}  ${String(r.term_months).padStart(5)}  ${String(r.interest_rate ?? "-").padStart(6)}  ${Number(r.net_value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }).padStart(13)}  ${r.tabela}`
    );
  }
  console.log(`\n  TOTAL: ${inss84.length} linhas · financiado R$ ${netInss84.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  comissao devida a 3,34% (Faixa 3): R$ ${(netInss84 * 0.0334).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

  console.log("\n--- 2. GENERALIZADO: todas as sem taxa ACIMA do piso, por tabela ---");
  const porTab = new Map();
  for (const r of acima) {
    if (!porTab.has(r.tabela)) porTab.set(r.tabela, { n: 0, net: 0, prazos: new Set() });
    const a = porTab.get(r.tabela);
    a.n += 1;
    a.net += Number(r.net_value || 0);
    a.prazos.add(Number(r.term_months));
  }
  console.log("tabela                      linhas         financiado   prazos");
  console.log("-".repeat(96));
  for (const [k, v] of [...porTab.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const ps = [...v.prazos].sort((a, b) => a - b);
    console.log(
      `${k.padEnd(26)} ${String(v.n).padStart(6)}  ${v.net.toLocaleString("pt-BR", { minimumFractionDigits: 2 }).padStart(17)}   ${ps.slice(0, 12).join(",")}${ps.length > 12 ? " ..." : ""}`
    );
  }
  const netAcima = acima.reduce((s, r) => s + Number(r.net_value || 0), 0);
  console.log(`\n  TOTAL acima do piso: ${acima.length} linhas · R$ ${netAcima.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

  // --- 3. A REGUA: a faixa "Acima de 84" existe no JSON versionado? ---
  console.log("\n--- 3. REGUA VERSIONADA (trp_rule_versions) — a faixa 'Acima de 84' existe? ---");
  const comps = [...new Set(inss84.map((r) => r.comp))].sort();
  console.log(`competencias envolvidas: ${comps.join(", ") || "(nenhuma)"}`);
  const regras = await lerTudo("trp_rule_versions", "*");
  console.log(`versoes na tabela: ${regras.length}`);
  for (const reg of regras) {
    const comp = String(reg.competencia ?? "").slice(0, 7);
    if (comps.length && !comps.includes(comp)) continue;
    console.log(`\n  competencia ${comp} · colunas: ${Object.keys(reg).join(", ")}`);
    const j = reg.regra_json || reg.regra || {};
    const cats = j.categorias || j.categories || j;
    for (const nome of ["INSS_NOVO", "INSS_RENOVACAO"]) {
      const cat = cats?.[nome];
      if (!cat) {
        console.log(`    ${nome}: AUSENTE no JSON`);
        continue;
      }
      const celulas = cat.celulas || cat.cells || cat.matriz || [];
      const faixasPrazo = new Set();
      const arr = Array.isArray(celulas) ? celulas : Object.values(celulas || {});
      for (const c of arr) {
        const rot = c?.prazo ?? c?.prazo_label ?? c?.faixa_prazo ?? c?.label ?? JSON.stringify(c).slice(0, 40);
        faixasPrazo.add(String(rot));
      }
      console.log(`    ${nome}: ${arr.length} celulas · faixas de prazo: ${[...faixasPrazo].slice(0, 10).join(" | ")}`);
    }
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
