-- Migration: Frente Gestão — Fase 1 (2026-07-01)
--
-- Objetivo (F1, apenas roles + rótulo):
--   Adicionar dois roles de gestão — 'supervisor' e 'gerente_regional' — ao
--   RBAC de app_users. Eles têm o MESMO escopo de vínculo que socio/funcionario
--   (cnpj_id IS NULL e promoter_id IS NULL): NÃO são promotores, logam por
--   e-mail. A visão de dados (produção/desempenho) e a hierarquia vêm em fases
--   posteriores (F2 hierarquia, F3 view+RLS, F4 tela do gestor). Esta migration
--   NÃO cria coluna, tabela, view, policy ou helper — só amplia os CHECKs.
--
-- Premissas (schema real verificado):
--   - role vive em public.app_users como TEXT + CHECK inline (nome
--     convencional app_users_role_check), criado em
--     20260511_000001_app_users_auth_role.sql.
--   - app_users_role_scope_check (nome explícito) força:
--       promotor          -> cnpj_id NOT NULL e promoter_id NOT NULL
--       socio|funcionario -> cnpj_id NULL     e promoter_id NULL
--     Sem esta migration, INSERT de role='supervisor'/'gerente_regional'
--     VIOLA os dois CHECKs (nenhum ramo casa) e falha.
--
-- Segurança / idempotência:
--   - PURAMENTE ADITIVA: os novos conjuntos são SUPERSET dos atuais. Toda linha
--     existente (socio/funcionario/promotor) continua válida — zero linhas
--     afetadas, zero UPDATE.
--   - Envolvida em transação. Se algo falhar, ROLLBACK total.
--   - O DROP do role CHECK é robusto (DO block) porque o nome é auto-gerado
--     pelo check inline; remove qualquer CHECK que restrinja SÓ `role` (o scope
--     check é preservado pelo filtro `not ilike '%cnpj_id%'`).

begin;

-- 1) role CHECK: incluir os dois novos roles.
--    DROP robusto de qualquer CHECK sobre `role` que NÃO seja o scope check.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace ns  on ns.oid  = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'app_users'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%role%'
       and pg_get_constraintdef(con.oid) not ilike '%cnpj_id%'
  loop
    execute format('alter table public.app_users drop constraint %I', c.conname);
  end loop;
end$$;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('socio', 'funcionario', 'promotor', 'supervisor', 'gerente_regional'));

-- 2) scope CHECK: os novos roles seguem a MESMA regra de socio/funcionario
--    (cnpj_id IS NULL e promoter_id IS NULL). Recriação obrigatória (não dá
--    para "editar" um CHECK — só drop/add).
alter table public.app_users
  drop constraint if exists app_users_role_scope_check;

alter table public.app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role in ('socio', 'funcionario', 'supervisor', 'gerente_regional')
      and cnpj_id is null and promoter_id is null)
  );

comment on column public.app_users.role is
  'socio: vê tudo; funcionario: operacional (exceto dashboard/fluxo_caixa); '
  'promotor: só dados próprios; supervisor/gerente_regional (F1): gestão de '
  'produção/desempenho, SEM comissão — visão de dados chega na F4.';

commit;

-- Verificação pós-execução (rodar após o commit; ambas devem passar):
--   -- (a) os 5 roles são aceitos pelo novo CHECK:
--   --     insert de teste com role='supervisor', cnpj_id null, promoter_id null NÃO deve falhar.
--   -- (b) linhas existentes seguem válidas:
--   select role, count(*) from public.app_users group by role;
--   -- (c) constraints no lugar:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.app_users'::regclass and contype = 'c';
