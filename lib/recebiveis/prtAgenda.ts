// ============================================================
// RECEBIVEIS — Camada 1: AGENDA DE RECEBÍVEIS do PRT diferido.
//
// Isto NÃO é previsão estatística: é a AGENDA de direitos já contratados.
// Cada contrato vivo da carteira PRT (monthly_closing_entries, entry_type=
// 'PRT', COD EST=1) DEVE pagar sua COMISSÃO mensal pelas parcelas restantes
// (regra TRP — enquanto ativo e adimplente). O decréscimo mês a mês é
// consequência ARITMÉTICA de parcelas vencendo, não um fator de declínio.
//
// previsto[h] = Σ COMISSÃO (observada no estoque) dos contratos que ainda têm
// parcela a vencer no mês h (parcelasRestantes > h). Um número por mês. Sem
// fator de declínio, sem cenário alternativo.
//
// Usa a COMISSÃO OBSERVADA do estoque (o valor real já contratado). A fórmula
// calibrada (excedente% × VALOR FINANCIADO ÷ prazo) é da Camada 2 (produção
// nova), NÃO aqui.
//
// READ-ONLY. Self-contained (sem imports "@/..."), para compilar isolado.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

const PRT_ENTRY_TYPE = "PRT";
const COD_EST_PAGO = 1; // 1 = PRT estoque pagável (entra no valor_diferido)
const PAGE_SIZE = 1000;

export interface PrtContract {
  /** NRO OPERAÇÃO — identificador do contrato. */
  operacao: string;
  /** COMISSÃO mensal observada do PRT (R$) — direito contratado por parcela. */
  comissao: number;
  parcelasPagas: number;
  parcelasTotal: number;
  /** TOTAL − PGS (>= 0). */
  parcelasRestantes: number;
}

export interface PrtAgendaPoint {
  /** Meses à frente do snapshot (1..horizonte). */
  h: number;
  ano: number;
  mes: number;
  /** "YYYY-MM". */
  competencia: string;
  /** PRT previsto no mês = direito contratado a vencer (R$). */
  previsto: number;
  /** Contratos com parcela a vencer no mês (parcelasRestantes > h). */
  contratosComParcela: number;
}

export interface PrtAgenda {
  snapshot: { ano: number; mes: number; competencia: string };
  /** Σ COMISSÃO do snapshot (h=0) — reconcilia com valor_diferido do mês. */
  baseComissao: number;
  contratosBase: number;
  horizonteMeses: number;
  serie: PrtAgendaPoint[];
}

export interface PrtAgendaOptions {
  /** Quantidade de meses a projetar à frente (default 12). */
  horizonteMeses?: number;
}

// ------------------------------------------------------------------ helpers --

/** Converte número pt-BR ("15.800,00", "25,65") ou number para Number. */
function toNumberBR(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : 0;
}

/** Lê uma chave do metadata ignorando caixa/acento (ex.: COMISSÃO/COMISSAO). */
function metaGet(
  meta: Record<string, unknown> | null,
  keys: string[],
): unknown {
  if (!meta) return null;
  const wanted = keys.map((k) => normalizeKey(k));
  for (const [k, v] of Object.entries(meta)) {
    if (v == null || v === "") continue;
    if (wanted.includes(normalizeKey(k))) return v;
  }
  return null;
}

function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Soma `delta` meses a (ano, mes) [mes 1..12]. */
function addMonths(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const idx = ano * 12 + (mes - 1) + delta;
  return { ano: Math.floor(idx / 12), mes: (idx % 12) + 1 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------- parse (puro) --

/** Parseia uma linha PRT do metadata. Retorna null se faltar campo essencial. */
export function parsePrtContract(
  metadata: Record<string, unknown> | null,
): PrtContract | null {
  if (!metadata) return null;
  const operacao = String(metaGet(metadata, ["NRO OPERACAO", "NRO OPERAÇÃO"]) ?? "").trim();
  if (!operacao) return null;

  const comissao = toNumberBR(metaGet(metadata, ["COMISSAO", "COMISSÃO"]));
  const parcelasPagas = Math.trunc(toNumberBR(metaGet(metadata, ["QTD PARCELAS PGS"])));
  const parcelasTotal = Math.trunc(toNumberBR(metaGet(metadata, ["QTD PARCELAS TOTAL"])));
  const parcelasRestantes = Math.max(0, parcelasTotal - parcelasPagas);

  return { operacao, comissao, parcelasPagas, parcelasTotal, parcelasRestantes };
}

/** True se a linha é PRT estoque pagável (COD EST = 1). */
export function isPrtPago(metadata: Record<string, unknown> | null): boolean {
  return Math.trunc(toNumberBR(metaGet(metadata, ["COD EST"]))) === COD_EST_PAGO;
}

// --------------------------------------------------------- agenda (pura) --

/**
 * Monta a AGENDA de recebíveis a partir de um snapshot (função PURA, testável
 * sem banco). Para h=1..horizonte: Σ COMISSÃO dos contratos com
 * parcelasRestantes > h. Sem fator de declínio — é direito contratado.
 */
export function projectPrtAgenda(
  contracts: PrtContract[],
  snapshot: { ano: number; mes: number },
  options: PrtAgendaOptions = {},
): PrtAgenda {
  const horizonteMeses = options.horizonteMeses ?? 12;

  const baseComissao = round2(contracts.reduce((s, c) => s + c.comissao, 0));
  const serie: PrtAgendaPoint[] = [];

  for (let h = 1; h <= horizonteMeses; h++) {
    let previsto = 0;
    let contratosComParcela = 0;
    for (const c of contracts) {
      // >= h (NÃO > h): inclui a ÚLTIMA parcela a vencer. Um contrato com
      // parcelasRestantes = R tem parcela a vencer nos meses h = 1..R; o antigo
      // "> h" dropava o mês R (off-by-one, subestimava a curva).
      if (c.parcelasRestantes >= h) {
        previsto += c.comissao;
        contratosComParcela += 1;
      }
    }
    const { ano, mes } = addMonths(snapshot.ano, snapshot.mes, h);
    serie.push({
      h,
      ano,
      mes,
      competencia: `${ano}-${pad2(mes)}`,
      previsto: round2(previsto),
      contratosComParcela,
    });
  }

  return {
    snapshot: { ano: snapshot.ano, mes: snapshot.mes, competencia: `${snapshot.ano}-${pad2(snapshot.mes)}` },
    baseComissao,
    contratosBase: contracts.length,
    horizonteMeses,
    serie,
  };
}

// ----------------------------------------------------------------- IO (db) --

/**
 * Descobre a competência mais recente com linhas PRT em monthly_closing_entries.
 */
export async function findLatestPrtSnapshotMonth(
  supabase: SupabaseClient,
): Promise<{ ano: number; mes: number } | null> {
  const { data, error } = await supabase
    .from("monthly_closing_entries")
    .select("year, month")
    .eq("entry_type", PRT_ENTRY_TYPE)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  return { ano: Number(row.year), mes: Number(row.month) };
}

/**
 * Carrega os contratos PRT pagáveis (COD EST=1) de uma competência, paginando.
 */
export async function fetchPrtSnapshot(
  supabase: SupabaseClient,
  ano: number,
  mes: number,
): Promise<PrtContract[]> {
  const contracts: PrtContract[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    // ORDEM ESTAVEL OBRIGATORIA. Sem ORDER BY o `.range()` nao tem ordem
    // definida: a mesma linha vem em duas paginas e outra em nenhuma. Medido em
    // 01/08/2026 nesta query, jun/2026: 10.238 linhas devolvidas mas apenas
    // 7.238 ids distintos — 3.000 DUPLICADAS e 55 contratos que a leitura nunca
    // via.
    //
    // O estrago era na Fatia B (prtInadimplencia): o Set de operacoes do
    // snapshot RECENTE ficava furado, entao contrato que continuava pagando
    // parecia ter sumido. A deteccao acusava 2.814 paradas antecipadas quando
    // as reais eram 66 — 2.748 FALSOS POSITIVOS, R$ 13.343,59 de "comissao
    // perdida" contra R$ 221,55 de verdade.
    //
    // PROVA DE QUE O COMPORTAMENTO E INDEFINIDO, NAO APENAS SUBOTIMO: a MESMA
    // query logica (monthly_closing_entries, PRT, jun/2026, as mesmas 10.238
    // linhas) devolveu 2.000 duplicadas em closingAnalytics:1167 e 3.000 aqui.
    // Conjunto igual, numeros diferentes — o Postgres escolhe livre a cada
    // requisicao. Nao ha "ordem natural" para confiar.
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select("metadata")
      .eq("entry_type", PRT_ENTRY_TYPE)
      .eq("year", ano)
      .eq("month", mes)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ metadata: Record<string, unknown> | null }>;
    for (const r of rows) {
      if (!isPrtPago(r.metadata)) continue;
      const c = parsePrtContract(r.metadata);
      if (c) contracts.push(c);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return contracts;
}

// ------------------------------------------------- IO (carteira_contrato) --
// Fonte RECONCILIADA da Camada 1: carteira_contrato tem 1 linha por
// (numero_operacao × competencia), colunas TIPADAS (sem parse de metadata) e
// `restantes` já materializado. Substitui o par metadata (findLatestPrtSnapshot
// Month/fetchPrtSnapshot) SÓ para o buildPrtAgenda (Recebíveis). O par metadata
// permanece INTACTO — a Fatia B (prtInadimplencia) depende dele.

const CARTEIRA_TABLE = "carteira_contrato";
const CARTEIRA_STATUS_ATIVO = "ativo";

/**
 * Competência (YYYY-MM) mais recente com contratos ATIVOS em carteira_contrato.
 * Análogo a findLatestPrtSnapshotMonth, na fonte reconciliada.
 */
export async function findLatestCarteiraMonth(
  supabase: SupabaseClient,
): Promise<{ ano: number; mes: number } | null> {
  const { data, error } = await supabase
    .from(CARTEIRA_TABLE)
    .select("competencia")
    .eq("status", CARTEIRA_STATUS_ATIVO)
    .order("competencia", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const comp = String(data?.[0]?.competencia ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(comp);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]) };
}

/**
 * Carrega a carteira PRT ATIVA de uma competência de carteira_contrato,
 * paginando. Mesmo shape PrtContract do caminho metadata — mas comissão vem da
 * coluna tipada e parcelasRestantes vem da coluna `restantes` (NÃO derivado, e
 * NÃO recalculado por fórmula: comissão é a observada/contratada).
 */
export async function fetchCarteiraSnapshot(
  supabase: SupabaseClient,
  ano: number,
  mes: number,
): Promise<PrtContract[]> {
  const competencia = `${ano}-${pad2(mes)}`;
  const contracts: PrtContract[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(CARTEIRA_TABLE)
      .select("numero_operacao, comissao, parcelas_pagas, prazo, restantes")
      .eq("competencia", competencia)
      .eq("status", CARTEIRA_STATUS_ATIVO)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      numero_operacao: unknown;
      comissao: unknown;
      parcelas_pagas: unknown;
      prazo: unknown;
      restantes: unknown;
    }>;
    for (const r of rows) {
      const operacao = String(r.numero_operacao ?? "").trim();
      if (!operacao) continue;
      contracts.push({
        operacao,
        comissao: toNumberBR(r.comissao),
        parcelasPagas: Math.trunc(toNumberBR(r.parcelas_pagas)),
        parcelasTotal: Math.trunc(toNumberBR(r.prazo)),
        parcelasRestantes: Math.max(0, Math.trunc(toNumberBR(r.restantes))),
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return contracts;
}

/**
 * Orquestra: acha a competência ativa mais recente da CARTEIRA (reconciliada),
 * carrega a carteira e monta a agenda. Ponto de entrada da Camada 1.
 *
 * Forward-only: NÃO re-seeda previsao_snapshot já congelado — o congelamento
 * (congelarPrevisao) passa a usar esta fonte daqui pra frente; snapshots
 * antigos permanecem como estão.
 */
export async function buildPrtAgenda(
  supabase: SupabaseClient,
  options: PrtAgendaOptions = {},
): Promise<PrtAgenda> {
  const snap = await findLatestCarteiraMonth(supabase);
  if (!snap) {
    throw new Error("Nenhuma competência ativa encontrada em carteira_contrato.");
  }
  const contracts = await fetchCarteiraSnapshot(supabase, snap.ano, snap.mes);
  return projectPrtAgenda(contracts, snap, options);
}
