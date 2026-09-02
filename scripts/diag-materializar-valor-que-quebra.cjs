#!/usr/bin/env node
/**
 * scripts/diag-materializar-valor-que-quebra.cjs — o valor que aborta o INSERT.
 * READ-ONLY.
 *
 * O RECORTE, que e o que da forca a esta varredura: a funcao NAO filtra
 * competencia — ela varre monthly_closing_entries inteira. E o populate ad-hoc de
 * 2026-07-05 usou EXATAMENTE o mesmo SELECT e gravou 249.740 linhas sem abortar.
 * Aritmetica que fecha:
 *     270.198 entries PRT no banco
 *   − 249.740 linhas em producao_contrato
 *   =  20.458 = 10.258 (2026-07) + 10.200 (2026-08)
 * Logo, se o que derruba a funcao e um VALOR, ele esta necessariamente dentro
 * dessas 20.458 linhas novas — nenhuma outra pode ser culpada, porque todas as
 * outras ja passaram por este mesmo SELECT uma vez.
 *
 * Os casts que a funcao aplica e que podem abortar:
 *   trunc(to_num_br('QTD PARCELAS TOTAL'))::int   -> 22003 se |v| > 2.147.483.647
 *   trunc(to_num_br('QTD PARCELAS PGS'))::int     -> idem
 *   trunc(to_num_br('COD EST'))::int              -> idem
 *   to_num_br('VALOR FINANCIADO') -> numeric(18,2) -> 22003 se |v| >= 10^16
 *   to_num_br('COMISSÃO')         -> numeric(18,2) -> idem
 * to_num_br em si NAO aborta (regex-guard devolve NULL), entao texto invalido e
 * seguro; o perigo e o valor NUMERICO grande demais para a coluna/tipo.
 *
 * Compara-se com 2026-06 (que passou) para separar "anomalo" de "normal".
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const INT_MAX = 2147483647;
const NUM_18_2_MAX = 1e16;

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** Espelha to_num_br: virgula => BR; regex-guard; invalido vira null. */
function toNumBr(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s === "") return null;
  s = s.indexOf(",") >= 0 ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

async function paginaPrt(sb, y, m) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("monthly_closing_entries")
      .select("id,year,month,company_cnpj,metadata")
      .eq("year", y).eq("month", m).eq("entry_type", "PRT").range(from, from + 999);
    if (error) throw new Error(error.message);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const INTS = ["QTD PARCELAS TOTAL", "QTD PARCELAS PGS", "COD EST"];
  const NUMS = ["VALOR FINANCIADO", "COMISSÃO"];

  for (const [y, m, papel] of [[2026, 6, "CONTROLE (passou no populate)"], [2026, 7, "SUSPEITO"], [2026, 8, "SUSPEITO"]]) {
    const linhas = await paginaPrt(sb, y, m);
    const comp = y + "-" + String(m).padStart(2, "0");
    console.log("\n### " + comp + " — " + linhas.length + " entries PRT — " + papel + " ###");
    for (const campo of INTS.concat(NUMS)) {
      const ehInt = INTS.indexOf(campo) >= 0;
      const limite = ehInt ? INT_MAX : NUM_18_2_MAX;
      let min = Infinity, max = -Infinity, nulos = 0, estouram = [];
      for (const r of linhas) {
        const v = toNumBr((r.metadata || {})[campo]);
        if (v === null) { nulos++; continue; }
        if (v < min) min = v;
        if (v > max) max = v;
        if (Math.abs(ehInt ? Math.trunc(v) : v) >= limite) estouram.push({ r, v });
      }
      console.log("  " + campo.padEnd(20) +
        " min=" + (min === Infinity ? "-" : String(min)).padStart(14) +
        "  max=" + (max === -Infinity ? "-" : String(max)).padStart(18) +
        "  nulos=" + String(nulos).padStart(5) +
        "  ESTOURAM=" + estouram.length);
      for (const e of estouram.slice(0, 5)) {
        console.log("      >>> " + e.v + "  entry " + e.r.id + "  cnpj=" + e.r.company_cnpj +
          "  op=" + (e.r.metadata || {})["NRO OPERAÇÃO"]);
      }
    }
    // NRO OPERACAO vazio (o WHERE ja exclui, mas conta para fechar a aritmetica)
    const semOp = linhas.filter((r) => !String((r.metadata || {})["NRO OPERAÇÃO"] || "").trim()).length;
    console.log("  NRO OPERAÇÃO em branco (excluidas pelo WHERE): " + semOp +
      "   -> entrariam: " + (linhas.length - semOp));
  }

  console.log("\n### aritmetica de fechamento ###");
  const { count: totalPrt } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("entry_type", "PRT");
  const { count: pc } = await sb.from("producao_contrato").select("*", { count: "exact", head: true });
  console.log("  entries PRT: " + totalPrt + "   producao_contrato: " + pc + "   diferenca: " + (totalPrt - pc));

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
