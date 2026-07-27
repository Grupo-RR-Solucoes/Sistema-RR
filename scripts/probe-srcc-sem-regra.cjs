// ============================================================================
// SONDA — "SEM REGRA TRP" nas linhas de SRCC "Consulta nao realizada".
//
// A etiqueta SEM REGRA TRP nasce em page.js:1374 quando companyReceivedPercent
// e nulo/zero. A pergunta do Diego: isso acontece PORQUE o estado de SRCC
// bloqueia o calculo, ou porque produto/taxa/prazo daquela operacao realmente
// nao tem celula na TRP?
//
// O teste que separa as duas hipoteses: cruzar o estado de SRCC com a presenca
// da taxa a vista. Se a taxa faltar SO nas linhas de "consulta nao realizada",
// e o estado que bloqueia. Se faltar na mesma proporcao em todos os estados,
// e lacuna de TRP e o SRCC e coincidencia.
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

function taxaDoBruto(raw) {
  if (!raw || typeof raw !== "object") return null;
  for (const k of CHAVES_AVISTA) {
    if (raw[k] != null && String(raw[k]).trim() !== "") {
      const n = Number(String(raw[k]).replace("%", "").replace(",", "."));
      if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

function estadoSrcc(raw) {
  if (!raw || typeof raw !== "object") return "(sem coluna)";
  const chave = Object.keys(raw).find((c) => /srcc/i.test(c));
  if (!chave) return "(sem coluna)";
  return String(raw[chave] ?? "").trim() || "(vazio)";
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
    "movement_date, status, is_srcc_restricted, company_received_percent, product_code, term_months, net_value, proposal_number, raw_payload",
    [
      { op: "gte", args: ["movement_date", "2026-06-01"] },
      { op: "lt", args: ["movement_date", "2026-08-10"] },
    ]
  );

  console.log("=".repeat(78));
  console.log("SONDA — SRCC x falta de taxa a vista (causa do SEM REGRA TRP)");
  console.log("=".repeat(78));
  console.log(`linhas jun+jul: ${linhas.length}\n`);

  const grupos = new Map();
  for (const r of linhas) {
    const e = estadoSrcc(r.raw_payload);
    if (!grupos.has(e)) grupos.set(e, []);
    grupos.get(e).push(r);
  }

  console.log("estado de SRCC                                  linhas   SEM taxa   %");
  console.log("-".repeat(78));
  for (const [estado, rs] of [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const semTaxa = rs.filter((r) => {
      const t = taxaDoBruto(r.raw_payload);
      const guardada = r.company_received_percent;
      const temGuardada = guardada != null && Number(guardada) > 0;
      return (t == null || t === 0) && !temGuardada;
    }).length;
    const pct = rs.length ? (semTaxa / rs.length) * 100 : 0;
    console.log(
      `${estado.slice(0, 44).padEnd(46)} ${String(rs.length).padStart(5)}   ${String(semTaxa).padStart(6)}   ${pct.toFixed(1).padStart(5)}%`
    );
  }

  console.log("\n" + "-".repeat(78));
  console.log("is_srcc_restricted por estado (quem o motor exclui da producao):");
  console.log("-".repeat(78));
  for (const [estado, rs] of [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const restritos = rs.filter((r) => r.is_srcc_restricted === true).length;
    console.log(`${estado.slice(0, 44).padEnd(46)} restrito=true: ${restritos}/${rs.length}`);
  }

  const consulta = grupos.get("Consulta não realizada por problemas técnicos") || [];
  if (consulta.length) {
    console.log("\n" + "-".repeat(78));
    console.log(`AMOSTRA — 5 linhas de "Consulta nao realizada":`);
    console.log("-".repeat(78));
    for (const r of consulta.slice(0, 5)) {
      console.log(
        `  proposta ${r.proposal_number} · ${r.movement_date} · produto=${JSON.stringify(r.product_code)} · prazo=${r.term_months} · net=${r.net_value}`
      );
      console.log(
        `     taxa no bruto=${taxaDoBruto(r.raw_payload)} · company_received_percent=${r.company_received_percent} · restrito=${r.is_srcc_restricted}`
      );
    }
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
