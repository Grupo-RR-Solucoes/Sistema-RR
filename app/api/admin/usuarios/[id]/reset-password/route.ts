import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import { canManageUserRole } from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveSiteUrl } from "@/lib/siteUrl";

/**
 * POST /api/admin/usuarios/[id]/reset-password
 *
 * Dispara o e-mail de redefinicao de senha para o usuario-alvo e registra em
 * audit_logs (action='password_reset_by_admin'). NAO gera/expoe senha.
 *
 * Metodo: supabase.auth.resetPasswordForEmail(email, { redirectTo }).
 *   Por que este e nao admin.generateLink({type:'recovery'}): generateLink
 *   apenas PRODUZ o link (action_link) e NAO envia e-mail — caberia ao app
 *   enviar manualmente. resetPasswordForEmail dispara o e-mail de recovery
 *   pelo SMTP configurado no projeto (Resend), que e o que queremos. O link
 *   aponta para /auth/callback (PKCE: exchangeCodeForSession) → /definir-senha.
 */
export async function POST(
  req: Request,
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

    if (!target.email) {
      return NextResponse.json(
        { error: "Usuario sem e-mail; redefinicao indisponivel" },
        { status: 400 }
      );
    }

    // 2. Dispara o e-mail de redefinicao (SMTP/Resend). O link leva ao
    //    /auth/callback → /definir-senha. Nenhuma senha e gerada/retornada.
    const redirectTo = `${resolveSiteUrl(req)}/auth/callback`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      target.email,
      { redirectTo }
    );

    if (resetError) {
      return NextResponse.json(
        { error: resetError.message },
        { status: 500 }
      );
    }

    // 3. audit_log
    await supabase.from("audit_logs").insert({
      entity_name: "app_users",
      entity_id: target.id,
      action: "password_reset_by_admin",
      description: `${session.appUser.role} ${session.appUser.email} enviou link de redefinicao para ${target.email} (${target.role})`,
      payload: {
        performed_by_user_id: session.appUser.id,
        performed_by_email: session.appUser.email,
        target_user_id: target.id,
        target_auth_user_id: target.auth_user_id,
        target_email: target.email,
        target_role: target.role,
        reset_sent_at: new Date().toISOString(),
      },
      created_by: session.appUser.email,
    });

    return NextResponse.json({ reset_sent: true, email: target.email });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
