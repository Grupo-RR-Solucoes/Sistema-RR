import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import AtribuicaoClient from "./AtribuicaoClient";

export const dynamic = "force-dynamic";

// FRENTE DE PRODUTO — M3 PARTE A1 + VENDA PROPRIA DE GESTAO: tela de atribuicao.
// Gate manual, equivalente ao requireAtribuicaoProdutos (padrao das paginas server):
// socio/funcionario veem os tres produtos; gestor_consorcio entra com escopo RESTRITO
// (so CONSORCIO). O escopo em si e resolvido na rota — aqui e so o porteiro.
export default async function AtribuicaoPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");
  const role = session.appUser.role;
  if (role !== "socio" && role !== "funcionario" && role !== "gestor_consorcio") redirect("/");
  return <AtribuicaoClient />;
}
