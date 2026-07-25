// ============================================================================
// sobraCaixa — FONTE UNICA da "sobra de caixa" da EMPRESA (spread) da ADS/BBTS.
//
// REGRA DE OURO: esta e a UNICA funcao que calcula sobra. Nenhuma tela recalcula.
// A materializacao (Fase 2, no fechamento) e a leitura on-the-fly (mes aberto)
// chamam ESTA funcao. Se um dia duas telas calcularem sobra de jeitos diferentes,
// e bug (foi o que aconteceu no seguro: dashboard x projecao divergiram).
//
// A sobra tem DOIS lados, porque cada parte paga em duas pernas (a-vista + PRT):
//   sobra_avista = devido_avista_bbts - base_avista_promotor
//   sobra_prt    = devido_prt_bbts    - base_prt_promotor
//   sobra_total  = sobra_avista + sobra_prt   <- METRICA CANONICA (o que as telas leem)
// Medir so a-vista engana: um contrato underwater a-vista (ex. 220437923) recompoe
// a diferenca no PRT; sobra_total mostra o caixa real. a-vista/prt sao decomposicao.
//
// ORQUESTRA as fontes existentes — NAO reimplementa nenhuma formula:
//   - devido_avista_bbts = conferirBbtsMes(...).linhas[].devidoAvista   (BBTS F4, teto 6%)
//   - devido_prt_bbts    = conferirBbtsMes(...).linhas[].devidoPrtTotal (diferido BBTS)
//     (null quando FORA_DA_TABELA — a conferencia ja decide)
//   - base_avista_promotor = consolidateMonthlyFromBbts(...).propostas[].avista
//   - base_prt_promotor    = consolidateMonthlyFromBbts(...).propostas[].diferido
//     (= o que passa de 5,80% a-vista e vira PRT; MESMO numero de bbtsMonthly:235-236.
//      indefinido quando o motor nao achou celula, trp=0)
//   - pago_avista_bbts = daily_production_records.bbts_pag_avista CRU (nullable)
//   - pago_prt_bbts    = soma de bbts_prt_parcelas.valor_parcela do contrato (nullable)
//     (so o fechamento preenche esses dois; no mes aberto vem null -> realizada null)
//
// DUAS UNIDADES DE TETO SAO INTENCIONAIS (nao e bug): o lado BBTS usa o teto da
// EMPRESA (6%) e o lado promotor o teto RR (5,80%, decimal canonico de
// lib/tetoAvistaRR). A sobra e justamente a diferenca entre os dois. NAO unificar.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { BBTS_COMPANY_ID } from "../bbtsCompanyId.ts";
import { consolidateMonthlyFromBbts } from "../bbtsMonthly.ts";
import { conferirBbtsMes } from "./conferenciaBbts.ts";

export type SobraContrato = {
  proposal_number: string;
  // lado a-vista
  devido_avista_bbts: number | null;
  base_avista_promotor: number | null;
  sobra_avista: number | null;
  // lado PRT / diferido
  devido_prt_bbts: number | null;
  base_prt_promotor: number | null;
  sobra_prt: number | null;
  // total (metrica canonica)
  sobra_total: number | null;
  // realizado (fechamento); null no mes aberto, nunca 0
  pago_avista_bbts: number | null;
  pago_prt_bbts: number | null;
  sobra_realizada_total: number | null;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Sobra de caixa por contrato de uma competencia (YYYY-MM) da ADS. Universo e
 * GRAO = os da conferencia. READ-ONLY: nao grava nada (consolidateMonthlyFromBbts
 * roda em dryRun). A Fase 2 e quem persiste em bbts_sobra_caixa chamando ESTA funcao.
 */
export async function calcularSobraCaixa(
  supabase: SupabaseClient,
  ym: string,
): Promise<SobraContrato[]> {
  // Lado BBTS (devido a-vista + devido PRT) — reusa a conferencia.
  const conf = await conferirBbtsMes(supabase, ym);

  // Lado promotor (base a-vista + base PRT) — reusa o consolidador (motor + teto 5,80%).
  const [year, month] = ym.split("-").map((s) => Number(s));
  const bbts = await consolidateMonthlyFromBbts(supabase, { year, month, dryRun: true });
  const baseByContrato = new Map<string, { avista: number; diferido: number; trp: number }>(
    (bbts.propostas ?? []).map((p: any) => [
      String(p.contrato),
      { avista: Number(p.avista) || 0, diferido: Number(p.diferido) || 0, trp: Number(p.trp) || 0 },
    ]),
  );

  const contratos = conf.linhas.map((l) => String(l.contrato));

  // Lado pago a-vista — bbts_pag_avista CRU (nullable; so o fechamento escreve).
  const pagoAvistaByContrato = new Map<string, number | null>();
  // Lado pago PRT — soma de bbts_prt_parcelas do contrato (nullable; so o fechamento).
  const pagoPrtByContrato = new Map<string, number>();
  if (contratos.length > 0) {
    const pa = await supabase
      .from("daily_production_records")
      .select("proposal_number, bbts_pag_avista")
      .eq("company_id", BBTS_COMPANY_ID)
      .in("proposal_number", contratos);
    if (pa.error) throw new Error(`calcularSobraCaixa (pago a-vista): ${pa.error.message}`);
    for (const r of pa.data ?? []) {
      const raw = (r as { bbts_pag_avista: number | null }).bbts_pag_avista;
      pagoAvistaByContrato.set(String(r.proposal_number), raw == null ? null : Number(raw));
    }

    const pp = await supabase
      .from("bbts_prt_parcelas")
      .select("proposal_number, valor_parcela")
      .eq("company_id", BBTS_COMPANY_ID)
      .in("proposal_number", contratos);
    if (pp.error) throw new Error(`calcularSobraCaixa (pago prt): ${pp.error.message}`);
    for (const r of pp.data ?? []) {
      const c = String(r.proposal_number);
      pagoPrtByContrato.set(c, (pagoPrtByContrato.get(c) ?? 0) + (Number(r.valor_parcela) || 0));
    }
  }

  const out: SobraContrato[] = [];
  for (const l of conf.linhas) {
    const contrato = String(l.contrato);

    // devido (BBTS): null quando FORA_DA_TABELA (conferencia ja zera para null).
    const devidoAvista = l.devidoAvista == null ? null : round2(l.devidoAvista);
    const devidoPrt = l.devidoPrtTotal == null ? null : round2(l.devidoPrtTotal);

    // base (promotor): definida SO quando o motor achou celula (trp > 0); senao null.
    const prop = baseByContrato.get(contrato);
    const temBase = !!prop && prop.trp > 0;
    const baseAvista = temBase ? round2(prop!.avista) : null;
    const basePrt = temBase ? round2(prop!.diferido) : null;

    const sobraAvista =
      devidoAvista != null && baseAvista != null ? round2(devidoAvista - baseAvista) : null;
    const sobraPrt =
      devidoPrt != null && basePrt != null ? round2(devidoPrt - basePrt) : null;
    const sobraTotal =
      sobraAvista != null && sobraPrt != null ? round2(sobraAvista + sobraPrt) : null;

    // pago: null no mes aberto (so o fechamento preenche).
    const pagoAvista = pagoAvistaByContrato.has(contrato)
      ? pagoAvistaByContrato.get(contrato)!
      : null;
    const pagoPrt = pagoPrtByContrato.has(contrato) ? pagoPrtByContrato.get(contrato)! : null;

    // realizada: so quando ha pago a-vista (marcador do fechamento) E base definida.
    // NUNCA 0 antes do fechamento — fica null. Usa pago_prt quando ja acumulado.
    const baseTotal =
      baseAvista != null && basePrt != null ? round2(baseAvista + basePrt) : null;
    const sobraRealizadaTotal =
      pagoAvista != null && baseTotal != null
        ? round2(pagoAvista + (pagoPrt ?? 0) - baseTotal)
        : null;

    out.push({
      proposal_number: contrato,
      devido_avista_bbts: devidoAvista,
      base_avista_promotor: baseAvista,
      sobra_avista: sobraAvista,
      devido_prt_bbts: devidoPrt,
      base_prt_promotor: basePrt,
      sobra_prt: sobraPrt,
      sobra_total: sobraTotal,
      pago_avista_bbts: pagoAvista,
      pago_prt_bbts: pagoPrt,
      sobra_realizada_total: sobraRealizadaTotal,
    });
  }
  return out;
}
