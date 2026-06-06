import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

export const dynamic = "force-dynamic";

/**
 * "/" — landing universal pós-login + fallback de nao-autorizado.
 *
 * Etapa 8 (enxugar menu): o antigo launcher de atalhos foi removido — a sidebar
 * ja navega. O "/" agora so ROTEIA cada papel pra sua tela inicial. O redirect
 * e ROLE-AWARE de proposito: um redirect cego pro /dashboard (socio-only)
 * quebraria funcionario e promotor, que tambem caem aqui no login e quando um
 * guard faz redirect("/").
 *   - socio       -> /dashboard (visao executiva)
 *   - funcionario -> /promotores (gestao comercial que ele opera)
 *   - promotor    -> /promotores (cai na carteira via PromotorView)
 *   - sem sessao  -> /login
 */
export default async function Home() {
  const session = await getCurrentUser();

  if (!session) {
    redirect("/login");
  }

  if (session.appUser.role === "socio") {
    redirect("/dashboard");
  }

  redirect("/promotores");
}
