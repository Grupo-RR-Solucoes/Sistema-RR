import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

import UsuariosList, { type UsuarioRow } from "./UsuariosList";

export const dynamic = "force-dynamic";

/**
 * /admin/usuarios — server component.
 *
 * Gate manual (server-side equivalente ao requireSocioOrFuncionario dos
 * API routes):
 *   - sem sessao -> middleware ja redirecionou para /login antes de chegar aqui
 *   - sessao com role 'promotor' -> redirect para /
 *   - socio: ve todos os usuarios
 *   - funcionario: ve apenas role='promotor' (Disc.14: workflow rolling)
 *
 * Busca lista inicial via service_role (RLS bypass — apropriado pois ja
 * validamos role acima). UsuariosList (client) cuida das mutacoes via API.
 */
export default async function UsuariosPage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  if (
    session.appUser.role !== "socio" &&
    session.appUser.role !== "funcionario"
  ) {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("app_users")
    .select(
      "id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, cpf, venda_propria, active, created_at, created_by"
    )
    .order("created_at", { ascending: false });

  if (session.appUser.role === "funcionario") {
    query = query.eq("role", "promotor");
  }

  const { data, error } = await query;

  const initialUsers = (data ?? []) as UsuarioRow[];
  const loadError = error?.message ?? null;

  // Parte C (delete restrito): só o administrador principal (SUPER_ADMIN_EMAIL,
  // env server-only) pode excluir. Computamos o boolean no server e passamos
  // apenas ele para o client — o e-mail nunca vai para o browser. Se a env
  // estiver vazia, isSuperAdmin é false para todos (fail-safe, igual ao guard
  // do DELETE). A trava real é no servidor; isto é só para o gating do botão.
  const superAdmin = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const operator = (session.appUser.email ?? "").trim().toLowerCase();
  const isSuperAdmin = Boolean(superAdmin) && operator === superAdmin;

  return (
    <UsuariosList
      initialUsers={initialUsers}
      loadError={loadError}
      currentUserId={session.appUser.id}
      currentUserRole={session.appUser.role}
      currentUserEmail={session.appUser.email}
      isSuperAdmin={isSuperAdmin}
    />
  );
}
