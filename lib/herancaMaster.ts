import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionPeriodFromValue } from "./productionPeriod.ts";

// ============================================================
// PROMOTOR EFETIVO DA LINHA DO FECHAMENTO — fonte UNICA da decisao "de quem e
// esta producao".
//
// `monthly_closing_entries` NAO tem coluna de promotor: o arquivo da Promotiva
// so traz a CHAVE J. O diario (`daily_production_records`) tem
// `assigned_promoter_id`, que o financeiro EDITA pela tela quando reatribui uma
// proposta. As duas fontes divergem exatamente nas reatribuicoes manuais.
//
// REGRA (confirmada por Diego em 23/08/2026): a producao pertence a quem
// RECEBEU a reatribuicao. Logo o DIARIO VENCE a chave J, e a chave J e
// FALLBACK — vale so quando nao ha linha correspondente no diario.
//
// Antes de 23/08/2026 a precedencia era o inverso (chave J primeiro, diario so
// para o contrato ORFAO de chave master) e toda reatribuicao promotor->promotor
// era DESFEITA no fechamento, porque a chave J continua no dono original.
// Medido em jul/2026: 5 contratos, R$ 49.105,56 no dono errado (CARLA MIRELLE
// +40.105,56 que era da MONICA PEREIRA e da JESSICA; TACIANA com 9.000,00 que
// era do MATHEUS AVELINO). Gate: scripts/reatribuicao_precedencia_gate.cjs
//
// O FALLBACK NAO E OPCIONAL. O diario so existe a partir de 2026-03-31; nas
// competencias 2026-01/02/03/05 o fechamento tem 2.787 linhas SEM nenhuma linha
// no diario. Sem o fallback a producao desses meses evaporaria. Medido: com o
// fallback, 01/02/03/04/05/06 ficam byte-identicas e so julho muda.
//
// A COMPETENCIA E A JANELA, NAO O MES DO CALENDARIO. A janela de producao vai do
// ultimo dia util do mes anterior ao penultimo do mes vigente — em jul/2026,
// 30/06 -> 30/07. Filtrar por `movement_date.startsWith("2026-07")` descarta as
// linhas de 30/06, que sao julho pela competencia: a linha fica sem dono no
// diario e a producao nao pousa no promotor. Medido em jul/2026: 26 linhas de
// 30/06, R$ 45.582,69 perdidos em 5 promotores (CAMILA GOMES 7.207,04; REBECA
// ARAUJO 7.100,00; CLEVITON ARAUJO 7.804,44; GLEICE KAMILA 2.471,21; JUSSARA DA
// SILVA 21.000,00). Quem decide competencia aqui e getProductionPeriodFromValue
// — a mesma regua que o resto do sistema usa.
// Gate: scripts/heranca_master_janela_gate.cjs
//
// TRES consumidores dependem desta decisao e nenhum pode ter copia propria:
//   lib/closingMonthly.ts   (PMR do fechamento + a empresa dona do debito)
//   lib/closingMonthly.ts   (addSeguroAvulso — aba INSURANCE/"A Vista")
//   lib/bbtsOrchestrator.ts (bloco A, producao RR consolidada RR+ADS)
// ============================================================

type SupabaseLike = SupabaseClient;

/** Linha do fechamento reduzida ao que decide o dono: contrato + empresa. */
export type LinhaDeFechamento = { contrato: string | null; companyId: string | null };

/**
 * A linha do diario pertence a competencia (year, month)? UNICO ponto onde essa
 * decisao e tomada aqui. Extraido para ser testavel PURO pelo gate.
 */
export function pertenceACompetencia(
  movementDate: unknown,
  year: number,
  month: number
): boolean {
  const periodo = getProductionPeriodFromValue(movementDate);
  return !!periodo && periodo.year === year && periodo.month === month;
}

/**
 * Dono do DIARIO por (empresa|contrato): para cada linha passada, busca no
 * diario a linha cujo proposal_number == contract_number do fechamento, na MESMA
 * empresa e na competencia do mes; usa o assigned_promoter_id (mais recente se
 * houver mais de uma). Devolve Map<`${companyId}|${contrato}`, promoterId>.
 *
 * ESTA FUNCAO NAO SABE O QUE E CHAVE MASTER — e o chamador que decide quais
 * linhas consultar. Passe TODAS as linhas do fechamento: e a consulta do dono do
 * diario que faz a reatribuicao manual valer. Filtrar so as orfas era o defeito.
 */
export async function buildDonoDoDiarioMap(
  supabase: SupabaseLike,
  linhas: LinhaDeFechamento[],
  year: number,
  month: number
): Promise<Map<string, string>> {
  const contracts = [
    ...new Set(linhas.map((c) => (c.contrato || "").trim()).filter(Boolean)),
  ];
  const dono = new Map<string, string>();
  if (contracts.length === 0) return dono;

  const best = new Map<string, { pid: string; updatedAt: string }>();
  for (let i = 0; i < contracts.length; i += 300) {
    const chunk = contracts.slice(i, i + 300);
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("proposal_number, company_id, assigned_promoter_id, movement_date, updated_at")
      .in("proposal_number", chunk);
    if (error) throw error;
    for (const d of data || []) {
      if (!d.assigned_promoter_id) continue;
      if (!pertenceACompetencia(d.movement_date, year, month)) continue; // competência do mês
      const key = `${d.company_id}|${String(d.proposal_number || "").trim()}`;
      const prev = best.get(key);
      const upd = String(d.updated_at || "");
      if (!prev || upd > prev.updatedAt) best.set(key, { pid: d.assigned_promoter_id, updatedAt: upd });
    }
  }
  for (const [key, v] of best) dono.set(key, v.pid);
  return dono;
}

/**
 * QUEM E O PROMOTOR EFETIVO DESTA LINHA. Ponto UNICO de decisao — os tres
 * consumidores do PMR chamam esta funcao, ninguem reimplementa a precedencia.
 *
 * PRECEDENCIA: diario primeiro (honra a reatribuicao manual do financeiro),
 * chave J como FALLBACK (linha sem correspondente no diario), null se nenhum
 * dos dois resolve (o contrato fica com a empresa, fora do PMR).
 */
export function resolvePromotorEfetivo(
  linha: {
    /** promoter_id resolvido pela CHAVE J — so quando key_type = INDIVIDUAL. */
    promoterIdDaChave: string | null;
    contrato: string | null;
    companyId: string | null;
  },
  donoDoDiario: Map<string, string>
): string | null {
  const contrato = (linha.contrato || "").trim();
  const doDiario = contrato ? donoDoDiario.get(`${linha.companyId}|${contrato}`) ?? null : null;
  return doDiario ?? linha.promoterIdDaChave ?? null;
}
