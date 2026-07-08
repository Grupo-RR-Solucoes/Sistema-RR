// ============================================================================
// closingPromoterBase — FETCHER READ-ONLY do fechamento (monthly_closing_entries)
// para a comissão do promotor por FECHAMENTO (SUB-PR 1, só o VALOR).
//
// UNIVERSO: aba "A Vista" do fechamento = entry_type='CASH'. Cada linha CASH é
// UM contrato à vista e o seu metadata (linha crua do xlsx) carrega TAMBÉM os
// campos de seguro embutidos: "COMISSÃO SEGURO", " VALOR SEGURO ", "% PENETRAÇÃO".
// Por isso o fetcher lê só CASH — pega à vista + seguro do mesmo contrato sem
// duplicar. (A aba "Seguro" avulsa — entry_type='INSURANCE', sheet_name='Seguro'
// — NÃO entra nesta onda; ver nota SUB-PR 1.)
//
// NÃO aplica Tabela de Remuneração nem acordo — só EXTRAI a base bruta por
// contrato. A base à vista da EMPRESA por contrato é a coluna "COMISSÃO PF" do
// fechamento (campo comissaoEmpresaAvista) — valor FINAL já pago pela empresa,
// já pós-teto 5,80%; NÃO é líquido × %avista (podem divergir por arredondamento/
// regra do banco). O cálculo (Σ COMISSÃO PF × acordo + escala seguro) vive no
// consumidor (scripts/dumpComissaoFechamento.ts nesta onda). READ-ONLY: não
// escreve nada. Não toca cms (jan–mai), auditoria à vista viva nem o daily.
// ============================================================================

import { readRawPayloadValue } from "./proposalDetailing.ts";

// ---- helpers ---------------------------------------------------------------

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function toText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

// SRCC normalizado (sem acento, sem espaço, upper). "SIM" => restrição confirmada.
export function normalizeSrcc(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

export function isSrccRestrito(srccRaw: unknown): boolean {
  return normalizeSrcc(srccRaw) === "SIM";
}

// Aliases das colunas do metadata (chaves REAIS de jun/2026 confirmadas no dump;
// readRawPayloadValue já normaliza acento/caixa E APARA espaços — cobre
// "COMISSÃO PF " (espaço no fim) e " VALOR SEGURO " (espaços nas pontas)).
const A_PERCENT_AVISTA = ["% A VISTA", "% À VISTA", "% AVISTA", "% A VISTA EMPRESA"];
const A_COMISSAO_PF = ["COMISSAO PF", "COMISSÃO PF", "COMISSAO", "COMISSÃO"];
const A_CHAVE_J = ["CHAVE J", "LOGIN", "USUARIO", "LOGIN DO AGENTE DE CREDITO"];
const A_VALOR_LIQUIDO = ["VALOR LIQUIDO", "VALOR LÍQUIDO", "LIQUIDO", "BASE"];
const A_PRODUTO = [
  "DESCRICAO DO PRODUTO",
  "DESCRIÇÃO DO PRODUTO",
  "NOME DO PRODUTO",
  "PRODUTO",
  "DESCRICAO",
];
const A_TX_JUROS = ["TX JUROS", "TAXA", "TAXA DE JUROS", "TAXA MENSAL DE JUROS", "TAXA JUROS"];
const A_SRCC = ["RESTRICAO SRCC", "RESTRIÇÃO SRCC", "INDICADOR RESTRICAO SRCC", "INDICADOR RESTRIÇÃO SRCC"];
const A_VALOR_SEGURO = ["VALOR SEGURO", "VALOR LIQUIDO SEGURO", "VALOR LÍQUIDO SEGURO", "SEGURO"];
const A_COMISSAO_SEGURO = ["COMISSAO SEGURO", "COMISSÃO SEGURO"];
const A_PENETRACAO = ["% PENETRACAO", "% PENETRAÇÃO", "PENETRACAO", "PENETRAÇÃO"];
const A_CONTRATO = ["CONTRATO", "NUMERO CONTRATO", "NÚMERO CONTRATO"];

// ---- tipos -----------------------------------------------------------------

export type ClosingContrato = {
  contrato: string | null;
  chaveJ: string | null;
  promoterId: string | null;
  promoterName: string | null;
  keyType: string | null; // INDIVIDUAL | MASTER | null (chave não cadastrada)
  companyId: string | null;
  percentualEmpresa: number; // "% A VISTA" (decimal 0..1) — SÓ INFORMATIVO, não é base de cálculo
  comissaoEmpresaAvista: number; // "COMISSÃO PF" — BASE À VISTA da empresa (valor final pago, já pós-teto 5,80%). Não recalcular de líquido × %.
  valorLiquido: number;
  produto: string | null; // "DESCRIÇÃO DO PRODUTO"
  txJuros: number | null;
  srccRaw: string; // "RESTRIÇÃO SRCC" cru (p/ pintar de vermelho)
  comissaoSeguro: number; // "COMISSÃO SEGURO" (empresa)
  valorSeguro: number; // " VALOR SEGURO "
  penetracao: number | null; // "% PENETRAÇÃO" (decimal 0..1)
};

export type ClosingPromoterBase = {
  year: number;
  month: number;
  /** Contratos PAGÁVEIS (SRCC ≠ "Sim"). Entram no valor. */
  contratos: ClosingContrato[];
  /** Contratos com RESTRIÇÃO SRCC = "Sim". Fora do valor; listar em vermelho. */
  restritas: ClosingContrato[];
  /** Diagnóstico. */
  totalCashRows: number;
};

type SupabaseLike = { from: (t: string) => any };

const PAGE = 1000;

async function fetchAll<T = any>(build: () => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/**
 * Lê o fechamento (aba A Vista) de (year, month[, companyId]) e devolve a base
 * por contrato — à vista + seguro embutido — com a Chave J resolvida para
 * promotor (via j_keys). SRCC="Sim" vai para `restritas`; o resto para
 * `contratos`. READ-ONLY.
 */
export async function loadClosingPromoterBase(
  supabase: SupabaseLike,
  params: { year: number; month: number; companyId?: string | null }
): Promise<ClosingPromoterBase> {
  const { year, month, companyId } = params;

  // 1. Linhas CASH (aba A Vista) da competência.
  const rows = await fetchAll<any>(() => {
    let q = supabase
      .from("monthly_closing_entries")
      .select(
        "id, company_id, contract_number, j_key, product_name, net_value, insurance_value, commission_value, metadata"
      )
      .eq("year", year)
      .eq("month", month)
      .eq("entry_type", "CASH");
    if (companyId) q = q.eq("company_id", companyId);
    return q;
  });

  // 2. Mapa Chave J -> promotor (j_keys). Case-insensitive na chave.
  const jkeys = await fetchAll<any>(() =>
    supabase.from("j_keys").select("j_key, promoter_id, key_type")
  );
  const jkeyMap = new Map<string, { promoter_id: string | null; key_type: string | null }>();
  for (const jk of jkeys) {
    const k = toText(jk.j_key).toUpperCase();
    if (k) jkeyMap.set(k, { promoter_id: jk.promoter_id ?? null, key_type: jk.key_type ?? null });
  }

  // 3. Nomes dos promotores.
  const promoters = await fetchAll<any>(() =>
    supabase.from("promoters").select("id, name")
  );
  const nameById = new Map<string, string>();
  for (const p of promoters) nameById.set(p.id, p.name);

  const contratos: ClosingContrato[] = [];
  const restritas: ClosingContrato[] = [];

  for (const r of rows) {
    const md = (r.metadata || {}) as Record<string, unknown>;

    const chaveJ = toText(readRawPayloadValue(md, A_CHAVE_J)) || toText(r.j_key) || null;
    const jinfo = chaveJ ? jkeyMap.get(chaveJ.toUpperCase()) : undefined;
    // Só INDIVIDUAL resolve promotor direto; MASTER/ausente fica sem promotor.
    const promoterId =
      jinfo && jinfo.key_type === "INDIVIDUAL" ? jinfo.promoter_id : null;

    const percentualEmpresa = toNumber(readRawPayloadValue(md, A_PERCENT_AVISTA));
    const valorLiquido =
      toNumber(readRawPayloadValue(md, A_VALOR_LIQUIDO)) || toNumber(r.net_value);
    const comissaoEmpresaAvista =
      toNumber(readRawPayloadValue(md, A_COMISSAO_PF)) || toNumber(r.commission_value);
    const srccRaw = toText(readRawPayloadValue(md, A_SRCC));

    const contrato: ClosingContrato = {
      contrato: toText(readRawPayloadValue(md, A_CONTRATO)) || toText(r.contract_number) || null,
      chaveJ,
      promoterId,
      promoterName: promoterId ? nameById.get(promoterId) ?? null : null,
      keyType: jinfo ? jinfo.key_type : null,
      companyId: r.company_id ?? null,
      percentualEmpresa,
      comissaoEmpresaAvista,
      valorLiquido,
      produto: toText(readRawPayloadValue(md, A_PRODUTO)) || toText(r.product_name) || null,
      txJuros: (() => {
        const v = readRawPayloadValue(md, A_TX_JUROS);
        return v === null || v === undefined || v === "" ? null : toNumber(v);
      })(),
      srccRaw,
      comissaoSeguro: toNumber(readRawPayloadValue(md, A_COMISSAO_SEGURO)),
      valorSeguro: toNumber(readRawPayloadValue(md, A_VALOR_SEGURO)),
      penetracao: (() => {
        const v = readRawPayloadValue(md, A_PENETRACAO);
        return v === null || v === undefined || v === "" ? null : toNumber(v);
      })(),
    };

    if (isSrccRestrito(srccRaw)) restritas.push(contrato);
    else contratos.push(contrato);
  }

  return { year, month, contratos, restritas, totalCashRows: rows.length };
}
