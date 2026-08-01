-- Migration: corrige a semantica documentada de bbts_seguro_pago (2026-08-01)
--
-- SO COMMENT. Nenhuma coluna criada, alterada ou removida; nenhum dado tocado.
--
-- O QUE ESTAVA ERRADO. A 20260712_000003 documentou a coluna como premio:
--
--     comment on column daily_production_records.bbts_seguro_pago is
--       'ADS/BBTS: premio de seguro pago pela BBTS neste contrato (PDF de seguro).';
--
-- Nao e premio, e COMISSAO. Medido em 01/08/2026 sobre a ADS em jun/2026
-- (competencia canonica via getProductionPeriodFromValue, 19 linhas elegiveis):
--
--     numerador bbts_seguro_pago                        R$      97,54
--     / liquido segurado (has_insurance)                R$  82.939,80 = 0,1176%
--     / insurance_value das seguradas                   R$  82.939,80 = 0,1176%
--     / liquido TOTAL elegivel                          R$ 271.210,84 = 0,0360%
--
-- 0,1176% sobre a producao SEGURADA e ordem de grandeza de comissao — a do RR na
-- mesma competencia e 0,0818% do liquido. Premio de seguro estaria entre 1% e 5%
-- da producao segurada, ou seja, entre R$ 830 e R$ 4.150, e nao R$ 97,54.
--
-- O denominador importa: contra o liquido TOTAL da 0,0360%, e foi assim que a
-- primeira leitura quase concluiu "premio". Seguro incide sobre producao
-- segurada, nao sobre a producao inteira.
--
-- POR QUE ISSO NAO E COSMETICO: a coluna passa a compor a base da remuneracao de
-- lideranca (lib/lideranca/baseLideranca, lado ADS). Um comment dizendo "premio"
-- convida o proximo a tirar o campo da base por achar que e custo do cliente.
--
-- Idempotente por natureza (comment on column e sobrescrita). Transacional.

begin;

comment on column daily_production_records.bbts_seguro_pago is
  'ADS/BBTS: COMISSAO de seguro paga pela BBTS neste contrato (PDF de seguro). '
  'NAO e premio: medido 0,1176% sobre a producao segurada em jun/2026, ordem de '
  'comissao (premio estaria em 1-5%). Compoe a base AVISTA_CREDITO_PF da '
  'remuneracao de lideranca junto com bbts_pag_avista. Corrige o comment '
  'anterior, da 20260712_000003, que dizia "premio".';

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select col_description(
--            'public.daily_production_records'::regclass,
--            (select ordinal_position
--               from information_schema.columns
--              where table_schema = 'public'
--                and table_name = 'daily_production_records'
--                and column_name = 'bbts_seguro_pago')
--          ) as comentario;
--   -- esperado: texto comecando com 'ADS/BBTS: COMISSAO de seguro paga pela BBTS'.
