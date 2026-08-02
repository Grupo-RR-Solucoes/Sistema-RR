/**
 * Testes de lib/auditoriaAvista.ts — Fase 4.3 Camada 2 À Vista.
 *
 * ===========================================================================
 * LIMITAÇÕES CONHECIDAS — 4 bugs documentados para Fase 4.3.B
 * ===========================================================================
 * Fase 4.3 fechada com escopo "Camada 2 fundação" — validada em 21.337/23.879
 * contratos (89,4%). 1.888 contratos divergem por 4 bugs descobertos no batch
 * full e documentados em stress_test_workspace_local/gap_analysis.md
 * (§"DÍVIDAS TÉCNICAS — Fase 4.3.B"):
 *
 * - BUG_2A: produto 'CONSIGNADO' genérico jul/ago 2023 com convênios
 *           92059/1701/137478 mal mapeados (~150 contratos, ~R$ 14k).
 * - BUG_2C: FORA_DA_TABELA + SRCC com diferença inconsistente (~200 contratos,
 *           sub-padrão 3 pode ser leitura errada de dados).
 * - BUG_2D: regra SUBPAGAMENTO_ABAIXO_TETO mal escopada — RESOLVIDO Fase 4.3.B
 *           Etapa 2 (09/05/2026). Motor agora aplica regra estrita: ABAIXO_TETO
 *           ⇔ pct_cheio + EPS < teto. Capped e fronteira caem em SUBPAGAMENTO.
 *           Testes #7a/#7b/#7c/#7d cobrem os 3 ramos + META.
 * - BUG_2E: CRÉDITO ADIANTAMENTO conv=137478 roteado para ADIANTAMENTO_13
 *           quando v9 usou outra matriz (~150 contratos, ~R$ 8k).
 *
 * Os testes abaixo cobrem o caminho FELIZ (motor reproduz v9). Os 4 bugs ainda
 * NÃO TÊM testes de regressão — devem ser adicionados na Fase 4.3.B junto
 * com a correção, garantindo que a regra dura não regrida no futuro.
 * ===========================================================================
 *
 * Como rodar:
 *   - Sem framework configurado; usar `node --test --import tsx lib/__tests__/auditoriaAvista.test.ts`
 *   - CHECKPOINT C executável: `node scripts/diag_auditoria_avista.cjs --escopo-reduzido`
 *
 * Cobertura (testes puros, sem Supabase):
 * 1. SRCC: dif=comissao_paga, status=SRCC, bloco=EXCLUIDO_AUDITORIA.
 * 2. OK: pct_aplicado bate com pct_devido_motor, dif=0, status=OK.
 * 3. SUBPAGAMENTO + ENQUADRAMENTO_ERRADO: motor catDev=TABELA 2 sob status_fase1=DIVERGENTE_ENQUADRAMENTO.
 * 4. SUBPAGAMENTO + PCT_INTERNO_ERRADO: motor catDev=TABELA 2 sob status_fase1=OK (cat aplicada errada localmente).
 * 5. SUPERPAGAMENTO_FAVORAVEL + BONUS_PERFORMANCE: cat correta, pct pago > pct devido.
 * 6. SUPERPAGAMENTO_FAVORAVEL + ENQUADRAMENTO_FAVORAVEL: status_fase1=ENQUADRAMENTO_FAVORAVEL.
 * 7a. SUBPAGAMENTO_ABAIXO_TETO: regime VOLUME, uncapped genuíno (pct_cheio + EPS < teto).
 * 7b. SUBPAGAMENTO em VOLUME: pct_cheio capped (pct_cheio > teto + EPS).
 * 7c. SUBPAGAMENTO em VOLUME: fronteira (pct_cheio == teto, dentro de EPS).
 * 7d. SUBPAGAMENTO em META: comportamento legado preservado.
 * 8. FORA_DA_TABELA: lookup falha + pct_aplicado=0 → dif=0, status=FORA_DA_TABELA.
 * 9. SEM_LOOKUP: lookup falha + pct_aplicado>0 → dif=0, status=SEM_LOOKUP, pct_devido=null.
 * 10. Convenção de sinal: dif = comPg - comDev (negativo=subpagamento).
 * 11. PADRÃO D: contrato em audit_v9_padrao_d_exclusoes → bloco=EXCLUIDO_AUDITORIA.
 * 12. blocoMotorParaV9String mapeamento.
 *
 * Integração contra Supabase (audit_v9_avista) — vide CJS executável.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  auditAvistaContrato,
  blocoMotorParaV9String,
  EPS_VALOR,
  type ContratoAvista,
  type MesContextAvista,
} from "../auditoriaAvista.ts";

/** Helper: monta contrato base com defaults. */
function mkContrato(overrides: Partial<ContratoAvista>): ContratoAvista {
  return {
    contractNumber: "TEST-001",
    empresa: "RR SOLUCOES LTDA",
    mes: "2024-09",
    produto: "CONSIGNADO INSS",
    tipo: "NOVO",
    convenio: 1640,
    txJuros: 1.8, // unidade percentual
    prazo: 60,
    catAplicada: "TABELA 1",
    valorLiquido: 10_000,
    pctAplicado: 0.054,
    comissaoPaga: 540,
    srccRestricao: false,
    padraoDExclusao: false,
    padraoDMotivo: null,
    ...overrides,
  };
}

/** Helper: monta mesContext base. */
function mkContext(overrides: Partial<MesContextAvista>): MesContextAvista {
  return {
    ym: "2024-09",
    regime: "META_2_NIVEIS",
    catDevida: "TABELA 1",
    catAplicada: "TABELA 1",
    statusFase1: "OK",
    jsonRegra: "TRP11_2024-09.json",
    regraInferida: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------- 1. SRCC --
test("SRCC: dif = comissao_paga (NÃO 0), bloco=EXCLUIDO_AUDITORIA, mirror v9", () => {
  const c = mkContrato({ srccRestricao: true, comissaoPaga: 96 });
  const m = mkContext({});
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SRCC");
  assert.equal(r.pctDevido, 0);
  assert.equal(r.comissaoDevida, 0);
  assert.equal(r.diferenca, 96);
  assert.equal(r.bloco, "EXCLUIDO_AUDITORIA");
  assert.equal(r.subpagamentoMotivo, null);
});

// -------------------------------------------------------------------- 2. OK
test("OK: motor pct_devido bate com pct_aplicado → dif=0, bloco=EXCLUIDO", () => {
  // 2024-09 NÃO CONSIGNADO tx 4.61% prazo 24 → matriz Tab2: 0.0805 → teto 6%
  // Promotiva pagou 6% → dif=0
  const c = mkContrato({
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 4.61,
    prazo: 24,
    catAplicada: "TABELA 2",
    valorLiquido: 10_000,
    pctAplicado: 0.06,
    comissaoPaga: 600,
  });
  const m = mkContext({ catDevida: "TABELA 2", catAplicada: "TABELA 2" });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "OK");
  assert.equal(r.bloco, "EXCLUIDO_AUDITORIA");
  assert.ok(Math.abs(r.diferenca) < EPS_VALOR);
});

// ---------------------------------- 3. SUBPAGAMENTO + ENQUADRAMENTO_ERRADO --
test("SUBPAGAMENTO + ENQUADRAMENTO_ERRADO: status_fase1=DIVERGENTE_ENQUADRAMENTO (Jul/Set 2024 OPP099)", () => {
  // Promotiva pagou Tab1 (5,40%) mas devido era Tab2 (6,00%) por OPP099.
  const c = mkContrato({
    mes: "2024-07",
    produto: "CONSIGNADO MPDG",
    convenio: 1078,
    txJuros: 1.8,
    prazo: 96,
    catAplicada: "TABELA 1",
    valorLiquido: 10_000,
    pctAplicado: 0.054,
    comissaoPaga: 540,
  });
  const m = mkContext({
    ym: "2024-07",
    regime: "META_2_NIVEIS",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 1",
    statusFase1: "DIVERGENTE_ENQUADRAMENTO",
    jsonRegra: "TRP09_2024-07.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.equal(r.subpagamentoMotivo, "ENQUADRAMENTO_ERRADO");
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
  assert.equal(r.pctDevido, 0.06);
  assert.ok(r.diferenca < -EPS_VALOR, `dif esperado < 0, got ${r.diferenca}`);
});

// ---------------------------------- 4. SUBPAGAMENTO + PCT_INTERNO_ERRADO ---
test("SUBPAGAMENTO + PCT_INTERNO_ERRADO: cat correta, pct pago < pct devido localmente", () => {
  // Mês OK (não DIVERGENTE_ENQUADRAMENTO); cat aplicada == cat devida; mas
  // Promotiva pagou pct abaixo do esperado para a célula → SUBPAGAMENTO INTERNO.
  const c = mkContrato({
    mes: "2024-03",
    produto: "CRÉDITO ADIANTAMENTO",
    convenio: 663,
    txJuros: 1.19,
    prazo: 9,
    catAplicada: "TABELA 2",
    valorLiquido: 3_726.82,
    pctAplicado: 0,
    comissaoPaga: 0,
  });
  const m = mkContext({
    ym: "2024-03",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 2",
    statusFase1: "OK",
    jsonRegra: "TRP03_2024-03.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.equal(r.subpagamentoMotivo, "PCT_INTERNO_ERRADO");
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
});

// -------------------- 5. SUPERPAGAMENTO_FAVORAVEL + BONUS_PERFORMANCE ------
test("SUPERPAGAMENTO_FAVORAVEL + BONUS_PERFORMANCE: cat correta, pct pago > pct devido", () => {
  // 2023-01 Consignado tx 1.88% prazo 48 → matriz Tab2: 0.0523 (pre-teto)
  const c = mkContrato({
    mes: "2023-01",
    produto: "CONSIGNADO",
    convenio: 77009,
    txJuros: 1.88,
    prazo: 48,
    catAplicada: "TABELA 2",
    valorLiquido: 7_000,
    pctAplicado: 0.0549,
    comissaoPaga: 384.405,
  });
  const m = mkContext({
    ym: "2023-01",
    regime: "META_2_NIVEIS_MATRIZ_TAXA_PRAZO",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 2",
    statusFase1: "OK",
    jsonRegra: "OPP060_2023-01.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUPERPAGAMENTO_FAVORAVEL");
  assert.equal(r.superpagamentoMotivo, "BONUS_PERFORMANCE");
  assert.equal(r.bloco, "REGISTRO_INTERNO_BONUS_FAVORAVEL");
  assert.ok(r.diferenca > EPS_VALOR);
});

// --------- 6. SUPERPAGAMENTO_FAVORAVEL + ENQUADRAMENTO_FAVORAVEL -----------
test("SUPERPAGAMENTO_FAVORAVEL + ENQUADRAMENTO_FAVORAVEL: mes Set/2023 (motor TS supera v9)", () => {
  // Set/2023: motor catDevida=TABELA 2 (OPP099 dispara per-contract pen).
  // Mas neste teste sintético: catAplicada=TABELA 2 (Promotiva), catDevida=TABELA 1 (motor diferente).
  // Em v9 Set/2023 SUPER_FAV: pctApl=0.06 (Tab2) pctDev=0.054 (Tab1) → dif > 0
  const c = mkContrato({
    mes: "2023-09",
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 4.5,
    prazo: 60,
    catAplicada: "TABELA 2",
    valorLiquido: 1_000,
    pctAplicado: 0.06,
    comissaoPaga: 60,
  });
  const m = mkContext({
    ym: "2023-09",
    regime: "META_2_NIVEIS",
    catDevida: "TABELA 1",        // mesContext finge cenário ENQUADRAMENTO_FAVORAVEL
    catAplicada: "TABELA 2",
    statusFase1: "ENQUADRAMENTO_FAVORAVEL",
    jsonRegra: "TRP01_2024-01.json",
    regraInferida: true,
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUPERPAGAMENTO_FAVORAVEL");
  assert.equal(r.superpagamentoMotivo, "ENQUADRAMENTO_FAVORAVEL");
  assert.equal(r.bloco, "REGISTRO_INTERNO_BONUS_FAVORAVEL");
});

// ------------------------- 7a. SUBPAGAMENTO_ABAIXO_TETO (VOLUME, uncapped) -
test("7a. SUBPAGAMENTO_ABAIXO_TETO: VOLUME uncapped genuíno (pct_cheio < teto)", () => {
  // Jul/2025 VOLUME 6, MIDDLE, CONSIG_PRIVADO tx 3.99 prazo 36 → matriz=0.04
  // (estritamente < teto 6%) → ABAIXO_TETO genuíno.
  const c = mkContrato({
    mes: "2025-07",
    produto: "CONSIGNADO PRIVADO",
    convenio: 859142,
    txJuros: 3.99,
    prazo: 36,
    catAplicada: "MIDDLE",
    valorLiquido: 5_000,
    pctAplicado: 0,
    comissaoPaga: 0,
  });
  const m = mkContext({
    ym: "2025-07",
    regime: "VOLUME_6_PERFIS",
    catDevida: null,                  // Camada 1 → INDETERMINADO em VOLUME
    catAplicada: "MIDDLE",
    statusFase1: "INDETERMINADO",
    jsonRegra: "TRP24_2025-07.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO_ABAIXO_TETO");
  assert.equal(r.subpagamentoMotivo, null);  // ABAIXO_TETO não tem submotivo
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
  assert.ok(r.diferenca < -EPS_VALOR);
  // pct_cheio (uncapped) deve estar abaixo do teto
  assert.ok(r.pctTabelaCalculado != null && r.pctTabelaCalculado < 0.06);
});

// ----------------------------------- 7b. SUBPAGAMENTO em VOLUME (capped) --
test("7b. SUBPAGAMENTO: VOLUME capped (pct_cheio > teto, motor capou)", () => {
  // Jul/2025 VOLUME 6, MIDDLE, NÃO_CONSIGNADO tx 5.9 prazo 60 → matriz=0.0855
  // (acima do teto 6%) → motor capa, pctDev=0.06, label=SUBPAGAMENTO.
  const c = mkContrato({
    mes: "2025-07",
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 5.9,
    prazo: 60,
    catAplicada: "MIDDLE",
    valorLiquido: 4_441.49,
    pctAplicado: 0.058,
    comissaoPaga: 257.61,  // 0.058 × 4441.49 ~= 257.61 (subpagamento vs 6% = 266.49)
  });
  const m = mkContext({
    ym: "2025-07",
    regime: "VOLUME_6_PERFIS",
    catDevida: null,
    catAplicada: "MIDDLE",
    statusFase1: "INDETERMINADO",
    jsonRegra: "TRP24_2025-07.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.equal(r.subpagamentoMotivo, null);  // VOLUME não emite submotivo
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
  assert.ok(r.diferenca < -EPS_VALOR);
  // pct_cheio acima do teto, pct_devido capado em 0.06
  assert.ok(r.pctTabelaCalculado != null && r.pctTabelaCalculado > 0.06);
  assert.equal(r.pctDevido, 0.06);
});

// ---------------------------------- 7c. SUBPAGAMENTO em VOLUME (fronteira) -
test("7c. SUBPAGAMENTO: VOLUME pct_cheio == teto (fronteira)", () => {
  // Ago/2025 VOLUME 6, MIDDLE, CONSIG_PUBLICO tx 2.19 prazo 72 → matriz=0.06
  // (exatamente igual ao teto). Sob regra estrita: SUBPAGAMENTO (não ABAIXO).
  const c = mkContrato({
    mes: "2025-08",
    produto: "CONSIGNADO PUBLICO",
    convenio: 92059,
    txJuros: 2.19,
    prazo: 72,
    catAplicada: "MIDDLE",
    valorLiquido: 12_700,
    pctAplicado: 0.057,
    comissaoPaga: 723.90,  // 0.057 × 12700 = 723.90 (subpagamento vs 6% = 762)
  });
  const m = mkContext({
    ym: "2025-08",
    regime: "VOLUME_6_PERFIS",
    catDevida: null,
    catAplicada: "MIDDLE",
    statusFase1: "INDETERMINADO",
    jsonRegra: "TRP25_2025-08.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.equal(r.subpagamentoMotivo, null);
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
  assert.ok(r.diferenca < -EPS_VALOR);
  // pct_cheio exatamente == teto (fronteira)
  assert.ok(r.pctTabelaCalculado != null && Math.abs(r.pctTabelaCalculado - 0.06) < 1e-7);
});

// ------------------------------- 7d. SUBPAGAMENTO em META (sem mudança) ---
test("7d. SUBPAGAMENTO em META: comportamento legado preservado (com submotivo)", () => {
  // Set/2024 META 2, Tab 2 (catDev), Promotiva subpagou. Em META o motor
  // emite SUBPAGAMENTO sempre, com submotivo PCT_INTERNO_ERRADO ou
  // ENQUADRAMENTO_ERRADO. Não muda com o fix do bug 2D.
  const c = mkContrato({
    mes: "2024-09",
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 4.61,
    prazo: 24,
    catAplicada: "TABELA 2",
    valorLiquido: 10_000,
    pctAplicado: 0.05,        // pagou 5%, deveria ter pago teto 6% (NAO_CONSIG Tab2 capped)
    comissaoPaga: 500,
  });
  const m = mkContext({
    ym: "2024-09",
    regime: "META_2_NIVEIS",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 2",
    statusFase1: "OK",
    jsonRegra: "TRP11_2024-09.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.equal(r.subpagamentoMotivo, "PCT_INTERNO_ERRADO");
  assert.equal(r.bloco, "PEDIDO_FIRME_2.1");
  assert.ok(r.diferenca < -EPS_VALOR);
});

// ------------------------------------------------- 8. FORA_DA_TABELA -------
test("FORA_DA_TABELA: lookup falha + pct_aplicado=0 → dif=0, status=FORA_DA_TABELA", () => {
  // tx 1.78% prazo 12 → fora de range em todas categorias (NAO_CONSIGNADO precisa prazo>=13)
  const c = mkContrato({
    mes: "2022-12",
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 1.78,
    prazo: 12,
    catAplicada: "TABELA 2",
    valorLiquido: 500,
    pctAplicado: 0,
    comissaoPaga: 0,
  });
  const m = mkContext({
    ym: "2022-12",
    regime: "META_2_NIVEIS_MATRIZ_TAXA_PRAZO",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 2",
    statusFase1: "OK",
    jsonRegra: "OPP060_2022-12.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "FORA_DA_TABELA");
  assert.equal(r.diferenca, 0);
  assert.equal(r.pctDevido, 0);
  assert.equal(r.bloco, "EXCLUIDO_AUDITORIA");
});

// ---------------------------------------------------- 9. SEM_LOOKUP --------
test("SEM_LOOKUP: lookup falha + pct_aplicado>0 → dif=0, pctDev=null", () => {
  // Set/2023 INSS prazo 84+ — lookup retorna pct mas se forçar produto inválido, lookup null
  const c = mkContrato({
    mes: "2024-07",
    produto: "PRODUTO_INEXISTENTE",
    convenio: 9999,
    txJuros: 1.8,
    prazo: 60,
    catAplicada: "TABELA 1",
    valorLiquido: 1_000,
    pctAplicado: 0.054,
    comissaoPaga: 54,
  });
  const m = mkContext({
    ym: "2024-07",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 1",
    statusFase1: "DIVERGENTE_ENQUADRAMENTO",
    jsonRegra: "TRP09_2024-07.json",
  });
  const r = auditAvistaContrato(c, m);
  assert.equal(r.statusFase2, "SEM_LOOKUP");
  assert.equal(r.diferenca, 0);
  assert.equal(r.pctDevido, null);
  assert.equal(r.bloco, "EXCLUIDO_AUDITORIA");
});

// ---------------------------------------- 10. Convenção de sinal -----------
test("Convenção de sinal: dif = comPg - comDev (negativo=subpagamento)", () => {
  // comPg=540 (5,40%), comDev=600 (6,00%) → dif = 540 - 600 = -60
  const c = mkContrato({
    mes: "2024-07",
    produto: "CONSIGNADO MPDG",
    convenio: 1078,
    txJuros: 1.8,
    prazo: 96,
    catAplicada: "TABELA 1",
    valorLiquido: 10_000,
    pctAplicado: 0.054,
    comissaoPaga: 540,
  });
  const m = mkContext({
    ym: "2024-07",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 1",
    statusFase1: "DIVERGENTE_ENQUADRAMENTO",
    jsonRegra: "TRP09_2024-07.json",
  });
  const r = auditAvistaContrato(c, m);
  // comDev = 10000 * 0.06 = 600
  assert.ok(Math.abs(r.comissaoDevida - 600) < 0.001);
  // dif = 540 - 600 = -60
  assert.ok(Math.abs(r.diferenca + 60) < 0.001, `dif esperado ~-60, got ${r.diferenca}`);
});

// ---------------------------------------- 11. PADRAO D ---------------------
test("PADRÃO D: subpagamento mas padraoDExclusao=true → bloco=EXCLUIDO_AUDITORIA (mirror v9)", () => {
  // Espelha contrato 162288082 do CHECKPOINT B: NÃO CONSIGNADO 2024-07
  // pctApl=Tab1 (0.054), catDevida motor=Tab2 (OPP099), pctDev=0.06 → dif<0.
  // V9 humana excluiu de Sol Reg 2.1 (bloco=null) — motor mirror.
  const c = mkContrato({
    mes: "2024-07",
    produto: "NÃO CONSIGNADO",
    convenio: 0,
    txJuros: 5.45,
    prazo: 48,
    catAplicada: "TABELA 1",
    valorLiquido: 6_564.22,
    pctAplicado: 0.054,
    comissaoPaga: 354.47,
    padraoDExclusao: true,
    padraoDMotivo: "INCONSISTENCIA_CAMADA1_V9",
  });
  const m = mkContext({
    ym: "2024-07",
    catDevida: "TABELA 2",
    catAplicada: "TABELA 1",
    statusFase1: "DIVERGENTE_ENQUADRAMENTO",
    jsonRegra: "TRP09_2024-07.json",
  });
  const r = auditAvistaContrato(c, m);
  // Status numérico mantém SUBPAGAMENTO (mirror v9 — dif<0)
  assert.equal(r.statusFase2, "SUBPAGAMENTO");
  assert.ok(r.diferenca < -EPS_VALOR);
  // Bloco força EXCLUIDO_AUDITORIA (mirror v9 — bloco=null em Sol Reg 2.1)
  assert.equal(r.bloco, "EXCLUIDO_AUDITORIA");
});

// ---------------------------------------- 12. blocoMotorParaV9String ------
test("blocoMotorParaV9String: SUBPAGAMENTO + 2.1 → '2.1_AVISTA_SUBPAGAMENTO'", () => {
  assert.equal(blocoMotorParaV9String("PEDIDO_FIRME_2.1", "SUBPAGAMENTO"), "2.1_AVISTA_SUBPAGAMENTO");
  assert.equal(
    blocoMotorParaV9String("PEDIDO_FIRME_2.1", "SUBPAGAMENTO_ABAIXO_TETO"),
    "2.1_AVISTA_SUBPAG_ABAIXO_TETO"
  );
  assert.equal(blocoMotorParaV9String("REGISTRO_INTERNO_BONUS_FAVORAVEL", "SUPERPAGAMENTO_FAVORAVEL"), null);
  assert.equal(blocoMotorParaV9String("EXCLUIDO_AUDITORIA", "OK"), null);
  assert.equal(blocoMotorParaV9String("EXCLUIDO_AUDITORIA", "SRCC"), null);
});
