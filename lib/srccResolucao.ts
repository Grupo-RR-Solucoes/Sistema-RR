// ============================================================================
// RESOLUCAO DO SRCC PELO FECHAMENTO (RR).
//
// O PROBLEMA QUE ISTO FECHA. O SRCC entra pela diaria e nunca mais e revisto.
// Quando a consulta do Banco do Brasil nao roda no dia da venda, a Promotiva
// manda "Consulta nao realizada por problemas tecnicos" — e a linha fica ambar
// para sempre, mesmo depois de o fechamento dizer o que a consulta deu.
// Medido em 27/07/2026: ~8% das linhas RR por mes, 114 presas em competencia
// ja fechada.
//
// A RESPOSTA E EXPLICITA, nao inferida. 100% das linhas CASH do fechamento tem
// "RESTRICAO SRCC" no metadata. NAO se infere por pagamento: comissao zero
// tambem vem de prazo curto, produto fora de tabela e cancelamento — tres
// causas no mesmo sinal.
//
// PASSO DO IMPORT, NAO ROTINA SEPARADA. O dado chega todo mes, no mesmo
// arquivo, no mesmo momento. Rotina avulsa precisa ser lembrada; passo do
// importador roda sozinho.
//
// O QUE NAO FAZ, e cada "nao" tem motivo medido:
//   - nao toca raw_payload      e a copia fiel do que a gestora mandou
//   - nao toca comissao         o residuo da diaria nao alimenta pagamento; o
//                               PMR fechado vem do fechamento (source=fechamento)
//   - nao reconsolida           o PMR fechado nao le o SRCC da diaria do RR
//                               (o unico ponto que le esta atras de
//                               .eq(company_id, BBTS) no bbtsOrchestrator)
//   - nao sobrescreve resposta  so preenche o que faltava; se a diaria ja sabia,
//                               o fechamento nao tem por que discordar dela
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSrccEstado } from "@/lib/proposalDetailing";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";

/** De onde veio a resolucao. Grava em srcc_resolucao_fonte. */
export const FONTE_FECHAMENTO_RR = "fechamento_rr";

/**
 * A mesma conclusao, vinda do fechamento da BBTS (ADS). Fonte SEPARADA da do RR
 * porque o caminho e outro: no RR a resposta vem do metadata do
 * monthly_closing_entries, num passo que roda DEPOIS do import; na ADS ela vem
 * dentro do proprio PDF do fechamento, no mesmo momento da carga
 * (bbtsClosingImport). Distinguir as duas e o que permite auditar "de onde e
 * desde quando o sistema sabe disto" sem reprocessar nada.
 */
export const FONTE_FECHAMENTO_ADS = "fechamento_ads";

export type ValorResolucao = "SIM" | "NAO" | "NAO_SE_APLICA";

export type ResultadoResolucaoSrcc = {
  /** Linhas INDEFINIDAS da competencia/empresa antes do passo. */
  candidatas: number;
  /** Resolvidas (gravadas, ou que seriam gravadas em dryRun). */
  resolvidas: number;
  porValor: Record<ValorResolucao, number>;
  /**
   * Candidatas que o fechamento NAO respondeu. Somadas, nao silenciadas: o
   * silencio e justamente o defeito que este passo conserta.
   */
  semResposta: {
    /** Nao ha linha correspondente no fechamento. */
    ausenteDoFechamento: number;
    /** Ha linha, mas sem a coluna RESTRICAO SRCC (ou vazia). */
    semColuna: number;
    /** Ha coluna, com valor fora do dominio conhecido. */
    valorDesconhecido: number;
    /** Amostra dos valores desconhecidos, para diagnostico. */
    amostraValores: string[];
  };
  dryRun: boolean;
};

const A_SRCC = [
  "RESTRIÇÃO SRCC",
  "RESTRICAO SRCC",
  "INDICADOR RESTRIÇÃO SRCC",
  "INDICADOR RESTRICAO SRCC",
];

function norm(v: unknown) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

function lerMetadata(metadata: unknown, chaves: string[]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const alvos = chaves.map(norm);
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (!alvos.includes(norm(k))) continue;
    if (v === null || v === undefined || String(v).trim() === "") continue;
    return String(v);
  }
  return null;
}

/**
 * Traduz o texto do fechamento para o dominio da coluna. Devolve null quando o
 * valor nao e reconhecido — e null NAO grava. Aceitar um valor estranho seria
 * inventar resposta sobre restricao bancaria.
 *
 * SERVE AS DUAS GESTORAS. O RR manda o texto por extenso ("Nao se aplica"), a
 * BBTS manda o CODIGO cru (1/2/4) — os dois caem aqui e saem no mesmo dominio.
 *
 * O CODIGO 3 ("consulta nao realizada") NAO TEM PAR, e isso e proposital: o
 * dominio de tres valores da coluna nao tem como dizer "ainda nao se sabe", e
 * nao deve ter. Devolver null aqui e o que mantem a linha INDEFINIDA (ambar),
 * candidata a ser resolvida quando a resposta existir. E o mesmo desenho do RR:
 * a duvida nao vira negativa; ela espera.
 */
export function traduzirValorFechamento(bruto: string): ValorResolucao | null {
  const n = norm(bruto);
  if (n === "SIM" || n === "1") return "SIM";
  if (n === "NAO" || n === "2") return "NAO";
  if (n === "NAO SE APLICA" || n === "4") return "NAO_SE_APLICA";
  return null;
}

/** So digitos, sem zeros a esquerda — proposta e contrato variam de formato. */
function chaveNum(v: unknown) {
  return String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

async function paginar<T>(fabrica: () => any): Promise<T[]> {
  const passo = 1000;
  let de = 0;
  const out: T[] = [];
  for (;;) {
    // ORDER estavel: sem ele a paginacao do PostgREST perde/duplica linha.
    const { data, error } = await fabrica().order("id").range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return out;
}

/**
 * Resolve o SRCC das linhas INDEFINIDAS de uma competencia a partir do
 * fechamento ja gravado em monthly_closing_entries.
 *
 * IDEMPOTENTE POR CONSTRUCAO: uma linha resolvida deixa de ser "indefinida"
 * (srcc_resolucao vence no getSrccRestrictionLabel), entao nao volta ao
 * universo de candidatas. A segunda rodada reporta zero.
 *
 * @param companyId escopo da empresa. O import de fechamento e POR EMPRESA;
 *   resolver a competencia inteira invadiria o fechamento de outro CNPJ que
 *   pode nem ter sido importado ainda.
 */
export async function resolverSrccDoFechamento(
  supabase: SupabaseClient,
  params: {
    year: number;
    month: number;
    companyId: string;
    dryRun?: boolean;
  }
): Promise<ResultadoResolucaoSrcc> {
  const { year, month, companyId } = params;
  const dryRun = params.dryRun === true;

  const res: ResultadoResolucaoSrcc = {
    candidatas: 0,
    resolvidas: 0,
    porValor: { SIM: 0, NAO: 0, NAO_SE_APLICA: 0 },
    semResposta: {
      ausenteDoFechamento: 0,
      semColuna: 0,
      valorDesconhecido: 0,
      amostraValores: [],
    },
    dryRun,
  };

  // Janela FOLGADA de movement_date: a competencia comeca no ultimo dia UTIL do
  // mes anterior. Filtrar pelo mes-calendario decapitaria o dia-cabeca — o
  // mesmo erro que custou uma rodada inteira na MEDIDA C.
  const p2 = (n: number) => String(n).padStart(2, "0");
  const antYear = month === 1 ? year - 1 : year;
  const antMonth = month === 1 ? 12 : month - 1;
  const segYear = month === 12 ? year + 1 : year;
  const segMonth = month === 12 ? 1 : month + 1;

  const diaria = await paginar<any>(() =>
    supabase
      .from("daily_production_records")
      .select(
        "id, proposal_number, contract_number, movement_date, contract_date, proposal_date," +
          " raw_payload, is_srcc_restricted, srcc_resolucao"
      )
      .eq("company_id", companyId)
      .gte("movement_date", `${antYear}-${p2(antMonth)}-15`)
      .lt("movement_date", `${segYear}-${p2(segMonth)}-15`)
  );

  const daCompetencia = diaria.filter((r) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p && p.year === year && p.month === month;
  });

  // SO INDEFINIDO. Linha que ja tem resposta nao e tocada: o fechamento
  // preenche o que faltava, nao corrige o que a diaria ja sabia.
  const candidatas = daCompetencia.filter((r) => getSrccEstado(r) === "indefinido");
  res.candidatas = candidatas.length;
  if (candidatas.length === 0) return res;

  const fechamento = await paginar<any>(() =>
    supabase
      .from("monthly_closing_entries")
      .select("operation_number, contract_number, metadata")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("month", month)
      .eq("entry_type", "CASH")
  );

  const porChave = new Map<string, any>();
  for (const f of fechamento) {
    for (const k of [chaveNum(f.operation_number), chaveNum(f.contract_number)]) {
      if (k && !porChave.has(k)) porChave.set(k, f);
    }
  }

  const agora = new Date().toISOString();
  const aGravar: Array<{ id: string; valor: ValorResolucao }> = [];

  for (const r of candidatas) {
    const f =
      porChave.get(chaveNum(r.proposal_number)) ??
      porChave.get(chaveNum(r.contract_number)) ??
      null;
    if (!f) {
      res.semResposta.ausenteDoFechamento += 1;
      continue;
    }
    const bruto = lerMetadata(f.metadata, A_SRCC);
    if (bruto == null) {
      res.semResposta.semColuna += 1;
      continue;
    }
    const valor = traduzirValorFechamento(bruto);
    if (!valor) {
      res.semResposta.valorDesconhecido += 1;
      if (res.semResposta.amostraValores.length < 5) {
        res.semResposta.amostraValores.push(bruto);
      }
      continue;
    }
    aGravar.push({ id: r.id, valor });
    res.porValor[valor] += 1;
    res.resolvidas += 1;
  }

  if (dryRun || aGravar.length === 0) return res;

  // Um UPDATE por valor (3 no maximo), nao um por linha. is_srcc_restricted
  // acompanha porque e o campo que o CALCULO consulta — a coluna de resolucao
  // manda no rotulo, o booleano manda na conta.
  for (const valor of ["SIM", "NAO", "NAO_SE_APLICA"] as ValorResolucao[]) {
    const ids = aGravar.filter((g) => g.valor === valor).map((g) => g.id);
    if (ids.length === 0) continue;
    const { error } = await supabase
      .from("daily_production_records")
      .update({
        srcc_resolucao: valor,
        srcc_resolucao_fonte: FONTE_FECHAMENTO_RR,
        srcc_resolucao_em: agora,
        is_srcc_restricted: valor === "SIM",
      })
      .in("id", ids);
    if (error) throw new Error(`resolverSrccDoFechamento (${valor}): ${error.message}`);
  }

  return res;
}
