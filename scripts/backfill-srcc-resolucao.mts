// ============================================================================
// BACKFILL do SRCC — resolve 03-06/2026 pelo fechamento ja importado.
//
// DRY-RUN E O PADRAO. Para gravar e preciso passar --gravar explicitamente.
// Escreve em competencia FECHADA e paga; o default nao pode ser escrever.
//
// SEGURANCA (medida antes, ver HANDOFF_SRCC_RESOLUCAO.md item 4): reescrever o
// SRCC do RR em mes fechado NAO altera o PMR nem o valor pago. O PMR fechado e
// consolidado do FECHAMENTO (calculate/monthly:692 desvia para
// reconsolidarCompetenciaFechada), e o unico ponto do consolidador fechado que
// le a diaria com guarda de SRCC esta atras de .eq(company_id, BBTS).
// O efeito e de EXIBICAO — e no sentido de corrigir.
//
//   npx tsx scripts/backfill-srcc-resolucao.mts            (dry-run)
//   npx tsx scripts/backfill-srcc-resolucao.mts --gravar   (grava)
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const GRAVAR = process.argv.includes("--gravar");

const { resolverSrccDoFechamento } = await import("../lib/srccResolucao.ts");
const { getSrccEstado, getSrccRestrictionLabel } = await import(
  "../lib/proposalDetailing.ts"
);
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const L = "-".repeat(92);
const D = "=".repeat(92);

// A migration ja foi aplicada? Sem ela o backfill nao tem onde gravar.
{
  const { error } = await sb
    .from("daily_production_records")
    .select("srcc_resolucao")
    .limit(1);
  if (error) {
    console.log(D);
    console.log("MIGRATION NAO APLICADA");
    console.log(D);
    console.log(`  ${error.message}`);
    console.log("\n  Rode supabase/migrations/20260727_000001_srcc_resolucao.sql no Studio.");
    process.exit(1);
  }
}

const COMPS = [
  { year: 2026, month: 3 },
  { year: 2026, month: 4 },
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
];

const { data: empresas } = await sb.from("companies").select("id, name");
const rrIds = (empresas || [])
  .filter((e: any) => !String(e.name).toUpperCase().includes("ADS"))
  .map((e: any) => e.id);
const nomeEmp = new Map((empresas || []).map((e: any) => [e.id, e.name]));

console.log(D);
console.log(`BACKFILL DO SRCC — 03 a 06/2026   [${GRAVAR ? "GRAVANDO" : "DRY-RUN"}]`);
console.log(D);
console.log(`empresas RR no escopo: ${rrIds.length}`);

// ---------------------------------------------------------------------------
// ANTES — produção exibida da Thaynara em junho (o caso 213615547)
// ---------------------------------------------------------------------------
async function producaoExibidaThaynara() {
  const { data: prom } = await sb
    .from("promoters")
    .select("id, name")
    .ilike("name", "%THAYNARA%")
    .maybeSingle();
  if (!prom) return null;
  const passo = 1000;
  let de = 0;
  const linhas: any[] = [];
  for (;;) {
    const { data, error } = await sb
      .from("daily_production_records")
      .select(
        "id, proposal_number, net_value, status, is_srcc_restricted, srcc_resolucao," +
          " raw_payload, movement_date, contract_date, proposal_date"
      )
      .eq("assigned_promoter_id", prom.id)
      .order("id")
      .range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  const daComp = linhas.filter((r) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p && p.year === 2026 && p.month === 6;
  });
  // MESMO predicado de isEligibleProductionRecord: PRODUCAO e nao restrita.
  const norm = (s: unknown) =>
    String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
  const validas = daComp.filter(
    (r) =>
      (norm(r.status) === "PRODUCAO" || norm(r.status) === "PRODUCTION") &&
      r.is_srcc_restricted !== true
  );
  const alvo = daComp.find((r) => String(r.proposal_number) === "213615547");
  return {
    nome: prom.name,
    linhas: validas.length,
    producao: validas.reduce((s, r) => s + num(r.net_value), 0),
    alvo: alvo
      ? {
          net: num(alvo.net_value),
          is_srcc: alvo.is_srcc_restricted,
          resolucao: alvo.srcc_resolucao ?? null,
          estado: getSrccEstado(alvo),
          label: getSrccRestrictionLabel(alvo),
          contaAgora:
            (norm(alvo.status) === "PRODUCAO" || norm(alvo.status) === "PRODUCTION") &&
            alvo.is_srcc_restricted !== true,
        }
      : null,
  };
}

const antes = await producaoExibidaThaynara();
console.log("\n" + L);
console.log("ANTES — producao exibida de THAYNARA em 06/2026 (predicado de elegibilidade)");
console.log(L);
if (antes) {
  console.log(`  ${antes.nome}`);
  console.log(`  linhas validas: ${antes.linhas}   producao: R$ ${brl(antes.producao)}`);
  if (antes.alvo) {
    console.log(
      `  proposta 213615547: net R$ ${brl(antes.alvo.net)}  is_srcc=${antes.alvo.is_srcc}  ` +
        `resolucao=${antes.alvo.resolucao ?? "(null)"}  estado=${antes.alvo.estado}`
    );
    console.log(`     rotulo: "${antes.alvo.label}"`);
    console.log(`     conta na producao AGORA? ${antes.alvo.contaAgora ? "SIM" : "nao"}`);
  }
}

// ---------------------------------------------------------------------------
// O PLANO, competencia a competencia
// ---------------------------------------------------------------------------
console.log("\n" + L);
console.log("PLANO POR COMPETENCIA");
console.log(L);
console.log("\ncomp     empresa               cand   SIM   NAO  N/APL   ausente  s/col  descon");

const tot = {
  candidatas: 0,
  SIM: 0,
  NAO: 0,
  NAO_SE_APLICA: 0,
  ausente: 0,
  semCol: 0,
  descon: 0,
};
for (const c of COMPS) {
  for (const id of rrIds) {
    const r = await resolverSrccDoFechamento(sb, {
      year: c.year,
      month: c.month,
      companyId: id,
      dryRun: !GRAVAR,
    });
    if (r.candidatas === 0) continue;
    tot.candidatas += r.candidatas;
    tot.SIM += r.porValor.SIM;
    tot.NAO += r.porValor.NAO;
    tot.NAO_SE_APLICA += r.porValor.NAO_SE_APLICA;
    tot.ausente += r.semResposta.ausenteDoFechamento;
    tot.semCol += r.semResposta.semColuna;
    tot.descon += r.semResposta.valorDesconhecido;
    console.log(
      `${c.year}-${String(c.month).padStart(2, "0")}  ${String(nomeEmp.get(id)).slice(0, 20).padEnd(20)} ` +
        `${String(r.candidatas).padStart(5)} ${String(r.porValor.SIM).padStart(5)} ` +
        `${String(r.porValor.NAO).padStart(5)} ${String(r.porValor.NAO_SE_APLICA).padStart(6)}   ` +
        `${String(r.semResposta.ausenteDoFechamento).padStart(7)} ${String(r.semResposta.semColuna).padStart(6)} ` +
        `${String(r.semResposta.valorDesconhecido).padStart(6)}`
    );
    if (r.semResposta.amostraValores.length) {
      console.log(`         valores desconhecidos: ${r.semResposta.amostraValores.join(" | ")}`);
    }
  }
}

console.log("\n" + L);
console.log("TOTAL");
console.log(L);
console.log(`  candidatas (indefinidas) .............. ${tot.candidatas}`);
console.log(`  resolveria para SIM ................... ${tot.SIM}`);
console.log(`  resolveria para NAO ................... ${tot.NAO}`);
console.log(`  resolveria para NAO_SE_APLICA ......... ${tot.NAO_SE_APLICA}`);
console.log(`  SEM RESPOSTA .......................... ${tot.ausente + tot.semCol + tot.descon}`);
console.log(`     ausentes do fechamento ............. ${tot.ausente}`);
console.log(`     linha achada mas sem a coluna ...... ${tot.semCol}`);
console.log(`     valor desconhecido ................. ${tot.descon}`);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------
if (GRAVAR) {
  const depois = await producaoExibidaThaynara();
  console.log("\n" + L);
  console.log("DEPOIS — producao exibida de THAYNARA em 06/2026");
  console.log(L);
  if (depois && antes) {
    console.log(`  linhas validas: ${antes.linhas} -> ${depois.linhas}`);
    console.log(
      `  producao: R$ ${brl(antes.producao)} -> R$ ${brl(depois.producao)}   ` +
        `(delta R$ ${brl(depois.producao - antes.producao)})`
    );
    if (depois.alvo) {
      console.log(
        `  proposta 213615547: is_srcc=${depois.alvo.is_srcc}  resolucao=${depois.alvo.resolucao}  estado=${depois.alvo.estado}`
      );
      console.log(`     rotulo: "${depois.alvo.label}"`);
      console.log(`     conta na producao? ${depois.alvo.contaAgora ? "SIM" : "nao"}`);
    }
  }
} else {
  console.log("\n" + D);
  console.log("DRY-RUN — nada foi gravado.");
  console.log(D);
  if (antes?.alvo) {
    console.log(`
  EFEITO PREVISTO na proposta 213615547 (o caso que importa):
    o fechamento diz RESTRICAO SRCC = "Sim"
    srcc_resolucao passaria de (null) para SIM
    is_srcc_restricted passaria de ${antes.alvo.is_srcc} para true
    rotulo passaria de "${antes.alvo.label}"
              para "Sim" (vermelho, estado restrito)
    a producao de R$ ${brl(antes.alvo.net)} SAIRIA da contagem de quem le a diaria:
    R$ ${brl(antes.producao)} -> R$ ${brl(antes.producao - antes.alvo.net)}
`);
  }
  console.log("  Para gravar: npx tsx scripts/backfill-srcc-resolucao.mts --gravar");
}
