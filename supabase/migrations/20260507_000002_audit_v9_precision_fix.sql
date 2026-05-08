-- Fase 4.1 — ajuste de precisão para preservar sub-centavos em colunas de cálculo.
--
-- Origem: investigação Δ R$ 0,02 no Bloco 2.1 durante --dry-run do seed.
--   - Soma raw (Number nativo do XLSX) = 60040.886367 → toFixed(2) = "60040.89" ✓
--   - Soma após round2 por linha       = 60040.870000 → diverge R$ 0,016 do esperado
--
-- Causa: valores individuais têm 4-6 decimais (ex.: 26.63207999999993,
-- 136.4289) produzidos por fórmulas Excel `valor_liquido * (pct_devido -
-- pct_pago)`. numeric(14,2) descarta sub-centavos linha-a-linha; somatório
-- agregado acumula erro em ~R$ 0,02.
--
-- Solução híbrida (Decisão Diego, Fase 4.1 Etapa 6 pré-execute):
--   - Colunas de CÁLCULO (sub-centavos relevantes para SUM exato): numeric(14,6)
--   - Colunas de VALOR JÁ ARREDONDADO da Promotiva: mantêm numeric(14,2)
--
-- Apresentação ao usuário (Fases 4.6 e 4.7) aplica ROUND(x, 2) ou toFixed(2)
-- no SELECT/UI. Banco mantém precisão para auditoria.
--
-- IMPORTANTE: tabelas estão VAZIAS no momento desta migration (seed da
-- Etapa 6 ainda não rodou). ALTER TABLE em tabela vazia é instantâneo.

-- =========================================================================
-- audit_v9_avista — colunas de cálculo viram numeric(14,6)
-- =========================================================================
alter table audit_v9_avista
  alter column comissao_paga type numeric(14,6),
  alter column comissao_devida type numeric(14,6),
  alter column diferenca type numeric(14,6),
  alter column valor_solicitacao_regularizacao type numeric(14,6);

-- valor_liquido permanece numeric(14,2) — vem do contrato Promotiva já arredondado.

-- =========================================================================
-- audit_v9_prt — só valor_solicitacao_regularizacao precisa de precisão extra
-- =========================================================================
-- Colunas mantidas em numeric(14,2): base_prt, prt_pago, prt_listado_nao_pago,
-- excedente_devido. Decisão: spec v9 §10.2 mostra que valores PRT já chegam
-- arredondados (Σ Bloco 2.2 = R$ 47.581,88 EXATO sem precisão extra).
alter table audit_v9_prt
  alter column valor_solicitacao_regularizacao type numeric(14,6);
