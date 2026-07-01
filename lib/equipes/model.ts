import type { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Read-model da árvore de gestão (F2). Fonte única usada tanto pela página
 * server (/admin/equipes) quanto pela API (GET /api/admin/equipes), para não
 * duplicar a montagem da árvore. Deriva TUDO das 2 FKs:
 *   promoters.supervisor_user_id  (promotor -> supervisor)
 *   app_users.manager_user_id     (supervisor -> gerente_regional)
 *
 * Não chama /api/promoters/list porque aquele endpoint não expõe
 * supervisor_user_id (a UI precisa do vínculo atual). Replicamos o mesmo
 * filtro operacional: is_master = false e active = true.
 */

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface PromoterLite {
  id: string;
  name: string;
  company_id: string | null;
  active: boolean;
  supervisor_user_id: string | null;
}

export interface GestorLite {
  id: string;
  full_name: string | null;
  email: string;
  role: "supervisor" | "gerente_regional";
  manager_user_id: string | null;
  active: boolean;
}

export interface SupervisorNode extends GestorLite {
  promoters: PromoterLite[];
}

export interface GerenteNode extends GestorLite {
  supervisores: SupervisorNode[];
}

export interface EquipesModel {
  /** listas planas para os pickers (selects) */
  gerentes: GestorLite[];
  supervisores: GestorLite[];
  promotores: PromoterLite[];
  /** árvore montada gerente -> supervisores -> promotores + baldes órfãos */
  tree: {
    gerentes: GerenteNode[];
    supervisoresSemGerente: SupervisorNode[];
    promotoresSemSupervisor: PromoterLite[];
  };
}

/**
 * Busca os gestores (supervisor + gerente_regional) e os promotores
 * operacionais e monta o read-model. Usa o client admin (service_role) —
 * os handlers/páginas que chamam já validaram socio|funcionario.
 */
export async function fetchEquipesModel(
  supabase: SupabaseAdmin
): Promise<EquipesModel> {
  const [gestoresRes, promotersRes] = await Promise.all([
    supabase
      .from("app_users")
      .select("id, full_name, email, role, manager_user_id, active")
      .in("role", ["supervisor", "gerente_regional"])
      .order("full_name", { ascending: true }),
    supabase
      .from("promoters")
      .select("id, name, company_id, active, supervisor_user_id")
      .eq("is_master", false)
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  if (gestoresRes.error) throw gestoresRes.error;
  if (promotersRes.error) throw promotersRes.error;

  const gestores = (gestoresRes.data ?? []) as GestorLite[];
  const promotores = (promotersRes.data ?? []) as PromoterLite[];

  const gerentes = gestores.filter((g) => g.role === "gerente_regional");
  const supervisores = gestores.filter((g) => g.role === "supervisor");

  const supNodes: SupervisorNode[] = supervisores.map((s) => ({
    ...s,
    promoters: promotores.filter((p) => p.supervisor_user_id === s.id),
  }));

  const gerNodes: GerenteNode[] = gerentes.map((g) => ({
    ...g,
    supervisores: supNodes.filter((s) => s.manager_user_id === g.id),
  }));

  const supervisoresSemGerente = supNodes.filter((s) => !s.manager_user_id);
  const promotoresSemSupervisor = promotores.filter(
    (p) => !p.supervisor_user_id
  );

  return {
    gerentes,
    supervisores,
    promotores,
    tree: {
      gerentes: gerNodes,
      supervisoresSemGerente,
      promotoresSemSupervisor,
    },
  };
}
