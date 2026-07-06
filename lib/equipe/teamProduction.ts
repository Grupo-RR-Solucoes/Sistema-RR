import type { SupabaseClient } from "@supabase/supabase-js";

import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { todayInFortaleza } from "@/lib/dateFortaleza";
// Primitivas de projeção — MESMA fonte que lib/projecaoMetas importa (o motor da
// Projeção por Estado). Reusadas aqui para computar a projeção IDÊNTICA sem
// reimplementar a fórmula: acumulado ÷ dias_úteis_decorridos × dias_úteis_totais,
// janela RR (productionBusinessWindow) e "hoje não conta no divisor quando aberto".
import {
  countBusinessDays,
  productionBusinessWindow,
  ymd,
} from "@/lib/trp/vigencia";

/**
 * F4 — Visão do gestor. Monta a produção/desempenho do TIME do gestor logado,
 * SEM comissão/financeiro/PII.
 *
 * Fontes (a segurança é do banco, não daqui):
 *   - vw_team_production (F3): já vem filtrada pela árvore do gestor (WHERE +
 *     helper security-definer por auth.uid()). Precisa do client ANON
 *     autenticado. 28 colunas de produção, ZERO de comissão. NÃO filtra mês —
 *     traz todas as competências; o recorte mensal é feito aqui.
 *   - monthly_targets: a policy F3 restringe as metas ao time do gestor.
 *   - nomes de promotor + supervisor_user_id: buscados via service_role SÓ para
 *     os ids que a view/metas já autorizaram (a tabela promoters não tem policy
 *     para gestor). Não há vazamento: o escopo é definido pelas fontes RLS acima.
 *
 * ENTREGA 1 (aditivo): série mensal (jan/2026→corrente) do time e por promotor,
 * projeção de fechamento do mês corrente (por promotor e total) e o
 * supervisor_id/nome de cada promotor (para a visão de dois níveis do gerente).
 *
 * METODOLOGIA (idêntica a lib/promoterAnalytics.ts, para bater com
 * Dashboard/Projeção/Promotores):
 *   - Elegível = status ∈ {PRODUCAO, PRODUCTION} E is_srcc_restricted !== true.
 *   - Competência do registro = movement_date → contract_date → proposal_date,
 *     via getProductionPeriodFromValue (janela de produção por competência).
 *   - "Realizado" = Σ net_value dos elegíveis.
 *   - Penetração de seguro = Σ gross_value(dos com seguro) / Σ gross_value(total)
 *     × 100 (share do bruto com seguro — MESMA métrica de promoterAnalytics).
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
  /** supervisor responsável (F2). Para a visão de 2 níveis do gerente. */
  supervisor_id: string | null;
  supervisor_name: string | null;
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
  /** Projeção de fechamento do mês corrente (ritmo linear, motor da Projeção). */
  projection_value: number;
}

export interface TeamPeriod {
  key: string;
  label: string;
  year: number;
  month: number;
}

/** Ponto da série mensal do time. */
export interface MonthPoint {
  year: number;
  month: number;
  label: string;
  production_value: number;
  insurance_penetration_percent: number;
}

/** Ponto da série mensal de UM promotor (inclui meta/atingimento do mês). */
export interface PromoterMonthPoint extends MonthPoint {
  meta: number;
  attainment_percent: number | null;
}

export interface PromoterMonthly {
  promoter_id: string;
  months: PromoterMonthPoint[];
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
  /** Projeção de fechamento do time no mês selecionado (Σ das projeções). */
  period_projection: { production_value: number };
  /** Série mensal agregada do time, jan/2026 → competência corrente. */
  monthlySeries: MonthPoint[];
  /** Série mensal por promotor (mesma janela). */
  perPromoterMonthly: PromoterMonthly[];
  /** Entrega 2 — meta própria do gestor (override ?? derivada) na competência. */
  gestor_meta: GestorMeta;
}

/** Meta do gestor: derivada (Σ time), override manual (nullable) e efetiva. */
export interface GestorMeta {
  derivada: number;
  override: number | null;
  efetiva: number;
}

/**
 * Resolve a meta efetiva do gestor numa competência: override (se houver linha
 * em gestor_targets para year/month) senão a meta derivada. Pura/testável.
 */
export function resolveGestorMeta(
  derivada: number,
  overrides: Array<{ year: number; month: number; meta: number }>,
  year: number,
  month: number,
): GestorMeta {
  const o = overrides.find((x) => x.year === year && x.month === month);
  const override = o ? toNumber(o.meta) : null;
  return { derivada, override, efetiva: override ?? derivada };
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

// Espelha resolveTargetStatus de promoterAnalytics (label textual de níveis).
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
function addRow(acc: Acc, r: ViewRow) {
  const gross = toNumber(r.gross_value);
  acc.net += toNumber(r.net_value);
  acc.gross += gross;
  acc.insurance += toNumber(r.insurance_value);
  if (toNumber(r.insurance_value) > 0 || r.has_insurance) acc.insuredGross += gross;
  acc.count += 1;
}
function penetration(acc: Acc): number {
  return acc.gross > 0 ? (acc.insuredGross / acc.gross) * 100 : 0;
}

/** Início da série mensal do painel (competência mais antiga exibida). */
const SERIES_START = { year: 2026, month: 1 };

/** Lista de competências de (fromY,fromM) até (toY,toM) inclusive, sem buracos. */
function monthRange(fromY: number, fromM: number, toY: number, toM: number) {
  const out: Array<{ year: number; month: number }> = [];
  let y = fromY;
  let m = fromM;
  // trava defensiva (nunca deve estourar; ~ dezenas de meses)
  for (let guard = 0; guard < 600; guard++) {
    if (y > toY || (y === toY && m > toM)) break;
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Montagem PURA do payload (sem I/O) — testável isoladamente.
 * `refDate` = "hoje" (Date UTC-midnight no fuso Fortaleza). Determina a
 * competência corrente (fim da série) e a projeção do mês selecionado.
 */
export function assembleTeamProduction(
  rows: ViewRow[],
  targets: TargetRow[],
  nameById: Map<string, string>,
  supById: Map<string, { id: string | null; name: string | null }>,
  opts: { year?: number; month?: number },
  refDate: Date,
  gestorOverrides: Array<{ year: number; month: number; meta: number }> = [],
): TeamProductionPayload {
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

  // "hoje" no fuso Fortaleza (derivado do refDate UTC-midnight).
  const nowYear = refDate.getUTCFullYear();
  const nowMonth = refDate.getUTCMonth() + 1;
  const wantYear = opts.year ?? nowYear;
  const wantMonth = opts.month ?? nowMonth;
  const period: TeamPeriod =
    periods.find((p) => p.year === wantYear && p.month === wantMonth) ?? {
      key: periodKey(wantYear, wantMonth),
      label: periodLabel(wantYear, wantMonth),
      year: wantYear,
      month: wantMonth,
    };

  // ---- projeção do mês SELECIONADO: MESMA fórmula do motor da Projeção ----
  // (não reimplementa nada; usa as primitivas de projecaoMetas/trp.vigencia).
  const { start, end, total, holidays } = productionBusinessWindow(period.year, period.month);
  const elapsedEnd = refDate < start ? null : refDate > end ? end : refDate;
  const periodoCompleto = refDate >= end;
  let diasDecorridos = elapsedEnd ? countBusinessDays(start, elapsedEnd, holidays) : 0;
  const hojeEhDiaUtil = countBusinessDays(refDate, refDate, holidays) === 1;
  // O dia corrente (não fechado) NÃO conta no divisor: a produção de hoje só
  // entra amanhã — idêntico ao Dashboard/Projeção; sem isso o divisor conta 1 a
  // mais e a projeção vem subestimada.
  if (!periodoCompleto && hojeEhDiaUtil) {
    diasDecorridos = Math.max(0, diasDecorridos - 1);
  }
  const projetar = (acum: number) =>
    periodoCompleto ? acum : diasDecorridos > 0 ? (acum / diasDecorridos) * total : 0;

  // ---- agrega produção elegível do PERÍODO selecionado, por promotor ----
  const perPromoter = new Map<string, Acc>();
  for (const r of rows) {
    if (!isEligible(r)) continue;
    const p = extractYearMonth(r);
    if (!p || p.year !== period.year || p.month !== period.month) continue;
    const pid = r.assigned_promoter_id;
    if (!pid) continue; // sem balde/não-atribuído
    const acc = perPromoter.get(pid) ?? emptyAcc();
    addRow(acc, r);
    perPromoter.set(pid, acc);
  }

  // metas do período por promotor (já restritas ao time pela policy F3)
  const targetByPid = new Map<string, TargetRow>();
  for (const t of targets) {
    if (t.year === period.year && t.month === period.month) targetByPid.set(t.promoter_id, t);
  }

  // ids do time NO PERÍODO = quem produziu OU tem meta no período
  const ids = new Set<string>([...perPromoter.keys(), ...targetByPid.keys()]);

  const outRows: TeamPromoterRow[] = Array.from(ids).map((pid) => {
    const acc = perPromoter.get(pid) ?? emptyAcc();
    const t = targetByPid.get(pid);
    const meta = toNumber(t?.meta);
    const meta1 = toNumber(t?.meta_1);
    const meta2 = toNumber(t?.meta_2);
    const sup = supById.get(pid) ?? { id: null, name: null };
    return {
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "—",
      supervisor_id: sup.id,
      supervisor_name: sup.name,
      production_value: acc.net,
      gross_value: acc.gross,
      proposal_count: acc.count,
      insurance_production: acc.insurance,
      insurance_penetration_percent: penetration(acc),
      meta,
      meta_1: meta1,
      meta_2: meta2,
      target_status: resolveTargetStatus(acc.net, meta, meta1, meta2),
      attainment_percent: meta > 0 ? (acc.net / meta) * 100 : null,
      projection_value: projetar(acc.net),
    };
  });

  outRows.sort((a, b) => b.production_value - a.production_value);

  // ---- totais do período ----
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

  // ---- série mensal do TIME (jan/2026 → corrente) ----
  // Mesmo critério do total do período (elegível + atribuído) → o ponto do mês
  // corrente da série BATE com totals.production_value (não-regressão).
  const teamByYm = new Map<string, Acc>();
  const promoByYm = new Map<string, Map<string, Acc>>();
  for (const r of rows) {
    if (!r.assigned_promoter_id) continue;
    if (!isEligible(r)) continue;
    const p = extractYearMonth(r);
    if (!p) continue;
    const k = periodKey(p.year, p.month);
    const team = teamByYm.get(k) ?? emptyAcc();
    addRow(team, r);
    teamByYm.set(k, team);

    let inner = promoByYm.get(r.assigned_promoter_id);
    if (!inner) {
      inner = new Map<string, Acc>();
      promoByYm.set(r.assigned_promoter_id, inner);
    }
    const pa = inner.get(k) ?? emptyAcc();
    addRow(pa, r);
    inner.set(k, pa);
  }

  const range = monthRange(SERIES_START.year, SERIES_START.month, nowYear, nowMonth);
  const monthlySeries: MonthPoint[] = range.map(({ year, month }) => {
    const acc = teamByYm.get(periodKey(year, month)) ?? emptyAcc();
    return {
      year,
      month,
      label: periodLabel(year, month),
      production_value: acc.net,
      insurance_penetration_percent: penetration(acc),
    };
  });

  // ---- série mensal POR PROMOTOR ----
  const targetByPidYm = new Map<string, TargetRow>();
  for (const t of targets) targetByPidYm.set(`${t.promoter_id}:${periodKey(t.year, t.month)}`, t);

  const allPromoterIds = new Set<string>([...promoByYm.keys(), ...targets.map((t) => t.promoter_id)]);
  const perPromoterMonthly: PromoterMonthly[] = Array.from(allPromoterIds).map((pid) => ({
    promoter_id: pid,
    months: range.map(({ year, month }) => {
      const acc = promoByYm.get(pid)?.get(periodKey(year, month)) ?? emptyAcc();
      const t = targetByPidYm.get(`${pid}:${periodKey(year, month)}`);
      const meta = toNumber(t?.meta);
      return {
        year,
        month,
        label: periodLabel(year, month),
        production_value: acc.net,
        insurance_penetration_percent: penetration(acc),
        meta,
        attainment_percent: meta > 0 ? (acc.net / meta) * 100 : null,
      };
    }),
  }));

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
    period_projection: { production_value: projetar(tNet) },
    monthlySeries,
    perPromoterMonthly,
    // meta_efetiva = override do gestor (se houver) senão a derivada (tMeta).
    gestor_meta: resolveGestorMeta(tMeta, gestorOverrides, period.year, period.month),
  };
}

export async function buildTeamProduction(
  db: SupabaseClient, // anon autenticado (RLS/auth.uid)
  admin: SupabaseClient, // service_role — só p/ nomes/supervisor dos ids já autorizados
  opts: { year?: number; month?: number }
): Promise<TeamProductionPayload> {
  const [viewRes, targetRes, gestorRes] = await Promise.all([
    db
      .from("vw_team_production")
      .select(
        "id, assigned_promoter_id, promoter_id, status, is_srcc_restricted, movement_date, contract_date, proposal_date, net_value, gross_value, insurance_value, has_insurance"
      ),
    db
      .from("monthly_targets")
      .select("promoter_id, year, month, meta, meta_1, meta_2"),
    // Override de meta do gestor logado. RLS (gestor_select) devolve SÓ as linhas
    // do próprio usuário. Tolerante: se a tabela ainda não existe (migration
    // manual não aplicada), cai para [] e a meta segue a derivada.
    db.from("gestor_targets").select("year, month, meta"),
  ]);

  if (viewRes.error) throw viewRes.error;
  if (targetRes.error) throw targetRes.error;

  const rows = (viewRes.data ?? []) as ViewRow[];
  const targets = (targetRes.data ?? []) as TargetRow[];
  const gestorOverrides = gestorRes.error
    ? []
    : ((gestorRes.data ?? []) as Array<{ year: number; month: number; meta: number }>);

  // ids de TODOS os promotores que aparecem (produção em qualquer mês OU meta) —
  // para resolver nome + supervisor via service_role. O escopo continua limitado
  // ao que a view/metas já autorizaram (mesmo padrão da resolução de nomes).
  const allIds = new Set<string>();
  for (const r of rows) if (r.assigned_promoter_id) allIds.add(r.assigned_promoter_id);
  for (const t of targets) allIds.add(t.promoter_id);

  const nameById = new Map<string, string>();
  const supById = new Map<string, { id: string | null; name: string | null }>();

  if (allIds.size > 0) {
    const { data: promData, error: promErr } = await admin
      .from("promoters")
      .select("id, name, supervisor_user_id")
      .in("id", Array.from(allIds));
    if (promErr) throw promErr;

    const supIds = new Set<string>();
    for (const p of (promData ?? []) as Array<{ id: string; name: string; supervisor_user_id: string | null }>) {
      nameById.set(p.id, p.name);
      supById.set(p.id, { id: p.supervisor_user_id ?? null, name: null });
      if (p.supervisor_user_id) supIds.add(p.supervisor_user_id);
    }

    if (supIds.size > 0) {
      const { data: supData, error: supErr } = await admin
        .from("app_users")
        .select("id, full_name, email")
        .in("id", Array.from(supIds));
      if (supErr) throw supErr;
      const supName = new Map<string, string>();
      for (const s of (supData ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
        supName.set(s.id, (s.full_name && s.full_name.trim()) || s.email);
      }
      for (const [pid, sv] of supById) {
        if (sv.id) supById.set(pid, { id: sv.id, name: supName.get(sv.id) ?? null });
      }
    }
  }

  const refDate = todayInFortaleza();
  return assembleTeamProduction(rows, targets, nameById, supById, opts, refDate, gestorOverrides);
}
