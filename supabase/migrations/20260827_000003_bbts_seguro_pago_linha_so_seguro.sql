-- Backfill: bbts_seguro_pago da linha SO-SEGURO da ADS  (2026-08-27)
--           frente feat/residuo-financeiro — BLOCO 2
--
-- STATUS: NAO EXECUTADA. Rodar no Studio.
--
-- O DEFEITO. O bloco so-seguro do bbtsClosingImport (linhas 521-569) nao
-- promovia o valor a COLUNA: ele ficava so em
-- raw_payload.__bbts_meta.seguro_valor_relatorio, e os dois leitores da receita
-- da ADS leem a COLUNA (dre.ts:348 e financialAnalytics.ts:425). O codigo ja foi
-- corrigido nesta frente; este SQL alcanca a linha que JA existe.
--
-- ALCANCE MEDIDO em 27/08/2026, no banco inteiro: UMA linha.
--   id   5240028e-464b-428a-870d-86576c31dfc6
--   prop 221262790   movement_date 2026-07-31   bbts_seguro_pago NULL
--   raw_payload.__bbts_meta.seguro_valor_relatorio = 89.42
--
-- O PDF de seguro de 07/2026 tem 13 linhas 'calculo' (Sigma 204,52). Doze tem
-- credito no mesmo PDF e viraram coluna (Sigma 115,10); esta e a decima terceira.
--
-- ============================================================================
-- ATENCAO — ESTE UPDATE MOVE A LINHA DE COMPETENCIA, E ISSO E DECISAO DE
-- NEGOCIO, NAO CONSERTO. LEIA ANTES DE RODAR.
-- ============================================================================
-- As 12 irmas desta linha, do MESMO fechamento, estao em movement_date
-- 2026-07-15 — o dia 15 que o proprio importador escolhe para nao rolar de
-- competencia (bbtsClosingImport.ts:349-355). Esta esta em 2026-07-31 porque a
-- diaria sobrescreveu a data depois (movement_date esta em CREDIT_COLUMNS), e a
-- regua da janela manda 31/07 para AGOSTO.
--
-- Decisao do Diego em 27/08/2026: julho, junto com as irmas. Reafirmada depois
-- de ver os numeros abaixo.
--
-- O QUE ANDA JUNTO (medido, scripts/diag-residuo-15-impacto-mov.cjs). A linha
-- nao carrega so os R$ 89,42 — ela tem gross_value 12.200,00 e insurance_value
-- 89.415,39 (a base segurada; 0,10% dela = os 89,42, mesma razao das 12 irmas):
--
--   janela         linhas   gross_value    insurance_value   bbts_seguro_pago
--   2026-07 hoje       43    519.798,35        113.345,57             115,10
--   2026-07 apos       44    531.998,35        202.760,96             204,52
--   2026-08 hoje       39    270.606,40        116.636,23               0,00
--   2026-08 apos       38    258.406,40         27.220,84               0,00
--
-- 2026-07 e mes FECHADO, e insurance_value e a BASE sobre a qual o BBTS-2c
-- aplica a regua de seguro. O promotor da linha e REBECA ARAUJO DE OLIVEIRA,
-- que hoje NAO tem nenhuma linha de promoter_monthly_results em 2026.
--
-- DEPOIS DE RODAR: nada recalcula sozinho. Para o repasse refletir a mudanca e
-- preciso reconsolidar 2026-07 (reconsolidarCompetenciaFechada) — o que TAMBEM
-- traz os 12.200,00 de producao e os 89.415,39 de base segurada para o mes
-- fechado. NAO rode a reconsolidacao sem decidir isso.
--
-- SE PREFERIR A VERSAO ESTREITA (so o valor, sem mover a competencia): apague a
-- linha `movement_date = date '2026-07-15',` abaixo. Os R$ 89,42 entram na
-- janela 2026-08, que ainda nao fechou, e nenhuma producao se move.

begin;

update daily_production_records
   set bbts_seguro_pago = (raw_payload -> '__bbts_meta' ->> 'seguro_valor_relatorio')::numeric,
       movement_date    = date '2026-07-15',
       updated_at       = now()
 where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'                    -- ADS
   and raw_payload -> '__bbts_meta' ->> 'fonte' = 'fechamento_pdf_seguro_only'
   and bbts_seguro_pago is null
   and (raw_payload -> '__bbts_meta' ->> 'seguro_valor_relatorio') is not null;

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   -- (a) a linha (esperado: 1 linha, 89.42, 2026-07-15)
--   select id, proposal_number, movement_date, bbts_seguro_pago, gross_value,
--          insurance_value
--     from daily_production_records
--    where raw_payload -> '__bbts_meta' ->> 'fonte' = 'fechamento_pdf_seguro_only';
--
--   -- (b) o seguro de julho passa a bater a ancora 'calculo' do PDF (204,52):
--   select sum(bbts_seguro_pago) as seguro_pago
--     from daily_production_records
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--      and movement_date >= date '2026-07-01'
--      and movement_date <= date '2026-07-30';
--   -- esperado: 204.52   (era 115.10)
--
--   -- (c) nenhuma outra linha ficou para tras:
--   select count(*) as ainda_nulas
--     from daily_production_records
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--      and raw_payload -> '__bbts_meta' ->> 'fonte' = 'fechamento_pdf_seguro_only'
--      and bbts_seguro_pago is null;
--   -- esperado: 0
