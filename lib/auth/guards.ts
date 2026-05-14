import { NextResponse } from "next/server";

import { getCurrentUser } from "./getUser";
import type { AuthSession, UserRole } from "./types";

/**
 * Erro estruturado lancado pelos guards. Os handlers de API devem capturar
 * via try/catch e converter para NextResponse usando `apiGuardErrorResponse`.
 *
 * Motivacao: lancar excecao mantem o codigo de handler limpo (sem ifs
 * espalhados); converter para Response no boundary do handler centraliza
 * o formato de erro JSON.
 */
export class ApiGuardError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiGuardError";
    this.status = status;
  }
}

/**
 * Converte um erro lancado por qualquer guard em NextResponse JSON.
 * Se nao for ApiGuardError, repassa como 500 para nao mascarar bugs.
 */
export function apiGuardErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiGuardError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }
  const message = error instanceof Error ? error.message : "Erro interno";
  return NextResponse.json({ error: message }, { status: 500 });
}

// ============================================================
// Guards
// ============================================================

/**
 * Garante que ha sessao autenticada valida em app_users.
 *
 * Retorna `{ session, role }` quando OK.
 * Lanca ApiGuardError(401) se nao ha sessao Supabase Auth ativa, ou se ha
 * sessao mas sem row correspondente em app_users (usuario nao provisionado
 * ou desativado).
 *
 * Uso tipico:
 *   try {
 *     const { session } = await requireAuthenticated();
 *     // ...
 *   } catch (e) { return apiGuardErrorResponse(e); }
 */
export async function requireAuthenticated(): Promise<{
  session: AuthSession;
  role: UserRole;
}> {
  const session = await getCurrentUser();
  if (!session) {
    throw new ApiGuardError(401, "Nao autenticado");
  }
  return { session, role: session.appUser.role };
}

/**
 * Garante que ha sessao autenticada E role === 'socio'.
 *
 * Retorna `{ session, role }` (role sera sempre 'socio') quando OK.
 * Lanca ApiGuardError(401) se nao logado, (403) se logado mas nao eh socio.
 *
 * Use em handlers que operam dados sensiveis exclusivos de socio:
 * /api/admin/*, /api/auditoria/* (Dia 4.2+), /api/financeiro/cash-balance,
 * /api/configuracoes (escrita), /api/dashboard.
 */
export async function requireSocio(): Promise<{
  session: AuthSession;
  role: "socio";
}> {
  const { session, role } = await requireAuthenticated();
  if (role !== "socio") {
    throw new ApiGuardError(403, "Acesso restrito a socios");
  }
  return { session, role: "socio" };
}

/**
 * Garante que ha sessao autenticada E role in {'socio', 'funcionario'}.
 *
 * Retorna `{ session, role }` quando OK.
 * Lanca ApiGuardError(401) se nao logado, (403) se role === 'promotor'.
 *
 * Use em handlers operacionais que socio + funcionario compartilham mas
 * promotor nao deve acessar: /api/promotores (CRUD), /api/cadastros,
 * /api/importacoes, /api/import/*, /api/diferido, /api/financeiro
 * (despesas), /api/calculate/monthly. Promotor tem endpoint proprio
 * (filtrado por promoter_id) ou eh bloqueado.
 */
export async function requireSocioOrFuncionario(): Promise<{
  session: AuthSession;
  role: "socio" | "funcionario";
}> {
  const { session, role } = await requireAuthenticated();
  if (role !== "socio" && role !== "funcionario") {
    throw new ApiGuardError(
      403,
      "Acesso restrito a socios e funcionarios"
    );
  }
  return { session, role };
}
