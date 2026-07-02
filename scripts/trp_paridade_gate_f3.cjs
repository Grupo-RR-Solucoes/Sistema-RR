#!/usr/bin/env node
/**
 * scripts/trp_paridade_gate_f3.cjs — FASE 3: GATE DE PARIDADE (read-only).
 *
 * NÃO altera a flag TRP_SOURCE, NÃO grava nada, NÃO pluga o resolvedor no motor.
 * Só PROVA que o resolvedor DB (resolveTrpRegraDb) produz o MESMO pct/comissão à
 * vista de crédito que o caminho JSON de produção, para TODAS as operações reais
 * cujo contract_date cai na vigência da competência.
 *
 * COMO GARANTE "MESMO CÓDIGO, FONTE DIFERENTE" (sem duplicar lógica):
 *   Os dois cálculos passam pela MESMA função de produção resolveAvistaTrpJson
 *   -> getMatrizTRPParaContrato -> lookupPctInRegra. A ÚNICA coisa trocada entre
 *   OLD e NEW é a RegraMes que getRegra devolve:
 *     - OLD: MAPA_MES_REGRA[comp].regra (JSON estático — a rede de rollback).
 *     - NEW: regra_json vinda de resolveTrpRegraDb(comp) (banco), injetada em
 *       MAPA_MES_REGRA[comp].regra APENAS neste processo (nunca persistido).
 *   resolveAvistaTrpJson é genérico por competência (F5: sem hardcode de junho),
 *   então a competência sai de competenciaDaData(contract_date) — não precisa
 *   reapontar janela. Tudo em memória, no OUT compilado.
 *
 * COBERTURA: junho/2026 é o GATE obrigatório (competência ativa em produção).
 *   abr/mai/2026 rodam como cobertura extra (também seedados).
 *
 * COMPARAÇÃO: por operação, |pctTabela_OLD-NEW| < EPS, |pctEmpresa_OLD-NEW| < EPS,
 *   |comissao_OLD-NEW| < EPS (comissao = pctEmpresa * net_value). EPS = 1e-9.
 *
 * EXIT 0 só se divergências == 0 em 100% das operações de TODAS as competências
 * rodadas (junho inclusive). Qualquer divergência -> exit 1 + lista detalhada.
 *
 * Requisitos: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 * Uso: node scripts/trp_paridade_gate_f3.cjs
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

// Competências a comparar. gate=true => obrigatória p/ o exit code.
const COMPETENCIAS = [
  { comp: "2026-06", gate: true },
  { comp: "2026-04", gate: false },
  { comp: "2026-05", gate: false },
];

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

// --------------------------------------------------- compilar lib do repo --
function loadRepoLib() {
  // OUT dentro do repo para o node resolver node_modules (ex.: @supabase/supabase-js).
  const OUT = fs.mkdtempSync(path.join(ROOT, ".trp-f3-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
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
  const cfg = path.join(OUT, "tsconfig.f3.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try {
    execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "inherit" });
  } catch (_e) {
    // erros de TIPO não impedem emit (noEmitOnError:false); checagem abaixo decide.
  }
  for (const alvo of ["lib/trp/creditAvistaTrp.js", "lib/trp/resolveTrpRegraDb.js", "lib/regrasData.js"]) {
    if (!fs.existsSync(path.join(OUT, alvo))) throw new Error(`tsc não emitiu ${alvo}`);
  }
  // regrasData.js importa os JSON por caminho relativo.
  fs.cpSync(path.join(ROOT, "regras_promotiva/json"), path.join(OUT, "regras_promotiva/json"), { recursive: true });

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };

  return {
    credit: require(path.join(OUT, "lib/trp/creditAvistaTrp.js")),
    resolver: require(path.join(OUT, "lib/trp/resolveTrpRegraDb.js")),
    data: require(path.join(OUT, "lib/regrasData.js")),
    vig: require(path.join(OUT, "lib/trp/vigencia.js")),
  };
}

// ------------------------------------------------------------- fetch ops ----
async function fetchOps(sb, fromISO, toISO) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select(
        "id, proposal_number, product_description, interest_rate, term_months, installments, contract_date, net_value, status, is_srcc_restricted, raw_payload"
      )
      .gte("contract_date", fromISO)
      .lte("contract_date", toISO)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function toNumber(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function recordFrom(row) {
  return {
    product_description: row.product_description,
    interest_rate: row.interest_rate,
    term_months: row.term_months,
    installments: row.installments,
    contract_date: row.contract_date,
    raw_payload: row.raw_payload,
  };
}

// resolveAvistaTrpJson -> { pctEmpresa, pctTabela, categoria, tabLabel } | null
function calcAvista(credit, row) {
  const r = credit.resolveAvistaTrpJson(recordFrom(row));
  if (!r) return { resolved: false, pctTabela: null, pctEmpresa: null, comissao: 0, categoria: null, tabLabel: null };
  const net = toNumber(row.net_value);
  return {
    resolved: true,
    pctTabela: r.pctTabela,
    pctEmpresa: r.pctEmpresa,
    comissao: r.pctEmpresa * net,
    categoria: r.categoria,
    tabLabel: r.tabLabel,
  };
}

async function main() {
  loadEnv();
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_KEY) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local");
    process.exit(1);
  }
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const { credit, resolver, data, vig } = loadRepoLib();
  const MAPA = data.MAPA_MES_REGRA;

  let totalDiv = 0;
  let gateDiv = 0;

  for (const { comp, gate } of COMPETENCIAS) {
    const { validFrom, validUntil } = vig.vigenciaDaCompetencia(comp);
    console.log(`\n===== Competência ${comp} (vigência ${validFrom} .. ${validUntil})${gate ? "  [GATE]" : "  [extra]"} =====`);

    // fonte DB da regra desta competência
    const dbResolved = await resolver.resolveTrpRegraDb({ competencia: comp }, sb);
    if (!dbResolved) { console.log(`  ERRO: resolveTrpRegraDb(${comp}) => null (banco sem versão ativa?)`); process.exit(1); }
    if (dbResolved.isFallback) {
      console.log(`  ERRO: ${comp} caiu em FALLBACK (fornecedora=${dbResolved.competenciaFornecedora}); esperado versão própria seedada.`);
      process.exit(1);
    }

    const ops = await fetchOps(sb, validFrom, validUntil);
    console.log(`  operações no intervalo (todas, sem amostrar): ${ops.length}`);

    if (!MAPA[comp]) { console.log(`  ERRO: MAPA_MES_REGRA['${comp}'] inexistente no JSON`); process.exit(1); }
    const jsonRegra = MAPA[comp].regra;

    // OLD (JSON)
    MAPA[comp].regra = jsonRegra;
    const oldRes = ops.map((row) => calcAvista(credit, row));

    // NEW (DB) — injeta a regra_json do banco na MESMA maquinaria
    MAPA[comp].regra = dbResolved.regra;
    const newRes = ops.map((row) => calcAvista(credit, row));

    // restaura o JSON
    MAPA[comp].regra = jsonRegra;

    // comparação
    let matches = 0;
    let resolvidos = 0;
    const divergencias = [];
    for (let i = 0; i < ops.length; i++) {
      const o = oldRes[i], n = newRes[i], row = ops[i];
      if (o.resolved) resolvidos++;
      let div = null;
      if (o.resolved !== n.resolved) {
        div = `resolvido difere (OLD=${o.resolved} NEW=${n.resolved})`;
      } else if (o.resolved) {
        const dTab = Math.abs((o.pctTabela ?? 0) - (n.pctTabela ?? 0));
        const dEmp = Math.abs((o.pctEmpresa ?? 0) - (n.pctEmpresa ?? 0));
        const dCom = Math.abs(o.comissao - n.comissao);
        if (dTab >= EPS || dEmp >= EPS || dCom >= EPS) {
          div = { dTab, dEmp, dCom };
        }
      }
      if (div) {
        divergencias.push({
          proposal_number: row.proposal_number || row.id || "-",
          produto: row.product_description || "-",
          prazo: row.term_months ?? row.installments ?? "-",
          faixa: `${o.categoria ?? n.categoria ?? "-"} / ${o.tabLabel ?? n.tabLabel ?? "-"}`,
          pct_OLD: o.pctTabela, pct_NEW: n.pctTabela,
          empresa_OLD: o.pctEmpresa, empresa_NEW: n.pctEmpresa,
          delta: div,
        });
      } else {
        matches++;
      }
    }

    console.log(`  resolvidos (pct != null): ${resolvidos}`);
    console.log(`  matches: ${matches}  |  divergências: ${divergencias.length}`);
    if (divergencias.length) {
      console.log("  --- DIVERGÊNCIAS ---");
      for (const d of divergencias) {
        console.log(
          `   • ${d.proposal_number} | ${d.produto} | prazo=${d.prazo} | faixa=${d.faixa} | ` +
            `pctOLD=${d.pct_OLD} pctNEW=${d.pct_NEW} | empOLD=${d.empresa_OLD} empNEW=${d.empresa_NEW} | Δ=${JSON.stringify(d.delta)}`
        );
      }
    }

    totalDiv += divergencias.length;
    if (gate) gateDiv += divergencias.length;
  }

  console.log("\n========================================");
  console.log(`GATE junho: ${gateDiv === 0 ? "PASSOU (0 divergências)" : `FALHOU (${gateDiv} divergências)`}`);
  console.log(`Divergências totais (todas competências rodadas): ${totalDiv}`);
  console.log("========================================");

  process.exit(totalDiv === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
