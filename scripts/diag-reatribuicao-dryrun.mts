// ============================================================================
// SOMENTE LEITURA — dry-run da inversao de precedencia (o DIARIO vence a CHAVE J).
//
//   npx tsx scripts/diag-reatribuicao-dryrun.mts
//
// PARTE A — competencia a competencia (2026-01..2026-08), compara o promotor
//   EFETIVO de cada linha CASH sob a regra VELHA (chave J primeiro, diario so
//   para a orfa de chave master) e sob a regra NOVA (diario primeiro, chave J de
//   fallback). Soma o delta de producao por promotor.
//   ESPERADO: so 2026-07 se move, so 5 promotores. Qualquer outra competencia
//   mexendo e motivo de PARAR.
//
// PARTE B — jul/2026 no consolidador REAL (bbtsOrchestrator em dryRun), para ver
//   o delta de REPASSE contra o que esta gravado no PMR.
//
// PARTE C — convergencia: a producao que o sistema passa a calcular bate com a
//   PLANILHA MANUAL do financeiro, que foi quem efetivamente pagou julho.
//
// NAO GRAVA NADA. `consolidateMonthlyGroup` roda com dryRun: true.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const a of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), a);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const D = "=".repeat(96);

const { loadClosingPromoterBase } = await import("../lib/closingPromoterBase.ts");
const { buildDonoDoDiarioMap, resolvePromotorEfetivo } = await import("../lib/herancaMaster.ts");
const { consolidateMonthlyGroup } = await import("../lib/bbtsOrchestrator.ts");

const BBTS_KEY = "JJ552710";
const nk = (s: unknown) => String(s ?? "").trim().toUpperCase();

// A precedencia ANTIGA, reproduzida para a comparacao (era closingMonthly:278-284).
const regraVelha = (c: any, donoDasOrfas: Map<string, string>): string | null =>
  c.promoterId ?? donoDasOrfas.get(`${c.companyId}|${String(c.contrato || "").trim()}`) ?? null;

const proms = await sb.from("promoters").select("id, name");
const pname = new Map((proms.data || []).map((p: any) => [p.id, p.name]));
const cos = await sb.from("companies").select("id, name");
const coName = new Map((cos.data || []).map((c: any) => [c.id, c.name]));

console.log(D);
console.log("PARTE A — promotor efetivo por linha: regra VELHA x regra NOVA");
console.log(D);

const resumo: Array<{ comp: string; linhas: number; liq: number; proms: number }> = [];
let competenciasQueMexem = 0;

for (let M = 1; M <= 8; M++) {
  const Y = 2026;
  const comp = `${Y}-${String(M).padStart(2, "0")}`;
  const base = await loadClosingPromoterBase(sb as any, { year: Y, month: M, companyId: null });
  if (base.totalCashRows === 0) {
    console.log(`\n${comp}: SEM fechamento CASH — nada a comparar`);
    continue;
  }
  const contratos = base.contratos.filter((c) => nk(c.chaveJ) !== BBTS_KEY);
  const orfas = contratos.filter((c) => !c.promoterId && String(c.contrato || "").trim());
  const donoOrfas = await buildDonoDoDiarioMap(sb as any, orfas, Y, M);
  const donoTodas = await buildDonoDoDiarioMap(sb as any, contratos, Y, M);

  const delta = new Map<string, number>();
  const deltaCnt = new Map<string, number>();
  const casos: any[] = [];
  let liq = 0;
  for (const c of contratos) {
    const velho = regraVelha(c, donoOrfas);
    const novo = resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      donoTodas
    );
    if (velho === novo) continue;
    liq += c.valorLiquido;
    if (velho) {
      delta.set(velho, (delta.get(velho) || 0) - c.valorLiquido);
      deltaCnt.set(velho, (deltaCnt.get(velho) || 0) - 1);
    }
    if (novo) {
      delta.set(novo, (delta.get(novo) || 0) + c.valorLiquido);
      deltaCnt.set(novo, (deltaCnt.get(novo) || 0) + 1);
    }
    casos.push({ ctr: c.contrato, chave: c.chaveJ, co: coName.get(c.companyId || ""), liq: c.valorLiquido, velho, novo });
  }
  const mexem = [...delta.entries()].filter(([, v]) => Math.abs(v) > 0.005);
  console.log(
    `\n${comp}  CASH=${base.totalCashRows}  pagaveis(nao-BBTS)=${contratos.length}` +
      `  |  linhas que mudam de dono: ${casos.length}  liquido=${brl(liq)}  promotores=${mexem.length}`
  );
  if (casos.length) {
    competenciasQueMexem += 1;
    for (const k of casos.sort((a, b) => b.liq - a.liq))
      console.log(
        `     ${String(k.ctr).padEnd(11)} ${String(k.chave).padEnd(10)} ${String(k.co).padEnd(15)} ` +
          `${brl(k.liq).padStart(11)}   ${pname.get(k.velho) || "(orfao)"} -> ${pname.get(k.novo) || "(orfao)"}`
      );
    console.log("     --- delta de PRODUCAO por promotor ---");
    for (const [pid, v] of mexem.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])))
      console.log(
        `     ${(pname.get(pid) || pid).padEnd(40)} ${((v > 0 ? "+" : "") + brl(v)).padStart(13)}` +
          `  (${deltaCnt.get(pid)! > 0 ? "+" : ""}${deltaCnt.get(pid)} propostas)`
      );
  }
  resumo.push({ comp, linhas: casos.length, liq, proms: mexem.length });
}

console.log("\n" + D);
console.log("RESUMO — comp      linhas   liquido        promotores");
for (const r of resumo)
  console.log(`         ${r.comp}   ${String(r.linhas).padStart(5)}  ${brl(r.liq).padStart(13)}  ${String(r.proms).padStart(9)}`);
const soJulho = resumo.every((r) => r.linhas === 0 || r.comp === "2026-07");
console.log(
  `\nVEREDITO PARTE A: ${soJulho ? "OK — so 2026-07 se move" : "PARE — outra competencia se moveu"}` +
    `  (competencias que mexem: ${competenciasQueMexem})`
);

console.log("\n" + D);
console.log("PARTE B — jul/2026 no consolidador REAL (dryRun) x PMR gravado");
console.log(D);
const res: any = await consolidateMonthlyGroup(sb as any, { year: 2026, month: 7, dryRun: true });
const rows: any[] = res.rows || [];
const repasseDe = (r: any) =>
  Number(r.repasse_credito_rr || 0) +
  Number(r.repasse_credito_ads || 0) +
  Number(r.repasse_seguro_rr || 0) +
  Number(r.repasse_seguro_ads || 0);

const pmr = await sb
  .from("promoter_monthly_results")
  .select("promoter_id, final_commission_value, production_value")
  .eq("year", 2026)
  .eq("month", 7);
const gravado = new Map<string, number>();
for (const r of pmr.data || [])
  gravado.set(r.promoter_id, (gravado.get(r.promoter_id) || 0) + Number(r.final_commission_value || 0));

console.log(`   dry_run=${res.dry_run}  promotores no calculo=${rows.length}  (NADA foi gravado)`);
let n = 0;
let soma = 0;
for (const r of rows.sort((a, b) => repasseDe(b) - repasseDe(a))) {
  const g = gravado.get(r.promoter_id) || 0;
  const h = repasseDe(r);
  if (Math.abs(h - g) < 0.005) continue;
  n += 1;
  soma += h - g;
  console.log(
    `   ${String(r.promoter_name).padEnd(42)} gravado=${brl(g).padStart(10)}  hoje=${brl(h).padStart(10)}` +
      `  delta=${((h - g > 0 ? "+" : "") + brl(h - g)).padStart(10)}`
  );
}
console.log(`   promotores com repasse diferente do gravado: ${n}   soma dos deltas: ${brl(soma)}`);
console.log("\n   NOTA: este delta soma DOIS efeitos — (1) a inversao de precedencia desta frente");
console.log("   e (2) a janela da heranca (commit 5b7f229, de 17/08), posterior ao calculo do PMR");
console.log("   de julho (2026-08-14 13:03). Os dois convergem para o que a planilha do");
console.log("   financeiro ja pagou. A gravacao e decisao separada.");

console.log("");
console.log(D);
console.log("PARTE C — convergencia com a PLANILHA MANUAL que pagou julho");
console.log(D);
// Numeros da planilha do financeiro (jul/2026), informados por Diego em 23/08/2026.
const PLANILHA: Array<{ nome: string; producao: number }> = [
  { nome: "CARLA MIRELLE SILVA", producao: 73468.54 },
  { nome: "MONICA PEREIRA", producao: 164984.77 },
];
for (const alvo of PLANILHA) {
  const r = rows.find((x: any) => String(x.promoter_name) === alvo.nome);
  const hoje = r ? Number(r.prod_rr || 0) + Number(r.prod_ads || 0) : 0;
  const g = (pmr.data || [])
    .filter((x: any) => pname.get(x.promoter_id) === alvo.nome)
    .reduce((s: number, x: any) => s + Number((x as any).production_value || 0), 0);
  const bate = Math.abs(hoje - alvo.producao) < 0.02;
  console.log(
    `   ${alvo.nome.padEnd(24)} planilha=${brl(alvo.producao).padStart(13)}` +
      `  PMR gravado=${brl(g).padStart(13)}  hoje=${brl(hoje).padStart(13)}  ${bate ? "BATE" : "DIVERGE"}`
  );
}
console.log("   (o PMR gravado punha 113.574,10 na CARLA e 125.339,21 na MONICA — a chave J revertia)");
