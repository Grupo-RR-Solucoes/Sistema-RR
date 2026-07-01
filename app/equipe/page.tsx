import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import EquipeVisao from "./EquipeVisao";

export const dynamic = "force-dynamic";

/**
 * /equipe — visão do gestor (F4). Server component com gate manual, equivalente
 * ao requireGestor da API:
 *   - sem sessão -> /login
 *   - role != supervisor|gerente_regional -> / (socio/funcionario/promotor têm
 *     suas próprias telas; /equipe é a visão restrita do gestor).
 *
 * Os dados vêm de GET /api/equipe (guard requireGestor); nada é recalculado no
 * server aqui — só o gate + render do client.
 */
export default async function EquipePage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  const role = session.appUser.role;
  if (role !== "supervisor" && role !== "gerente_regional") {
    redirect("/");
  }

  return (
    <EquipeVisao
      role={role}
      email={session.appUser.email}
      fullName={session.appUser.fullName}
    />
  );
}
