#!/usr/bin/env node
/**
 * scripts/trp_paridade_f5_json.cjs — GATE PÓS-REMOÇÃO da F5 (read-only).
 *
 * O hardcode de junho foi removido. Agora o caminho json é GENÉRICO
 * (resolveAvistaTrpJson). Este gate prova duas coisas:
 *
 *  (A) PARIDADE json × db: resolveAvistaTrpJson (JSON canônico) vs
 *      resolveAvistaTrpDb (banco) sobre TODAS as operações reais de junho e
 *      abril. As duas fontes leem a MESMA regra por caminhos diferentes → devem
 *      bater 0 divergências (|Δpct|<1e-9 e |Δcomissão|<1e-9). Prova que o json
 *      calcula certo E que o db não regrediu.
 *
 *  (B) COBERTURA DE JULHO no modo json: antes o json só cobria junho; agora,
 *      genérico + fallback, cobre julho pela TRP de junho. Roda julho no modo
 *      json e exige à-vista > 0, isFallback=true, fornecedora=2026-06 — e que
 *      json e db deem o MESMO número para julho (fallback simétrico).
 *
 * Read-only, service_role só para LER daily_production_records. Nada é gravado.
 * EXIT 0 só com 0 divergências em (A) e julho coberto em (B).
 * Uso: node scripts/trp_paridade_f5_json.cjs
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const EPS = 1e-9;
const PAGE = 1000;

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

function loadLib() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-f5-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false, declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/trp/creditAvistaTrp.ts"),
      path.join(ROOT, "lib/trp/resolveTrpRegraDb.ts"),
      path.join(ROOT, "lib/trp/vigencia.ts"),
      path.join(ROOT, "lib/regrasLoader.ts"),
      path.join(ROOT, "lib/regrasData.ts"),
      path.join(ROOT, "lib/prazoTrp.ts"),
      path.join(ROOT, "lib/proposalDetailing.ts"),
      path.join(ROOT, "lib/supabaseAdmin.ts"),
    ],
  };
  const cfg = path.join(OUT, "tsconfig.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" }); } catch (_e) {}
  for (const alvo of ["lib/trp/creditAvistaTrp.js", "lib/trp/resolveTrpRegraDb.js", "lib/regrasData.js"]) {
    if (!fs.existsSync(path.join(OUT, alvo))) throw new Error(`tsc não emitiu ${alvo}`);
  }
  fs.cpSync(path.join(ROOT, "regras_promotiva/json"), path.join(OUT, "regras_promotiva/json"), { recursive: true });
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (req, ...rest) {
    if (req.startsWith("@/")) req = path.join(OUT, req.slice(2));
    return orig.call(this, req, ...rest);
  };
  return {
    credit: require(path.join(OUT, "lib/trp/creditAvistaTrp.js")),
    resolver: require(path.join(OUT, "lib/trp/resolveTrpRegraDb.js")),
    vig: require(path.join(OUT, "lib/trp/vigencia.js")),
  };
}

function toNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function recordFrom(r) {
  return {
    product_description: r.product_description, interest_rate: r.interest_rate,
    term_months: r.term_months, installments: r.installments,
    contract_date: r.contract_date, raw_payload: r.raw_payload,
  };
}
function shape(r, net) {
  if (!r) return { resolved: false, pctTabela: null, pctEmpresa: null, comissao: 0, isFallback: false, fornecedora: null };
  return { resolved: true, pctTabela: r.pctTabela, pctEmpresa: r.pctEmpresa, comissao: r.pctEmpresa * net, isFallback: !!r.isFallback, fornecedora: r.competenciaFornecedora ?? null, categoria: r.categoria, tabLabel: r.tabLabel };
}
const brl = (x) => x.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function fetchOps(sb, fromISO, toISO) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select("id, proposal_number, product_description, interest_rate, term_months, installments, contract_date, net_value, status, is_srcc_restricted, raw_payload")
      .gte("contract_date", fromISO).lte("contract_date", toISO).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

function compara(ops, credit, provider) {
  let matches = 0, resolvidos = 0, jsonFallback = 0;
  const divergencias = [];
  for (const row of ops) {
    const net = toNum(row.net_value);
    const j = shape(credit.resolveAvistaTrpJson(recordFrom(row)), net);   // JSON genérico
    const d = shape(credit.resolveAvistaTrpDb(recordFrom(row), provider), net); // banco
    if (j.resolved) resolvidos++;
    if (j.resolved && j.isFallback) jsonFallback++;
    let div = null;
    if (j.resolved !== d.resolved) div = `resolvido difere (json=${j.resolved} db=${d.resolved})`;
    else if (j.resolved) {
      const dT = Math.abs((j.pctTabela ?? 0) - (d.pctTabela ?? 0));
      const dE = Math.abs((j.pctEmpresa ?? 0) - (d.pctEmpresa ?? 0));
      const dC = Math.abs(j.comissao - d.comissao);
      if (dT >= EPS || dE >= EPS || dC >= EPS) div = { dT, dE, dC };
    }
    if (div) divergencias.push({ proposal: row.proposal_number || row.id, produto: row.product_description, faixa: `${j.categoria} / ${j.tabLabel}`, pctJ: j.pctTabela, pctD: d.pctTabela, delta: div });
    else matches++;
  }
  return { matches, resolvidos, jsonFallback, divergencias };
}

async function main() {
  loadEnv();
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) { console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local"); process.exit(1); }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { credit, resolver, vig } = loadLib();

  // provider db (service_role) pré-carregado para as competências usadas
  const preloader = resolver.createTrpRegraDbPreloader(sb);
  await preloader.preload(["2026-04", "2026-06", "2026-07"]);
  const provider = (c) => preloader.getResolvedSync(c);

  let totalDiv = 0;

  // ---- (A) paridade json × db: junho (gate) + abril (extra) ----
  for (const { comp, gate } of [{ comp: "2026-06", gate: true }, { comp: "2026-04", gate: false }]) {
    const { validFrom, validUntil } = vig.vigenciaDaCompetencia(comp);
    const ops = await fetchOps(sb, validFrom, validUntil);
    const { matches, resolvidos, divergencias } = compara(ops, credit, provider);
    console.log(`\n===== (A) ${comp} json-genérico × db (vigência ${validFrom}..${validUntil})${gate ? "  [GATE]" : "  [extra]"} =====`);
    console.log(`  operações: ${ops.length} | resolvidas: ${resolvidos} | matches: ${matches} | divergências: ${divergencias.length}`);
    for (const d of divergencias) console.log(`   • ${d.proposal} | ${d.produto} | ${d.faixa} | pctJson=${d.pctJ} pctDb=${d.pctD} | Δ=${JSON.stringify(d.delta)}`);
    totalDiv += divergencias.length;
  }

  // ---- (B) cobertura de julho no modo json (por fallback de junho) ----
  const jul = vig.vigenciaDaCompetencia("2026-07");
  const opsJul = await fetchOps(sb, jul.validFrom, jul.validUntil);
  let somaJson = 0, resolvedJson = 0, fbJson = 0, fornecedoraJson = null, foraFornecedora = 0;
  const { matches: mJul, divergencias: divJul } = compara(opsJul, credit, provider); // json × db para julho
  for (const row of opsJul) {
    const net = toNum(row.net_value);
    const j = shape(credit.resolveAvistaTrpJson(recordFrom(row)), net);
    if (j.resolved) { resolvedJson++; somaJson += j.comissao; if (j.isFallback) fbJson++; if (j.fornecedora) { fornecedoraJson = j.fornecedora; if (j.fornecedora !== "2026-06") foraFornecedora++; } }
  }
  console.log(`\n===== (B) julho no modo JSON (vigência ${jul.validFrom}..${jul.validUntil}) =====`);
  console.log(`  operações: ${opsJul.length} | resolvidas (json): ${resolvedJson} | à-vista json: ${brl(somaJson)}`);
  console.log(`  isFallback: ${fbJson === resolvedJson && resolvedJson > 0 ? "sim (todas)" : `${fbJson}/${resolvedJson}`} | competenciaFornecedora: ${fornecedoraJson}${foraFornecedora ? ` (⚠ ${foraFornecedora} ≠ 2026-06)` : ""}`);
  console.log(`  paridade json × db em julho: matches ${mJul}/${opsJul.length} | divergências ${divJul.length}`);
  totalDiv += divJul.length;

  const julhoCoberto = resolvedJson > 0 && somaJson > 0 && fbJson === resolvedJson && fornecedoraJson === "2026-06" && foraFornecedora === 0;

  console.log("\n========================================");
  console.log(`(A) paridade json×db (junho+abril+julho): ${totalDiv === 0 ? "0 divergências" : `${totalDiv} DIVERGÊNCIAS`}`);
  console.log(`(B) julho coberto no modo json por fallback de junho: ${julhoCoberto ? "SIM" : "NÃO"}`);
  console.log("========================================");
  process.exit(totalDiv === 0 && julhoCoberto ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
