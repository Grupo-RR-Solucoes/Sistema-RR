-- Migration: Frente Gestão — Fase 2 (2026-07-01)
--
-- Objetivo (F2, hierarquia): materializar as duas arestas da árvore de gestão
-- adicionando 2 FKs auto/cruzadas + 2 índices parciais + 2 triggers de
-- integridade de papel. NENHUMA view, helper de RLS ou policy nesta fase (F3);
-- nenhuma tela de visão do gestor (F4).
--
--   aresta 1  promotor  -> supervisor   : promoters.supervisor_user_id
--   aresta 2  supervisor -> gerente_reg. : app_users.manager_user_id (self-ref)
--
-- A cadeia tem no MÁXIMO 2 níveis: gerente_regional (raiz) -> supervisor ->
-- promotor. Gerente é a raiz e NÃO tem manager_user_id.
--
-- Premissas (schema real verificado):
--   - app_users.id uuid PK; role text (F1 já aceita 'supervisor' e
--     'gerente_regional' — migration 20260701_000001, aplicada em produção).
--   - promoters.id uuid PK; possui is_master boolean (20260517_000001).
--   - Roles de gestão têm cnpj_id/promoter_id NULL (escopo F1).
--
-- Por que triggers, se já há FK?
--   A FK garante que o alvo EXISTE em app_users, não que ele tem o PAPEL certo.
--   supervisor_user_id precisa apontar para um role='supervisor'; manager_user_id
--   para um role='gerente_regional'. Isso é regra de domínio → trigger.
--
-- Segurança / idempotência:
--   - PURAMENTE ADITIVA: colunas nascem NULL; nenhuma linha existente afetada.
--   - Transacional (begin/commit): qualquer falha => ROLLBACK total.
--   - Idempotente onde a linguagem permite: add column if not exists, create
--     index if not exists, create or replace function, drop trigger if exists
--     antes de create. Rodar duas vezes é seguro (mas desnecessário).
--   - Funções de trigger: SECURITY DEFINER + set search_path = public (mesmo
--     padrão dos helpers Dia 3): a validação lê app_users sem depender da RLS
--     do chamador e fica blindada contra hijack de search_path.

begin;

-- ============================================================
-- 1) Colunas (arestas)
-- ============================================================

-- aresta supervisor -> gerente (self-referencial). ON DELETE SET NULL:
-- deletar o gerente solta os supervisores dele (manager_user_id -> NULL).
alter table public.app_users
  add column if not exists manager_user_id uuid
  references public.app_users(id) on delete set null;

-- aresta promotor -> supervisor. ON DELETE SET NULL: deletar o supervisor
-- solta os promotores dele (supervisor_user_id -> NULL).
alter table public.promoters
  add column if not exists supervisor_user_id uuid
  references public.app_users(id) on delete set null;

comment on column public.app_users.manager_user_id is
  'F2 hierarquia: gerente_regional deste supervisor (aresta supervisor->gerente). '
  'NULL para não-supervisores e para o próprio gerente (raiz). Integridade de '
  'papel/nível garantida pela trigger trg_validate_app_user_manager.';
comment on column public.promoters.supervisor_user_id is
  'F2 hierarquia: supervisor (app_users.role=supervisor) responsável por este '
  'promotor. NULL = sem supervisor. Integridade de papel garantida pela trigger '
  'trg_validate_promoter_supervisor.';

-- ============================================================
-- 2) Índices parciais (só linhas vinculadas ocupam o índice)
-- ============================================================
create index if not exists idx_app_users_manager
  on public.app_users (manager_user_id)
  where manager_user_id is not null;

create index if not exists idx_promoters_supervisor
  on public.promoters (supervisor_user_id)
  where supervisor_user_id is not null;

-- ============================================================
-- 3) Triggers de integridade de papel/nível
-- ============================================================

-- 3a) promoters.supervisor_user_id -> deve apontar para um supervisor.
create or replace function public.fn_validate_promoter_supervisor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.supervisor_user_id is not null then
    select role into v_role
      from public.app_users
     where id = new.supervisor_user_id;

    if v_role is null then
      raise exception
        'Vínculo inválido: supervisor_user_id % não existe em app_users.',
        new.supervisor_user_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_role <> 'supervisor' then
      raise exception
        'Vínculo inválido: apenas um usuário com papel supervisor pode ser '
        'vinculado a um promotor; o usuário indicado tem papel "%".', v_role
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- 3b) app_users.manager_user_id / role. Duas responsabilidades:
--
--   A) VALIDAÇÃO DO VÍNCULO manager (roda em INSERT, ou em UPDATE quando
--      manager_user_id de fato muda):
--        (a) só supervisor tem gerente; (b) alvo é gerente_regional;
--        (c) sem auto-referência; (d) cadeia máx. 2 níveis (gerente é raiz e
--            não tem gerente acima) — o que também impede ciclos.
--      Gate por "manager_user_id mudou" para NÃO reprovar uma mudança de role
--      que preserve um manager já existente (ex.: rebaixar supervisor com
--      gerente mas sem promotores — deve passar, é o caso B abaixo).
--
--   B) BLOQUEIO CIRÚRGICO DE REBAIXAMENTO (só em UPDATE, só quando role muda,
--      só se deixaria vínculo órfão):
--        - supervisor -> outro papel COM promotores vinculados => bloqueia;
--        - gerente_regional -> outro papel COM supervisores vinculados => bloqueia.
--      Rebaixar SEM filhos vinculados passa normalmente. Regra estritamente
--      restrita a esses dois casos.
--
--   NÃO interfere no ON DELETE SET NULL: deletar o gestor não dispara este
--   trigger (só INSERT/UPDATE); a cascata que zera os filhos (manager_user_id/
--   supervisor_user_id -> NULL) passa, pois o novo valor é NULL.
create or replace function public.fn_validate_app_user_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check_manager   boolean := false;
  v_manager_role    text;
  v_manager_manager uuid;
begin
  if tg_op = 'INSERT' then
    -- Sem OLD em INSERT: valida o vínculo sempre que houver manager.
    v_check_manager := (new.manager_user_id is not null);
  else
    -- UPDATE: só revalida o vínculo se manager_user_id REALMENTE mudou.
    v_check_manager := (new.manager_user_id is not null
                        and new.manager_user_id is distinct from old.manager_user_id);

    -- (B) rebaixamento cirúrgico — só quando o papel muda e deixaria órfãos.
    if new.role is distinct from old.role then
      if old.role = 'supervisor' and new.role <> 'supervisor'
         and exists (select 1 from public.promoters
                      where supervisor_user_id = new.id) then
        raise exception
          'Não é possível alterar o papel: existem promotores vinculados a este '
          'supervisor. Desvincule-os em /admin/equipes primeiro.'
          using errcode = 'check_violation';
      elsif old.role = 'gerente_regional' and new.role <> 'gerente_regional'
         and exists (select 1 from public.app_users
                      where manager_user_id = new.id) then
        raise exception
          'Não é possível alterar o papel: existem supervisores vinculados a este '
          'gerente. Desvincule-os em /admin/equipes primeiro.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- (A) validação do vínculo manager (gate calculado acima).
  if v_check_manager then
    -- (c) auto-referência
    if new.manager_user_id = new.id then
      raise exception
        'Vínculo inválido: um usuário não pode ser gerente de si mesmo.'
        using errcode = 'check_violation';
    end if;

    -- (a) só supervisor tem gerente
    if new.role <> 'supervisor' then
      raise exception
        'Vínculo inválido: apenas um supervisor pode ter gerente_regional; '
        'este usuário tem papel "%".', new.role
        using errcode = 'check_violation';
    end if;

    -- (b) o alvo deve ser gerente_regional
    select role, manager_user_id
      into v_manager_role, v_manager_manager
      from public.app_users
     where id = new.manager_user_id;

    if v_manager_role is null then
      raise exception
        'Vínculo inválido: manager_user_id % não existe em app_users.',
        new.manager_user_id
        using errcode = 'foreign_key_violation';
    end if;

    if v_manager_role <> 'gerente_regional' then
      raise exception
        'Vínculo inválido: apenas um gerente_regional pode ser gerente de um '
        'supervisor; o usuário indicado tem papel "%".', v_manager_role
        using errcode = 'check_violation';
    end if;

    -- (d) cadeia máx. 2 níveis: o gerente (raiz) não pode ter gerente acima.
    --     Defensivo: (a) já impede um gerente de receber manager, então isto
    --     só dispara diante de dado legado inconsistente.
    if v_manager_manager is not null then
      raise exception
        'Vínculo inválido: o gerente indicado já possui um gerente acima; a '
        'hierarquia tem no máximo 2 níveis (gerente -> supervisor).'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- Ligação das triggers (drop-if-exists antes de create => idempotente).
-- promoters: só reavalia quando supervisor_user_id muda (ou em INSERT).
drop trigger if exists trg_validate_promoter_supervisor on public.promoters;
create trigger trg_validate_promoter_supervisor
  before insert or update of supervisor_user_id on public.promoters
  for each row execute function public.fn_validate_promoter_supervisor();

-- app_users: reavalia em INSERT e em UPDATE de manager_user_id OU role. A
-- função distingue os dois casos internamente (ver 3b): valida o vínculo só
-- quando manager_user_id muda; barra rebaixamento só quando role muda E há
-- filhos vinculados. Rebaixar sem filhos, ou editar outros campos, passa.
drop trigger if exists trg_validate_app_user_manager on public.app_users;
create trigger trg_validate_app_user_manager
  before insert or update of manager_user_id, role on public.app_users
  for each row execute function public.fn_validate_app_user_manager();

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit — todas devem passar)
-- ============================================================
--   -- (a) as 2 colunas novas existem:
--   select table_name, column_name, data_type, is_nullable
--     from information_schema.columns
--    where (table_name = 'app_users'  and column_name = 'manager_user_id')
--       or (table_name = 'promoters'  and column_name = 'supervisor_user_id');
--
--   -- (b) os 2 índices parciais existem:
--   select indexname, tablename, indexdef
--     from pg_indexes
--    where indexname in ('idx_app_users_manager', 'idx_promoters_supervisor');
--
--   -- (c) as 2 triggers existem:
--   select tgname, relname
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where tgname in ('trg_validate_promoter_supervisor',
--                     'trg_validate_app_user_manager');
--
--   -- (d) PROVA da trigger — apontar supervisor_user_id para um NÃO-supervisor
--   --     deve FALHAR (troque o id por um app_users.id role<>'supervisor'):
--   -- begin;
--   --   update public.promoters
--   --      set supervisor_user_id = '<id-de-um-socio-ou-funcionario>'
--   --    where id = (select id from public.promoters where is_master = false limit 1);
--   -- rollback;  -- esperado: ERROR 'Vínculo inválido: apenas um usuário com
--   --            --           papel supervisor pode ser vinculado a um promotor...'
--
--   -- (e) PROVA do bloqueio de rebaixamento: um supervisor COM promotores não
--   --     pode ser rebaixado (deve FALHAR); SEM promotores, passa. Ex.:
--   -- begin;
--   --   update public.app_users set role = 'funcionario'
--   --    where id = '<id-de-um-supervisor-que-tem-promotores>';
--   -- rollback;  -- esperado: ERROR 'Não é possível alterar o papel: existem
--   --            --           promotores vinculados a este supervisor...'
