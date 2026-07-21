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
  if (actor === "socio")
    return [
      "socio",
      "funcionario",
      "promotor",
      "supervisor",
      "gerente_regional",
      "gestor_consorcio",
    ];
  if (actor === "funcionario") return ["promotor"];
  return [];
}

/**
 * Decide se um usuario com role `actor` pode criar/editar uma despesa
 * em financial_expenses (lancar, marcar como paga, ajustar valor).
 *
 * Espelha a RLS Dia 3 Grupo F (socio_all + funcionario_select/insert/update).
 * Promotor sempre bloqueado.
 */
export function canManageExpense(actor: AppRole): boolean {
  return actor === "socio" || actor === "funcionario";
}

/**
 * Decide se um usuario com role `actor` pode DELETAR uma despesa
 * em financial_expenses. Apenas socio — DELETE de despesa eh evento
 * auditavel (Dia 3 Grupo F: "DELETE de despesa eh evento auditavel e
 * fica restrito ao socio").
 */
export function canDeleteExpense(actor: AppRole): boolean {
  return actor === "socio";
}

/**
 * Decide se um usuario com role `actor` pode criar/editar regras de
 * comissao (promoter_proposal_commissions, promoter_product_commissions,
 * promoter_agreements).
 *
 * Espelha a RLS Dia 3 Grupo D (socio + funcionario tem ALL; promotor
 * apenas SELECT do proprio promoter_id). Comentario literal da migration:
 * "funcionario tem ALL (escopo declarado: 've comissoes $$$' + edita
 * acordos + lanca descontos operacionais)".
 */
export function canManageCommissionRule(actor: AppRole): boolean {
  return actor === "socio" || actor === "funcionario";
}
