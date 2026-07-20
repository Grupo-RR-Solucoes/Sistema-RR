-- ============================================================================
-- 2026-07-20_corrige_seguro_ads_julho.sql
--
-- LIMPA O LIXO PERSISTIDO: daily_production_records.insurance_commission_amount
-- da ADS, competencia 2026-07, esta com valores da regua do RR
-- (insurance_slip_rules) gravados por app/api/calculate/monthly ANTES da trava
-- semAds. O commission_rule_source entrega: TRP35_ESTOQUE_D0, TRP35_SLIP e
-- SEM_REGRA_TRP (=> 0) nos "SLIP NOVO", modalidade que nao existe na tabela do RR.
--
-- Recalcula pela regua BBTS (bbts_rule_versions, competencia 2026-07):
--   ESTOQUE -> 0,10%
--   SLIP    -> por prazo: 0-36 0,10% | 37-60 0,15% | 61-84 0,25% | 85+ 0,35%
-- sobre insurance_value.
--
-- SEMANTICA DA COLUNA (nao inventar): guarda a comissao TOTAL DA EMPRESA por
-- proposta, SEM o share do promotor -- exatamente como app/api/calculate/monthly
-- ja fazia para o RR (ver route.ts:1276-1279). O repasse ao promotor
-- (empresa x faixa SEGURO_SLIP) e aplicado no render, NAO nesta coluna.
--
-- IDEMPOTENTE: o UPDATE so toca linhas cujo valor ja nao seja o correto
-- (clausula IS DISTINCT FROM no final). Rodar duas vezes => 0 linhas na segunda.
--
-- ESCOPO: empresa ADS + competencia 2026-07 apenas. A janela de competencia vai
-- do ULTIMO DIA UTIL de junho (2026-06-30, terca) ate o ULTIMO DIA UTIL de julho
-- EXCLUSIVE (2026-07-31, sexta) -- a mesma regra de lib/productionPeriod.ts
-- (getProductionWindow), e a mesma prioridade de data
-- (movement_date -> contract_date -> proposal_date).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. CONFERIR ANTES (rode sozinho primeiro; nao altera nada)
-- ---------------------------------------------------------------------------
-- SELECT proposal_number, insurance_value, insurance_type, term_months,
--        insurance_commission_amount, insurance_commission_percent,
--        commission_rule_source
--   FROM daily_production_records
--  WHERE company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--    AND COALESCE(movement_date, contract_date, proposal_date) >= DATE '2026-06-30'
--    AND COALESCE(movement_date, contract_date, proposal_date) <  DATE '2026-07-31'
--    AND COALESCE(insurance_value, 0) > 0
--  ORDER BY insurance_value DESC;

-- ---------------------------------------------------------------------------
-- 2. O UPDATE
-- ---------------------------------------------------------------------------
WITH alvo AS (
  SELECT
    r.id,
    r.insurance_value,
    -- Modalidade: SLIP quando o tipo contem "SLIP" (sem acento/caixa), igual ao
    -- ehSlip() de lib/bbts/seguroBbts.ts. Prioriza o tipo do raw_payload
    -- (__bbts_meta.seguro_tipo), que e o que o consolidador le.
    CASE
      WHEN UPPER(COALESCE(r.raw_payload -> '__bbts_meta' ->> 'seguro_tipo',
                          r.insurance_type, '')) LIKE '%SLIP%'
      THEN 'SLIP' ELSE 'ESTOQUE'
    END AS modalidade,
    r.term_months
  FROM daily_production_records r
  WHERE r.company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
    AND COALESCE(r.movement_date, r.contract_date, r.proposal_date) >= DATE '2026-06-30'
    AND COALESCE(r.movement_date, r.contract_date, r.proposal_date) <  DATE '2026-07-31'
    AND COALESCE(r.insurance_value, 0) > 0
),
calculado AS (
  SELECT
    a.id,
    a.insurance_value,
    CASE
      WHEN a.modalidade = 'ESTOQUE' THEN 0.0010
      -- SLIP sem prazo confiavel: NAO chuta (mesmo contrato do codigo) -> NULL,
      -- e a linha fica de fora do UPDATE pelo WHERE ... IS NOT NULL abaixo.
      WHEN a.term_months IS NULL OR a.term_months <= 0 THEN NULL
      WHEN a.term_months <= 36 THEN 0.0010
      WHEN a.term_months <= 60 THEN 0.0015
      WHEN a.term_months <= 84 THEN 0.0025
      ELSE 0.0035
    END AS taxa
  FROM alvo a
)
UPDATE daily_production_records d
   SET insurance_commission_amount = ROUND(c.insurance_value * c.taxa, 2),
       insurance_commission_percent = c.taxa * 100,
       commission_rule_source       = 'BBTS_RULE_VERSIONS'
  FROM calculado c
 WHERE d.id = c.id
   AND c.taxa IS NOT NULL
   -- IDEMPOTENCIA: so escreve o que ainda nao esta certo.
   AND (
        d.insurance_commission_amount IS DISTINCT FROM ROUND(c.insurance_value * c.taxa, 2)
     OR d.insurance_commission_percent IS DISTINCT FROM c.taxa * 100
     OR d.commission_rule_source       IS DISTINCT FROM 'BBTS_RULE_VERSIONS'
   );

-- ---------------------------------------------------------------------------
-- 3. CONFERIR DEPOIS (esperado: 8 linhas, soma 34,55)
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) AS linhas,
--        SUM(insurance_commission_amount) AS soma_comissao_empresa
--   FROM daily_production_records
--  WHERE company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--    AND COALESCE(movement_date, contract_date, proposal_date) >= DATE '2026-06-30'
--    AND COALESCE(movement_date, contract_date, proposal_date) <  DATE '2026-07-31'
--    AND COALESCE(insurance_value, 0) > 0;

COMMIT;
