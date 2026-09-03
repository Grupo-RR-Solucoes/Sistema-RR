-- Migration: rastro dos efeitos colaterais de QUALQUER import  (2026-09-03)
--
-- SUBSTITUI 20260902_000001_pos_import_diag.sql, que criava a coluna
-- `monthly_closing_imports.pos_import_diag` e NUNCA foi aplicada (medido em
-- 02/09/2026: 42703 column does not exist). Aquele arquivo foi APAGADO no mesmo
-- commit que criou este — deixar migration superada em disco e convidar alguem a
-- aplica-la depois e criar uma coluna morta.
--
-- POR QUE MUDOU DE FORMA
-- ----------------------
-- A coluna cobria UMA das duas rotas de fechamento. Medido em 02/09/2026: o
-- fechamento da ADS entra por app/api/import/closing/ads/route.ts e se registra
-- em `daily_imports`, nao em `monthly_closing_imports`. Ou seja, o import da ADS
-- de agosto nao teria deixado rastro NEM COM a coluna aplicada.
--
-- A saida obvia seria uma coluna equivalente em daily_imports. Nao e o certo:
--
--   1. Rastro em duas formas sao dois rastros. A pergunta operacional e "o que
--      quebrou em algum import?" e ela tem de ter UMA consulta. Com coluna em
--      duas tabelas sao dois formatos e duas queries — e a terceira rota (o
--      backfill de closing-history ja existe) viraria a terceira.
--   2. `daily_imports` e compartilhada com a importacao DIARIA (xlsx de
--      producao). A coluna ficaria NULL na esmagadora maioria das linhas da
--      propria tabela onde mora — e NULL ambiguo ("nao rodou" x "rodou e
--      passou") e exatamente a leitura errada que este rastro existe para
--      impedir.
--   3. Ha coisa engolida que nao pertence a rota nenhuma: os blocos best-effort
--      DENTRO de reconsolidarCompetenciaFechada (fingerprint da Camada 2,
--      marcacao de desconto por piso) rodam pelas duas. Numa tabela propria eles
--      tem onde morar sem escolher dono.
--
-- O CRITERIO NAO MUDOU: a mensagem crua so existe no instante da chamada; ou e
-- gravada ali, ou se perde.
--
-- `origem` + `import_id` identificam o evento sem FK: as duas tabelas de origem
-- tem ids proprios e uma FK teria de ser uma das duas. Guardar o par (e a
-- competencia) mantem a tabela util mesmo se um import for apagado.
--
-- APLICAR MANUALMENTE no Studio (padrao deste repo). Idempotente.
-- O portao scripts/gate_pos_import_diag.cjs REPROVA enquanto a tabela nao
-- existir — de proposito: sem ela o conserto e inerte.

begin;

create table if not exists public.import_pos_diag (
  id           uuid primary key default gen_random_uuid(),
  -- 'closing_rr' | 'closing_ads' | (o que vier depois). Texto, nao enum: enum
  -- novo exige migration, e este repo aplica migration a mao.
  origem       text not null,
  -- id da linha em monthly_closing_imports (RR) ou daily_imports (ADS).
  import_id    uuid,
  year         int,
  month        int,
  houve_falha  boolean not null default false,
  -- nomes dos blocos que falharam, para achar sem abrir o jsonb.
  falharam     text[] not null default '{}',
  ms_total     int not null default 0,
  -- [{ nome, ok, ms, erro?, extra? }] — `erro` e a mensagem CRUA.
  blocos       jsonb not null default '[]'::jsonb,
  criado_em    timestamptz not null default now()
);

comment on table public.import_pos_diag is
  'Rastro dos efeitos colaterais de um import (RR e ADS). Guarda ok/ms/erro CRU por '
  'bloco. Ausencia de linha = import anterior a este rastro, NAO sucesso. '
  'Ver lib/diagnostico/posImportDiag.ts.';

create index if not exists idx_import_pos_diag_falha
  on public.import_pos_diag (houve_falha, criado_em desc);
create index if not exists idx_import_pos_diag_import
  on public.import_pos_diag (origem, import_id);
create index if not exists idx_import_pos_diag_comp
  on public.import_pos_diag (year, month);

-- Escrita e leitura sao do service_role (as rotas de import ja usam admin).
-- Default-deny para anon/authenticated: o rastro carrega mensagem crua de erro,
-- que pode conter nome de arquivo e de coluna — nao e conteudo de tela.
alter table public.import_pos_diag enable row level security;

commit;

-- ============================================================
-- CONFERENCIA (rodar depois):
--   select criado_em, origem, year, month, houve_falha, falharam, ms_total
--     from import_pos_diag
--    order by criado_em desc limit 10;
--
--   -- o que quebrou, com a mensagem crua:
--   select criado_em, origem, b->>'nome' as bloco, b->>'ms' as ms, b->>'erro' as erro
--     from import_pos_diag, lateral jsonb_array_elements(blocos) b
--    where (b->>'ok')::boolean is false
--    order by criado_em desc;
-- ============================================================
