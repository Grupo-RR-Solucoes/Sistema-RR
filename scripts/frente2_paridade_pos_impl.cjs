#!/usr/bin/env node
/**
 * scripts/frente2_paridade_pos_impl.cjs — VALIDAÇÃO PÓS-IMPLEMENTAÇÃO.
 *
 * READ-ONLY no banco. Não commita. Cria/apaga 1 arquivo transiente (baseline).
 *
 * OBJETIVO
 *   Provar que o lib/motor.ts MODIFICADO (fonte da matriz = TRP por competência)
 *   é COMPORTAMENTO-IDÊNTICO ao ORIGINAL (CREDIT_RULES hardcoded), comparando
 *   calcularOperacao().credito.percentual entre as DUAS versões nos mesmos
 *   contratos (abr+jun/2026, por vigência) × 5 faixas. Critério: |Δ| < 1e-9.
 *
 * COMO OBTÉM AS DUAS VERSÕES
 *   - VELHO (baseline) = `git show HEAD:lib/motor.ts` (o original, CREDIT_RULES),
 *     gravado em lib/__motor_baseline__.ts (irmão → imports relativos resolvem),
 *     compilado para CJS. Apagado no fim.
 *   - NOVO = lib/motor.ts da working tree (já com o refactor), compilado para CJS.
 *   Ambos compartilham os MESMOS deps reais (promotivaCashPolicy, regrasLoader,
 *   regrasData, productionPeriod) — só o motor difere. Comparar .credito.percentual
 *   isola exatamente a troca de fonte da matriz.
 *
 * Não é tautologia: o NOVO usa o loader; o VELHO usa CREDIT_RULES. São duas fontes
 * independentes. Paridade 0 prova que o refactor não mudou nenhum número.
 *
 * Como rodar:  node scripts/frente2_paridade_pos_impl.cjs
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const TOL = 1e-9;
const BASELINE_REL = "lib/__motor_baseline__.ts";
const BASELINE_ABS = path.join(ROOT, BASELINE_REL);

const COMPETENCIAS = [
  { mes: "2026-04", year: 2026, month: 4, trp: "TRP35" },
  { mes: "2026-06", year: 2026, month: 6, trp: "TRP37" },
];
const REP_VALUE = {
  FAIXA_1: 0,
  FAIXA_2: 1_500_000,
  FAIXA_3: 4_000_000,
  FAIXA_4: 10_000_000,
  FAIXA_5: 25_000_000,
};
const BANDS = Object.keys(REP_VALUE);

// ----------------------------------------------------------------- ENV ------
function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const p = path.join(ROOT, fname);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ------------------------------------------- baseline (git HEAD) -> arquivo --
function escreverBaseline() {
  const original = execSync("git show HEAD:lib/motor.ts", { cwd: ROOT, encoding: "utf8" });
  fs.writeFileSync(BASELINE_ABS, original);
  return original.length;
}
function apagarBaseline() {
  try { fs.rmSync(BASELINE_ABS, { force: true }); } catch (_e) {}
}

// --------------------------------------------- compilar VELHO + NOVO -> CJS --
// Compila lib/motor.ts (NOVO) + lib/__motor_baseline__.ts (VELHO) + deps reais.
function compilarAmbos() {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "frente2-posimpl-"));
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node",
      esModuleInterop: true, resolveJsonModule: true,
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      declaration: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/motor.ts"),
      path.join(ROOT, BASELINE_REL),
      path.join(ROOT, "lib/promotivaCashPolicy.ts"),
      path.join(ROOT, "lib/regrasLoader.ts"),
      path.join(ROOT, "lib/regrasData.ts"),
      path.join(ROOT, "lib/types/blocos.ts"),
      path.join(ROOT, "lib/prazoTrp.ts"),
      path.join(ROOT, "lib/productionPeriod.ts"),
    ],
  };
  const cfgPath = path.join(OUT, "tsconfig.cjs.json");
  fs.writeFileSync(cfgPath, JSON.stringify(tsconfig));
  try {
    execSync(`npx tsc -p "${cfgPath}"`, { cwd: ROOT, stdio: "inherit" });
  } catch (_e) {
    // erros de TIPO não impedem emit (noEmitOnError:false).
  }
  for (const alvo of ["lib/motor.js", "lib/__motor_baseline__.js", "lib/regrasLoader.js", "lib/productionPeriod.js"]) {
    if (!fs.existsSync(path.join(OUT, alvo))) {
      throw new Error(`tsc não emitiu ${alvo} (erro real de compilação)`);
    }
  }
  fs.cpSync(path.join(ROOT, "regras_promotiva/json"),
            path.join(OUT, "regras_promotiva/json"), { recursive: true });

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };

  return {
    novo: require(path.join(OUT, "lib/motor.js")),               // working tree (refatorado)
    velho: require(path.join(OUT, "lib/__motor_baseline__.js")), // git HEAD (CREDIT_RULES)
    prazo: require(path.join(OUT, "lib/prazoTrp.js")),
    period: require(path.join(OUT, "lib/productionPeriod.js")),
  };
}

// ----------------------------------------------------- helpers / leitura -----
function toNumber(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function pf(x) { return x == null ? "—" : (x * 100).toFixed(4).replace(".", ",") + "%"; }

async function fetchCompetencia(window) {
  const cols = "id, contract_date, movement_date, proposal_date, product_code, " +
    "product_description, gross_value, net_value, insurance_value, insurance_type, " +
    "has_insurance, status, is_srcc_restricted, term_months, company_received_percent, " +
    "convenio_code, convenio_type, convenio_segment, interest_rate, raw_payload";
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select(cols)
      .gte("contract_date", window.start)
      .lt("contract_date", window.endExclusive)
      .order("contract_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function buildOp(r, getPrazoTrp) {
  const prazo = getPrazoTrp(r) ?? toNumber(r.term_months);
  return {
    valor_liquido: toNumber(r.net_value),
    valor_bruto: toNumber(r.gross_value),
    valor_seguro: toNumber(r.insurance_value),
    taxa_juros: r.interest_rate,
    prazo,
    tem_seguro: toNumber(r.insurance_value) > 0 || Boolean(r.has_insurance),
    product_code: r.product_code,
    product_description: r.product_description,
    convenio_code: r.convenio_code,
    convenio_type: r.convenio_type,
    convenio_segment: r.convenio_segment,
    company_cash_percent: r.company_received_percent,
    insurance_type: r.insurance_type,
    movement_date: r.movement_date,
    contract_date: r.contract_date,
    proposal_date: r.proposal_date,
  };
}

// ------------------------------------------------------------------ MAIN ----
(async () => {
  console.log("Gravando baseline a partir de git HEAD:lib/motor.ts ...");
  const n = escreverBaseline();
  console.log(`  ${BASELINE_REL} (${n} bytes).`);

  let modulos;
  try {
    console.log("Compilando VELHO (baseline) + NOVO (working tree) + deps reais para CJS...");
    modulos = compilarAmbos();
  } catch (e) {
    apagarBaseline();
    throw e;
  }
  const { novo, velho, prazo, period } = modulos;
  const calcVelho = velho.calcularOperacao;
  const calcNovo = novo.calcularOperacao;
  const { getPrazoTrp } = prazo;
  const { getProductionWindow } = period;

  const resumo = [];
  const divergencias = [];
  let totalComparacoes = 0;

  for (const comp of COMPETENCIAS) {
    const window = getProductionWindow(comp.year, comp.month);
    console.log(`\nLendo ${comp.mes} (${comp.trp}) — vigência [${window.start}, ${window.endExclusive})...`);
    const rows = await fetchCompetencia(window);
    let comparacoes = 0, batem = 0, divergem = 0;

    for (const r of rows) {
      const op = buildOp(r, getPrazoTrp);
      for (const band of BANDS) {
        op.production_value = REP_VALUE[band];
        let v, nw;
        try { v = calcVelho(op); } catch (e) { v = { __err: e.message || String(e) }; }
        try { nw = calcNovo(op); } catch (e) { nw = { __err: e.message || String(e) }; }
        comparacoes++; totalComparacoes++;

        if (v.__err || nw.__err) {
          divergem++;
          divergencias.push({
            mes: comp.mes, id: r.id, data: r.contract_date, band,
            tableKey: (v.credito && v.credito.regra) || (nw.credito && nw.credito.regra) || "(erro)",
            pctVelho: null, pctNovo: null, delta: null,
            motivo: `erro velho=${v.__err || "-"} novo=${nw.__err || "-"}`,
          });
          continue;
        }
        const pctVelho = v.credito.percentual;
        const pctNovo = nw.credito.percentual;
        const delta = pctNovo - pctVelho;
        if (Math.abs(delta) < TOL) { batem++; continue; }
        divergem++;
        divergencias.push({
          mes: comp.mes, id: r.id, data: r.contract_date, band,
          tableKey: nw.credito.regra,
          tableKeyVelho: v.credito.regra,
          pctVelho, pctNovo, delta,
          motivo: `Δ=${delta.toExponential(3)}` +
            (v.credito.regra !== nw.credito.regra ? ` | tableKey velho=${v.credito.regra} novo=${nw.credito.regra}` : ""),
        });
      }
    }
    resumo.push({ mes: comp.mes, trp: comp.trp, contratos: rows.length, comparacoes, batem, divergem });
  }

  apagarBaseline();
  console.log(`\n(baseline transiente ${BASELINE_REL} apagado)`);

  // ----------------------------------------------------------- relatório ----
  console.log("\n===================== RESUMO POR COMPETÊNCIA (VELHO=original vs NOVO=refatorado) =====================");
  console.log("| comp    | TRP   | contratos | comparações(×5) | batem | DIVERGEM |");
  console.log("|---------|-------|-----------|-----------------|-------|----------|");
  for (const s of resumo) {
    console.log(`| ${s.mes} | ${s.trp} | ${String(s.contratos).padStart(9)} | ` +
      `${String(s.comparacoes).padStart(15)} | ${String(s.batem).padStart(5)} | ${String(s.divergem).padStart(8)} |`);
  }

  console.log("\n=== DIVERGENTES ===");
  if (divergencias.length === 0) {
    console.log("Nenhuma. motor MODIFICADO == motor ORIGINAL (CREDIT_RULES) em todos os contratos e faixas.");
  } else {
    console.log(["comp","contrato","data","faixa","tableKey","%velho","%novo","delta","motivo"].join(" | "));
    for (const d of divergencias) {
      console.log([
        d.mes, String(d.id).slice(0, 10), String(d.data || "—"), d.band,
        String(d.tableKey || "—").padEnd(16), pf(d.pctVelho), pf(d.pctNovo),
        d.delta == null ? "—" : d.delta.toExponential(3), d.motivo || "",
      ].join(" | "));
    }
  }

  console.log("\n========================= VEREDITO =========================");
  console.log(`Comparações totais: ${totalComparacoes} | Divergências: ${divergencias.length}`);
  if (divergencias.length > 0) {
    console.log("\nPÓS-IMPL: FALHOU. O refactor MUDOU números — PARAR e investigar (reverter motor.ts).");
    process.exit(1);
  }
  console.log("\nPÓS-IMPL: PASSOU. Paridade 0 (abr+jun) — motor refatorado é comportamento-idêntico ao original.");
  process.exit(0);
})().catch((e) => { apagarBaseline(); console.error("ERRO:", e.message || e); process.exit(1); });
