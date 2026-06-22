-- ============================================================
-- MONITOR FATOR R — categorias de despesa do numerador da "folha de salários".
--
-- O Fator R (LC 123/2006, art. 18 §24-25) usa a FOLHA DE SALÁRIOS dos últimos
-- 12 meses = salários (folha CLT) + pró-labore + encargos (FGTS, 13º). A
-- categoria "Folha" já existe (seed default). Faltam "Pró-labore" e "FGTS".
--
-- DECISÃO FGTS: vira categoria PRÓPRIA (rastreabilidade/auditoria), mas ENTRA no
-- numerador do Fator R junto com Folha + Pró-labore (lib/fatorR.ts soma as 3 via
-- match por nome). Se preferir embutir o FGTS dentro de "Folha" (folha bruta com
-- encargos), basta não usar esta categoria — o cálculo soma o que existir.
--
-- APLICAÇÃO MANUAL no Supabase Studio (banco não usa migrate automático).
-- READ-ONLY do ponto de vista do app: só insere linhas de catálogo.
-- ============================================================

insert into public.expense_categories (name, is_default, active)
values
  ('Pró-labore', true, true),
  ('FGTS',       true, true)
on conflict (name) do nothing;

-- Verificação:
--   select name, is_default, active from public.expense_categories order by name;
