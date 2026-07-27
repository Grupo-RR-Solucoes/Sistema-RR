// ============================================================================
// SONDA — a coluna CONTRATO de /comissoes/editar vem vazia?
//
// A coluna le daily_production_records.contract_number (page.js:1094). Este
// campo nasce da planilha diaria, da coluna "Contrato" (import/daily:500).
//
// Perguntas que a sonda responde, por competencia:
//   1. Quantas linhas tem contract_number preenchido? E vazio?
//   2. As mesmas linhas tem proposal_number? (a alternativa para exibir)
//   3. O preenchimento muda entre competencia ABERTA e FECHADA?
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

const vazio = (v) => v == null || String(v).trim() === "" || String(v).trim() === "-";

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
    "movement_date, status, contract_number, proposal_number, is_srcc_restricted, raw_payload",
    [
      { op: "gte", args: ["movement_date", "2026-03-01"] },
      { op: "lt", args: ["movement_date", "2026-08-10"] },
    ]
  );

  console.log("=".repeat(72));
  console.log("SONDA — coluna CONTRATO vazia em /comissoes/editar");
  console.log("=".repeat(72));

  const porMes = new Map();
  for (const r of linhas) {
    const k = String(r.movement_date || "").slice(0, 7);
    if (!k) continue;
    if (!porMes.has(k)) porMes.set(k, []);
    porMes.get(k).push(r);
  }

  for (const k of [...porMes.keys()].sort()) {
    const doMes = porMes.get(k);
    const comContrato = doMes.filter((r) => !vazio(r.contract_number)).length;
    const comProposta = doMes.filter((r) => !vazio(r.proposal_number)).length;
    const soProposta = doMes.filter(
      (r) => vazio(r.contract_number) && !vazio(r.proposal_number)
    ).length;
    const nenhum = doMes.filter(
      (r) => vazio(r.contract_number) && vazio(r.proposal_number)
    ).length;
    console.log(
      `\n${k} · ${String(doMes.length).padStart(4)} linhas` +
        `\n   com contrato .......... ${String(comContrato).padStart(4)} (${((comContrato / doMes.length) * 100).toFixed(1)}%)` +
        `\n   com proposta .......... ${String(comProposta).padStart(4)} (${((comProposta / doMes.length) * 100).toFixed(1)}%)` +
        `\n   SO proposta ........... ${String(soProposta).padStart(4)}  <- linhas onde a coluna mostra "-"` +
        `\n   sem os dois ........... ${String(nenhum).padStart(4)}`
    );
  }

  // Amostra de uma linha, para ver o que o registro traz de fato.
  const amostra = linhas.find((r) => vazio(r.contract_number) && !vazio(r.proposal_number));
  if (amostra) {
    console.log("\n" + "-".repeat(72));
    console.log("AMOSTRA de linha sem contrato:");
    console.log(`  movement_date ... ${amostra.movement_date}`);
    console.log(`  status .......... ${amostra.status}`);
    console.log(`  proposal_number . ${amostra.proposal_number}`);
    console.log(`  contract_number . ${JSON.stringify(amostra.contract_number)}`);
    const raw = amostra.raw_payload || {};
    const chaves = Object.keys(raw).filter((c) => /contrat|propost/i.test(c));
    console.log(`  chaves do bruto que citam contrato/proposta: ${JSON.stringify(chaves)}`);
    for (const c of chaves) console.log(`     ${c} = ${JSON.stringify(raw[c])}`);
  }

  // ---- SRCC: quais estados existem e quantos ----
  console.log("\n" + "=".repeat(72));
  console.log("ESTADOS DE SRCC (item 2)");
  console.log("=".repeat(72));
  const porSrcc = new Map();
  for (const r of linhas) {
    const raw = r.raw_payload || {};
    const chave = Object.keys(raw).find((c) => /srcc/i.test(c));
    const valor = chave ? String(raw[chave] ?? "").trim() : `[sem coluna SRCC no bruto · restrito=${r.is_srcc_restricted}]`;
    const k = valor || "(vazio)";
    porSrcc.set(k, (porSrcc.get(k) || 0) + 1);
  }
  for (const [k, n] of [...porSrcc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)} x  ${k}`);
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
