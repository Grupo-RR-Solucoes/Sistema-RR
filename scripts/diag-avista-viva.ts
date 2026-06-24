// Diagnóstico READ-ONLY da auditoria à vista VIVA (Camada 1).
// Uso: npx tsx scripts/diag-avista-viva.ts 2026 4
// Carrega .env/.env.local, roda auditAvistaMesVivo, imprime contagens,
// subpagamentos, batimento FME e comparação vivo×congelado (audit_v9_avista).

import fs from "node:fs";
import path from "node:path";

// .env.local tem precedência (Next.js). Carrega ANTES de chamar getSupabaseAdmin.
for (const f of [".env", ".env.local"]) {
  try {
    for (const line of fs.readFileSync(path.resolve(f), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch {
    /* arquivo ausente */
  }
}

import { getSupabaseAdmin } from "../lib/supabaseAdmin.ts";
import { auditAvistaMesVivo } from "../lib/auditoriaAvistaViva.ts";
import {
  auditAvistaContrato,
  type ContratoAvista,
  type MesContextAvista,
} from "../lib/auditoriaAvista.ts";
import { auditEnquadramentoMes } from "../lib/enquadramento.ts";

function brl(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v || 0);
}
function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function nk(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, "");
}
function pct(a: number, b: number): string {
  return b ? `${((a / b) * 100).toFixed(1)}%` : "—";
}

async function main() {
  const year = Number(process.argv[2] || 2026);
  const month = Number(process.argv[3] || 4);
  const sb = getSupabaseAdmin();

  const r = await auditAvistaMesVivo(sb, year, month);

  console.log(`\n===== AUDITORIA À VISTA VIVA — ${r.ym} (regime ${r.regime}) =====`);
  console.log("Classificação do join (daily ⋈ CASH):");
  console.log(`  MATCH ................ ${r.contagem.MATCH}`);
  console.log(`  PRODUZIDO_NAO_PAGO ... ${r.contagem.PRODUZIDO_NAO_PAGO}`);
  console.log(`  PAGO_SEM_PRODUCAO .... ${r.contagem.PAGO_SEM_PRODUCAO}`);
  console.log(`\nAuditados (MATCH + não-pago maduro): ${r.resumo.auditados}`);
  console.log(`Não auditados (pendência reconciliação): ${r.naoAuditados.length}`);
  console.log(`\nStatus fase 2 dos auditados:`);
  for (const [k, v] of Object.entries(r.resumo.porStatus).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${k.padEnd(28)} ${v}`);
  }
  console.log(`\nSubpagamentos (bloco PEDIDO_FIRME_2.1): ${r.resumo.subpagamentos} contratos`);
  for (const x of r.resultados.filter((y) => y.bloco === "PEDIDO_FIRME_2.1")) {
    console.log(
      `  • ${x.contractNumber} ${x.statusFase2} devida=${brl(
        x.comissaoDevida
      )} dif=${brl(x.diferenca)}`
    );
  }
  console.log(`  Σ valor a cobrar (−diferença): ${brl(r.resumo.somaSubpagamento)}`);
  console.log(`  Σ comissão devida (auditados): ${brl(r.resumo.somaComissaoDevida)}`);
  console.log(`  Σ comissão paga   (auditados): ${brl(r.resumo.somaComissaoPaga)}`);

  console.log(`\n----- Batimento caixa (sanity vs Resumo) -----`);
  console.log(
    `  Σ CASH fechamento ${r.ym}: ${brl(r.reconciliacao.somaCashFechamentoMes)}`
  );
  console.log(
    `  FME valor_avista ${r.ym}: ${
      r.reconciliacao.fmeValorAvista == null
        ? "(ausente)"
        : brl(r.reconciliacao.fmeValorAvista)
    }`
  );
  if (r.reconciliacao.deltaAbs != null) {
    console.log(
      `  Δ: ${brl(r.reconciliacao.deltaAbs)} (${(
        (r.reconciliacao.deltaPct ?? 0) * 100
      ).toFixed(2)}%)`
    );
  }

  // ---- Comparação vivo × congelado (audit_v9_avista do mesmo mês) ----
  const { data: cong } = await sb
    .from("audit_v9_avista")
    .select(
      "contract_number, produto, tipo, convenio, tx_juros, prazo, cat_aplicada, valor_liquido, comissao_paga, status_fase1"
    )
    .eq("mes", r.ym);

  if (!cong || !cong.length) {
    console.log(`\n(audit_v9_avista ${r.ym} vazio — sem comparação vivo×congelado)`);
    console.log("\n(diagnóstico read-only — nada gravado)\n");
    return;
  }

  const congMap = new Map<string, any>(
    cong.map((c: any) => [nk(c.contract_number), c])
  );
  // input vivo por operação (valor_liquido / comissao_paga reais).
  const vivoByOp = new Map<string, { liq: number; paga: number }>();
  for (const it of r.itens) {
    if (!it.contrato) continue;
    vivoByOp.set(nk(it.operacao), {
      liq: it.contrato.valorLiquido,
      paga: it.contrato.comissaoPaga,
    });
  }

  // (A) Fidelidade de INPUT — valor_liquido / comissao_paga (real, não reconstruído).
  let inAmbos = 0;
  let liqIgual = 0;
  let pagoIgual = 0;
  const liqDiffs: string[] = [];
  const pagoDiffs: string[] = [];
  for (const [k, c] of congMap) {
    const v = vivoByOp.get(k);
    if (!v) continue;
    inAmbos += 1;
    if (Math.abs(toNum(c.valor_liquido) - v.liq) < 0.01) liqIgual += 1;
    else liqDiffs.push(`${k}: cong=${toNum(c.valor_liquido)} vivo=${v.liq}`);
    if (Math.abs(toNum(c.comissao_paga) - v.paga) < 0.01) pagoIgual += 1;
    else pagoDiffs.push(`${k}: cong=${toNum(c.comissao_paga)} vivo=${v.paga}`);
  }
  const soVivo = [...vivoByOp.keys()].filter((k) => !congMap.has(k)).length;
  const soCong = [...congMap.keys()].filter((k) => !vivoByOp.has(k)).length;

  console.log(`\n----- (A) Fidelidade de input vivo × congelado (${r.ym}) -----`);
  console.log(`  congelado: ${cong.length} | vivo (c/ contrato): ${vivoByOp.size}`);
  console.log(`  em ambos: ${inAmbos} | só vivo: ${soVivo} | só congelado: ${soCong}`);
  console.log(
    `  valor_liquido igual: ${liqIgual}/${inAmbos} (${pct(liqIgual, inAmbos)})`
  );
  console.log(
    `  comissao_paga igual: ${pagoIgual}/${inAmbos} (${pct(pagoIgual, inAmbos)})`
  );
  if (liqDiffs.length) console.log(`  ⚠ liq diffs: ${liqDiffs.slice(0, 10).join(" ; ")}`);
  if (pagoDiffs.length)
    console.log(`  ⚠ paga diffs: ${pagoDiffs.slice(0, 10).join(" ; ")}`);

  // (B) Paridade de ENGINE — mesma engine sobre congelado vs vivo, por contrato.
  const enq = await auditEnquadramentoMes(sb, year, month);
  const mesContext: MesContextAvista = {
    ym: enq.mes,
    regime: enq.regime,
    catDevida: enq.catDevida,
    catAplicada: enq.catAplicadaNormalizada,
    statusFase1: enq.status,
    jsonRegra: enq.jsonRegra,
    regraInferida: enq.regraInferida,
  };
  const vivoResByOp = new Map(r.resultados.map((x) => [nk(x.contractNumber), x]));
  let parStatus = 0;
  let parDevida = 0;
  let comparados = 0;
  const statusDiffs: string[] = [];
  for (const [k, c] of congMap) {
    const vr = vivoResByOp.get(k);
    if (!vr) continue; // só no vivo se auditado
    const congContrato: ContratoAvista = {
      contractNumber: String(c.contract_number),
      empresa: "",
      mes: r.ym,
      produto: c.produto ?? null,
      tipo: c.tipo ?? null,
      convenio: c.convenio ?? null,
      txJuros: toNum(c.tx_juros),
      prazo: toNum(c.prazo),
      catAplicada: c.cat_aplicada ?? null,
      valorLiquido: toNum(c.valor_liquido),
      pctAplicado:
        toNum(c.valor_liquido) > 0
          ? toNum(c.comissao_paga) / toNum(c.valor_liquido)
          : 0,
      comissaoPaga: toNum(c.comissao_paga),
      srccRestricao: c.status_fase1 === "SRCC",
      padraoDExclusao: false,
      padraoDMotivo: null,
    };
    const cr = auditAvistaContrato(congContrato, mesContext);
    comparados += 1;
    if (cr.statusFase2 === vr.statusFase2) parStatus += 1;
    else
      statusDiffs.push(`${k}: cong=${cr.statusFase2} vivo=${vr.statusFase2}`);
    if (Math.abs(cr.comissaoDevida - vr.comissaoDevida) < 0.01) parDevida += 1;
  }
  console.log(`\n----- (B) Paridade de engine (congelado vs vivo, ${comparados} contratos) -----`);
  console.log(`  statusFase2 igual: ${parStatus}/${comparados} (${pct(parStatus, comparados)})`);
  console.log(`  comissaoDevida igual: ${parDevida}/${comparados} (${pct(parDevida, comparados)})`);
  if (statusDiffs.length)
    console.log(`  ⚠ status diffs (${statusDiffs.length}):\n    ${statusDiffs.slice(0, 30).join("\n    ")}`);

  console.log("\n(diagnóstico read-only — nada gravado)\n");
}

main().catch((e) => {
  console.error("ERRO:", e?.message ?? e);
  process.exit(1);
});
