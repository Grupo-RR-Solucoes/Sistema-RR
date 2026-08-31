// ============================================================================
// Conferência TRP × REALIZADO — sub-fase (a): lib backend pura, testável isolada.
//
// A TRP versionada é a RÉGUA (o pct que DEVERIA ser); o realizado (o que a
// Promotiva PAGOU à vista, do universo de fechamento) é o FATO. Esta lib compara
// os dois por contrato e sinaliza divergências. NÃO substitui o cálculo de
// fechamento (o realizado continua ground truth) — é padrão de conferência.
//
// REUSO (NÃO altera nada): o universo/faixa/segmento/SRCC vem intacto de
// auditAvistaMesVivo (que já monta o ContratoAvista do CASH pago, incl.
// pctAplicado = comissaoPaga/valorLiquido = o realizado). A engine
// auditAvistaContrato NÃO é usada aqui — ela aplica TETO BACEN por categoria;
// esta conferência usa TETO EMPRESA 6% LISO (decisão de negócio). São dois
// "devidos" distintos e as telas devem rotular cada um.
//
// FONTE DA RÉGUA (escopo temporal):
//   - ym >= 2026-04: trp_rule_versions (versão ativa, com fallback em cascata).
//   - ym <  2026-04: matriz JSON estática (getRegra/MAPA_MES_REGRA, 41 meses).
//
// READ-ONLY: não escreve nada.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { EPS_VALOR, type ContratoAvista } from "../auditoriaAvista.ts";
import { auditAvistaMesVivo } from "../auditoriaAvistaViva.ts";
import { auditEnquadramentoMes } from "../enquadramento.ts";
import type { RegraMes } from "../regrasData.ts";
import { getMatrizTRPParaContrato, getRegime, getRegra } from "../regrasLoader.ts";
import type { Regime } from "../types/blocos.ts";
import { createTrpRegraDbPreloader } from "./resolveTrpRegraDb.ts";

/** Teto à-vista da EMPRESA (TRP doc 201). LISO, sem BACEN por categoria — decisão
 *  de negócio desta conferência. O excedente da tabela vira diferido/PRT. */
const TETO_EMPRESA_AVISTA = 0.06;

/** Primeira competência com TRP versionada seeded (abr/2026). Antes disso a régua
 *  vem do JSON estático — chaveamento lexicográfico "YYYY-MM". */
const CORTE_VERSIONADA = "2026-04";

export type ConfStatus = "SUBPAGAMENTO" | "SOBREPAGAMENTO" | "OK" | "NAO_CONFERIVEL";

/** Régua resolvida para uma competência (fonte + sinal de fallback). */
export interface ReguaCompetencia {
  regra: RegraMes;
  jsonRegra: string;
  fonte: "db" | "json";
  /** true = régua veio de competência anterior (TRP própria não publicada). */
  isFallback: boolean;
  /** Competência que forneceu a régra (== alvo, salvo fallback). */
  competenciaFornecedora: string;
  /**
   * true = a competência tem 2+ réguas ATIVAS (vigência intra-mês). Nesse caso
   * NÃO existe "a régua do mês": cada contrato é conferido pela fatia da sua
   * data. Sempre false no caminho JSON.
   */
  competenciaPartida: boolean;
}

/** Uma linha da conferência: o par (realizado, régua) por contrato. */
export interface LinhaConferencia {
  contrato: string;
  empresa: string;
  produto: string | null;
  tipo: string | null;
  prazo: number;
  txJuros: number;
  faixa: string | null;
  valorLiquido: number;
  /** comissaoPaga/valorLiquido — o realizado (capado, o fato). */
  pctRealizado: number;
  /** min(pctTabelaCru, 6%) — a régua (base da comparação). null se não conferível. */
  pctRegua: number | null;
  /** lookup.pct CRU (pode passar de 6%). SÓ referência "tabela cheia". */
  pctTabelaCru: number | null;
  comissaoPaga: number;
  /** valorLiquido × pctRegua. null se não conferível. */
  comissaoDevida: number | null;
  /** comissaoPaga − comissaoDevida (sinal v9: <0 = subpagamento). null se n/c. */
  diferenca: number | null;
  /** pctRealizado − pctRegua (informativo). null se não conferível. */
  deltaPct: number | null;
  status: ConfStatus;
  celula: string | null;
  /** preenchido em NAO_CONFERIVEL (motivo do lookup). */
  motivo: string | null;
}

export interface ConferenciaTrpResult {
  ym: string;
  regua: {
    fonte: "db" | "json" | null;
    isFallback: boolean;
    competenciaFornecedora: string | null;
    /** true = competência com 2+ réguas ativas; cada linha usou a fatia da sua data. */
    competenciaPartida: boolean;
  };
  linhas: LinhaConferencia[];
  resumo: {
    auditados: number;
    subpagamentos: number;
    somaSubpagamento: number;
    sobrepagamentos: number;
    naoConferiveis: number;
  };
}

/**
 * Resolve a régua da competência: TRP versionada (abr/2026+) ou JSON estático
 * (histórico). Retorna null só quando NENHUMA fonte tem regra (não deveria
 * ocorrer nos meses cobertos). O fallback em cascata é sinalizado em isFallback.
 */
export async function resolveReguaCompetencia(
  sb: SupabaseClient,
  ym: string,
  /**
   * VIGENCIA INTRA-MES: data do contrato, para escolher a FATIA quando a
   * competencia tem 2+ reguas ativas. Opcional — sem ela vale a fatia de maior
   * valid_from, que numa competencia de regua unica e a propria (no-op).
   */
  contractDate?: string | null,
): Promise<ReguaCompetencia | null> {
  if (ym >= CORTE_VERSIONADA) {
    const preloader = createTrpRegraDbPreloader(sb);
    await preloader.preload([ym]);
    const resolved = preloader.getResolvedSync(ym, contractDate ?? null);
    if (resolved) {
      return {
        regra: resolved.regra,
        jsonRegra: "db:trp_rule_versions",
        fonte: "db",
        isFallback: resolved.isFallback,
        competenciaFornecedora: resolved.competenciaFornecedora,
        competenciaPartida: resolved.competenciaPartida,
      };
    }
    // defensivo: sem versão no banco (abril é seeded, não deveria) → cai no JSON.
  }
  const j = getRegra(ym);
  if (!j) return null;
  return {
    regra: j.regra,
    jsonRegra: j.jsonRegra,
    fonte: "json",
    isFallback: j.regraInferida,
    competenciaFornecedora: ym,
    competenciaPartida: false,
  };
}

/**
 * Como a resolveReguaCompetencia, mas devolvendo a FUNCAO de escolha por
 * contrato: carrega o preloader UMA vez e escolhe a fatia por contract_date.
 * Existe para o conferirTrpMes nao abrir uma conexao por linha.
 */
async function carregarReguaPorContrato(
  sb: SupabaseClient,
  ym: string,
): Promise<{
  /** null quando nem o DB nem o JSON tem regua para a competencia. */
  escolher: (contractDate?: string | null) => ReguaCompetencia | null;
  /** a regua "do mes" (fatia de maior valid_from) — para o cabecalho do result. */
  cabecalho: ReguaCompetencia | null;
  partida: boolean;
}> {
  if (ym >= CORTE_VERSIONADA) {
    const preloader = createTrpRegraDbPreloader(sb);
    await preloader.preload([ym]);
    const comp = preloader.getCompetenciaSync(ym);
    if (comp && comp.fatias.length > 0) {
      const toRegua = (r: NonNullable<ReturnType<typeof preloader.getResolvedSync>>) => ({
        regra: r.regra,
        jsonRegra: "db:trp_rule_versions",
        fonte: "db" as const,
        isFallback: r.isFallback,
        competenciaFornecedora: r.competenciaFornecedora,
        competenciaPartida: r.competenciaPartida,
      });
      return {
        escolher: (contractDate?: string | null) => {
          const r = preloader.getResolvedSync(ym, contractDate ?? null);
          return r ? toRegua(r) : null;
        },
        cabecalho: toRegua(comp.fatias[0]),
        partida: comp.partida,
      };
    }
  }
  const j = getRegra(ym);
  if (!j) return { escolher: () => null, cabecalho: null, partida: false };
  const regua: ReguaCompetencia = {
    regra: j.regra,
    jsonRegra: j.jsonRegra,
    fonte: "json",
    isFallback: j.regraInferida,
    competenciaFornecedora: ym,
    competenciaPartida: false,
  };
  return { escolher: () => regua, cabecalho: regua, partida: false };
}

/**
 * Compara UM contrato realizado contra a régua da competência.
 * Régua = min(célula TRP, 6% LISO). Realizado = contrato.pctAplicado.
 * lookup nulo → NAO_CONFERIVEL (nunca conta como subpagamento).
 *
 * `catDevida` = categoria devida do enquadramento (Camada 1), no nível do mês.
 * Espelha o engine (auditAvistaContrato): `catDevida ?? contrato.catAplicada` —
 * VOLUME (ex.: a TRP versionada, abr/26+) tem catDevida null → usa a faixa
 * per-contrato; META (histórico) usa a categoria do enquadramento.
 */
export function compararContratoTrp(
  contrato: ContratoAvista,
  regime: Regime,
  regua: ReguaCompetencia,
  catDevida: string | null,
): LinhaConferencia {
  const catParaLookup = catDevida ?? contrato.catAplicada;
  const base = {
    contrato: contrato.contractNumber,
    empresa: contrato.empresa,
    produto: contrato.produto,
    tipo: contrato.tipo,
    prazo: contrato.prazo,
    txJuros: contrato.txJuros,
    faixa: contrato.catAplicada,
    valorLiquido: contrato.valorLiquido,
    pctRealizado: contrato.pctAplicado,
    comissaoPaga: contrato.comissaoPaga,
  };

  const lookup = getMatrizTRPParaContrato(
    {
      mes: contrato.mes,
      produto: contrato.produto,
      tipo: contrato.tipo,
      convenio: contrato.convenio,
      txJuros: contrato.txJuros,
      prazo: contrato.prazo,
    },
    regime,
    catParaLookup,
    { regra: regua.regra, jsonRegra: regua.jsonRegra, regraInferida: regua.isFallback },
  );

  if (lookup.pct == null) {
    return {
      ...base,
      pctRegua: null,
      pctTabelaCru: null,
      comissaoDevida: null,
      diferenca: null,
      deltaPct: null,
      status: "NAO_CONFERIVEL",
      celula: null,
      motivo: lookup.motivos.join(" | ") || "sem célula na régua",
    };
  }

  const pctTabelaCru = lookup.pct;
  const pctRegua = Math.min(pctTabelaCru, TETO_EMPRESA_AVISTA); // 6% LISO
  const comissaoDevida = contrato.valorLiquido * pctRegua;
  const diferenca = contrato.comissaoPaga - comissaoDevida; // sinal v9
  const status: ConfStatus =
    diferenca < -EPS_VALOR ? "SUBPAGAMENTO" : diferenca > EPS_VALOR ? "SOBREPAGAMENTO" : "OK";

  return {
    ...base,
    pctRegua,
    pctTabelaCru,
    comissaoDevida,
    diferenca,
    deltaPct: contrato.pctAplicado - pctRegua,
    status,
    celula: lookup.celula,
    motivo: null,
  };
}

const STATUS_RANK: Record<ConfStatus, number> = {
  SUBPAGAMENTO: 0,
  SOBREPAGAMENTO: 1,
  OK: 2,
  NAO_CONFERIVEL: 3,
};

/**
 * Confere a competência inteira: reusa auditAvistaMesVivo para o universo do
 * fechamento e compara cada contrato contra a régua. Ordena subpagamentos
 * primeiro (mais negativo no topo). READ-ONLY.
 */
export async function conferirTrpMes(
  sb: SupabaseClient,
  year: number,
  month: number,
): Promise<ConferenciaTrpResult> {
  const vivo = await auditAvistaMesVivo(sb, year, month);
  const ym = vivo.ym;
  const regime = getRegime(ym);
  // VIGENCIA INTRA-MES: a regua deixa de ser UMA do mes e passa a ser escolhida
  // POR CONTRATO (pela contract_date). Numa competencia de regua unica o
  // escolher() devolve sempre a mesma — no-op contra o comportamento anterior.
  const { escolher, cabecalho, partida } = await carregarReguaPorContrato(sb, ym);
  const regua = cabecalho;
  // catDevida (Camada 1) — mesma resolução de categoria do engine: VOLUME
  // (TRP versionada) → null → usa a faixa per-contrato; META (histórico) → a
  // categoria do enquadramento. Sem isso, meses META caem em NAO_CONFERIVEL.
  const enq = await auditEnquadramentoMes(sb, year, month);
  const catDevida = enq.catDevida;

  const linhas: LinhaConferencia[] = vivo.itensAuditados.map(({ contrato }) => {
    if (!regua) {
      // sem régua na competência: não inventa devido — tudo não-conferível.
      return {
        contrato: contrato.contractNumber,
        empresa: contrato.empresa,
        produto: contrato.produto,
        tipo: contrato.tipo,
        prazo: contrato.prazo,
        txJuros: contrato.txJuros,
        faixa: contrato.catAplicada,
        valorLiquido: contrato.valorLiquido,
        pctRealizado: contrato.pctAplicado,
        pctRegua: null,
        pctTabelaCru: null,
        comissaoPaga: contrato.comissaoPaga,
        comissaoDevida: null,
        diferenca: null,
        deltaPct: null,
        status: "NAO_CONFERIVEL" as const,
        celula: null,
        motivo: "sem régua (TRP) para a competência",
      };
    }
    const reguaDoContrato = escolher(contrato.contractDate ?? null);
    if (!reguaDoContrato) {
      // competencia PARTIDA e a data do contrato nao cai em fatia nenhuma (ou o
      // contrato nao tem data e a competencia esta partida). NAO confere contra
      // "a regua do mes": auditaria pela regua errada e o SUBPAGAMENTO sairia
      // inventado. Nao-conferivel com o motivo nomeado e a resposta honesta.
      return {
        contrato: contrato.contractNumber,
        empresa: contrato.empresa,
        produto: contrato.produto,
        tipo: contrato.tipo,
        prazo: contrato.prazo,
        txJuros: contrato.txJuros,
        faixa: contrato.catAplicada,
        valorLiquido: contrato.valorLiquido,
        pctRealizado: contrato.pctAplicado,
        pctRegua: null,
        pctTabelaCru: null,
        comissaoPaga: contrato.comissaoPaga,
        comissaoDevida: null,
        diferenca: null,
        deltaPct: null,
        status: "NAO_CONFERIVEL" as const,
        celula: null,
        motivo: `competência ${ym} com vigência PARTIDA e contrato sem fatia (data=${contrato.contractDate ?? "ausente"})`,
      };
    }
    return compararContratoTrp(contrato, regime, reguaDoContrato, catDevida);
  });

  linhas.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.diferenca ?? 0) - (b.diferenca ?? 0),
  );

  let subpagamentos = 0;
  let somaSubpagamento = 0;
  let sobrepagamentos = 0;
  let naoConferiveis = 0;
  for (const l of linhas) {
    if (l.status === "SUBPAGAMENTO") {
      subpagamentos += 1;
      somaSubpagamento += -(l.diferenca as number);
    } else if (l.status === "SOBREPAGAMENTO") {
      sobrepagamentos += 1;
    } else if (l.status === "NAO_CONFERIVEL") {
      naoConferiveis += 1;
    }
  }

  return {
    ym,
    regua: {
      fonte: regua?.fonte ?? null,
      isFallback: regua?.isFallback ?? false,
      competenciaFornecedora: regua?.competenciaFornecedora ?? null,
      // true = NAO existe "a regua do mes"; cada linha foi conferida pela fatia
      // da sua propria data. O cabecalho acima e o da ULTIMA fatia.
      competenciaPartida: partida,
    },
    linhas,
    resumo: {
      auditados: linhas.length,
      subpagamentos,
      somaSubpagamento,
      sobrepagamentos,
      naoConferiveis,
    },
  };
}
