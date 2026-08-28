-- Backfill: totais da NF das competencias com PDF em disco  (2026-08-27)
--           frente feat/residuo-financeiro
--
-- STATUS: NAO EXECUTADA.
--
-- SAO 2 COMPETENCIAS, e sao todas as que existem: a varredura dos PDFs em disco
-- pelo teste objetivo (contem a ancora "Pagamento AVT") acha exatamente dois
-- fechamentos de credito da ADS —
--   2026-06  "Credito ADS-BBTS.pdf"
--   2026-07  "pdf (1).pdf"
--
-- Os valores saem do extractCabecalhoNf desta frente, que pareia ROTULO com VALOR
-- por geometria e se valida pela identidade da soma. Medido nas duas:
--   06/26   7.707,03 + 7,01 +   0,00 + 0,00 =  7.714,04 = "Pagamento Total"  fecha
--   07/26  18.737,33 + 7,01 + 100,00 + 0,00 = 18.844,34 = "Pagamento Total"  fecha
--
-- E a ANCORA ja foi conferida contra o banco ANTES deste insert
-- (scripts/diag-residuo-37-ancora-totais.cjs): 2 batem, 0 divergem.
--   comp     | AVT declarado   AVT nas linhas   delta | PRT declarado  PRT linhas  delta
--   2026-06  |      7.707,03         7.707,03    0,00 |         7,01       7,01    0,00
--   2026-07  |     18.737,33        18.737,33    0,00 |         7,01       7,01    0,00
--
-- Idempotente por (company_id, competencia). Reimportar o fechamento pela tela
-- grava exatamente os mesmos numeros por cima.

begin;

insert into bbts_fechamento_totais
  (company_id, competencia, pagamento_avt, pagamento_prt, abertura_conta, glosa,
   pagamento_total, arquivo_origem)
values
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', date '2026-06-01',
   7707.03, 7.01, 0.00, 0.00, 7714.04, 'Crédito ADS-BBTS.pdf'),
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', date '2026-07-01',
   18737.33, 7.01, 100.00, 0.00, 18844.34, 'pdf (1).pdf')
on conflict (company_id, competencia) do update set
  pagamento_avt   = excluded.pagamento_avt,
  pagamento_prt   = excluded.pagamento_prt,
  abertura_conta  = excluded.abertura_conta,
  glosa           = excluded.glosa,
  pagamento_total = excluded.pagamento_total,
  arquivo_origem  = excluded.arquivo_origem,
  updated_at      = now();

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select competencia, pagamento_avt, pagamento_prt, abertura_conta, glosa,
--          pagamento_total,
--          round(pagamento_avt + pagamento_prt + abertura_conta + glosa, 2) as soma
--     from bbts_fechamento_totais
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--    order by competencia;
--   -- 2026-06-01 |  7707.03 | 7.01 |   0.00 | 0.00 |  7714.04 |  7714.04
--   -- 2026-07-01 | 18737.33 | 7.01 | 100.00 | 0.00 | 18844.34 | 18844.34
