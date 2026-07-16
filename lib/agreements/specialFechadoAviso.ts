import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// lib/agreements/specialFechadoAviso.ts — GUARDA ANTI-SILENCIO:
// acordo SPECIAL (ajuste comercial) em competencia FECHADA.
//
// CONTEXTO. agreement_adjustment_value (coluna "Ajuste Comercial" do relatorio)
// = soma dos promoter_agreements tipo SPECIAL (ajuste avulso PERCENT/FIXED).
// SO o caminho DIARIO (app/api/calculate/monthly, mes aberto) o calcula: ali a
// RR computa a comissao do ZERO (TRP + share) e o ajuste entra por cima de
// forma legitima. Os consolidadores de mes FECHADO (cms, closing RR, bbts)
// gravam agreement_adjustment_value = 0.
//
// DECISAO: AVISAR, nao HONRAR (aplicar o ajuste). Por que:
//   1. Em mes fechado a comissao vem PRONTA da fonte: cms = ground-truth do
//      financeiro (PRODUCAO_GERAL_RR); closing = o que a Promotiva pagou; bbts =
//      idem ADS. O consolidateMonthlyFromCms documenta isso explicitamente:
//      "final = production + insurance (e NADA MAIS). Sem 5,80% / acordo / ...".
//      Ou seja, mes fechado REPRODUZ a fonte por design — nao editorializa.
//   2. Nao ha como saber se a fonte JA embutiu o ajuste no numero que mandou.
//      promoter_agreements e um lancamento avulso (valor + notes), SEM vinculo
//      com os contratos da fonte e SEM campo "ja aplicado". Aplicar por cima
//      arriscaria DOUBLE-COUNT de dinheiro ja pago numa competencia fechada —
//      um bug pior (dobra real) que o que resolveria.
//   3. Anti-silencio: em vez de engolir o SPECIAL em silencio (o mal que esta
//      guarda fecha), mantem-se agreement_adjustment_value = 0 EXPLICITO e
//      emite-se um aviso para o operador CONFERIR e decidir manualmente.
//
// HONRAR so seria correto se a fonte comprovadamente NAO incluisse o ajuste —
// como isso nao se prova pelo dado, AVISAR e a escolha segura. NAO "consertar"
// isto depois trocando por aplicacao automatica sem antes resolver o vinculo
// fonte<->ajuste.
//
// NO-OP hoje: ha 0 acordos SPECIAL em prod (medido). Esta guarda e blindagem
// contra mentira FUTURA — um SPECIAL lancado num mes fechado nunca mais some
// calado.
// ============================================================================

export interface SpecialFechadoResult {
  /** Quantidade de acordos SPECIAL ativos e com valor > 0 na competencia. */
  count: number;
  competencia: string;
  /** Promotores distintos com SPECIAL na competencia. */
  promoterIds: string[];
  /** Aviso pronto para o array de avisos do consolidador; null se nao ha SPECIAL. */
  aviso: string | null;
}

/**
 * Detecta acordos promoter_agreements tipo SPECIAL ATIVOS (valor > 0) na
 * competencia FECHADA sendo consolidada. READ-ONLY. Espelha o filtro do daily
 * (isMeaningfulAgreement: active !== false && commission_value > 0) e o escopo
 * year/month/active da query de acordos da rota (calculate/monthly:740-750).
 */
export async function detectSpecialAgreementsMesFechado(
  supabase: SupabaseClient,
  params: { year: number; month: number; companyId?: string | null; promoterId?: string | null }
): Promise<SpecialFechadoResult> {
  const { year, month } = params;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  let query = supabase
    .from("promoter_agreements")
    .select("promoter_id, commission_type, commission_value, active")
    .eq("year", year)
    .eq("month", month)
    .eq("agreement_type", "SPECIAL")
    .eq("active", true);
  if (params.companyId) query = query.eq("company_id", params.companyId);
  if (params.promoterId) query = query.eq("promoter_id", params.promoterId);

  const { data, error } = await query;
  if (error) throw error;

  // "meaningful" = mesmo criterio do daily: valor > 0 (PERCENT ou FIXED).
  const meaningful = (data || []).filter((a: any) => Number(a.commission_value) > 0);
  const promoterIds = [...new Set(meaningful.map((a: any) => String(a.promoter_id)))];

  const aviso =
    meaningful.length > 0
      ? `ANTI-SILENCIO ajuste comercial: ${meaningful.length} acordo(s) SPECIAL ativo(s) em ` +
        `${competencia} (competencia FECHADA), ${promoterIds.length} promotor(es). ` +
        `O ajuste NAO foi aplicado (mes fechado reproduz a fonte; ver ` +
        `lib/agreements/specialFechadoAviso.ts). agreement_adjustment_value=0. CONFERIR manualmente.`
      : null;

  return { count: meaningful.length, competencia, promoterIds, aviso };
}
