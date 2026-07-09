/**
 * lib/proposalDetailing.ts
 *
 * Helpers compartilhados para extrair detalhamento de propostas
 * (daily_production_records) e derivar campos exibidos na UI.
 *
 * Extraidos de lib/promoterAnalytics.ts na Etapa 4.4-fix-1.B para que
 * /api/commissions/proposals e qualquer outra rota possam consumir
 * os mesmos derivados sem duplicacao.
 *
 * Subset minimo de ProductionRow definido localmente — qualquer caller
 * pode usar `ProposalRecord` ou um tipo proprio compativel.
 */

export type ProposalRecord = {
  raw_payload?: Record<string, unknown> | null;
  is_srcc_restricted?: boolean | null;
  installments?: number | null;
  term_months?: number | null;
  gross_value?: number | null;
  company_received_percent?: number | null;
};

// ============================================================
// Dia 4.5 Etapa B — Cascata de % repasse do promotor
// ============================================================
//
// Tipos compartilhados para a resolucao do % repasse a partir do
// perfil cadastrado + escalas + volume mensal + override por
// proposta. Convencao de escala: share_percent_* em DECIMAL (0..1).
// 0.5833 = 58,33% (padrao da casa); 1.0 = 100% (Juliana socia).

export type SharePromoterProfile = {
  promoter_id: string;
  profile_type:
    | "DEFAULT"
    | "CLT_FIXO"
    | "ACORDO_FIXO"
    | "ENTRANTE_PADRAO"
    | "ENTRANTE_CUSTOM"
    | "ACORDO_VARIAVEL";
  fixed_percent: number | null;
  scale_id: string | null;
};

export type ShareScaleTier = {
  volume_min: number;
  volume_max: number | null;
  share_percent: number;
};

export type ShareScaleWithTiers = {
  id: string;
  scale_code: string;
  scale_kind: "CREDIT" | "INSURANCE";
  tiers: ShareScaleTier[];
};

export type ShareResolution = {
  sharePercent: number; // 0..1 decimal
  source: string;
};

// Default operacional RR (58,33% sobre % A VISTA) — replica
// DEFAULT_PROMOTER_SHARE_PERCENT da cascata legada em
// /api/calculate/monthly. Usado como fallback em todos os nos da
// arvore que nao encontram outra regra.
const DEFAULT_SHARE = 0.5833;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Le valor de raw_payload (jsonb da daily_production_records) tentando
 * varios aliases. Returns null se nenhum bate ou se o valor for vazio.
 *
 * Match e case/acento-insensitive — "Prefixo Ag. Responsavel" bate com
 * "PREFIXO AG. RESPONSÁVEL", "prefixo ag. responsavel", etc.
 */
export function readRawPayloadValue(
  payload: Record<string, unknown> | null | undefined,
  aliases: string[]
): unknown {
  if (!payload || typeof payload !== "object") return null;

  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (normalizedAliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

/**
 * Retorna o codigo/prefixo da agencia bancaria responsavel pela proposta.
 * Tenta varios aliases que aparecem no raw_payload conforme a fonte
 * (Promotiva exporta com encoding/acento variavel).
 */
export function getAgencyCode(record: ProposalRecord): string {
  const raw = readRawPayloadValue(record.raw_payload, [
    "Prefixo Ag. Responsavel",
    "Prefixo Ag. Responsável",
    "Agencia",
    "Agência",
    "Agencia Responsavel",
    "Agência Responsável",
  ]);

  return raw === null || raw === undefined || raw === "" ? "-" : String(raw);
}

/**
 * Retorna label de Restricao SRCC. Preferencia ao valor textual do
 * raw_payload (que pode ter detalhes); fallback para "Sim"/"Nao"
 * derivado do boolean is_srcc_restricted.
 */
export function getSrccRestrictionLabel(record: ProposalRecord): string {
  const raw =
    readRawPayloadValue(record.raw_payload, [
      "Indicador Restricao SRCC",
      "Indicador Restrição SRCC",
      "Restricao SRCC",
      "Restrição SRCC",
    ]) || null;

  if (raw !== null && raw !== undefined && raw !== "") {
    return String(raw);
  }

  return record.is_srcc_restricted ? "Sim" : "Não";
}

/**
 * Retorna numero de parcelas. Prioriza `installments`; fallback para
 * `term_months` (alguns produtos so trazem termo em meses). null se
 * nenhum dos dois esta presente.
 */
export function getInstallmentCount(
  record: ProposalRecord
): number | null {
  const installments = record.installments;
  if (installments !== null && installments !== undefined && Number.isFinite(Number(installments))) {
    return Number(installments);
  }
  const term = record.term_months;
  if (term !== null && term !== undefined && Number.isFinite(Number(term))) {
    return Number(term);
  }
  return null;
}

/**
 * Retorna a comissao da empresa (valor em R$) calculada como
 * gross_value * company_received_percent / 100. null se algum dos 2
 * estiver ausente.
 *
 * Atencao: company_received_percent eh armazenado como percentual
 * inteiro (ex: 12.5 para 12,5%) — dividir por 100 antes de multiplicar.
 */
export function getCompanyCommissionAmount(
  record: ProposalRecord
): number | null {
  const gross = record.gross_value;
  const percent = record.company_received_percent;
  if (
    gross === null ||
    gross === undefined ||
    percent === null ||
    percent === undefined
  ) {
    return null;
  }
  const grossNum = Number(gross);
  const percentNum = Number(percent);
  if (!Number.isFinite(grossNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (grossNum * percentNum) / 100;
}

/**
 * Comissao do promotor em R$ apos aplicacao do % de penetracao
 * (override OU default). 4.4-fix-1.C: col 18 da planilha LUCIANA.
 *
 * Formula: COMISSAO PF (base) * % penetracao efetiva / 100.
 * Retorna null quando algum dos 2 esta ausente.
 */
export function computePromoterShareAmount(
  commissionPfAmount: number | null | undefined,
  penetrationPercentEffective: number | null | undefined
): number | null {
  if (
    commissionPfAmount === null ||
    commissionPfAmount === undefined ||
    penetrationPercentEffective === null ||
    penetrationPercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(commissionPfAmount);
  const percentNum = Number(penetrationPercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}

/**
 * Le a "% A VISTA pura" Promotiva direto do raw_payload da
 * daily_production_record. 4.4-fix-1.E (D1): essa eh a regra TRP/OPP
 * original da Promotiva (ex: 5,80% para Consignado Publico tx 2,18%),
 * NAO o valor pos-cascata que esta em promoter_commission_percent.
 *
 * 4.4-fix-1.F: ALIASES expandidos para 12 variacoes; fallback dev-only
 * dumpa as chaves do raw_payload no console quando nenhum bate, para
 * o Diego conseguir descobrir o nome real e me reportar.
 *
 * Normalizacao: planilha Promotiva grava como decimal (0.058) ou
 * percentual (5.8) dependendo da fonte. Heuristica: valores <= 1
 * sao considerados decimal e multiplicados por 100 para unificar
 * a escala 0-100 usada na UI. Match e case/acento-insensitive via
 * readRawPayloadValue → normalizeText.
 */
const A_VISTA_ALIASES = [
  "% A VISTA",
  "%A_VISTA",
  "%A VISTA",
  "% A_VISTA",
  "PCT_A_VISTA",
  "PERCENT_A_VISTA",
  "%AVISTA",
  "% AVISTA",
  "PCTAVISTA",
  "%_A_VISTA",
  "% VISTA",
  "VISTA",
];

export function getAVistaPercent(record: ProposalRecord): number | null {
  // 1) Fluxo legado/Promotiva direto: tenta raw_payload via 12 aliases.
  //    Mantido como fonte PRIMARIA por back-compat com importacoes
  //    antigas que vinham com a chave dentro do JSON original.
  if (record?.raw_payload) {
    const raw = readRawPayloadValue(record.raw_payload, A_VISTA_ALIASES);

    if (raw !== null && raw !== undefined && raw !== "") {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        // Heuristica de escala: decimais entram em 0..1, percentuais ja em 0..100.
        return num <= 1 ? num * 100 : num;
      }
    } else if (
      // Fallback dev: lista as chaves do payload (1a vez por sessao
      // bastaria; aqui logamos sempre que falhar — barato e ajuda).
      typeof record.raw_payload === "object" &&
      record.raw_payload !== null &&
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development"
    ) {
      const keys = Object.keys(record.raw_payload);
      if (keys.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[getAVistaPercent] Nenhum alias bateu. Chaves do raw_payload:",
          keys.slice(0, 50)
        );
      }
    }
  }

  // 2) FIX-1.D: fluxo importador real — coluna estruturada
  //    company_received_percent. Sem isso, recalculateSingleProposal e
  //    o GET /api/commissions/proposals retornavam null aqui, levando
  //    computeComissaoPromotor a 0 e a coluna COMISSAO PROMOTOR em
  //    /comissoes/editar exibir R$ 0,00 em todas as linhas.
  if (record?.company_received_percent != null) {
    const num = Number(record.company_received_percent);
    if (Number.isFinite(num)) {
      return num <= 1 ? num * 100 : num;
    }
  }

  return null;
}

/**
 * Comissao do promotor sobre seguro em R$. 4.4-fix-1.C: col 19 da
 * planilha LUCIANA. Formula: COMISSAO SEGURO (total) * % seguro
 * promotor efetivo / 100. Retorna null quando algum esta ausente.
 *
 * Dia 4.5 (futuro) tornara o % editavel.
 */
export function computePromoterInsuranceAmount(
  insuranceCommissionAmount: number | null | undefined,
  insurancePercentEffective: number | null | undefined
): number | null {
  if (
    insuranceCommissionAmount === null ||
    insuranceCommissionAmount === undefined ||
    insurancePercentEffective === null ||
    insurancePercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(insuranceCommissionAmount);
  const percentNum = Number(insurancePercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}

// ============================================================
// Dia 4.5 Etapa B — Helpers da cascata de share_percent
// ============================================================

/**
 * Encontra o tier que cobre o valor passado dentro de uma escala
 * ja pre-carregada. Sync. Retorna null se valor cai fora do range
 * de todos os tiers (incluindo o caso de estar abaixo do volume_min
 * do primeiro tier).
 *
 * Para escalas CREDIT, `value` eh volume em R$ (ex: 87000).
 * Para escalas INSURANCE, `value` eh % penetracao em decimal
 * (ex: 0.27 = 27%).
 */
export function findScaleTier(
  scale: ShareScaleWithTiers | undefined,
  value: number
): ShareScaleTier | null {
  if (!scale) return null;
  for (const tier of scale.tiers) {
    const min = Number(tier.volume_min);
    const max = tier.volume_max == null ? Infinity : Number(tier.volume_max);
    if (value >= min && value <= max) return tier;
  }
  return null;
}

/**
 * Resolve o % de repasse para um record especifico aplicando a
 * cascata da Etapa B sobre maps pre-carregados. Sincrono — todas
 * as dependencias (profilesMap, scalesMap, monthlyVolumesMap) devem
 * estar ja em memoria. Use fetchPromoterShareData() para popular
 * as 3 maps de uma so vez.
 *
 * Cascata (em ordem):
 *   1. share_percent_override (proposal_commissions) — vence tudo
 *   2. profile CLT_FIXO | ACORDO_FIXO -> fixed_percent
 *   3. profile ENTRANTE_* -> tier da escala por volume mensal
 *   4. profile ACORDO_VARIAVEL sem override -> DEFAULT 58,33%
 *   5. profile DEFAULT (catch-all, inclui chaves master) -> 58,33%
 *
 * Retorna sempre {sharePercent: number, source: string}; source
 * descreve qual no da cascata definiu o valor (alimenta badge na UI).
 */
// ============================================================
// FRENTE C — escala de repasse: FONTE ÚNICA da verdade. Extraída verbatim do
// motor (calculate/monthly:1138-1163) pra que a tela de edição
// (resolvePromoterShareSync) e o motor apliquem EXATAMENTE a mesma regra. Antes
// divergiam: o motor lia promoter_goal_repasse (ex.: 66,66%) e a tela caía no
// DEFAULT 58,33% — o que fazia o Salvar REBAIXAR o acordo.
// ============================================================

// INSS da Aldalene: repasse fixo 65,86% (fora da escala por meta). So mes ABERTO.
export const ALDALENE_INSS_FIXED_SHARE = 0.6586;

// Detecta proposta INSS (mesmo criterio do motor): convenio_code '1640' OU
// descricao do produto contem 'INSS'.
export function isInssRecord(record: {
  convenio_code?: string | null;
  product_description?: string | null;
}): boolean {
  const code = String(record?.convenio_code ?? "").trim();
  if (code === "1640") return true;
  return normalizeText(record?.product_description).includes("INSS");
}

export type GoalRepasseRow = {
  pct_base: number;
  pct_meta1: number | null;
  pct_meta2: number | null;
} | null;

export type FrenteCInput = {
  goalRepasse: GoalRepasseRow;
  productionValue: number; // produção VÁLIDA do mês (== validRecords do motor)
  target1Value: number;
  target2Value: number;
  isAldaleneInss: boolean;
  isFaixa580: boolean; // % à vista atingiu o teto 5,80
};

// Resolve o SHARE (0..1) da Frente C, ou null se nao se aplica (cai na cascata
// de profile). Espelha calculate/monthly verbatim (Aldalene INSS fixo + escala
// por meta base/meta1/meta2). NAO multiplica pelo % a vista — quem chama aplica.
export function resolveFrenteCShare(
  input: FrenteCInput
): { share: number; faixaMeta: string; source: string } | null {
  const { goalRepasse, productionValue, target1Value, target2Value, isAldaleneInss, isFaixa580 } = input;
  if (isAldaleneInss) {
    return { share: ALDALENE_INSS_FIXED_SHARE, faixaMeta: "INSS", source: "FRENTE_C_INSS_ALDALENE_FIXO" };
  }
  if (isFaixa580 && goalRepasse) {
    let escalaShare = Number(goalRepasse.pct_base);
    let faixaMeta = "BASE";
    if (target2Value > 0 && productionValue >= target2Value && goalRepasse.pct_meta2 != null) {
      escalaShare = Number(goalRepasse.pct_meta2);
      faixaMeta = "META2";
    } else if (target1Value > 0 && productionValue >= target1Value && goalRepasse.pct_meta1 != null) {
      escalaShare = Number(goalRepasse.pct_meta1);
      faixaMeta = "META1";
    }
    return { share: escalaShare, faixaMeta, source: `FRENTE_C_ESCALA_${faixaMeta}` };
  }
  return null;
}

export function resolvePromoterShareSync(args: {
  record: {
    assigned_promoter_id: string | null;
    share_percent_override?: number | null;
  };
  profilesMap: Map<string, SharePromoterProfile>;
  scalesMap: Map<string, ShareScaleWithTiers>;
  monthlyVolumesMap: Map<string, number>;
  // FRENTE C — quando fornecido, aplica a escala ANTES do override/profile
  // (igual ao motor, onde a escala faixa-5,80% vence). O motor NAO passa isto
  // (resolve a Frente C no proprio fluxo); a tela de edição passa.
  frenteC?: FrenteCInput | null;
}): ShareResolution {
  const { record, profilesMap, scalesMap, monthlyVolumesMap } = args;
  const promoterId = record.assigned_promoter_id;

  if (!promoterId) {
    return { sharePercent: DEFAULT_SHARE, source: "DEFAULT_FALLBACK" };
  }

  // Nivel 0 (FRENTE C): escala da fonte única. Vence ATÉ o override, igual ao
  // motor (la a escala faixa-5,80% e aplicada antes de resolvePromoterShareSync).
  if (args.frenteC) {
    const fc = resolveFrenteCShare(args.frenteC);
    if (fc) return { sharePercent: fc.share, source: fc.source };
  }

  // Nivel 1: override por proposta vence tudo.
  if (
    record.share_percent_override !== null &&
    record.share_percent_override !== undefined
  ) {
    const ov = Number(record.share_percent_override);
    if (Number.isFinite(ov)) {
      return { sharePercent: ov, source: "OVERRIDE_PROPOSTA" };
    }
  }

  const profile = profilesMap.get(promoterId);
  if (!profile) {
    return { sharePercent: DEFAULT_SHARE, source: "DEFAULT_NO_PROFILE" };
  }

  // Nivel 2: % fixo (CLT ou ACORDO_FIXO).
  if (
    profile.profile_type === "CLT_FIXO" ||
    profile.profile_type === "ACORDO_FIXO"
  ) {
    const fixed = Number(profile.fixed_percent);
    if (Number.isFinite(fixed)) {
      return { sharePercent: fixed, source: `PROFILE_${profile.profile_type}` };
    }
    return { sharePercent: DEFAULT_SHARE, source: "PROFILE_FIXED_INVALID" };
  }

  // Nivel 3: escala por volume mensal (ENTRANTE_*).
  if (
    profile.profile_type === "ENTRANTE_PADRAO" ||
    profile.profile_type === "ENTRANTE_CUSTOM"
  ) {
    if (!profile.scale_id) {
      return {
        sharePercent: 0,
        source: `PROFILE_${profile.profile_type}_NO_SCALE`,
      };
    }
    const scale = scalesMap.get(profile.scale_id);
    const volume = monthlyVolumesMap.get(promoterId) ?? 0;
    const tier = findScaleTier(scale, volume);
    if (tier) {
      const volumeK = Math.floor(volume / 1000);
      return {
        sharePercent: Number(tier.share_percent),
        source: `PROFILE_${profile.profile_type}_VOL_${volumeK}K`,
      };
    }
    return {
      sharePercent: 0,
      source: `PROFILE_${profile.profile_type}_BELOW_MIN`,
    };
  }

  // Nivel 4: ACORDO_VARIAVEL sem override -> DEFAULT.
  if (profile.profile_type === "ACORDO_VARIAVEL") {
    return { sharePercent: DEFAULT_SHARE, source: "PROFILE_VARIAVEL_FALLBACK" };
  }

  // Nivel 5: DEFAULT (catch-all, inclui as 4 chaves master).
  return { sharePercent: DEFAULT_SHARE, source: "PROFILE_DEFAULT" };
}

/**
 * Busca o volume mensal total (sum de net_value) de um promotor
 * em (year, month). Usado por recalculateSingleProposal quando nao
 * temos o batch carregado.
 */
export async function getPromoterMonthlyVolume(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  promoterId: string,
  year: number,
  month: number
): Promise<number> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("daily_production_records")
    .select("net_value")
    .eq("assigned_promoter_id", promoterId)
    .gte("movement_date", startDate)
    .lt("movement_date", endDate);

  if (error || !data) return 0;
  let total = 0;
  for (const row of data) {
    total += Number((row as { net_value?: number | null }).net_value ?? 0);
  }
  return total;
}

/**
 * Lookup async de um tier especifico (1 escala + 1 valor). Wrapper
 * de findScaleTier que faz a query do banco antes. Util para
 * recalculateSingleProposal sem ter que carregar tudo em batch.
 */
export async function lookupScaleTier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  scaleId: string,
  value: number
): Promise<number | null> {
  const { data } = await supabase
    .from("share_scale_tier")
    .select("share_percent, volume_min, volume_max")
    .eq("scale_id", scaleId)
    .lte("volume_min", value)
    .order("volume_min", { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  const tier = data[0] as {
    share_percent: number;
    volume_min: number;
    volume_max: number | null;
  };
  if (tier.volume_max !== null && value > Number(tier.volume_max)) {
    return null;
  }
  return Number(tier.share_percent);
}

/**
 * Carrega em BATCH (3 queries) todos os dados necessarios para
 * resolver share_percent de um conjunto de promotores num (year,
 * month). Retorna 3 maps prontos para consumo por
 * resolvePromoterShareSync.
 */
export async function fetchPromoterShareData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  promoterIds: string[],
  year: number,
  month: number,
  // ESCOPO DE EMPRESA — company_ids que entram na produção/volume que alimenta
  // monthlyVolumesMap e frenteCProductionMap (escala ENTRANTE + Frente C). O
  // consolidador RR passa os company_ids do Grupo RR; o de ADS passa a ADS. Sem
  // escopo => soma TODAS as empresas (comportamento antigo) + AVISO — evita que
  // produção de outra empresa (ex: ADS) vaze na escala do promotor. A meta
  // CONSOLIDADA RR+ADS é aplicada explicitamente pelo orquestrador (BBTS-2d).
  scopeCompanyIds?: string[]
): Promise<{
  profilesMap: Map<string, SharePromoterProfile>;
  scalesMap: Map<string, ShareScaleWithTiers>;
  monthlyVolumesMap: Map<string, number>;
  // FRENTE C: escala (goal_repasse) + metas + produção VÁLIDA do mês.
  goalRepasseMap: Map<string, GoalRepasseRow>;
  targetsMap: Map<string, { meta1: number; meta2: number }>;
  // produção VÁLIDA (PRODUÇÃO && !cancelado && !srcc) — == productionValue do
  // motor. Separado de monthlyVolumesMap (TODOS os records, usado p/ ENTRANTE).
  frenteCProductionMap: Map<string, number>;
}> {
  const profilesMap = new Map<string, SharePromoterProfile>();
  const scalesMap = new Map<string, ShareScaleWithTiers>();
  const monthlyVolumesMap = new Map<string, number>();
  const goalRepasseMap = new Map<string, GoalRepasseRow>();
  const targetsMap = new Map<string, { meta1: number; meta2: number }>();
  const frenteCProductionMap = new Map<string, number>();

  if (promoterIds.length === 0) {
    return { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap };
  }

  // 1. Profiles dos promoters relevantes.
  const { data: profiles } = await supabase
    .from("promoter_share_profile")
    .select("promoter_id, profile_type, fixed_percent, scale_id")
    .in("promoter_id", promoterIds);

  const profileRows = (profiles ?? []) as SharePromoterProfile[];
  const scaleIdsNeeded = new Set<string>();
  for (const p of profileRows) {
    profilesMap.set(p.promoter_id, p);
    if (p.scale_id) scaleIdsNeeded.add(p.scale_id);
  }

  // 2. Escalas + tiers (apenas as referenciadas por algum perfil).
  if (scaleIdsNeeded.size > 0) {
    const scaleIds = Array.from(scaleIdsNeeded);
    const [scalesRes, tiersRes] = await Promise.all([
      supabase
        .from("share_scale")
        .select("id, scale_code, scale_kind")
        .in("id", scaleIds),
      supabase
        .from("share_scale_tier")
        .select("scale_id, volume_min, volume_max, share_percent")
        .in("scale_id", scaleIds)
        .order("volume_min", { ascending: true }),
    ]);

    const scalesById = new Map<
      string,
      { id: string; scale_code: string; scale_kind: "CREDIT" | "INSURANCE" }
    >();
    for (const s of scalesRes.data ?? []) {
      scalesById.set(
        (s as { id: string }).id,
        s as { id: string; scale_code: string; scale_kind: "CREDIT" | "INSURANCE" }
      );
    }

    const tiersByScale = new Map<string, ShareScaleTier[]>();
    for (const t of tiersRes.data ?? []) {
      const row = t as {
        scale_id: string;
        volume_min: number;
        volume_max: number | null;
        share_percent: number;
      };
      if (!tiersByScale.has(row.scale_id)) tiersByScale.set(row.scale_id, []);
      tiersByScale.get(row.scale_id)!.push({
        volume_min: Number(row.volume_min),
        volume_max: row.volume_max == null ? null : Number(row.volume_max),
        share_percent: Number(row.share_percent),
      });
    }

    for (const [id, scale] of scalesById) {
      scalesMap.set(id, {
        id: scale.id,
        scale_code: scale.scale_code,
        scale_kind: scale.scale_kind,
        tiers: tiersByScale.get(id) ?? [],
      });
    }
  }

  // 3. Volume mensal por promotor (1 aggregation query).
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  let volumeQuery = supabase
    .from("daily_production_records")
    .select("assigned_promoter_id, net_value, status, cancellation_date, is_srcc_restricted")
    .in("assigned_promoter_id", promoterIds)
    .gte("movement_date", startDate)
    .lt("movement_date", endDate);
  // ESCOPO: só as empresas do consolidador chamador — impede que produção de
  // outra empresa (ex: ADS) infle o volume/produção da escala do promotor.
  if (scopeCompanyIds && scopeCompanyIds.length > 0) {
    volumeQuery = volumeQuery.in("company_id", scopeCompanyIds);
  } else {
    console.warn(
      "[fetchPromoterShareData] SEM escopo de empresa — monthlyVolumesMap/frenteCProductionMap somam TODAS as empresas (RR+ADS podem se misturar). Passe scopeCompanyIds."
    );
  }
  const { data: volumeRows } = await volumeQuery;

  for (const row of volumeRows ?? []) {
    const r = row as {
      assigned_promoter_id: string | null;
      net_value: number | null;
      status: string | null;
      cancellation_date: string | null;
      is_srcc_restricted: boolean | null;
    };
    if (!r.assigned_promoter_id) continue;
    const net = Number(r.net_value ?? 0);
    // monthlyVolumesMap = TODOS os records (escala ENTRANTE por volume).
    monthlyVolumesMap.set(
      r.assigned_promoter_id,
      (monthlyVolumesMap.get(r.assigned_promoter_id) ?? 0) + net
    );
    // frenteCProductionMap = produção VÁLIDA — espelha validRecords do motor
    // (isProductionStatus && !cancellation_date && !is_srcc_restricted).
    const st = normalizeText(r.status);
    const isProd = st === "PRODUCAO" || st === "PRODUCTION";
    if (isProd && !r.cancellation_date && !r.is_srcc_restricted) {
      frenteCProductionMap.set(
        r.assigned_promoter_id,
        (frenteCProductionMap.get(r.assigned_promoter_id) ?? 0) + net
      );
    }
  }

  // 4. FRENTE C — escala de repasse da competência + metas (meta_1/meta_2).
  const competencia = `${year}-${String(month).padStart(2, "0")}-01`;
  const [goalRes, targetsRes] = await Promise.all([
    supabase
      .from("promoter_goal_repasse")
      .select("promoter_id, pct_base, pct_meta1, pct_meta2")
      .eq("competencia", competencia)
      .in("promoter_id", promoterIds),
    supabase
      .from("monthly_targets")
      .select("promoter_id, meta_1, meta_2")
      .eq("year", year)
      .eq("month", month)
      .in("promoter_id", promoterIds),
  ]);
  for (const g of goalRes.data ?? []) {
    const r = g as { promoter_id: string; pct_base: number; pct_meta1: number | null; pct_meta2: number | null };
    goalRepasseMap.set(r.promoter_id, { pct_base: Number(r.pct_base), pct_meta1: r.pct_meta1, pct_meta2: r.pct_meta2 });
  }
  for (const t of targetsRes.data ?? []) {
    const r = t as { promoter_id: string; meta_1: number | null; meta_2: number | null };
    targetsMap.set(r.promoter_id, { meta1: Number(r.meta_1 ?? 0), meta2: Number(r.meta_2 ?? 0) });
  }

  return { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap };
}

/**
 * Calcula COMISSAO PROMOTOR (BRL) a partir de net_value, a_vista_percent
 * (Promotiva pura, 0..100) e sharePercent (0..1). Aplica teto 5,80% sobre
 * a_vista_percent ANTES de multiplicar (limite operacional RR: Promotiva
 * paga ate 6%, RR limita visao do promotor a 5,80%, spread fica empresa).
 *
 * Formula: net_value × min(a_vista, 5.8) / 100 × sharePercent
 *
 * Retorna 0 se algum input for invalido.
 */
export function computeComissaoPromotor(
  netValue: number | null | undefined,
  aVistaPercent: number | null | undefined,
  sharePercent: number | null | undefined
): number {
  const nv = Number(netValue ?? 0);
  const av = Number(aVistaPercent ?? 0);
  const sp = Number(sharePercent ?? 0);
  if (!Number.isFinite(nv) || !Number.isFinite(av) || !Number.isFinite(sp)) {
    return 0;
  }
  const aVistaClamped = Math.min(Math.max(av, 0), 5.8);
  const comissaoPF = (nv * aVistaClamped) / 100;
  return comissaoPF * sp;
}

/**
 * Dia 4.5 Etapa B — Recalculo localizado de uma proposta.
 *
 * Apos mutacao em proposal_commissions (POST upsert / DELETE / bulk),
 * recalcula promoter_commission_amount + promoter_commission_percent
 * em daily_production_records usando a cascata nova de share_percent.
 *
 * Atualiza:
 *   promoter_commission_amount  = computeComissaoPromotor(...)
 *   promoter_commission_percent = aVistaClamped × sharePercent
 *                                 (% efetivo final, escala 0..100)
 *   commission_rule_source       = `DIA45_${source}`
 *
 * Fail-safe: erros sao retornados (nao throw), permitindo o caller
 * decidir se aborta ou apenas loga (idem padrao audit_logs).
 *
 * TODO Disc.29: quando endpoint de reatribuicao (PATCH
 * daily_production_records.assigned_promoter_id) for criado, chamar
 * esta funcao automaticamente apos cada UPDATE de assigned_promoter_id,
 * para que a cascata pegue o profile do novo promotor (ex: master ->
 * Luciana -> 66,66%).
 */
export async function recalculateSingleProposal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  recordId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: record, error: fetchErr } = await supabase
      .from("daily_production_records")
      .select(
        "id, assigned_promoter_id, net_value, raw_payload, company_received_percent, movement_date, company_id, convenio_code, product_description"
      )
      .eq("id", recordId)
      .maybeSingle();

    if (fetchErr || !record) {
      return { ok: false, error: fetchErr?.message ?? "record nao encontrado" };
    }

    const promoterId = (record as { assigned_promoter_id: string | null })
      .assigned_promoter_id;
    if (!promoterId) {
      return { ok: false, error: "record sem assigned_promoter_id" };
    }

    const movementDate = String(
      (record as { movement_date: string | null }).movement_date ?? ""
    );
    const m = movementDate.match(/^(\d{4})-(\d{2})-/);
    if (!m) {
      return { ok: false, error: "movement_date invalido" };
    }
    const year = Number(m[1]);
    const month = Number(m[2]);

    // Override atual em proposal_commissions (se houver).
    const { data: manual } = await supabase
      .from("promoter_proposal_commissions")
      .select("share_percent_override, active")
      .eq("daily_production_record_id", recordId)
      .maybeSingle();

    const overrideValue =
      manual?.active !== false ? manual?.share_percent_override ?? null : null;

    // Pre-carrega dados de cascata para 1 promoter no mes (inclui Frente C).
    const { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap } =
      await fetchPromoterShareData(supabase, [promoterId], year, month);
    // Nome do promotor (carve-out Aldalene INSS).
    const { data: promRow } = await supabase
      .from("promoters")
      .select("name")
      .eq("id", promoterId)
      .maybeSingle();

    const aVista = getAVistaPercent(
      record as { raw_payload: Record<string, unknown> | null }
    );
    const aVistaClamped = Math.min(Math.max(Number(aVista ?? 0), 0), 5.8);

    // FRENTE C — mesma fonte única do motor e da tela de edição.
    const tgt = targetsMap.get(promoterId);
    const resolution = resolvePromoterShareSync({
      record: {
        assigned_promoter_id: promoterId,
        share_percent_override: overrideValue,
      },
      profilesMap,
      scalesMap,
      monthlyVolumesMap,
      frenteC: {
        goalRepasse: goalRepasseMap.get(promoterId) ?? null,
        productionValue: frenteCProductionMap.get(promoterId) ?? 0,
        target1Value: tgt?.meta1 ?? 0,
        target2Value: tgt?.meta2 ?? 0,
        isAldaleneInss:
          normalizeText((promRow as { name?: string } | null)?.name).includes("ALDALENE") &&
          isInssRecord(record as { convenio_code?: string | null; product_description?: string | null }),
        isFaixa580: aVistaClamped >= 5.8 - 0.001,
      },
    });
    const netValue = Number(
      (record as { net_value: number | null }).net_value ?? 0
    );
    const comissaoPromotor = computeComissaoPromotor(
      netValue,
      aVista,
      resolution.sharePercent
    );
    const effectiveFinalPercent = aVistaClamped * resolution.sharePercent;

    const { error: updErr } = await supabase
      .from("daily_production_records")
      .update({
        promoter_commission_amount: comissaoPromotor,
        promoter_commission_percent: effectiveFinalPercent,
        commission_rule_source: `DIA45_${resolution.source}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recordId);

    if (updErr) {
      return { ok: false, error: updErr.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "erro inesperado",
    };
  }
}
