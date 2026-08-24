-- ==============================================================
-- 2026-08-24_remove_pmr_orfa_produto.sql
--
-- REMOVE AS 16 LINHAS ORFAS DE PMR criadas pelo repasse de produto
-- na EMPRESA ERRADA.
--
-- LINHAS CURTAS DE PROPOSITO (<= 70 col): este SQL e copiado do
-- chat para o Studio, e terminal que quebra linha longa gera
-- comando truncado. Nao "arrume" reunindo as linhas.
--
-- O QUE ACONTECEU. Ate o commit 9493754, applyProdutoRepasseAoPmr
-- gravava o repasse de produto com o company_id da LINHA DE
-- PRODUTO. O PMR tem UNIQUE (promoter_id, year, month,
-- company_id) e o consorcio inteiro e da AL1: quem tem credito
-- noutra empresa recebeu uma SEGUNDA linha em vez de ter a dele
-- atualizada. Nasceram 16 linhas assim em 23/08/2026 23:08, na
-- primeira vez que o repasse de produto rodou de verdade.
--
-- O CODIGO JA ESTA CONSERTADO (9493754): a empresa passa a sair de
-- buildDonaCompanyMapDoMes, a mesma regua do fechamento. Mas o
-- conserto NAO remove o que ja foi gravado: no proximo
-- reconsolidar o valor entra na linha CERTA e as 16 antigas ficam,
-- com o mesmo dinheiro contado DUAS VEZES.
--
-- QUANTO: consorcio 4.551,46 + conta corrente 131,22 + bbcap 27,04
--         = 4.709,72 duplicados. O final somado do grupo iria de
--         132.243,73 para ~136.953,45.
-- A fonte da verdade nao duplica: o calculo devolve 5.240,34 para
-- os promotores, que e o que deve estar no PMR uma vez so.
--
-- POR QUE A LISTA E EXPLICITA, e nao um WHERE calculado: o SQL NAO
-- SABE resolver a empresa dona — a regua (computeDonaCompanyMap)
-- pondera a producao da chave INDIVIDUAL contra a herdada, em
-- TypeScript. Um WHERE que tentasse deduzir a dona seria uma
-- segunda implementacao da regra, e apagaria por engano no dia em
-- que as duas divergissem. Os 16 pares abaixo foram resolvidos
-- pelo codigo e conferidos um a um.
--
-- CONFERIDO ANTES DE ESCREVER ESTE ARQUIVO: as 16 tem
-- production_commission_value = 0, insurance_commission_value = 0,
-- production_value = 0, proposal_count = 0, discount_value = 0 e
-- target_value = 0. Nenhuma carrega credito, seguro, producao,
-- desconto ou meta — so coluna de produto. Se o passo 1 mostrar
-- qualquer valor nessas colunas, PARE: a linha nao e orfa de
-- produto e nao pode ser apagada.
--
-- APLICAR MANUALMENTE no Supabase Studio.
-- ==============================================================

-- --------------------------------------------------------------
-- 1. CONFERIR ANTES (rode sozinho; nao altera nada)
-- --------------------------------------------------------------
-- -- esperado: 16 linhas, TODAS com credito/seguro/producao/
-- -- propostas/desconto/meta = 0.
-- SELECT p.name                        AS promotor,
--        c.name                        AS empresa,
--        r.production_commission_value AS credito,
--        r.insurance_commission_value  AS seguro,
--        r.production_value            AS producao,
--        r.proposal_count              AS propostas,
--        r.discount_value              AS desconto,
--        r.target_value                AS meta,
--        r.bbcap_commission_value      AS bbcap,
--        r.conta_corrente_commission_value AS conta_corrente,
--        r.consorcio_commission_value  AS consorcio,
--        r.final_commission_value      AS final,
--        r.created_at
--   FROM promoter_monthly_results r
--   JOIN promoters  p ON p.id = r.promoter_id
--   LEFT JOIN companies c ON c.id = r.company_id
--  WHERE r.year = 2026
--    AND r.month = 7
--    AND r.source = 'fechamento'
--    AND (r.promoter_id, r.company_id) IN (
--      ('eb965d66-0f88-4145-8f53-3b16128e7f4f',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('1962afcb-6d07-4a3d-b49d-df272b0e66c6',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('1962afcb-6d07-4a3d-b49d-df272b0e66c6',
--       'f071840c-7454-4f63-bef4-d1e156115534'),
--      ('aa1b6b4f-cd54-4da8-97b6-83ab4bf9390a',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('781353a9-b0fa-454b-815b-9a0b4232e05f',
--       '77f3992e-2417-4da9-8371-eaf5b6116b78'),
--      ('f7ec3d31-6e6f-4a2a-af93-8fdf21b667da',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('871a2b41-7147-4217-a8fe-c3d052096056',
--       '77f3992e-2417-4da9-8371-eaf5b6116b78'),
--      ('650a744a-7b83-4c82-8e0e-47ecfe027061',
--       '77f3992e-2417-4da9-8371-eaf5b6116b78'),
--      ('650a744a-7b83-4c82-8e0e-47ecfe027061',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('cb4a0e39-6f82-4071-809f-c381d6439db9',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('cb4a0e39-6f82-4071-809f-c381d6439db9',
--       'f071840c-7454-4f63-bef4-d1e156115534'),
--      ('f0526be8-592a-4705-923b-5c7915ff74d7',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('fc2a1884-aa1f-4997-8a78-1a8e020aadd7',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('ed7c1658-6173-45be-b38d-40b6dcd7b12a',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('357d85d6-84e9-46d0-a5c1-31cdb893d355',
--       'b037ecdf-20db-4ab0-81a2-b267f876c626'),
--      ('74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9',
--       'f071840c-7454-4f63-bef4-d1e156115534')
--    )
--  ORDER BY p.name;

BEGIN;

-- --------------------------------------------------------------
-- 2. A REDE DE SEGURANCA
-- --------------------------------------------------------------
-- O DELETE abaixo tem, alem dos 16 pares, as condicoes
-- production_commission_value = 0 AND insurance_commission_value =
-- 0. Isso e REDUNDANTE com a conferencia do passo 1 — e de
-- proposito. Se entre a conferencia e a execucao alguem rodar o
-- reconsolidar e o credito cair numa dessas linhas, o DELETE
-- simplesmente NAO a apaga, em vez de apagar comissao de verdade.
-- Prefiro apagar de menos e voce rodar de novo.

DELETE FROM public.promoter_monthly_results r
 WHERE r.year = 2026
   AND r.month = 7
   AND r.source = 'fechamento'
   AND COALESCE(r.production_commission_value, 0) = 0
   AND COALESCE(r.insurance_commission_value, 0) = 0
   AND COALESCE(r.production_value, 0) = 0
   AND COALESCE(r.proposal_count, 0) = 0
   AND COALESCE(r.discount_value, 0) = 0
   AND (r.promoter_id, r.company_id) IN (
     -- ALDALENE DE FREITAS ABRAAO | RR ALAGOAS 1 | final 110,08
     ('eb965d66-0f88-4145-8f53-3b16128e7f4f',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- BIANCA ALEANDRA SANTOS ARRUDA | RR ALAGOAS 1 | final 329,00
     ('1962afcb-6d07-4a3d-b49d-df272b0e66c6',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- BIANCA ALEANDRA SANTOS ARRUDA | RR ALAGOAS 2 | final 14,58
     ('1962afcb-6d07-4a3d-b49d-df272b0e66c6',
      'f071840c-7454-4f63-bef4-d1e156115534'),
     -- CAMILA GOMES XAVIER | RR ALAGOAS 1 | final 80,00
     ('aa1b6b4f-cd54-4da8-97b6-83ab4bf9390a',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- CARLA ADRIANA | RR ALAGOAS 3 | final 4,87
     ('781353a9-b0fa-454b-815b-9a0b4232e05f',
      '77f3992e-2417-4da9-8371-eaf5b6116b78'),
     -- ERIVAN VITAL DE ALMEIDA | RR ALAGOAS 1 | final 827,54
     ('f7ec3d31-6e6f-4a2a-af93-8fdf21b667da',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- JAMERSON NASCIMENTO DE ARAUJO | RR ALAGOAS 3 | final 14,58
     ('871a2b41-7147-4217-a8fe-c3d052096056',
      '77f3992e-2417-4da9-8371-eaf5b6116b78'),
     -- JARLES MARLON DE OLIVEIRA | RR ALAGOAS 3 | final 22,17
     ('650a744a-7b83-4c82-8e0e-47ecfe027061',
      '77f3992e-2417-4da9-8371-eaf5b6116b78'),
     -- JARLES MARLON DE OLIVEIRA | RR ALAGOAS 1 | final 347,30
     ('650a744a-7b83-4c82-8e0e-47ecfe027061',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- JENIFFER MILENA SANTOS CAMILO | RR ALAGOAS 1 | final 145,32
     ('cb4a0e39-6f82-4071-809f-c381d6439db9',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- JENIFFER MILENA SANTOS CAMILO | RR ALAGOAS 2 | final 14,58
     ('cb4a0e39-6f82-4071-809f-c381d6439db9',
      'f071840c-7454-4f63-bef4-d1e156115534'),
     -- JESSICA DE ALBUQUERQUE B. ROCHA | RR ALAGOAS 1 | final 14,58
     ('f0526be8-592a-4705-923b-5c7915ff74d7',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- MAYANNE SHYRLEY DA S GALDINO | RR ALAGOAS 1 | final 29,16
     ('fc2a1884-aa1f-4997-8a78-1a8e020aadd7',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- ROSANGELA MARIA ARRUDA | RR ALAGOAS 1 | final 158,76
     ('ed7c1658-6173-45be-b38d-40b6dcd7b12a',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- THAYNARA TAVARES CORREIA COSTA | RR ALAGOAS 1 | final 2.568,04
     ('357d85d6-84e9-46d0-a5c1-31cdb893d355',
      'b037ecdf-20db-4ab0-81a2-b267f876c626'),
     -- WILIANA DA COSTA SILVA | RR ALAGOAS 2 | final 29,16
     ('74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9',
      'f071840c-7454-4f63-bef4-d1e156115534')
   );

COMMIT;

-- --------------------------------------------------------------
-- 3. CONFERIR DEPOIS
-- --------------------------------------------------------------
-- -- (3a) as 16 sumiram? esperado: 0 linhas.
-- --      (repita o SELECT do passo 1 — deve voltar vazio)
--
-- -- (3b) NINGUEM ficou com 2+ linhas de fechamento em 2026-07.
-- --      esperado: 0 linhas.
-- SELECT p.name, COUNT(*) AS linhas
--   FROM promoter_monthly_results r
--   JOIN promoters p ON p.id = r.promoter_id
--  WHERE r.year = 2026
--    AND r.month = 7
--    AND r.source = 'fechamento'
--  GROUP BY p.name
-- HAVING COUNT(*) > 1
--  ORDER BY p.name;
--
-- -- (3c) o total de produto do PMR depois da limpeza.
-- --      esperado: as colunas de produto caem para o que sobrou
-- --      nas linhas donas. Depois do PROXIMO reconsolidar elas
-- --      voltam a somar 5.240,34, agora na linha certa.
-- SELECT SUM(bbcap_commission_value)          AS bbcap,
--        SUM(conta_corrente_commission_value) AS conta_corrente,
--        SUM(consorcio_commission_value)      AS consorcio,
--        SUM(final_commission_value)          AS final
--   FROM promoter_monthly_results
--  WHERE year = 2026 AND month = 7
--    AND source = 'fechamento';
--
-- -- (3d) DEPOIS de rodar o reconsolidar de 2026-07: o produto tem
-- --      de reaparecer na linha DONA de cada promotor.
-- --      esperado: bbcap 50,58 · conta corrente 510,30 ·
-- --                consorcio 4.679,46  (o repasse dos PROMOTORES;
-- --                a gestao vai para gestao_venda_propria)
-- SELECT SUM(bbcap_commission_value)          AS bbcap,
--        SUM(conta_corrente_commission_value) AS conta_corrente,
--        SUM(consorcio_commission_value)      AS consorcio
--   FROM promoter_monthly_results
--  WHERE year = 2026 AND month = 7
--    AND source = 'fechamento';
--
-- -- ROLLBACK: NAO HA. O DELETE e destrutivo e as linhas nao tem
-- -- origem propria — elas sao DERIVADAS. Para recria-las basta
-- -- rodar o reconsolidar de 2026-07, que as grava de novo (agora
-- -- na empresa dona, por causa do 9493754). Se precisar do estado
-- -- exato de antes, o passo 1 imprime as 16 com todos os valores:
-- -- guarde a saida antes de rodar o BEGIN.
