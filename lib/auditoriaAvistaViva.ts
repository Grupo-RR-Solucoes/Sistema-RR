// ============================================================================
// CAMADA 1 — Auditoria à vista VIVA (fetcher daily ⋈ CASH → ContratoAvista[]).
//
// Segundo fetcher: monta ContratoAvista[] a partir da ENTRADA VIVA
// (daily_production_records = DEVIDO; monthly_closing_entries CASH = PAGO),
// para auditar meses novos sem depender da tabela congelada audit_v9_avista.
//
// A engine NÃO muda: reusa auditAvistaContrato + auditEnquadramentoMes (Camada 1
// de enquadramento) intactos. Aqui só trocamos a ORIGEM dos ContratoAvista.
//
// Descobertas de chave (validadas no banco, abr/2026):
//   - daily.contract_number é SEMPRE null; o id da operação é daily.proposal_number.
//   - CASH.contract_number é o id pago. O join real é:
//        normalizeOperationId(daily.proposal_number) == normalizeOperationId(CASH.contract_number)
//   - daily.product_description é o nome do banco ("CONSIGNADO CORRENTISTA"), que
//     difere do vocabulário "produto" do v9 ("CONSIGNADO PRIVADO"). Roteamento de
//     categoria pode divergir — quantificado na comparação vivo×congelado.
//   - tipo (NOVO/RENOVACAO) NÃO existe vivo no daily → enviado null (gap conhecido).
//
// READ-ONLY: não escreve nada no banco.
// ============================================================================

import {
  auditAvistaContrato,
  type ContratoAvista,
  type MesContextAvista,
  type ResultadoFase2Cash,
} from "./auditoriaAvista.ts";
import { auditEnquadramentoMes } from "./enquadramento.ts";
import { getProductionBandByValue, inferCreditTable } from "./motor.ts";
import { getPrazoTrp } from "./prazoTrp.ts";
import {
  getProductionPeriodFromValue,
  getProductionPeriodKey,
} from "./productionPeriod.ts";

type SupabaseLike = { from: (t: string) => any };

/** Classificação do casamento produção × pagamento. */
export type ClassificacaoMatch =
  | "MATCH" // produzido E pago — auditável
  | "PRODUZIDO_NAO_PAGO" // daily sem CASH — subpagamento OU timing (vide maturidade)
  | "PAGO_SEM_PRODUCAO"; // CASH sem daily na competência — gap/timing, NÃO auditar

const PAGE = 1000;

// Mirror de closingAnalytics.ts:normalizeOperationId (privada lá). Mesma regra:
// NFD sem acento, upper, sem espaços. Internamente consistente nos dois lados.
function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}
function normalizeOperationId(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** "000001640" → 1640 (categoriasCandidatasFor compara cv === "1640"). */
function convenioToNumber(v: unknown): number | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** BandKey ("FAIXA_3") → catAplicada do v9 ("Faixa 3"). */
function bandToFaixa(band: string): string {
  const idx = band.replace(/[^0-9]/g, "");
  return idx ? `Faixa ${idx}` : band;
}

// GAP 2 (produto): o product_description vivo ("CONSIGNADO CORRENTISTA") não está
// no vocabulário do v9 e o split público/privado/INSS/MPDG é por CONVÊNIO, não
// pelo nome. Reusa o roteador validado do motor (inferCreditTable, paridade
// frente2) → tableKey → produto canônico que categoriasCandidatasFor (a engine)
// roteia para a MESMA categoria. Não duplica lógica de roteamento.
const TABLEKEY_TO_PRODUTO: Record<string, string> = {
  FGTS: "FGTS",
  ADIANTAMENTO_13: "CRÉDITO ADIANTAMENTO",
  AUTOMATICO_SALARIO_BENEFICIO: "NÃO CONSIGNADO",
  PORTABILIDADE_PUBLICO: "PORTABILIDADE PÚBLICO",
  PORTABILIDADE_PRIVADO: "PORTABILIDADE PRIVADO",
  INSS_NOVO: "CONSIGNADO INSS",
  INSS_RENOVACAO: "CONSIGNADO INSS",
  SIAPE: "MPDG",
  SP_MG: "CONSIGNADO SP MG",
  PRIVADO: "CONSIGNADO PRIVADO",
  PUBLICO_GERAL: "CONSIGNADO PÚBLICO",
};

/** Deriva produto (vocabulário v9) + tipo (NOVO/RENOVACAO) do registro vivo. */
function deriveProdutoTipo(d: DailyRow): {
  produto: string;
  tipo: "NOVO" | "RENOVACAO";
} {
  const tableKey = inferCreditTable({
    valor_liquido: toNum(d.net_value),
    valor_bruto: toNum(d.gross_value),
    valor_seguro: 0,
    taxa_juros: toNum(d.interest_rate),
    prazo: toNum(d.term_months),
    tem_seguro: false,
    product_code: d.product_code,
    product_description: d.product_description,
    convenio_code: d.convenio_code,
    convenio_type: d.convenio_type,
    convenio_segment: d.convenio_segment,
  });
  // GAP 1 (tipo): REFIN/RENOVA ⇒ RENOVACAO (em abr/2026 bate exato: 184 REFIN =
  // 184 RENOVACAO do congelado). inferCreditTable já separa INSS_RENOVACAO.
  const desc = String(d.product_description ?? "").toUpperCase();
  const isRefin =
    tableKey === "INSS_RENOVACAO" ||
    desc.includes("REFIN") ||
    desc.includes("RENOVA");
  return {
    produto: TABLEKEY_TO_PRODUTO[tableKey] ?? tableKey,
    tipo: isRefin ? "RENOVACAO" : "NOVO",
  };
}

async function fetchAll<T>(
  build: () => any
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

type DailyRow = {
  proposal_number: string | null;
  company_id: string | null;
  product_code: string | null;
  product_description: string | null;
  convenio_code: string | null;
  convenio_type: string | null;
  convenio_segment: string | number | null;
  interest_rate: number | null;
  term_months: number | null;
  installments: number | null;
  net_value: number | null;
  gross_value: number | null;
  contract_date: string | null;
  is_srcc_restricted: boolean | null;
  raw_payload: Record<string, unknown> | null;
};

type CashRow = {
  contract_number: string | null;
  commission_value: number | null;
  net_value: number | null;
  year: number;
  month: number;
};

export interface ContratoVivoClassificado {
  classificacao: ClassificacaoMatch;
  /** id da operação (proposal_number do daily ou contract_number do CASH). */
  operacao: string;
  /** ContratoAvista pronto p/ engine (presente em MATCH e PRODUZIDO_NAO_PAGO). */
  contrato: ContratoAvista | null;
  /** Idade em meses da competência de produção (p/ maturidade). */
  idadeMeses: number;
  comissaoPaga: number;
  /** Só p/ PAGO_SEM_PRODUCAO: a competência do fechamento do pagamento. */
  cashYm?: string;
}

export interface FetchAvistaVivoResult {
  ym: string;
  /** ContratoVivoClassificado por operação (produção + pagos-sem-produção). */
  itens: ContratoVivoClassificado[];
  contagem: Record<ClassificacaoMatch, number>;
  /** Σ commission_value do FECHAMENTO do mês (caixa do mês), p/ batimento FME. */
  somaCashFechamentoMes: number;
  /** valor_avista de fechamento_mensal_empresa do mês (caixa truth). */
  fmeValorAvista: number | null;
}

/**
 * Carrega e classifica a entrada viva para a competência de PRODUÇÃO (year/month).
 * - DEVIDO: daily_production_records cuja competência de produção == ym.
 * - PAGO: monthly_closing_entries CASH, casado por proposal↔contract_number.
 */
export async function fetchContratosAvistaVivos(
  sb: SupabaseLike,
  year: number,
  month: number
): Promise<FetchAvistaVivoResult> {
  const ym = getProductionPeriodKey(year, month);

  // referência de "hoje" p/ maturidade (mês corrente).
  const nowKey = (() => {
    const d = new Date();
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  })();
  const ymIndex = year * 12 + (month - 1);
  const idadeMeses = nowKey - ymIndex;

  const [companies, daily, cashAll, fme] = await Promise.all([
    fetchAll<{ id: string; name: string; cnpj: string }>(() =>
      sb.from("companies").select("id, name, cnpj")
    ),
    fetchAll<DailyRow>(() =>
      sb
        .from("daily_production_records")
        .select(
          "proposal_number, company_id, product_code, product_description, convenio_code, convenio_type, convenio_segment, interest_rate, term_months, installments, net_value, gross_value, contract_date, is_srcc_restricted, raw_payload"
        )
    ),
    fetchAll<CashRow>(() =>
      sb
        .from("monthly_closing_entries")
        .select("contract_number, commission_value, net_value, year, month")
        .eq("entry_type", "CASH")
        .gt("commission_value", 0)
    ),
    fetchAll<{ ano: number; mes: number; valor_avista: number }>(() =>
      sb
        .from("fechamento_mensal_empresa")
        .select("ano, mes, valor_avista")
        .eq("ano", year)
        .eq("mes", month)
    ),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));

  // Índice de pagos: proposal/contract normalizado → Σ commission_value (todos os
  // meses; à vista de uma produção pode liquidar em mês posterior).
  const cashByOp = new Map<string, { paid: number; lastYm: string }>();
  // CASH só do FECHAMENTO do mês — p/ batimento FME e PAGO_SEM_PRODUCAO.
  let somaCashFechamentoMes = 0;
  const cashFechamentoMesOps = new Set<string>();
  for (const c of cashAll) {
    const key = normalizeOperationId(c.contract_number);
    if (!key) continue;
    const cur = cashByOp.get(key) ?? { paid: 0, lastYm: "" };
    cur.paid += toNum(c.commission_value);
    const cym = getProductionPeriodKey(c.year, c.month);
    if (cym > cur.lastYm) cur.lastYm = cym;
    cashByOp.set(key, cur);
    if (c.year === year && c.month === month) {
      somaCashFechamentoMes += toNum(c.commission_value);
      cashFechamentoMesOps.add(key);
    }
  }

  // Produção da competência: filtra daily por período de produção (holiday-aware).
  const dailyMes = daily.filter((d) => {
    const p = getProductionPeriodFromValue(d.contract_date);
    return p ? getProductionPeriodKey(p.year, p.month) === ym : false;
  });

  // Faixa do mês = banda de produção do GRUPO (não por empresa): a Promotiva
  // remunera pelo volume CONSOLIDADO dos CNPJs RR. Validado em abr/2026: soma do
  // grupo = R$ 4,05M → FAIXA 3, batendo com cat_aplicada do congelado (540/540
  // = FAIXA 3). Por empresa daria faixas menores (bug). SRCC fora do volume.
  const volGrupo = dailyMes.reduce(
    (s, d) => (d.is_srcc_restricted ? s : s + toNum(d.net_value)),
    0
  );
  const faixaMes = bandToFaixa(getProductionBandByValue(volGrupo));

  const itens: ContratoVivoClassificado[] = [];
  const opsProduzidas = new Set<string>();

  for (const d of dailyMes) {
    const opRaw = d.proposal_number;
    const opKey = normalizeOperationId(opRaw);
    if (!opKey) continue;
    opsProduzidas.add(opKey);

    const company = d.company_id ? companyById.get(d.company_id) : undefined;
    const cash = cashByOp.get(opKey);
    const comissaoPaga = cash ? cash.paid : 0;
    const classificacao: ClassificacaoMatch = cash
      ? "MATCH"
      : "PRODUZIDO_NAO_PAGO";

    const valorLiquido = toNum(d.net_value);
    const prazo = getPrazoTrp({
      product_code: d.product_code,
      term_months: d.term_months,
      installments: d.installments,
      raw_payload: d.raw_payload,
    });

    const { produto, tipo } = deriveProdutoTipo(d);
    const contrato: ContratoAvista = {
      contractNumber: String(opRaw ?? ""),
      empresa: company?.name ?? "",
      mes: ym,
      produto,
      tipo,
      convenio: convenioToNumber(d.convenio_code),
      txJuros: toNum(d.interest_rate),
      prazo: prazo ?? toNum(d.term_months),
      catAplicada: faixaMes,
      valorLiquido,
      pctAplicado: valorLiquido > 0 ? comissaoPaga / valorLiquido : 0,
      comissaoPaga,
      srccRestricao: Boolean(d.is_srcc_restricted),
      padraoDExclusao: false,
      padraoDMotivo: null,
    };

    itens.push({
      classificacao,
      operacao: String(opRaw ?? ""),
      contrato,
      idadeMeses,
      comissaoPaga,
    });
  }

  // PAGO_SEM_PRODUCAO: CASH do fechamento do mês sem daily na competência.
  for (const key of cashFechamentoMesOps) {
    if (opsProduzidas.has(key)) continue;
    const cash = cashByOp.get(key);
    itens.push({
      classificacao: "PAGO_SEM_PRODUCAO",
      operacao: key,
      contrato: null,
      idadeMeses,
      comissaoPaga: cash?.paid ?? 0,
      cashYm: ym,
    });
  }

  const contagem: Record<ClassificacaoMatch, number> = {
    MATCH: 0,
    PRODUZIDO_NAO_PAGO: 0,
    PAGO_SEM_PRODUCAO: 0,
  };
  for (const it of itens) contagem[it.classificacao] += 1;

  return {
    ym,
    itens,
    contagem,
    somaCashFechamentoMes,
    fmeValorAvista: fme.length
      ? fme.reduce((s, r) => s + toNum(r.valor_avista), 0)
      : null,
  };
}

export interface AuditAvistaVivoResult {
  ym: string;
  regime: string;
  contagem: Record<ClassificacaoMatch, number>;
  /** Todos os itens classificados (p/ comparação de fidelidade de input). */
  itens: ContratoVivoClassificado[];
  /** Resultados da engine p/ os contratos AUDITADOS (MATCH + maduros não pagos). */
  resultados: ResultadoFase2Cash[];
  /** Itens não auditados (pendência de reconciliação). */
  naoAuditados: ContratoVivoClassificado[];
  resumo: {
    auditados: number;
    subpagamentos: number; // diferenca < 0
    somaSubpagamento: number; // Σ -diferenca dos subpagamentos (valor a cobrar)
    porStatus: Record<string, number>;
    somaComissaoDevida: number;
    somaComissaoPaga: number;
  };
  reconciliacao: {
    somaCashFechamentoMes: number;
    fmeValorAvista: number | null;
    deltaAbs: number | null;
    deltaPct: number | null;
  };
}

/**
 * Auditoria à vista VIVA de um mês: monta ContratoAvista[] vivo e roda a engine
 * intacta. Audita MATCH + PRODUZIDO_NAO_PAGO MADURO (>1 mês). PAGO_SEM_PRODUCAO e
 * PRODUZIDO_NAO_PAGO recente = pendência de reconciliação (não auditado).
 */
export async function auditAvistaMesVivo(
  sb: SupabaseLike,
  year: number,
  month: number,
  opts: { maturidadeMeses?: number } = {}
): Promise<AuditAvistaVivoResult> {
  const maturidade = opts.maturidadeMeses ?? 2; // >1 mês = maduro
  const enq = await auditEnquadramentoMes(sb, year, month);
  const mesContext: MesContextAvista = {
    ym: enq.mes,
    regime: enq.regime,
    catDevida: enq.catDevida,
    catAplicada: enq.catAplicadaNormalizada,
    statusFase1: enq.status,
    jsonRegra: enq.jsonRegra,
    regraInferida: enq.regraInferida,
  };

  const fetched = await fetchContratosAvistaVivos(sb, year, month);

  const resultados: ResultadoFase2Cash[] = [];
  const naoAuditados: ContratoVivoClassificado[] = [];

  for (const it of fetched.itens) {
    const auditavel =
      it.contrato &&
      (it.classificacao === "MATCH" ||
        (it.classificacao === "PRODUZIDO_NAO_PAGO" &&
          it.idadeMeses >= maturidade));
    if (auditavel && it.contrato) {
      resultados.push(auditAvistaContrato(it.contrato, mesContext));
    } else {
      naoAuditados.push(it);
    }
  }

  const porStatus: Record<string, number> = {};
  let subpagamentos = 0;
  let somaSubpagamento = 0;
  let somaComissaoDevida = 0;
  let somaComissaoPaga = 0;
  for (const r of resultados) {
    porStatus[r.statusFase2] = (porStatus[r.statusFase2] ?? 0) + 1;
    somaComissaoDevida += r.comissaoDevida;
    somaComissaoPaga += r.comissaoDevida + r.diferenca; // paga = devida + diferenca
    // "valor a cobrar" = bloco PEDIDO_FIRME_2.1 (mesma definição de auditAvistaMes,
    // não diferença<0 crua — evita contar diffs sub-EPS já classificados OK).
    if (r.bloco === "PEDIDO_FIRME_2.1") {
      subpagamentos += 1;
      somaSubpagamento += -r.diferenca;
    }
  }

  const fme = fetched.fmeValorAvista;
  const deltaAbs = fme != null ? fetched.somaCashFechamentoMes - fme : null;
  const deltaPct =
    fme != null && fme !== 0 ? (deltaAbs as number) / fme : null;

  return {
    ym: fetched.ym,
    regime: enq.regime,
    contagem: fetched.contagem,
    itens: fetched.itens,
    resultados,
    naoAuditados,
    resumo: {
      auditados: resultados.length,
      subpagamentos,
      somaSubpagamento,
      porStatus,
      somaComissaoDevida,
      somaComissaoPaga,
    },
    reconciliacao: {
      somaCashFechamentoMes: fetched.somaCashFechamentoMes,
      fmeValorAvista: fme,
      deltaAbs,
      deltaPct,
    },
  };
}
