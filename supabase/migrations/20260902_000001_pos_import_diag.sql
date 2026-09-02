-- Migration: rastro dos efeitos colaterais do import de fechamento  (2026-09-02)
--
-- POR QUE: os 4 blocos pos-import (materializar carteira PRT -> congelar
-- previsao -> monitor de inadimplencia -> carteira do consorcio) sao
-- best-effort e cada um engole o proprio erro num console.error. Num deploy
-- serverless isso morre no log da invocacao. Custo medido do silencio: a
-- materializacao da carteira PRT falhava desde 2026-07-07 e so foi descoberta em
-- 02/09/2026, depois de DOIS fechamentos (julho e agosto) com producao_contrato
-- e carteira_contrato parados em 2026-06.
--
-- O QUE GRAVA: um jsonb por import, com um objeto por bloco —
--   { gerado_em, houve_falha, falharam[], ms_total,
--     blocos: [ { nome, ok, ms, erro?, extra? } ] }
-- A mensagem do erro vai CRUA. O `ms` nao e enfeite: foi o tempo que separou
-- "falhou rapido" de "morreu depois de 38-51s" no diagnostico de 02/09.
--
-- Aditiva e reversivel: coluna nullable, sem default, sem trigger, sem RLS nova
-- (monthly_closing_imports ja tem a sua). Import antigo fica NULL, que le-se
-- como "rodou antes deste rastro existir" — NAO como "passou".
--
-- APLICAR MANUALMENTE no Studio (padrao deste repo). Idempotente.
-- O portao scripts/gate_pos_import_diag.cjs REPROVA enquanto a coluna nao
-- existir — de proposito: sem a coluna o conserto e inerte, e um portao verde
-- ali seria a mesma mentira que este arquivo veio consertar.

begin;

alter table public.monthly_closing_imports
  add column if not exists pos_import_diag jsonb;

comment on column public.monthly_closing_imports.pos_import_diag is
  'Rastro dos blocos best-effort do pos-import (materializacao da carteira PRT, '
  'congelamento da previsao, monitor de inadimplencia, carteira do consorcio). '
  'Guarda ok/ms/erro CRU por bloco. NULL = import anterior a este rastro, nao sucesso. '
  'Ver lib/diagnostico/posImportDiag.ts.';

-- Busca dos imports quebrados sem abrir o jsonb linha a linha.
create index if not exists idx_mci_pos_import_falha
  on public.monthly_closing_imports (((pos_import_diag->>'houve_falha')::boolean))
  where pos_import_diag is not null;

commit;

-- ============================================================
-- CONFERENCIA (rodar depois):
--   select id, year, month,
--          pos_import_diag->>'houve_falha' as falhou,
--          pos_import_diag->'falharam'     as blocos_quebrados,
--          pos_import_diag->'blocos'       as detalhe
--     from monthly_closing_imports
--    where pos_import_diag is not null
--    order by created_at desc limit 10;
-- ============================================================
