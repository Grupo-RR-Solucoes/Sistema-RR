import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import PromotoresClient from "./PromotoresClient";

export const dynamic = "force-dynamic";

/**
 * /promotores — gate server-side (defesa em profundidade, espelha
 * app/equipe/page.tsx). A tela é do sócio (comissão bruta/a pagar); a RLS já
 * não expõe o dado a gestor, e aqui a APLICAÇÃO também barra:
 *   - sem sessão -> /login
 *   - role supervisor|gerente_regional -> /equipe (a tela deles, F4)
 *   - socio|funcionario|promotor -> renderiza o conteúdo client atual
 *     (o próprio client desvia promotor -> PromotorView; socio/funcionario ->
 *     tela completa). Comportamento desses três roles é inalterado.
 */
export default async function PromotoresPage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  const role = session.appUser.role;
  if (role === "supervisor" || role === "gerente_regional") {
    redirect("/equipe");
  }

  return <PromotoresClient />;
}
