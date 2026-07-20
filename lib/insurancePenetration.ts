// ============================================================================
// insurancePenetration — FONTE ÚNICA da penetração de seguro e do share de
// repasse ao promotor (Tabela de Remuneração RR, aba Seguro).
//
// Antes havia 3 caminhos divergentes: motor diário (base BRUTO — BUG),
// cmsMonthly (net) e closingMonthly (share do GRUPO — BUG). Esta lib unifica:
//   - PENETRAÇÃO INDIVIDUAL do promotor = líquido_segurado / líquido_total
//     (base LÍQUIDO, excluindo SRCC; "segurado" pelo FLAG da fonte
//     "PROD. SEGURADA", não por insurance_value>0).
//
// FONTE CANÔNICA = a TABELA share_scale/share_scale_tier (SEGURO_SLIP_MAIO_2026),
// versionada e self-service, lida pelo MESMO lookup do resto do sistema
// (lookupInsuranceShareFromPenetration): p >= volume_min AND p < volume_max,
// última faixa aberta. Cortes da régua: 0,10 / 0,20 / 0,30 — logo penetração
// 20,00% CRAVADA cai em [0,20 ; 0,30) e paga 0,35.
//
// O literal abaixo deixou de ser FONTE e virou REDE (fallback de rede/tabela
// ausente), no mesmo padrão do getMinimumTicket. Ele espelha a régua tier a
// tier — se divergir da tabela, é BUG.
//
// HISTÓRICO (dívida latente 3, fechada aqui): o literal usava cortes
// 0,11/0,21/0,30 e o banco tinha sido alterado À MÃO para os mesmos
// 0,11/0,21/0,30, divergindo da migration 20260528000000 (que sempre teve os
// cortes CERTOS 0,10/0,20/0,30). As duas fontes concordavam entre si e ambas
// discordavam da régua. Ver scripts/sql/2026-07-18_restaura_cortes_seguro_slip.sql.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
  type InsuranceShareTier,
} from "./insuranceCalculator.ts";

/**
 * REDE (fallback), não fonte. Espelha a régua da tabela tier a tier, com a
 * MESMA semântica de borda (inferior inclusiva, superior EXCLUSIVA).
 */
export const INSURANCE_SHARE_CUTS_FALLBACK: ReadonlyArray<InsuranceShareTier> = [
  { volume_min: 0.0, volume_max: 0.1, share_percent: 0.1 },
  { volume_min: 0.1, volume_max: 0.2, share_percent: 0.25 },
  { volume_min: 0.2, volume_max: 0.3, share_percent: 0.35 },
  { volume_min: 0.3, volume_max: null, share_percent: 0.5 },
];

/**
 * Cache de processo dos tiers da tabela. `null` = nunca primado (usa a rede).
 * Global por natureza: a escala de seguro não é por tenant nem por competência.
 */
let primedTiers: InsuranceShareTier[] | null = null;

/**
 * Carrega os tiers da tabela canônica e passa a servi-los ao
 * insuranceShareForPenetration. Chamar no INÍCIO de cada caminho de pagamento
 * (consolidadores + rota de cálculo). Se a tabela não responder, mantém a rede
 * e devolve ok:false — NUNCA lança, para não derrubar a consolidação.
 */
export async function primeInsuranceShareTiers(
  supabase: SupabaseClient
): Promise<{ ok: boolean; tiers: InsuranceShareTier[]; fonte: "tabela" | "rede" }> {
  try {
    const tiers = await fetchInsuranceSlipTiers(supabase);
    if (tiers.length > 0) {
      primedTiers = tiers;
      return { ok: true, tiers, fonte: "tabela" };
    }
  } catch {
    // cai na rede
  }
  console.warn(
    "[insuranceShare] tabela SEGURO_SLIP indisponivel; usando a REDE (literal). " +
      "Se isto aparecer numa consolidacao, o numero saiu do fallback."
  );
  return { ok: false, tiers: [...INSURANCE_SHARE_CUTS_FALLBACK], fonte: "rede" };
}

/** Descarta o cache (testes / gates que trocam de fonte no mesmo processo). */
export function resetInsuranceShareTiers(): void {
  primedTiers = null;
}

/** Qual fonte o resolvedor está servindo AGORA (para log/gate). */
export function insuranceShareTiersEmUso(): {
  fonte: "tabela" | "rede";
  tiers: ReadonlyArray<InsuranceShareTier>;
} {
  return primedTiers
    ? { fonte: "tabela", tiers: primedTiers }
    : { fonte: "rede", tiers: INSURANCE_SHARE_CUTS_FALLBACK };
}

/**
 * Share de repasse (0..1) para uma penetração decimal (0..1).
 * Lê a TABELA quando primada; senão a REDE. Mesmo lookup nos dois casos.
 */
export function insuranceShareForPenetration(penetracaoDecimal: number): number {
  const p = Number.isFinite(penetracaoDecimal) ? penetracaoDecimal : 0;
  return lookupInsuranceShareFromPenetration(
    (primedTiers ?? INSURANCE_SHARE_CUTS_FALLBACK) as InsuranceShareTier[],
    p
  );
}

/** Penetração individual (decimal 0..1) = líquido segurado / líquido total. */
export function individualPenetration(liquidoSegurado: number, liquidoTotal: number): number {
  if (!(liquidoTotal > 0)) return 0;
  return liquidoSegurado / liquidoTotal;
}

/**
 * FAIXA DE REPASSE pela penetração CONSOLIDADA do promotor (RR + ADS somadas).
 *
 * A penetração que decide o REPASSE é a do promotor no GRUPO INTEIRO, não a de
 * uma empresa isolada: o promotor que vende seguro no RR não pode cair na faixa
 * de baixo só porque a tela está filtrada na ADS. Quem já fazia essa conta era o
 * BBTS-2d (lib/bbtsOrchestrator) inline; virou função aqui para que o render da
 * /promotores use EXATAMENTE a mesma regra — uma fonte, não duas.
 *
 * Recebe os totais JÁ SOMADOS das duas pontas (o chamador é quem sabe de onde
 * vêm: fechamento CASH no mês fechado, diário no mês aberto).
 */
export function consolidatedInsuranceShare(totais: {
  seguradoRR: number;
  totalRR: number;
  seguradoADS: number;
  totalADS: number;
}): { penetracao: number; share: number } {
  const penetracao = individualPenetration(
    totais.seguradoRR + totais.seguradoADS,
    totais.totalRR + totais.totalADS
  );
  return { penetracao, share: insuranceShareForPenetration(penetracao) };
}

/** "Segurado" pelo FLAG da fonte ("Sim"). Normaliza acento/espaço/caixa. */
export function isSeguradaFlag(value: unknown): boolean {
  return (
    String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, "")
      .trim()
      .toUpperCase() === "SIM"
  );
}
