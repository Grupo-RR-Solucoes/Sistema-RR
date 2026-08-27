-- Seed: cabecalho da NF das competencias 2026-06 e 2026-07 da ADS  (2026-08-27)
--       frente feat/residuo-financeiro
--
-- STATUS: NAO EXECUTADA. Rodar DEPOIS de 20260827_000001.
--
-- POR QUE UM SEED, E NAO REIMPORTAR OS PDFs. As duas competencias ja estao
-- gravadas; o que falta e so a linha do cabecalho. Reimportar o PDF de credito
-- pela tela funcionaria, MAS nao seria neutro: o merge e owner=FULL e escreveria
-- movement_date de novo em todas as propostas — inclusive na linha SO-SEGURO do
-- contrato 221262790, que hoje esta em 2026-07-31 e voltaria para 2026-07-15.
-- Medido em 27/08/2026, o que essa unica linha carrega junto:
--
--   janela     linhas   gross_value    insurance_value
--   2026-07 hoje   43    519.798,35        113.345,57
--   2026-07 apos   44    531.998,35        202.760,96   (+12.200,00 e +89.415,39)
--   2026-08 hoje   39    270.606,40        116.636,23
--   2026-08 apos   38    258.406,40         27.220,84
--
-- 2026-07 e mes FECHADO e insurance_value e a BASE sobre a qual o BBTS-2c aplica
-- a regua de seguro. Mover isso e decisao de negocio, separada desta. O seed
-- entrega os R$ 100,00 da Abertura SEM tocar em daily_production_records.
--
-- OS VALORES. Extraidos dos dois PDFs em disco pelo extractCabecalhoNf desta
-- mesma frente (scripts/diag-residuo-14-cabecalho-apos.cjs). A identidade fecha
-- nas duas competencias: componentes = Pagamento Total.
--
--   comp      AVT          PRT     Abertura   4a coluna              Total
--   2026-06  7.707,03      7,01       0,00   "Valor Descontado" 0   7.714,04
--   2026-07 18.737,33      7,01     100,00   "Glosa"            0  18.844,34
--
-- Idempotente: upsert pela chave (company_id, competencia). Se o fechamento for
-- reimportado depois, o importador grava exatamente os mesmos numeros por cima.

begin;

insert into bbts_fechamento_cabecalho
  (company_id, competencia, pagamento_avt, pagamento_prt, abertura_conta,
   outras_deducoes, pagamento_total, rotulos, source_filename)
values
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', date '2026-06-01',
   7707.03, 7.01, 0.00, 0.00, 7714.04,
   '[{"rotulo":"Pagamento AVT","valor":7707.03},
     {"rotulo":"Pagamento PRT","valor":7.01},
     {"rotulo":"Abertura de Conta","valor":0},
     {"rotulo":"Valor Descontado","valor":0},
     {"rotulo":"Pagamento Total","valor":7714.04}]'::jsonb,
   'seed 20260827_000002 (Credito ADS-BBTS.pdf)'),
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', date '2026-07-01',
   18737.33, 7.01, 100.00, 0.00, 18844.34,
   '[{"rotulo":"Pagamento AVT","valor":18737.33},
     {"rotulo":"Pagamento PRT","valor":7.01},
     {"rotulo":"Abertura de Conta","valor":100},
     {"rotulo":"Glosa","valor":0},
     {"rotulo":"Pagamento Total","valor":18844.34}]'::jsonb,
   'seed 20260827_000002 (fechamento credito 07/2026)')
on conflict (company_id, competencia) do update set
  pagamento_avt   = excluded.pagamento_avt,
  pagamento_prt   = excluded.pagamento_prt,
  abertura_conta  = excluded.abertura_conta,
  outras_deducoes = excluded.outras_deducoes,
  pagamento_total = excluded.pagamento_total,
  rotulos         = excluded.rotulos,
  source_filename = excluded.source_filename,
  updated_at      = now();

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select competencia, pagamento_avt, pagamento_prt, abertura_conta,
--          outras_deducoes, pagamento_total,
--          round(pagamento_avt + pagamento_prt + abertura_conta + outras_deducoes, 2)
--            as soma_componentes
--     from bbts_fechamento_cabecalho
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--    order by competencia;
--
--   -- esperado:
--   --   2026-06-01 |  7707.03 | 7.01 |   0.00 | 0.00 |  7714.04 |  7714.04
--   --   2026-07-01 | 18737.33 | 7.01 | 100.00 | 0.00 | 18844.34 | 18844.34
--
-- Depois disso, a linha da ADS na matriz de ENTRADA de /financeiro (competencia
-- de caixa 2026-08, que le o fechamento de 2026-07) passa de
--   {avista: 18737.33, prt: 7.01, seguro: 115.10, outros: 0}
-- para
--   {avista: 18737.33, prt: 7.01, seguro: 115.10, outros: 100.00}
-- e receivedClosing de 2026-08 vai de 318.596,26 para 318.696,26.
