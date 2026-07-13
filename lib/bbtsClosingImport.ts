import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeDailyProductionRecords } from "./dailyRecordMerge.ts";

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
  // Âncoras declaradas pela própria extração (self-describing). Se presente,
  // sobrepõe o const hardcoded — o arquivo v3 traz 19 propostas / 271.210,84.
  _ancoras?: {
    credito_propostas?: number;
    credito_valor_financiado?: number;
    credito_pag_avista?: number;
    seguro_calculo?: number;
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
  com_seguro: number; // linhas de produção que receberam insurance_value
  seguro_only_lines: number; // linhas de produção criadas só p/ seguro órfão (sem crédito)
  debitos: Array<{ contrato: string; valor_seguro: number; tipo: string | null }>; // fora da produção
  prt_parcelas: number; // linhas da seção PRT gravadas em bbts_prt_parcelas
  prt_valor: number; // Σ das parcelas PRT do mês
  gravadas: number;
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
    com_seguro: 0,
    seguro_only_lines: 0,
    debitos: seguroDebito.map((s) => ({ contrato: String(s.contrato).trim(), valor_seguro: Number(s.valor_seguro) || 0, tipo: s.tipo ?? null })),
    prt_parcelas: 0,
    prt_valor: round2((input.prt ?? []).reduce((a, p) => a + (Number(p.valor_parcela) || 0), 0)),
    gravadas: 0,
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
    const isSrccRestricted = srccCd === 1;
    if (isSrccRestricted) result.srcc_restritas += 1;

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
      insurance_value: seguroBase,
      insurance_net_value: seguroBase,
      insurance_type: seg?.tipo ?? null,
      has_insurance: seguroBase > 0,
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
      promoter_commission_amount: null,
      promoter_commission_percent: null,
      insurance_commission_amount: null,
      insurance_commission_percent: null,
      // O QUE A BBTS PAGOU — colunas de 1a classe (antes só em raw_payload/JSONB,
      // opaco p/ SQL e sujeito a ser apagado num merge). É o lado "pago" da
      // auditoria da ADS. Migration 20260712_000003.
      bbts_pag_avista: Number(r.pag_avista) || 0,
      bbts_taxa_relatorio: r.taxa_relatorio ?? null,
      bbts_seguro_pago: seg ? Number(seg.valor_seguro) || 0 : 0,
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
