/*
 * DRY-RUN DO PISO contra o banco VIVO — needs-db, NAO grava nada.
 *
 * Roda consolidateMonthlyGroup (o orquestrador, RR+ADS) DUAS vezes na mesma
 * competencia — uma SEM a regua de piso, outra COM — e faz o diff linha a linha
 * do payload do PMR. Os dois lados sao computados NESTE run: nada de numero
 * congelado.
 *
 * A REGUA E INJETADA POR PROXY, nao seedada. A tabela piso_producao_rule_versions
 * pode ainda nem existir no banco (o SQL e rodado a mao no Studio). O proxy
 * intercepta SO as leituras dessa tabela e devolve a linha que o SQL gravaria;
 * todo o resto vai para o Supabase real. Assim da para medir o efeito ANTES de
 * aplicar a migration, sem escrever uma linha em producao.
 *
 * Uso:
 *   node -e "require('./scripts/_ts_register.cjs');require('./scripts/piso_producao_dryrun.cjs')"
 *   COMPETENCIAS=2026-07,2026-06,2026-04 node ... (default: essas tres)
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");

// .env.local vence (mesmo padrao de rodarClosingMonthly.ts:20-27).
(function carregarEnv() {
  for (const arquivo of [".env", ".env.local"]) {
    const p = path.join(ROOT, arquivo);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
})();

const { consolidateMonthlyGroup } = require("../lib/bbtsOrchestrator.ts");
const { PISO_TABELA } = require("../lib/pisoProducao.ts");

const LILIAN = "c8925313-09fb-49c1-b677-e00402181a9a";
const MARIA = "bf872c4a-7288-40f8-b53f-43b79218d643";

// A LINHA EXATA que scripts/sql/2026-08-18_piso_producao_repasse.sql grava.
//
// A VIGENCIA E PARAMETRO porque ela e a decisao que ainda esta na mesa. O seed
// usa 2026-08-01 (nao retroage). VIGENCIA_INICIO permite medir, sem gravar nada,
// o que cada escolha custaria — e e assim que se prova "competencia fechada NAO
// muda": com a vigencia do seed, jul/jun/abr tem que sair com ZERO linhas
// alteradas.
const VIGENCIA_INICIO = String(process.env.VIGENCIA_INICIO || "2026-08-01");

const REGUA_SIMULADA = {
  id: "regua-dryrun",
  competencia_inicio: VIGENCIA_INICIO,
  competencia_fim: null,
  regra: {
    piso: 150000.0,
    comparacao: "MENOR_QUE",
    base_calculo: "PRODUCAO_LIQUIDA_FECHAMENTO",
    escopo_producao: "CONSOLIDADO_RR_ADS",
    zera: ["CREDITO", "SEGURO"],
  },
  scope: { promoter_ids: [LILIAN, MARIA] },
};

/** Envolve o client real: SO a tabela da regua e servida da memoria. */
function comReguaInjetada(real, linhas) {
  return new Proxy(real, {
    get(alvo, prop, receiver) {
      if (prop !== "from") return Reflect.get(alvo, prop, receiver);
      return (tabela) => {
        if (tabela !== PISO_TABELA) return alvo.from(tabela);
        // O `lte` PRECISA filtrar de verdade. Um stub que ignora o filtro
        // devolve linha a mais e faz a regua parecer retroativa — foi assim que
        // o dry-run de 20/08/2026 aplicou a regua de 2026-08 em jun e abr.
        const filtros = [];
        const casa = (r) => filtros.every((f) => f(r));
        const api = {
          select: () => api,
          eq: (col, val) => (filtros.push((r) => r[col] === val), api),
          in: (col, val) => (filtros.push((r) => val.includes(r[col])), api),
          lte: (col, val) => (filtros.push((r) => String(r[col] ?? "") <= String(val)), api),
          gte: (col, val) => (filtros.push((r) => String(r[col] ?? "") >= String(val)), api),
          order: () => api,
          limit: () => api,
          range: (from, to) =>
            Promise.resolve({ data: linhas.filter(casa).slice(from, to + 1), error: null }),
          then: (resolve) => resolve({ data: linhas.filter(casa), error: null }),
        };
        return api;
      };
    },
  });
}

const brl = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const chave = (r) => `${r.promoter_id}|${r.company_id ?? "NULL"}`;

// Campos de DINHEIRO DO PROMOTOR (o que o piso pode mexer) e campos da EMPRESA /
// producao (o que ele NAO pode mexer). A separacao e o ponto do teste.
const CAMPOS_REPASSE = [
  "production_commission_value",
  "insurance_commission_value",
  "final_commission_value",
];
const CAMPOS_EMPRESA = [
  "production_value",
  "insured_production_value",
  "proposal_count",
  "insured_proposal_count",
  "insurance_penetration_percent",
];

async function rodar(supabase, year, month, comPiso) {
  const client = comPiso ? comReguaInjetada(supabase, [REGUA_SIMULADA]) : comReguaInjetada(supabase, []);
  return consolidateMonthlyGroup(client, { year, month, dryRun: true });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: proms } = await supabase.from("promoters").select("id, name");
  const nome = new Map((proms || []).map((p) => [p.id, p.name]));

  const competencias = String(process.env.COMPETENCIAS || "2026-07,2026-06,2026-04")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) }));

  let problemas = 0;

  for (const { year, month } of competencias) {
    const comp = `${year}-${String(month).padStart(2, "0")}`;
    console.log(
      `\n${"=".repeat(78)}\nCOMPETENCIA ${comp}  (vigencia da regua: ${VIGENCIA_INICIO}; dryRun: NADA e gravado)\n${"=".repeat(78)}`
    );

    const sem = await rodar(supabase, year, month, false);
    const com = await rodar(supabase, year, month, true);

    const S = new Map((sem.payload || []).map((r) => [chave(r), r]));
    const C = new Map((com.payload || []).map((r) => [chave(r), r]));

    console.log(`  linhas no payload: sem piso ${S.size} | com piso ${C.size}`);
    for (const aviso of com.piso?.avisos || []) console.log(`  aviso: ${aviso}`);

    if (S.size !== C.size) {
      problemas += 1;
      console.log(`  !! o piso MUDOU O CONJUNTO de linhas (${S.size} -> ${C.size}) — nao deveria`);
    }

    const mudaram = [];
    const empresaMudou = [];
    for (const [k, s] of S) {
      const c = C.get(k);
      if (!c) continue;
      const deltas = CAMPOS_REPASSE.filter((f) => Number(s[f] || 0) !== Number(c[f] || 0));
      if (deltas.length) mudaram.push({ k, s, c, deltas });
      const empresa = CAMPOS_EMPRESA.filter((f) => Number(s[f] || 0) !== Number(c[f] || 0));
      if (empresa.length) empresaMudou.push({ k, campos: empresa });
    }

    console.log(`\n  -- veredicto do piso (${(com.piso?.veredictos || []).length} alcancado(s)) --`);
    for (const v of com.piso?.veredictos || []) {
      console.log(
        `     ${(nome.get(v.promoterId) || v.promoterId).slice(0, 42).padEnd(42)} ` +
          `producao ${brl(v.producao).padStart(16)}  piso ${brl(v.piso)}  ` +
          `${v.abaixoDoPiso ? "ABAIXO -> ZERA" : "acima -> paga"}`
      );
    }

    console.log(`\n  -- linhas do PMR que MUDARAM de repasse: ${mudaram.length} --`);
    for (const m of mudaram) {
      console.log(
        `     ${(nome.get(m.s.promoter_id) || m.s.promoter_id).slice(0, 42).padEnd(42)} src=${m.s.source}`
      );
      for (const f of m.deltas) {
        console.log(`        ${f.padEnd(30)} ${brl(m.s[f]).padStart(14)}  ->  ${brl(m.c[f]).padStart(14)}`);
      }
      console.log(`        piso_zerou ${m.s.piso_zerou} -> ${m.c.piso_zerou} | discount_value ${m.c.discount_value}`);
    }

    console.log(`\n  -- comissao da EMPRESA / producao alterada: ${empresaMudou.length} linha(s) --`);
    if (empresaMudou.length) {
      problemas += 1;
      for (const e of empresaMudou) console.log(`     !! ${e.k} mexeu em ${e.campos.join(", ")}`);
    } else {
      console.log("     nenhuma (production_value, segurados, contagem e penetracao IDENTICOS)");
    }

    const totSem = (sem.payload || []).reduce((s, r) => s + Number(r.final_commission_value || 0), 0);
    const totCom = (com.payload || []).reduce((s, r) => s + Number(r.final_commission_value || 0), 0);
    console.log(
      `\n  -- total de repasse: ${brl(totSem)}  ->  ${brl(totCom)}   (delta ${brl(totCom - totSem)})`
    );
  }

  console.log(
    problemas === 0
      ? "\nRESULTADO: OK — o piso so mexeu em repasse, nunca em producao/empresa."
      : `\nRESULTADO: ${problemas} PROBLEMA(S) — PARE e investigue.`
  );
  process.exit(problemas === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(2);
});
