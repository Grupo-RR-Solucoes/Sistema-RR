import type { SupabaseClient } from "@supabase/supabase-js";

import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { nowInFortaleza } from "@/lib/dateFortaleza";

/**
 * F4 — Visão do gestor. Monta a produção/desempenho do TIME do gestor logado,
 * SEM comissão/financeiro/PII.
 *
 * Fontes (a segurança é do banco, não daqui):
 *   - vw_team_production (F3): já vem filtrada pela árvore do gestor (WHERE +
 *     helper security-definer por auth.uid()). Precisa do client ANON
 *     autenticado. 28 colunas de produção, ZERO de comissão.
 *   - monthly_targets: a policy F3 restringe as metas ao time do gestor.
 *   - nomes de promotor: buscados via service_role SÓ para os ids que a view/
 *     metas já autorizaram (a tabela promoters não tem policy para gestor). Não
 *     há vazamento: o escopo é definido pelas fontes RLS acima.
 *
 * METODOLOGIA (idêntica a lib/promoterAnalytics.ts, para bater com
 * Dashboard/Projeção/Promotores):
 *   - Elegível = status ∈ {PRODUCAO, PRODUCTION} E is_srcc_restricted !== true.
 *   - Competência do registro = movement_date → contract_date → proposal_date,
 *     via getProductionPeriodFromValue (janela de produção por competência).
 *   - "Realizado" = Σ net_value dos elegíveis (mês aberto, ao vivo).
 *   - Penetração de seguro = Σ gross_value(dos com seguro) / Σ gross_value(total)
 *     × 100 (share do bruto com seguro — MESMA métrica de promoterAnalytics;
 *     NÃO é insurance_value/gross_value).
 *   - Agrupamento por assigned_promoter_id (promotor atribuído). Registros sem
 *     atribuição não entram (a view já exclui is_master; sem balde).
 */

interface ViewRow {
  id: string;
  assigned_promoter_id: string | null;
  promoter_id: string | null;
  status: string | null;
  is_srcc_restricted: boolean | null;
  movement_date: string | null;
  contract_date: string | null;
  proposal_date: string | null;
  net_value: number | null;
  gross_value: number | null;
  insurance_value: number | null;
  has_insurance: boolean | null;
}

interface TargetRow {
  promoter_id: string;
  year: number;
  month: number;
  meta: number | null;
  meta_1: number | null;
  meta_2: number | null;
}

export type TargetStatus = "META_2" | "META_1" | "META" | "ABAIXO" | "SEM_META";

export interface TeamPromoterRow {
  promoter_id: string;
  promoter_name: string;
  production_value: number;
  gross_value: number;
  proposal_count: number;
  insurance_production: number;
  insurance_penetration_percent: number;
  meta: number;
  meta_1: number;
  meta_2: number;
  target_status: TargetStatus;
  attainment_percent: number | null;
}

export interface TeamPeriod {
  key: string;
  label: string;
  year: number;
  month: number;
}

export interface TeamProductionPayload {
  period: TeamPeriod;
  periods: TeamPeriod[];
  rows: TeamPromoterRow[];
  totals: {
    promoters: number;
    production_value: number;
    gross_value: number;
    proposal_count: number;
    insurance_production: number;
    insurance_penetration_percent: number;
    meta: number;
    attainment_percent: number | null;
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// Espelha isProductionStatus/isEligibleProductionRecord de promoterAnalytics.
function isProductionStatus(status: unknown): boolean {
  const n = normalizeText(status);
  return n === "PRODUCAO" || n === "PRODUCTION";
}
function isEligible(row: ViewRow): boolean {
  return isProductionStatus(row.status) && row.is_srcc_restricted !== true;
}

// Espelha extractYearMonth de promoterAnalytics.
function extractYearMonth(row: ViewRow) {
  return (
    getProductionPeriodFromValue(row.movement_date) ||
    getProductionPeriodFromValue(row.contract_date) ||
    getProductionPeriodFromValue(row.proposal_date)
  );
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function periodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1]}/${String(year).slice(-2)}`;
}

// Espelha resolveTargetStatus de promoterAnalytics.
function resolveTargetStatus(prod: number, meta: number, m1: number, m2: number): TargetStatus {
  if (meta <= 0 && m1 <= 0 && m2 <= 0) return "SEM_META";
  if (m2 > 0 && prod >= m2) return "META_2";
  if (m1 > 0 && prod >= m1) return "META_1";
  if (meta > 0 && prod >= meta) return "META";
  return "ABAIXO";
}

interface Acc {
  net: number;
  gross: number;
  insuredGross: number;
  insurance: number;
  count: number;
}
function emptyAcc(): Acc {
  return { net: 0, gross: 0, insuredGross: 0, insurance: 0, count: 0 };
}

export async function buildTeamProduction(
  db: SupabaseClient, // anon autenticado (RLS/auth.uid)
  admin: SupabaseClient, // service_role — só p/ nomes dos ids já autorizados
  opts: { year?: number; month?: number }
): Promise<TeamProductionPayload> {
  const [viewRes, targetRes] = await Promise.all([
    db
      .from("vw_team_production")
      .select(
        "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance"
      ),
    db
      .from("monthly_targets")
      .select("promoter_id, year, month, meta, meta_1, meta_2"),
  ]);

  if (viewRes.error) throw viewRes.error;
  if (targetRes.error) throw targetRes.error;

  const rows = (viewRes.data ?? []) as ViewRow[];
  const targets = (targetRes.data ?? []) as TargetRow[];

  // ---- competências disponíveis (dos registros + das metas) ----
  const periodsMap = new Map<string, TeamPeriod>();
  const addPeriod = (y: number, m: number) =>
    periodsMap.set(periodKey(y, m), { key: periodKey(y, m), label: periodLabel(y, m), year: y, month: m });
  for (const r of rows) {
    const p = extractYearMonth(r);
    if (p) addPeriod(p.year, p.month);
  }
  for (const t of targets) addPeriod(t.year, t.month);

  const periods = Array.from(periodsMap.values()).sort((a, b) =>
    a.year !== b.year ? b.year - a.year : b.month - a.month
  );

  // competência selecionada: query > "hoje" em Fortaleza (bate com Dashboard/Projeção)
  const now = nowInFortaleza();
  const wantYear = opts.year ?? now.year;
  const wantMonth = opts.month ?? now.month;
  const period: TeamPeriod =
    periods.find((p) => p.year === wantYear && p.month === wantMonth) ?? {
      key: periodKey(wantYear, wantMonth),
      label: periodLabel(wantYear, wantMonth),
      year: wantYear,
      month: wantMonth,
    };

  // ---- agrega produção elegível do período, por promotor atribuído ----
  const perPromoter = new Map<string, Acc>();
  for (const r of rows) {
    if (!isEligible(r)) continue;
    const p = extractYearMonth(r);
    if (!p || p.year !== period.year || p.month !== period.month) continue;
    const pid = r.assigned_promoter_id;
    if (!pid) continue; // sem balde/não-atribuído

    const acc = perPromoter.get(pid) ?? emptyAcc();
    const gross = toNumber(r.gross_value);
    acc.net += toNumber(r.net_value);
    acc.gross += gross;
    acc.insurance += toNumber(r.insurance_value);
    if (toNumber(r.insurance_value) > 0 || r.has_insurance) acc.insuredGross += gross;
    acc.count += 1;
    perPromoter.set(pid, acc);
  }

  // metas do período por promotor (já restritas ao time pela policy F3)
  const targetByPid = new Map<string, TargetRow>();
  for (const t of targets) {
    if (t.year === period.year && t.month === period.month) targetByPid.set(t.promoter_id, t);
  }

  // ids do time = quem produziu OU tem meta no período (ambos já são do time)
  const ids = new Set<string>([...perPromoter.keys(), ...targetByPid.keys()]);

  // nomes via service_role, só para os ids já autorizados
  const nameById = new Map<string, string>();
  if (ids.size > 0) {
    const { data: promData, error: promErr } = await admin
      .from("promoters")
      .select("id, name")
      .in("id", Array.from(ids));
    if (promErr) throw promErr;
    for (const p of (promData ?? []) as Array<{ id: string; name: string }>) {
      nameById.set(p.id, p.name);
    }
  }

  const outRows: TeamPromoterRow[] = Array.from(ids).map((pid) => {
    const acc = perPromoter.get(pid) ?? emptyAcc();
    const t = targetByPid.get(pid);
    const meta = toNumber(t?.meta);
    const meta1 = toNumber(t?.meta_1);
    const meta2 = toNumber(t?.meta_2);
    const penetration = acc.gross > 0 ? (acc.insuredGross / acc.gross) * 100 : 0;
    return {
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "—",
      production_value: acc.net,
      gross_value: acc.gross,
      proposal_count: acc.count,
      insurance_production: acc.insurance,
      insurance_penetration_percent: penetration,
      meta,
      meta_1: meta1,
      meta_2: meta2,
      target_status: resolveTargetStatus(acc.net, meta, meta1, meta2),
      attainment_percent: meta > 0 ? (acc.net / meta) * 100 : null,
    };
  });

  outRows.sort((a, b) => b.production_value - a.production_value);

  // ---- totais ----
  let tNet = 0,
    tGross = 0,
    tInsuredGross = 0,
    tInsurance = 0,
    tCount = 0,
    tMeta = 0;
  for (const acc of perPromoter.values()) {
    tNet += acc.net;
    tGross += acc.gross;
    tInsuredGross += acc.insuredGross;
    tInsurance += acc.insurance;
    tCount += acc.count;
  }
  for (const t of targetByPid.values()) tMeta += toNumber(t.meta);

  return {
    period,
    periods,
    rows: outRows,
    totals: {
      promoters: outRows.length,
      production_value: tNet,
      gross_value: tGross,
      proposal_count: tCount,
      insurance_production: tInsurance,
      insurance_penetration_percent: tGross > 0 ? (tInsuredGross / tGross) * 100 : 0,
      meta: tMeta,
      attainment_percent: tMeta > 0 ? (tNet / tMeta) * 100 : null,
    },
  };
}
