import { NextResponse } from "next/server";

import { getCurrentUser } from "./getUser";
import { createSupabaseServerClient } from "./supabaseServerClient";
import type { AuthSession, UserRole } from "./types";
import { getSupabaseAdmin } from "../supabaseAdmin";

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

/**
 * Garante que ha sessao autenticada E role in {'supervisor','gerente_regional'}.
 *
 * Retorna `{ session, role }` quando OK.
 * Lanca ApiGuardError(401) se nao logado, (403) para socio/funcionario/promotor.
 *
 * Use nos handlers da visao do gestor (F4): /api/equipe/*. A visao de dados do
 * gestor e restrita — produção do time SEM comissão, via vw_team_production
 * (F3). socio/funcionario tem as telas completas; promotor tem a propria.
 */
export async function requireGestor(): Promise<{
  session: AuthSession;
  role: "supervisor" | "gerente_regional";
}> {
  const { session, role } = await requireAuthenticated();
  if (role !== "supervisor" && role !== "gerente_regional") {
    throw new ApiGuardError(
      403,
      "Acesso restrito a gestores (supervisor/gerente regional)"
    );
  }
  return { session, role };
}

// Gestor de consorcio (M3): role UNICO 'gestor_consorcio'. Ve producao geral do
// consorcio + o proprio payout de 10%; NUNCA a comissao dos promotores. Espelho do
// requireGestor, variante de role unico.
export async function requireGestorConsorcio(): Promise<{
  session: AuthSession;
  role: "gestor_consorcio";
}> {
  const { session, role } = await requireAuthenticated();
  if (role !== "gestor_consorcio") {
    throw new ApiGuardError(403, "Acesso restrito ao gestor de consorcio");
  }
  return { session, role: "gestor_consorcio" };
}

/**
 * Guard da FILA DE ATRIBUICAO DE PRODUTOS (/produtos/atribuicao).
 *
 * socio/funcionario: escopo TODOS (BBCAP + Conta Corrente + Consorcio).
 * gestor_consorcio:  escopo CONSORCIO — ele so ve e migra propostas de consorcio,
 *                    NUNCA BBCAP nem CONTA_CORRENTE. E o mesmo espirito do /equipe:
 *                    o papel de gestao entra numa tela operacional, mas so na fatia
 *                    que e dele.
 *
 * O escopo devolvido aqui e o gate REAL (a rota usa service_role, que bypassa RLS);
 * a policy equivalente na fila e defesa em profundidade.
 */
export async function requireAtribuicaoProdutos(): Promise<{
  session: AuthSession;
  role: "socio" | "funcionario" | "gestor_consorcio";
  escopo: "TODOS" | "CONSORCIO";
}> {
  const { session, role } = await requireAuthenticated();
  if (role === "socio" || role === "funcionario") {
    return { session, role, escopo: "TODOS" };
  }
  if (role === "gestor_consorcio") {
    return { session, role, escopo: "CONSORCIO" };
  }
  throw new ApiGuardError(
    403,
    "Acesso restrito a socios, funcionarios e ao gestor de consorcio"
  );
}

// ============================================================
// Composicoes guard + client (Dia 4.2)
// ============================================================
//
// Helpers que combinam um guard com a inicializacao do cliente Supabase
// apropriado, para reduzir boilerplate nos handlers de API:
//
//   - *Anon  → createSupabaseServerClient (Escola B: anon autenticado + RLS)
//   - *Admin → getSupabaseAdmin            (Escola A: service_role com guard)
//
// Mapeamento bucket -> helper (Dia 4.2 mapa de decisoes):
//   withAuthenticatedAnon       → D11, D17, D24, D25
//   withSocioAnon               → D12-D16, D18, D20, D21, D30, D32, D33
//   withSocioOrFuncionarioAnon  → D19, D22, D23, D31
//   withSocioAdmin              → D26, D27, D34, D35, D36
//   withSocioOrFuncionarioAdmin → D28

export async function withAuthenticatedAnon() {
  const user = await requireAuthenticated();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

export async function withSocioAnon() {
  const user = await requireSocio();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

export async function withSocioOrFuncionarioAnon() {
  const user = await requireSocioOrFuncionario();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}

export async function withSocioAdmin() {
  const user = await requireSocio();
  const supabase = getSupabaseAdmin();
  return { user, supabase };
}

export async function withSocioOrFuncionarioAdmin() {
  const user = await requireSocioOrFuncionario();
  const supabase = getSupabaseAdmin();
  return { user, supabase };
}

/** Fila de atribuicao de produtos + client service_role. Ver requireAtribuicaoProdutos. */
export async function withAtribuicaoProdutosAdmin() {
  const user = await requireAtribuicaoProdutos();
  const supabase = getSupabaseAdmin();
  return { user, supabase };
}

/**
 * Guard de gestor + client ANON autenticado (Escola B: RLS + auth.uid()).
 * A view vw_team_production e a policy de monthly_targets (F3) filtram pela
 * arvore do gestor via auth.uid() — por isso o client PRECISA ser o anon
 * autenticado (nao service_role, que teria auth.uid() nulo e devolveria vazio).
 */
export async function withGestorAnon() {
  const user = await requireGestor();
  const supabase = await createSupabaseServerClient();
  return { user, supabase };
}
