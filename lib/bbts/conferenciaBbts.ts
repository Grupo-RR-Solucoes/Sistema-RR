// ============================================================================
// Auditoria ADS/BBTS — 1C: CONFERÊNCIA régua BBTS x REALIZADO (o que a BBTS pagou).
//
// Cópia estrutural de lib/trp/conferenciaTrp.ts, com o mesmo contrato mental:
//   - a RÉGUA (a tabela da BBTS, versionada em bbts_rule_versions) é o que DEVERIA
//     ter sido pago;
//   - o REALIZADO (o que a BBTS PAGOU: bbts_pag_avista + bbts_prt_parcelas) é o FATO;
//   - esta lib compara os dois POR CONTRATO e sinaliza divergência. READ-ONLY.
//
// O QUE ELA NÃO É: não recalcula a comissão do PROMOTOR na ADS. Isso continua
// saindo da TRP da Promotiva (lib/bbtsMonthly.ts) e não muda. Esta conferência
// mede SOBRA/FALTA DE CAIXA da empresa: o que a BBTS devia à RR pelo acordo.
//
// FAIXA 4: o Grupo RR/ADS recebe sempre na Faixa 4 (acordo comercial, todos os
// convênios). Isso vive no RESOLVER (lookupPctBbts, default FAIXA_ADS) — aqui a
// gente só consome. Auditar "e se fosse Faixa 1?" é passar outra faixa.
//
// AS DUAS PERNAS (pág. 8 da tabela):
//   AVT  = min(pct da tabela, teto 6%) x valor financiado — pago no mês.
//   PRT  = o excedente do teto, "dividido pelo prazo da operação" — pago a prazo.
// A perna AVT é conferida contrato a contrato (é onde o erro de faixa aparece).
// A perna PRT gera um DIREITO A RECEBER (agenda) por contrato; as parcelas PRT
// pagas no mês são de contratos de competências ANTIGAS e entram numa lane
// separada (prtSemContratoNoUniverso) — NUNCA viram subpagamento aqui.
//
// PRAZO DA TABELA: a BBTS indexa os grupos consignados por "Parcelas" e os NÃO
// consignados (13o salário, CDC FGTS) por "Prazo (meses)". São colunas diferentes
// do mesmo PDF de fechamento — usar a errada joga o 13o (1 parcela, 19 meses) para
// fora da tabela por engano. Ver prazoDaTabela().
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { EPS_VALOR } from "@/lib/auditoriaAvista";
import { BBTS_COMPANY_ID } from "@/lib/bbtsClosingImport";
import { resolverGrupoBbts } from "@/lib/bbts/grupoBbts";
import { FAIXA_ADS, type RegraBbts } from "@/lib/bbts/regraBbts";
import {
  lookupPctBbts,
  resolveBbtsRegraDb,
  type BbtsRegraResolved,
} from "@/lib/bbts/resolveBbtsRegra";
import { competenciaFirstDay, competenciaKey, vigenciaDaCompetencia } from "@/lib/trp/vigencia";

export type StatusBbts =
  | "SUBPAGAMENTO"
  | "SOBREPAGAMENTO"
  | "OK"
  | "FORA_DA_TABELA"
  | "NAO_PAGO_SRCC"
  | "CANCELADO";

/** Grupos cuja matriz é indexada por PRAZO da operação (não por parcelas). */
const GRUPOS_POR_PRAZO = new Set(["NAO_CONSIGNADO_13", "CDC_FGTS"]);

/** Um contrato da ADS no universo do fechamento (o lado PAGO). */
export interface ContratoBbts {
  contrato: string;
  valorFinanciado: number;
  /** nº de parcelas da operação. */
  parcelas: number;
  /** "Prazo da Operação" do PDF (quando capturado). Usado pelos grupos por prazo. */
  prazoOperacao: number | null;
  /** taxa de juros mensal em DECIMAL (0.0185). */
  juros: number;
  convenioCode: string | null;
  convenioSegment: string | null;
  convenioType: string | null;
  produto: string | null;
  srcc: boolean;
  cancelado: boolean;
  /** o que a BBTS PAGOU à vista neste contrato (coluna bbts_pag_avista). */
  pagoAvista: number;
  /** parcelas PRT pagas NESTE mês para ESTE contrato (normalmente 0 nos do mês). */
  pagoPrtMes: number;
}

export interface LinhaConferenciaBbts {
  contrato: string;
  status: StatusBbts;
  grupo: string | null;
  tableKey: string | null;
  valorFinanciado: number;
  parcelas: number;
  prazoUsado: number;
  juros: number;
  faixa: string;
  /** % da tabela na Faixa 4 (base + bonificação), CRU — pode passar do teto. */
  pctTabela: number | null;
  /** parte à vista: min(pctTabela, teto). */
  pctAvista: number | null;
  /** excedente do teto (vai para o PRT). */
  pctDiferido: number | null;
  /** % que a BBTS de fato aplicou (pagoAvista / valorFinanciado). */
  pctRealizado: number | null;
  devidoAvista: number | null;
  pagoAvista: number;
  /** pagoAvista - devidoAvista (negativo = a BBTS pagou MENOS que o acordo). */
  diferenca: number | null;
  /** direito a receber gerado por este contrato (excedente do teto), total e mensal. */
  devidoPrtTotal: number | null;
  devidoPrtMensal: number | null;
  motivo: string | null;
}

export interface ResumoBbts {
  auditados: number;
  ok: number;
  subpagamentos: number;
  sobrepagamentos: number;
  foraDaTabela: number;
  srcc: number;
  cancelados: number;
  somaPagoAvista: number;
  somaDevidoAvista: number;
  /** Σ das diferenças NEGATIVAS — o que a BBTS deixou de pagar (o rombo). */
  somaSubpagamento: number;
  somaSobrepagamento: number;
  /** direito a receber (PRT) gerado pelos contratos do mês. */
  somaDevidoPrtGerado: number;
  /** PRT que a BBTS pagou no mês (contratos antigos). */
  somaPrtPagoNoMes: number;
}

export interface ConferenciaBbtsResult {
  ym: string;
  regua: {
    competenciaUsada: string;
    isFallback: boolean;
    direcao: "anterior" | "posterior" | null;
    versionNo: number | null;
    /** rótulo pronto para a tela. */
    aviso: string | null;
  } | null;
  linhas: LinhaConferenciaBbts[];
  /** parcelas PRT pagas no mês cujo contrato NÃO está no universo (competência antiga). */
  prtSemContratoNoUniverso: Array<{ contrato: string; valor: number; n_parcela: number }>;
  resumo: ResumoBbts;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Qual "prazo" a tabela da BBTS usa para este grupo. */
export function prazoDaTabela(grupo: string | null, c: ContratoBbts): number {
  if (grupo && GRUPOS_POR_PRAZO.has(grupo) && c.prazoOperacao != null) return c.prazoOperacao;
  return c.parcelas;
}

const STATUS_RANK: Record<StatusBbts, number> = {
  SUBPAGAMENTO: 0,
  SOBREPAGAMENTO: 1,
  FORA_DA_TABELA: 2,
  NAO_PAGO_SRCC: 3,
  CANCELADO: 4,
  OK: 5,
};

// ---------------------------------------------------------------------------
// CAMADA 3 (pura): compara UM contrato contra a régua.
// ---------------------------------------------------------------------------
export function compararContratoBbts(
  c: ContratoBbts,
  regra: RegraBbts,
  opts: { faixa?: string } = {},
): LinhaConferenciaBbts {
  const faixa = opts.faixa ?? FAIXA_ADS;
  const base: LinhaConferenciaBbts = {
    contrato: c.contrato,
    status: "OK",
    grupo: null,
    tableKey: null,
    valorFinanciado: c.valorFinanciado,
    parcelas: c.parcelas,
    prazoUsado: c.parcelas,
    juros: c.juros,
    faixa,
    pctTabela: null,
    pctAvista: null,
    pctDiferido: null,
    pctRealizado: c.valorFinanciado > 0 ? c.pagoAvista / c.valorFinanciado : null,
    devidoAvista: null,
    pagoAvista: c.pagoAvista,
    diferenca: null,
    devidoPrtTotal: null,
    devidoPrtMensal: null,
    motivo: null,
  };

  // Cancelado: a BBTS não paga cancelamento — fora da conferência (não é divergência).
  if (c.cancelado) {
    return { ...base, status: "CANCELADO", motivo: "operacao cancelada" };
  }
  // SRCC: o PDF é explícito — "operações com restrição SRCC serão consideradas na
  // apuração do desempenho, mas NÃO serão pagas". Devido = 0 por regra.
  if (c.srcc) {
    return {
      ...base,
      status: "NAO_PAGO_SRCC",
      devidoAvista: 0,
      diferenca: round2(c.pagoAvista),
      motivo: "restricao SRCC — pela tabela, nao e paga",
    };
  }

  // ROTEIA PRIMEIRO. O roteamento (convênio/produto -> grupo) NÃO depende de achar
  // célula: é o grupo que decide QUAL prazo a tabela usa (parcelas x prazo da
  // operação). Descobrir o grupo por tentativa de lookup seria circular — e jogaria
  // o 13o salário (1 parcela, 19 meses) para fora da tabela por engano.
  const roteado = resolverGrupoBbts(toOperacao(c, c.parcelas), regra);
  const prazoUsado = prazoDaTabela(roteado.grupo || null, c);
  const res = lookupPctBbts(regra, toOperacao(c, prazoUsado), { faixa });

  if (!res.ok) {
    // Sem célula: produto/juros/prazo fora da matriz. NUNCA vira subpagamento —
    // é o análogo do NAO_CONFERIVEL da conferência do RR.
    return {
      ...base,
      status: "FORA_DA_TABELA",
      grupo: roteado.grupo || null,
      tableKey: roteado.tableKey,
      prazoUsado,
      motivo: res.motivo,
    };
  }

  const r = res.ok;
  const devidoAvista = round2(c.valorFinanciado * r.pctAvista);
  const diferenca = round2(c.pagoAvista - devidoAvista);
  const status: StatusBbts =
    diferenca < -EPS_VALOR ? "SUBPAGAMENTO" : diferenca > EPS_VALOR ? "SOBREPAGAMENTO" : "OK";

  return {
    ...base,
    status,
    grupo: r.grupo,
    tableKey: r.tableKey,
    prazoUsado,
    pctTabela: r.pctTabela,
    pctAvista: r.pctAvista,
    pctDiferido: r.pctDiferido,
    devidoAvista,
    diferenca,
    devidoPrtTotal: round2(c.valorFinanciado * r.pctDiferido),
    devidoPrtMensal: round2(c.valorFinanciado * r.pctDiferidoMensal),
    motivo: r.motivos.length ? r.motivos.join(" | ") : null,
  };
}

function toOperacao(c: ContratoBbts, prazo: number) {
  return {
    convenio_code: c.convenioCode,
    convenio_segment: c.convenioSegment,
    convenio_type: c.convenioType,
    product_description: c.produto,
    taxa_juros: c.juros,
    prazo,
  };
}

// ---------------------------------------------------------------------------
// CAMADA 3 (pura): confere o MÊS inteiro a partir de um universo já montado.
// Exportada para que gates/ferramentas possam rodar sem banco.
// ---------------------------------------------------------------------------
export function conferirBbts(
  ym: string,
  contratos: ContratoBbts[],
  resolvida: BbtsRegraResolved | null,
  prtDoMes: Array<{ contrato: string; valor: number; n_parcela: number }> = [],
  opts: { faixa?: string } = {},
): ConferenciaBbtsResult {
  const noUniverso = new Set(contratos.map((c) => c.contrato));
  const prtSemContrato = prtDoMes.filter((p) => !noUniverso.has(p.contrato));

  if (!resolvida) {
    // Sem régua em lugar nenhum: nada é conferível. NÃO inventa devido.
    return {
      ym,
      regua: null,
      linhas: contratos.map((c) => ({
        ...compararContratoBbts(c, { _meta: {}, convenios: {}, grupos: {} } as unknown as RegraBbts, opts),
        status: "FORA_DA_TABELA" as StatusBbts,
        motivo: "sem regua BBTS para a competencia (nenhuma versao ativa no banco)",
      })),
      prtSemContratoNoUniverso: prtSemContrato,
      resumo: resumoVazio(contratos.length),
    };
  }

  const linhas = contratos
    .map((c) => compararContratoBbts(c, resolvida.regra, opts))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.diferenca ?? 0) - (b.diferenca ?? 0));

  const resumo: ResumoBbts = {
    auditados: linhas.length,
    ok: linhas.filter((l) => l.status === "OK").length,
    subpagamentos: linhas.filter((l) => l.status === "SUBPAGAMENTO").length,
    sobrepagamentos: linhas.filter((l) => l.status === "SOBREPAGAMENTO").length,
    foraDaTabela: linhas.filter((l) => l.status === "FORA_DA_TABELA").length,
    srcc: linhas.filter((l) => l.status === "NAO_PAGO_SRCC").length,
    cancelados: linhas.filter((l) => l.status === "CANCELADO").length,
    somaPagoAvista: round2(linhas.reduce((a, l) => a + l.pagoAvista, 0)),
    somaDevidoAvista: round2(linhas.reduce((a, l) => a + (l.devidoAvista ?? 0), 0)),
    somaSubpagamento: round2(
      linhas.filter((l) => l.status === "SUBPAGAMENTO").reduce((a, l) => a + (l.diferenca ?? 0), 0),
    ),
    somaSobrepagamento: round2(
      linhas.filter((l) => l.status === "SOBREPAGAMENTO").reduce((a, l) => a + (l.diferenca ?? 0), 0),
    ),
    somaDevidoPrtGerado: round2(linhas.reduce((a, l) => a + (l.devidoPrtTotal ?? 0), 0)),
    somaPrtPagoNoMes: round2(prtDoMes.reduce((a, p) => a + p.valor, 0)),
  };

  return {
    ym,
    regua: {
      competenciaUsada: resolvida.competenciaFornecedora,
      isFallback: resolvida.isFallback,
      direcao: resolvida.direcao,
      versionNo: resolvida.versionNo,
      aviso: resolvida.isFallback
        ? `${ym} auditado com a tabela de ${resolvida.competenciaFornecedora} ` +
          `(${resolvida.direcao === "posterior" ? "a tabela desta competencia nao foi subida; usada a seguinte" : "usada a anterior"})`
        : null,
    },
    linhas,
    prtSemContratoNoUniverso: prtSemContrato,
    resumo,
  };
}

function resumoVazio(n: number): ResumoBbts {
  return {
    auditados: n,
    ok: 0,
    subpagamentos: 0,
    sobrepagamentos: 0,
    foraDaTabela: n,
    srcc: 0,
    cancelados: 0,
    somaPagoAvista: 0,
    somaDevidoAvista: 0,
    somaSubpagamento: 0,
    somaSobrepagamento: 0,
    somaDevidoPrtGerado: 0,
    somaPrtPagoNoMes: 0,
  };
}

// ---------------------------------------------------------------------------
// CAMADA 2: o UNIVERSO DO PAGO, do banco (análogo do auditAvistaMesVivo do RR).
// ---------------------------------------------------------------------------

/**
 * Carrega os contratos da ADS de uma competência. O recorte é a JANELA DE VIGÊNCIA
 * holiday-aware (a mesma do resto do sistema), NÃO o mês calendário: por isso um
 * contrato de 29/05 entra na competência de junho — e é assim que ele aparece no
 * fechamento de junho da BBTS.
 */
export async function carregarUniversoBbtsDb(
  supabase: SupabaseClient,
  ym: string,
): Promise<{ contratos: ContratoBbts[]; prt: Array<{ contrato: string; valor: number; n_parcela: number }> }> {
  const comp = competenciaKey(ym);
  const vig = vigenciaDaCompetencia(comp);

  // FIX 2.3: a diaria VIVA ADS grava movement_date mas deixa contract_date NULO
  // (a aba "Total" nao tem coluna de data de contratacao), entao filtrar so por
  // contract_date zerava a conferencia no mes ABERTO. Fallback ESTREITO: mantem o
  // filtro por contract_date IDENTICO para linhas com a data preenchida (mes
  // fechado nao muda) e SO acrescenta as linhas com contract_date IS NULL cujo
  // movement_date cai na MESMA janela de vigencia. Nao reclassifica nenhuma linha
  // de fronteira ja existente (contract_date preenchido continua mandando) —
  // blast radius = so o mes vivo. NAO preenche contract_date na gravacao: nao ha
  // fonte e a semantica de contract_date ("data real de venda") e reservada.
  //
  // company_id.eq DENTRO de cada and() do or (alem do .eq de topo, que ja e
  // AND-ado com o grupo inteiro): garante que NENHUMA clausula do or vaze linha
  // de outra empresa, mesmo que alguem adicione um 3o disjunto no futuro.
  const win = `contract_date.gte.${vig.validFrom},contract_date.lte.${vig.validUntil}`;
  const winNull = `contract_date.is.null,movement_date.gte.${vig.validFrom},movement_date.lte.${vig.validUntil}`;
  const { data, error } = await supabase
    .from("daily_production_records")
    .select(
      "proposal_number, gross_value, term_months, installments, interest_rate, convenio_code, convenio_segment, convenio_type, product_description, status, is_srcc_restricted, bbts_pag_avista, raw_payload",
    )
    .eq("company_id", BBTS_COMPANY_ID)
    .or(
      `and(company_id.eq.${BBTS_COMPANY_ID},${win}),` +
        `and(company_id.eq.${BBTS_COMPANY_ID},${winNull})`,
    );
  if (error) throw new Error(`carregarUniversoBbtsDb: ${error.message}`);

  const prtRes = await supabase
    .from("bbts_prt_parcelas")
    .select("proposal_number, valor_parcela, n_parcela")
    .eq("company_id", BBTS_COMPANY_ID)
    .eq("competencia", competenciaFirstDay(comp));
  if (prtRes.error) throw new Error(`carregarUniversoBbtsDb (PRT): ${prtRes.error.message}`);

  const prt = (prtRes.data ?? []).map((p) => ({
    contrato: String(p.proposal_number),
    valor: Number(p.valor_parcela) || 0,
    n_parcela: Number(p.n_parcela) || 0,
  }));
  const prtPorContrato = new Map<string, number>();
  for (const p of prt) prtPorContrato.set(p.contrato, (prtPorContrato.get(p.contrato) ?? 0) + p.valor);

  const contratos: ContratoBbts[] = (data ?? []).map((r) => {
    const meta = ((r.raw_payload as Record<string, unknown> | null)?.__bbts_meta ?? {}) as Record<string, unknown>;
    const contrato = String(r.proposal_number);
    return {
      contrato,
      valorFinanciado: Number(r.gross_value) || 0,
      parcelas: Number(r.term_months ?? r.installments) || 0,
      prazoOperacao: meta.prazo_operacao == null ? null : Number(meta.prazo_operacao),
      // interest_rate vem em PONTOS (1,85) — a régua trabalha em decimal.
      juros: (Number(r.interest_rate) || 0) / 100,
      convenioCode: r.convenio_code == null ? null : String(r.convenio_code),
      convenioSegment: r.convenio_segment == null ? null : String(r.convenio_segment),
      convenioType: r.convenio_type == null ? null : String(r.convenio_type),
      produto: r.product_description == null ? null : String(r.product_description),
      srcc: r.is_srcc_restricted === true,
      cancelado: String(r.status ?? "").toUpperCase() === "CANCELADO",
      pagoAvista: Number(r.bbts_pag_avista) || 0,
      pagoPrtMes: prtPorContrato.get(contrato) ?? 0,
    };
  });

  return { contratos, prt };
}

// ---------------------------------------------------------------------------
// Orquestração (caminho de produção): banco -> régua -> conferência.
// ---------------------------------------------------------------------------
export async function conferirBbtsMes(
  supabase: SupabaseClient,
  ym: string,
  opts: { faixa?: string } = {},
): Promise<ConferenciaBbtsResult> {
  const comp = competenciaKey(ym);
  const { contratos, prt } = await carregarUniversoBbtsDb(supabase, comp);
  const resolvida = await resolveBbtsRegraDb({ competencia: comp }, supabase);
  return conferirBbts(comp, contratos, resolvida, prt, opts);
}
