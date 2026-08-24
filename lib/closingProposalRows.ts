import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// VIRADA DE TELA — proposalRows do promotor no mês FECHADO por FECHAMENTO (jun+).
// Fonte: monthly_closing_entries (aba "A Vista"/CASH, RR) + linhas ADS do diário.
// Espelha o shape CmsProposalRow (mesma UI). Traz o campo SRCC do metadata p/ a
// tela colorir: "Sim" => VERMELHO, valor visível, FORA do valor (repasse 0).
//
// COMISSÃO POR LINHA = distribuição PROPORCIONAL da comissão JÁ GRAVADA no PMR
// (promoter_monthly_results, source 'fechamento'/'bbts') — crédito rateado pela
// COMISSÃO PF de cada contrato, seguro rateado pela COMISSÃO SEGURO. Isso garante
// que Σ das linhas == total do PMR (a mesma fonte do resumo), SEM reproduzir a
// régua per-contrato (acordo/Frente C). Linhas SRCC="Sim" ficam com repasse 0 e
// NÃO entram na base do rateio — exatamente "produzida, não paga".
// READ-ONLY.
// ============================================================================

import {
  loadClosingPromoterBase,
  type ClosingContrato,
} from "./closingPromoterBase.ts";
import { BBTS_COMPANY_ID } from "./bbtsMonthly.ts";
import { getProductionPeriodFromValue, getProductionPeriodKey } from "./productionPeriod.ts";
import { pertenceACompetencia } from "./herancaMaster.ts";
import type { CmsProposalRow } from "./promoterReportData.ts";

const BBTS_KEY = "JJ552710";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normKey(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "").toUpperCase();
}
function normText(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}

async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const size = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < size) break;
    from += size;
  }
  return all;
}

export async function buildClosingProposalRows(
  supabase: SupabaseClient,
  promoterId: string,
  year: number,
  month: number
): Promise<CmsProposalRow[]> {
  const compKey = getProductionPeriodKey(year, month);

  // 1. PMR do promotor (source fechamento/bbts) — total a ratear por linha.
  const { data: pmrRows, error: pmrErr } = await supabase
    .from("promoter_monthly_results")
    .select("company_id, source, production_commission_value, insurance_commission_value")
    .eq("promoter_id", promoterId)
    .eq("year", year)
    .eq("month", month)
    .in("source", ["fechamento", "bbts"]);
  if (pmrErr) throw pmrErr;
  // SOMA, NAO ESCOLHA. Ate 24/08/2026 estas seis linhas eram dois `.find()`, que
  // pegavam a PRIMEIRA linha de cada source e descartavam as demais em silencio.
  //
  // Duas linhas source='fechamento' NAO sao estado invalido: o PMR tem uma linha
  // POR EMPRESA, e promotor que produziu em duas RR tem duas. Medido em jul/2026:
  // 13 promotores com mais de uma linha 'fechamento', e em 11 deles a primeira
  // que voltava era a de PRODUTO (credito 0) — o rateio inteiro zerava.
  //   THAYNARA: RR ALAGOAS 1 cred 0 + consorcio 2.568,04
  //             RR PERNAMBUCO cred 8.802,93 seg 1.121,91
  //   o `.find()` pegava a de AL1 e a aba Detalhamento exibia 0,00 nos dois cards
  //   de comissao, embora o topo somasse os 12.492,88 corretos.
  //
  // O total do promotor no mes e a SOMA das empresas — e o mesmo numero que o
  // topo da tela ja mostra. Nao lancar: quebraria a tela desses 13 por um estado
  // que e legitimo.
  //
  // As colunas de PRODUTO (bbcap/conta corrente/consorcio) ficam de fora de
  // proposito: elas nao sao rateaveis pelas propostas de credito e ja tem cards
  // proprios na mesma aba.
  const somaPmr = (source: string, campo: string) =>
    (pmrRows || [])
      .filter((r: any) => r.source === source)
      .reduce((total: number, r: any) => total + toNumber(r[campo]), 0);
  const fechCredit = somaPmr("fechamento", "production_commission_value");
  const fechInsurance = somaPmr("fechamento", "insurance_commission_value");
  const bbtsCredit = somaPmr("bbts", "production_commission_value");
  const bbtsInsurance = somaPmr("bbts", "insurance_commission_value");

  // 2. RR — contratos do fechamento do promotor (chave individual + herança master).
  const base = await loadClosingPromoterBase(supabase, { year, month });
  const rrContratos = base.contratos.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);
  const rrRestritas = base.restritas.filter((c) => normKey(c.chaveJ) !== BBTS_KEY);

  // Herança master p/ ESTE promotor: contratos do diário RR atribuídos a ele na
  // COMPETÊNCIA (proposal_number) — casa o órfão do fechamento (sem promotor
  // individual).
  //
  // A COMPETÊNCIA É A JANELA, NÃO O PREFIXO DO MÊS. Até 18/08/2026 este filtro
  // era `movement_date.startsWith("2026-07")` e descartava o DIA-CABEÇA da
  // janela — o último dia útil do mês anterior, que já é competência do mês
  // seguinte. Mesma classe do defeito que o 5b7f229 fechou em closingMonthly e
  // bbtsOrchestrator; esta era a terceira cópia, e ficou de fora porque mora no
  // caminho de EXIBIÇÃO, não no de pagamento.
  //
  // O estrago era exibir MENOS do que o sistema paga. Medido em 18/08/2026, sem
  // reimplementar nada (a base sai de loadClosingPromoterBase, a mesma da tela):
  //   jul/2026  6 órfãos ganham dono, R$ 45.582,69 — JUSSARA 21.000,00,
  //             CLEVITON 7.804,44, CAMILA 7.207,04, REBECA 7.100,00,
  //             GLEICE 2.471,21 (as MESMAS 6 linhas de 30/06 do 5b7f229)
  //   abr/2026  3 órfãos, R$ 6.069,56
  //   jun e ago 0 (nenhum órfão do fechamento casa com o dia-cabeça)
  //   NENHUM órfão PERDE dono em competência alguma.
  //
  // `pertenceACompetencia` é o helper de lib/herancaMaster.ts — a forma casou
  // exatamente (movementDate, year, month), então não há régua nova aqui.
  const heirKeys = new Set<string>();
  {
    const daily = await fetchAllPaged<any>(() =>
      supabase
        .from("daily_production_records")
        .select("proposal_number, company_id, movement_date")
        .eq("assigned_promoter_id", promoterId)
        .neq("company_id", BBTS_COMPANY_ID)
    );
    for (const d of daily) {
      if (!pertenceACompetencia(d.movement_date, year, month)) continue;
      heirKeys.add(`${d.company_id}|${String(d.proposal_number || "").trim()}`);
    }
  }
  const belongsToPromoter = (c: ClosingContrato): boolean => {
    if (c.promoterId === promoterId) return true;
    if (!c.promoterId && c.contrato) return heirKeys.has(`${c.companyId}|${c.contrato.trim()}`);
    return false;
  };

  const myContratos = rrContratos.filter(belongsToPromoter); // pagáveis (SRCC ≠ Sim)
  const myRestritas = rrRestritas.filter(belongsToPromoter); // SRCC = Sim (vermelho)

  // Base do rateio (só pagáveis).
  const baseCredit = myContratos.reduce((s, c) => s + toNumber(c.comissaoEmpresaAvista), 0);
  const baseInsurance = myContratos.reduce((s, c) => s + toNumber(c.comissaoSeguro), 0);

  const rows: CmsProposalRow[] = [];

  const pushClosing = (c: ClosingContrato, restrita: boolean) => {
    const comissaoPf = toNumber(c.comissaoEmpresaAvista);
    const comissaoSeg = toNumber(c.comissaoSeguro);
    // SRCC="Sim" (restrita) => repasse 0 (produzida, não paga). Senão, rateio.
    const promoterCredit = restrita || baseCredit <= 0 ? 0 : (comissaoPf / baseCredit) * fechCredit;
    const promoterInsurance = restrita || baseInsurance <= 0 ? 0 : (comissaoSeg / baseInsurance) * fechInsurance;
    rows.push({
      id: `closing:${c.companyId ?? ""}:${c.contrato ?? c.chaveJ ?? Math.random()}`,
      contract_number: c.contrato || "-",
      proposal_number: c.contrato || "-",
      agency_code: "-",
      j_key: c.chaveJ || "",
      promoter_name: c.promoterName || "",
      product_description: c.produto || "-",
      status: restrita ? "FATURAR" : "FECHADO",
      movement_date: null,
      contract_date: null,
      interest_rate: toNumber(c.txJuros),
      installment_count: 0,
      company_received_percent: toNumber(c.percentualEmpresa),
      company_commission_amount: comissaoPf,
      // Campo que a UI usa para colorir. "Sim" => vermelho.
      srcc_restriction: c.srccRaw || (restrita ? "Sim" : "Não"),
      net_value: toNumber(c.valorLiquido),
      gross_value: 0,
      insurance_value: toNumber(c.valorSeguro),
      company_insurance_commission_amount: comissaoSeg,
      insurance_penetration_percent: c.penetracao != null ? toNumber(c.penetracao) * 100 : 0,
      promoter_commission_percent: 0,
      promoter_commission_amount: promoterCredit,
      insurance_commission_percent: 0,
      insurance_commission_amount: promoterInsurance,
      commission_rule_source: "fechamento",
      assigned_promoter_id: promoterId,
      assigned_promoter_name: c.promoterName || "",
      original_promoter_id: c.promoterId ?? null,
      original_promoter_name: "",
    });
  };

  for (const c of myContratos) pushClosing(c, false);
  for (const c of myRestritas) pushClosing(c, true);

  // 3. ADS — linhas do diário do promotor (source bbts), rateio proporcional.
  const adsRecords = await fetchAllPaged<any>(() =>
    supabase
      .from("daily_production_records")
      .select(
        "id, proposal_number, contract_number, product_description, gross_value, net_value, insurance_value, interest_rate, term_months, installments, status, is_srcc_restricted, movement_date, contract_date, proposal_date, raw_payload"
      )
      .eq("company_id", BBTS_COMPANY_ID)
      .eq("assigned_promoter_id", promoterId)
  );
  const adsValid = adsRecords.filter((r) => {
    const period =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    if (!period || getProductionPeriodKey(period.year, period.month) !== compKey) return false;
    const meta = (r.raw_payload && r.raw_payload.__bbts_meta) || {};
    if (meta.cancelado === true || normText(r.status) === "CANCELADO") return false;
    if (r.is_srcc_restricted === true) return false;
    return true;
  });
  const baseAdsCredit = adsValid.reduce((s, r) => s + toNumber(r.gross_value), 0);
  const baseAdsInsurance = adsValid.reduce((s, r) => s + toNumber(r.insurance_value), 0);
  for (const r of adsValid) {
    const gross = toNumber(r.gross_value);
    const seg = toNumber(r.insurance_value);
    rows.push({
      id: `bbts:${r.id}`,
      contract_number: r.contract_number || r.proposal_number || "-",
      proposal_number: r.proposal_number || "-",
      agency_code: "-",
      j_key: "",
      promoter_name: "",
      product_description: r.product_description || "-",
      status: "FECHADO",
      movement_date: r.movement_date ?? null,
      contract_date: r.contract_date ?? null,
      interest_rate: toNumber(r.interest_rate),
      installment_count: toNumber(r.installments || r.term_months),
      // ZERO FIXO, POR CONSTRUCAO — nao e "nao houve comissao".
      //
      // O fechamento BBTS chega em CREDITO TOTAL por promotor, sem quebra por
      // proposta: nao ha percentual a vista por linha para preencher aqui. O
      // repasse do promotor logo abaixo e RATEADO pelo gross, e esse sim tem
      // valor. Ou seja: a linha e paga, e este campo diz 0.
      //
      // POR QUE ISTO ESTA REGISTRADO E NAO CONSERTADO (MEDIDA B, 27/07/2026).
      // A etiqueta "SEM REGRA TRP" acendia lendo percentual cru. Se ela algum
      // dia passar a ser renderizada em mes fechado, TODA linha da ADS acenderia
      // — dizendo "a Promotiva nao comissionou" numa linha cuja gestora nem e a
      // Promotiva, e que foi paga pela BBTS. Hoje nao acontece por dois motivos
      // independentes: mes fechado e read-only (page.js:1252 troca a celula por
      // um traco) e a etiqueta agora le sem_regra_trp, que esta rota nem envia.
      //
      // O conserto de verdade nao e trocar este 0 por outro numero: e a BBTS
      // mandar percentual por proposta, ou o rateio expor a taxa efetiva que ele
      // implica. Inventar um percentual aqui a partir do rateio seria fabricar
      // precisao que o documento da gestora nao tem.
      company_received_percent: 0,
      company_commission_amount: 0,
      srcc_restriction: "Não",
      net_value: toNumber(r.net_value) || gross,
      gross_value: gross,
      insurance_value: seg,
      company_insurance_commission_amount: 0,
      insurance_penetration_percent: 0,
      promoter_commission_percent: 0,
      promoter_commission_amount: baseAdsCredit > 0 ? (gross / baseAdsCredit) * bbtsCredit : 0,
      insurance_commission_percent: 0,
      insurance_commission_amount: baseAdsInsurance > 0 ? (seg / baseAdsInsurance) * bbtsInsurance : 0,
      commission_rule_source: "bbts",
      assigned_promoter_id: promoterId,
      assigned_promoter_name: "",
      original_promoter_id: promoterId,
      original_promoter_name: "",
    });
  }

  // Ordena: pagáveis primeiro (maior valor), restritas por último (destaque no fim).
  rows.sort((a, b) => {
    const ra = normText(a.srcc_restriction) === "SIM" ? 1 : 0;
    const rb = normText(b.srcc_restriction) === "SIM" ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return b.net_value - a.net_value;
  });

  return rows;
}
