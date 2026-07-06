import type { EquipesModel } from "@/lib/equipes/model";

/**
 * META DO GESTOR (Entrega 2) — modelo do editor (socio-only, em /admin/equipes).
 * Para cada gestor calcula a meta DERIVADA (Σ metas dos promotores do time dele
 * na competência) e anexa o override existente. Puro/testável.
 */
export interface GestorMetaEditorRow {
  user_id: string;
  name: string;
  email: string;
  role: "supervisor" | "gerente_regional";
  meta_derivada: number;
  meta_override: number | null;
}

function gestorName(full_name: string | null, email: string): string {
  return (full_name && full_name.trim()) || email;
}

/**
 *   - supervisor: Σ meta dos promotores com supervisor_user_id = sup.id
 *   - gerente:    Σ das derivadas dos supervisores com manager_user_id = ger.id
 * (mesma árvore F2 usada em /admin/equipes; nada de escopo novo de RLS).
 */
export function buildGestorMetaEditor(
  model: EquipesModel,
  metaByPromoter: Map<string, number>,
  overrideByUser: Map<string, number>,
): GestorMetaEditorRow[] {
  const supMeta = new Map<string, number>();
  for (const p of model.promotores) {
    if (!p.supervisor_user_id) continue;
    supMeta.set(
      p.supervisor_user_id,
      (supMeta.get(p.supervisor_user_id) ?? 0) + (metaByPromoter.get(p.id) ?? 0),
    );
  }

  const gerMeta = new Map<string, number>();
  for (const s of model.supervisores) {
    if (!s.manager_user_id) continue;
    gerMeta.set(s.manager_user_id, (gerMeta.get(s.manager_user_id) ?? 0) + (supMeta.get(s.id) ?? 0));
  }

  const rows: GestorMetaEditorRow[] = [];
  for (const g of model.gerentes) {
    rows.push({
      user_id: g.id,
      name: gestorName(g.full_name, g.email),
      email: g.email,
      role: "gerente_regional",
      meta_derivada: gerMeta.get(g.id) ?? 0,
      meta_override: overrideByUser.get(g.id) ?? null,
    });
  }
  for (const s of model.supervisores) {
    rows.push({
      user_id: s.id,
      name: gestorName(s.full_name, s.email),
      email: s.email,
      role: "supervisor",
      meta_derivada: supMeta.get(s.id) ?? 0,
      meta_override: overrideByUser.get(s.id) ?? null,
    });
  }
  return rows;
}
