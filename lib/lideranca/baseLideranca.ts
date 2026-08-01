import type { SupabaseClient } from "@supabase/supabase-js";

import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { calcularOperacao } from "@/lib/motor";
import {
  entraNaComissaoDaBase,
  entraNaProducaoLiquidaDaBase,
  type BaseLideranca,
} from "@/lib/remuneracaoLideranca";

/**
 * BASE DA REMUNERACAO DE LIDERANCA — construcao, por rede e por competencia.
 *
 * Este modulo SOMA. O lib/remuneracaoLideranca APLICA a regua sobre o que sai
 * daqui. A separacao e proposital: a regua e versionada e nao pode depender de
 * onde o numero veio; a base e I/O e nao pode conhecer aliquota nem piso.
 *
 * AUTORIZACAO — este modulo NAO decide quem entra. Recebe `promoterIds` que a
 * vw_team_production e a policy de monthly_targets ja autorizaram (resolvidos em
 * buildTeamProduction). Aqui o service_role so resolve ATRIBUTO sobre esses ids,
 * o mesmo padrao de teamProduction.ts:678-681 e :722-726. Passar uma lista mais
 * larga do que a arvore autorizou seria vazamento — e responsabilidade do caller.
 *
 * DUAS EMPRESAS, DOIS PIPELINES, MESMA NATUREZA
 *   RR  -> monthly_closing_entries (uma linha por lancamento do fechamento)
 *   ADS -> colunas do diario (bbts_pag_avista / bbts_seguro_pago)
 * Os dois sao FATO IMPORTADO, nao derivado. O formato difere; a natureza nao.
 * A ADS nao aparece em monthly_closing_entries — medido em 01/08/2026, as 4
 * empresas de la sao RR AL1/AL2/AL3/PE.
 *
 * DOIS REGIMES
 *   FECHADO -> fonte 'fechamento', parcial=false. E o devido.
 *   ABERTO  -> fonte 'motor', parcial=true. E acompanhamento, NUNCA o devido.
 *              Ver a ressalva do credito ADS em `ads_sem_comissao_apurada`.
 */

/** ADS Consultoria Negocial. */
const ADS_COMPANY_ID = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

export type FonteBase = "fechamento" | "motor";

export type BaseLiderancaDetalhada = BaseLideranca & {
  fonte: FonteBase;
  /**
   * TRUE em mes ABERTO. O valor calculado sobre esta base e estimativa de
   * acompanhamento e NAO PODE ser gravado como devido.
   */
  parcial: boolean;
  /** Comissao media da rede = comissao_avista / producao_liquida (a TRP efetiva). */
  comissao_media: number | null;
  linhas_comissao: number;
  linhas_liquido: number;
  /** Linhas descartadas por SRCC restrita. */
  linhas_srcc_excluidas: number;
  /**
   * LACUNA CONHECIDA, so em mes ABERTO: producao liquida da ADS que esta na rede
   * e e elegivel, mas cuja comissao de credito NAO foi apurada.
   *
   * O motor precifica credito pela TRP, que e a regua do RR. A ADS e paga pela
   * BBTS, por outra regua. Estimar o credito da ADS por TRP seria inventar um
   * numero com a regua errada, entao ele fica AUSENTE e MARCADO aqui.
   *
   * SEM ESTE CAMPO o parcial subestima e o valor pula no fechamento sem
   * explicacao. A tela tem de mostrar a lacuna, nao escondê-la.
   */
  ads_producao_sem_comissao_apurada: number;
  ads_linhas_sem_comissao_apurada: number;
};

type LinhaFechamento = {
  entry_type: string | null;
  sheet_name: string | null;
  commission_value: number | null;
  net_value: number | null;
  j_key: string | null;
  operation_number: string | null;
  contract_number: string | null;
};

type LinhaDiario = {
  id: string;
  company_id: string | null;
  assigned_promoter_id: string | null;
  status: string | null;
  is_srcc_restricted: boolean | null;
  net_value: number | null;
  gross_value: number | null;
  insurance_value: number | null;
  insurance_type: string | null;
  has_insurance: boolean | null;
  interest_rate: number | null;
  term_months: number | null;
  installments: number | null;
  company_received_percent: number | null;
  insurance_commission_amount: number | null;
  bbts_pag_avista: number | null;
  bbts_seguro_pago: number | null;
  product_code: string | null;
  product_description: string | null;
  convenio_code: string | null;
  convenio_type: string | null;
  convenio_segment: string | null;
  proposal_number: string | null;
  contract_number: string | null;
  movement_date: string | null;
  contract_date: string | null;
  proposal_date: string | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/** Elegivel = PRODUCAO/PRODUCTION e NAO SRCC. Mesma regra do resto do sistema. */
function elegivel(r: { status: unknown; is_srcc_restricted: unknown }): boolean {
  const s = normalizar(r.status);
  return (s === "PRODUCAO" || s === "PRODUCTION") && r.is_srcc_restricted !== true;
}

/**
 * Competencia do registro. A janela RR NAO e o mes calendario — usar o mes da
 * data poe 30/06 em junho quando o canonico diz julho (medido, 1 linha da ADS).
 */
function competenciaDe(r: {
  movement_date: unknown;
  contract_date: unknown;
  proposal_date: unknown;
}): string | null {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : null;
}

/** Paginacao COM order estavel. Sem order o range() repete/pula linhas. */
async function todas<T>(fn: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = [];
  let de = 0;
  for (;;) {
    const { data, error } = await fn(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
    de += 1000;
  }
  return out;
}

const COLUNAS_DIARIO =
  "id, company_id, assigned_promoter_id, status, is_srcc_restricted, net_value, gross_value, " +
  "insurance_value, insurance_type, has_insurance, interest_rate, term_months, installments, " +
  "company_received_percent, insurance_commission_amount, bbts_pag_avista, bbts_seguro_pago, " +
  "product_code, product_description, convenio_code, convenio_type, convenio_segment, " +
  "proposal_number, contract_number, movement_date, contract_date, proposal_date";

function baseVazia(fechado: boolean): BaseLiderancaDetalhada {
  return {
    comissao_avista: 0,
    producao_liquida: 0,
    fonte: fechado ? "fechamento" : "motor",
    parcial: !fechado,
    comissao_media: null,
    linhas_comissao: 0,
    linhas_liquido: 0,
    linhas_srcc_excluidas: 0,
    ads_producao_sem_comissao_apurada: 0,
    ads_linhas_sem_comissao_apurada: 0,
  };
}

export type ArgsBase = {
  /** Ids JA AUTORIZADOS pela arvore do gestor. Ver o cabecalho. */
  promoterIds: readonly string[];
  year: number;
  month: number;
  /** FALSE => mes aberto => fonte 'motor', parcial. */
  fechado: boolean;
};

/**
 * Monta a base da rede na competencia.
 *
 * @param admin client service_role — resolve ATRIBUTO sobre ids ja autorizados.
 */
export async function construirBaseLideranca(
  admin: SupabaseClient,
  args: ArgsBase,
): Promise<BaseLiderancaDetalhada> {
  const ids = new Set(args.promoterIds);
  const comp = `${args.year}-${String(args.month).padStart(2, "0")}`;

  if (ids.size === 0) {
    return baseVazia(args.fechado);
  }

  // DUAS consultas ESCOPADAS, nunca a tabela inteira. Varrer
  // daily_production_records por completo a cada chamada derruba a rota do
  // gestor (statement timeout, medido) e nao e necessario:
  //   (a) as linhas da REDE  -> filtradas por assigned_promoter_id;
  //   (b) as chaves SRCC     -> so as linhas restritas, e so 2 colunas.
  // O (b) precisa ser global porque o fechamento nao tem is_srcc_restricted e o
  // casamento e por numero de operacao/contrato, que pode vir de outra rede.
  const daRede = await todas<LinhaDiario>((de, ate) =>
    admin
      .from("daily_production_records")
      .select(COLUNAS_DIARIO)
      .in("assigned_promoter_id", Array.from(ids))
      .order("id")
      .range(de, ate),
  );

  const restritas = await todas<{ proposal_number: string | null; contract_number: string | null }>(
    (de, ate) =>
      admin
        .from("daily_production_records")
        .select("proposal_number, contract_number")
        .eq("is_srcc_restricted", true)
        .order("id")
        .range(de, ate),
  );
  const srcc = new Set<string>();
  for (const d of restritas) {
    if (d.proposal_number) srcc.add(String(d.proposal_number));
    if (d.contract_number) srcc.add(String(d.contract_number));
  }

  const daCompetencia = daRede.filter((d) => competenciaDe(d) === comp).filter(elegivel);
  const ads = daCompetencia.filter((d) => d.company_id === ADS_COMPANY_ID);
  const rr = daCompetencia.filter((d) => d.company_id !== ADS_COMPANY_ID);

  let comissao = 0;
  let liquido = 0;
  let linhasComissao = 0;
  let linhasLiquido = 0;
  let srccExcluidas = 0;
  let adsProducaoSemComissao = 0;
  let adsLinhasSemComissao = 0;

  if (args.fechado) {
    // ---------------- RR: monthly_closing_entries ----------------
    const fechamento = await todas<LinhaFechamento>((de, ate) =>
      admin
        .from("monthly_closing_entries")
        .select(
          "entry_type, sheet_name, commission_value, net_value, j_key, operation_number, contract_number",
        )
        .eq("year", args.year)
        .eq("month", args.month)
        .order("id")
        .range(de, ate),
    );

    const chaves = await todas<{ j_key: string | null; promoter_id: string | null }>((de, ate) =>
      admin.from("j_keys").select("j_key, promoter_id").order("id").range(de, ate),
    );
    const promotorDaChave = new Map<string, string>();
    for (const k of chaves) {
      if (k.j_key && k.promoter_id) promotorDaChave.set(String(k.j_key), k.promoter_id);
    }

    const ehSrcc = (r: LinhaFechamento) =>
      (r.operation_number && srcc.has(String(r.operation_number))) ||
      (r.contract_number && srcc.has(String(r.contract_number)));

    for (const r of fechamento) {
      const pid = r.j_key ? promotorDaChave.get(String(r.j_key)) : undefined;
      if (!pid || !ids.has(pid)) continue;
      const naComissao = entraNaComissaoDaBase(r.entry_type, r.sheet_name);
      const noLiquido = entraNaProducaoLiquidaDaBase(r.entry_type, r.sheet_name);
      if (!naComissao && !noLiquido) continue;
      if (ehSrcc(r)) {
        srccExcluidas += 1;
        continue;
      }
      if (naComissao) {
        comissao += num(r.commission_value);
        linhasComissao += 1;
      }
      if (noLiquido) {
        liquido += num(r.net_value);
        linhasLiquido += 1;
      }
    }

    // ---------------- ADS: colunas do diario ----------------
    // Simetrico ao RR: FATO IMPORTADO. bbts_pag_avista e o que a BBTS pagou a
    // vista; bbts_seguro_pago e a comissao de seguro (medido 0,1176% sobre a
    // producao segurada de jun/2026 — ordem de comissao, nao de premio).
    for (const d of ads) {
      const pagAvista = d.bbts_pag_avista;
      if (pagAvista == null) {
        // Fechamento BBTS da competencia nao importado: a linha existe, o pago
        // nao. Entra como lacuna, nunca como zero.
        adsProducaoSemComissao += num(d.net_value);
        adsLinhasSemComissao += 1;
        continue;
      }
      comissao += num(pagAvista) + num(d.bbts_seguro_pago);
      liquido += num(d.net_value);
      linhasComissao += 1;
      linhasLiquido += 1;
    }
  } else {
    // ---------------- MES ABERTO: motor ----------------
    // Mesma funcao que o /recebiveis e o alerta do dashboard usam. Nao ha
    // segunda regua aqui.
    const producaoDaRede = daCompetencia.reduce((s, d) => s + num(d.net_value), 0);

    for (const d of rr) {
      const netValue = num(d.net_value);
      const grossValue = Math.max(num(d.gross_value), netValue);
      const rate = num(d.interest_rate);
      const prazo = num(d.term_months) || num(d.installments);
      liquido += netValue;
      linhasLiquido += 1;

      // As 3 condicoes que closingAnalytics.ts exige para precificar. Medido em
      // 01/08/2026: 100% dos elegiveis as satisfazem em abr, jun e jul.
      if (!(netValue > 0 && rate > 0 && prazo > 0)) continue;

      const r = calcularOperacao({
        valor_liquido: netValue,
        valor_bruto: grossValue,
        valor_seguro: num(d.insurance_value),
        taxa_juros: rate,
        prazo,
        tem_seguro: Boolean(d.has_insurance) || num(d.insurance_value) > 0,
        product_code: d.product_code,
        product_description: d.product_description,
        convenio_code: d.convenio_code,
        convenio_type: d.convenio_type,
        convenio_segment: d.convenio_segment,
        company_cash_percent: d.company_received_percent,
        production_value: producaoDaRede,
        insurance_type: d.insurance_type,
        movement_date: d.movement_date,
        contract_date: d.contract_date,
        proposal_date: d.proposal_date,
      } as any);

      comissao += num(r.credito.avista_empresa) + num(r.seguro.empresa);
      linhasComissao += 1;
    }

    // ADS no mes aberto: o CREDITO fica de fora, marcado. O motor precifica
    // credito pela TRP, que e a regua do RR — a ADS e paga pela BBTS. Estimar
    // por TRP seria numero com regua errada. O SEGURO entra, porque
    // insurance_commission_amount ja esta apurado no proprio diario.
    for (const d of ads) {
      liquido += num(d.net_value);
      linhasLiquido += 1;
      const segApurado = num(d.insurance_commission_amount);
      if (segApurado > 0) {
        comissao += segApurado;
        linhasComissao += 1;
      }
      adsProducaoSemComissao += num(d.net_value);
      adsLinhasSemComissao += 1;
    }
  }

  const comissaoR = round2(comissao);
  const liquidoR = round2(liquido);

  return {
    comissao_avista: comissaoR,
    producao_liquida: liquidoR,
    fonte: args.fechado ? "fechamento" : "motor",
    parcial: !args.fechado,
    // A TRP efetiva da rede. E ela — e so ela — que decide alíquota x piso:
    // volume nao altera o criterio, porque os dois termos escalam junto.
    comissao_media: liquidoR > 0 ? comissaoR / liquidoR : null,
    linhas_comissao: linhasComissao,
    linhas_liquido: linhasLiquido,
    linhas_srcc_excluidas: srccExcluidas,
    ads_producao_sem_comissao_apurada: round2(adsProducaoSemComissao),
    ads_linhas_sem_comissao_apurada: adsLinhasSemComissao,
  };
}
