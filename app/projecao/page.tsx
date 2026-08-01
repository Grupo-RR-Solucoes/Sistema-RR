import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/getUser";

import ProjecaoClient from "./ProjecaoClient";

export const dynamic = "force-dynamic";

/**
 * /projecao — Painel de Metas & Projeção. Server component com gate manual,
 * espelhando a forma de app/equipe/page.tsx:
 *   - sem sessão -> /login
 *   - role fora de socio|funcionario|supervisor|gerente_regional -> /
 *
 * ATÉ AQUI NÃO HAVIA GUARD NENHUM. A tela era um "use client" puro e qualquer
 * papel autenticado que digitasse a URL renderizava o shell; quem barrava era só
 * a RLS, devolvendo tela vazia. Agora o gate é explícito e o conjunto de papéis
 * permitidos é declarado em UM lugar.
 *
 * O PROMOTOR CONTINUA ENTRANDO: /api/projecao tem ramo próprio para ele
 * (scope "promotor", só o próprio promoter_id) e a tela tem PromotorView. Ele
 * NÃO está na lista de bloqueio.
 *
 * Nada é recalculado aqui — só o gate + render do client, que busca
 * GET /api/projecao. O role-gating dos DADOS continua sendo do backend: o ramo
 * do gestor lê pela árvore (vw_team_production), o do sócio pelo motor completo.
 */
const PAPEIS_PERMITIDOS = [
  "socio",
  "funcionario",
  "promotor",
  "supervisor",
  "gerente_regional",
] as const;

export default async function ProjecaoPage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  const role = session.appUser.role;
  if (!(PAPEIS_PERMITIDOS as readonly string[]).includes(role)) {
    redirect("/");
  }

  return <ProjecaoClient />;
}
