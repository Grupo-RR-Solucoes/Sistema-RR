import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import {
  canChangeUserRole,
  canManageUserRole,
} from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { UserRole } from "@/lib/auth/types";

interface PatchUserBody {
  full_name?: string | null;
  role?: UserRole;
  cnpj_id?: string | null;
  promoter_id?: string | null;
  active?: boolean;
}

/**
 * PATCH /api/admin/usuarios/[id]
 * Atualiza campos editaveis de app_users. NAO atualiza email (vem de
 * auth.users — alterar email exigiria auth.admin.updateUserById, fora do
 * escopo Dia 4.1). NAO atualiza auth_user_id, id, created_at, created_by.
 *
 * Mudanca de role para promotor exige cnpj_id + promoter_id no body.
 * Mudanca de role para socio/funcionario zera cnpj_id e promoter_id.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    const { data: target, error: targetError } = await supabase
      .from("app_users")
      .select("id, role, email")
      .eq("id", id)
      .single();

    if (targetError || !target) {
      return NextResponse.json(
        { error: "Usuario nao encontrado" },
        { status: 404 }
      );
    }

    if (target.id === session.appUser.id) {
      return NextResponse.json(
        { error: "Voce nao pode editar a propria conta por aqui." },
        { status: 403 }
      );
    }

    if (!canManageUserRole(session.appUser.role, target.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para editar esse usuario." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as PatchUserBody;
    const update: Record<string, unknown> = {};

    if (body.full_name !== undefined) update.full_name = body.full_name;
    if (typeof body.active === "boolean") update.active = body.active;

    if (body.role !== undefined) {
      if (!["socio", "funcionario", "promotor"].includes(body.role)) {
        return NextResponse.json(
          { error: "Role invalido" },
          { status: 400 }
        );
      }
      if (body.role !== target.role) {
        if (!canChangeUserRole(session.appUser.role)) {
          return NextResponse.json(
            { error: "Apenas socios podem alterar o perfil de um usuario." },
            { status: 403 }
          );
        }
        if (!canManageUserRole(session.appUser.role, body.role)) {
          return NextResponse.json(
            { error: "Voce nao tem permissao para atribuir esse perfil." },
            { status: 403 }
          );
        }
      }
      update.role = body.role;

      if (body.role === "promotor") {
        const cnpj = body.cnpj_id;
        const promoter = body.promoter_id;
        if (!cnpj || !promoter) {
          return NextResponse.json(
            { error: "Promotor requer cnpj_id e promoter_id no body" },
            { status: 400 }
          );
        }
        update.cnpj_id = cnpj;
        update.promoter_id = promoter;
      } else {
        update.cnpj_id = null;
        update.promoter_id = null;
      }
    } else {
      // Role nao mudou — permite atualizar cnpj_id/promoter_id se vierem
      if (body.cnpj_id !== undefined) update.cnpj_id = body.cnpj_id;
      if (body.promoter_id !== undefined) update.promoter_id = body.promoter_id;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("app_users")
      .update(update)
      .eq("id", id)
      .select("id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, active, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Usuario nao encontrado" },
        { status: 404 }
      );
    }

    // Disc.15 (incorporada na Disc.14 Etapa 14.3.D): audit em PATCH.
    // Mesmo padrao de POST/DELETE/reset. Fail-safe: nao reverte o UPDATE
    // se o insert falhar — operacao primaria ja aconteceu.
    try {
      await supabase.from("audit_logs").insert({
        entity_name: "app_users",
        entity_id: target.id,
        action: "user_updated",
        description: `${session.appUser.role} ${session.appUser.email} editou usuario ${target.email}`,
        payload: {
          performed_by_user_id: session.appUser.id,
          performed_by_email: session.appUser.email,
          target_user_id: target.id,
          target_email: target.email,
          changes: body,
          old_role: target.role,
          new_role: body.role ?? target.role,
        },
        created_by: session.appUser.email,
      });
    } catch (auditErr) {
      console.error("Falha ao escrever audit_logs em PATCH /api/admin/usuarios", auditErr);
    }

    return NextResponse.json({ user: data });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

/**
 * DELETE /api/admin/usuarios/[id]
 * Remove fisicamente o usuario: auth.admin.deleteUser cascateia para
 * app_users via FK ON DELETE CASCADE em auth_user_id. Registra em
 * audit_logs com action='user_deleted'.
 *
 * Atencao: se o user a ser deletado criou outros usuarios (created_by
 * aponta para ele), o FK NO ACTION da app_users.created_by bloqueia o
 * delete. Nesse caso, retornamos erro e socio deve preferir 'desativar'
 * (PATCH active=false) em vez de deletar.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();
    const { id } = await params;

    // SEGURANCA (delete restrito): o DELETE fisico so e permitido para a conta
    // do administrador principal, definida na env server-only SUPER_ADMIN_EMAIL.
    // Validacao no SERVIDOR (esconder o botao no front nao basta). Fail-safe:
    // se a env estiver vazia/indefinida, NINGUEM deleta (nem socio). Desativar
    // (PATCH active=false) continua disponivel normalmente para socio.
    const superAdmin = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
    const operator = (session.appUser.email ?? "").trim().toLowerCase();
    if (!superAdmin || operator !== superAdmin) {
      return NextResponse.json(
        {
          error:
            "Exclusao restrita ao administrador principal. Para cortar o acesso, use Desativar.",
        },
        { status: 403 }
      );
    }

    // 1. Buscar user-alvo (precisa do auth_user_id para deleteUser cascatear)
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

    if (target.id === session.appUser.id) {
      return NextResponse.json(
        { error: "Voce nao pode deletar a propria conta." },
        { status: 403 }
      );
    }

    if (!canManageUserRole(session.appUser.role, target.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para deletar esse usuario." },
        { status: 403 }
      );
    }

    if (!target.auth_user_id) {
      return NextResponse.json(
        { error: "Usuario sem auth_user_id; nao pode ser deletado por aqui" },
        { status: 400 }
      );
    }

    // 2. Delete em auth.users (cascateia para app_users)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(
      target.auth_user_id
    );

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    // 3. audit_log — NOTE: o row em app_users ja foi cascateado, mas o ID
    // ainda eh valido como referencia historica (entity_id eh text livre).
    await supabase.from("audit_logs").insert({
      entity_name: "app_users",
      entity_id: target.id,
      action: "user_deleted",
      description: `${session.appUser.role} ${session.appUser.email} deletou usuario ${target.email} (${target.role})`,
      payload: {
        performed_by_user_id: session.appUser.id,
        performed_by_email: session.appUser.email,
        target_user_id: target.id,
        target_auth_user_id: target.auth_user_id,
        target_email: target.email,
        target_role: target.role,
      },
      created_by: session.appUser.email,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
