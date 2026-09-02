#!/usr/bin/env node
/*
 * scripts/gate_master_sem_comissao.cjs — CHAVE MASTER E BALDE, NAO RECEBE REPASSE.
 *
 * O DEFEITO QUE ESTE PORTAO FECHA: `cmsMonthly` zerava a comissao da chave
 * master na origem (linhas 268-275), `closingMonthly` NAO. Medido em
 * 02/09/2026: 2 linhas vivas em 2026-04, source='fechamento', R$ 164,04.
 *
 * TRES LADOS, todos no mesmo run — porque cada um sozinho passaria por engano:
 *   A. a REGRA (lib/master/comissaoChaveMaster.ts) zera, e le `=== true`
 *      estrito. Provado por MUTACAO DO FONTE REAL;
 *   B. o CONSOLIDADOR usa a regra. Uma funcao pura correta que ninguem chama e
 *      decoracao — este e o lado que mais facilmente apodrece;
 *   C. o BANCO nao piora. O fossil de 2026-04 fica (limpa-lo exige reconsolidar
 *      mes fechado, que mexe em dinheiro, e e decisao a parte); o que se cobra e
 *      que ele NAO CRESCA.
 *
 * SOBRE A LINHA DE BASE do lado C: e uma constante CONFERIDA, no molde do
 * DESCONHECIDO_BASE do vigia da TRP — nao um valor congelado que faz o portao
 * passar. Os dois lados sao computados no mesmo run: o banco de agora contra a
 * base datada. Se um fechamento novo criar master com comissao, o numero sobe e
 * o portao reprova.
 *
 * modo: needs-db.
 */
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { carregaReal, carregaMutante, ROOT } = require("./_mutanteTs.cjs");

const MODULO = "lib/master/comissaoChaveMaster.ts";
const CONSOLIDADOR = "lib/closingMonthly.ts";

/** Linha de base MEDIDA em 02/09/2026, ANTES desta defesa existir. */
const FOSSIL_BASE = 2;
const FOSSIL_BASE_COMPETENCIAS = ["2026-04"];
const FOSSIL_BASE_VALOR = 164.04;

const falhas = [];
const ok = (n, cond, msg) => {
  console.log(`  ${cond ? "OK   " : "FALHA"} [${n}] ${msg}`);
  if (!cond) falhas.push(`[${n}] ${msg}`);
};

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

const comp = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

async function main() {
  console.log("\n=== GATE chave master sem comissao ===");
  const real = carregaReal(MODULO);

  // ---------------------------------------------------------------- A. regra
  console.log("\n[A] a regra, com o FONTE REAL");
  const zerado = real.comissaoDeChaveMaster(true, 1000, 250);
  ok("A1", zerado.productionCommission === 0 && zerado.insuranceCommission === 0,
    "master: producao e seguro zerados");
  ok("A2", zerado.finalCommission === 0, "master: final zerado");
  const normal = real.comissaoDeChaveMaster(false, 1000, 250);
  ok("A3", normal.productionCommission === 1000 && normal.insuranceCommission === 250 && normal.finalCommission === 1250,
    "nao-master: passa reto, sem tocar em valor nenhum");
  // `is_master` e null na maior parte do cadastro: leitura frouxa inverteria tudo
  const legado = real.comissaoDeChaveMaster(null, 1000, 250);
  ok("A4", legado.finalCommission === 1250,
    "is_master=null (legado) NAO e tratado como master — leitura `=== true` estrita");
  const indefinido = real.comissaoDeChaveMaster(undefined, 7, 3);
  ok("A5", indefinido.finalCommission === 10, "is_master ausente tambem nao zera ninguem");

  // ------------------------------------------------------------- MUTACAO
  console.log("\n[MUT] quebrando a regra de proposito — o portao TEM de ficar vermelho");
  const mutantes = [
    {
      nome: "nao zera nada (o defeito original)",
      trocas: [["const master = isMaster === true;", "const master = false;"]],
      espera: (mod) => mod.comissaoDeChaveMaster(true, 1000, 250).finalCommission !== 0,
    },
    {
      nome: "le is_master de forma frouxa (truthy)",
      trocas: [["const master = isMaster === true;", "const master = !!isMaster || isMaster === null;"]],
      // o legado (null) seria zerado por engano
      espera: (mod) => mod.comissaoDeChaveMaster(null, 1000, 250).finalCommission !== 1250,
    },
    {
      nome: "zera so o credito e esquece o seguro",
      trocas: [["const seguro = master ? 0 : insuranceCommission;", "const seguro = insuranceCommission;"]],
      espera: (mod) => mod.comissaoDeChaveMaster(true, 1000, 250).finalCommission !== 0,
    },
  ];
  for (const m of mutantes) {
    let pegou = false, detalhe = "";
    try {
      pegou = m.espera(carregaMutante(MODULO, m.trocas));
    } catch (e) {
      detalhe = " (" + e.message.split("\n")[0] + ")";
    }
    ok("MUT", pegou, `mutante "${m.nome}" e PEGO pelas assercoes${detalhe}`);
  }

  // --------------------------------------------------- B. o consolidador USA
  console.log("\n[B] o consolidador realmente USA a regra (funcao pura sem chamador e decoracao)");
  const src = fs.readFileSync(path.join(ROOT, CONSOLIDADOR), "utf8");
  const semComentario = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("B1", /comissaoDeChaveMaster\s*\(/.test(semComentario),
    `${CONSOLIDADOR} chama comissaoDeChaveMaster()`);
  ok("B2", /from\(["']promoters["']\)[\s\S]{0,120}is_master/.test(semComentario),
    `${CONSOLIDADOR} carrega is_master na consulta de promoters (sem isso a regra recebe undefined e nunca zera)`);
  ok("B3", !/const\s+productionCommission\s*=\s*a\.avista\s*\*\s*fatorCredito\s*;/.test(semComentario),
    "o calculo antigo (sem a regra) NAO sobrevive em paralelo");

  // ---------------------------------------------------------------- C. banco
  console.log("\n[C] o banco: o fossil nao cresce");
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    ok("C0", false, "credencial do Supabase ausente — needs-db sem banco REPROVA");
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    async function todas(t, sel) {
      let out = [], from = 0;
      for (;;) {
        const { data, error } = await sb.from(t).select(sel).range(from, from + 999);
        if (error) throw new Error(`${t}: ${error.message}`);
        out = out.concat(data || []);
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      return out;
    }
    const proms = await todas("promoters", "id, name, is_master");
    const masters = new Set(proms.filter((p) => p.is_master === true).map((p) => p.id));
    const pmr = await todas("promoter_monthly_results",
      "promoter_id, company_id, year, month, source, final_commission_value");

    ok("C1", masters.size > 0,
      `existe chave master cadastrada (${masters.size}) — sem isso o lado C passaria por vacuidade`);

    const viol = pmr.filter((r) => masters.has(r.promoter_id) && Number(r.final_commission_value) > 0);
    const comps = [...new Set(viol.map((r) => comp(r.year, r.month)))].sort();
    const soma = viol.reduce((s, r) => s + Number(r.final_commission_value), 0);
    console.log(`       linhas de master com comissao > 0: ${viol.length}  em ${comps.join(",") || "-"}  Σ R$ ${soma.toFixed(2)}`);
    for (const r of viol) {
      const nome = (proms.find((p) => p.id === r.promoter_id) || {}).name || r.promoter_id;
      console.log(`         ${comp(r.year, r.month)}  ${String(nome).slice(0, 48)}  source=${r.source}  R$ ${Number(r.final_commission_value).toFixed(2)}`);
    }
    console.log(`       linha de base (medida 02/09/2026, antes da defesa): ${FOSSIL_BASE} em ${FOSSIL_BASE_COMPETENCIAS.join(",")}, R$ ${FOSSIL_BASE_VALOR.toFixed(2)}`);

    ok("C2", viol.length <= FOSSIL_BASE,
      `o fossil NAO cresceu (agora ${viol.length}, base ${FOSSIL_BASE}). Crescer significa que a defesa nao pegou num fechamento novo`);
    const novas = comps.filter((c) => FOSSIL_BASE_COMPETENCIAS.indexOf(c) < 0);
    ok("C3", novas.length === 0,
      `nenhuma competencia NOVA com master remunerado (novas: ${novas.join(",") || "nenhuma"})`);
    ok("C4", soma <= FOSSIL_BASE_VALOR + 0.005,
      `o valor do fossil nao subiu (agora R$ ${soma.toFixed(2)}, base R$ ${FOSSIL_BASE_VALOR.toFixed(2)})`);

    if (viol.length > 0) {
      console.log("       NOTA: o fossil de 2026-04 segue vivo DE PROPOSITO — limpa-lo exige");
      console.log("             reconsolidar mes fechado, que mexe em dinheiro. Decisao a parte.");
    }
  }

  console.log("\n" + "=".repeat(60));
  if (falhas.length === 0) {
    console.log("GATE chave master sem comissao: PASSOU");
    process.exitCode = 0;
    return;
  }
  console.log(`GATE chave master sem comissao: REPROVOU (${falhas.length})`);
  for (const f of falhas) console.log("  - " + f);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error("GATE chave master sem comissao: ERRO", e.message);
  process.exitCode = 1;
});
