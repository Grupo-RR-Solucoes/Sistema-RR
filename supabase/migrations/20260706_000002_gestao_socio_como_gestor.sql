-- Migration: Gestão — permitir SÓCIO como alvo de vínculo de gestão (2026-07-06)
--
-- Objetivo: afrouxar as DUAS triggers da F2 (20260701_000002) para aceitar
-- role='socio' ALÉM dos papéis de gestão já aceitos, nos dois níveis:
--   - promoters.supervisor_user_id : alvo pode ser role IN ('supervisor','socio')
--   - app_users.manager_user_id    : alvo pode ser role IN ('gerente_regional','socio')
--
-- Motivo de negócio: estados sem gerente/supervisor próprio podem ter um sócio
-- (Diego, Renata) como gestor direto, vinculado MANUALMENTE em /admin/equipes.
-- Nada automático. Mudança PURAMENTE ADITIVA: aceita mais roles no alvo, não
-- remove nenhum e não mexe em coluna, índice, FK, RLS ou dado existente.
--
-- O QUE NÃO MUDA (preservado byte-a-byte da 20260701_000002):
--   - anti-auto-referência (um usuário não é gerente de si mesmo);
--   - "só role='supervisor' RECEBE gerente" (new.role <> 'supervisor' segue
--     barrando) — logo um SÓCIO atuando como supervisor de promotor NÃO recebe
--     manager_user_id: ele é topo. Cadeia continua promotor→[supervisor|socio]
--     →[gerente|socio], nunca 3 níveis;
--   - cadeia máx. 2 níveis (o gerente/sócio-gerente raiz não tem gerente acima);
--   - bloqueio cirúrgico de rebaixamento (supervisor/gerente com filhos);
--   - SECURITY DEFINER + set search_path = public; mensagens em português.
--
-- Segurança / idempotência:
--   - Transacional (begin/commit): qualquer falha => ROLLBACK total.
--   - drop trigger/function if exists antes de recriar (ordem: triggers primeiro,
--     depois functions — a trigger depende da function). Rodar 2x é seguro.
--   - APLICAR MANUALMENTE no Supabase Studio (banco não usa migrate automático).

begin;

-- ============================================================
-- 0) Derrubar triggers e funções atuais (trigger antes da função)
-- ============================================================
drop trigger if exists trg_validate_promoter_supervisor on public.promoters;
drop trigger if exists trg_validate_app_user_manager on public.app_users;
drop function if exists public.fn_validate_promoter_supervisor();
drop function if exists public.fn_validate_app_user_manager();

-- ============================================================
-- 1) promoters.supervisor_user_id -> supervisor OU socio
-- ============================================================
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

    -- AFROUXADO: aceita 'supervisor' e 'socio' (antes: só 'supervisor').
    if v_role not in ('supervisor', 'socio') then
      raise exception
        'Vínculo inválido: apenas um usuário com papel supervisor ou socio pode '
        'ser vinculado a um promotor; o usuário indicado tem papel "%".', v_role
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 2) app_users.manager_user_id / role (vínculo + rebaixamento)
-- ============================================================
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
    v_check_manager := (new.manager_user_id is not null);
  else
    v_check_manager := (new.manager_user_id is not null
                        and new.manager_user_id is distinct from old.manager_user_id);

    -- (B) rebaixamento cirúrgico — só quando o papel muda e deixaria órfãos.
    --     PRESERVADO da 20260701_000002 (inalterado).
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
    -- (c) auto-referência — PRESERVADO.
    if new.manager_user_id = new.id then
      raise exception
        'Vínculo inválido: um usuário não pode ser gerente de si mesmo.'
        using errcode = 'check_violation';
    end if;

    -- (a) só supervisor RECEBE gerente — PRESERVADO INTACTO. Isto garante que
    --     um SÓCIO atuando como supervisor NÃO recebe manager (é topo).
    if new.role <> 'supervisor' then
      raise exception
        'Vínculo inválido: apenas um supervisor pode ter gerente_regional; '
        'este usuário tem papel "%".', new.role
        using errcode = 'check_violation';
    end if;

    -- (b) o alvo (gerente) deve existir e ter papel gerente_regional OU socio.
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

    -- AFROUXADO: aceita 'gerente_regional' e 'socio' (antes: só 'gerente_regional').
    if v_manager_role not in ('gerente_regional', 'socio') then
      raise exception
        'Vínculo inválido: apenas um gerente_regional ou socio pode ser gerente '
        'de um supervisor; o usuário indicado tem papel "%".', v_manager_role
        using errcode = 'check_violation';
    end if;

    -- (d) cadeia máx. 2 níveis: o gerente/sócio-gerente (raiz) não tem gerente
    --     acima — PRESERVADO. (a) já impede um gerente/sócio de receber manager,
    --     então isto só dispara diante de dado legado inconsistente.
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

-- ============================================================
-- 3) Religar as triggers (idênticas às da 20260701_000002)
-- ============================================================
create trigger trg_validate_promoter_supervisor
  before insert or update of supervisor_user_id on public.promoters
  for each row execute function public.fn_validate_promoter_supervisor();

create trigger trg_validate_app_user_manager
  before insert or update of manager_user_id, role on public.app_users
  for each row execute function public.fn_validate_app_user_manager();

commit;

-- ============================================================
-- Verificação pós-execução (rodar após o commit)
-- ============================================================
--   -- (a) vincular promotor a um SÓCIO agora PASSA (troque os ids):
--   -- begin;
--   --   update public.promoters
--   --      set supervisor_user_id = '<id-de-um-socio>'
--   --    where id = '<id-de-um-promotor-nao-master>';
--   -- rollback;  -- esperado: OK (sem erro).
--
--   -- (b) vincular promotor a um role errado (ex.: outro promotor/funcionario)
--   --     ainda FALHA:
--   -- begin;
--   --   update public.promoters
--   --      set supervisor_user_id = '<id-de-um-funcionario>'
--   --    where id = '<id-de-um-promotor-nao-master>';
--   -- rollback;  -- esperado: ERROR 'apenas um usuário com papel supervisor ou
--   --            --           socio pode ser vinculado a um promotor...'
--
--   -- (c) vincular supervisor a um SÓCIO como gerente agora PASSA:
--   -- begin;
--   --   update public.app_users
--   --      set manager_user_id = '<id-de-um-socio>'
--   --    where id = '<id-de-um-supervisor>';
--   -- rollback;  -- esperado: OK.
--
--   -- (c2) e a regra do topo continua: um SÓCIO NÃO pode receber gerente
--   --      (new.role <> 'supervisor' barra):
--   -- begin;
--   --   update public.app_users set manager_user_id = '<id-de-um-gerente>'
--   --    where id = '<id-de-um-socio>';
--   -- rollback;  -- esperado: ERROR 'apenas um supervisor pode ter gerente_regional...'
--
--   -- (d) vínculos válidos ANTES continuam válidos DEPOIS — liste os atuais e
--   --     confira que seguem intactos (nenhuma linha é tocada por esta migration):
--   --   -- promotor -> supervisor:
--   --   select p.id, p.name, p.supervisor_user_id
--   --     from public.promoters p
--   --    where p.supervisor_user_id is not null;
--   --   -- supervisor -> gerente:
--   --   select u.id, u.email, u.manager_user_id
--   --     from public.app_users u
--   --    where u.manager_user_id is not null;
