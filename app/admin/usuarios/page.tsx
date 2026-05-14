import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

import UsuariosList, { type UsuarioRow } from "./UsuariosList";

export const dynamic = "force-dynamic";

/**
 * /admin/usuarios — server component.
 *
 * Gate manual (server-side equivalente ao requireSocio dos API routes):
 *   - sem sessao -> middleware ja redirecionou para /login antes de chegar aqui
 *   - sessao com role !== 'socio' -> redirect para /
 *
 * Busca lista inicial via service_role (RLS bypass — apropriado pois ja
 * validamos role acima). UsuariosList (client) cuida das mutacoes via API.
 */
export default async function UsuariosPage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  if (session.appUser.role !== "socio") {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_users")
    .select(
      "id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, active, created_at, created_by"
    )
    .order("created_at", { ascending: false });

  const initialUsers = (data ?? []) as UsuarioRow[];
  const loadError = error?.message ?? null;

  return (
    <UsuariosList
      initialUsers={initialUsers}
      loadError={loadError}
      currentUserId={session.appUser.id}
    />
  );
}
