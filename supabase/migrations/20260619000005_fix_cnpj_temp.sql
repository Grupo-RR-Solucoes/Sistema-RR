-- ============================================================
-- Correção de rótulo CNPJ: TEMP-<MCI> -> CNPJ formatado.
-- ------------------------------------------------------------
-- Registros históricos têm empresa_cnpj/company_cnpj = "TEMP-<MCI>-...".
-- O company_id (uuid FK) está CORRETO; só o rótulo string está errado.
-- Mapeamento 1:1 confirmado (diagnóstico):
--   TEMP-847822962-98250 -> 48.357.275/0001-03  RR ALAGOAS 1  (b037ecdf-20db-4ab0-81a2-b267f876c626)
--   TEMP-850169280-14692 -> 51.457.289/0001-03  RR PERNAMBUCO (ecff243c-df9b-4360-9e47-ff5aa4b1c93b)
--   TEMP-873298328-20466 -> 55.867.409/0001-00  RR ALAGOAS 3  (77f3992e-2417-4da9-8371-eaf5b6116b78)
--   TEMP-873386662-18309 -> 56.140.658/0001-53  RR ALAGOAS 2  (f071840c-7454-4f63-bef4-d1e156115534)
--
-- Idempotente (o WHERE deixa de casar após o 1º run -> 0 linhas).
-- Aplicar manualmente no Supabase Studio. Rodar a PARTE 1 (SELECTs) ANTES.
-- ============================================================


-- ============================================================
-- PARTE 1 — VERIFICAÇÃO (rode ANTES; descomente para executar)
-- ============================================================

-- 1a. Quantos registros serão afetados, por tabela/empresa:
-- SELECT 'fechamento_mensal_empresa' AS tabela, empresa_cnpj, count(*) AS regs
--   FROM fechamento_mensal_empresa
--  WHERE empresa_cnpj LIKE 'TEMP-%'
--  GROUP BY empresa_cnpj
--  ORDER BY empresa_cnpj;
--
-- SELECT 'monthly_closing_entries' AS tabela, company_id, company_cnpj, count(*) AS regs
--   FROM monthly_closing_entries
--  WHERE company_cnpj LIKE 'TEMP-%'
--  GROUP BY company_id, company_cnpj
--  ORDER BY company_id;

-- 1b. DETECÇÃO DE COLISÃO da constraint única (empresa_cnpj, ano, mes) em
--     fechamento_mensal_empresa: linhas TEMP cujo destino formatado JÁ EXISTE
--     na mesma (ano, mes). Resultado esperado: 0 linhas (TEMP vai até 2026-03,
--     formatado só em 2026-04/05). Se vier QUALQUER linha, NÃO rode a PARTE 2.
-- SELECT t.empresa_cnpj AS temp_origem, m.cnpj AS destino, t.ano, t.mes
--   FROM fechamento_mensal_empresa t
--   JOIN (VALUES
--     ('TEMP-847822962-98250', '48.357.275/0001-03'),
--     ('TEMP-850169280-14692', '51.457.289/0001-03'),
--     ('TEMP-873298328-20466', '55.867.409/0001-00'),
--     ('TEMP-873386662-18309', '56.140.658/0001-53')
--   ) AS m(temp_cnpj, cnpj) ON t.empresa_cnpj = m.temp_cnpj
--   JOIN fechamento_mensal_empresa f
--     ON f.empresa_cnpj = m.cnpj AND f.ano = t.ano AND f.mes = t.mes;


-- ============================================================
-- PARTE 2 — CORREÇÃO (UPDATEs atômicos). Só rode após a PARTE 1 conferir.
-- ============================================================

BEGIN;

-- monthly_closing_entries (TEM company_id confiável -> match por uuid; TEMP só
-- como verificação). ~256k linhas no total das 4 empresas.
UPDATE monthly_closing_entries SET company_cnpj = '48.357.275/0001-03'
 WHERE company_id = 'b037ecdf-20db-4ab0-81a2-b267f876c626' AND company_cnpj LIKE 'TEMP-%';

UPDATE monthly_closing_entries SET company_cnpj = '51.457.289/0001-03'
 WHERE company_id = 'ecff243c-df9b-4360-9e47-ff5aa4b1c93b' AND company_cnpj LIKE 'TEMP-%';

UPDATE monthly_closing_entries SET company_cnpj = '55.867.409/0001-00'
 WHERE company_id = '77f3992e-2417-4da9-8371-eaf5b6116b78' AND company_cnpj LIKE 'TEMP-%';

UPDATE monthly_closing_entries SET company_cnpj = '56.140.658/0001-53'
 WHERE company_id = 'f071840c-7454-4f63-bef4-d1e156115534' AND company_cnpj LIKE 'TEMP-%';

-- fechamento_mensal_empresa (NÃO tem company_id -> match pela string TEMP EXATA).
-- 84 registros no total. Sem colisão de (empresa_cnpj, ano, mes): TEMP cobre até
-- 2026-03, formatado só 2026-04/05. (Se houvesse colisão, a constraint rejeitaria
-- e o BEGIN/COMMIT garante all-or-nothing.)
UPDATE fechamento_mensal_empresa SET empresa_cnpj = '48.357.275/0001-03'
 WHERE empresa_cnpj = 'TEMP-847822962-98250';

UPDATE fechamento_mensal_empresa SET empresa_cnpj = '51.457.289/0001-03'
 WHERE empresa_cnpj = 'TEMP-850169280-14692';

UPDATE fechamento_mensal_empresa SET empresa_cnpj = '55.867.409/0001-00'
 WHERE empresa_cnpj = 'TEMP-873298328-20466';

UPDATE fechamento_mensal_empresa SET empresa_cnpj = '56.140.658/0001-53'
 WHERE empresa_cnpj = 'TEMP-873386662-18309';

COMMIT;


-- ============================================================
-- PARTE 3 — CONFERÊNCIA PÓS (rode depois; deve dar 0 nas duas)
-- ============================================================
-- SELECT count(*) AS temp_restantes_fechamento FROM fechamento_mensal_empresa WHERE empresa_cnpj LIKE 'TEMP-%';
-- SELECT count(*) AS temp_restantes_entries    FROM monthly_closing_entries  WHERE company_cnpj LIKE 'TEMP-%';
