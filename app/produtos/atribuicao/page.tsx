import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import AtribuicaoClient from "./AtribuicaoClient";

export const dynamic = "force-dynamic";

// FRENTE DE PRODUTO — M3 PARTE A1: tela de atribuicao (socio/funcionario).
// Gate manual, equivalente ao requireSocioOrFuncionario (padrao das paginas server).
export default async function AtribuicaoPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const role = session.appUser.role;
  if (role !== "socio" && role !== "funcionario") redirect("/");
  return <AtribuicaoClient />;
}
