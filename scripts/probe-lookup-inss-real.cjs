// ============================================================================
// SONDA — o lookup do INSS, pela forma REAL da regua.
//
// A sonda anterior adivinhou as chaves do regra_json e deu resultado invalido.
// Esta usa a forma que o codigo declara:
//
//   regra_json  E o proprio RegraMes: indexado DIRETO pela categoria
//               (regrasLoader.ts:114 -> `regra[categoriaProduto]`).
//   a matriz    tem ordem de preferencia (regrasLoader.ts:188):
//               celulas_taxa_prazo -> celulas_taxa -> celulas_prazo -> celulas
//               (a sonda velha so olhava `celulas`, por isso "0 celulas").
//   a categoria do INSS renovacao chama-se INSS_RENOV, nao INSS_RENOVACAO
//               (motor.ts:470, MAP_TABLEKEY_TO_CATEGORIA) — por isso "AUSENTE".
//
// O casamento replica lookupPctInRegra (regrasLoader.ts:155-220):
//   1. prazo < cat.prazo_min            -> FORA_DA_TABELA
//   2. prazo > cat.prazo_max            -> FORA_DA_TABELA
//   3. itera a matriz: tx_min/tx_max E prazo_min/prazo_max da CELULA
//   4. no match, le a pct pela tabLabel (ex.: "Faixa 3")
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

const inRange = (v, min, max) =>
  (min == null || v >= min) && (max == null || v <= max);

function matriz(cat) {
  return cat.celulas_taxa_prazo || cat.celulas_taxa || cat.celulas_prazo || cat.celulas || null;
}

/** Replica lookupPctInRegra e devolve ONDE parou. */
function lookup(regra, categoria, taxa, prazo, tabLabel) {
  const cat = regra?.[categoria];
  if (!cat || typeof cat !== "object") {
    return { pct: null, onde: `categoria ${categoria} AUSENTE no regra_json` };
  }
  if (typeof cat.tx_juros_min === "number" && taxa < cat.tx_juros_min) {
    return { pct: null, onde: `taxa ${taxa} < tx_juros_min ${cat.tx_juros_min}` };
  }
  if (typeof cat.prazo_min === "number" && prazo < cat.prazo_min) {
    return { pct: null, onde: `prazo ${prazo} < prazo_min ${cat.prazo_min} (categoria)` };
  }
  if (typeof cat.prazo_max === "number" && prazo > cat.prazo_max) {
    return { pct: null, onde: `prazo ${prazo} > prazo_max ${cat.prazo_max} (categoria)` };
  }
  const m = matriz(cat);
  if (!m || m.length === 0) return { pct: null, onde: "categoria SEM matriz de celulas" };
  const rejeitadas = [];
  for (const c of m) {
    const okTaxa = inRange(taxa, c.tx_min, c.tx_max);
    const okPrazo = inRange(prazo, c.prazo_min, c.prazo_max);
    if (!okTaxa || !okPrazo) {
      rejeitadas.push(
        `[tx ${c.tx_min ?? "-"}..${c.tx_max ?? "-"} | prazo ${c.prazo_min ?? "-"}..${c.prazo_max ?? "-"}] ${!okTaxa ? "taxa fora" : "prazo fora"}`
      );
      continue;
    }
    const pct = c[tabLabel];
    if (typeof pct === "number") {
      return { pct, onde: `CASOU [tx ${c.tx_min ?? "-"}..${c.tx_max ?? "-"} | prazo ${c.prazo_min ?? "-"}..${c.prazo_max ?? "-"}] ${tabLabel}=${pct}` };
    }
    return { pct: null, onde: `celula casou mas NAO TEM a coluna "${tabLabel}" (tem: ${Object.keys(c).join(",")})` };
  }
  return { pct: null, onde: `nenhuma celula casou. Rejeicoes: ${rejeitadas.slice(0, 6).join(" ; ")}` };
}

(async () => {
  const { data: regras, error } = await supabase.from("trp_rule_versions").select("*");
  if (error) throw new Error(error.message);

  const alvo = ["2026-04", "2026-06", "2026-07"];
  console.log("=".repeat(94));
  console.log("PARTE A — o que a regua TEM para o INSS");
  console.log("=".repeat(94));

  const porComp = new Map();
  for (const r of regras) {
    const comp = String(r.competencia ?? "").slice(0, 7);
    if (!alvo.includes(comp)) continue;
    if (r.is_active === false) continue;
    porComp.set(comp, r.regra_json || {});
  }

  for (const comp of alvo) {
    const regra = porComp.get(comp);
    console.log(`\n### ${comp}`);
    if (!regra) {
      console.log("  (sem versao ATIVA nesta competencia)");
      continue;
    }
    console.log(`  categorias no JSON: ${Object.keys(regra).join(", ")}`);
    for (const categoria of ["INSS_NOVO", "INSS_RENOV"]) {
      const cat = regra[categoria];
      if (!cat) {
        console.log(`  ${categoria}: AUSENTE`);
        continue;
      }
      const m = matriz(cat) || [];
      const qualMatriz = cat.celulas_taxa_prazo
        ? "celulas_taxa_prazo"
        : cat.celulas_taxa
          ? "celulas_taxa"
          : cat.celulas_prazo
            ? "celulas_prazo"
            : "celulas";
      console.log(
        `  ${categoria}: prazo_min=${cat.prazo_min ?? "-"} prazo_max=${cat.prazo_max ?? "-"} tx_juros_min=${cat.tx_juros_min ?? "-"} · matriz=${qualMatriz} (${m.length} celulas)`
      );
      for (const c of m) {
        const faixas = Object.keys(c)
          .filter((k) => /faixa/i.test(k))
          .map((k) => `${k}=${c[k]}`)
          .join(" ");
        console.log(
          `      tx ${String(c.tx_min ?? "-").padStart(5)}..${String(c.tx_max ?? "-").padEnd(5)} | prazo ${String(c.prazo_min ?? "-").padStart(4)}..${String(c.prazo_max ?? "-").padEnd(4)} | ${faixas}`
        );
      }
    }
  }

  console.log("\n" + "=".repeat(94));
  console.log("PARTE B — o LOOKUP em linhas concretas (onde exatamente para)");
  console.log("=".repeat(94));

  const casos = [
    { rot: "prazo 108 (acima de 84)", comp: "2026-06", cat: "INSS_NOVO", taxa: 1.85, prazo: 108, prop: "212138239" },
    { rot: "prazo 96  (acima de 84)", comp: "2026-04", cat: "INSS_RENOV", taxa: 1.61, prazo: 96, prop: "206671618" },
    { rot: "prazo 72  (faixa normal)", comp: "2026-06", cat: "INSS_NOVO", taxa: 1.85, prazo: 72, prop: "(do grupo 48-84)" },
    { rot: "prazo 61  (faixa normal)", comp: "2026-06", cat: "INSS_NOVO", taxa: 1.85, prazo: 61, prop: "(do grupo 48-84)" },
    { rot: "prazo 49  (no piso)", comp: "2026-06", cat: "INSS_NOVO", taxa: 1.85, prazo: 49, prop: "(do grupo 48-84)" },
    { rot: "prazo 48  (no piso)", comp: "2026-06", cat: "INSS_NOVO", taxa: 1.85, prazo: 48, prop: "(do grupo 48-84)" },
  ];

  for (const c of casos) {
    const regra = porComp.get(c.comp);
    if (!regra) {
      console.log(`\n${c.rot} · ${c.comp}: sem regua ativa`);
      continue;
    }
    console.log(`\n${c.rot} · ${c.comp} · ${c.cat} · taxa ${c.taxa} · proposta ${c.prop}`);
    for (const tab of ["Faixa 3", "Faixa 1", "pct_geral"]) {
      const r = lookup(regra, c.cat, c.taxa, c.prazo, tab);
      console.log(`   tabLabel "${tab}" -> pct=${r.pct ?? "NULO"} · ${r.onde}`);
    }
  }
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
