import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import { canManageUserRole } from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { UserRole } from "@/lib/auth/types";
import { isValidCPF, onlyDigits } from "@/lib/validators/cpf";
import { uniqueViolationResponse } from "@/lib/admin/pgErrors";
import { resolveSiteUrl } from "@/lib/siteUrl";

/**
 * GET /api/admin/usuarios
 * Lista usuarios cadastrados em app_users. Socio ve todos; funcionario
 * ve apenas role='promotor' (Disc.14: workflow rolling de bootstrap).
 */
export async function GET() {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("app_users")
      .select(
        "id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, cpf, active, created_at, created_by"
      )
      .order("created_at", { ascending: false });

    if (session.appUser.role === "funcionario") {
      query = query.eq("role", "promotor");
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: data ?? [] });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

interface CreateUserBody {
  email?: string;
  full_name?: string;
  role?: UserRole;
  cnpj_id?: string | null;
  promoter_id?: string | null;
  /** CPF (qualquer formato): obrigatório p/ funcionario/promotor; ignorado p/ socio. */
  cpf?: string | null;
}

/**
 * POST /api/admin/usuarios
 * Convida novo usuario: inviteUserByEmail cria a conta em auth.users (sem
 * senha) e dispara o e-mail de convite; em seguida cria a linha em app_users.
 * Resposta { user, invited:true, email } — NAO ha senha na tela; o usuario
 * define a senha pelo link do e-mail. Registra em audit_logs (user_created).
 *
 * Sem transacao distribuida: se INSERT em app_users falhar apos o convite,
 * tenta rollback via auth.admin.deleteUser. Se rollback tambem falhar,
 * retorna erro com instrucao de limpeza manual.
 */
export async function POST(req: Request) {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();

    const body = (await req.json()) as CreateUserBody;
    const email = body.email?.trim().toLowerCase();
    const full_name = body.full_name?.trim() ?? null;
    const role = body.role;
    const cnpj_id = body.cnpj_id ?? null;
    const promoter_id = body.promoter_id ?? null;

    // Validacao
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "E-mail invalido" },
        { status: 400 }
      );
    }
    if (
      !role ||
      !["socio", "funcionario", "promotor", "supervisor", "gerente_regional"].includes(
        role
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Role invalido (socio|funcionario|promotor|supervisor|gerente_regional)",
        },
        { status: 400 }
      );
    }
    if (!canManageUserRole(session.appUser.role, role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para criar usuario com esse perfil." },
        { status: 403 }
      );
    }
    if (role === "promotor" && (!cnpj_id || !promoter_id)) {
      return NextResponse.json(
        { error: "Promotor requer cnpj_id e promoter_id" },
        { status: 400 }
      );
    }
    if (role !== "promotor" && (cnpj_id || promoter_id)) {
      return NextResponse.json(
        { error: "Socio/funcionario nao deve ter cnpj_id nem promoter_id" },
        { status: 400 }
      );
    }

    // CPF: login por CPF é exclusivo de funcionario/promotor — obrigatório e
    // validado. Socio loga por e-mail → cpf sempre NULL (ignorado se enviado).
    let cpf: string | null = null;
    if (role === "funcionario" || role === "promotor") {
      const digits = onlyDigits(body.cpf ?? "");
      if (!isValidCPF(digits)) {
        return NextResponse.json(
          { error: "CPF invalido (obrigatorio para funcionario/promotor)" },
          { status: 400 }
        );
      }
      cpf = digits;
    }

    // 1. Convidar em auth.users — inviteUserByEmail cria o usuario SEM senha e
    // dispara o e-mail de convite (via SMTP/Resend) com link p/ /auth/callback,
    // que troca o code por sessao e leva o convidado a /definir-senha.
    const redirectTo = `${resolveSiteUrl(req)}/auth/callback`;
    const { data: authData, error: authError } =
      await supabase.auth.admin.inviteUserByEmail(email, { redirectTo });

    if (authError || !authData?.user) {
      // E-mail ja existente no Auth tambem cai aqui (mensagem do proprio Auth).
      return NextResponse.json(
        { error: authError?.message ?? "Falha ao convidar usuario" },
        { status: 500 }
      );
    }

    const authUserId = authData.user.id;

    // 2. Criar em app_users
    const { data: appUserData, error: appUserError } = await supabase
      .from("app_users")
      .insert({
        auth_user_id: authUserId,
        email,
        full_name,
        role,
        cnpj_id,
        promoter_id,
        cpf,
        active: true,
        created_by: session.appUser.id,
      })
      .select("id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, active, created_at")
      .single();

    if (appUserError || !appUserData) {
      // Rollback: deletar o auth.users do usuario convidado
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {
        // Best-effort rollback. Se falhou, socio tera que limpar manual.
      });

      // Unique violation (23505): CPF/e-mail ja cadastrado -> 409 amigavel,
      // sem expor SQL/constraint.
      const dup = uniqueViolationResponse(appUserError);
      if (dup) return dup;

      // Disc.7 - Mensagem amigavel para FK violation (23503). Race
      // tipico: socio seleciona empresa/promotor no modal, alguem
      // deleta antes do submit. UI deve recarregar e tentar de novo.
      if (
        appUserError &&
        typeof appUserError === "object" &&
        "code" in appUserError &&
        (appUserError as { code: string }).code === "23503"
      ) {
        return NextResponse.json(
          {
            error:
              "Empresa ou promotor selecionado nao existe ou foi removido. Recarregue a pagina e tente novamente.",
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: appUserError?.message ?? "Falha ao criar app_users" },
        { status: 500 }
      );
    }

    // 3. audit_log
    await supabase.from("audit_logs").insert({
      entity_name: "app_users",
      entity_id: appUserData.id,
      action: "user_created",
      description: `${session.appUser.role} ${session.appUser.email} criou usuario ${email} (${role})`,
      payload: {
        performed_by_user_id: session.appUser.id,
        performed_by_email: session.appUser.email,
        target_user_id: appUserData.id,
        target_auth_user_id: authUserId,
        target_email: email,
        target_role: role,
        target_cnpj_id: cnpj_id,
        target_promoter_id: promoter_id,
      },
      created_by: session.appUser.email,
    });

    return NextResponse.json({
      user: appUserData,
      invited: true,
      email,
    });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
