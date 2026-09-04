-- Migration: a RPC que faz `check_audit_v9_tables` MEDIR os indexes  (2026-09-03)
--
-- POR QUE ESTA MIGRATION EXISTE
-- ----------------------------
-- `scripts/check_audit_v9_tables.cjs` promete no cabecalho conferir "7+ indexes
-- nao-PK criados" nas tabelas audit_v9_*. Ele NAO conferia: o PostgREST nao
-- expoe `pg_indexes`, entao o bloco 2 nunca mediu nada. O gate ja tratava isso
-- do jeito certo — REPROVA com exit 4, que e o codigo de "nao mediu", e NAO de
-- "mediu e achou defeito" —, mas o vermelho permanente e um custo: ele nao some
-- sozinho e ensina a ignorar o painel.
--
-- O proprio gate escreve as duas saidas possiveis na sua mensagem de erro:
--   (a) criar esta RPC, e ele passa a medir de verdade;
--   (b) aposentar a assercao E a promessa do cabecalho, no MESMO commit.
-- Esta migration e a saida (a). Escolhida porque a pergunta e legitima: sem os
-- indexes, /auditoria varre 23.879 linhas de audit_v9_avista e 12.612 de
-- audit_v9_prt a cada abertura.
--
-- `security definer` porque `pg_indexes` filtra pelo dono do objeto; `revoke`
-- porque so o service_role (este gate) tem o que fazer com ela. Ela SO LE.
--
-- APLICAR MANUALMENTE no Studio (padrao deste repo). Idempotente.

begin;

create or replace function public.pg_indexes_audit_v9()
returns table (tablename text, indexname text)
language sql
stable
security definer
set search_path = public
as $fn$
  -- SO os nao-PK: e o que o contador `>= 7` do gate espera. Devolver os PKs
  -- junto inflaria a contagem em 4 e o gate passaria com 3 indexes reais.
  select i.tablename::text, i.indexname::text
    from pg_indexes i
   where i.schemaname = 'public'
     and i.tablename like 'audit_v9_%'
     and i.indexname not like '%\_pkey'
   order by i.tablename, i.indexname;
$fn$;

comment on function public.pg_indexes_audit_v9() is
  'SO-LEITURA: indexes NAO-PK das tabelas audit_v9_*. Existe porque o PostgREST '
  'nao expoe pg_indexes e sem ela o bloco de indexes de '
  'scripts/check_audit_v9_tables.cjs nao media nada (o gate reprovava com exit 4, '
  '"nao mediu"). Ver a migration 20260903_000003.';

revoke all on function public.pg_indexes_audit_v9() from public;
revoke all on function public.pg_indexes_audit_v9() from anon;
revoke all on function public.pg_indexes_audit_v9() from authenticated;
grant execute on function public.pg_indexes_audit_v9() to service_role;

commit;

-- O PostgREST guarda um CACHE DE SCHEMA: sem o reload a RPC nao aparece na API e
-- o gate continua dizendo PGRST202 como se a migration nao tivesse rodado.
notify pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA (rodar depois):
--   select * from pg_indexes_audit_v9();
--
--   -- o que o gate espera (7+ nao-PK):
--   --   audit_v9_avista        | audit_v9_avista_mes_status_idx
--   --   audit_v9_avista        | audit_v9_avista_bloco_idx
--   --   audit_v9_avista        | audit_v9_avista_convenio_idx
--   --   audit_v9_enquadramento | audit_v9_enquadramento_regime_idx
--   --   audit_v9_prt           | audit_v9_prt_mes_status_idx
--   --   audit_v9_prt           | audit_v9_prt_bloco_idx
--   --   audit_v9_prt           | audit_v9_prt_convenio_idx
--   --   audit_v9_reconciliacao | audit_v9_reconciliacao_mes_idx
--   --   audit_v9_reconciliacao | audit_v9_reconciliacao_mes_cnpj_key (unique)
--
--   -- e daqui, com a service role:
--   --   node scripts/check_audit_v9_tables.cjs   -> tem de sair do exit 4
--
-- SE A CONTAGEM VIER ABAIXO DE 7, o achado e REAL e nao e desta migration:
-- significa que os indexes prometidos pela migration das audit_v9_* nunca foram
-- criados. Nesse caso o gate reprova com exit 3 (mediu e achou), que e diferente
-- do exit 4 (nao mediu) — e a diferenca entre os dois e o ponto.
-- ============================================================
