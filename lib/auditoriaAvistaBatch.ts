/**
 * Camada 2 À Vista — wrappers em batch (Fase 4.3).
 *
 * Orquestra a aplicação de auditAvistaContrato para todos os contratos de:
 *   - 1 mês:                    auditAvistaMes(sb, year, month)
 *   - intervalo:                auditAvistaPeriodo(sb, sY, sM, eY, eM)
 *
 * Lê audit_v9_avista paginado (1000/req — limite PostgREST) e dispara a
 * Camada 1 (auditEnquadramentoMes) uma única vez por mês para resolver o
 * mesContext compartilhado entre os contratos do mês.
 *
 * Retorna o resultado contrato a contrato + sumário agregado por
 * (status_fase2, bloco) — consumido pelo endpoint /api/auditoria/avista
 * (Fase 4.3) e pela UI (Fase 4.6).
 */

import {
  auditAvistaContrato,
  type ContratoAvista,
  type MesContextAvista,
  type ResultadoFase2Cash,
} from "./auditoriaAvista.ts";
import {
  auditEnquadramentoMes,
  normalizeCategoria,
} from "./enquadramento.ts";
import type { Bloco, StatusFase2 } from "./types/blocos.ts";

type SupabaseLike = { from: (t: string) => any };

/** Resumo agregado por (status_fase2, bloco). */
export interface ResumoAvista {
  totalContratos: number;
  /** Soma da diferença para cada status (mantém sinal v9). */
  somaDiferencaPorStatus: Record<string, number>;
  /** Contagem por status_fase2. */
  contagemPorStatus: Record<string, number>;
  /** Soma a cobrar do Bloco 2.1 — usa Math.abs(diferenca) (= -dif para subpagamento). */
  somaPedidoFirme21: number;
  /** Contagem de PEDIDO_FIRME_2.1 (≈ 2.501 + 40 = 2.508 esperado). */
  contagemPedidoFirme21: number;
  /** Contagem por bloco. */
  contagemPorBloco: Record<string, number>;
  /** Contagem de SEM_LOOKUP — exigência blindagem (Diego CHECKPOINT A).
   *  Validador compara com v9 e trava se diferir > 5. */
  contagemSemLookup: number;
}

/** Sumário + lista de resultados. */
export interface AvistaMesPayload {
  ym: string;
  year: number;
  month: number;
  mesContext: MesContextAvista;
  resultados: ResultadoFase2Cash[];
  resumo: ResumoAvista;
}

/** Carrega audit_v9_padrao_d_exclusoes — Map(contract_number → motivo). */
async function fetchPadraoDExclusoes(
  sb: SupabaseLike
): Promise<Map<string, ContratoAvista["padraoDMotivo"]>> {
  const out = new Map<string, ContratoAvista["padraoDMotivo"]>();
  const { data, error } = await sb
    .from("audit_v9_padrao_d_exclusoes")
    .select("contract_number,motivo_exclusao");
  if (error) throw new Error(`audit_v9_padrao_d_exclusoes: ${error.message}`);
  for (const r of (data ?? []) as Array<{ contract_number: string; motivo_exclusao: string }>) {
    out.set(
      r.contract_number,
      r.motivo_exclusao as ContratoAvista["padraoDMotivo"]
    );
  }
  return out;
}

/** Carrega audit_v9_avista paginado para o mês. */
async function fetchAvistaContratosMes(
  sb: SupabaseLike,
  ym: string,
  padraoDExclusoes: Map<string, ContratoAvista["padraoDMotivo"]>
): Promise<ContratoAvista[]> {
  const out: ContratoAvista[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("audit_v9_avista")
      .select(
        "contract_number,empresa,mes,tipo,produto,convenio,tx_juros,prazo,cat_aplicada,valor_liquido,pct_aplicado,comissao_paga,status_fase1"
      )
      .eq("mes", ym)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`audit_v9_avista ${ym}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) {
      const cn = String(r.contract_number ?? "");
      if (!cn) continue;
      const padraoDMotivo = padraoDExclusoes.get(cn) ?? null;
      out.push({
        contractNumber: cn,
        empresa: String(r.empresa ?? ""),
        mes: String(r.mes ?? ym),
        produto: r.produto == null ? null : String(r.produto),
        tipo: r.tipo == null ? null : String(r.tipo),
        convenio: r.convenio == null ? null : Number(r.convenio),
        txJuros: Number(r.tx_juros ?? NaN),
        prazo: Number(r.prazo ?? NaN),
        catAplicada:
          r.cat_aplicada == null
            ? null
            : normalizeCategoria(String(r.cat_aplicada)),
        valorLiquido: Number(r.valor_liquido ?? 0),
        pctAplicado: Number(r.pct_aplicado ?? 0),
        comissaoPaga: Number(r.comissao_paga ?? 0),
        srccRestricao: r.status_fase1 === "SRCC",
        padraoDExclusao: padraoDMotivo != null,
        padraoDMotivo,
      });
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/** Auditoria de Camada 2 cash para um mês completo. */
export async function auditAvistaMes(
  sb: SupabaseLike,
  year: number,
  month: number
): Promise<AvistaMesPayload> {
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  // Camada 1 — uma vez por mês.
  const enq = await auditEnquadramentoMes(sb, year, month);
  const mesContext: MesContextAvista = {
    ym,
    regime: enq.regime,
    catDevida: enq.catDevida,
    catAplicada: enq.catAplicadaNormalizada,
    statusFase1: enq.status,
    jsonRegra: enq.jsonRegra,
    regraInferida: enq.regraInferida,
  };

  const padraoD = await fetchPadraoDExclusoes(sb);
  const contratos = await fetchAvistaContratosMes(sb, ym, padraoD);

  const resultados: ResultadoFase2Cash[] = [];
  const resumo: ResumoAvista = {
    totalContratos: 0,
    somaDiferencaPorStatus: {},
    contagemPorStatus: {},
    somaPedidoFirme21: 0,
    contagemPedidoFirme21: 0,
    contagemPorBloco: {},
    contagemSemLookup: 0,
  };
  for (const c of contratos) {
    const r = auditAvistaContrato(c, mesContext);
    resultados.push(r);
    resumo.totalContratos += 1;
    resumo.contagemPorStatus[r.statusFase2] =
      (resumo.contagemPorStatus[r.statusFase2] || 0) + 1;
    resumo.contagemPorBloco[r.bloco] =
      (resumo.contagemPorBloco[r.bloco] || 0) + 1;
    resumo.somaDiferencaPorStatus[r.statusFase2] =
      (resumo.somaDiferencaPorStatus[r.statusFase2] || 0) + r.diferenca;
    if (r.bloco === "PEDIDO_FIRME_2.1") {
      resumo.contagemPedidoFirme21 += 1;
      // Soma "valor a cobrar" = -diferenca (subpagamento tem dif < 0; cobrança é positivo)
      resumo.somaPedidoFirme21 += -r.diferenca;
    }
    if (r.statusFase2 === "SEM_LOOKUP") resumo.contagemSemLookup += 1;
  }

  return { ym, year, month, mesContext, resultados, resumo };
}

/**
 * Auditoria de Camada 2 cash para um intervalo de meses (inclusivo).
 * Iterativo — sequencial mês a mês (cada mês precisa de Camada 1 antes).
 */
export async function auditAvistaPeriodo(
  sb: SupabaseLike,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): Promise<AvistaMesPayload[]> {
  const out: AvistaMesPayload[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    out.push(await auditAvistaMes(sb, y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Mapeamento status → categoria operacional (acumula sumário consolidado). */
export function consolidarPeriodo(
  payloads: AvistaMesPayload[]
): {
  totalContratos: number;
  contagemPorStatus: Record<string, number>;
  contagemPorBloco: Record<string, number>;
  somaPedidoFirme21: number;
  contagemPedidoFirme21: number;
  contagemSemLookup: number;
} {
  const out = {
    totalContratos: 0,
    contagemPorStatus: {} as Record<string, number>,
    contagemPorBloco: {} as Record<string, number>,
    somaPedidoFirme21: 0,
    contagemPedidoFirme21: 0,
    contagemSemLookup: 0,
  };
  for (const p of payloads) {
    out.totalContratos += p.resumo.totalContratos;
    out.somaPedidoFirme21 += p.resumo.somaPedidoFirme21;
    out.contagemPedidoFirme21 += p.resumo.contagemPedidoFirme21;
    out.contagemSemLookup += p.resumo.contagemSemLookup;
    for (const [k, v] of Object.entries(p.resumo.contagemPorStatus))
      out.contagemPorStatus[k] = (out.contagemPorStatus[k] || 0) + v;
    for (const [k, v] of Object.entries(p.resumo.contagemPorBloco))
      out.contagemPorBloco[k] = (out.contagemPorBloco[k] || 0) + v;
  }
  return out;
}
