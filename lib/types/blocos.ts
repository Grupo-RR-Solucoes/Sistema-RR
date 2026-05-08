/**
 * Tipos canônicos para blocos de tratamento e status de auditoria v9.
 *
 * Fonte: stress_test_workspace_local/TRANSFERENCIA_CONHECIMENTO_SISTEMA.md
 *   §6 — Status de Camada 1 e Camada 2
 *   §1.3 — Estrutura de blocos de tratamento
 *   §9 — Tabela completa de regras (mês × OPP/TRP × regime)
 *
 * Validação reversa: stress_test_workspace_local/validacao_reversa_p2_p3.md
 * Decisões de implementação: stress_test_workspace_local/gap_analysis.md G1–G23
 *
 * Não importar nada deste arquivo — é apenas tipos. Implementações ficam em
 *   lib/regrasLoader.ts (Fase 4.1)
 *   lib/enquadramento.ts (Fase 4.2 — Camada 1)
 *   lib/camada2.ts (Fase 4.3 — Camada 2)
 */

// ---------------------------------------------------------------------------
// Camada 1 — Auditoria de enquadramento mensal (granularidade: mês × Grupo RR)
// ---------------------------------------------------------------------------

/**
 * 5 status definidos para a Camada 1.
 *
 * - OK: Cat_Aplicada == Cat_Devida.
 * - DIVERGENTE_ENQUADRAMENTO: Cat_Aplicada < Cat_Devida (Promotiva subenquadrou).
 *     Ex.: Jul/2024 e Set/2024 (META 2 + OPP099 com pen ≥30%, meta 90-99,99%).
 * - ENQUADRAMENTO_FAVORAVEL: Cat_Aplicada > Cat_Devida (Promotiva pagou a maior).
 *     Ex.: Set/2023 (meta 96,2% mas pen 13,4% — não dispara OPP099).
 * - INDETERMINADO: regimes VOLUME (critério não publicado).
 *     Camada 2 usa Cat_Aplicada como referência nesse caso.
 * - SEM_DADOS: mês sem Validador (anterior a Ago/2024 com aba ausente).
 */
export type StatusFase1 =
  | "OK"
  | "DIVERGENTE_ENQUADRAMENTO"
  | "ENQUADRAMENTO_FAVORAVEL"
  | "INDETERMINADO"
  | "SEM_DADOS";

// ---------------------------------------------------------------------------
// Camada 2 — Auditoria por contrato (À Vista + PRT)
// ---------------------------------------------------------------------------

/**
 * 13 status definidos para a Camada 2 (compatíveis com aba "Auditoria À Vista"
 * e "Auditoria PRT" do RELATORIO_AUDITORIA_FINAL_v9.xlsx).
 *
 * À Vista (9):
 * - OK: pct_pago bate com pct_devido (sob Cat_Devida).
 * - SUBPAGAMENTO: diferença > 0 a cobrar (Bloco 2.1).
 * - SUBPAGAMENTO_ABAIXO_TETO: regime VOLUME, pct_pago < pct_cheio quando
 *     pct_cheio < teto (G específico de VOLUME).
 * - SUPERPAGAMENTO_FAVORAVEL: pct_pago > pct_devido (Bônus Performance ou similar).
 * - PCT_NAO_DOCUMENTADO: pct_pago não bate com nenhum % oficial (ex.: 333
 *     contratos Set/2024 com 5,80% antes de Inter 2 ser publicada).
 * - SRCC: contratos com restrição SRCC (não remunerados).
 * - FORA_DA_TABELA: taxa fora dos ranges declarados no JSON do mês.
 * - SEM_LOOKUP: lookup não retorna nem mesmo "fora da tabela" (gap de matriz).
 * - OK_DEBITADO: contrato debitado posteriormente (justificado por LIQUIDAÇÃO/
 *     CANCELAMENTO/RENOVAÇÃO antecipada na aba Débitos).
 *
 * PRT (5):
 * - PRT_INTERROMPIDO_SUSPEITO: < 12m de PRT pago (heurística).
 * - PRT_INTERROMPIDO_PROVAVEL_LEGITIMO: ≥ 12m de PRT pago.
 * - PRT_AUSENTE_PROVAVEL_LEGITIMO: contrato sem PRT registrado e excedente > 0.
 * - PRT_LISTADO_NAO_PAGO: parcela em cod_est=2 ou 99 (Bloco 2.2 — pedido firme).
 * - PRT_NAO_LISTADO: excedente devido > 0 mas sem listagem nem débito (322
 *     contratos — ESCLARECIMENTO_PRT_SEM_REGISTRO).
 *     NOTA (decisão Fase 4.1): PRT_NAO_LISTADO é status implementacional para
 *     os 322 contratos detectados via auditoria reversa em v9 §5.6/§10.3
 *     (R$ 43.427,47). A v9 §6 está incompleta sobre esse caso — fala em "13
 *     status" mas omite PRT_NAO_LISTADO. Sem esse status, esses 322 contratos
 *     do bloco ESCLARECIMENTO_PRT_SEM_REGISTRO não teriam classificação
 *     coerente. Mantemos 14 status no total (9 cash + 5 prt).
 */
export type StatusFase2 =
  // À Vista
  | "OK"
  | "SUBPAGAMENTO"
  | "SUBPAGAMENTO_ABAIXO_TETO"
  | "SUPERPAGAMENTO_FAVORAVEL"
  | "PCT_NAO_DOCUMENTADO"
  | "SRCC"
  | "FORA_DA_TABELA"
  | "SEM_LOOKUP"
  | "OK_DEBITADO"
  // PRT
  | "PRT_INTERROMPIDO_SUSPEITO"
  | "PRT_INTERROMPIDO_PROVAVEL_LEGITIMO"
  | "PRT_AUSENTE_PROVAVEL_LEGITIMO"
  | "PRT_LISTADO_NAO_PAGO"
  | "PRT_NAO_LISTADO";

// ---------------------------------------------------------------------------
// Blocos de tratamento — decisão operacional final (cobrança vs registro)
// ---------------------------------------------------------------------------

/**
 * 7 blocos definidos para classificação operacional dos contratos auditados.
 *
 * Pedido Firme (R$ 107.622,76 / 5.003 contratos consolidado v9):
 * - PEDIDO_FIRME_2.1: À Vista subpagamento sob Cat_Devida (R$ 60.040,89 / 2.501).
 * - PEDIDO_FIRME_2.2: PRT formalmente listado e não pago — cod_est=2/99 (R$ 47.581,88 / 2.502).
 *
 * Solicitação de Esclarecimentos (não cobra direto, vira pergunta na carta):
 * - ESCLARECIMENTO_PRT_CESSADOS: PRT_INTERROMPIDO < 12m e ≥ 12m (~R$ 184k / ~2.523).
 * - ESCLARECIMENTO_PRT_SEM_REGISTRO: 322 contratos com excedente > 0 sem listagem.
 * - ESCLARECIMENTO_PCT_NAO_DOCUMENTADO: 333 contratos Set/2024.
 *
 * Registro Interno (não cobra, apenas documenta):
 * - REGISTRO_INTERNO_BONUS_FAVORAVEL: SUPERPAGAMENTO_FAVORAVEL (R$ 67.596,34 / 1.817).
 *
 * Excluído da auditoria:
 * - EXCLUIDO_AUDITORIA: SRCC e similares (não remunerados).
 */
export type Bloco =
  | "PEDIDO_FIRME_2.1"
  | "PEDIDO_FIRME_2.2"
  | "ESCLARECIMENTO_PRT_CESSADOS"
  | "ESCLARECIMENTO_PRT_SEM_REGISTRO"
  | "ESCLARECIMENTO_PCT_NAO_DOCUMENTADO"
  | "REGISTRO_INTERNO_BONUS_FAVORAVEL"
  | "EXCLUIDO_AUDITORIA";

// ---------------------------------------------------------------------------
// Regimes — mapeamento mês → regime de cálculo
// ---------------------------------------------------------------------------

/**
 * 6 regimes vigentes Dez/2022 — Abr/2026.
 *
 * - META_2_NIVEIS_MATRIZ_TAXA_PRAZO: OPP060 (Dez/2022 a Mai/2023). 2 tabelas
 *     (Tab1, Tab2) com matriz taxa × prazo.
 * - META_2_NIVEIS: OPP061+ até TRP14 (Jun/2023 a Dez/2024). 2 tabelas, matriz
 *     por taxa apenas. OPP099 promocional vigente Set/2023 a Jun/2025.
 * - META_4_NIVEIS: TRP15+ (Jan a Jun/2025). 4 tabelas (Tab1, Inter1, Inter2, Tab2).
 *     OPP099 também vigente conforme spec v9 §4.1 (validação reversa em
 *     stress_test_workspace_local/validacao_reversa_p2_p3.md confirma).
 * - VOLUME_6_PERFIS: TRP24-TRP31 (Jul a Dez/2025). 6 categorias (Varejo I/II,
 *     Middle, Upper Middle, Corporate, Large Corporate). Camada 1 = INDETERMINADO.
 * - VOLUME_3_PERFIS: TRP32-TRP34 (Jan a Mar/2026). Rubi/Safira/Diamante.
 * - VOLUME_5_FAIXAS: TRP35 (Abr/2026 em diante). Faixa 1-5. Confirmado em
 *     stress_test_workspace_local/confirmacao_documental.md P1 que toda a
 *     matriz de pcts varia por Faixa, não só o teto à vista.
 */
export type Regime =
  | "META_2_NIVEIS_MATRIZ_TAXA_PRAZO"
  | "META_2_NIVEIS"
  | "META_4_NIVEIS"
  | "VOLUME_6_PERFIS"
  | "VOLUME_3_PERFIS"
  | "VOLUME_5_FAIXAS";

// ---------------------------------------------------------------------------
// Lookup de matriz — retorno do regrasLoader.lookupPct
// ---------------------------------------------------------------------------

/**
 * Resultado de um lookup de pct na matriz de uma regra mensal.
 *
 * Implementa G22 (rastreabilidade documental por contrato): cada lookup deve
 * gravar o caminho completo (regra → categoria de produto → célula que
 * matchou) para defesa diante da Promotiva.
 *
 * - pct: valor decimal (ex.: 0.054 = 5,40%). null = lookup falhou.
 * - celula: descrição da célula que matchou (ex.: "INSS taxa_min:1.65,
 *     taxa_max:1.69, prazo_min:36, prazo_max:48 → Tabela 2: 6.00%").
 *     Persistido em audit_v9_*.trace.camada2.celulaUsada.
 * - jsonRegra: nome do arquivo JSON usado (ex.: "TRP11_2024-09.json").
 *     Persistido em audit_v9_*.trace.camada2.jsonRegra.
 * - regraInferida: true se o mês usou fallback (sem JSON nativo). Ver
 *     spec §4.3 — Mai/2024 usa TRP05_2024-04b, Set-Out/2023 usa TRP01, etc.
 */
export interface LookupPctResult {
  pct: number | null;
  celula: string | null;
  jsonRegra: string | null;
  regraInferida: boolean;
}
