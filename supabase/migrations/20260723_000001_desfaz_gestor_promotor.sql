-- FRENTE DE PRODUTO — VENDA PROPRIA DE GESTAO (1/3): DESFAZ o vinculo
-- "gestor tambem e promotor".
--
-- CORRECAO CONCEITUAL (Diego, 21/07): o gestor de consorcio NAO e promotor. Ele e SO
-- gestor. Na planilha manual PRODUCAO_GERAL_CONSORCIO o nome dele aparecia na coluna
-- PROMOTOR(A) apenas para identificar de quem era a proposta — nao porque ele fosse
-- promotor. O que ele recebeu foi uma VENDA PROPRIA de gestor.
--
-- Logo, app_users.promoter_id para gestor_consorcio (20260722_000002, item 2) estava
-- CONCEITUALMENTE ERRADO. A venda propria passa a viver na estrutura de gestao
-- (20260723_000002), keyed por app_user_id — nunca por promoter_id.
--
-- ESTADO REAL DO BANCO (confirmado pelo Diego, 22/07): ja rodaram no Studio, nesta
-- ordem, 20260721_000001..000004, depois 20260722_000001, depois 20260722_000002.
-- Ou seja:
--   - public.consorcio_gestor NAO existe mais (drop cascade na 20260722_000002) e a
--     coluna promoter_id dela sumiu junto -> NADA a desfazer ali;
--   - o que resta desfazer e SO o app_users.promoter_id do gestor + o scope CHECK que
--     o permitia.
--   - o indice app_users_um_gestor_consorcio_ativo FICA (decisao do Diego): 1 gestor
--     de consorcio ativo por vez. Esta migration nao o toca.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

begin;

-- 1) Zera o vinculo ANTES de recriar o CHECK. Sem isto, se algum gestor ja tiver sido
--    vinculado a um promotor pela tela de ontem, o ADD CONSTRAINT falharia (e a
--    transacao inteira faria rollback). Idempotente: sem gestor vinculado, 0 linhas.
update public.app_users
   set promoter_id = null
 where role = 'gestor_consorcio'
   and promoter_id is not null;

-- 2) scope CHECK volta ao formato de 20260721_000003: gestor_consorcio segue a MESMA
--    regra de socio/funcionario/supervisor/gerente_regional (cnpj_id IS NULL e
--    promoter_id IS NULL). Nenhum papel de gestao precisa de promoter_id — a venda
--    propria dos TRES papeis vive fora do PMR, em gestao_venda_propria.
alter table public.app_users
  drop constraint if exists app_users_role_scope_check;

alter table public.app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role in ('socio', 'funcionario', 'supervisor', 'gerente_regional', 'gestor_consorcio')
      and cnpj_id is null and promoter_id is null)
  );

commit;

-- Verificacao pos-execucao:
--   -- (a) nenhum gestor com promoter_id:
--   select count(*) from public.app_users
--    where role = 'gestor_consorcio' and promoter_id is not null;   -- esperado: 0
--   -- (b) o CHECK rejeita o vinculo (deve dar ERRO de constraint):
--   --   update app_users set promoter_id = '<qualquer promoters.id>'
--   --    where role = 'gestor_consorcio';
--   -- (c) a trava de 1 gestor ativo continua de pe:
--   select indexname from pg_indexes
--    where tablename = 'app_users' and indexname = 'app_users_um_gestor_consorcio_ativo';
