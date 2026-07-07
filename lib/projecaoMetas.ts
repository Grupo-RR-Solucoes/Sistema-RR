import type { SupabaseClient } from "@supabase/supabase-js";

import { detectClosedMonth } from "@/lib/cmsMonthly";
import { todayInFortaleza } from "@/lib/dateFortaleza";
import {
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
} from "@/lib/insuranceCalculator";
import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { fetchAllRows } from "@/lib/queryHelpers";

// ============================================================
// PAINEL DE METAS & PROJEÇÃO — motor de calculo.
// Periodo de producao (REGRA RR): do ULTIMO DIA UTIL do mes anterior ao
// PENULTIMO DIA UTIL do mes vigente. Dias uteis descontam fins de semana E
// feriados nacionais (fixos + moveis via Pascoa). Projecao = ritmo linear:
// acumulado / dias_uteis_decorridos * dias_uteis_totais.
// ============================================================

// ---------- Feriados nacionais / janela de produção ----------
// O cálculo holiday-aware (calendário bancário nacional) foi extraído VERBATIM
// para lib/trp/vigencia.ts para ser reusável fora do painel (Fase 2 TRP
// self-service: resolvedor DB + seed). Aqui só re-importamos e re-exportamos —
// MESMA função, um único lugar. Comportamento inalterado.
import {
  countBusinessDays,
  productionBusinessWindow,
  ymd,
} from "@/lib/trp/vigencia";

// Re-export da API pública que outros módulos importam de "@/lib/projecaoMetas".
export {
  easterSunday,
  nationalHolidays,
  productionBusinessWindow,
} from "@/lib/trp/vigencia";

function pad2(n: number) {
  return String(n).padStart(2, "0");
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

// Estado gerencial do promotor (dimensao da hierarquia, ver migration
// 20260704_000001). Fonte do agrupamento da /projecao. null = "nao classificado".
export type Estado = "AL" | "SE" | "PE" | "BA";

export type ProjecaoPromotor = {
  promoter_id: string;
  promoter_name: string;
  company_id: string;
  company_name: string;
  company_cnpj: string;
  estado: Estado | null;
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
  // ADITIVO (drill-down histórico) — série mensal jan/2026→corrente por promotor
  // e por estado. Opcionais: só a visão-equipe da /projecao os popula; nenhum
  // consumidor do mês corrente (dashboard/consolidado/grupos) depende deles.
  perPromoterMonthly?: PromotorHistorico[];
  perEstadoMonthly?: EstadoHistorico[];
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
  // "Hoje" (refDate) no fuso America/Fortaleza por padrão, NÃO UTC: driva refKey
  // (recorte do acumulado) e diasDecorridos (a contagem "N/total"). Em UTC, às
  // 21h BRT o dia já virava o seguinte e contava 1 dia útil a mais. Chamador
  // pode sobrescrever via input.referenceDate (mantido).
  const refDate = input.referenceDate
    ? new Date(Date.UTC(input.referenceDate.getUTCFullYear(), input.referenceDate.getUTCMonth(), input.referenceDate.getUTCDate()))
    : todayInFortaleza();

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
  const periodoCompleto = closed || refDate >= end;
  // Dias uteis DECORRIDOS = dias COMPLETOS. O dia corrente (nao-fechado) NAO conta
  // no divisor: a producao de hoje so entra amanha (mesmo principio do Dashboard;
  // sem isso o divisor conta 1 a mais e a projecao vem subestimada). Subtrai SO com
  // o periodo ABERTO e hoje sendo dia util (fim de semana/feriado ja nao contam).
  // countBusinessDays e inclusivo nas duas pontas; reusa a fn (== 1) para "hoje e
  // dia util" em vez de exportar um isBusinessDay novo. NAO toca o numerador
  // (acumPorPromotor), preservando a paridade com a "Producao do grupo" do Dashboard.
  let diasDecorridos = elapsedEnd ? countBusinessDays(start, elapsedEnd, holidays) : 0;
  const hojeEhDiaUtil = countBusinessDays(refDate, refDate, holidays) === 1;
  if (!periodoCompleto && hojeEhDiaUtil) {
    diasDecorridos = Math.max(0, diasDecorridos - 1);
  }

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
      estado: asEstado(row.estado),
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

  // ADITIVO — série histórica mensal (jan/2026→corrente) a partir do daily JÁ
  // carregado (base.records = todos os meses). NÃO recalcula o mês corrente: só
  // agrega ao lado. Fim da série = refDate (competência corrente), independente
  // da competência selecionada. Master (assigned_promoter_id NULL / is_master)
  // fica FORA — mesma regra do /equipe.
  const { perPromoterMonthly, perEstadoMonthly } = agregarHistoricoMensal({
    records: (base.records as HistoricoRecord[]) ?? [],
    promoters: (base.promoters as HistoricoPromoter[]) ?? [],
    targets: (base.targets as HistoricoTarget[]) ?? [],
    companies: (base.companies as HistoricoCompany[]) ?? [],
    refDate,
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
    perPromoterMonthly,
    perEstadoMonthly,
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

// ---------- Agrupamento por ESTADO (dimensao gerencial) — sub-PR 3 ----------
// Espelha agruparPorCnpj, mas particiona por promoter.estado. TOTAL INVARIANTE:
// re-particiona os MESMOS promotores + o MESMO master, so muda o bucket (a soma
// nao muda). Meta por estado = soma dos target_value dos promotores (derivada).

/** Narrowing seguro: string do banco -> Estado | null (o CHECK garante o dominio). */
function asEstado(v: unknown): Estado | null {
  return v === "AL" || v === "SE" || v === "PE" || v === "BA" ? v : null;
}
/** Estado IMPLICITO pela empresa-operacao (nome). SO para bucketar o master. AL/PE. */
function estadoDaEmpresa(companyName: string | null | undefined): Estado | null {
  const n = String(companyName ?? "").toUpperCase();
  if (n.includes("ALAGOAS")) return "AL";
  if (n.includes("PERNAMBUCO")) return "PE";
  return null;
}
const ESTADO_LABEL: Record<Estado, string> = {
  AL: "Alagoas",
  SE: "Sergipe",
  PE: "Pernambuco",
  BA: "Bahia",
};
const ESTADO_ORDEM: Estado[] = ["AL", "SE", "PE", "BA"];

export type ProjecaoGrupoEstado = ProjecaoGrupoTotais & {
  estado: Estado | null; // null = "Nao classificado"
  estado_label: string;
  promotores: ProjecaoPromotor[];
  // Producao em chave master (nao atribuida a promotor) da empresa-operacao daquele
  // estado. Conceito SEPARADO do promotor sem estado. NAO entra no header (so
  // promotores); linha visivel adicional p/ o total bater com o consolidado.
  nao_atribuido?: NaoAtribuidoTotais | null;
};

export function agruparPorEstado(res: ProjecaoResultado): ProjecaoGrupoEstado[] {
  const NULO = "__NULL__";
  // 1) promotores por estado (null -> NULO).
  const porEstado = new Map<string, ProjecaoPromotor[]>();
  for (const p of res.promotores) {
    const key = p.estado ?? NULO;
    const arr = porEstado.get(key) || [];
    arr.push(p);
    porEstado.set(key, arr);
  }
  // 2) master (naoAtribuido.porCnpj) por estado da empresa-operacao. Preserva a soma
  //    total do master (empresas sao AL/PE; empresa nao mapeada -> NULO).
  const masterPorEstado = new Map<string, NaoAtribuidoTotais>();
  for (const na of Object.values(res.naoAtribuido?.porCnpj ?? {})) {
    const key = estadoDaEmpresa(na.company_name) ?? NULO;
    const cur = masterPorEstado.get(key) ?? { acumulada: 0, projecao: 0, count: 0 };
    masterPorEstado.set(key, {
      acumulada: cur.acumulada + na.acumulada,
      projecao: cur.projecao + na.projecao,
      count: cur.count + na.count,
    });
  }
  // 3) monta na ORDEM fixa AL, SE, PE, BA e "Nao classificado" por ultimo.
  const grupos: ProjecaoGrupoEstado[] = [];
  const push = (estado: Estado | null, key: string) => {
    const promotores = porEstado.get(key) ?? [];
    const master = masterPorEstado.get(key) ?? null;
    const masterVisivel = master && (master.acumulada > 0 || master.count > 0) ? master : null;
    // so aparece se houver promotor OU master com producao ("Nao classificado" so
    // surge quando existir promotor sem estado ou master de empresa nao mapeada).
    if (promotores.length === 0 && !masterVisivel) return;
    grupos.push({
      estado,
      estado_label: estado ? ESTADO_LABEL[estado] : "Não classificado",
      promotores,
      nao_atribuido: masterVisivel,
      ...totaliza(promotores),
    });
  };
  for (const e of ESTADO_ORDEM) push(e, e);
  push(null, NULO);
  return grupos;
}

// Promotores em VERMELHO (projecao < 80% da meta), do pior pro melhor.
export function promotoresEmRisco(res: ProjecaoResultado): ProjecaoPromotor[] {
  return res.promotores
    .filter((p) => p.semaforo === "vermelho")
    .sort((a, b) => (a.percent_projetado ?? 0) - (b.percent_projetado ?? 0));
}

// ============================================================
// DRILL-DOWN HISTÓRICO (ADITIVO) — série mensal jan/2026 → corrente, por PROMOTOR
// e por ESTADO. Função PURA (sem I/O), espelhando EXATAMENTE a metodologia do
// /equipe (lib/equipe/teamProduction.ts): elegível = PRODUCAO/PRODUCTION E
// !SRCC; competência do registro via getProductionPeriodFromValue (movement →
// contract → proposal); "realizado" = Σ net_value; penetração = Σ gross(c/ seg)
// / Σ gross. Master (assigned_promoter_id NULL ou promotor is_master) FICA FORA
// — sempre redistribuída, nunca entra no histórico. Estado = promoters.estado
// ATUAL aplicado a toda a série (não há estado histórico por mês).
// NÃO recalcula o mês corrente: a projeção/consolidado/grupos/semáforo ficam
// intactos; esta série é lateral.
// ============================================================

export type HistoricoMesPromotor = {
  year: number;
  month: number;
  label: string; // "jan/26"
  producao: number; // Σ net_value elegível (assigned, não-master)
  penetracao_seg: number | null; // fração 0-1 (null = sem base bruta no mês)
  meta: number; // monthly_targets.meta do mês (0 = sem meta)
  percent: number | null; // ratio producao/meta (null = sem meta)
};
export type PromotorHistorico = {
  promoter_id: string;
  promoter_name: string;
  estado: Estado | null;
  company_id: string;
  company_name: string;
  meses: HistoricoMesPromotor[];
};
export type HistoricoMesEstado = {
  year: number;
  month: number;
  label: string;
  producao: number;
  penetracao_seg: number | null;
};
export type EstadoHistorico = {
  estado: Estado | null;
  estado_label: string;
  promotor_count: number;
  meses: HistoricoMesEstado[];
};

// Subsets mínimos (o que a agregação lê). Espelham daily_production_records /
// promoters / monthly_targets / companies.
type HistoricoRecord = {
  assigned_promoter_id?: string | null;
  status?: string | null;
  is_srcc_restricted?: boolean | null;
  movement_date?: string | null;
  contract_date?: string | null;
  proposal_date?: string | null;
  net_value?: number | null;
  gross_value?: number | null;
  insurance_value?: number | null;
  has_insurance?: boolean | null;
};
type HistoricoPromoter = {
  id: string;
  name: string;
  company_id?: string | null;
  estado?: unknown;
  is_master?: boolean | null;
};
type HistoricoTarget = { promoter_id: string; year: number; month: number; meta?: number | null };
type HistoricoCompany = { id: string; name?: string | null };

// Acumulador por (promotor|estado, competência). Só produção/bruto/seguro-bruto.
type AccHist = { net: number; gross: number; insuredGross: number };
function emptyAccHist(): AccHist {
  return { net: 0, gross: 0, insuredGross: 0 };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
const SERIES_START_HIST = { year: 2026, month: 1 };
const MESES_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function ymKeyHist(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}
function labelHist(year: number, month: number): string {
  return `${MESES_ABBR[month - 1]}/${String(year).slice(-2)}`;
}
// Competências de (fromY,fromM) até (toY,toM) inclusive, sem buracos — igual ao
// monthRange do teamProduction.ts.
function monthRangeHist(fromY: number, fromM: number, toY: number, toM: number) {
  const out: Array<{ year: number; month: number }> = [];
  let y = fromY;
  let m = fromM;
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
// Competência do registro: mesma cascata e primitiva do /equipe.
function competenciaDoRegistro(r: HistoricoRecord): { year: number; month: number } | null {
  return (
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date)
  );
}
function penetracaoDe(acc: AccHist): number | null {
  return acc.gross > 0 ? acc.insuredGross / acc.gross : null;
}

export function agregarHistoricoMensal(input: {
  records: HistoricoRecord[];
  promoters: HistoricoPromoter[];
  targets: HistoricoTarget[];
  companies: HistoricoCompany[];
  refDate: Date;
}): { perPromoterMonthly: PromotorHistorico[]; perEstadoMonthly: EstadoHistorico[] } {
  const { records, promoters, targets, companies, refDate } = input;

  const companyNameById = new Map(companies.map((c) => [c.id, c.name ?? "—"]));
  const promoInfo = new Map<
    string,
    { name: string; estado: Estado | null; company_id: string; company_name: string; is_master: boolean }
  >();
  for (const pr of promoters) {
    promoInfo.set(pr.id, {
      name: pr.name,
      estado: asEstado(pr.estado),
      company_id: pr.company_id || "",
      company_name: companyNameById.get(pr.company_id || "") || "—",
      is_master: pr.is_master === true,
    });
  }

  // (promoter_id) -> (ymKey) -> AccHist. Master/desconhecido FORA.
  const byPromoterYm = new Map<string, Map<string, AccHist>>();
  for (const r of records) {
    const pid = r.assigned_promoter_id;
    if (!pid) continue; // chave master (NULL) — sempre redistribuída, fora
    const info = promoInfo.get(pid);
    if (!info || info.is_master) continue; // promotor is_master ou desconhecido — fora
    if (!isEligibleRecord(r)) continue;
    const comp = competenciaDoRegistro(r);
    if (!comp) continue;
    const k = ymKeyHist(comp.year, comp.month);
    let inner = byPromoterYm.get(pid);
    if (!inner) {
      inner = new Map<string, AccHist>();
      byPromoterYm.set(pid, inner);
    }
    const acc = inner.get(k) ?? emptyAccHist();
    const gross = toNumber(r.gross_value);
    acc.net += toNumber(r.net_value);
    acc.gross += gross;
    if (toNumber(r.insurance_value) > 0 || r.has_insurance) acc.insuredGross += gross;
    inner.set(k, acc);
  }

  const metaByPidYm = new Map<string, number>();
  for (const t of targets) metaByPidYm.set(`${t.promoter_id}:${ymKeyHist(t.year, t.month)}`, toNumber(t.meta));

  const range = monthRangeHist(
    SERIES_START_HIST.year,
    SERIES_START_HIST.month,
    refDate.getUTCFullYear(),
    refDate.getUTCMonth() + 1
  );

  // ---- série por PROMOTOR (todo promotor com produção OU meta na janela) ----
  const pids = new Set<string>([...byPromoterYm.keys(), ...targets.map((t) => t.promoter_id)]);
  const perPromoterMonthly: PromotorHistorico[] = Array.from(pids)
    .filter((pid) => {
      const info = promoInfo.get(pid);
      return Boolean(info) && !info!.is_master;
    })
    .map((pid) => {
      const info = promoInfo.get(pid)!;
      const inner = byPromoterYm.get(pid);
      return {
        promoter_id: pid,
        promoter_name: info.name,
        estado: info.estado,
        company_id: info.company_id,
        company_name: info.company_name,
        meses: range.map(({ year, month }) => {
          const acc = inner?.get(ymKeyHist(year, month)) ?? emptyAccHist();
          const meta = metaByPidYm.get(`${pid}:${ymKeyHist(year, month)}`) ?? 0;
          return {
            year,
            month,
            label: labelHist(year, month),
            producao: round2(acc.net),
            penetracao_seg: penetracaoDe(acc),
            meta: round2(meta),
            percent: meta > 0 ? acc.net / meta : null,
          };
        }),
      };
    })
    .sort((a, b) => a.promoter_name.localeCompare(b.promoter_name, "pt-BR"));

  // ---- série por ESTADO (soma dos promotores do estado; master já excluída) ----
  const byEstadoYm = new Map<string, Map<string, AccHist>>();
  const estadoPromoters = new Map<string, Set<string>>();
  const NULO = "__NULL__";
  for (const [pid, inner] of byPromoterYm) {
    const info = promoInfo.get(pid);
    if (!info || info.is_master) continue;
    const ekey = info.estado ?? NULO;
    if (!estadoPromoters.has(ekey)) estadoPromoters.set(ekey, new Set());
    estadoPromoters.get(ekey)!.add(pid);
    let eInner = byEstadoYm.get(ekey);
    if (!eInner) {
      eInner = new Map<string, AccHist>();
      byEstadoYm.set(ekey, eInner);
    }
    for (const [k, acc] of inner) {
      const cur = eInner.get(k) ?? emptyAccHist();
      cur.net += acc.net;
      cur.gross += acc.gross;
      cur.insuredGross += acc.insuredGross;
      eInner.set(k, cur);
    }
  }

  const perEstadoMonthly: EstadoHistorico[] = [];
  const pushEstado = (estado: Estado | null, ekey: string) => {
    const eInner = byEstadoYm.get(ekey);
    const proms = estadoPromoters.get(ekey);
    if (!eInner || !proms || proms.size === 0) return;
    perEstadoMonthly.push({
      estado,
      estado_label: estado ? ESTADO_LABEL[estado] : "Não classificado",
      promotor_count: proms.size,
      meses: range.map(({ year, month }) => {
        const acc = eInner.get(ymKeyHist(year, month)) ?? emptyAccHist();
        return {
          year,
          month,
          label: labelHist(year, month),
          producao: round2(acc.net),
          penetracao_seg: penetracaoDe(acc),
        };
      }),
    });
  };
  for (const e of ESTADO_ORDEM) pushEstado(e, e);
  pushEstado(null, NULO);

  return { perPromoterMonthly, perEstadoMonthly };
}
