import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchEquipesModel, type EquipesModel } from "@/lib/equipes/model";

import EquipesView from "./EquipesView";

export const dynamic = "force-dynamic";

/**
 * /admin/equipes — server component (F2).
 *
 * Gate manual, mesmo padrão de /admin/usuarios:
 *   - sem sessão -> middleware já redirecionou para /login
 *   - role 'promotor'|'supervisor'|'gerente_regional' -> redirect para /
 *     (a visão do gestor é F4; aqui é a tela de MONTAGEM de equipes, só
 *      socio/funcionario).
 *
 * Busca o read-model inicial via service_role (RLS bypass — role já validado).
 */
export default async function EquipesPage() {
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

  let initialModel: EquipesModel | null = null;
  let loadError: string | null = null;
  try {
    const supabase = getSupabaseAdmin();
    initialModel = await fetchEquipesModel(supabase);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Falha ao carregar equipes";
  }

  return (
    <EquipesView
      initialModel={initialModel}
      loadError={loadError}
      currentUserRole={session.appUser.role}
      currentUserEmail={session.appUser.email}
    />
  );
}
