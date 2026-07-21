import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import GestorCadastroClient from "./GestorCadastroClient";

export const dynamic = "force-dynamic";

// FRENTE DE PRODUTO — M3 PARTE A2: cadastro do gestor de consorcio (socio-only).
export default async function GestorConsorcioAdminPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.appUser.role !== "socio") redirect("/");
  return <GestorCadastroClient />;
}
