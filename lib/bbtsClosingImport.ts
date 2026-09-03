import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeDailyProductionRecords } from "./dailyRecordMerge.ts";
import {
  propostasAlvoDoFechamento,
  propostasComCarimboPosterior,
  type PropostaCarimboPosterior,
} from "@/lib/bbts/carimboPosterior";
import {
  FONTE_FECHAMENTO_ADS,
  traduzirValorFechamento,
  type ValorResolucao as ValorResolucaoSrcc,
} from "./srccResolucao.ts";
// LACUNA DE GLIFO: o PDF do fechamento engole ligaduras (ver
// lib/bbts/normalizarTextoPdf.ts). A eleicao e feita AQUI, e nao no extrator,
// porque so aqui ha banco para montar o vocabulario atestado.
import {
  construirVocabulario,
  resolverLacunas,
  type DecisaoLacuna,
  type Vocabulario,
} from "@/lib/bbts/normalizarTextoPdf";

// ============================================================================
// bbtsClosingImport — CARGA do FECHAMENTO BBTS (junho/2026) em
// daily_production_records, company ADS, chave JJ552710 -> MASTER -> balde
// (assigned_promoter_id NULL), para a aba Migração listar e atribuir.
//
// FONTE: o fechamento BBTS de junho só existe em PDF (Crédito_ADS + Seguro_ADS).
// Este módulo NÃO parseia PDF: recebe as linhas JÁ ESTRUTURADAS (o extrator
// PDF->linhas, ancorado em rótulos, é acoplado depois — a lição do TRP-por-PDF é
// nunca confiar em posição fixa e SEMPRE validar contra âncora antes de gravar).
//
// VALIDAÇÃO DE ÂNCORA (aborta sem gravar se não fechar): Σ Valor Financiado,
// Σ pag à vista BBTS e Σ seguro 'calculo' têm de bater os totais do PDF. Se
// qualquer um divergir além da tolerância, LANÇA e NÃO grava nada (nunca parcial).
//
// SEGURO por tratamento: só 'calculo' (positivos) entra como insurance_value da
// produção (BBTS-2c calcula 0,10/0,35 sobre a base). 'debito' (estornos/cancelados)
// NÃO entra na produção — é débito do promotor (frente promoter_monthly_debits
// futura), devolvido em result.debitos. Seguro 'calculo' SEM crédito no mês vira
// linha de produção só-seguro (chave JJ552710 -> balde).
//
// SRCC: o PDF traz o código oficial (1=restrição, 2=não, 3=consulta não realizada,
// 4=n/a). O booleano is_srcc_restricted continua saindo SÓ do cd=1 — é o que o
// cálculo consulta. A RESPOSTA (inclusive as negativas) vai para a coluna
// srcc_resolucao, que é o que a tela lê e o que sobrevive a uma reimportação da
// diária. O cd=3 não grava nada: fica indefinido (âmbar), esperando resposta.
//
// NÃO calcula comissão — só carrega a produção (crédito recalcula pela TRP e
// seguro pela régua BBTS no consolidador BBTS-2c). READ das refs + WRITE só em
// daily_production_records (+ daily_imports para rastreio). onConflict idempotente.
// ============================================================================

export const BBTS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef"; // ADS
export const BBTS_MASTER_KEY = "JJ552710";

// Âncoras do fechamento BBTS junho/2026 (validadas contra o PDF pelo Diego).
export const BBTS_JUNHO_ANCHORS = {
  propostas: 18,
  valorFinanciado: 266210.84,
  pagAvista: 7707.03,
  // Só o seguro tratamento='calculo' entra na produção comissionável (âncora).
  // O tratamento='debito' (Σ -41,53) NÃO é produção — é débito do promotor.
  seguroCalculo: 99.64,
};

// ---- entrada estruturada (o que o extrator PDF->linhas deve produzir) --------

export type BbtsCreditoRow = {
  contrato: string; // nº do contrato = proposal_number
  valor_financiado: number; // base do crédito BBTS
  pag_avista: number; // "pag à vista" do relatório — SÓ p/ validar âncora (não é comissão)
  data: string; // data da proposta (junho/2026) — "08/06/2026" ou ISO
  taxa_relatorio?: number | null; // % do relatório BBTS (ex 2,87) — IGNORADO no cálculo (junho usa TRP)
  srcc_cd?: number | null; // 1=restrição, 2=não, 3=consulta não realizada, 4=n/a
  chave_j?: string | null; // default JJ552710
  produto?: string | null; // "Consignado Novo Correntista"
  linha_credito?: string | null; // "Crédito Novo" / "Renovação"
  segmento?: string | null; // PUBLICO / PRIVADO
  nr_convenio?: string | number | null; // 1640 = INSS
  categoria?: string | null; // "INSS Novo"
  juros_mensal?: number | null; // 1,85 (taxa mensal p/ a TRP no BBTS-2c)
  parcelas?: number | null; // 108
  prazo_operacao?: number | null; // "Prazo da Operação" (109) — a tabela BBTS indexa 13o/FGTS por PRAZO, não por parcelas
  cancelamento?: boolean | null; // Cancelamento == SIM
};

export type BbtsSeguroRow = {
  contrato: string; // casa com o crédito
  valor_total_credito: number; // base da régua BBTS (0,10 ESTOQUE D0 / 0,35 SLIP)
  tipo?: string | null; // "ESTOQUE D0" / "SLIP"
  valor_seguro: number; // valor do relatório — SÓ p/ validar âncora
  tratamento?: string | null; // "calculo" => entra na produção; "debito" => fora (débito do promotor)
};

/**
 * Uma parcela do PAGAMENTO PRT (seção "Propostas do PAGAMENTO PRT" do PDF).
 *
 * O PRT é a 2a PERNA do pagamento da BBTS: pela tabela (pág. 8), o recebimento à
 * vista é capado em 6% e o EXCEDENTE é pago a prazo — "diferença percentual a
 * receber dividido pelo prazo da operação". Uma linha por contrato por mês.
 * Os contratos aqui são ANTIGOS (de competências passadas), não os do AVT do mês.
 */
export type BbtsPrtRow = {
  contrato: string;
  data: string; // data do pagamento da parcela ("01/07/2026")
  n_parcela: number; // nº da parcela paga neste mês
  valor_parcela: number;
  qt_parcela?: number | null; // total de parcelas (o PDF traz "#N/D" em algumas)
};

export type BbtsClosingInput = {
  year: number;
  month: number;
  credito: BbtsCreditoRow[];
  seguro?: BbtsSeguroRow[];
  prt?: BbtsPrtRow[];
  /**
   * Cabeçalho "Valor para Emissão da Nota Fiscal" do PDF de crédito, pareado
   * rótulo<->valor (ver extractCabecalhoNf). A "Abertura de Conta" vinha daqui e
   * era JOGADA FORA — R$ 100,00 em jul/2026, que é exatamente o que faltava para
   * o card bater com o PDF. O tipo é declarado inline, e não importado de
   * bbtsPdfExtract, porque aquele módulo já importa ESTE (evita o ciclo).
   */
  cabecalho?: {
    rotulos: Array<{ rotulo: string; valor: number }>;
    pagamentoAvt: number;
    pagamentoPrt: number;
    aberturaConta: number;
    outrasDeducoes: number;
    pagamentoTotal: number;
  };
  /**
   * true quando o PDF de SEGURO não foi enviado. NÃO é o mesmo que "veio e estava
   * vazio": as âncoras saem do próprio arquivo, então sem esta bandeira ausência e
   * zero são indistinguíveis (medido 27/08/2026: importar só o crédito de julho
   * passava com ancora_ok=true e zerava 12 linhas, R$ 115,10 de bbts_seguro_pago e
   * R$ 113.345,57 de insurance_value). Com ela, o registro OMITE as colunas de
   * seguro — e omitir, no merge por dono de coluna, é literalmente "não tocar".
   */
  seguro_pdf_ausente?: boolean;
  // Âncoras declaradas pela própria extração (self-describing). Se presente,
  // sobrepõe o const hardcoded — o arquivo v3 traz 19 propostas / 271.210,84.
  _ancoras?: {
    credito_propostas?: number;
    credito_valor_financiado?: number;
    credito_pag_avista?: number;
    seguro_calculo?: number;
    /**
     * Ancora TOTAL do PDF de seguro = o que a BBTS DEPOSITOU (calculo menos
     * estorno). Diferente de `seguro_calculo`, que e so a soma das linhas
     * positivas. Em julho/2026: seguro_calculo 204,52, seguro_total 155,07.
     */
    seguro_total?: number;
    prt_valor?: number;
  };
};

export type BbtsClosingResult = {
  dry_run: boolean;
  ancora_ok: boolean;
  propostas: number;
  soma_valor_financiado: number;
  soma_pag_avista: number;
  soma_seguro_calculo: number; // tratamento='calculo' (entra na produção)
  soma_seguro_debito: number; // tratamento='debito' (fora da produção)
  master_balde: number;
  individual: number;
  canceladas: number;
  srcc_restritas: number;
  /**
   * A RESPOSTA do fechamento sobre o SRCC, gravada em srcc_resolucao. Separado
   * de srcc_restritas de propósito: aquele conta só o cd=1 (o que tira a linha
   * da conta); este conta o que a BBTS RESPONDEU, inclusive as negativas.
   * `indefinidas` = cd=3 (consulta não realizada) + linhas sem o código: não
   * gravam resolução e continuam em âmbar, que é a informação correta sobre elas.
   */
  srcc_resolucoes: Record<ValorResolucaoSrcc, number> & { indefinidas: number };
  com_seguro: number; // linhas de produção que receberam insurance_value
  seguro_only_lines: number; // linhas de produção criadas só p/ seguro órfão (sem crédito)
  debitos: Array<{ contrato: string; valor_seguro: number; tipo: string | null }>; // fora da produção
  prt_parcelas: number; // linhas da seção PRT gravadas em bbts_prt_parcelas
  abertura_conta: number; // "Abertura de Conta" do cabeçalho da NF (0 quando não há)
  cabecalho_gravado: boolean; // gravou em bbts_fechamento_totais
  seguro_pdf_ausente: boolean; // o PDF de seguro NÃO foi enviado nesta importação
  prt_valor: number; // Σ das parcelas PRT do mês
  gravadas: number;
  /**
   * id da linha de daily_imports criada por ESTE import (null em dryRun ou sem
   * registros). E por ele que o rastro de pos-import (import_pos_diag) amarra a
   * foto ao evento — a ADS nao passa por monthly_closing_imports.
   */
  daily_import_id: string | null;
  /**
   * Propostas EXCLUIDAS da gravacao por ja estarem carimbadas em competencia
   * POSTERIOR a esta. Sempre preenchido — a rota recusa com 409 quando nao
   * vazio e sem confirmacao, mas a exclusao acontece SEMPRE, confirmada ou
   * nao: a confirmacao autoriza importar o RESTO, nunca sobrescrever.
   */
  puladas_carimbo_posterior: PropostaCarimboPosterior[];
  ancora_detalhe: Record<string, { esperado: number; obtido: number; delta: number; ok: boolean }>;
  amostra: Array<Record<string, unknown>>;
};

// ---- helpers ----------------------------------------------------------------

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normText(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

function parseDateBR(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

class BbtsAnchorError extends Error {}


// ---------------------------------------------------------------------------
// VOCABULARIO ATESTADO — as tres fontes, medidas em 03/08/2026:
//   corpus-banco        product_description das linhas NAO-ADS (vem de XLSX,
//                       nunca passou por PDF). 10 palavras, atesta CORRENTISTA
//                       (1713x), AUTOMATICO (89x), BENEFICIO (105x).
//   regua-competencia   titulos/celulas da tabela BBTS da competencia
//                       (bbts_rule_versions). ZERO caractere de controle —
//                       outro pipeline de geracao na BBTS.
//   celula-integra-pdf  as celulas do proprio fechamento que vieram sem lacuna.
//
// Falhar aqui NAO derruba o import: sem vocabulario, as lacunas simplesmente se
// mantem, que e o comportamento seguro.
// ---------------------------------------------------------------------------
async function montarVocabularioAtestado(
  supabase: SupabaseClient,
  competencia: string | null,
  celulasIntegras: string[],
): Promise<Vocabulario> {
  const corpus: string[] = [];
  try {
    const { data } = await supabase
      .from("daily_production_records")
      .select("company_id, product_description")
      .neq("company_id", BBTS_COMPANY_ID)
      .limit(5000);
    for (const r of data ?? []) if (r.product_description) corpus.push(String(r.product_description));
  } catch {
    // sem corpus: segue com as outras fontes
  }

  const regua: string[] = [];
  try {
    let q = supabase.from("bbts_rule_versions").select("regra_json").eq("is_active", true);
    if (competencia) q = q.eq("competencia", competencia);
    const { data } = await q.limit(3);
    for (const v of data ?? []) {
      const rj = (v as { regra_json?: Record<string, unknown> }).regra_json ?? {};
      const grupos = (rj.grupos ?? {}) as Record<string, { titulo?: string; celulas?: Array<{ _origem?: string }> }>;
      for (const g of Object.values(grupos)) {
        if (g.titulo) regua.push(g.titulo);
        for (const c of g.celulas ?? []) if (c._origem) regua.push(c._origem);
      }
      const convs = (rj.convenios ?? {}) as Record<string, { nome?: string }>;
      for (const c of Object.values(convs)) if (c.nome) regua.push(c.nome);
    }
  } catch {
    // sem regua: segue com as outras fontes
  }

  return construirVocabulario([
    { textos: corpus, fonte: "corpus-banco" },
    { textos: regua, fonte: "regua-competencia" },
    { textos: celulasIntegras, fonte: "celula-integra-pdf" },
  ]);
}

// ---- carga ------------------------------------------------------------------

/**
 * Carrega o fechamento BBTS (linhas estruturadas) em daily_production_records.
 * Valida as âncoras ANTES de qualquer escrita; se não fecharem, lança
 * BbtsAnchorError e NÃO grava (nem em dry-run nem gravando). dryRun=true (default)
 * só mapeia/valida. Idempotente (upsert onConflict company_id,proposal_number).
 */
export async function importBbtsClosing(
  supabase: SupabaseClient,
  input: BbtsClosingInput,
  opts?: { dryRun?: boolean; anchors?: typeof BBTS_JUNHO_ANCHORS; tolerance?: number; fileName?: string }
): Promise<BbtsClosingResult> {
  const dryRun = opts?.dryRun !== false; // default: dry-run

  // ---- LACUNA DE GLIFO: eleicao por evidencia antes de mapear -------------
  // As celulas do PDF chegam com U+FFFD onde a ligadura se perdeu. Aqui montamos
  // o vocabulario ATESTADO (corpus do banco + regua da competencia + as celulas
  // integras deste proprio arquivo) e resolvemos SO o que uma unica ligadura
  // explica. O que ficar ambiguo ou sem atestacao MANTEM a lacuna — de proposito.
  const celulasIntegras: string[] = [];
  for (const r of input.credito ?? []) {
    for (const t of [r.categoria, r.produto, r.linha_credito]) {
      if (t && !String(t).includes("\uFFFD")) celulasIntegras.push(String(t));
    }
  }
  const compVocab =
    input.year && input.month
      ? `${input.year}-${String(input.month).padStart(2, "0")}-01`
      : null;
  const vocabAtestado = await montarVocabularioAtestado(supabase, compVocab, celulasIntegras);
  const decisoesGlifo: DecisaoLacuna[] = [];
  const resolverTexto = (t: string | null | undefined): string | null => {
    if (t == null) return null;
    const s0 = String(t);
    if (!s0.includes("\uFFFD")) return s0;
    const r = resolverLacunas(s0, vocabAtestado);
    decisoesGlifo.push(...r.decisoes);
    return r.texto;
  };
  for (const r of input.credito ?? []) {
    r.categoria = resolverTexto(r.categoria);
    r.produto = resolverTexto(r.produto);
    r.linha_credito = resolverTexto(r.linha_credito);
  }
  // Precedência: opts.anchors > _ancoras do arquivo > const hardcoded.
  const fileAnchors = input._ancoras
    ? {
        propostas: input._ancoras.credito_propostas ?? BBTS_JUNHO_ANCHORS.propostas,
        valorFinanciado: input._ancoras.credito_valor_financiado ?? BBTS_JUNHO_ANCHORS.valorFinanciado,
        pagAvista: input._ancoras.credito_pag_avista ?? BBTS_JUNHO_ANCHORS.pagAvista,
        seguroCalculo: input._ancoras.seguro_calculo ?? BBTS_JUNHO_ANCHORS.seguroCalculo,
      }
    : null;
  const anchors = opts?.anchors ?? fileAnchors ?? BBTS_JUNHO_ANCHORS;
  const tol = opts?.tolerance ?? 0.01;
  const { year, month, credito, seguro } = input;

  // 1. Split do seguro por tratamento e somatórios p/ âncora.
  const isCalculo = (s: BbtsSeguroRow) => normText(s.tratamento) === "CALCULO";
  const isDebito = (s: BbtsSeguroRow) => normText(s.tratamento) === "DEBITO";
  const seguroCalculo = (seguro ?? []).filter(isCalculo);
  const seguroDebito = (seguro ?? []).filter(isDebito);
  const somaValorFinanciado = round2(credito.reduce((a, r) => a + (Number(r.valor_financiado) || 0), 0));
  const somaPagAvista = round2(credito.reduce((a, r) => a + (Number(r.pag_avista) || 0), 0));
  const somaSeguroCalculo = round2(seguroCalculo.reduce((a, r) => a + (Number(r.valor_seguro) || 0), 0));
  const somaSeguroDebito = round2(seguroDebito.reduce((a, r) => a + (Number(r.valor_seguro) || 0), 0));

  const detalhe: BbtsClosingResult["ancora_detalhe"] = {
    propostas: { esperado: anchors.propostas, obtido: credito.length, delta: credito.length - anchors.propostas, ok: credito.length === anchors.propostas },
    valor_financiado: { esperado: anchors.valorFinanciado, obtido: somaValorFinanciado, delta: round2(somaValorFinanciado - anchors.valorFinanciado), ok: Math.abs(somaValorFinanciado - anchors.valorFinanciado) <= tol },
    pag_avista: { esperado: anchors.pagAvista, obtido: somaPagAvista, delta: round2(somaPagAvista - anchors.pagAvista), ok: Math.abs(somaPagAvista - anchors.pagAvista) <= tol },
    seguro_calculo: { esperado: anchors.seguroCalculo, obtido: somaSeguroCalculo, delta: round2(somaSeguroCalculo - anchors.seguroCalculo), ok: Math.abs(somaSeguroCalculo - anchors.seguroCalculo) <= tol },
  };
  const ancoraOk = Object.values(detalhe).every((d) => d.ok);

  // 2. Resolve a chave (deve ser MASTER na ADS) — reusa j_keys.
  const { data: jk, error: jkErr } = await supabase
    .from("j_keys")
    .select("j_key, promoter_id, key_type")
    .eq("active", true);
  if (jkErr) throw jkErr;
  const jkByValue = new Map<string, { promoter_id: string | null; key_type: string | null }>();
  for (const k of jk || []) {
    const key = String(k.j_key || "").trim().toUpperCase();
    if (key) jkByValue.set(key, { promoter_id: k.promoter_id ?? null, key_type: k.key_type ?? null });
  }

  // Só o seguro 'calculo' anexa como insurance_value da produção.
  const seguroByContrato = new Map<string, BbtsSeguroRow>();
  for (const s of seguroCalculo) seguroByContrato.set(String(s.contrato).trim(), s);

  // 3. Mapeia.
  const result: BbtsClosingResult = {
    dry_run: dryRun,
    ancora_ok: ancoraOk,
    propostas: credito.length,
    soma_valor_financiado: somaValorFinanciado,
    soma_pag_avista: somaPagAvista,
    soma_seguro_calculo: somaSeguroCalculo,
    soma_seguro_debito: somaSeguroDebito,
    master_balde: 0,
    individual: 0,
    canceladas: 0,
    srcc_restritas: 0,
    srcc_resolucoes: { SIM: 0, NAO: 0, NAO_SE_APLICA: 0, indefinidas: 0 },
    com_seguro: 0,
    seguro_only_lines: 0,
    daily_import_id: null,
    debitos: seguroDebito.map((s) => ({ contrato: String(s.contrato).trim(), valor_seguro: Number(s.valor_seguro) || 0, tipo: s.tipo ?? null })),
    prt_parcelas: 0,
    prt_valor: round2((input.prt ?? []).reduce((a, p) => a + (Number(p.valor_parcela) || 0), 0)),
    abertura_conta: Number(input.cabecalho?.aberturaConta) || 0,
    cabecalho_gravado: false,
    seguro_pdf_ausente: input.seguro_pdf_ausente === true,
    gravadas: 0,
    puladas_carimbo_posterior: [],
    ancora_detalhe: detalhe,
    amostra: [],
  };

  // Opção B: a competência do fechamento é a janela de apuração da Promotiva, não
  // a data literal de venda. movement_date recebe uma data representativa do mês
  // (dia 15 — getProductionPeriodFromValue a mapeia p/ a competência nominal; o
  // fim do mês poderia rolar p/ a competência seguinte). A data REAL de venda vai
  // p/ contract_date/proposal_date (preserva o histórico). extractYearMonth usa
  // movement_date primeiro, então todas as 18 caem na competência do fechamento.
  const compMovementDate = `${year}-${String(month).padStart(2, "0")}-15`;
  // COMPETENCIA DO FECHAMENTO, declarada em campo PROPRIO (dia 01).
  //
  // Ate 30/08/2026 a unica declaracao era o compMovementDate acima: dia 15 cai
  // dentro da janela da propria competencia, entao a data servia de carimbo. Isso
  // vale para toda linha que PASSA POR AQUI — e nao vale para linha que recebe
  // valor de fechamento por fora. Medido: a linha 5240028e nasceu do DIARIO (com
  // a data real, 31/07) e recebeu bbts_seguro_pago=89,42 por backfill em 28/08;
  // pela janela ela caiu em 2026-08, e os 89,42 sao do PDF de JULHO — julho
  // exibia 115,10 no lugar de 204,52.
  //
  // Agora a competencia do PAGAMENTO nao depende mais da data do CONTRATO. As
  // datas seguem sendo as do contrato (39 arquivos as leem, 23 resolvem
  // competencia por elas) e o dinheiro do PDF passa a dizer de onde veio.
  const compFechamento = `${year}-${String(month).padStart(2, "0")}-01`;
  // Carimbo ÚNICO da carga: todas as linhas resolvidas nesta importação dizem
  // "desde quando o sistema sabe disto" com o mesmo instante.
  const resolucaoEm = new Date().toISOString();

  const records: Record<string, unknown>[] = [];
  for (const r of credito) {
    const contrato = String(r.contrato).trim();
    if (!contrato) continue;
    const jKey = String(r.chave_j ?? BBTS_MASTER_KEY).trim();
    const jData = jkByValue.get(jKey.toUpperCase());

    let promoterId: string | null = null;
    let source = "UNIDENTIFIED";
    if (jData) {
      if (jData.key_type === "INDIVIDUAL") {
        promoterId = jData.promoter_id;
        source = "AUTO_J_KEY";
        result.individual += 1;
      } else {
        source = "MASTER_REASSIGNED"; // JJ552710 -> balde
        result.master_balde += 1;
      }
    }

    const cancelado = Boolean(r.cancelamento);
    if (cancelado) result.canceladas += 1;
    const srccCd = r.srcc_cd == null ? null : Math.trunc(Number(r.srcc_cd));
    // SÓ o cd=1 tira a linha da conta. Continua sendo a ÚNICA fonte de `true`:
    // "consulta não realizada" (3) NÃO é restrição, e o cálculo tem de contar a
    // produção normalmente. Todos os consumidores testam `=== true`/`!== true`
    // (isValidRecord, closingAnalytics, bbtsOrchestrator, projecaoMetas...), então
    // false e null são indistinguíveis para o dinheiro — a dúvida não cabe aqui.
    const isSrccRestricted = srccCd === 1;
    if (isSrccRestricted) result.srcc_restritas += 1;

    // A RESPOSTA da BBTS, em COLUNA — não só no booleano, não só no raw_payload.
    //
    // POR QUE COLUNA. O código vinha sendo gravado em raw_payload (`srcc_cd`) e em
    // __bbts_meta, e os dois são APAGÁVEIS por uma reimportação da diária: o
    // fechamento entra como owner FULL e a diária como CREDIT, e o mergeRawPayload
    // mescla __bbts_meta campo a campo — um `srcc_cd: null` da diária sobrescreve
    // o `srcc_cd: 2` do fechamento. É o mesmo padrão de apagamento silencioso que
    // o __bbts_meta já teve de corrigir uma vez (o "pago" da BBTS). A coluna
    // srcc_resolucao é IMUNE: não está em CREDIT_COLUMNS nem em INSURANCE_COLUMNS,
    // e ownedColumnsFor só deixa o dono escrever as colunas do seu conjunto — a
    // diária não alcança esta coluna nem por engano.
    //
    // O QUE O 3 FAZ AQUI: nada. traduzirValorFechamento devolve null para ele, os
    // três campos ficam FORA do registro, e a linha permanece indefinida (âmbar) —
    // o dono FULL só escreve as chaves que o registro traz (ownedColumnsFor:145),
    // então omitir é literalmente "não tocar", inclusive numa reimportação.
    const srccResolucao: ValorResolucaoSrcc | null =
      srccCd == null ? null : traduzirValorFechamento(String(srccCd));
    if (srccResolucao) result.srcc_resolucoes[srccResolucao] += 1;
    else result.srcc_resolucoes.indefinidas += 1;

    const seg = seguroByContrato.get(contrato);
    const seguroBase = seg ? Number(seg.valor_total_credito) || 0 : 0;
    if (seguroBase > 0) result.com_seguro += 1;

    const base = Number(r.valor_financiado) || 0;
    const dateIso = parseDateBR(r.data);

    records.push({
      company_id: BBTS_COMPANY_ID,
      j_key: jKey,
      promoter_id: promoterId,
      original_promoter_id: promoterId,
      assigned_promoter_id: promoterId,
      promoter_source: source,
      proposal_number: contrato,
      contract_number: contrato,
      // O ROTEAMENTO da auditoria (inferCreditTable) lê daqui. O "Nome do Convênio"
      // do PDF é o produto semântico ("INSS Novo", "INSS Renovação", "Não
      // Consignado - 13º salário"); a "Linha do Produto" é o fallback.
      product_description: r.categoria ?? r.produto ?? null,
      convenio_code: r.nr_convenio == null ? null : String(r.nr_convenio),
      convenio_type: r.linha_credito ?? null,
      convenio_segment: r.segmento ?? null,
      // Base do crédito BBTS = Valor Financiado (espelhado em gross e net).
      gross_value: base,
      net_value: base,
      // Seguro: base da régua BBTS (Valor Total do Crédito) fica em insurance_value;
      // o consolidador BBTS-2c aplica 0,10/0,35 sobre ela.
      //
      // SEM O PDF DE SEGURO, ESTAS CHAVES NÃO ENTRAM NO REGISTRO. O merge é por
      // DONO DE COLUNA e o dono aqui é FULL, que escreve TODA chave presente
      // (dailyRecordMerge.ts:193-198) — mandar zero significaria "a BBTS não pagou
      // seguro", que é uma AFIRMAÇÃO, e não é o que sabemos. Omitir é literalmente
      // "não tocar", o mesmo recurso que o srcc_resolucao já usa de propósito.
      // Medido em 27/08/2026 no fechamento de julho: mandar zero aqui zerava 12
      // linhas — R$ 115,10 de bbts_seguro_pago e R$ 113.345,57 de insurance_value.
      ...(input.seguro_pdf_ausente
        ? {}
        : {
            insurance_value: seguroBase,
            insurance_net_value: seguroBase,
            insurance_type: seg?.tipo ?? null,
            has_insurance: seguroBase > 0,
          }),
      interest_rate: r.juros_mensal ?? null,
      term_months: r.parcelas ?? null,
      installments: r.parcelas ?? null,
      // status='PRODUCAO' p/ passar em isEligibleProductionRecord (Migração/balde
      // e somas de produção só contam PRODUCAO). Cancelado fica CANCELADO (fora).
      status: cancelado ? "CANCELADO" : "PRODUCAO",
      proposal_date: dateIso, // data real de venda
      movement_date: compMovementDate, // competência do fechamento (Opção B)
      contract_date: dateIso, // data real de venda (preserva histórico)
      is_srcc_restricted: isSrccRestricted,
      // Os três campos entram JUNTOS ou não entram: uma conclusão sem procedência
      // não se confere. cd=3 (e ausência de código) não gera nenhum deles.
      ...(srccResolucao
        ? {
            srcc_resolucao: srccResolucao,
            srcc_resolucao_fonte: FONTE_FECHAMENTO_ADS,
            srcc_resolucao_em: resolucaoEm,
          }
        : {}),
      promoter_commission_amount: null,
      promoter_commission_percent: null,
      insurance_commission_amount: null,
      insurance_commission_percent: null,
      // O QUE A BBTS PAGOU — colunas de 1a classe (antes só em raw_payload/JSONB,
      // opaco p/ SQL e sujeito a ser apagado num merge). É o lado "pago" da
      // auditoria da ADS. Migration 20260712_000003.
      bbts_pag_avista: Number(r.pag_avista) || 0,
      // O CARIMBO ANDA COM O VALOR. Nunca gravar um sem o outro: e o par que o
      // CHECK dpr_valor_fechamento_exige_competencia cobra no banco.
      bbts_competencia_fechamento: compFechamento,
      bbts_taxa_relatorio: r.taxa_relatorio ?? null,
      // idem: sem o PDF de seguro a chave é OMITIDA, não zerada. Ver acima.
      ...(input.seguro_pdf_ausente
        ? {}
        : { bbts_seguro_pago: seg ? Number(seg.valor_seguro) || 0 : 0 }),
      raw_payload: {
        ...r,
        __bbts_meta: {
          fonte: "fechamento_pdf",
          cancelado,
          srcc_cd: srccCd,
          pag_avista_relatorio: Number(r.pag_avista) || 0,
          taxa_relatorio: r.taxa_relatorio ?? null,
          categoria: r.categoria ?? null,
          produto: r.produto ?? null,
          linha_credito: r.linha_credito ?? null,
          prazo_operacao: r.prazo_operacao ?? null,
          seguro_tipo: seg?.tipo ?? null,
          seguro_base: seguroBase,
          seguro_valor_relatorio: seg ? Number(seg.valor_seguro) || 0 : 0,
        },
      },
    });

    if (result.amostra.length < 3) {
      result.amostra.push({
        proposal_number: contrato,
        j_key: jKey,
        promoter_source: source,
        base,
        pag_avista: Number(r.pag_avista) || 0,
        convenio_code: r.nr_convenio,
        srcc_cd: srccCd,
        cancelado,
        seguro_base: seguroBase,
      });
    }
  }

  // 3b. Seguro 'calculo' SEM crédito correspondente (órfão, ex. 213983877):
  //     cria linha de produção SÓ-seguro (sem crédito), chave JJ552710 -> balde,
  //     p/ o BBTS-2c considerar o seguro. movement_date = competência (sem data
  //     própria) p/ cair no período da Migração.
  const contratosCredito = new Set(credito.map((r) => String(r.contrato).trim()));
  const jMaster = jkByValue.get(BBTS_MASTER_KEY.toUpperCase());
  for (const s of seguroCalculo) {
    const contrato = String(s.contrato).trim();
    if (!contrato || contratosCredito.has(contrato)) continue; // já anexou ao crédito
    const seguroBase = Number(s.valor_total_credito) || 0;
    const isMaster = !jMaster || jMaster.key_type !== "INDIVIDUAL";
    result.seguro_only_lines += 1;
    if (seguroBase > 0) result.com_seguro += 1;
    result.master_balde += isMaster ? 1 : 0;
    records.push({
      company_id: BBTS_COMPANY_ID,
      j_key: BBTS_MASTER_KEY,
      promoter_id: null,
      original_promoter_id: null,
      assigned_promoter_id: isMaster ? null : jMaster!.promoter_id,
      promoter_source: isMaster ? "MASTER_REASSIGNED" : "AUTO_J_KEY",
      proposal_number: contrato,
      contract_number: contrato,
      product_description: "SEGURO (sem credito no mes)",
      convenio_code: null,
      convenio_type: null,
      convenio_segment: null,
      gross_value: 0,
      net_value: 0,
      insurance_value: seguroBase,
      insurance_net_value: seguroBase,
      insurance_type: s.tipo ?? null,
      has_insurance: seguroBase > 0,
      interest_rate: null,
      term_months: null,
      installments: null,
      status: "PRODUCAO", // elegível no balde/somas (mesma regra do crédito)
      proposal_date: compMovementDate,
      movement_date: compMovementDate,
      contract_date: compMovementDate,
      // O QUE A BBTS PAGOU — mesma promoção a COLUNA que o bloco de crédito faz.
      // Sem isto o valor ficava só em raw_payload.__bbts_meta.seguro_valor_relatorio,
      // e os leitores da receita da ADS leem a COLUNA (dre.ts:348 e
      // financialAnalytics.ts:425) — somavam zero por esta linha. Medido em
      // 27/08/2026: 1 linha em todo o banco (contrato 221262790, R$ 89,42).
      // Não há pagamento à vista numa linha só-seguro: 0 aqui é o valor CERTO,
      // não "não sabemos".
      bbts_pag_avista: 0,
      bbts_seguro_pago: Number(s.valor_seguro) || 0,
      // idem bloco de credito: o carimbo anda com o valor.
      bbts_competencia_fechamento: compFechamento,
      // ATENÇÃO ao ler este `false`: ele diz "NÃO HÁ DADO DE SRCC nesta linha",
      // não "não há restrição". A linha só-seguro não tem crédito, então não tem
      // código de SRCC no relatório — é ausência de dado, não conclusão. Por isso
      // aqui NÃO se grava srcc_resolucao: não há o que concluir. O booleano fica
      // false porque é o que o cálculo precisa (a linha conta na produção) e
      // porque todos os consumidores testam `=== true`.
      is_srcc_restricted: false,
      promoter_commission_amount: null,
      promoter_commission_percent: null,
      insurance_commission_amount: null,
      insurance_commission_percent: null,
      raw_payload: {
        ...s,
        __bbts_meta: {
          fonte: "fechamento_pdf_seguro_only",
          cancelado: false,
          srcc_cd: null,
          seguro_tipo: s.tipo ?? null,
          seguro_base: seguroBase,
          seguro_valor_relatorio: Number(s.valor_seguro) || 0,
        },
      },
    });
  }

  // 3c. GUARDA DE CARIMBO POSTERIOR — a proposta que um fechamento MAIS NOVO já
  //     carimbou não é sobrescrita por este, que é mais velho.
  //
  //     A EXCLUSÃO ACONTECE AQUI, DENTRO DO ESCRITOR, e não só na rota. A rota
  //     recusa com 409 para que o operador VEJA o dano antes de decidir; esta
  //     guarda garante que, uma vez que ele decida seguir, a decisão dele seja
  //     "importe o resto" e nunca "sobrescreva". Não há caminho — nem confirmação,
  //     nem chamada direta desta função por um script — que grave estas linhas.
  //     Redundância deliberada: a guarda mora junto de quem escreve.
  //
  //     DEPOIS da âncora ser CALCULADA (bloco 1) e ANTES do gate dela (bloco 4):
  //     a âncora sai do PDF (input.credito / input.seguro), não de `records`, e
  //     tem de continuar assim. Ela responde "eu li o documento inteiro?"; tirar
  //     as excluídas da conta faria a âncora fechar sobre um documento que não é
  //     o que está em disco, e a conferência viraria autoendosso.
  const alvo = propostasAlvoDoFechamento({ credito, seguro });
  const bloqueadas = await propostasComCarimboPosterior(supabase, {
    companyId: BBTS_COMPANY_ID,
    year,
    month,
    propostas: alvo,
  });
  result.puladas_carimbo_posterior = bloqueadas;
  if (bloqueadas.length > 0) {
    const fora = new Set(bloqueadas.map((b) => b.proposal_number));
    for (let i = records.length - 1; i >= 0; i--) {
      if (fora.has(String(records[i].proposal_number))) records.splice(i, 1);
    }
  }

  // 4. GATE de âncora — nunca grava se não fechar.
  if (!ancoraOk) {
    const falhas = Object.entries(detalhe)
      .filter(([, d]) => !d.ok)
      .map(([k, d]) => `${k}: esperado ${d.esperado} obtido ${d.obtido} (Δ ${d.delta})`)
      .join(" | ");
    throw new BbtsAnchorError(`ÂNCORA NÃO FECHOU — nada gravado. ${falhas}`);
  }

  // 5. Grava (só quando âncora OK e não dry-run). MERGE por dono de coluna
  //    (owner='FULL' — o fechamento traz crédito+seguro juntos numa linha só, é a
  //    verdade de fim de mês). Preserva MANUAL_REASSIGNMENT dentro do helper.
  if (!dryRun && records.length > 0) {
    const { data: log, error: logErr } = await supabase
      .from("daily_imports")
      .insert({ file_name: opts?.fileName || "fechamento_bbts_junho.pdf", status: "PROCESSING" })
      .select("id")
      .single();
    if (logErr) throw logErr;

    const merged = await mergeDailyProductionRecords(supabase, {
      records: records as any,
      owner: "FULL",
      daily_import_id: log.id,
    });
    result.gravadas = merged.inserted + merged.updated;
    result.daily_import_id = log.id;

    await supabase.from("daily_imports").update({ status: "COMPLETED", rows_count: records.length }).eq("id", log.id);
  }

  // 6. PRT — a 2a perna do pagamento. Uma linha por (contrato, competência,
  //    parcela) em bbts_prt_parcelas (tabela própria: NÃO usa
  //    monthly_closing_entries, que é o universo da Promotiva — misturar a ADSlá
  //    contaminaria o ciclo PRT do RR, que soma por competência sem filtrar
  //    empresa). Upsert idempotente. Os contratos daqui são de competências
  //    ANTIGAS: podem nem existir em daily_production_records.
  const prtRows = input.prt ?? [];
  if (!dryRun && prtRows.length > 0) {
    const competencia = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
    const payload = prtRows.map((p) => ({
      company_id: BBTS_COMPANY_ID,
      competencia,
      proposal_number: String(p.contrato).trim(),
      n_parcela: p.n_parcela,
      valor_parcela: Number(p.valor_parcela) || 0,
      qt_parcela: p.qt_parcela ?? null,
      data_pagamento: parseDateBR(p.data),
      source_filename: opts?.fileName ?? null,
    }));
    const { error: prtErr } = await supabase
      .from("bbts_prt_parcelas")
      .upsert(payload, { onConflict: "company_id,proposal_number,competencia,n_parcela" });
    if (prtErr) {
      // NÃO derruba o import do crédito (já gravado): sinaliza.
      (result as any).prt_aviso = `Falha ao gravar parcelas PRT: ${prtErr.message}`;
    } else {
      result.prt_parcelas = payload.length;
    }
  }

  // BLOCO 1 — CABEÇALHO da NF por competência. "Abertura de Conta" é grandeza de
  // COMPETÊNCIA, não de contrato: não há proposta a que anexar, então não cabe em
  // daily_production_records. Tabela própria, mesmo precedente do PRT
  // (bbts_prt_parcelas), e lida pela competência LITERAL — não pela janela.
  // NÃO derruba o import: sem a tabela (migration ainda não aplicada) vira aviso.
  if (!dryRun && input.cabecalho) {
    const competencia = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
    const { error: cabErr } = await supabase.from("bbts_fechamento_totais").upsert(
      {
        company_id: BBTS_COMPANY_ID,
        competencia,
        pagamento_avt: input.cabecalho.pagamentoAvt,
        pagamento_prt: input.cabecalho.pagamentoPrt,
        abertura_conta: input.cabecalho.aberturaConta,
        // A 4a coluna do cabecalho tem ROTULO VARIAVEL — foi "Valor Descontado" em
        // 06/26 e "Glosa" em 07/26. A captura pareia por rotulo (nao por nome fixo
        // nem por posicao) e entrega o valor ja somado; a coluna do banco se chama
        // glosa porque foi assim que a migration foi aplicada. O nome que o
        // documento usou NAO fica guardado: a tabela nao tem coluna rotulos.
        // Se um dia a BBTS separar "Glosa" de "Valor Descontado" em DUAS colunas,
        // as duas cairao somadas aqui e a distincao se perde — a identidade da
        // soma continua fechando, entao isso passaria silencioso.
        glosa: input.cabecalho.outrasDeducoes,
        pagamento_total: input.cabecalho.pagamentoTotal,
        // ANCORA DO DEPOSITO DE SEGURO. O extrator ja lia o "TOTAL" do cabecalho
        // do PDF de seguro (bbtsPdfExtract.ts:541-551) e ate o usava como
        // auto-ancora (:568-572), mas extractBbtsClosingFromPdfs o DESCARTAVA —
        // o mesmo caso da Abertura de Conta antes de 28/08. Com ele,
        // `bruto - estorno = deposito` deixa de ser derivacao e vira conferencia
        // contra o documento.
        // AUSENCIA != ZERO: sem o PDF de seguro a chave e OMITIDA (fica NULL),
        // nao zerada — mesma doutrina do seguro_pdf_ausente.
        ...(input._ancoras && typeof input._ancoras.seguro_total === "number"
          ? { seguro_total: input._ancoras.seguro_total }
          : {}),
        arquivo_origem: opts?.fileName ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,competencia" }
    );
    if (cabErr) {
      // PGRST205 = tabela inexistente (migration pendente). Qualquer outro erro
      // também vira aviso: o crédito já está gravado e derrubar aqui não desfaz.
      (result as any).cabecalho_aviso = `Falha ao gravar os totais da NF: ${cabErr.message}`;
    } else {
      result.cabecalho_gravado = true;
    }
  }

  // VIRADA DÉBITOS — persiste os cancelamentos ADS (tratamento='debito') que antes
  // só iam pro console.log e se perdiam. Resolve o promotor via daily da ADS; sem
  // dono vai pra fila. NÃO falha o import: erro aqui vira só um aviso no retorno.
  if (!dryRun && result.debitos.length > 0) {
    try {
      const { resolveAdsCancelDebits } = await import("./debitInsuranceResolver.ts");
      const plan = await resolveAdsCancelDebits(supabase, {
        year: input.year,
        month: input.month,
        debitos: result.debitos,
        dryRun: false,
      });
      (result as any).debitos_persistidos = { criados: plan.debits.length, fila: plan.fila.length };
    } catch (e: any) {
      (result as any).debitos_aviso = `Falha ao persistir débitos ADS: ${e?.message || e}`;
    }
  }

  return result;
}
