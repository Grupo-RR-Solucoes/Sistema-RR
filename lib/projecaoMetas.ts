import type { SupabaseClient } from "@supabase/supabase-js";

import { detectClosedMonth } from "@/lib/cmsMonthly";
import {
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
} from "@/lib/insuranceCalculator";
import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics";
import { fetchAllRows } from "@/lib/queryHelpers";

// ============================================================
// PAINEL DE METAS & PROJEÇÃO — motor de calculo.
// Periodo de producao (REGRA RR): do ULTIMO DIA UTIL do mes anterior ao
// PENULTIMO DIA UTIL do mes vigente. Dias uteis descontam fins de semana E
// feriados nacionais (fixos + moveis via Pascoa). Projecao = ritmo linear:
// acumulado / dias_uteis_decorridos * dias_uteis_totais.
// ============================================================

// ---------- Feriados nacionais ----------
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

// Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher), em UTC.
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marco, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Feriados NACIONAIS do ano (estaduais AL/PE ficam de backlog).
export function nationalHolidays(year: number): Set<string> {
  const s = new Set<string>();
  // Fixos
  for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"]) {
    s.add(`${year}-${md}`);
  }
  // Moveis (derivados da Pascoa)
  const easter = easterSunday(year);
  s.add(ymd(addDays(easter, -48))); // Carnaval (segunda)
  s.add(ymd(addDays(easter, -47))); // Carnaval (terca)
  s.add(ymd(addDays(easter, -2))); // Sexta-feira Santa
  s.add(ymd(addDays(easter, 60))); // Corpus Christi
  return s;
}

function holidaysForYears(...years: number[]): Set<string> {
  const s = new Set<string>();
  for (const y of new Set(years)) for (const h of nationalHolidays(y)) s.add(h);
  return s;
}

function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(ymd(d));
}

function lastBusinessDayOfMonth(year: number, month: number, holidays: Set<string>): Date {
  // dia 0 do mes seguinte = ultimo dia do mes (month aqui e 1-based).
  let d = new Date(Date.UTC(year, month, 0));
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

function penultimateBusinessDayOfMonth(year: number, month: number, holidays: Set<string>): Date {
  const last = lastBusinessDayOfMonth(year, month, holidays);
  let d = addDays(last, -1);
  while (!isBusinessDay(d, holidays)) d = addDays(d, -1);
  return d;
}

function countBusinessDays(start: Date, end: Date, holidays: Set<string>): number {
  if (end < start) return 0;
  let n = 0;
  let d = new Date(start.getTime());
  while (d <= end) {
    if (isBusinessDay(d, holidays)) n++;
    d = addDays(d, 1);
  }
  return n;
}

// Janela de producao (holiday-aware) da competencia.
export function productionBusinessWindow(year: number, month: number) {
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const holidays = holidaysForYears(prev.y, year);
  const start = lastBusinessDayOfMonth(prev.y, prev.m, holidays);
  const end = penultimateBusinessDayOfMonth(year, month, holidays);
  const total = countBusinessDays(start, end, holidays);
  return { start, end, total, holidays };
}

// ---------- Helpers de dado ----------
function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function dateKeyOf(record: { movement_date?: any; contract_date?: any; proposal_date?: any }) {
  const raw = record.movement_date || record.contract_date || record.proposal_date;
  const m = String(raw ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function isEligibleRecord(r: any): boolean {
  const st = String(r.status ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  return (st === "PRODUCAO" || st === "PRODUCTION") && r.is_srcc_restricted !== true;
}

// ---------- Tipos de saida ----------
export type Semaforo = "verde" | "amarelo" | "vermelho" | "sem_meta";
export type Tendencia = "crescimento" | "queda" | "estavel" | "sem_historico";

export type ProjecaoPromotor = {
  promoter_id: string;
  promoter_name: string;
  company_id: string;
  company_name: string;
  company_cnpj: string;
  producao_acumulada: number;
  dias_uteis_decorridos: number;
  dias_uteis_totais: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null; // ratio (0.84 = 84%); null = sem meta
  media_3m: number;
  tendencia: Tendencia;
  tendencia_percent: number | null; // ratio de variacao vs media 3m
  semaforo: Semaforo;
  // ---- Seguro EMPRESA (ganho do grupo, §188): aberto=Σ daily por registro;
  // fechado=0 (sem empresa por-promotor no fechado — o GRUPO usa fechamento_mensal_
  // empresa.valor_seguro na rota). Alimenta o KPI de grupo da EquipeView.
  seguro_comissao_acumulada: number;
  seguro_comissao_projecao: number;
  // ---- Seguro SHARE do promotor (repasse): fechado=PMR.insurance_commission_value;
  // aberto=empresa(§188) × share_scale(penetracao). Alimenta a PromotorView.
  seguro_share_acumulada: number;
  seguro_share_projecao: number;
  seguro_penetracao: number | null; // fracao 0-1, ATUAL (nao projetada); null = sem base
};

// Produção em chave MASTER ainda sem promotor (não entra em nenhum promotor
// individual; só no consolidado do grupo / linha por CNPJ).
export type NaoAtribuidoTotais = {
  acumulada: number;
  projecao: number;
  count: number;
};
export type NaoAtribuidoCnpj = NaoAtribuidoTotais & {
  company_id: string;
  company_name: string;
  company_cnpj: string;
};
export type NaoAtribuido = {
  total: NaoAtribuidoTotais;
  porCnpj: Record<string, NaoAtribuidoCnpj>;
};

export type ProjecaoResultado = {
  year: number;
  month: number;
  referenceDate: string;
  fechado: boolean;
  janela: {
    inicio: string;
    fim: string;
    dias_uteis_totais: number;
    dias_uteis_decorridos: number;
  };
  promotores: ProjecaoPromotor[];
  naoAtribuido: NaoAtribuido;
};

export function semaforoFromPercent(percent: number | null): Semaforo {
  if (percent === null) return "sem_meta";
  if (percent >= 1) return "verde";
  if (percent >= 0.8) return "amarelo";
  return "vermelho";
}

// ---------- Motor ----------
export async function buildProjecaoMetas(
  supabase: SupabaseClient,
  input: { year: number; month: number; companyId?: string; referenceDate?: Date }
): Promise<ProjecaoResultado> {
  const { year, month } = input;
  const refDate = input.referenceDate
    ? new Date(Date.UTC(input.referenceDate.getUTCFullYear(), input.referenceDate.getUTCMonth(), input.referenceDate.getUTCDate()))
    : (() => {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      })();

  const [base, closed, allPmr, shareTiers] = await Promise.all([
    loadPromoterAnalyticsBase(supabase, { year, month, companyId: input.companyId }),
    detectClosedMonth(supabase, year, month).catch(() => false),
    fetchAllRows<{ promoter_id: string; year: number; month: number; production_value: number }>(
      () => supabase.from("promoter_monthly_results").select("promoter_id, year, month, production_value")
    ),
    // Scale SEGURO_SLIP_MAIO_2026 — share do promotor sobre a comissao-empresa.
    fetchInsuranceSlipTiers(supabase),
  ]);

  const { start, end, total, holidays } = productionBusinessWindow(year, month);
  const refKey = ymd(refDate);
  const startKey = ymd(start);
  const elapsedEnd = refDate < start ? null : refDate > end ? end : refDate;
  const diasDecorridos = elapsedEnd ? countBusinessDays(start, elapsedEnd, holidays) : 0;
  const periodoCompleto = closed || refDate >= end;

  // Media dos 3 meses anteriores (production_value do PMR).
  const priors = [1, 2, 3].map((k) => {
    const dt = new Date(Date.UTC(year, month - 1 - k, 1));
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
  });
  const priorByPromoter = new Map<string, number[]>();
  for (const row of allPmr) {
    const key = `${row.year}-${pad2(row.month)}`;
    if (!priors.includes(key)) continue;
    const arr = priorByPromoter.get(row.promoter_id) || [];
    arr.push(toNumber(row.production_value));
    priorByPromoter.set(row.promoter_id, arr);
  }

  // Acumulado por promotor (mes aberto: records elegiveis ate refDate; fechado: production_value).
  // Seguro segue o MESMO recorte: soma insurance_commission_amount por registro
  // (DB-driven; o mesmo valor que filteredSummaryRows.insurance_commission_value
  // agrega no ramo LIVE_BASE) dos MESMOS registros elegiveis ate refKey.
  const acumPorPromotor = new Map<string, number>();
  const acumSeguroPorPromotor = new Map<string, number>();
  if (!closed) {
    for (const rec of base.recordsForPeriod as any[]) {
      if (!rec.assigned_promoter_id) continue;
      if (!isEligibleRecord(rec)) continue;
      const dk = dateKeyOf(rec);
      if (dk && dk > refKey) continue; // ainda nao "entrou" ate hoje
      if (dk && dk < startKey) continue; // fora da janela (defensivo)
      acumPorPromotor.set(
        rec.assigned_promoter_id,
        (acumPorPromotor.get(rec.assigned_promoter_id) || 0) + toNumber(rec.net_value)
      );
      acumSeguroPorPromotor.set(
        rec.assigned_promoter_id,
        (acumSeguroPorPromotor.get(rec.assigned_promoter_id) || 0) +
          toNumber(rec.insurance_commission_amount)
      );
    }
  }

  // Produção em chave MASTER ainda sem promotor (assigned_promoter_id null).
  // MESMA fonte/criterio do Dashboard (PRODUCAO + valido, janela de vigencia,
  // recorte por refDate): so o CONSOLIDADO do grupo e a linha do CNPJ a
  // recebem; NENHUM promotor individual. Mes fechado => vazio (cms ja
  // atribuiu tudo). Bate ao centavo com a "Producao do grupo" do Dashboard.
  const masterAcumByCompany = new Map<string, number>();
  const masterCountByCompany = new Map<string, number>();
  let masterAcumTotal = 0;
  let masterCountTotal = 0;
  if (!closed) {
    for (const rec of base.recordsForPeriod as any[]) {
      if (rec.assigned_promoter_id) continue;
      if (!isEligibleRecord(rec)) continue;
      if (!rec.company_id) continue;
      const dk = dateKeyOf(rec);
      if (dk && dk > refKey) continue;
      if (dk && dk < startKey) continue;
      const net = toNumber(rec.net_value);
      masterAcumByCompany.set(rec.company_id, (masterAcumByCompany.get(rec.company_id) || 0) + net);
      masterCountByCompany.set(rec.company_id, (masterCountByCompany.get(rec.company_id) || 0) + 1);
      masterAcumTotal += net;
      masterCountTotal += 1;
    }
  }

  // Projeção do master pela MESMA regra de ritmo linear dos promotores.
  const projetarMaster = (acum: number) =>
    periodoCompleto ? acum : diasDecorridos > 0 ? (acum / diasDecorridos) * total : 0;

  const companyInfo = new Map<string, { name: string; cnpj: string }>(
    ((base.companies as any[]) || []).map((c) => [c.id, { name: c.name, cnpj: c.cnpj }])
  );
  const naoAtribuidoPorCnpj: Record<string, NaoAtribuidoCnpj> = {};
  for (const [cid, acum] of masterAcumByCompany) {
    const info = companyInfo.get(cid);
    naoAtribuidoPorCnpj[cid] = {
      company_id: cid,
      company_name: info?.name || "—",
      company_cnpj: info?.cnpj || "",
      acumulada: acum,
      projecao: projetarMaster(acum),
      count: masterCountByCompany.get(cid) || 0,
    };
  }
  const naoAtribuido: NaoAtribuido = {
    total: {
      acumulada: masterAcumTotal,
      projecao: projetarMaster(masterAcumTotal),
      count: masterCountTotal,
    },
    porCnpj: naoAtribuidoPorCnpj,
  };

  const active = base.filteredSummaryRows.filter((row) => row.active);
  const promotores: ProjecaoPromotor[] = active.map((row) => {
    const acumulada = closed
      ? toNumber(row.production_value)
      : toNumber(acumPorPromotor.get(row.promoter_id));

    const projecao = periodoCompleto
      ? acumulada
      : diasDecorridos > 0
        ? (acumulada / diasDecorridos) * total
        : 0;

    // Penetracao ATUAL (fracao 0-1), NAO projetada. insurance_penetration_percent
    // ja vem pronto em summaryRows (fechado=PMR, aberto=insuredGross/gross).
    // Sem base de producao => sem penetracao (null).
    const seguroPenetracao =
      acumulada > 0 || toNumber(row.production_value) > 0
        ? toNumber(row.insurance_penetration_percent) / 100
        : null;

    // EMPRESA (§188): aberto=Σ daily por registro (acumSeguroPorPromotor); fechado=0
    // (acumSeguroPorPromotor so e populado no aberto). O total-empresa do GRUPO no
    // fechado vem de fechamento_mensal_empresa.valor_seguro na rota, nao da soma aqui.
    const seguroEmpresaAcum = toNumber(acumSeguroPorPromotor.get(row.promoter_id));
    const seguroEmpresaProj = periodoCompleto
      ? seguroEmpresaAcum
      : diasDecorridos > 0
        ? (seguroEmpresaAcum / diasDecorridos) * total
        : 0;

    // SHARE do promotor (repasse): fechado=PMR (share gravado); aberto=empresa(§188)
    // × share_scale(penetracao) — MESMA logica do motor (validado: reproduz o PMR).
    const seguroShareAcum = closed
      ? toNumber(row.insurance_commission_value)
      : seguroEmpresaAcum * lookupInsuranceShareFromPenetration(shareTiers, seguroPenetracao ?? 0);
    const seguroShareProj = periodoCompleto
      ? seguroShareAcum
      : diasDecorridos > 0
        ? (seguroShareAcum / diasDecorridos) * total
        : 0;

    const meta = toNumber(row.target_value);
    const percent = meta > 0 ? projecao / meta : null;

    const priorVals = priorByPromoter.get(row.promoter_id) || [];
    const media3m =
      priorVals.length > 0 ? priorVals.reduce((s, v) => s + v, 0) / priorVals.length : 0;
    let tendencia: Tendencia = "sem_historico";
    let tendenciaPercent: number | null = null;
    if (media3m > 0) {
      const vari = (projecao - media3m) / media3m;
      tendenciaPercent = vari;
      tendencia = vari > 0.001 ? "crescimento" : vari < -0.001 ? "queda" : "estavel";
    }

    return {
      promoter_id: row.promoter_id,
      promoter_name: row.promoter_name,
      company_id: row.company_id || "",
      company_name: row.company_name || "-",
      company_cnpj: row.company_cnpj || "",
      producao_acumulada: acumulada,
      dias_uteis_decorridos: diasDecorridos,
      dias_uteis_totais: total,
      projecao,
      meta,
      percent_projetado: percent,
      media_3m: media3m,
      tendencia,
      tendencia_percent: tendenciaPercent,
      semaforo: semaforoFromPercent(percent),
      seguro_comissao_acumulada: seguroEmpresaAcum,
      seguro_comissao_projecao: seguroEmpresaProj,
      seguro_share_acumulada: seguroShareAcum,
      seguro_share_projecao: seguroShareProj,
      seguro_penetracao: seguroPenetracao,
    };
  });

  return {
    year,
    month,
    referenceDate: refKey,
    fechado: closed,
    janela: {
      inicio: startKey,
      fim: ymd(end),
      dias_uteis_totais: total,
      dias_uteis_decorridos: diasDecorridos,
    },
    promotores,
    naoAtribuido,
  };
}

// ---------- Consolidacao (grupo / por CNPJ) p/ a tela de equipe ----------
export type ProjecaoGrupoTotais = {
  producao_acumulada: number;
  projecao: number;
  meta: number;
  percent_projetado: number | null;
  semaforo: Semaforo;
  seguro_comissao_acumulada: number;
  seguro_comissao_projecao: number;
  seguro_penetracao: number | null; // PONDERADA: Σ insured / Σ producao do grupo/cnpj
};
export type ProjecaoGrupoCnpj = ProjecaoGrupoTotais & {
  company_id: string;
  company_name: string;
  company_cnpj: string;
  promotores: ProjecaoPromotor[];
  // Linha "não atribuído (chave master)" do CNPJ. NÃO entra no header
  // projecao/meta/%/semaforo do grupo (esses ficam = só promotores); é uma
  // linha visível adicional para o total bater com o consolidado.
  nao_atribuido?: NaoAtribuidoTotais | null;
};

export type ProjecaoConsolidadoGrupo = ProjecaoGrupoTotais & {
  nao_atribuido: NaoAtribuidoTotais;
};

function totaliza(promotores: ProjecaoPromotor[]): ProjecaoGrupoTotais {
  const acc = { producao_acumulada: 0, projecao: 0, meta: 0 };
  let seguroAcum = 0;
  let seguroProj = 0;
  // Penetracao PONDERADA: numerador = Σ(penetracao_i × producao_i) = Σ insured_i;
  // denominador = Σ producao_i (so promotores com penetracao e producao). NAO media simples.
  let penNum = 0;
  let penDen = 0;
  for (const p of promotores) {
    acc.producao_acumulada += p.producao_acumulada;
    acc.projecao += p.projecao;
    acc.meta += p.meta;
    seguroAcum += p.seguro_comissao_acumulada;
    seguroProj += p.seguro_comissao_projecao;
    if (p.seguro_penetracao != null && p.producao_acumulada > 0) {
      penNum += p.seguro_penetracao * p.producao_acumulada;
      penDen += p.producao_acumulada;
    }
  }
  const percent = acc.meta > 0 ? acc.projecao / acc.meta : null;
  return {
    ...acc,
    percent_projetado: percent,
    semaforo: semaforoFromPercent(percent),
    seguro_comissao_acumulada: seguroAcum,
    seguro_comissao_projecao: seguroProj,
    seguro_penetracao: penDen > 0 ? penNum / penDen : null,
  };
}

// Consolidado do grupo SÓ com produção atribuída (promotores). Usado pelo
// Dashboard (alerta de projeção) — comportamento preservado, NÃO inclui master.
export function consolidarGrupo(res: ProjecaoResultado): ProjecaoGrupoTotais {
  return totaliza(res.promotores);
}

// Consolidado do grupo para a VISÃO EQUIPE da /projecao: inclui a produção em
// chave master (não atribuída) no acumulado E na projeção do grupo (item 2: a
// projeção recalcula a partir do acumulado maior). Meta inalterada (master não
// tem meta). Bate ao centavo com a "Produção do grupo" do Dashboard.
export function consolidarGrupoEquipe(res: ProjecaoResultado): ProjecaoConsolidadoGrupo {
  const base = totaliza(res.promotores);
  const na = res.naoAtribuido?.total ?? { acumulada: 0, projecao: 0, count: 0 };
  const producao_acumulada = base.producao_acumulada + na.acumulada;
  const projecao = base.projecao + na.projecao;
  const meta = base.meta;
  const percent = meta > 0 ? projecao / meta : null;
  return {
    producao_acumulada,
    projecao,
    meta,
    percent_projetado: percent,
    semaforo: semaforoFromPercent(percent),
    // Seguro = so promotores (chave master nao tem comissao de seguro atribuida).
    seguro_comissao_acumulada: base.seguro_comissao_acumulada,
    seguro_comissao_projecao: base.seguro_comissao_projecao,
    seguro_penetracao: base.seguro_penetracao,
    nao_atribuido: na,
  };
}

export function agruparPorCnpj(res: ProjecaoResultado): ProjecaoGrupoCnpj[] {
  const map = new Map<string, ProjecaoPromotor[]>();
  for (const p of res.promotores) {
    const key = p.company_id || p.company_cnpj || "—";
    const arr = map.get(key) || [];
    arr.push(p);
    map.set(key, arr);
  }
  const groups: ProjecaoGrupoCnpj[] = Array.from(map.values()).map((promotores) => {
    const t = totaliza(promotores);
    const ref = promotores[0];
    // header (projecao/meta/%/semaforo) = SO promotores — inalterado. A linha
    // "nao atribuido" entra como linha visivel adicional, nao no header.
    return {
      company_id: ref.company_id,
      company_name: ref.company_name,
      company_cnpj: ref.company_cnpj,
      promotores,
      nao_atribuido: res.naoAtribuido?.porCnpj?.[ref.company_id || ""] ?? null,
      ...t,
    };
  });

  // CNPJ que só tem produção em master (sem promotor ativo) ainda precisa
  // aparecer para o total do grupo bater com a soma das partes visíveis.
  const present = new Set(groups.map((g) => g.company_id));
  for (const na of Object.values(res.naoAtribuido?.porCnpj ?? {})) {
    if (na.acumulada <= 0 || present.has(na.company_id)) continue;
    groups.push({
      company_id: na.company_id,
      company_name: na.company_name,
      company_cnpj: na.company_cnpj,
      promotores: [],
      nao_atribuido: na,
      producao_acumulada: 0,
      projecao: 0,
      meta: 0,
      percent_projetado: null,
      semaforo: "sem_meta",
      seguro_comissao_acumulada: 0,
      seguro_comissao_projecao: 0,
      seguro_penetracao: null,
    });
  }
  // grupos com pior % projetado primeiro (puxando o grupo pra baixo no topo da atencao);
  // sem meta vao pro fim.
  groups.sort((a, b) => {
    const pa = a.percent_projetado ?? Infinity;
    const pb = b.percent_projetado ?? Infinity;
    return pa - pb;
  });
  return groups;
}

// Promotores em VERMELHO (projecao < 80% da meta), do pior pro melhor.
export function promotoresEmRisco(res: ProjecaoResultado): ProjecaoPromotor[] {
  return res.promotores
    .filter((p) => p.semaforo === "vermelho")
    .sort((a, b) => (a.percent_projetado ?? 0) - (b.percent_projetado ?? 0));
}
