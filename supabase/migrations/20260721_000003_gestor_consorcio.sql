-- FRENTE DE PRODUTO — Movimento 2b: GESTOR de consorcio (cadastro + payout).
--
-- O gestor de consorcio e UNICO no grupo, recebe 10% de TODO o consorcio de TODAS
-- as empresas e NAO e promotor. A PMR nao serve (promoter_id NOT NULL FK promoters).
-- Entao:
--   1) role 'gestor_consorcio' em app_users (ele loga por e-mail; cnpj_id/promoter_id
--      nulos, igual socio/funcionario). Espelho aditivo de 20260701_000001.
--   2) consorcio_gestor: quem e o gestor vigente por competencia.
--   3) consorcio_gestor_payout: o pagamento dos 10%, SEPARADO da PMR. Calculado no
--      reconsolidar, gravado AQUI, nunca na PMR. A tela do gestor le SO este payout
--      por RLS do seu user_id (jamais a comissao dos promotores).
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).
-- Envolvida em transacao no trecho dos CHECKs de app_users (rollback total se falhar).

begin;

-- 1) role CHECK: incluir 'gestor_consorcio'. DROP robusto de qualquer CHECK sobre
--    `role` que NAO seja o scope check (nome auto-gerado pelo check inline).
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
  check (role in ('socio', 'funcionario', 'promotor', 'supervisor', 'gerente_regional', 'gestor_consorcio'));

-- 2) scope CHECK: gestor_consorcio segue a MESMA regra de socio/funcionario
--    (cnpj_id IS NULL e promoter_id IS NULL). Recriacao obrigatoria (drop/add).
alter table public.app_users
  drop constraint if exists app_users_role_scope_check;

alter table public.app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role in ('socio', 'funcionario', 'supervisor', 'gerente_regional', 'gestor_consorcio')
      and cnpj_id is null and promoter_id is null)
  );

commit;

-- 3) Cadastro do gestor vigente por competencia. Normalmente 1 linha por
--    competencia (o grupo tem 1 gestor); permite trocar o gestor no futuro sem
--    reescrever historico.
create table if not exists public.consorcio_gestor (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  competencia text not null,                  -- YYYY-MM
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (competencia)
);

create index if not exists consorcio_gestor_user_idx
  on public.consorcio_gestor (app_user_id);

-- 4) Payout dos 10% — SEPARADO da PMR. Uma linha por (competencia, company_id):
--    base = Sigma comissao-empresa consorcio da empresa/mes; gestor_10 = base * 0,10.
--    A tela do gestor SOMA suas linhas; nunca ve comissao de promotor.
create table if not exists public.consorcio_gestor_payout (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,                  -- YYYY-MM
  company_id  uuid references public.companies(id),
  gestor_user_id uuid references public.app_users(id) on delete set null,
  base_comissao_empresa numeric(18,2) not null default 0, -- Sigma comissao-empresa consorcio
  gestor_10 numeric(18,2) not null default 0,             -- base * 0,10
  status text not null default 'ABERTO' check (status in ('ABERTO', 'FECHADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- idempotencia: recomputar nao paga o gestor 2x
  unique (competencia, company_id)
);

create index if not exists consorcio_gestor_payout_comp_idx
  on public.consorcio_gestor_payout (competencia);
create index if not exists consorcio_gestor_payout_gestor_idx
  on public.consorcio_gestor_payout (gestor_user_id);

-- RLS — socio gerencia tudo; o gestor le SO as linhas do payout onde ele e o
-- gestor_user_id (nunca a comissao dos promotores, que vive na PMR/outra tabela).
alter table public.consorcio_gestor enable row level security;
grant select, insert, update, delete on public.consorcio_gestor to authenticated;
drop policy if exists "consorcio_gestor_socio_all" on public.consorcio_gestor;
create policy "consorcio_gestor_socio_all" on public.consorcio_gestor for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');
-- gestor le SO o proprio cadastro. Sem helper de "meu app_user id"; usa o subselect
-- canonico (auth_user_id = auth.uid()), o mesmo de current_app_user_role/gestor_targets.
drop policy if exists "consorcio_gestor_self_select" on public.consorcio_gestor;
create policy "consorcio_gestor_self_select" on public.consorcio_gestor for select to authenticated
using (app_user_id = (select id from public.app_users where auth_user_id = auth.uid()));

alter table public.consorcio_gestor_payout enable row level security;
grant select, insert, update, delete on public.consorcio_gestor_payout to authenticated;
drop policy if exists "consorcio_gestor_payout_socio_all" on public.consorcio_gestor_payout;
create policy "consorcio_gestor_payout_socio_all" on public.consorcio_gestor_payout for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');
drop policy if exists "consorcio_gestor_payout_gestor_select" on public.consorcio_gestor_payout;
create policy "consorcio_gestor_payout_gestor_select" on public.consorcio_gestor_payout for select to authenticated
using (
  public.current_app_user_role() = 'gestor_consorcio'
  and gestor_user_id = (select id from public.app_users where auth_user_id = auth.uid())
);
