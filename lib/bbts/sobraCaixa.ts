// ============================================================================
// sobraCaixa — FONTE UNICA da "sobra de caixa" da EMPRESA (spread) da ADS/BBTS.
//
// REGRA DE OURO: esta e a UNICA funcao que calcula sobra. Nenhuma tela recalcula.
// A materializacao (Fase 2, no fechamento) e a leitura on-the-fly (mes aberto)
// chamam ESTA funcao. Se um dia duas telas calcularem sobra de jeitos diferentes,
// e bug (foi o que aconteceu no seguro: dashboard x projecao divergiram).
//
// A funcao ORQUESTRA as fontes existentes — NAO reimplementa nenhuma formula:
//   - devido_avista_bbts  = conferirBbtsMes(...).linhas[].devidoAvista
//                           (regua BBTS Faixa 4, teto 6% empresa). null se
//                           FORA_DA_TABELA (a conferencia ja decide isso).
//   - base_promotor_trp   = consolidateMonthlyFromBbts(...).propostas[].avista
//                           (= gross * min(pct TRP F3, tetoAvistaRR)). E o MESMO
//                           numero que o motor do promotor produz em bbtsMonthly:264.
//                           Indefinida (null) quando o motor nao achou celula (trp=0).
//   - pago_avista_bbts    = daily_production_records.bbts_pag_avista CRU (nullable).
//                           So o fechamento (bbtsClosingImport) escreve esse campo;
//                           no mes aberto vem null -> pago null (NUNCA 0).
//
// DUAS UNIDADES DE TETO SAO INTENCIONAIS (nao e bug): o lado BBTS usa o teto da
// EMPRESA (6%, lib/trp/creditAvistaTrp) e o lado promotor usa o teto RR (5,80%,
// lib/tetoAvistaRR, decimal canonico). Sao entidades diferentes; a sobra e
// justamente a diferenca entre os dois. NAO unificar.
//
// PREVISTA x REALIZADA:
//   sobra_prevista  = devido - base  (existe no mes aberto, so pela regua)
//   sobra_realizada = pago  - base   (so quando ha pago; senao NULL, nunca 0)
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { BBTS_COMPANY_ID } from "../bbtsCompanyId.ts";
import { consolidateMonthlyFromBbts } from "../bbtsMonthly.ts";
import { conferirBbtsMes } from "./conferenciaBbts.ts";

export type SobraContrato = {
  proposal_number: string;
  /** Regua BBTS Faixa 4, teto 6% empresa. null se FORA_DA_TABELA na conferencia. */
  devido_avista_bbts: number | null;
  /** TRP Faixa 3, teto 5,80% promotor. null se o motor nao achou celula (FORA). */
  base_promotor_trp: number | null;
  /** devido - base. null se qualquer lado indefinido. */
  sobra_prevista: number | null;
  /** bbts_pag_avista cru. null no mes aberto (so o fechamento preenche). */
  pago_avista_bbts: number | null;
  /** pago - base. null enquanto nao ha pago OU base indefinida. NUNCA 0 como sentinela. */
  sobra_realizada: number | null;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Sobra de caixa por contrato de uma competencia (YYYY-MM) da ADS. Universo e
 * GRAO = os da conferencia (carregarUniversoBbtsDb). READ-ONLY: nao grava nada
 * (consolidateMonthlyFromBbts roda em dryRun). A Fase 2 e quem persiste em
 * bbts_sobra_caixa, chamando ESTA funcao.
 */
export async function calcularSobraCaixa(
  supabase: SupabaseClient,
  ym: string,
): Promise<SobraContrato[]> {
  // Lado BBTS (devido) — reusa a conferencia (mesma regua/teto 6% que ela ja aplica).
  const conf = await conferirBbtsMes(supabase, ym);

  // Lado promotor (base) — reusa o consolidador (mesmo motor + teto 5,80% que o PMR).
  const [year, month] = ym.split("-").map((s) => Number(s));
  const bbts = await consolidateMonthlyFromBbts(supabase, { year, month, dryRun: true });
  const baseByContrato = new Map<string, { avista: number; trp: number }>(
    (bbts.propostas ?? []).map((p: any) => [
      String(p.contrato),
      { avista: Number(p.avista) || 0, trp: Number(p.trp) || 0 },
    ]),
  );

  // Lado pago — bbts_pag_avista CRU (nullable). So o fechamento escreve; no aberto
  // vem null. Lido direto do campo (nao do pagoAvista da conferencia, que coage
  // null->0 e perderia a distincao "nao pago ainda" x "pagou 0").
  const contratos = conf.linhas.map((l) => String(l.contrato));
  const pagoByContrato = new Map<string, number | null>();
  if (contratos.length > 0) {
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("proposal_number, bbts_pag_avista")
      .eq("company_id", BBTS_COMPANY_ID)
      .in("proposal_number", contratos);
    if (error) throw new Error(`calcularSobraCaixa (pago): ${error.message}`);
    for (const r of data ?? []) {
      const raw = (r as { bbts_pag_avista: number | null }).bbts_pag_avista;
      pagoByContrato.set(String(r.proposal_number), raw == null ? null : Number(raw));
    }
  }

  const out: SobraContrato[] = [];
  for (const l of conf.linhas) {
    const contrato = String(l.contrato);

    const devido = l.devidoAvista == null ? null : round2(l.devidoAvista);

    // base definida SO quando o motor achou celula (trp > 0). trp = 0 => FORA/gate
    // => base indefinida (null), nao 0 — a sobra desse contrato fica indefinida.
    const prop = baseByContrato.get(contrato);
    const base = prop && prop.trp > 0 ? round2(prop.avista) : null;

    const sobra_prevista =
      devido != null && base != null ? round2(devido - base) : null;

    const pago = pagoByContrato.has(contrato) ? pagoByContrato.get(contrato)! : null;

    const sobra_realizada =
      pago != null && base != null ? round2(pago - base) : null;

    out.push({
      proposal_number: contrato,
      devido_avista_bbts: devido,
      base_promotor_trp: base,
      sobra_prevista,
      pago_avista_bbts: pago,
      sobra_realizada,
    });
  }
  return out;
}
