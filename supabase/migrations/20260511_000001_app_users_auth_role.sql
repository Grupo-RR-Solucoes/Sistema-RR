-- Fase: Setup Auth Sistema RR — Dia 1 (2026-05-11)
--
-- Estende app_users para suportar Supabase Auth + RBAC com 3 perfis
-- (socio, funcionario, promotor) e escopo por CNPJ.
--
-- Premissas validadas em Etapa 1 (inventário READ-ONLY):
--   - app_users existe com schema básico (id, email, full_name,
--     access_profile_id, active, created_at) e 0 rows.
--   - access_profiles permanece intacta (2 rows: "Visao Geral" / "Visao Parcial").
--   - companies tem 4 rows (4 CNPJs do Grupo RR) — placeholders TEMP-MCI-COBAN
--     serão substituídos por CNPJs reais antes do bootstrap de promotores.
--   - promoters tem 40 rows, sem coluna email.
--   - auth.users tem 0 rows (bootstrap manual dos 2 sócios virá depois).
--
-- Decisões registradas:
--   - role: TEXT CHECK (não enum) — facilita migrations futuras.
--   - access_profile_id legado permanece nullable; não removido nesta migration.
--   - created_by nullable: bootstrap dos 2 sócios fica sem rastro de criador
--     (origem manual). Toda criação subsequente pela UI deverá popular.
--   - ON DELETE CASCADE em auth_user_id: deletar conta no Supabase Auth
--     remove row em app_users. Histórico fica em audit_logs (futuro trigger).

alter table app_users
  add column auth_user_id uuid unique references auth.users(id) on delete cascade,
  add column role text not null check (role in ('socio', 'funcionario', 'promotor')),
  add column cnpj_id uuid references companies(id),
  add column promoter_id uuid references promoters(id),
  add column created_by uuid references app_users(id);

alter table app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role in ('socio', 'funcionario') and cnpj_id is null and promoter_id is null)
  );

-- Nota: NÃO criar índice em auth_user_id — UNIQUE inline acima já cria índice
-- único automaticamente, que serve para o lookup de login.
create index idx_app_users_role on app_users(role);
create index idx_app_users_promoter_id on app_users(promoter_id) where promoter_id is not null;

comment on column app_users.auth_user_id is
  'FK para auth.users do Supabase Auth. NULL transitório se row criada antes do auth (não recomendado).';
comment on column app_users.role is
  'socio: vê tudo; funcionario: vê tudo exceto dashboard/fluxo_caixa; promotor: vê apenas dados próprios.';
comment on column app_users.cnpj_id is
  'NULL para socio/funcionario (veem 4 CNPJs). Obrigatório para promotor.';
comment on column app_users.promoter_id is
  'NULL para socio/funcionario. Obrigatório para promotor (linka com entidade promoter).';
comment on column app_users.created_by is
  'Auditoria: id do usuário que criou esta linha. NULL para bootstrap manual dos 2 sócios.';
