import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import { buildPrtCiclo, type PrtCicloResult } from "@/lib/prtCiclo";

// ============================================================
// AUDITORIA (Etapa 8) — caça ao recuperável com a TRAVA anti-dupla-cobrança.
// socio-only. READ-ONLY.
//
//   recuperável NOVO = curado v9 (audit_v9_avista bloco 2.1 + audit_v9_prt bloco 2.2,
//     = PEDIDO_FIRME) NOT EXISTS em cobranca_itens, POR CONTRATO (tipo+contract_number).
//     Hoje ~R$0: a âncora 07/05 cobre todo PEDIDO_FIRME até abril. NUNCA usa o motor
//     automático bruto (monthly_closing_entries), que superestima ~7x.
//   já cobrado = cobrancas_emitidas (header) + cobranca_itens (contagem). Informativo,
//     nunca somado ao recuperável.
//   Ciclo PRT = buildPrtCiclo do mês selecionado (estimativa automática, e49bc42).
//   aguardando curadoria = mês selecionado > curadoria v9 disponível (até abr/2026).
// ============================================================

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const BLOCOS_AVISTA = ["2.1_AVISTA_SUBPAGAMENTO", "2.1_AVISTA_SUBPAG_ABAIXO_TETO"];
const BLOCO_PRT = "2.2_PRT_LISTADO_NAO_PAGO";
const CURADO_MAX_KEY = "2026-04"; // audit_v9 cobre dez/22 -> abr/26

function pad2(n: number) { return String(n).padStart(2, "0"); }
function periodKey(y: number, m: number) { return `${y}-${pad2(m)}`; }
function periodLabel(y: number, m: number) { return `${MES[(m - 1 + 12) % 12]}/${y}`; }
function digits(s: unknown) { return String(s ?? "").replace(/\D/g, ""); }
function toNum(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function round(n: number) { return Math.round(n * 100) / 100; }

export type FechamentoPeriod = { year: number; month: number; key: string; label: string; fechado: boolean };

// Meses com fechamento real (CNPJs reais) + o mês corrente (aberto, se não fechado).
export async function getClosingPeriods(
  supabase: SupabaseClient,
  now: { year: number; month: number }
): Promise<{ periods: FechamentoPeriod[]; closedKeys: Set<string>; lastClosed: FechamentoPeriod | null }> {
  const companies = await fetchAllRows<{ cnpj: string }>(() => supabase.from("companies").select("cnpj"));
  const realDigits = new Set(
    companies.filter((c) => !String(c.cnpj).startsWith("TEMP-")).map((c) => digits(c.cnpj))
  );
  const fme = await fetchAllRows<{ empresa_cnpj: string; ano: number; mes: number }>(() =>
    supabase.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes")
  );
  const closed = new Map<string, { year: number; month: number }>();
  for (const r of fme) {
    if (realDigits.has(digits(r.empresa_cnpj))) closed.set(periodKey(r.ano, r.mes), { year: r.ano, month: r.mes });
  }
  const closedKeys = new Set(closed.keys());
  const closedList = Array.from(closed.values()).sort((a, b) => b.year - a.year || b.month - a.month);

  const periods: FechamentoPeriod[] = closedList.map((p) => ({
    year: p.year, month: p.month, key: periodKey(p.year, p.month), label: periodLabel(p.year, p.month), fechado: true,
  }));
  // mês corrente como "em aberto" no topo, se ainda não fechou
  const curKey = periodKey(now.year, now.month);
  if (!closedKeys.has(curKey)) {
    periods.unshift({ year: now.year, month: now.month, key: curKey, label: periodLabel(now.year, now.month), fechado: false });
  }
  return { periods, closedKeys, lastClosed: closedList[0] ? { ...periods.find((p) => p.fechado)! } : null };
}

export type CobrancaEmitida = {
  emitidaEm: string;
  competenciaDe: string;
  competenciaAte: string;
  valorAvista: number;
  valorPrt: number;
  valorTotal: number;
  descricao: string | null;
  contratos: number;
};

export type AuditoriaPayload = {
  periods: FechamentoPeriod[];
  selectedPeriod: FechamentoPeriod | null;
  recuperavel: { avista: number; prt: number; total: number; contratos: number };
  jaCobrado: CobrancaEmitida[];
  prtCiclo: PrtCicloResult | null;
  aguardandoCuradoria: boolean; // mês selecionado depois do curado v9 disponível
  curadoAteLabel: string;
};

export async function buildAuditoria(
  supabase: SupabaseClient,
  now: { year: number; month: number },
  year?: number,
  month?: number
): Promise<AuditoriaPayload> {
  const { periods, lastClosed } = await getClosingPeriods(supabase, now);

  const selectedPeriod: FechamentoPeriod | null =
    (year && month ? periods.find((p) => p.year === year && p.month === month) || {
      year, month, key: periodKey(year, month), label: periodLabel(year, month), fechado: false,
    } : lastClosed) || null;

  // ---- recuperável NOVO (curado v9 NOT EXISTS cobranca_itens, por contrato) ----
  const [avCurado, prCurado, itens] = await Promise.all([
    fetchAllRows<{ contract_number: string; valor_solicitacao_regularizacao: number }>(() =>
      supabase.from("audit_v9_avista").select("contract_number, valor_solicitacao_regularizacao").in("bloco", BLOCOS_AVISTA)
    ),
    fetchAllRows<{ contract_number: string; valor_solicitacao_regularizacao: number }>(() =>
      supabase.from("audit_v9_prt").select("contract_number, valor_solicitacao_regularizacao").eq("bloco", BLOCO_PRT)
    ),
    fetchAllRows<{ tipo: string; contract_number: string; cobranca_id: string }>(() =>
      supabase.from("cobranca_itens").select("tipo, contract_number, cobranca_id")
    ),
  ]);
  const cobAv = new Set(itens.filter((i) => i.tipo === "AVISTA").map((i) => i.contract_number));
  const cobPrt = new Set(itens.filter((i) => i.tipo === "PRT").map((i) => i.contract_number));
  const novoAv = avCurado.filter((r) => !cobAv.has(r.contract_number));
  const novoPrt = prCurado.filter((r) => !cobPrt.has(r.contract_number));
  const sum = (arr: Array<{ valor_solicitacao_regularizacao: number }>) =>
    round(arr.reduce((a, r) => a + toNum(r.valor_solicitacao_regularizacao), 0));
  const recAvista = sum(novoAv);
  const recPrt = sum(novoPrt);

  // ---- já cobrado (cobrancas_emitidas + contagem de itens) ----
  const cobrancas = await fetchAllRows<{
    id: string; emitida_em: string; competencia_de: string; competencia_ate: string;
    valor_avista: number; valor_prt: number; valor_total: number; descricao: string | null;
  }>(() =>
    supabase
      .from("cobrancas_emitidas")
      .select("id, emitida_em, competencia_de, competencia_ate, valor_avista, valor_prt, valor_total, descricao")
      .order("emitida_em", { ascending: false })
  );
  const itensPorCobranca = new Map<string, number>();
  for (const i of itens) itensPorCobranca.set(i.cobranca_id, (itensPorCobranca.get(i.cobranca_id) || 0) + 1);
  const jaCobrado: CobrancaEmitida[] = cobrancas.map((c) => ({
    emitidaEm: c.emitida_em,
    competenciaDe: c.competencia_de,
    competenciaAte: c.competencia_ate,
    valorAvista: round(toNum(c.valor_avista)),
    valorPrt: round(toNum(c.valor_prt)),
    valorTotal: round(toNum(c.valor_total)),
    descricao: c.descricao,
    contratos: itensPorCobranca.get(c.id) || 0,
  }));

  // ---- Ciclo PRT do mês selecionado (estimativa automática) ----
  const prtCiclo = selectedPeriod ? await buildPrtCiclo(supabase, selectedPeriod.year, selectedPeriod.month) : null;

  // ---- aguardando curadoria: mês selecionado depois do curado disponível ----
  const aguardandoCuradoria = selectedPeriod ? selectedPeriod.key > CURADO_MAX_KEY : false;

  return {
    periods,
    selectedPeriod,
    recuperavel: { avista: recAvista, prt: recPrt, total: round(recAvista + recPrt), contratos: novoAv.length + novoPrt.length },
    jaCobrado,
    prtCiclo,
    aguardandoCuradoria,
    curadoAteLabel: periodLabel(2026, 4),
  };
}
