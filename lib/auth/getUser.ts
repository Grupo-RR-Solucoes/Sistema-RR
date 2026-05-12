import type { AppUserWithRole, AuthSession, UserRole } from "./types";
import { createSupabaseServerClient } from "./supabaseServerClient";

/**
 * Retorna a sessão autenticada do usuário corrente, juntando auth.users com
 * a linha correspondente em public.app_users via auth_user_id.
 *
 * Retorna null se:
 *   - não há sessão Supabase Auth ativa (não logado)
 *   - há sessão mas nenhuma linha em app_users vinculada (usuário não
 *     provisionado pela aplicação)
 *   - a linha em app_users tem active=false (usuário desativado)
 *
 * Não lança — quem chama deve tratar `null` (redirect/403).
 */
export async function getCurrentUser(): Promise<AuthSession | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !authUser) return null;

  const { data: appUserRow, error: appUserError } = await supabase
    .from("app_users")
    .select("id, email, full_name, role, cnpj_id, promoter_id, active")
    .eq("auth_user_id", authUser.id)
    .single();

  if (appUserError || !appUserRow) return null;
  if (!appUserRow.active) return null;

  const appUser: AppUserWithRole = {
    id: appUserRow.id,
    email: appUserRow.email,
    fullName: appUserRow.full_name,
    role: appUserRow.role as UserRole,
    cnpjId: appUserRow.cnpj_id,
    promoterId: appUserRow.promoter_id,
    active: appUserRow.active,
  };

  return {
    authUserId: authUser.id,
    email: authUser.email ?? appUser.email,
    appUser,
  };
}
