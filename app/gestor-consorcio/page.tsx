import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import GestorConsorcioClient from "./GestorConsorcioClient";

export const dynamic = "force-dynamic";

// FRENTE DE PRODUTO — M3 PARTE C: visao do gestor de consorcio.
// Gate manual, equivalente ao requireGestorConsorcio (padrao das paginas server).
export default async function GestorConsorcioPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  if (session.appUser.role !== "gestor_consorcio") redirect("/");
  return <GestorConsorcioClient />;
}
