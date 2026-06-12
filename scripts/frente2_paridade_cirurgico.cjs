#!/usr/bin/env node
/**
 * scripts/frente2_paridade_cirurgico.cjs — Frente 2 — PORTÃO DE PARIDADE (caminho CIRÚRGICO).
 *
 * READ-ONLY. Não escreve no banco, não toca lib/motor.ts, não commita. Só lê e reporta.
 *
 * POR QUE ESTE É O CAMINHO CERTO (o 1º harness falhou)
 *   O frente2_paridade_motor.cjs usava getMatrizTRPParaContrato, que embute o
 *   roteador da AUDITORIA (categoriasCandidatasFor) — esse roteador tem bugs e NÃO
 *   é o roteador do motor. Aqui NÃO re-roteamos: mantemos o roteador do motor
 *   (inferCreditTable, já validado correto pela TRP) e trocamos SÓ o lookup da
 *   célula, indo direto em lookupPctInRegra com o mapa 1:1 validado.
 *
 * O QUE MUDA vs O QUE FICA
 *   FICA  : tableKey (de inferCreditTable) e band (de getProductionBandByValue) —
 *           ambos VINDOS DO MOTOR REAL via calcularOperacao(op).credito.{regra,faixa_producao}.
 *           Gates do motor (getMinimumTicket / rate>0 / term>0) preservados idênticos,
 *           aplicados FORA do loader.
 *   MUDA  : a fonte do percentual da célula. VELHO = CREDIT_RULES hardcoded no motor.
 *           NOVO  = TRP versionada por competência, via lookupPctInRegra(getRegra(mes).regra, ...).
 *
 * MAPA 1:1 VALIDADO (tableKey do motor -> categoria do JSON da TRP)
 *   PUBLICO_GERAL                -> CONSIG_PUBLICO   (TRP 1.4)
 *   SP_MG                        -> CONSIG_SP_MG     (TRP 1.6)
 *   PRIVADO                      -> CONSIG_PRIVADO   (TRP 1.7)
 *   PORTABILIDADE_PUBLICO        -> PORTAB_PUBLICO   (TRP 2.2)
 *   PORTABILIDADE_PRIVADO        -> PORTAB_PRIVADO   (TRP 2.3)
 *   AUTOMATICO_SALARIO_BENEFICIO -> NAO_CONSIGNADO   (TRP 3.2)
 *   INSS_RENOVACAO               -> INSS_RENOV       (TRP 1.3)
 *   (resto = mesmo nome: INSS_NOVO 1.2, SIAPE 1.5, ADIANTAMENTO_13 3.3, FGTS 3.4)
 *
 * tabLabel
 *   band FAIXA_N -> "Faixa N" para categorias com matriz por faixa.
 *   EXCEÇÃO: PORTAB_PUBLICO, PORTAB_PRIVADO e FGTS só têm "pct_geral" no JSON —
 *   passar "pct_geral" (não "Faixa N"), senão a célula não tem a chave e volta null.
 *
 * taxa
 *   op.taxa_juros vem em PONTOS PERCENTUAIS (ex.: 1.85). lookupPctInRegra espera
 *   DECIMAL. Converte taxa>1 ? taxa/100 : taxa ANTES de chamar. O pct de saída já é
 *   decimal (0.0203) — NÃO converter o retorno.
 *
 * GATE (B) — ADIANTAMENTO_13 (decisão do Diego)
 *   O motor exige minRate (=tx_juros_min) p/ ADIANTAMENTO_13: taxa abaixo => 0
 *   (FORA_DA_TABELA). O loader IGNORA tx_juros_min só p/ ADIANTAMENTO_13
 *   (skipTxJurosMin, convenção humana v9). Para manter paridade, replicamos o
 *   gate do motor lendo tx_juros_min DO DADO (cat.tx_juros_min da regra do mês,
 *   não hardcoded), forçando pct=0 quando taxa < tx_juros_min. Elimina a única
 *   divergência (contrato 17b61ec5, 13º a 1,43% < 3,25%). Demais categorias: nada
 *   muda (o loader já enforca tx_juros_min nelas).
 *
 * ESCOPO (VOLUME_5 + fallback)
 *   Determina o regime da competência via loader.getRegime(mes). Se VOLUME_5_FAIXAS
 *   (2026-04+): faz o lookup novo. Se regime != VOLUME_5: marca FALLBACK (no motor
 *   real isso usaria CREDIT_RULES; no harness FALLBACK = "não testar, usa hardcoded"
 *   — conta SEPARADO, NÃO é divergência). Universo = abr+mai+jun/2026, todos
 *   VOLUME_5: nenhum deve cair em FALLBACK. Se cair, é bug na detecção de regime.
 *
 * COMPETÊNCIA POR VIGÊNCIA (regra real da Promotiva — reusada, não reimplementada)
 *   A competência da regra = a TRP cuja JANELA DE VIGÊNCIA (holiday-aware) contém a
 *   contract_date. Fonte: lib/productionPeriod.ts (getProductionWindow /
 *   getProductionPeriodFromValue). abril/TRP35, maio/TRP36, junho/TRP37.
 *
 * BAND
 *   Varre as 5 faixas por contrato injetando production_value representativo;
 *   calcularOperacao define a band via getProductionBandByValue REAL e o NOVO usa a
 *   MESMA band. Prova identidade para QUALQUER faixa.
 *
 * SANITY ABRIL
 *   Em abril o CREDIT_RULES do motor É a transcrição do TRP35 → VELHO==NOVO por
 *   construção. Qualquer divergência em abril é bug do MAPA/BORDA (categoria,
 *   tabLabel, taxa, gate), NÃO diferença de TRP. Reportada em destaque.
 *
 * Como rodar (Diego):  node scripts/frente2_paridade_cirurgico.cjs
 * Requisitos: .env.local com NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
 *             npx tsc disponível (já é dep do repo).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const TOL = 1e-9;                       // tolerância de paridade no pct cru (decimal)
const EPS = 1e-7;                       // mesma tolerância de range do loader (regrasLoader.ts:31)
const REGIME_ALVO = "VOLUME_5_FAIXAS";  // escopo testável; fora disso = FALLBACK

// Competências a testar (janela de vigência calculada em runtime; NÃO datas hardcoded).
const COMPETENCIAS = [
  { mes: "2026-04", year: 2026, month: 4, trp: "TRP35", sanity: true },
  { mes: "2026-05", year: 2026, month: 5, trp: "TRP36", sanity: false },
  { mes: "2026-06", year: 2026, month: 6, trp: "TRP37", sanity: false },
];

// Valor de produção representativo por faixa (thresholds 0/1M/3M/7M/20M).
const REP_VALUE = {
  FAIXA_1: 0,
  FAIXA_2: 1_500_000,
  FAIXA_3: 4_000_000,
  FAIXA_4: 10_000_000,
  FAIXA_5: 25_000_000,
};
const BANDS = Object.keys(REP_VALUE);

// MAPA 1:1 validado: tableKey (motor) -> categoria (JSON). Ausente = mesmo nome.
const MAP_TABLEKEY_TO_CATEGORIA = {
  PUBLICO_GERAL: "CONSIG_PUBLICO",
  SP_MG: "CONSIG_SP_MG",
  PRIVADO: "CONSIG_PRIVADO",
  PORTABILIDADE_PUBLICO: "PORTAB_PUBLICO",
  PORTABILIDADE_PRIVADO: "PORTAB_PRIVADO",
  AUTOMATICO_SALARIO_BENEFICIO: "NAO_CONSIGNADO",
  INSS_RENOVACAO: "INSS_RENOV",
  // resto idêntico: INSS_NOVO, SIAPE, ADIANTAMENTO_13, FGTS
};
// Categorias do JSON que só têm "pct_geral" (sem variação por faixa).
const CATEGORIAS_PCT_GERAL = new Set(["PORTAB_PUBLICO", "PORTAB_PRIVADO", "FGTS"]);

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

// ---------------------------------------- COMPILAR O MOTOR REAL -> CJS -------
// Idêntico ao frente2_paridade_motor.cjs: compila o código REAL do repo. Usamos
// lookupPctInRegra + getRegra + getRegime do loader (NÃO getMatrizTRPParaContrato).
function compilarReal() {
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "frente2-cirurgico-"));
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
    // erros de TIPO não impedem emit (noEmitOnError:false); checagem abaixo decide.
  }
  for (const alvo of ["lib/motor.js", "lib/regrasLoader.js", "lib/prazoTrp.js", "lib/productionPeriod.js"]) {
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
    motor: require(path.join(OUT, "lib/motor.js")),         // calcularOperacao
    loader: require(path.join(OUT, "lib/regrasLoader.js")), // lookupPctInRegra, getRegra, getRegime
    prazo: require(path.join(OUT, "lib/prazoTrp.js")),      // getPrazoTrp
    period: require(path.join(OUT, "lib/productionPeriod.js")),
  };
}

// ----------------------------------------------------- helpers (motor-fiel) ---
function toNumber(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
// getMinimumTicket — CÓPIA VERBATIM de lib/motor.ts:394-403 (gate preservado fora do loader).
function getMinimumTicket(tableKey) {
  if (tableKey === "FGTS") return 1000;
  if (tableKey === "PORTABILIDADE_PUBLICO" || tableKey === "PORTABILIDADE_PRIVADO") return 2500;
  if (tableKey === "PRIVADO") return 2000;
  return 100;
}
function pf(x) { return x == null ? "—" : (x * 100).toFixed(4).replace(".", ",") + "%"; }

// ----------------------------------------------------- getCreditPercent-NOVO ---
// SÓ o lookup da célula muda. tableKey e band vêm do motor real (parâmetros).
function getCreditPercentNovo(loader, op, band, mes, tableKey) {
  // ESCOPO: regime da competência. Fora de VOLUME_5 -> FALLBACK (não testa).
  const regime = loader.getRegime(mes);
  if (regime !== REGIME_ALVO) {
    return { fallback: true, regime, pct: null, categoria: null, tabLabel: null, celula: null };
  }

  // Gates idênticos ao motor (motor.ts:412), FORA do loader. Se zera, NOVO == VELHO (0).
  const ticket = toNumber(op.valor_liquido);
  const rate = toNumber(op.taxa_juros);
  const term = Math.trunc(toNumber(op.prazo));
  if (ticket < getMinimumTicket(tableKey) || rate <= 0 || term <= 0) {
    return { fallback: false, gated: true, pct: 0, categoria: null, tabLabel: null, celula: null };
  }

  // Mapa 1:1 + tabLabel (Faixa N, exceto pct_geral) + taxa pontos->decimal.
  const categoria = MAP_TABLEKEY_TO_CATEGORIA[tableKey] || tableKey;
  const tabLabel = CATEGORIAS_PCT_GERAL.has(categoria)
    ? "pct_geral"
    : `Faixa ${band.split("_")[1]}`;
  const taxaDec = rate > 1 ? rate / 100 : rate;

  const r = loader.getRegra(mes);
  if (!r) {
    return { fallback: false, gated: false, pct: null, categoria, tabLabel, celula: null,
             motivo: `getRegra(${mes}) = null` };
  }

  // CAMINHO (B) — preservar o gate do motor para ADIANTAMENTO_13.
  // O loader (lookupPctInRegra) IGNORA tx_juros_min de propósito SÓ para
  // ADIANTAMENTO_13 (skipTxJurosMin, regrasLoader.ts:132) — convenção humana v9.
  // O motor.ts NÃO ignora: sua regra exige minRate (=tx_juros_min). Aqui replicamos
  // o motor: se taxa < tx_juros_min DECLARADO NA REGRA DO MÊS, força FORA_DA_TABELA.
  // tx_juros_min vem do DADO (cat.tx_juros_min do JSON da competência) — não
  // hardcoded 3.25 — então vale para qualquer competência/TRP.
  if (categoria === "ADIANTAMENTO_13") {
    const cat = r.regra[categoria];
    const txMin = cat && typeof cat.tx_juros_min === "number" ? cat.tx_juros_min : null;
    if (txMin != null && taxaDec < txMin - EPS) {
      return {
        fallback: false, gated: false, pct: 0, categoria, tabLabel,
        celula: `ADIANTAMENTO_13: taxa ${taxaDec} < tx_juros_min ${txMin} (FORA_DA_TABELA, gate B)`,
      };
    }
  }

  const out = loader.lookupPctInRegra(
    r.regra, categoria, taxaDec, term, tabLabel, r.jsonRegra, r.regraInferida
  );
  return {
    fallback: false, gated: false,
    pct: out.pct,            // decimal CRU, sem teto, ou null
    categoria, tabLabel, celula: out.celula,
  };
}

// ----------------------------------------------------- leitura read-only ------
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
    taxa_juros: r.interest_rate,            // cru (percent, ex.: 1.85) — igual à rota
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
  console.log("Compilando motor + loader + productionPeriod reais para CJS...");
  const { motor, loader, prazo, period } = compilarReal();
  const { calcularOperacao } = motor;
  const { getPrazoTrp } = prazo;
  const { getProductionWindow, getProductionPeriodFromValue, getProductionPeriodKey } = period;

  const resumo = [];
  const divergencias = [];
  let totalComparacoes = 0;

  for (const comp of COMPETENCIAS) {
    const window = getProductionWindow(comp.year, comp.month); // canônica, holiday-aware
    console.log(`\nLendo ${comp.mes} (${comp.trp}) — VIGÊNCIA contract_date [${window.start}, ${window.endExclusive})...`);
    const rows = await fetchCompetencia(window);
    let srcc = 0, foraJanela = 0;
    let comparacoes = 0, fallback = 0, batem = 0, divergem = 0;

    for (const r of rows) {
      if (r.is_srcc_restricted === true) srcc++;

      // Competência POR CONTRATO via vigência canônica. Deve coincidir com o bucket.
      const periodo = getProductionPeriodFromValue(r.contract_date);
      const compMes = periodo ? getProductionPeriodKey(periodo.year, periodo.month) : null;
      if (compMes !== comp.mes) {
        foraJanela++;
        divergencias.push({
          mes: comp.mes, sanity: comp.sanity, id: r.id, data: r.contract_date,
          band: "—", tableKey: "(vigência)", categoria: null, tabLabel: null,
          pctVelho: null, pctNovo: null, delta: null,
          motivo: `contract_date ${r.contract_date} -> competência ${compMes ?? "null"} != bucket ${comp.mes}`,
        });
        divergem++;
        continue;
      }

      const op = buildOp(r, getPrazoTrp);

      for (const band of BANDS) {
        op.production_value = REP_VALUE[band];

        // VELHO — código REAL. percentual = pct CRU; regra = tableKey; faixa = band.
        let velho;
        try {
          velho = calcularOperacao(op);
        } catch (e) {
          divergencias.push({
            mes: comp.mes, sanity: comp.sanity, id: r.id, data: r.contract_date,
            band, tableKey: "(erro)", categoria: null, tabLabel: null,
            pctVelho: null, pctNovo: null, delta: null,
            motivo: `calcularOperacao lançou: ${e.message || e}`,
          });
          divergem++; comparacoes++; totalComparacoes++;
          continue;
        }
        const tableKey = velho.credito.regra;
        const bandReal = velho.credito.faixa_producao;
        const pctVelho = velho.credito.percentual;

        if (bandReal !== band) {
          divergencias.push({
            mes: comp.mes, sanity: comp.sanity, id: r.id, data: r.contract_date,
            band, tableKey, categoria: null, tabLabel: null,
            pctVelho, pctNovo: null, delta: null,
            motivo: `band injetada ${band} != faixa_producao real ${bandReal} (REP_VALUE inconsistente)`,
          });
          divergem++; comparacoes++; totalComparacoes++;
          continue;
        }

        // NOVO — só o lookup muda. tableKey e band do motor real.
        const novo = getCreditPercentNovo(loader, op, band, compMes, tableKey);

        // FALLBACK: não testa (conta separado, não é divergência). Não deve ocorrer
        // em abr/mai/jun (todos VOLUME_5) — se ocorrer, é bug de detecção de regime.
        if (novo.fallback) {
          fallback++;
          continue;
        }

        comparacoes++; totalComparacoes++;

        let match, motivo = null;
        if (novo.pct == null) {
          // loader não achou célula. Em mês COBERTO, só "casa" se o velho também
          // não paga (pctVelho == 0). Se o velho paga, o lookup falhou em reproduzir.
          if (pctVelho === 0) {
            match = true;
          } else {
            match = false;
            motivo = `lookup_null mas velho paga ${pf(pctVelho)}` +
              (novo.motivo ? ` | ${novo.motivo}` : "") +
              (novo.celula ? ` | celula:${novo.celula}` : "");
          }
        } else {
          const delta = novo.pct - pctVelho;
          match = Math.abs(delta) < TOL;
          if (!match) motivo = `Δ=${delta.toExponential(3)}`;
        }

        if (match) { batem++; continue; }
        divergem++;
        divergencias.push({
          mes: comp.mes, sanity: comp.sanity, id: r.id, data: r.contract_date,
          band, tableKey, categoria: novo.categoria, tabLabel: novo.tabLabel,
          pctVelho, pctNovo: novo.pct,
          delta: novo.pct == null ? null : novo.pct - pctVelho,
          motivo,
        });
      }
    }

    resumo.push({ mes: comp.mes, trp: comp.trp, contratos: rows.length, srcc, foraJanela,
                  comparacoes, fallback, batem, divergem });
  }

  // ----------------------------------------------------------- relatório ----
  console.log("\n===================================== RESUMO POR COMPETÊNCIA =====================================");
  console.log("| comp    | TRP   | contratos | foraJanela | comparações | FALLBACK | batem | DIVERGEM |");
  console.log("|---------|-------|-----------|------------|-------------|----------|-------|----------|");
  for (const s of resumo) {
    console.log(`| ${s.mes} | ${s.trp} | ${String(s.contratos).padStart(9)} | ` +
      `${String(s.foraJanela).padStart(10)} | ${String(s.comparacoes).padStart(11)} | ` +
      `${String(s.fallback).padStart(8)} | ${String(s.batem).padStart(5)} | ${String(s.divergem).padStart(8)} |`);
  }

  const divAbril = divergencias.filter((d) => d.sanity);
  const divOutros = divergencias.filter((d) => !d.sanity);
  const totalFallback = resumo.reduce((a, s) => a + s.fallback, 0);

  if (divAbril.length) {
    console.log("\n!!!!!!!!!! SANITY ABRIL FALHOU — BUG DO MAPA/BORDA (velho==TRP35 por construção) !!!!!!!!!!");
    printTabela(divAbril);
  } else {
    console.log("\nSanity abril: OK (0 divergências — mapa/borda reproduzem TRP35 == CREDIT_RULES).");
  }

  if (totalFallback > 0) {
    console.log(`\n!!!!!!!!!! FALLBACK > 0 (${totalFallback}) — abr/mai/jun são VOLUME_5: isto é BUG de detecção de regime.`);
  }

  console.log("\n=== DIVERGENTES (todas as competências) ===");
  if (divergencias.length === 0) {
    console.log("Nenhuma. VELHO == NOVO em todos os contratos e todas as faixas.");
  } else {
    printTabela(divergencias);
  }

  // ----------------------------------------------------------- veredito -----
  console.log("\n========================= VEREDITO =========================");
  console.log(`Comparações totais: ${totalComparacoes} | FALLBACK: ${totalFallback} | ` +
    `Divergências: ${divergencias.length} (abril ${divAbril.length} / mai+jun ${divOutros.length})`);
  console.log("\nREAD-ONLY: nenhuma escrita no banco, motor.ts intocado.");
  if (divergencias.length > 0 || totalFallback > 0) {
    console.log("\nPORTÃO: FALHOU. Paridade != 0 (ou FALLBACK > 0) — NÃO plugar o refactor.");
    console.log("Mostro os deltas acima; decisão é do Diego (o harness NÃO conserta).");
    process.exit(1);
  }
  console.log("\nPORTÃO: PASSOU. Paridade 0 em abr+mai+jun, FALLBACK 0 — caminho cirúrgico é");
  console.log("comportamento-idêntico. Pode implementar a troca do lookup no motor.");
  process.exit(0);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });

function printTabela(arr) {
  console.log(["comp", "contrato", "data", "faixa", "tableKey", "categoria", "tabLabel", "%velho", "%novo", "delta", "motivo"].join(" | "));
  for (const d of arr) {
    console.log([
      d.mes,
      String(d.id).slice(0, 10),
      String(d.data || "—"),
      d.band,
      String(d.tableKey || "—").padEnd(16),
      String(d.categoria || "—").padEnd(16),
      String(d.tabLabel || "—").padEnd(9),
      pf(d.pctVelho),
      pf(d.pctNovo),
      d.delta == null ? "—" : d.delta.toExponential(3),
      d.motivo || "",
    ].join(" | "));
  }
}
