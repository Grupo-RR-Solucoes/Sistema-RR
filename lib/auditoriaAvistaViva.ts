// ============================================================================
// Auditoria à vista VIVA — FECHAMENTO-PRIMÁRIO.
//
// UNIVERSO = monthly_closing_entries CASH do mês (o que a Promotiva PAGOU à
// vista). O metadata do CASH tem 100% dos campos da engine (TX JUROS, PARCELA,
// DESCRIÇÃO DO PRODUTO, CONVÊNIO, VALOR LÍQUIDO, COMISSÃO PF, RESTRIÇÃO SRCC) e
// reproduz o congelado v9 exatamente (abr/2026: 497/497). Vantagens vs a diária:
//   - é o documento oficial do PAGO (verdade do caixa);
//   - existe TODO mês (a diária pode faltar, ex: maio/2026);
//   - exclui SRCC/não-pagos por CONSTRUÇÃO (não estão no fechamento) → resolve o
//     falso-positivo SRCC (ex: 210100613) sem heurística.
//
// A diária é ENRIQUECIMENTO opcional: (i) volume exato p/ a faixa, (ii) lane
// SEPARADA "produzido não pago" (reconciliação — timing/SRCC/cancelado), NUNCA
// subpagamento automático.
//
// A engine auditAvistaContrato NÃO muda. READ-ONLY (não escreve nada).
// ============================================================================

import {
  auditAvistaContrato,
  type ContratoAvista,
  type MesContextAvista,
  type ResultadoFase2Cash,
} from "./auditoriaAvista.ts";
import {
  loadConvenioSegmentoRef,
  normConvenio,
  type ConvenioRef,
} from "./convenioSegmento.ts";
import { auditEnquadramentoMes } from "./enquadramento.ts";
import { getProductionBandByValue, inferCreditTable } from "./motor.ts";
import {
  getProductionPeriodFromValue,
  getProductionPeriodKey,
} from "./productionPeriod.ts";

// tableKeys cujo roteamento DEPENDE de público/privado (segmento). Sem segmento
// conhecido (convênio fora da tabela convenio_segmento) → "a confirmar".
const SEGMENT_SENSITIVE = new Set([
  "PUBLICO_GERAL",
  "PRIVADO",
  "PORTABILIDADE_PUBLICO",
  "PORTABILIDADE_PRIVADO",
]);

type SupabaseLike = { from: (t: string) => any };

const PAGE = 1000;

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
function num(v: unknown): number {
  // numérico simples (campos já tipados / ponto decimal — metadata vem limpo).
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
/** "000001640" → 1640. */
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
/** Lê um campo do metadata por alias (case/acento-insensível). */
function mget(meta: Record<string, unknown> | null | undefined, aliases: string[]): unknown {
  if (!meta) return undefined;
  for (const a of aliases) {
    const wa = normalizeText(a);
    const found = Object.entries(meta).find(([k]) => normalizeText(k) === wa);
    if (found) return found[1];
  }
  return undefined;
}

const A_TX = ["TX JUROS", "TAXA", "TAXA MENSAL DE JUROS"];
const A_PARCELA = ["PARCELA", "PARCELAS", "PRAZO"];
const A_PRODUTO = ["DESCRIÇÃO DO PRODUTO", "DESCRICAO DO PRODUTO", "PRODUTO", "NOME DO PRODUTO"];
const A_CONVENIO = ["CONVÊNIO", "CONVENIO", "CÓDIGO CONVÊNIO", "CODIGO CONVENIO"];
const A_LIQUIDO = ["VALOR LÍQUIDO", "VALOR LIQUIDO", "VALOR FINANCIADO LÍQUIDO"];
const A_BRUTO = ["VALOR BRUTO", "VALOR FINANCIADO"];
const A_SRCC = ["RESTRIÇÃO SRCC", "RESTRICAO SRCC", "INDICADOR RESTRIÇÃO SRCC"];

// inferCreditTable (motor, paridade frente2) → tableKey → produto canônico que
// categoriasCandidatasFor (a engine) roteia para a MESMA categoria.
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

/**
 * Deriva produto (vocabulário v9) + tipo (NOVO/RENOVACAO) reusando o roteador
 * validado do motor (inferCreditTable). O CASH não traz convenio_segment, então
 * o segmento (público/privado) vem de `segmentByConvenio` (mapa convênio→segmento
 * construído da diária histórica — convênio→segmento é estável).
 */
function deriveProdutoTipo(args: {
  productDescription: string | null;
  convenioCode: unknown;
  netValue: number;
  grossValue: number;
  taxa: number;
  prazo: number;
  segment: string | number | null;
}): { tableKey: string; produto: string; tipo: "NOVO" | "RENOVACAO" } {
  const tableKey = inferCreditTable({
    valor_liquido: args.netValue,
    valor_bruto: args.grossValue,
    valor_seguro: 0,
    taxa_juros: args.taxa,
    prazo: args.prazo,
    tem_seguro: false,
    product_code: null,
    product_description: args.productDescription,
    convenio_code: args.convenioCode as string | number | null,
    convenio_type: null,
    convenio_segment: args.segment,
  });
  const desc = String(args.productDescription ?? "").toUpperCase();
  const isRefin =
    tableKey === "INSS_RENOVACAO" || desc.includes("REFIN") || desc.includes("RENOVA");
  return {
    tableKey,
    produto: TABLEKEY_TO_PRODUTO[tableKey] ?? tableKey,
    tipo: isRefin ? "RENOVACAO" : "NOVO",
  };
}

async function fetchAll<T>(build: () => any): Promise<T[]> {
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

type CashRow = {
  company_cnpj: string | null;
  contract_number: string | null;
  commission_value: number | null;
  net_value: number | null;
  gross_value: number | null;
  metadata: Record<string, unknown> | null;
};
type DailyRow = {
  proposal_number: string | null;
  company_id: string | null;
  convenio_code: string | null;
  convenio_segment: string | number | null;
  net_value: number | null;
  contract_date: string | null;
  is_srcc_restricted: boolean | null;
};

export interface ContratoAuditavel {
  operacao: string;
  contrato: ContratoAvista;
}
export interface ProduzidoNaoPago {
  operacao: string;
  empresa: string;
  valorLiquido: number;
  idadeMeses: number;
  maduro: boolean;
}
/** Contrato cujo roteamento depende de público/privado e o convênio não está
 *  na tabela convenio_segmento → fora da cobrança até confirmar o segmento. */
export interface SegmentoAConfirmar {
  operacao: string;
  empresa: string;
  convenio: number | null;
  produto: string | null;
  valorLiquido: number;
  comissaoPaga: number;
}

export interface AuditAvistaVivoResult {
  ym: string;
  regime: string;
  fonte: "FECHAMENTO";
  /** Contratos no universo auditado (CASH pago, ex-SRCC). */
  universo: number;
  /** Linhas CASH excluídas pela guarda SRCC (RESTRIÇÃO SRCC ≠ Não). */
  srccExcluidos: number;
  diariaDisponivel: boolean;
  faixa: { faixa: string; base: "diaria" | "fechamento"; volume: number };
  /** Insumos auditados (operação + ContratoAvista) p/ enriquecimento/diag. */
  itensAuditados: ContratoAuditavel[];
  /** Contratos público/privado-sensíveis sem segmento na tabela (fora da cobrança). */
  segmentoAConfirmar: SegmentoAConfirmar[];
  resultados: ResultadoFase2Cash[];
  resumo: {
    auditados: number;
    subpagamentos: number;
    somaSubpagamento: number;
    porStatus: Record<string, number>;
    somaComissaoDevida: number;
    somaComissaoPaga: number;
  };
  /** Lane SEPARADA de reconciliação (só quando há diária do mês). */
  reconciliacao: {
    produzidoNaoPago: ProduzidoNaoPago[];
    nMaduro: number;
    nRecente: number;
  };
  batimento: {
    somaCashFechamentoMes: number;
    fmeValorAvista: number | null;
    deltaAbs: number | null;
    deltaPct: number | null;
  };
}

/**
 * Audita a competência ao vivo, FECHAMENTO-PRIMÁRIO. Universo = CASH do mês.
 */
export async function auditAvistaMesVivo(
  sb: SupabaseLike,
  year: number,
  month: number,
  opts: { maturidadeMeses?: number; refMap?: Map<string, ConvenioRef> } = {}
): Promise<AuditAvistaVivoResult> {
  const maturidade = opts.maturidadeMeses ?? 2;
  const ym = getProductionPeriodKey(year, month);

  // Tabela de verdade convênio→segmento/categoria. Override (sim/teste) ou
  // carrega de convenio_segmento; tabela ausente → mapa vazio (seguro).
  const refMap = opts.refMap ?? (await loadConvenioSegmentoRef(sb));

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

  const [companies, cash, daily, fme] = await Promise.all([
    fetchAll<{ cnpj: string; name: string }>(() => sb.from("companies").select("cnpj, name")),
    // UNIVERSO PRIMÁRIO — CASH pago do mês.
    fetchAll<CashRow>(() =>
      sb
        .from("monthly_closing_entries")
        .select("company_cnpj, contract_number, commission_value, net_value, gross_value, metadata")
        .eq("entry_type", "CASH")
        .eq("year", year)
        .eq("month", month)
        .gt("commission_value", 0)
    ),
    // Diária (toda) — enriquecimento: faixa exata + lane produzido-não-pago +
    // mapa convênio→segmento (público/privado) que o CASH não tem.
    fetchAll<DailyRow>(() =>
      sb
        .from("daily_production_records")
        .select(
          "proposal_number, company_id, convenio_code, convenio_segment, net_value, contract_date, is_srcc_restricted"
        )
    ),
    fetchAll<{ valor_avista: number }>(() =>
      sb
        .from("fechamento_mensal_empresa")
        .select("valor_avista")
        .eq("ano", year)
        .eq("mes", month)
    ),
  ]);

  const companyByCnpj = new Map(
    companies.map((c) => [String(c.cnpj).replace(/\D/g, ""), c.name])
  );

  // Diária da competência (produção) — p/ faixa exata e lane produzido-não-pago.
  const dailyMes = daily.filter((d) => {
    const p = getProductionPeriodFromValue(d.contract_date);
    return p ? getProductionPeriodKey(p.year, p.month) === ym : false;
  });
  const diariaDisponivel = dailyMes.length > 0;

  // FAIXA — banda do volume do mês. Preferir o volume EXATO da diária quando há;
  // senão a soma de VALOR LÍQUIDO do fechamento (proxy validado: abr → FAIXA 3).
  const volDiaria = dailyMes.reduce(
    (s, d) => (d.is_srcc_restricted ? s : s + num(d.net_value)),
    0
  );
  const volFechamento = cash.reduce((s, c) => s + num(c.net_value), 0);
  const faixaBase: "diaria" | "fechamento" = diariaDisponivel ? "diaria" : "fechamento";
  const volProducao = diariaDisponivel ? volDiaria : volFechamento;
  const faixaMes = bandToFaixa(getProductionBandByValue(volProducao));

  // Idade (maturidade) da competência.
  const nowKey = (() => {
    const d = new Date();
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  })();
  const idadeMeses = nowKey - (year * 12 + (month - 1));

  // ---- Monta ContratoAvista do CASH (universo) + guarda SRCC + segmento ----
  const itensAuditados: ContratoAuditavel[] = [];
  const segmentoAConfirmar: SegmentoAConfirmar[] = [];
  const cashOps = new Set<string>();
  let srccExcluidos = 0;
  let somaCashFechamentoMes = 0;

  for (const c of cash) {
    const opKey = normalizeOperationId(c.contract_number);
    if (!opKey) continue;
    somaCashFechamentoMes += num(c.commission_value);

    // GUARDA SRCC redundante (no fechamento já é ~vazio).
    const srcc = normalizeOperationId(mget(c.metadata, A_SRCC));
    if (srcc && srcc !== "NAO" && srcc !== "NAOSEAPLICA") {
      srccExcluidos += 1;
      continue;
    }
    cashOps.add(opKey);

    const convenio = convenioToNumber(mget(c.metadata, A_CONVENIO));
    // Segmento vem da TABELA de verdade (convenio_segmento). Convênio ausente →
    // segment null → se o roteamento depender de público/privado, vira
    // "a confirmar" (NUNCA chute de público).
    const ref =
      convenio != null ? refMap.get(normConvenio(convenio) ?? "") : undefined;
    const segment: string | null =
      ref?.segmento === "PRIVADO" ? "2" : ref?.segmento === "PUBLICO" ? "1" : null;
    const valorLiquido = num(c.net_value) || num(mget(c.metadata, A_LIQUIDO));
    const grossValue = num(c.gross_value) || num(mget(c.metadata, A_BRUTO)) || valorLiquido;
    const taxa = num(mget(c.metadata, A_TX));
    // PARCELA = prazo TRP. RESSALVA 13º: ADIANTAMENTO_13 usa "Prazo", não
    // "Parcelas"; o CASH só traz PARCELA — validar quando aparecer 13º (em
    // abr/2026 PARCELA == prazo do congelado bateu 497/497, incl. 13º).
    const prazo = Math.trunc(num(mget(c.metadata, A_PARCELA)));
    const comissaoPaga = num(c.commission_value);

    const { tableKey, produto, tipo } = deriveProdutoTipo({
      productDescription: (mget(c.metadata, A_PRODUTO) as string) ?? null,
      convenioCode: convenio,
      netValue: valorLiquido,
      grossValue,
      taxa,
      prazo,
      segment,
    });

    const empresa =
      companyByCnpj.get(String(c.company_cnpj ?? "").replace(/\D/g, "")) ?? "";

    // Roteamento depende de público/privado E segmento desconhecido (convênio
    // fora da tabela) → "a confirmar", fora da cobrança.
    if (SEGMENT_SENSITIVE.has(tableKey) && segment == null) {
      segmentoAConfirmar.push({
        operacao: String(c.contract_number ?? ""),
        empresa,
        convenio,
        produto: (mget(c.metadata, A_PRODUTO) as string) ?? null,
        valorLiquido,
        comissaoPaga,
      });
      continue;
    }

    const contrato: ContratoAvista = {
      contractNumber: String(c.contract_number ?? ""),
      empresa,
      cnpj: c.company_cnpj ? String(c.company_cnpj).replace(/\D/g, "") : null,
      mes: ym, // competência do FECHAMENTO (o pago).
      produto,
      tipo,
      convenio,
      txJuros: taxa,
      prazo,
      catAplicada: faixaMes,
      valorLiquido,
      pctAplicado: valorLiquido > 0 ? comissaoPaga / valorLiquido : 0,
      comissaoPaga,
      srccRestricao: false, // SRCC já excluído do universo.
      padraoDExclusao: false,
      padraoDMotivo: null,
    };
    itensAuditados.push({ operacao: contrato.contractNumber, contrato });
  }

  // ---- Roda a engine (intacta) sobre o universo ----
  const resultados = itensAuditados.map((it) =>
    auditAvistaContrato(it.contrato, mesContext)
  );

  const porStatus: Record<string, number> = {};
  let subpagamentos = 0;
  let somaSubpagamento = 0;
  let somaComissaoDevida = 0;
  let somaComissaoPaga = 0;
  for (const r of resultados) {
    porStatus[r.statusFase2] = (porStatus[r.statusFase2] ?? 0) + 1;
    somaComissaoDevida += r.comissaoDevida;
    somaComissaoPaga += r.comissaoDevida + r.diferenca;
    if (r.bloco === "PEDIDO_FIRME_2.1") {
      subpagamentos += 1;
      somaSubpagamento += -r.diferenca;
    }
  }

  // ---- Lane de reconciliação: produzido-não-pago (só quando há diária) ----
  const produzidoNaoPago: ProduzidoNaoPago[] = [];
  if (diariaDisponivel) {
    for (const d of dailyMes) {
      const opKey = normalizeOperationId(d.proposal_number);
      if (!opKey || cashOps.has(opKey)) continue;
      produzidoNaoPago.push({
        operacao: String(d.proposal_number ?? ""),
        empresa: d.company_id ? "" : "",
        valorLiquido: num(d.net_value),
        idadeMeses,
        maduro: idadeMeses >= maturidade,
      });
    }
  }
  const nMaduro = produzidoNaoPago.filter((p) => p.maduro).length;
  const nRecente = produzidoNaoPago.length - nMaduro;

  const fmeValorAvista = fme.length
    ? fme.reduce((s, r) => s + num(r.valor_avista), 0)
    : null;
  const deltaAbs = fmeValorAvista != null ? somaCashFechamentoMes - fmeValorAvista : null;
  const deltaPct =
    fmeValorAvista != null && fmeValorAvista !== 0
      ? (deltaAbs as number) / fmeValorAvista
      : null;

  return {
    ym,
    regime: enq.regime,
    fonte: "FECHAMENTO",
    universo: itensAuditados.length,
    srccExcluidos,
    diariaDisponivel,
    faixa: { faixa: faixaMes, base: faixaBase, volume: volProducao },
    itensAuditados,
    segmentoAConfirmar,
    resultados,
    resumo: {
      auditados: resultados.length,
      subpagamentos,
      somaSubpagamento,
      porStatus,
      somaComissaoDevida,
      somaComissaoPaga,
    },
    reconciliacao: { produzidoNaoPago, nMaduro, nRecente },
    batimento: { somaCashFechamentoMes, fmeValorAvista, deltaAbs, deltaPct },
  };
}

/** Divergência cobrável à vista (subpagamento, bloco PEDIDO_FIRME_2.1) já
 *  enriquecida com os insumos do contrato. Forma única consumida pela rota de
 *  conferência (avista-viva) e pela minuta de cobrança (avista-cobranca). */
export interface DivergenciaCobravel {
  contrato: string;
  empresa: string;
  cnpj: string | null;
  produto: string | null;
  txJuros: number;
  prazo: number;
  valorLiquido: number;
  comissaoPaga: number;
  comissaoDevida: number;
  diferenca: number;
  pctDevido: number | null;
  regraTrp: string;
}

/** Extrai as divergências cobráveis (subpagamentos à vista) do resultado da
 *  auditoria viva, ordenadas por diferença asc (maiores subpagamentos primeiro).
 *  Fonte única — evita duplicar a lógica entre rota de conferência e minuta. */
export function extrairDivergenciasCobravel(
  r: AuditAvistaVivoResult
): DivergenciaCobravel[] {
  const inputByOp = new Map(r.itensAuditados.map((i) => [i.operacao, i.contrato]));
  return r.resultados
    .filter((x) => x.bloco === "PEDIDO_FIRME_2.1")
    .map((x) => {
      const c = inputByOp.get(x.contractNumber);
      const t = x.trace;
      const regraTrp =
        [t.categoriaProduto, t.tabLabelUsado].filter(Boolean).join(" ") ||
        (t.celula ?? "—");
      return {
        contrato: x.contractNumber,
        empresa: c?.empresa ?? "",
        cnpj: c?.cnpj ?? null,
        produto: c?.produto ?? null,
        txJuros: c?.txJuros ?? 0,
        prazo: c?.prazo ?? 0,
        valorLiquido: c?.valorLiquido ?? 0,
        comissaoPaga: c?.comissaoPaga ?? 0,
        comissaoDevida: x.comissaoDevida,
        diferenca: x.diferenca,
        pctDevido: x.pctDevido,
        regraTrp,
      };
    })
    .sort((a, b) => a.diferenca - b.diferenca);
}
