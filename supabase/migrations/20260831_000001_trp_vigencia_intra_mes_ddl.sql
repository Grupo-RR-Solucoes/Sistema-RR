-- Migration: TRP — VIGÊNCIA INTRA-MÊS (a TRP39 valendo a partir de 05/08/2026)
-- Fase 2 de 3.  (2026-08-31)
--
-- POR QUE EXISTE. A data de início da TRP39 (05/08/2026) só existe no e-mail da
-- Promotiva. Nunca vai estar no PDF — decisão do Diego (31/08): foi pontual e não
-- será corrigida na origem. A régua padrão da casa (vigenciaDaCompetencia:
-- último dia útil do mês anterior → penúltimo dia útil do mês vigente) não tem
-- como derivá-la, e continua valendo para TODO o resto. Agosto/2026 passa a ter
-- DUAS réguas ativas: TRP38 de 31/07 a 04/08 e TRP39 de 05/08 a 28/08.
--
-- Medido em 31/08/2026 sobre os 579 contratos RR de agosto, pela contract_date:
--   83 até 04/08   (17 atingidos, efeito  -115,28)  <- o DANO da falta de vigência
--  496 de 05/08+  (100 atingidos, efeito -1.397,87) <- legítimo, é a TRP39 valendo
--
-- ORDEM DE DEPLOY — NÃO NEGOCIÁVEL. O código da FASE 1 (commit c984b98,
-- feat/trp-vigencia-intra-mes) TEM de estar em produção ANTES desta migration.
-- Até ele, resolveTrpRegraDb usava .maybeSingle(), que com 2 linhas ativas
-- devolve ERRO -> TrpInfraError, que PROPAGA de propósito. Rodar este SQL antes
-- daquele deploy derruba /promotores, /recebiveis e o motor no primeiro upload
-- partido. Depois desta migration, a Fase 3 (tela/staging/commit com o override).
--
-- NENHUMA RÉGUA SOBE AQUI. Este arquivo é só estrutura.
--
-- ============================================================================
-- A ORDEM DENTRO DO ARQUIVO, E A PERGUNTA QUE ELA RESPONDE
-- ============================================================================
-- "Se o EXCLUDE for validado antes de qualquer coisa, ele reprova ou passa?"
--
-- PASSA. Medido em 31/08/2026 contra as 5 linhas que existem hoje:
--
--   2026-04-01  v1  is_active=true   [2026-03-31 .. 2026-04-29]
--   2026-05-01  v1  is_active=true   [2026-04-30 .. 2026-05-28]
--   2026-06-01  v1  is_active=true   [2026-05-29 .. 2026-06-29]
--   2026-07-01  v1  is_active=FALSE  [2026-06-30 .. 2026-07-30]
--   2026-07-01  v2  is_active=true   [2026-06-30 .. 2026-07-30]
--
--   unique (competencia, valid_from) where is_active : 4 chaves para 4 linhas
--                                                      ativas -> PASSA
--   check  (valid_from <= valid_until)               : 0 linhas violam -> PASSA
--   exclude gist ... where is_active                 : 6 pares ativos
--                                                      comparados, 0 conflitos
--                                                      -> PASSA
--
-- O `WHERE is_active` NÃO é decoração: é ele que salva o par de 2026-07. As duas
-- linhas de julho têm vigência IDÊNTICA e se sobrepõem — CONTRAPROVA medida: sem
-- o filtro parcial, o exclude reprovaria com 1 conflito (v1 x v2). Só não
-- conflitam porque a v1 está INATIVA e, portanto, fora do índice parcial.
--
-- Por isso a ordem: extensão -> check -> índice novo -> exclude -> DROP do
-- índice antigo. O índice antigo sai POR ÚLTIMO, quando as três guardas novas já
-- estão de pé. Em nenhum instante desta transação a tabela que decide toda a
-- comissão fica sem proteção contra régua ativa duplicada.
--
-- Segurança/idempotência: transacional; create ... if not exists; DO blocks
-- checando pg_constraint (ALTER TABLE ADD CONSTRAINT não aceita IF NOT EXISTS).
-- Rodar 2x é seguro.

begin;

-- ============================================================
-- 1) btree_gist — o operador `=` de DATE sob GiST
-- ============================================================
-- MEDIDO no Studio pelo Diego (31/08/2026):
--   name=btree_gist | default_version=1.7 | installed_version=NULL
--   -> disponível, não instalada.
--
-- O `daterange ... with &&` usa o opclass de range do pg_catalog. Quem precisa
-- da extensão é o `competencia with =`: GiST não sabe comparar DATE por
-- igualdade sem o gist_date_ops do btree_gist.
--
-- Instala no schema `extensions` (convenção Supabase) quando ele existir, senão
-- no default. Sem adivinhar qual é o caso.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'btree_gist') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension btree_gist with schema extensions';
    else
      execute 'create extension btree_gist';
    end if;
  end if;
end $$;

-- O opclass tem de estar no search_path na hora de CRIAR o exclude (depois não:
-- o índice guarda o OID). SET LOCAL reverte no commit. Um schema inexistente no
-- search_path é ignorado pelo Postgres, então isto é seguro nos dois casos.
set local search_path = public, extensions;

-- ============================================================
-- 2) CHECK — vigência não pode ser invertida
-- ============================================================
-- Vale para TODAS as linhas, ativas ou não: uma linha histórica com valid_from >
-- valid_until seria lixo mesmo desativada.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'trp_rule_versions'::regclass
       and conname  = 'ck_trp_vigencia_ordenada'
  ) then
    alter table trp_rule_versions
      add constraint ck_trp_vigencia_ordenada check (valid_from <= valid_until);
  end if;
end $$;

-- ============================================================
-- 3) UNIQUE (competencia, valid_from) WHERE is_active
-- ============================================================
-- É O ÍNDICE QUE PRESERVA O COMPORTAMENTO "RE-UPLOAD SUBSTITUI".
--
-- Sem override, o valid_from de uma competência é SEMPRE o mesmo (derivado por
-- vigenciaDaCompetencia). Logo, subir a mesma competência duas vezes colide
-- nesta chave — exatamente como colidia no índice antigo. O que ele passa a
-- PERMITIR é só o caso novo: duas ativas na mesma competência com INÍCIOS
-- DIFERENTES (agosto: 31/07 e 05/08).
--
-- Ele NÃO proíbe sobreposição sozinho — isso é o (4).
create unique index if not exists uq_trp_rule_versions_active_from
  on trp_rule_versions (competencia, valid_from)
  where is_active;

-- ============================================================
-- 4) EXCLUDE — não-sobreposição imposta pelo BANCO
-- ============================================================
-- A garantia que o RPC sozinho não dá. Duas réguas ATIVAS da MESMA competência
-- não podem ter vigências que se cruzem. daterange(..., '[]') = inclusivo nos
-- dois extremos, igual à comparação do resolvedor (escolherFatia usa
-- `data >= rowValidFrom && data <= rowValidUntil`).
--
-- NÃO É DEFERRABLE, de propósito: obriga o RPC a TRUNCAR a fatia anterior ANTES
-- de inserir a nova. A ordem inversa (inserir e depois truncar) passa por um
-- estado sobreposto e é recusada na hora — o que é a proteção, não um estorvo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'trp_rule_versions'::regclass
       and conname  = 'ex_trp_vigencia_sem_overlap'
  ) then
    alter table trp_rule_versions
      add constraint ex_trp_vigencia_sem_overlap
      exclude using gist (
        competencia with =,
        daterange(valid_from, valid_until, '[]') with &&
      ) where (is_active);
  end if;
end $$;

-- ============================================================
-- 5) DROP do índice antigo — POR ÚLTIMO
-- ============================================================
-- uq_trp_rule_versions_active (competencia) where is_active é o que impede a
-- vigência intra-mês. Sai só agora, com (3) e (4) já de pé.
drop index if exists uq_trp_rule_versions_active;

comment on index uq_trp_rule_versions_active_from is
  'Vigência intra-mês (31/08/2026): 1 régua ATIVA por (competência, valid_from). '
  'Substituiu uq_trp_rule_versions_active, que era por (competência) e impedia '
  'agosto/2026 ter TRP38 até 04/08 e TRP39 de 05/08. Sem override o valid_from é '
  'derivado e constante, então o re-upload da mesma competência continua COLIDINDO '
  'aqui = continua SUBSTITUINDO. A não-sobreposição é do ex_trp_vigencia_sem_overlap.';

-- ============================================================
-- 6) trp_rule_uploads.valid_from_override — o dado que vem de FORA do PDF
-- ============================================================
-- MEDIDO em 31/08/2026: a coluna NÃO existe (42703).
--
-- NULL = sem override = a vigência é a derivada (o caso de 100% das réguas até
-- hoje). Preenchida SÓ quando a fonte externa (o e-mail) declara data que o PDF
-- não traz. Fica no STAGING porque é ali que o servidor guarda o que ele pode
-- confiar: /api/trp/commit no fluxo delegado lê o rascunho do banco, não do
-- client (invariante de app/api/trp/commit/route.ts).
alter table trp_rule_uploads
  add column if not exists valid_from_override date;

comment on column trp_rule_uploads.valid_from_override is
  'Vigência intra-mês (Fase 3): início de vigência informado por FORA do PDF '
  '(e-mail da Promotiva). NULL = sem override, vale a régua padrão '
  '(vigenciaDaCompetencia). Quando preenchida, o commit PARTE a competência: a '
  'fatia anterior é truncada em valid_from_override - 1 e continua ATIVA. Só o '
  'sócio confirma. Validada contra a janela da competência antes de gravar.';

-- ============================================================
-- 7) promoter_monthly_results.trp_multi_versao — o carimbo honesto
-- ============================================================
-- DECISÃO DO DIEGO (31/08/2026), e a razão dela:
--
-- Numa competência PARTIDA não existe "a versão da TRP que produziu esta linha"
-- — são duas. Carimbar a última (é o que sairia hoje: os dois sítios que gravam
-- resolvem a versão por `${comp}-15`, dia 15, que em agosto cai na TRP39) seria
-- gravar afirmação FALSA para os 83 contratos de 03-04/08. Falsa de um jeito que
-- CONFERE — pior que vazia, porque nada acusaria.
--
-- Então: trp_version_id = NULL (diz "não cabe em um id", que é a verdade) e
-- trp_multi_versao = true (impede que esse NULL seja lido como "esqueceram de
-- carimbar", e dá ao detectTrpStaleAfetadasPorVersao critério para NÃO marcar
-- agosto como stale para sempre).
--
-- MEDIDO em 31/08/2026:
--   trp_version_id e trp_fallback JÁ existem e JÁ aceitam NULL — 387 das 397
--   linhas do PMR estão com trp_version_id NULL hoje. NÃO há DDL a fazer nessa
--   coluna; o que muda é a SEMÂNTICA do NULL, e é isso que o comment registra.
--   trp_multi_versao NÃO existe (42703) -> é a única coluna nova aqui.
--
-- SEM DEFAULT, pelo mesmo motivo da migration do carimbo (20260714_000001):
-- default false seria a mentira "esta competência tem régua única" gravada em
-- todo o histórico. NULL = desconhecido é a única verdade honesta para o que já
-- está no banco.
alter table promoter_monthly_results
  add column if not exists trp_multi_versao boolean;

comment on column promoter_monthly_results.trp_multi_versao is
  'Vigência intra-mês: true = a competência tinha 2+ réguas ATIVAS e a linha foi '
  'produzida por MAIS DE UMA. Nesse caso trp_version_id é NULL de propósito — '
  'carimbar uma só seria afirmação falsa que confere. false = competência de '
  'régua única (trp_version_id vale). NULL = desconhecido (linha calculada antes '
  'desta coluna) — NUNCA significa ok.';

-- Re-declara o significado de trp_version_id: o NULL ganhou um terceiro caso.
comment on column promoter_monthly_results.trp_version_id is
  'Detector Camada 1: versao da TRP (trp_rule_versions) que produziu esta linha. '
  'Gravada so por consolidadores que recalculam pela TRP (source bbts/daily). '
  'NULL tem TRES significados, distinguidos por outras colunas: (1) nao usa TRP '
  '(source fechamento/cms); (2) desconhecido (calculado antes do detector); '
  '(3) NOVO em 31/08/2026 — competencia com VIGENCIA PARTIDA, em que a linha veio '
  'de 2+ reguas e nao cabe em um id: nesse caso trp_multi_versao = true. NUNCA '
  'significa ok. Com fallback em cascata, e o id da versao FORNECEDORA.';

commit;

-- ============================================================================
-- VERIFICACAO — rodar depois, e colar a saida.
-- ============================================================================
-- (a) a extensao entrou:
--   select extname, extversion, n.nspname as schema
--     from pg_extension e join pg_namespace n on n.oid = e.extnamespace
--    where extname = 'btree_gist';
--   -- esperado: 1 linha, extversion 1.7
--
-- (b) as guardas novas existem e estao VALIDADAS, e a antiga SUMIU:
--   select conname, contype, convalidated
--     from pg_constraint
--    where conrelid = 'trp_rule_versions'::regclass
--      and conname in ('ck_trp_vigencia_ordenada','ex_trp_vigencia_sem_overlap')
--    order by conname;
--   -- esperado: 2 linhas, convalidated = true nas duas
--   --   ck_trp_vigencia_ordenada      c  (check)
--   --   ex_trp_vigencia_sem_overlap   x  (exclusion)
--
--   select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'trp_rule_versions'
--    order by indexname;
--   -- esperado CONTER: uq_trp_rule_versions_active_from
--   -- esperado NAO CONTER: uq_trp_rule_versions_active   <- o antigo saiu
--
-- (c) as 5 linhas continuam la, intactas (esta migration NAO toca dado):
--   select competencia, version_no, is_active, valid_from, valid_until
--     from trp_rule_versions order by competencia, version_no;
--   -- esperado, EXATAMENTE o que foi medido em 31/08 ANTES de rodar:
--   --   2026-04-01  1  t  2026-03-31  2026-04-29
--   --   2026-05-01  1  t  2026-04-30  2026-05-28
--   --   2026-06-01  1  t  2026-05-29  2026-06-29
--   --   2026-07-01  1  f  2026-06-30  2026-07-30   <- INATIVA (e por isso passa)
--   --   2026-07-01  2  t  2026-06-30  2026-07-30
--
-- (d) as colunas novas:
--   select table_name, column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where (table_name = 'trp_rule_uploads'        and column_name = 'valid_from_override')
--       or (table_name = 'promoter_monthly_results' and column_name in ('trp_multi_versao','trp_version_id'))
--    order by table_name, column_name;
--   -- esperado: 3 linhas, is_nullable = YES nas tres, column_default NULL nas tres
--
-- (e) PROVA FUNCIONAL do que passou a ser PERMITIDO e do que segue PROIBIDO.
--     Rodar INTEIRO dentro de begin/rollback — nao deixa nada no banco.
--
--   begin;
--     -- (e1) DEVE PASSAR: duas ativas na mesma competencia, sem sobrepor.
--     insert into trp_rule_versions
--       (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--     values
--       ('2026-08-01','VOLUME_5_FAIXAS','2026-07-31','2026-08-04',1,true,'{"t":38}'::jsonb),
--       ('2026-08-01','VOLUME_5_FAIXAS','2026-08-05','2026-08-28',2,true,'{"t":39}'::jsonb);
--     -- esperado: INSERT 0 2   <- e o caso da TRP38/TRP39
--
--     -- (e2) DEVE FALHAR: sobreposicao (a 3a comeca dentro da 2a).
--     insert into trp_rule_versions
--       (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--     values ('2026-08-01','VOLUME_5_FAIXAS','2026-08-20','2026-08-28',3,true,'{"t":40}'::jsonb);
--     -- esperado: ERROR ... violates exclusion constraint "ex_trp_vigencia_sem_overlap"
--   rollback;
--
--   begin;
--     -- (e3) DEVE FALHAR: mesmo valid_from = e o re-upload, que tem de SUBSTITUIR
--     --      e nao duplicar. E o teste de que nao perdemos a garantia antiga.
--     insert into trp_rule_versions
--       (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--     values ('2026-06-01','VOLUME_5_FAIXAS','2026-05-29','2026-06-29',2,true,'{"t":"dup"}'::jsonb);
--     -- esperado: ERROR ... duplicate key ... "uq_trp_rule_versions_active_from"
--     --   (ou o exclusion constraint — os dois recusam; qualquer um serve)
--   rollback;
--
--   begin;
--     -- (e4) DEVE PASSAR: a mesma vigencia com is_active = FALSE nao conflita.
--     --      E o par de 2026-07 que ja esta no banco.
--     insert into trp_rule_versions
--       (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--     values ('2026-06-01','VOLUME_5_FAIXAS','2026-05-29','2026-06-29',3,false,'{"t":"hist"}'::jsonb);
--     -- esperado: INSERT 0 1
--   rollback;
--
--   begin;
--     -- (e5) DEVE FALHAR: vigencia invertida.
--     insert into trp_rule_versions
--       (competencia, regime, valid_from, valid_until, version_no, is_active, regra_json)
--     values ('2026-09-01','VOLUME_5_FAIXAS','2026-09-30','2026-09-01',1,true,'{}'::jsonb);
--     -- esperado: ERROR ... violates check constraint "ck_trp_vigencia_ordenada"
--   rollback;
--
--   -- conferencia final: nada sobrou dos rollbacks
--   select count(*) as total from trp_rule_versions;   -- esperado: 5
-- ============================================================================
