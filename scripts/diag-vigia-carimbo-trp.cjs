#!/usr/bin/env node
/**
 * scripts/diag-vigia-carimbo-trp.cjs — O VIGIA DO CARIMBO DA TRP NO PMR.
 * READ-ONLY. Nao grava nada, nao reconsolida nada.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * A decisao (b) do Diego (31/08/2026): numa competencia de vigencia PARTIDA o
 * PMR grava trp_version_id = NULL + trp_multi_versao = TRUE, porque carimbar UMA
 * das versoes seria "afirmacao falsa que confere". A regra e uma funcao pura
 * (lib/trp/carimboPmr.ts) e tem portao — mas ate 02/09/2026 ela NUNCA tinha
 * rodado contra DADO REAL numa competencia partida.
 *
 * 2026-08 e a primeira: TRP38 ate 04/08 e TRP39 de 05/08 (2 fatias ativas).
 *
 * QUANDO RODAR: depois do import do fechamento da ADS de 2026-08 — e SO ele.
 * O fechamento da RR (source='fechamento') NAO exercita o carimbo: grava NULL
 * por construcao, porque a comissao ja vem pronta do arquivo e a TRP ali e
 * regua de AUDITORIA, nao insumo do PMR (closingMonthly.ts:574-580, e o
 * ledgerHealth trata RR como NAO_APLICAVEL). Quem exercita e bbtsMonthly.ts:422.
 *
 * OS 4 PONTOS (corrigidos por medicao em 02/09/2026)
 * -------------------------------------------------
 *   1. as linhas da ADS em 2026-08 saem com trp_version_id NULL e
 *      trp_multi_versao TRUE;
 *   2. QUANTAS, e se alguma saiu com id carimbado — isso seria O DEFEITO;
 *   3. o ledgerHealth poe agosto em `trp_multi_versao` (INFO) e NAO em
 *      `trp_desconhecido` (alerta) nem em `trp_stale` (erro);
 *   4. CONTROLE: julho (regua unica) mantem id=59025dd8 e multi=NULL. Atencao —
 *      NULL, nao false: as linhas de julho sao ANTERIORES a coluna, e todo o
 *      historico do PMR esta NULL (medido 01/09: 0 linhas nao-nulas no banco).
 *      Julho so viraria `false` se fosse RECONSOLIDADO. Cobrar `false` aqui
 *      acusaria defeito onde nao ha.
 *
 * A LINHA DE BASE DO trp_desconhecido — MEDIDA em 02/09/2026, ANTES do import
 * -------------------------------------------------------------------------
 * O contador `trp_desconhecido` do ledgerHealth JA ESTAVA EM 1, apontando para
 * JUNHO/2026 (`[{"year":2026,"month":6}]`). Isso e ANTERIOR a esta frente e nao
 * tem relacao com agosto: e PMR fechado da ADS calculado antes do rastreamento
 * existir, e resolve numa reconsolidacao de junho.
 *
 * A CONSEQUENCIA, e o motivo de estar cravado como constante abaixo: quando
 * agosto entrar, o contador tem de CONTINUAR EM 1, e o detalhe tem de continuar
 * dizendo SO junho. Se virar 2 — ou se agosto aparecer no detalhe — agosto caiu
 * no BUCKET ERRADO e a decisao (b) FALHOU: a competencia partida estaria sendo
 * classificada como "esqueceram de carimbar" em vez de "nao cabe em um id".
 *
 * Comparar "antes x depois" a olho depende de alguem lembrar do numero. Por isso
 * ele e uma constante conferida (DESCONHECIDO_BASE), nao uma nota.
 *
 * ARMADILHA DE LEITURA, que este script respeita: trp_multi_versao se le sempre
 * `=== true`. NUNCA `!multiVersao` — `!null` e `true`, e a leitura preguicosa
 * reclassifica TODO o passado como competencia partida (carimboPmr.ts:30-34).
 *
 * Uso:  node scripts/diag-vigia-carimbo-trp.cjs [alvo] [controle]
 *       node scripts/diag-vigia-carimbo-trp.cjs 2026-08 2026-07   (default)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const ALVO = process.argv[2] || "2026-08";
const CONTROLE = process.argv[3] || "2026-07";
/** O id que julho carrega hoje. Se mudar, o controle avisa em vez de passar liso. */
const CONTROLE_ID_ESPERADO = "59025dd8";

/**
 * LINHA DE BASE do trp_desconhecido, medida em 02/09/2026 ANTES do import da ADS
 * de agosto: 1 competencia, e ela e junho/2026. Ver o cabecalho.
 * Se agosto entrar neste bucket, a decisao (b) falhou.
 */
const DESCONHECIDO_BASE = 1;
const DESCONHECIDO_BASE_COMPETENCIAS = ["2026-06"];

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

/** Compila os modulos REAIS do detector/ledger — nada reimplementado aqui. */
function loadLib() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".vigia-out-"));
  process.on("exit", () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {} });
  fs.writeFileSync(path.join(OUT, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true,
      resolveJsonModule: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [
      path.join(ROOT, "lib/diagnostico/ledgerHealth.ts"),
      path.join(ROOT, "lib/trp/detectorReguaObsoleta.ts"),
    ],
  }));
  try { execSync(`npx tsc -p "${path.join(OUT, "tsconfig.json")}"`, { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (r, ...rest) {
    if (r.startsWith("@/")) r = path.join(OUT, r.slice(2));
    return orig.call(this, r, ...rest);
  };
  const p1 = path.join(OUT, "lib/diagnostico/ledgerHealth.js");
  const p2 = path.join(OUT, "lib/trp/detectorReguaObsoleta.js");
  return {
    ledger: fs.existsSync(p1) ? require(p1) : null,
    detector: fs.existsSync(p2) ? require(p2) : null,
  };
}

const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ym = (c) => ({ year: Number(c.slice(0, 4)), month: Number(c.slice(5, 7)) });

const veredito = [];
function checa(n, cond, msg) {
  console.log(`  ${cond ? "OK   " : "FALHA"} [${n}] ${msg}`);
  if (!cond) veredito.push(`[${n}] ${msg}`);
}

async function censoPmr(sb, comp, nomeDe) {
  const { year, month } = ym(comp);
  const { data, error } = await sb
    .from("promoter_monthly_results")
    .select("promoter_id,company_id,source,trp_version_id,trp_fallback,trp_multi_versao,production_value,final_commission_value,discount_value")
    .eq("year", year).eq("month", month);
  if (error) throw new Error(`PMR ${comp}: ${error.message}`);
  return data || [];
}

function agrupa(linhas, nomeDe) {
  const g = new Map();
  for (const r of linhas) {
    const k = [
      nomeDe(r.company_id),
      r.source,
      r.trp_version_id ? r.trp_version_id.slice(0, 8) : "NULL",
      String(r.trp_multi_versao),
      String(r.trp_fallback),
    ].join(" | ");
    if (!g.has(k)) g.set(k, { n: 0, comissao: 0, producao: 0 });
    const a = g.get(k);
    a.n++;
    a.comissao += Number(r.final_commission_value) || 0;
    a.producao += Number(r.production_value) || 0;
  }
  return g;
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local)");
    process.exit(2);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { ledger, detector } = loadLib();

  const { data: comps } = await sb.from("companies").select("id,name");
  const nomeDe = (id) => (comps || []).find((c) => c.id === id)?.name ?? String(id).slice(0, 8);

  // ---------------------------------------------------------------------
  console.log(`\n=== FATIAS ATIVAS por competencia (quem esta PARTIDA) ===`);
  const { data: vers } = await sb.from("trp_rule_versions")
    .select("id,competencia,version_no,valid_from,valid_until").eq("is_active", true).order("competencia");
  const porComp = {};
  for (const r of vers || []) (porComp[String(r.competencia).slice(0, 7)] ||= []).push(r);
  for (const c of Object.keys(porComp).sort()) {
    const f = porComp[c];
    console.log(`  ${c}: ${f.length} ativa(s)${f.length > 1 ? "  <-- PARTIDA" : ""}  ` +
      f.map((x) => `v${x.version_no} ${x.id.slice(0, 8)} [${x.valid_from}..${x.valid_until}]`).join("  "));
  }
  const alvoPartida = (porComp[ALVO] || []).length > 1;
  checa("pre", alvoPartida,
    `${ALVO} tem 2+ fatias ativas — sem isso o teste do carimbo partido nao existe`);

  // ---------------------------------------------------------------------
  console.log(`\n=== CENSO do PMR — ${ALVO} (alvo) ===`);
  const alvo = await censoPmr(sb, ALVO, nomeDe);
  console.log(`  linhas: ${alvo.length}`);
  if (alvo.length === 0) {
    console.log("  (PMR de " + ALVO + " ainda nao existe — rode DEPOIS do import da ADS)");
  }
  console.log("  empresa | source | trp_id | multi | fallback           n     Sigma comissao");
  console.log("  ------------------------------------------------------  ---  ---------------");
  for (const [k, a] of [...agrupa(alvo, nomeDe)].sort()) {
    console.log(`  ${k.padEnd(54)}  ${String(a.n).padStart(3)}  ${brl(a.comissao).padStart(15)}`);
  }

  const ads = alvo.filter((r) => r.source === "bbts");
  const rr = alvo.filter((r) => r.source === "fechamento");

  // ---- PONTO 1 e 2 ----------------------------------------------------
  console.log(`\n=== PONTO 1 e 2 — o carimbo da ADS em ${ALVO} (competencia PARTIDA) ===`);
  if (ads.length === 0) {
    console.log("  Nenhuma linha source='bbts' — o import da ADS ainda nao rodou.");
    console.log("  NADA A CONFERIR AQUI AINDA. (o fechamento da RR nao exercita o carimbo)");
  } else {
    const nulos = ads.filter((r) => r.trp_version_id === null);
    const multiTrue = ads.filter((r) => r.trp_multi_versao === true); // === true, NUNCA !x
    const comId = ads.filter((r) => r.trp_version_id !== null);
    console.log(`  linhas da ADS: ${ads.length}`);
    console.log(`    trp_version_id NULL      : ${nulos.length}`);
    console.log(`    trp_multi_versao === true: ${multiTrue.length}`);
    console.log(`    COM id carimbado         : ${comId.length}  <-- tem de ser 0`);
    checa(1, nulos.length === ads.length, `todas as ${ads.length} linhas da ADS com trp_version_id NULL`);
    checa(1, multiTrue.length === ads.length, `todas as ${ads.length} com trp_multi_versao === true`);
    checa(2, comId.length === 0,
      `nenhuma linha saiu com id carimbado (achei ${comId.length}${comId.length ? " — DEFEITO: " + comId.map((r) => r.trp_version_id.slice(0, 8)).join(",") : ""})`);
    const fbTrue = ads.filter((r) => r.trp_fallback === true);
    checa(2, fbTrue.length === 0,
      `trp_fallback false em todas (partida exige fatias PROPRIAS; achei ${fbTrue.length} com true)`);
  }

  // ---- PONTO 4 (controle) ---------------------------------------------
  console.log(`\n=== PONTO 4 — CONTROLE: ${CONTROLE} (regua unica) ===`);
  const ctrl = await censoPmr(sb, CONTROLE, nomeDe);
  const ctrlAds = ctrl.filter((r) => r.source === "bbts");
  console.log(`  linhas da ADS em ${CONTROLE}: ${ctrlAds.length}`);
  const ids = [...new Set(ctrlAds.map((r) => (r.trp_version_id || "NULL").slice(0, 8)))];
  const multis = [...new Set(ctrlAds.map((r) => String(r.trp_multi_versao)))];
  console.log(`    trp_version_id distintos : ${ids.join(", ")}`);
  console.log(`    trp_multi_versao distintos: ${multis.join(", ")}`);
  checa(4, ctrlAds.length > 0, `${CONTROLE} tem linhas da ADS para servir de controle`);
  checa(4, ids.length === 1 && ids[0] === CONTROLE_ID_ESPERADO,
    `${CONTROLE} carimba o id unico ${CONTROLE_ID_ESPERADO} (achei ${ids.join(",")})`);
  checa(4, multis.every((m) => m === "null" || m === "false"),
    `${CONTROLE} com multi_versao NULL (legado) ou false (se reconsolidado) — nunca true. Achei: ${multis.join(",")}`);
  if (multis.includes("null")) {
    console.log(`    NOTA: 'null' aqui e o LEGADO, nao defeito — linhas anteriores a coluna.`);
    console.log(`          So viram 'false' se ${CONTROLE} for RECONSOLIDADO.`);
  }

  // ---- PONTO 3 (ledgerHealth) -----------------------------------------
  console.log(`\n=== PONTO 3 — ledgerHealth ===`);
  if (!ledger || !ledger.buildLedgerHealth) {
    console.log("  (nao consegui carregar buildLedgerHealth — pulado, NAO conta como OK)");
    veredito.push("[3] ledgerHealth nao pode ser avaliado");
  } else {
    const h = await ledger.buildLedgerHealth(sb);
    const pega = (id) => (h.checks || []).find((c) => c.id === id);
    for (const id of ["trp_stale", "trp_desconhecido", "trp_multi_versao"]) {
      const c = pega(id);
      console.log(`  ${id.padEnd(20)} count=${c ? c.count : "(ausente)"}  severidade=${c ? c.severity : "-"}`);
      if (c && c.count > 0 && c.detalhe) console.log(`     detalhe: ${JSON.stringify(c.detalhe).slice(0, 300)}`);
    }
    const stale = pega("trp_stale");
    const desc = pega("trp_desconhecido");
    const multi = pega("trp_multi_versao");
    checa(3, stale && stale.count === 0, `trp_stale (erro) zerado (count=${stale ? stale.count : "?"})`);

    // A linha de base NAO e "zero": junho/2026 ja estava aqui antes desta frente.
    // O que se cobra e que ela NAO CRESCA — crescer significa agosto caindo no
    // bucket errado. Ver DESCONHECIDO_BASE no topo.
    const descComps = Array.isArray(desc && desc.detalhe)
      ? desc.detalhe.map((d) => `${d.year}-${String(d.month).padStart(2, "0")}`)
      : [];
    console.log(`     linha de base: ${DESCONHECIDO_BASE} (${DESCONHECIDO_BASE_COMPETENCIAS.join(",")}) — medida em 02/09/2026`);
    console.log(`     agora        : ${desc ? desc.count : "?"} (${descComps.join(",") || "-"})`);
    checa(3, desc && desc.count <= DESCONHECIDO_BASE,
      `trp_desconhecido NAO cresceu alem da base ${DESCONHECIDO_BASE} (count=${desc ? desc.count : "?"})`);
    checa(3, !descComps.includes(ALVO),
      `${ALVO} NAO esta em trp_desconhecido (se estiver, a partida caiu no bucket errado e a decisao (b) falhou)`);
    if (ads.length > 0) {
      checa(3, multi && multi.count > 0 && multi.severity === "info",
        `trp_multi_versao presente e INFO (count=${multi ? multi.count : "?"}, sev=${multi ? multi.severity : "?"})`);
    } else {
      console.log("  (sem linhas da ADS em " + ALVO + ": os itens 'desconhecido' e 'multi' so valem depois do import)");
    }
  }

  // ---- Valores (para conferir contra o que a Promotiva mandou) ---------
  console.log(`\n=== VALORES de ${ALVO} por empresa (conferencia contra o documento) ===`);
  const porEmp = new Map();
  for (const r of alvo) {
    const k = `${nomeDe(r.company_id)} (${r.source})`;
    if (!porEmp.has(k)) porEmp.set(k, { n: 0, comissao: 0, producao: 0, desconto: 0 });
    const a = porEmp.get(k);
    a.n++;
    a.comissao += Number(r.final_commission_value) || 0;
    a.producao += Number(r.production_value) || 0;
    a.desconto += Number(r.discount_value) || 0;
  }
  let tc = 0, tp = 0;
  console.log("  empresa (source)                   promotores       Sigma producao   Sigma comissao");
  console.log("  ---------------------------------  ----------  -------------------  ---------------");
  for (const [k, a] of [...porEmp].sort()) {
    tc += a.comissao; tp += a.producao;
    console.log(`  ${k.padEnd(33)}  ${String(a.n).padStart(10)}  ${brl(a.producao).padStart(19)}  ${brl(a.comissao).padStart(15)}`);
  }
  console.log(`  ${"TOTAL".padEnd(33)}  ${String(alvo.length).padStart(10)}  ${brl(tp).padStart(19)}  ${brl(tc).padStart(15)}`);

  console.log("\n========================================");
  if (veredito.length === 0) {
    console.log("VIGIA: tudo conforme o desenho.");
  } else {
    console.log(`VIGIA: ${veredito.length} ponto(s) FORA do esperado:`);
    for (const v of veredito) console.log(`  - ${v}`);
    console.log("\nSe algum dos pontos 1/2/3 falhou com linhas da ADS presentes, a decisao (b)");
    console.log("nao esta valendo contra dado real. PARE e reporte antes de reconsolidar.");
  }
  console.log("========================================");
  process.exit(veredito.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
