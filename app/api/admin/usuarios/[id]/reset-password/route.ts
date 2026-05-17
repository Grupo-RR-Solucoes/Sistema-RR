import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import { generateProvisionalPassword } from "@/lib/admin/generatePassword";
import { canManageUserRole } from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * POST /api/admin/usuarios/[id]/reset-password
 *
 * Gera nova senha provisoria, atualiza em auth.users via
 * auth.admin.updateUserById, e registra em audit_logs com
 * action='password_reset_by_admin'.
 *
 * updateUserById invalida automaticamente sessoes ativas do user-alvo
 * (refresh tokens) — comportamento padrao do Supabase Auth. O user
 * precisara fazer login novamente com a senha nova.
 *
 * Retorna { password } com a senha em texto claro — UI deve exibir UMA VEZ
 * e nunca persistir.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    // 1. Buscar user-alvo
    const { data: target, error: fetchError } = await supabase
      .from("app_users")
      .select("id, auth_user_id, email, role")
      .eq("id", id)
      .single();

    if (fetchError || !target) {
      return NextResponse.json(
        { error: "Usuario nao encontrado" },
        { status: 404 }
      );
    }

    if (!canManageUserRole(session.appUser.role, target.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para resetar a senha desse usuario." },
        { status: 403 }
      );
    }

    if (!target.auth_user_id) {
      return NextResponse.json(
        { error: "Usuario sem auth_user_id; reset indisponivel" },
        { status: 400 }
      );
    }

    // 2. Gerar senha + update em auth.users
    const novaSenha = generateProvisionalPassword(16);

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      target.auth_user_id,
      { password: novaSenha }
    );

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    // 3. audit_log
    await supabase.from("audit_logs").insert({
      entity_name: "app_users",
      entity_id: target.id,
      action: "password_reset_by_admin",
      description: `${session.appUser.role} ${session.appUser.email} resetou senha de ${target.email} (${target.role})`,
      payload: {
        performed_by_user_id: session.appUser.id,
        performed_by_email: session.appUser.email,
        target_user_id: target.id,
        target_auth_user_id: target.auth_user_id,
        target_email: target.email,
        target_role: target.role,
        reset_at: new Date().toISOString(),
      },
      created_by: session.appUser.email,
    });

    return NextResponse.json({ password: novaSenha });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
