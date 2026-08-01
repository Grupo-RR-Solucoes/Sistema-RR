-- Migration: Auditoria ADS/BBTS — 1B: promove o "PAGO pela BBTS" a COLUNA  (2026-07-12)
--
-- PROBLEMA: o que a BBTS efetivamente pagou por contrato (pag à vista, o % que ela
-- usou, e o prêmio do seguro) só existia dentro de raw_payload.__bbts_meta (JSONB).
-- Isso (a) é opaco para SQL/agregação — o lado "pago" da auditoria não dá para
-- somar/juntar em query; e (b) é frágil: um merge do raw_payload podia apagar o
-- bloco inteiro (o merge foi corrigido no mesmo commit, mas o dado continua no
-- lugar errado).
--
-- Mesmo argumento e mesmo precedente da migration 20260709_000002, que promoveu
-- prod_segurada/insurance_number a colunas ("em raw_payload ele ficaria opaco").
--
-- ESCOPO: PURAMENTE ADITIVA (3 colunas nullable) + um BACKFILL a partir do que já
-- está gravado no próprio JSONB. NÃO é reimportação: nenhum PDF é lido, nenhuma
-- linha é criada ou apagada; só copia campo->coluna nas linhas da ADS que já têm
-- __bbts_meta. Idempotente (só preenche onde a coluna está NULL). Transacional.
--
-- STATUS: EXECUTADA. Corrigido em 01/08/2026 — o cabeçalho dizia "NÃO EXECUTADA"
-- e estava desatualizado. Conferido em produção: as três colunas respondem a
-- select, e o backfill rodou (jun/2026 tem bbts_pag_avista preenchido em 19/19
-- das linhas elegíveis da ADS).
--
-- ERRATA DE SEMÂNTICA no comment de bbts_seguro_pago abaixo: ele diz "prêmio de
-- seguro". A medição de 01/08/2026 mostra que é COMISSÃO, não prêmio —
-- R$ 97,54 sobre R$ 82.939,80 de produção segurada = 0,1176%, ordem de grandeza
-- de comissão (a do RR na mesma competência é 0,0818% do líquido). Prêmio
-- estaria na casa de 1-5% da produção segurada. O comment não foi reescrito
-- aqui porque esta migration já rodou; a correção vai numa migration própria
-- junto com a implementação da base ADS.

begin;

alter table daily_production_records
  add column if not exists bbts_pag_avista     numeric,
  add column if not exists bbts_taxa_relatorio numeric,
  add column if not exists bbts_seguro_pago    numeric;

comment on column daily_production_records.bbts_pag_avista is
  'ADS/BBTS: o que a BBTS PAGOU a vista neste contrato (coluna "Pag. a Vista" do PDF '
  'de fechamento). E o lado PAGO da auditoria da ADS. NAO e comissao de promotor.';
comment on column daily_production_records.bbts_taxa_relatorio is
  'ADS/BBTS: o percentual que a BBTS USOU para pagar (coluna "Percentual Pag a Vista"). '
  'Descreve o pagamento — NAO e o devido. O devido vem da regua (bbts_rule_versions).';
comment on column daily_production_records.bbts_seguro_pago is
  'ADS/BBTS: premio de seguro pago pela BBTS neste contrato (PDF de seguro).';

-- BACKFILL a partir do JSONB já existente (idempotente: só onde a coluna está NULL).
update daily_production_records
   set bbts_pag_avista     = coalesce(bbts_pag_avista,     (raw_payload -> '__bbts_meta' ->> 'pag_avista_relatorio')::numeric),
       bbts_taxa_relatorio = coalesce(bbts_taxa_relatorio, (raw_payload -> '__bbts_meta' ->> 'taxa_relatorio')::numeric),
       bbts_seguro_pago    = coalesce(bbts_seguro_pago,    (raw_payload -> '__bbts_meta' ->> 'seguro_valor_relatorio')::numeric)
 where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'      -- ADS
   and raw_payload ? '__bbts_meta'
   and (bbts_pag_avista is null or bbts_taxa_relatorio is null or bbts_seguro_pago is null);

commit;

-- ============================================================
-- Verificação pós-execução
-- ============================================================
--   -- (a) as 3 colunas existem:
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='daily_production_records'
--      and column_name like 'bbts_%' order by column_name;
--
--   -- (b) backfill: coluna == JSONB, linha a linha (esperado: 0 divergencias):
--   select count(*) as divergencias
--     from daily_production_records
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--      and raw_payload ? '__bbts_meta'
--      and bbts_pag_avista is distinct from (raw_payload->'__bbts_meta'->>'pag_avista_relatorio')::numeric;
--
--   -- (c) junho/2026: Sigma do pago a vista agora sai em SQL puro:
--   select count(*) as contratos, sum(bbts_pag_avista) as pago_avista
--     from daily_production_records
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--      and contract_date between date '2026-06-01' and date '2026-06-30';
