import type { UserRole } from "@/lib/auth/types";

export type AppRole = UserRole;
export type ManageableRole = AppRole;

/**
 * Decide se um usuario com role `actor` pode criar/editar/deletar
 * um usuario com role `target`.
 *
 * Regras:
 * - socio: pode tudo
 * - funcionario: SOMENTE pode mexer em promotor
 * - promotor: nunca pode
 */
export function canManageUserRole(
  actor: AppRole,
  target: ManageableRole
): boolean {
  if (actor === "socio") return true;
  if (actor === "funcionario") return target === "promotor";
  return false;
}

/**
 * Decide se um usuario com role `actor` pode ALTERAR o role
 * de outro usuario (promover/rebaixar). So socio pode.
 */
export function canChangeUserRole(actor: AppRole): boolean {
  return actor === "socio";
}

/**
 * Lista roles que `actor` pode criar/atribuir.
 * Util para popular dropdown de role no modal CreateUsuario.
 */
export function allowedTargetRoles(actor: AppRole): ManageableRole[] {
  if (actor === "socio") return ["socio", "funcionario", "promotor"];
  if (actor === "funcionario") return ["promotor"];
  return [];
}
