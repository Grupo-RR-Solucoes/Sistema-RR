/**
 * Camada 2 À Vista — auditoria contrato a contrato (Fase 4.3).
 *
 * Para cada contrato em audit_v9_avista, determina pct_devido independente
 * usando Cat_Devida da Camada 1 (Fase 4.2), busca pct_tabela na matriz
 * TRP/OPP do mês, aplica teto BACEN, classifica em status_fase2 v9 +
 * submotivo de granularidade, atribui bloco de tratamento.
 *
 * Inputs:
 *   - contrato (subset de audit_v9_avista)
 *   - mesContext (output de auditEnquadramentoMes — Camada 1)
 *
 * Output:
 *   - ResultadoFase2Cash com 4 dimensões comparáveis byte-a-byte com v9:
 *     status_fase2, diferenca, pct_devido, bloco.
 *
 * ===========================================================================
 * CONVENÇÃO DE SINAL DE `diferenca` — IMPORTANTE PARA UI (Fase 4.6)
 * ===========================================================================
 *
 *   diferenca = comissao_paga - comissao_devida   ← convenção v9 (mirror)
 *
 *   - diferenca <  0  → SUBPAGAMENTO              (Promotiva pagou MENOS)
 *   - diferenca >  0  → SUPERPAGAMENTO_FAVORAVEL  (Promotiva pagou MAIS)
 *   - diferenca == 0  → OK
 *
 * Frontend que renderizar "Cobrança Imediata = R$ 60.040,89" para o usuário
 * deve aplicar Math.abs(diferenca) ou inverter sinal (Σ -diferenca dos
 * SUBPAGAMENTO contratos = +60.040,89). Convenção v9 é ENGENHEIRA (sinal
 * preserva direção do erro), não UX.
 *
 * SRCC e SEM_LOOKUP/FORA_DA_TABELA têm convenções próprias (vide pseudocódigo
 * abaixo) — também mirroram v9 byte-a-byte.
 * ===========================================================================
 */

import {
  EPS,
  getMatrizTRPParaContrato,
  tetoBacenForCategoria,
} from "./regrasLoader.ts";
import type { Bloco, Regime, StatusFase1, StatusFase2 } from "./types/blocos.ts";

/** Tolerância de classificação por valor monetário (meio centavo). Acomoda
 *  arredondamentos Excel sem deixar passar diferenças relevantes. */
export const EPS_VALOR = 0.005;

/** Subset do output da Camada 1 (auditEnquadramentoMes) necessário aqui. */
export interface MesContextAvista {
  /** ISO YYYY-MM. */
  ym: string;
  regime: Regime;
  /** Categoria devida em formato canônico v9 ("TABELA 2", "SAFIRA"). null em
   *  regimes VOLUME (INDETERMINADO) e em meses SEM_DADOS. */
  catDevida: string | null;
  /** Cat_Aplicada normalizada do snapshot Validador/Resumo. null se ausente. */
  catAplicada: string | null;
  /** Status fase 1 da Camada 1 — drive da granularidade SUBPAGAMENTO_*
   *  e SUPERPAGAMENTO_*. */
  statusFase1: StatusFase1;
  /** Nome do JSON da regra (trace). */
  jsonRegra: string;
  /** True se mês usa fallback (Jun/2023, Set-Dez/2023, Mai/2024). */
  regraInferida: boolean;
}

/** Subset de audit_v9_avista necessário para auditoria. */
export interface ContratoAvista {
  contractNumber: string;
  empresa: string;
  /** CNPJ da empresa (dígitos; opcional — usado p/ consolidação em minutas). */
  cnpj?: string | null;
  /** ISO YYYY-MM. */
  mes: string;
  /**
   * ISO YYYY-MM-DD — data do CONTRATO (da diaria), quando conhecida. Existe para
   * a VIGENCIA INTRA-MES: numa competencia com 2+ reguas ativas (agosto/2026:
   * TRP38 ate 04/08, TRP39 de 05/08) a conferencia precisa saber por QUAL fatia
   * aquele contrato deveria ter sido pago. Opcional: a fonte da conferencia e o
   * FECHAMENTO, que nao traz a data — ela vem do join com a diaria.
   */
  contractDate?: string | null;
  produto: string | null;
  /** "NOVO" | "RENOVACAO". */
  tipo: string | null;
  convenio: number | string | null;
  /** Aceita unidade percentual (1.65) ou decimal (0.0165) — getMatrizTRP
   *  detecta e normaliza. */
  txJuros: number;
  prazo: number;
  /** Categoria aplicada por contrato (v9: per-row). Canônica UPPERCASE. */
  catAplicada: string | null;
  valorLiquido: number;
  /** Pct aplicado pela Promotiva (decimal). Usado p/ distinguir
   *  FORA_DA_TABELA (pctApl=0) vs SEM_LOOKUP (pctApl>0) quando lookup falha. */
  pctAplicado: number;
  comissaoPaga: number;
  /** True se contrato tem restrição SRCC (audit_v9_avista.status_fase1='SRCC'). */
  srccRestricao: boolean;
  /** True se contrato consta em audit_v9_padrao_d_exclusoes (Padrão D — Fase 4.3 D.1).
   *  Quando true, motor classifica como SUBPAGAMENTO mas força bloco=EXCLUIDO_AUDITORIA
   *  (mirror v9: v9 humana excluiu de Sol Reg 2.1 sem regra publicada).
   *  Caller (auditoriaAvistaBatch.ts) pré-carrega o flag via fetchPadraoDExclusoes. */
  padraoDExclusao: boolean;
  /** Motivo da exclusão Padrão D (do banco). null se padraoDExclusao=false. */
  padraoDMotivo:
    | "INCONSISTENCIA_CAMADA1_V9"
    | "TOLERANCIA_SILENCIOSA_VOLUME"
    | "OUTRO"
    | null;
}

/** Trace G22+G23: rastreabilidade documental por contrato. */
export interface TraceFase2Cash {
  regime: Regime;
  /** Categoria que o motor usou no lookup (canônica). */
  catDevidaUsada: string | null;
  catAplicada: string | null;
  statusFase1: StatusFase1;
  jsonRegra: string | null;
  regraInferida: boolean;
  /** Categoria de produto JSON onde o lookup achou (ex.: "INSS"). */
  categoriaProduto: string | null;
  /** Descrição da célula que matchou. */
  celula: string | null;
  /** tabLabel JSON usado (ex.: "Tabela 2", "Faixa 3"). */
  tabLabelUsado: string | null;
  /** Pct cheio antes do teto BACEN. null se lookup falhou. */
  pctTabelaUncapped: number | null;
  /** Teto BACEN aplicado (0.054/0.056/0.058/0.060 ou null). */
  tetoBacen: number | null;
  /** Lista de razões de falha por candidato (debug). */
  motivos: string[];
}

/** Resultado completo da auditoria fase 2 cash de um contrato. */
export interface ResultadoFase2Cash {
  contractNumber: string;
  ym: string;
  /** Mantém nomes legados v9 — comparação byte-a-byte com audit_v9_avista
   *  status_fase1 column. */
  statusFase2: StatusFase2;
  /** Granularidade extra para SUBPAGAMENTO (null caso contrário). */
  subpagamentoMotivo: "ENQUADRAMENTO_ERRADO" | "PCT_INTERNO_ERRADO" | null;
  /** Granularidade extra para SUPERPAGAMENTO_FAVORAVEL (null caso contrário). */
  superpagamentoMotivo: "BONUS_PERFORMANCE" | "ENQUADRAMENTO_FAVORAVEL" | null;
  /** Pct cheio retornado pela matriz (sem teto). null se SRCC ou lookup falhou. */
  pctTabelaCalculado: number | null;
  /** Pct devido após teto BACEN. 0 para SRCC e FORA_DA_TABELA; null para SEM_LOOKUP. */
  pctDevido: number | null;
  comissaoDevida: number;
  /** Sinal v9: comissao_paga - comissao_devida (negativo = subpagamento). */
  diferenca: number;
  bloco: Bloco;
  trace: TraceFase2Cash;
}

/**
 * Auditoria de um contrato à vista.
 *
 * Pseudocódigo (5 ramos exclusivos):
 *
 *   if contrato.srccRestricao:
 *       → SRCC: pctDev=0, comDev=0, diferenca=comPg, bloco=EXCLUIDO_AUDITORIA
 *
 *   lookup = getMatrizTRPParaContrato(...)
 *   if lookup.pct == null:
 *       console.warn(contexto)                      ← blindagem (exigência Diego)
 *       if contrato.pctAplicado < EPS:
 *           → FORA_DA_TABELA: pctDev=0, comDev=0, diferenca=0, bloco=EXCLUIDO
 *       else:
 *           → SEM_LOOKUP:    pctDev=null, comDev=0, diferenca=0, bloco=EXCLUIDO
 *
 *   pctDev = min(lookup.pct, tetoBacen)
 *   comDev = valorLiquido * pctDev
 *   diferenca = comissaoPaga - comDev          ← sinal v9
 *
 *   if abs(diferenca) < EPS_VALOR:
 *       → OK:  bloco=EXCLUIDO_AUDITORIA
 *   elif diferenca < 0:                            ← subpagamento
 *       if regime VOLUME e pct_cheio + EPS < teto:
 *           → SUBPAGAMENTO_ABAIXO_TETO: bloco=PEDIDO_FIRME_2.1
 *           (uncapped genuíno — pct_cheio estritamente menor que teto)
 *       elif regime VOLUME (capped ou fronteira):
 *           → SUBPAGAMENTO: bloco=PEDIDO_FIRME_2.1, sem submotivo
 *       else:                                      ← regime META
 *           → SUBPAGAMENTO: bloco=PEDIDO_FIRME_2.1
 *           subpagamentoMotivo = ENQUADRAMENTO_ERRADO se status_fase1==DIVERGENTE_ENQUADRAMENTO
 *                              else PCT_INTERNO_ERRADO
 *   else:                                          ← superpagamento (diferenca > 0)
 *       → SUPERPAGAMENTO_FAVORAVEL: bloco=REGISTRO_INTERNO_BONUS_FAVORAVEL
 *       superpagamentoMotivo = ENQUADRAMENTO_FAVORAVEL se status_fase1==ENQUADRAMENTO_FAVORAVEL
 *                            else BONUS_PERFORMANCE
 */
export function auditAvistaContrato(
  contrato: ContratoAvista,
  mesContext: MesContextAvista
): ResultadoFase2Cash {
  // --- 1. SRCC: curto-circuito mirror v9 ---
  if (contrato.srccRestricao) {
    return {
      contractNumber: contrato.contractNumber,
      ym: contrato.mes,
      statusFase2: "SRCC",
      subpagamentoMotivo: null,
      superpagamentoMotivo: null,
      pctTabelaCalculado: null,
      pctDevido: 0,
      comissaoDevida: 0,
      diferenca: contrato.comissaoPaga,
      bloco: "EXCLUIDO_AUDITORIA",
      trace: {
        regime: mesContext.regime,
        catDevidaUsada: mesContext.catDevida,
        catAplicada: mesContext.catAplicada,
        statusFase1: mesContext.statusFase1,
        jsonRegra: mesContext.jsonRegra,
        regraInferida: mesContext.regraInferida,
        categoriaProduto: null,
        celula: null,
        tabLabelUsado: null,
        pctTabelaUncapped: null,
        tetoBacen: null,
        motivos: ["SRCC: pctDev=0, comDev=0, dif=comPg (mirror v9)"],
      },
    };
  }

  // --- 2. cat_devida para lookup ---
  // META → mesContext.catDevida (Camada 1).
  // VOLUME → Camada 1 retorna null (INDETERMINADO); usa cat_aplicada per-contract.
  const catParaLookup = mesContext.catDevida ?? contrato.catAplicada;

  // --- 3. Lookup matriz ---
  const lookup = getMatrizTRPParaContrato(
    {
      mes: contrato.mes,
      produto: contrato.produto,
      tipo: contrato.tipo,
      convenio: contrato.convenio,
      txJuros: contrato.txJuros,
      prazo: contrato.prazo,
    },
    mesContext.regime,
    catParaLookup
  );

  // --- 4. lookup falhou: distinguir FORA_DA_TABELA vs SEM_LOOKUP (mirror v9) ---
  if (lookup.pct == null) {
    // Blindagem (exigência Diego CHECKPOINT A): logar contexto suficiente
    // para investigação. SEM_LOOKUP silencioso pode mascarar bug do
    // categoriasCandidatasFor.
    console.warn(
      `[auditAvistaContrato] lookup_falhou contrato=${contrato.contractNumber}` +
        ` mes=${contrato.mes} produto='${contrato.produto}' tipo=${contrato.tipo}` +
        ` conv=${contrato.convenio} tx=${contrato.txJuros} prazo=${contrato.prazo}` +
        ` catDev=${catParaLookup} motivos=${lookup.motivos.join("|")}`
    );
    const isForaDaTabela = Math.abs(contrato.pctAplicado) < 1e-7;
    const status: StatusFase2 = isForaDaTabela ? "FORA_DA_TABELA" : "SEM_LOOKUP";
    return {
      contractNumber: contrato.contractNumber,
      ym: contrato.mes,
      statusFase2: status,
      subpagamentoMotivo: null,
      superpagamentoMotivo: null,
      pctTabelaCalculado: null,
      pctDevido: isForaDaTabela ? 0 : null,
      comissaoDevida: 0,
      diferenca: 0,
      bloco: "EXCLUIDO_AUDITORIA",
      trace: {
        regime: mesContext.regime,
        catDevidaUsada: catParaLookup,
        catAplicada: mesContext.catAplicada,
        statusFase1: mesContext.statusFase1,
        jsonRegra: lookup.jsonRegra,
        regraInferida: lookup.regraInferida,
        categoriaProduto: null,
        celula: null,
        tabLabelUsado: lookup.tabLabelUsado,
        pctTabelaUncapped: null,
        tetoBacen: null,
        motivos: lookup.motivos,
      },
    };
  }

  // --- 5. Aplicar teto BACEN ---
  const teto = tetoBacenForCategoria(catParaLookup);
  const pctDevido = teto != null ? Math.min(lookup.pct, teto) : lookup.pct;

  // --- 6. Calcular comissão devida e diferença (sinal v9) ---
  const comissaoDevida = contrato.valorLiquido * pctDevido;
  const diferenca = contrato.comissaoPaga - comissaoDevida;

  // --- 7. Classificar status, submotivo e bloco ---
  const isVolume =
    mesContext.regime === "VOLUME_6_PERFIS" ||
    mesContext.regime === "VOLUME_3_PERFIS" ||
    mesContext.regime === "VOLUME_5_FAIXAS";

  // Spec v9 §6 + lib/types/blocos.ts:52-53: SUBPAGAMENTO_ABAIXO_TETO ⇔
  // pct_cheio < teto (estritamente). Fronteira (pct_cheio == teto) e capped
  // (pct_cheio > teto) caem em SUBPAGAMENTO. Reusa EPS do regrasLoader.
  const isAbaixoTetoEstrito =
    teto != null && lookup.pct + EPS < teto;

  let statusFase2: StatusFase2;
  let subpagamentoMotivo: ResultadoFase2Cash["subpagamentoMotivo"] = null;
  let superpagamentoMotivo: ResultadoFase2Cash["superpagamentoMotivo"] = null;
  let bloco: Bloco;

  if (Math.abs(diferenca) < EPS_VALOR) {
    statusFase2 = "OK";
    bloco = "EXCLUIDO_AUDITORIA";
  } else if (diferenca < -EPS_VALOR) {
    // Subpagamento — Promotiva pagou menos que devido.
    if (isVolume && isAbaixoTetoEstrito) {
      statusFase2 = "SUBPAGAMENTO_ABAIXO_TETO";
    } else {
      statusFase2 = "SUBPAGAMENTO";
      if (!isVolume) {
        subpagamentoMotivo =
          mesContext.statusFase1 === "DIVERGENTE_ENQUADRAMENTO"
            ? "ENQUADRAMENTO_ERRADO"
            : "PCT_INTERNO_ERRADO";
      }
    }
    bloco = "PEDIDO_FIRME_2.1";

    // Padrão D (Fase 4.3 D.1): se contrato consta em audit_v9_padrao_d_exclusoes,
    // motor mantém status SUBPAGAMENTO mas força bloco=EXCLUIDO_AUDITORIA
    // (mirror v9 humana: bloco=null em Sol Reg 2.1). Mantém soma R$ 60.040,89
    // EXATA preservando defensabilidade do email enviado 07/05/2026.
    //
    // TODO Fase 4.4: investigar critério de exclusão v9 e decidir se motor
    // mantém mirror ou implementa lógica própria. Ver gap_analysis.md
    // "DESCOBERTA CRÍTICA — Inconsistência v9 com sua própria Camada 1".
    if (contrato.padraoDExclusao) {
      bloco = "EXCLUIDO_AUDITORIA";
    }
  } else {
    // Superpagamento — Promotiva pagou a mais.
    statusFase2 = "SUPERPAGAMENTO_FAVORAVEL";
    superpagamentoMotivo =
      mesContext.statusFase1 === "ENQUADRAMENTO_FAVORAVEL"
        ? "ENQUADRAMENTO_FAVORAVEL"
        : "BONUS_PERFORMANCE";
    bloco = "REGISTRO_INTERNO_BONUS_FAVORAVEL";
  }

  return {
    contractNumber: contrato.contractNumber,
    ym: contrato.mes,
    statusFase2,
    subpagamentoMotivo,
    superpagamentoMotivo,
    pctTabelaCalculado: lookup.pct,
    pctDevido,
    comissaoDevida,
    diferenca,
    bloco,
    trace: {
      regime: mesContext.regime,
      catDevidaUsada: catParaLookup,
      catAplicada: mesContext.catAplicada,
      statusFase1: mesContext.statusFase1,
      jsonRegra: lookup.jsonRegra,
      regraInferida: lookup.regraInferida,
      categoriaProduto: lookup.categoriaProduto,
      celula: lookup.celula,
      tabLabelUsado: lookup.tabLabelUsado,
      pctTabelaUncapped: lookup.pct,
      tetoBacen: teto,
      motivos: lookup.motivos,
    },
  };
}

/**
 * Mapeamento operacional: motor bloco abstrato → string esperada na coluna
 * audit_v9_avista.bloco. Usado pelo validador (diag_auditoria_avista.cjs)
 * para comparar a 4ª dimensão (bloco) byte a byte com v9.
 *
 *   PEDIDO_FIRME_2.1 + status SUBPAGAMENTO            → "2.1_AVISTA_SUBPAGAMENTO"
 *   PEDIDO_FIRME_2.1 + status SUBPAGAMENTO_ABAIXO_TETO → "2.1_AVISTA_SUBPAG_ABAIXO_TETO"
 *   REGISTRO_INTERNO_BONUS_FAVORAVEL                  → null  (vai p/ aba "Bônus Favorável", não p/ Sol Reg)
 *   EXCLUIDO_AUDITORIA                                → null
 */
export function blocoMotorParaV9String(
  bloco: Bloco,
  status: StatusFase2
): string | null {
  if (bloco === "PEDIDO_FIRME_2.1") {
    if (status === "SUBPAGAMENTO_ABAIXO_TETO") return "2.1_AVISTA_SUBPAG_ABAIXO_TETO";
    if (status === "SUBPAGAMENTO") return "2.1_AVISTA_SUBPAGAMENTO";
    return null;
  }
  return null;
}
