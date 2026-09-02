#!/usr/bin/env node
/*
 * scripts/diag-teto-postgrest-cru.cjs — o teto do PostgREST, pela resposta HTTP
 * CRUA. READ-ONLY (so GET).
 *
 * POR QUE CRU: o supabase-js devolveu um `error` VAZIO (sem code, sem message)
 * na primeira tentativa. Vazio nao e resposta: pode ser statement_timeout
 * (57014), pode ser 504 de gateway, pode ser sintaxe invalida do filtro sobre
 * chave jsonb com espaco e acento. Sao tres consertos diferentes, e chutar qual
 * deles e o defeito seria pior do que nao medir. Aqui se le status, corpo e
 * tempo — e a diferenca aparece sozinha.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

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

async function tenta(nome, url, key, extraHeaders) {
  const t0 = Date.now();
  let res, corpo = "", erro = null;
  try {
    res = await fetch(url, {
      headers: Object.assign(
        { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" },
        extraHeaders || {}
      ),
    });
    corpo = await res.text();
  } catch (e) {
    erro = e;
  }
  const ms = Date.now() - t0;
  console.log(`\n  ${nome}`);
  console.log(`    ${(ms / 1000).toFixed(1)}s`);
  if (erro) {
    console.log(`    EXCECAO de rede: ${erro.name}: ${erro.message}`);
    if (erro.cause) console.log(`      cause: ${String(erro.cause).slice(0, 160)}`);
    return { ms, status: null, corpo: null };
  }
  console.log(`    HTTP ${res.status} ${res.statusText}`);
  const cr = res.headers.get("content-range");
  if (cr) console.log(`    content-range: ${cr}`);
  console.log(`    corpo: ${corpo.length > 300 ? corpo.slice(0, 300) + " …(" + corpo.length + " bytes)" : corpo || "(vazio)"}`);
  return { ms, status: res.status, corpo };
}

async function main() {
  loadEnv();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const T = "monthly_closing_entries";
  const q = (s) => `${base}/${T}?${s}`;

  console.log("\n=== 1. o filtro jsonb com espaco/acento e VALIDO? (3 sintaxes) ===");
  // se as tres derem erro de SINTAXE, o nivel 3 do teste anterior nunca chegou a
  // rodar SQL nenhum — e o 8,4s nao era teto, era outra coisa.
  await tenta("aspas duplas na chave  metadata->>\"NRO OPERAÇÃO\"",
    q(`select=id&metadata->>%22NRO%20OPERA%C3%87%C3%83O%22=like.*1*&limit=1`), key);
  await tenta("sem aspas             metadata->>NRO OPERAÇÃO",
    q(`select=id&metadata->>NRO%20OPERA%C3%87%C3%83O=like.*1*&limit=1`), key);
  await tenta("chave simples (sem espaco)  metadata->>MCI",
    q(`select=id&metadata->>MCI=like.*1*&limit=1`), key);

  console.log("\n=== 2. carga crescente com filtro VALIDO (count exact = varre tudo) ===");
  const niveis = [
    ["count simples", `select=id&limit=1`, { Prefer: "count=exact" }],
    ["count + like em coluna texto comum", `select=id&sheet_name=like.*a*&limit=1`, { Prefer: "count=exact" }],
    ["count + like em jsonb MCI", `select=id&metadata->>MCI=like.*1*&limit=1`, { Prefer: "count=exact" }],
    ["count + 2 likes em jsonb", `select=id&metadata->>MCI=like.*1*&metadata->>MCI=not.like.*99999*&limit=1`, { Prefer: "count=exact" }],
    ["order por jsonb MCI (sort da tabela toda)", `select=id&order=metadata->>MCI.asc&limit=1`, {}],
    ["order por jsonb MCI + count exact", `select=id&order=metadata->>MCI.asc&limit=1`, { Prefer: "count=exact" }],
    ["payload gordo: 20k linhas com metadata", `select=id,metadata&limit=20000`, {}],
  ];
  for (const [nome, s, h] of niveis) {
    const r = await tenta(nome, q(s), key, h);
    if (r.status !== null && r.status >= 400) {
      console.log(`    >>> PAROU AQUI. HTTP ${r.status}. Se o corpo trouxer 57014, o teto e de STATEMENT.`);
      break;
    }
    if (r.status === null) {
      console.log(`    >>> PAROU AQUI. Morte de rede/gateway, nao do Postgres.`);
      break;
    }
  }

  console.log("\n=== 3. o mesmo, no papel ANON (o teto costuma ser por PAPEL) ===");
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) console.log("  (sem NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  else {
    await tenta("anon: count + like em jsonb MCI",
      q(`select=id&metadata->>MCI=like.*1*&limit=1`), anon, { Prefer: "count=exact" });
  }

  console.log("\n=== fim (so GET; nada foi gravado) ===");
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
});
