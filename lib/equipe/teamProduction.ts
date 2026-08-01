import type { SupabaseClient } from "@supabase/supabase-js";

import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { todayInFortaleza } from "@/lib/dateFortaleza";
// Projeção — helper CANÔNICO, o MESMO que lib/projecaoMetas usa (o motor da
// Projeção por Estado). Antes esta tela repetia a fórmula inteira aqui e a cópia
// divergiu; agora a janela RR + a aritmética de dias úteis + o ritmo linear vêm
// todos de um lugar só.
import { resolverJanelaRitmo, projetarPorRitmo } from "@/lib/janelaRitmo";
// MESMO serializador de data que a /projecao usa (lib/projecaoMetas.ts:38), para
// a janela exposta sair byte-idêntica em formato à de ProjecaoResultado.janela.
import { ymd } from "@/lib/trp/vigencia";
// Série mensal HÍBRIDA (mês corrente=daily, fechados=PMR) — helper comum com a
// /projecao. Corrige os buracos jan/fev/mar/mai (daily só tem abr+/2026).
import {
  agregarSerieGrupo,
  serieHibridaPorPromotor,
  ymKey as ymKeyHelper,
  type DailyAcc,
  type PmrPonto,
} from "@/lib/historicoMensal";
// MOV 3: o regime da competência — o MESMO enum canônico que /promotores, o
// dashboard, o relatório e o DRE usam. O /equipe era o último leitor fora do consenso.
import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
// DELTA vs mes anterior (Fase 3). calcularDelta e a UNICA fonte de calculo do
// sistema — aqui so montamos as DUAS pontas da mesma metrica e chamamos.
import {
  competenciaAnterior,
  deltaDaSerie,
  resolverJanela,
  type PontoSerie,
  type ResultadoDelta,
} from "@/lib/delta/calcularDelta";
import { nowInFortaleza } from "@/lib/dateFortaleza";

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

export type TargetStatus = "META_2" | "META_1" | "META" | "BELOW_META" | "SEM_META";

export interface TeamPromoterRow {
  promoter_id: string;
  promoter_name: string;
  /** supervisor responsável (F2). Para a visão de 2 níveis do gerente. */
  supervisor_id: string | null;
  supervisor_name: string | null;
  /**
   * ADITIVOS — atributos do promotor, resolvidos por service_role sobre ids que
   * a vw_team_production / a policy de monthly_targets JÁ autorizaram. Existem
   * para o ramo do gestor da /projecao poder agrupar por estado e rotular a
   * empresa; a tela do /equipe não os renderiza hoje e segue igual.
   */
  estado: string | null;
  company_id: string | null;
  company_name: string | null;
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
  /**
   * ADITIVO — a janela de produção que ESTA montagem já resolveu, no MESMO
   * formato que ProjecaoResultado.janela (lib/projecaoMetas.ts:146-152).
   *
   * Existe para que o ramo do gestor da /projecao NÃO reimplemente ritmo: a
   * projeção por promotor (projection_value) e a do time (period_projection) já
   * saíram de resolverJanelaRitmo/projetarPorRitmo aqui dentro. Sem expor a
   * janela, o adaptador teria de recalcular — que é exatamente a duplicação que
   * o comentário do bloco de projeção (logo abaixo) registra ter eliminado.
   *
   * Datas em ISO (YYYY-MM-DD), não Date: isto atravessa JSON.
   */
  janela: {
    inicio: string;
    fim: string;
    dias_uteis_totais: number;
    dias_uteis_decorridos: number;
    dias_uteis_ritmo: number;
  };
  /**
   * ADITIVO — regime da competência selecionada, já detectado aqui dentro
   * (periodoFechado = regime !== 'open'). Mesma razão da janela acima: o ramo do
   * gestor da /projecao precisa do booleano para a nota "competência
   * fechada/aberta" e NÃO pode redetectar regime por conta própria.
   */
  fechado: boolean;
  /** Série mensal agregada do time, jan/2026 → competência corrente. */
  monthlySeries: MonthPoint[];
  /**
   * DELTA da produção do time vs mês anterior — já calculado (Fase 3).
   * A tela renderiza via <DeltaBadge/> e NÃO refaz conta nenhuma.
   * Só produção-empresa: os demais KPIs do /equipe (% da meta, projeção) não
   * recebem delta — ver o bloco que o monta.
   */
  deltaProducao: ResultadoDelta;
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
  return "BELOW_META";
}

interface Acc {
  net: number;
  gross: number;
  insuredGross: number;
  insurance: number;
  count: number;
  // MOV 3: em mês FECHADO a penetração vem PRONTA do PMR (já ponderada RR+ADS) —
  // não há gross/insuredGross para recomputá-la, e recomputar do diário é exatamente
  // o que saiu daqui. Percentual 0-100 (convenção do /equipe). null = sem dado.
  penOverride?: number | null;
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
  if (acc.penOverride !== undefined) return acc.penOverride ?? 0;
  return acc.gross > 0 ? (acc.insuredGross / acc.gross) * 100 : 0;
}

// A janela da série (jan/2026 → corrente) e a lista de competências agora vêm do
// helper comum lib/historicoMensal.ts (SERIE_INICIO/rangeMeses), via
// serieHibridaPorPromotor. Removidos SERIES_START/monthRange locais.

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
  // Fonte dos meses FECHADOS da série (PMR). Vazio => série cai no daily (mesmo
  // comportamento anterior). Injetado por buildTeamProduction via service_role.
  pmrByPromoterYm: Map<string, Map<string, PmrPonto>> = new Map(),
  // MOV 3: regime da competência SELECIONADA. 'open' => linhas do período vêm do
  // diário (comportamento anterior). Fechado ('cms' | 'fechamento') => vêm do PMR.
  // Default 'open' preserva o comportamento de quem chamar sem o argumento.
  regime: MonthRegime = "open",
  // ADITIVOS no FIM da lista, com default vazio: os 4 gates que chamam esta
  // função posicionalmente (golden_projecao_supervisores, janela_ritmo_paridade,
  // mov3_equipe_gate, test_equipe_dashboard) param em `regime` e seguem válidos.
  // Mapas vazios => estado/empresa saem null, que é o que o /equipe já ignorava.
  estadoById: Map<string, string | null> = new Map(),
  companyIdById: Map<string, string | null> = new Map(),
  companyNameById: Map<string, string> = new Map(),
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
  // Uma linha, um lugar: resolverJanelaRitmo é o helper que a /projecao usa. A
  // cópia que existia aqui tinha DIVERGIDO em dois pontos:
  //   1. "refDate >= end" dava competência COMPLETA já no ÚLTIMO dia da janela
  //      (30/07) — a /equipe parava de extrapolar um dia antes da /projecao;
  //   2. o decremento do dia corrente era aplicado ao PRÓPRIO contador de dias
  //      decorridos, colapsando "o que se exibe" com "por quanto se divide".
  // A janela expõe os dois separados: `diasDecorridos` (exibido, HOJE INCLUÍDO)
  // e `diasParaRitmo` (o divisor, sem o dia corrente, porque a produção de hoje
  // só entra amanhã). O `projetar` abaixo divide SEMPRE por diasParaRitmo.
  // `closed` vem do REGIME (não só da data), como na /projecao: mês fechado é
  // completo mesmo que a data de referência ainda esteja dentro da janela.
  const janela = resolverJanelaRitmo(period.year, period.month, {
    closed: regime !== "open",
    referenceDate: refDate,
  });
  const projetar = (acum: number) => projetarPorRitmo(janela, acum);

  // ---- produção do PERÍODO selecionado, por promotor ----
  //
  // MOV 3 — o /equipe era o ÚLTIMO leitor fora do consenso: em mês FECHADO ele
  // recomputava do diário (vw_team_production) em vez de derivar do PMR. Diário e
  // fechamento são universos diferentes — o diário é o que o promotor lançou, o
  // fechamento é o que o banco PAGOU —, então a tela mostrava produção que o banco
  // não pagou (ex.: jun/2026, a proposta 213615547 de R$ 80.000,00 é SRCC no
  // fechamento mas vem com is_srcc_restricted=false no diário).
  //
  // FECHADO ('cms' | 'fechamento') -> deriva do PMR. ABERTO -> recomputa do diário,
  // que ali é o CERTO (o mês é provisório e o fechamento ainda não existe).
  // A condição é `!== 'open'`, NUNCA `=== 'fechamento'` (isso trataria jan-mai como
  // mês aberto).
  //
  // ESCOPO DE TIME PRESERVADO: só entram promotores que já estavam autorizados pela
  // view/metas (o mapa do PMR é buscado apenas para `allIds`). Nenhum promotor de
  // fora do time do gestor aparece por vir do PMR.
  const periodoFechado = regime !== "open";
  const perPromoter = new Map<string, Acc>();

  if (periodoFechado) {
    const pk = ymKeyHelper(period.year, period.month);
    for (const [pid, porYm] of pmrByPromoterYm) {
      const ponto = porYm.get(pk);
      if (!ponto) continue;
      const acc = emptyAcc();
      acc.net = ponto.production;
      // A penetração do mês fechado JÁ vem consolidada do PMR (e ponderada RR+ADS).
      // Não há gross/insuredGross para recomputá-la — nem deve haver: recomputar do
      // diário é justamente o que estamos tirando.
      acc.penOverride = ponto.penetracao == null ? null : ponto.penetracao * 100;
      perPromoter.set(pid, acc);
    }
  } else {
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
    const cid = companyIdById.get(pid) ?? null;
    return {
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "—",
      supervisor_id: sup.id,
      supervisor_name: sup.name,
      estado: estadoById.get(pid) ?? null,
      company_id: cid,
      company_name: cid ? companyNameById.get(cid) ?? null : null,
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
  // Penetração do GRUPO em mês fechado: não dá para usar tInsuredGross/tGross (o PMR
  // não traz gross). É a média PONDERADA pela produção — a mesma forma que o
  // dashboard usa no regime 'fechamento'.
  let penNumTot = 0,
    penDenTot = 0;
  for (const acc of perPromoter.values()) {
    tNet += acc.net;
    tGross += acc.gross;
    tInsuredGross += acc.insuredGross;
    tInsurance += acc.insurance;
    tCount += acc.count;
    penNumTot += (penetration(acc) / 100) * acc.net;
    penDenTot += acc.net;
  }
  for (const t of targetByPid.values()) tMeta += toNumber(t.meta);

  // ---- série mensal HÍBRIDA (jan/2026 → corrente) ----
  // Mês CORRENTE = daily (bate com totals.production_value — não-regressão);
  // meses FECHADOS = PMR (corrige os buracos jan/fev/mar/mai que o daily não tem).
  // daily por (promotor, competência) — só elegível + atribuído.
  const dailyByPromoterYm = new Map<string, Map<string, DailyAcc>>();
  for (const r of rows) {
    if (!r.assigned_promoter_id) continue;
    if (!isEligible(r)) continue;
    const p = extractYearMonth(r);
    if (!p) continue;
    const k = ymKeyHelper(p.year, p.month);
    let inner = dailyByPromoterYm.get(r.assigned_promoter_id);
    if (!inner) {
      inner = new Map<string, DailyAcc>();
      dailyByPromoterYm.set(r.assigned_promoter_id, inner);
    }
    const acc = inner.get(k) ?? { net: 0, gross: 0, insuredGross: 0 };
    const gross = toNumber(r.gross_value);
    acc.net += toNumber(r.net_value);
    acc.gross += gross;
    if (toNumber(r.insurance_value) > 0 || r.has_insurance) acc.insuredGross += gross;
    inner.set(k, acc);
  }

  const promoterIdsSerie = new Set<string>([
    ...dailyByPromoterYm.keys(),
    ...pmrByPromoterYm.keys(),
    ...targets.map((t) => t.promoter_id),
  ]);
  const serieByPromoter = serieHibridaPorPromotor({
    dailyByPromoterYm,
    pmrByPromoterYm,
    promoterIds: promoterIdsSerie,
    refDate,
  });

  // penetração aqui é PERCENTUAL (0-100), convenção do /equipe; o helper devolve
  // fração 0-1 → ×100.
  const grupoTeam = agregarSerieGrupo(Array.from(serieByPromoter.values()));
  const monthlySeries: MonthPoint[] = grupoTeam.map((g) => ({
    year: g.year,
    month: g.month,
    label: g.label,
    production_value: g.producao,
    insurance_penetration_percent: g.penetracao_seg == null ? 0 : g.penetracao_seg * 100,
  }));

  // ---- série mensal POR PROMOTOR ----
  const targetByPidYm = new Map<string, TargetRow>();
  for (const t of targets) targetByPidYm.set(`${t.promoter_id}:${ymKeyHelper(t.year, t.month)}`, t);

  const perPromoterMonthly: PromoterMonthly[] = Array.from(promoterIdsSerie).map((pid) => ({
    promoter_id: pid,
    months: (serieByPromoter.get(pid) ?? []).map((pt) => {
      const t = targetByPidYm.get(`${pid}:${ymKeyHelper(pt.year, pt.month)}`);
      const meta = toNumber(t?.meta);
      return {
        year: pt.year,
        month: pt.month,
        label: pt.label,
        production_value: pt.producao,
        insurance_penetration_percent: pt.penetracao_seg == null ? 0 : pt.penetracao_seg * 100,
        meta,
        attainment_percent: meta > 0 ? (pt.producao / meta) * 100 : null,
      };
    }),
  }));

  // ---- DELTA da produção do time vs mês anterior (Fase 3) ----
  // Só a PRODUÇÃO-EMPRESA ganha delta nesta tela. "% da meta" e "Projeção fim
  // do mês" ficam de fora de propósito: a primeira mistura duas partes móveis
  // (uma queda pode ser meta que subiu, não produção que caiu) e a segunda é
  // previsão, não realizado.
  //
  // Recorte por dia (mesma regra do Dashboard): competência ABERTA compara
  // 1..N contra 1..N; FECHADA compara mês-cheio. As duas pontas do recorte saem
  // da MESMA vw_team_production, com o MESMO predicado de elegibilidade e o
  // MESMO extractYearMonth — só o filtro de dia muda. Escopo de time
  // preservado: a view já vem filtrada pela árvore do gestor via RLS.
  const agoraDelta = nowInFortaleza();
  const compAtual = { year: period.year, month: period.month };
  const compAnt = competenciaAnterior(compAtual);
  const ehCorrente = period.year === agoraDelta.year && period.month === agoraDelta.month;
  // FASE 2.1 — dias-do-mes com produção lançada na competência CORRENTE, para
  // o corte virar min(hoje, último dia com dado). Mesmo predicado da soma
  // abaixo, sobre a mesma vw_team_production.
  // Só dias do MÊS-CALENDÁRIO da competência: o "dia-cabeça" herdado do mês
  // anterior (30/06 na competência de julho) tem dia-do-mês alto e viraria o
  // máximo, mascarando até onde a diária foi de fato carregada.
  const prefixoMesCorrente = `${compAtual.year}-${String(compAtual.month).padStart(2, "0")}-`;
  const diasComDadoCorrente = new Set<number>();
  for (const r of rows) {
    if (!r.assigned_promoter_id) continue;
    if (!isEligible(r)) continue;
    const p = extractYearMonth(r);
    if (!p || p.year !== compAtual.year || p.month !== compAtual.month) continue;
    const bruta = String(r.movement_date || r.contract_date || r.proposal_date || "");
    if (!bruta.startsWith(prefixoMesCorrente)) continue;
    const dia = Number(bruta.slice(8, 10));
    if (dia >= 1 && dia <= 31) diasComDadoCorrente.add(dia);
  }

  const janelaPedida = resolverJanela({
    competencia: compAtual,
    modo: !periodoFechado && ehCorrente ? "ate-dia-N" : "mes-cheio",
    dia: agoraDelta.day,
    diasComDadoNoMesCorrente: diasComDadoCorrente,
  });

  function somaTimeRecortado(comp: { year: number; month: number }, ateDia: number | null) {
    let total = 0;
    let linhas = 0;
    for (const r of rows) {
      if (!r.assigned_promoter_id) continue;
      if (!isEligible(r)) continue;
      const p = extractYearMonth(r);
      if (!p || p.year !== comp.year || p.month !== comp.month) continue;
      linhas += 1;
      if (ateDia != null) {
        const bruta = r.movement_date || r.contract_date || r.proposal_date;
        const dia = Number(String(bruta ?? "").slice(8, 10));
        if (!(dia >= 1 && dia <= ateDia)) continue;
      }
      total += toNumber(r.net_value);
    }
    return { total: Math.round(total * 100) / 100, linhas };
  }

  // Série de MÊS CHEIO: monthlySeries já é a série canônica do time (híbrida
  // daily/PMR, mesma do /projecao). É o fallback e o caminho do mês fechado.
  const serieCheia: PontoSerie[] = monthlySeries.map((m) => ({
    year: m.year,
    month: m.month,
    valor: m.production_value,
    fonte: m.year === period.year && m.month === period.month && !periodoFechado ? "daily" : "pmr",
  }));

  let deltaProducao: ResultadoDelta;
  if (janelaPedida.modo === "ate-dia-N") {
    const atual = somaTimeRecortado(compAtual, janelaPedida.diaCorteAtual);
    const anterior = somaTimeRecortado(compAnt, janelaPedida.diaCorteAnterior);
    // O recorte exige daily nas DUAS pontas (jan/fev/mar/mai de 2026 não têm).
    if (atual.linhas > 0 && anterior.linhas > 0) {
      deltaProducao = deltaDaSerie({
        serie: [
          { year: compAnt.year, month: compAnt.month, valor: anterior.total, fonte: "daily" },
          { year: compAtual.year, month: compAtual.month, valor: atual.total, fonte: "daily" },
        ],
        competencia: compAtual,
        janela: janelaPedida,
      });
    } else {
      deltaProducao = deltaDaSerie({
        serie: serieCheia,
        competencia: compAtual,
        janela: resolverJanela({
          competencia: compAtual,
          modo: "ate-dia-N",
          dia: agoraDelta.day,
          recorteIndisponivel: true,
        }),
      });
    }
  } else {
    deltaProducao = deltaDaSerie({ serie: serieCheia, competencia: compAtual });
  }

  return {
    period,
    periods,
    rows: outRows,
    deltaProducao,
    totals: {
      promoters: outRows.length,
      production_value: tNet,
      gross_value: tGross,
      proposal_count: tCount,
      insurance_production: tInsurance,
      // Mês ABERTO: Σ segurado / Σ gross (diário), como sempre. Mês FECHADO: média
      // ponderada pela produção do PMR (o PMR não tem gross).
      insurance_penetration_percent: periodoFechado
        ? penDenTot > 0
          ? (penNumTot / penDenTot) * 100
          : 0
        : tGross > 0
          ? (tInsuredGross / tGross) * 100
          : 0,
      meta: tMeta,
      attainment_percent: tMeta > 0 ? (tNet / tMeta) * 100 : null,
    },
    period_projection: { production_value: projetar(tNet) },
    // ADITIVO: a MESMA janela que projetou as linhas acima, exposta em ISO para
    // o adaptador do gestor reusar sem recalcular ritmo. Ver TeamProductionPayload.
    janela: {
      inicio: ymd(janela.start),
      fim: ymd(janela.end),
      dias_uteis_totais: janela.total,
      dias_uteis_decorridos: janela.diasDecorridos,
      dias_uteis_ritmo: janela.diasParaRitmo,
    },
    fechado: periodoFechado,
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
  const [arvoreRes, viewRes, targetRes, gestorRes] = await Promise.all([
    // A ÁRVORE CANÔNICA. security definer, resolve por auth.uid() — vai no client
    // ANON porque é a MESMA fonte que o WHERE da view usa (20260701_000003:68-95).
    db.rpc("current_user_team_promoter_ids"),
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
  // FALHA FECHADA, nunca tolerante: sem árvore não há escopo, e cair para "sem
  // filtro" reabriria exatamente o vazamento que este bloco fecha.
  if (arvoreRes.error) {
    throw new Error(`current_user_team_promoter_ids: ${arvoreRes.error.message}`);
  }

  // ESCOPO DE EXIBIÇÃO = A ÁRVORE, não o que a view devolveu.
  //
  // O WHERE da view é um OR: `assigned_promoter_id IN arvore OR promoter_id IN
  // arvore` (20260701_000003:144-145). Um contrato REATRIBUÍDO de uma rede para
  // outra continua com o promoter_id de origem, então a view o devolve ao gestor
  // de origem — e o agrupamento por assigned_promoter_id logo abaixo criava uma
  // LINHA para um promotor que não é do time dele.
  //
  // Medido em 01/08/2026, rede da Carla (10 promotores): 1 registro-ponte
  // (proposta 221184463, R$ 460,00, 29/07) de JÉSSICA, que é da rede da Izabela.
  // O dano tem DUAS magnitudes, porque as linhas do período têm duas origens:
  //   - mês ABERTO (linhas vêm do diário, via view): entra só o registro-ponte
  //     — R$ 460,00 em jul/2026. A view limita o estrago.
  //   - mês FECHADO (linhas vêm do PMR, buscado por service_role sobre allIds):
  //     entra a produção INTEIRA do forasteiro, porque essa busca não passa pela
  //     view — R$ 2.491,81 em jun/2026. É o caso GRAVE, e é o que faz o filtro
  //     precisar valer também para `allIds` e não só para `rows`.
  // Efeito colateral que some junto: a Izabela aparecia como GESTORA na tela da
  // Carla, porque o supervisor_id vinha na linha da Jéssica.
  //
  // Este é o MESMO recorte que app/api/projecao/route.ts:69-73 já aplica ao
  // caminho de PAGAMENTO desde 93c837e. Fazê-lo aqui, na fonte, é o que impede
  // pagamento e exibição de divergirem de novo — os dois consumidores de
  // `rows` (lib/projecao/gestorAdapter.ts:173 e :192) passam a herdar o recorte
  // sem precisar repeti-lo.
  const arvore = new Set(
    ((arvoreRes.data ?? []) as unknown[]).map((x) =>
      typeof x === "string"
        ? x
        : String((x as { current_user_team_promoter_ids?: string })?.current_user_team_promoter_ids ?? x)
    )
  );

  const rows = ((viewRes.data ?? []) as ViewRow[]).filter(
    (r) => r.assigned_promoter_id != null && arvore.has(r.assigned_promoter_id)
  );
  // As metas já vêm restritas à árvore pela policy monthly_targets_gestor_select
  // (20260701_000003:161-167). O filtro aqui é redundante DE PROPÓSITO: mantém a
  // invariante "nada fora da árvore atravessa esta função" verdadeira sem
  // depender de uma policy que vive noutro arquivo.
  const targets = ((targetRes.data ?? []) as TargetRow[]).filter((t) => arvore.has(t.promoter_id));
  const gestorOverrides = gestorRes.error
    ? []
    : ((gestorRes.data ?? []) as Array<{ year: number; month: number; meta: number }>);

  // ids de TODOS os promotores que aparecem (produção em qualquer mês OU meta) —
  // para resolver nome + supervisor via service_role. Como `rows` e `targets` já
  // estão recortados pela árvore, allIds ⊆ árvore por construção: é ele que
  // escopa a busca do PMR, que é service_role e NÃO passa pela view.
  const allIds = new Set<string>();
  for (const r of rows) if (r.assigned_promoter_id) allIds.add(r.assigned_promoter_id);
  for (const t of targets) allIds.add(t.promoter_id);

  const nameById = new Map<string, string>();
  const supById = new Map<string, { id: string | null; name: string | null }>();
  // ATRIBUTOS (não autorização). estado e company_id descrevem promotores cujos
  // ids JÁ vieram autorizados pela vw_team_production / policy de monthly_targets
  // — o .in(allIds) abaixo não amplia o conjunto, só descreve o que já entrou.
  // Mesma disciplina do name/supervisor_user_id acima e do PMR mais abaixo:
  // service_role resolve ATRIBUTO, nunca decide QUEM. Nenhuma das duas é coluna
  // de comissão ou PII (estado é a UF de atuação; company_id é a empresa do
  // cadastro, que a própria vw_team_production já expõe por linha).
  const estadoById = new Map<string, string | null>();
  const companyIdById = new Map<string, string | null>();
  const companyNameById = new Map<string, string>();

  if (allIds.size > 0) {
    const { data: promData, error: promErr } = await admin
      .from("promoters")
      .select("id, name, supervisor_user_id, estado, company_id")
      .in("id", Array.from(allIds));
    if (promErr) throw promErr;

    const supIds = new Set<string>();
    const companyIds = new Set<string>();
    for (const p of (promData ?? []) as Array<{
      id: string;
      name: string;
      supervisor_user_id: string | null;
      estado: string | null;
      company_id: string | null;
    }>) {
      nameById.set(p.id, p.name);
      supById.set(p.id, { id: p.supervisor_user_id ?? null, name: null });
      estadoById.set(p.id, p.estado ?? null);
      companyIdById.set(p.id, p.company_id ?? null);
      if (p.supervisor_user_id) supIds.add(p.supervisor_user_id);
      if (p.company_id) companyIds.add(p.company_id);
    }

    // Nome da empresa pelo MESMO padrão: .in() sobre os company_id que já
    // apareceram nos promotores autorizados. Não lista o cadastro de empresas —
    // resolve o rótulo das que a árvore do gestor já alcançou. Tolerante: erro
    // → mapa vazio e o consumidor cai no fallback (a tela do /equipe não
    // renderiza empresa hoje, então erro aqui não pode derrubar a resposta).
    if (companyIds.size > 0) {
      const { data: compData } = await admin
        .from("companies")
        .select("id, name")
        .in("id", Array.from(companyIds));
      for (const c of (compData ?? []) as Array<{ id: string; name: string | null }>) {
        if (c.name) companyNameById.set(c.id, c.name);
      }
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

  // PMR (production_value + penetração) — só dos ids já autorizados (mesmo escopo
  // dos nomes). Via service_role: selecionamos APENAS produção/penetração — NADA de
  // comissão. O gestor não pode ver comissão, e essas 2 colunas são tudo que a tela
  // renderiza. Tolerante: erro → cai no daily (comportamento anterior).
  //
  // MOV 3: este mapa passa a alimentar TAMBÉM as linhas do período (não só a série
  // histórica) quando a competência está FECHADA. Mesma query, mesmo client, mesmas
  // colunas — não há caminho novo.
  //
  // SOMA por (promotor, competência), NÃO overwrite: promotor com linha RR
  // (source 'fechamento') E linha ADS (source 'bbts') tem DUAS linhas no PMR. O
  // `inner.set()` anterior mantinha só a última — o mesmo truncamento que o
  // Movimento 2 matou no relatório e no DRE, vivo aqui. A penetração consolidada é
  // a média PONDERADA pela produção (não dá para somar percentuais).
  const pmrByPromoterYm = new Map<string, Map<string, PmrPonto>>();
  if (allIds.size > 0) {
    const { data: pmrData, error: pmrErr } = await admin
      .from("promoter_monthly_results")
      .select("promoter_id, year, month, production_value, insurance_penetration_percent")
      .in("promoter_id", Array.from(allIds));
    if (!pmrErr) {
      // acumuladores da ponderação: Σ(pen × prod) e Σ prod.
      const penNum = new Map<string, number>();
      const penDen = new Map<string, number>();
      for (const p of (pmrData ?? []) as Array<{
        promoter_id: string;
        year: number;
        month: number;
        production_value: number | null;
        insurance_penetration_percent: number | null;
      }>) {
        const k = ymKeyHelper(p.year, p.month);
        let inner = pmrByPromoterYm.get(p.promoter_id);
        if (!inner) {
          inner = new Map<string, PmrPonto>();
          pmrByPromoterYm.set(p.promoter_id, inner);
        }
        const prod = Number(p.production_value ?? 0) || 0;
        const pen =
          p.insurance_penetration_percent == null
            ? null
            : (Number(p.insurance_penetration_percent) || 0) / 100;

        const agg = k + "|" + p.promoter_id;
        if (pen != null) penNum.set(agg, (penNum.get(agg) ?? 0) + pen * prod);
        penDen.set(agg, (penDen.get(agg) ?? 0) + prod);

        const prev = inner.get(k);
        const den = penDen.get(agg) ?? 0;
        inner.set(k, {
          production: (prev?.production ?? 0) + prod,
          penetracao: den > 0 ? (penNum.get(agg) ?? 0) / den : prev?.penetracao ?? pen,
        });
      }
    }
  }

  // REGIME da competência selecionada — o enum canônico, o mesmo que /promotores, o
  // dashboard, o relatório e o DRE usam. Decide de ONDE vêm as linhas do período:
  // fechado => PMR (o ledger); aberto => diário (ali recomputar é o certo, o mês é
  // provisório). Tolerante: erro → 'open' (comportamento anterior).
  const refDate = todayInFortaleza();
  const selYear = opts.year ?? refDate.getUTCFullYear();
  const selMonth = opts.month ?? refDate.getUTCMonth() + 1;
  let regime: MonthRegime = "open";
  try {
    regime = await detectMonthRegime(admin, selYear, selMonth);
  } catch {
    regime = "open";
  }

  return assembleTeamProduction(
    rows,
    targets,
    nameById,
    supById,
    opts,
    refDate,
    gestorOverrides,
    pmrByPromoterYm,
    regime,
    estadoById,
    companyIdById,
    companyNameById
  );
}
