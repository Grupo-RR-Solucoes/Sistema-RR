import type { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Read-model da árvore de gestão (F2 + sócio-como-gestor). Fonte única usada
 * tanto pela página server (/admin/equipes) quanto pela API (GET
 * /api/admin/equipes), para não duplicar a montagem da árvore. Deriva TUDO das
 * 2 FKs:
 *   promoters.supervisor_user_id  (promotor -> supervisor|socio)
 *   app_users.manager_user_id     (supervisor -> gerente_regional|socio)
 *
 * SÓCIO COMO GESTOR (aditivo): um sócio pode ser ALVO de vínculo nos dois
 * níveis. Para não quebrar a regra "só role='supervisor' RECEBE gerente" nem
 * poluir a tela, separamos listas:
 *   - supervisores (puro, role='supervisor')  -> LINHAS do "vincular supervisor
 *     -> gerente" (quem PODE receber um gerente). Sócio NUNCA entra aqui.
 *   - supervisorOptions = supervisores + sócios -> OPÇÕES do select "supervisor
 *     responsável" (quem pode SER supervisor de um promotor).
 *   - gerenteOptions    = gerentes + sócios     -> OPÇÕES do select "gerente
 *     regional" (quem pode SER gerente de um supervisor).
 * Na árvore, um sócio só vira galho se estiver EFETIVAMENTE vinculado (algum
 * promotor aponta pra ele como supervisor, ou algum supervisor aponta pra ele
 * como gerente).
 *
 * Não chama /api/promoters/list porque aquele endpoint não expõe
 * supervisor_user_id (a UI precisa do vínculo atual). Replicamos o mesmo
 * filtro operacional: is_master = false e active = true.
 */

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export type GestorRole = "supervisor" | "gerente_regional" | "socio";

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
  role: GestorRole;
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
  /** opções do select "supervisor responsável" = supervisores + sócios */
  supervisorOptions: GestorLite[];
  /** opções do select "gerente regional" = gerentes + sócios */
  gerenteOptions: GestorLite[];
  /** árvore montada gerente -> supervisores -> promotores + baldes órfãos */
  tree: {
    gerentes: GerenteNode[];
    supervisoresSemGerente: SupervisorNode[];
    promotoresSemSupervisor: PromoterLite[];
  };
}

/**
 * Montagem PURA do read-model (sem I/O) — testável isoladamente.
 * `gestores` deve conter supervisor + gerente_regional + socio.
 */
export function assembleEquipesModel(
  gestores: GestorLite[],
  promotores: PromoterLite[],
): EquipesModel {
  const gerentes = gestores.filter((g) => g.role === "gerente_regional");
  const supervisores = gestores.filter((g) => g.role === "supervisor");
  const socios = gestores.filter((g) => g.role === "socio");

  // Pickers: sócios entram como opção nos dois níveis (rotulados na UI).
  const supervisorOptions = [...supervisores, ...socios];
  const gerenteOptions = [...gerentes, ...socios];

  // --- Árvore ---
  // (1) nós supervisores = supervisores PUROS (sempre, mesmo sem promotor —
  //     preserva o galho "supervisor sem gerente", ex.: Carla) + sócios que
  //     estão EFETIVAMENTE atuando como supervisor (algum promotor aponta).
  const supervisorLinkedSocioIds = new Set(
    promotores.map((p) => p.supervisor_user_id).filter((x): x is string => !!x),
  );
  const sociosComoSupervisor = socios.filter((s) =>
    supervisorLinkedSocioIds.has(s.id),
  );
  const supActing = [...supervisores, ...sociosComoSupervisor];

  const supNodes: SupervisorNode[] = supActing.map((s) => ({
    ...s,
    promoters: promotores.filter((p) => p.supervisor_user_id === s.id),
  }));

  // (2) nós gerente (raiz) = gerentes PUROS (sempre) + sócios EFETIVAMENTE
  //     atuando como gerente (algum supervisor-node aponta manager pra ele).
  const managerLinkedSocioIds = new Set(
    supNodes.map((s) => s.manager_user_id).filter((x): x is string => !!x),
  );
  const sociosComoGerente = socios.filter((s) => managerLinkedSocioIds.has(s.id));
  const gerActing = [...gerentes, ...sociosComoGerente];

  const gerNodes: GerenteNode[] = gerActing.map((g) => ({
    ...g,
    supervisores: supNodes.filter((s) => s.manager_user_id === g.id),
  }));

  // (3) baldes de raiz própria: qualquer supervisor-node SEM manager (inclui
  //     Carla — supervisor sem gerente — e todo sócio-supervisor, que nunca
  //     tem manager). Não somem por falta de pai.
  const supervisoresSemGerente = supNodes.filter((s) => !s.manager_user_id);
  const promotoresSemSupervisor = promotores.filter(
    (p) => !p.supervisor_user_id,
  );

  return {
    gerentes,
    supervisores,
    promotores,
    supervisorOptions,
    gerenteOptions,
    tree: {
      gerentes: gerNodes,
      supervisoresSemGerente,
      promotoresSemSupervisor,
    },
  };
}

/**
 * Busca os gestores (supervisor + gerente_regional + socio) e os promotores
 * operacionais e monta o read-model. Usa o client admin (service_role) —
 * os handlers/páginas que chamam já validaram socio|funcionario.
 */
export async function fetchEquipesModel(
  supabase: SupabaseAdmin,
): Promise<EquipesModel> {
  const [gestoresRes, promotersRes] = await Promise.all([
    supabase
      .from("app_users")
      .select("id, full_name, email, role, manager_user_id, active")
      .in("role", ["supervisor", "gerente_regional", "socio"])
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

  return assembleEquipesModel(gestores, promotores);
}
