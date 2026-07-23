import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import {
  canChangeUserRole,
  canManageUserRole,
} from "@/lib/auth/permissions";
import { PAPEIS_COM_VENDA_PROPRIA } from "@/lib/produtoBeneficiario";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { UserRole } from "@/lib/auth/types";
import { isValidCPF, onlyDigits } from "@/lib/validators/cpf";
import { uniqueViolationResponse } from "@/lib/admin/pgErrors";

interface PatchUserBody {
  full_name?: string | null;
  role?: UserRole;
  cnpj_id?: string | null;
  promoter_id?: string | null;
  active?: boolean;
  /** CPF (qualquer formato): obrigatório/valido p/ funcionario-promotor; NULL p/ socio. */
  cpf?: string | null;
  /** E-mail: ao alterar, sincroniza app_users.email E auth.users. */
  email?: string | null;
  /** Venda propria (papel de gestao que tambem vende). So socio pode alterar. */
  venda_propria?: boolean;
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
      .select("id, role, email, auth_user_id, active, cpf, venda_propria")
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

    // E-mail — valida formato; só marca alteração se realmente mudou. A
    // permissão de editar (sócio: qualquer; funcionário: só promotor) já é
    // garantida por canManageUserRole(actor, target.role) acima. A sincronia
    // com auth.users acontece após o UPDATE em app_users (abaixo).
    let newEmail: string | null = null;
    if (body.email !== undefined && body.email !== null) {
      const e = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return NextResponse.json({ error: "E-mail invalido" }, { status: 400 });
      }
      if (e !== (target.email ?? "").toLowerCase()) {
        newEmail = e;
        update.email = e;
      }
    }

    if (body.role !== undefined) {
      // Mesma lista/validação do POST (/api/admin/usuarios) — inclui os roles de
      // gestão supervisor/gerente_regional. Sem isto o PATCH rejeitaria a troca
      // de perfil pela tela de edição com 400.
      if (
        ![
          "socio",
          "funcionario",
          "promotor",
          "supervisor",
          "gerente_regional",
          "gestor_consorcio",
        ].includes(body.role)
      ) {
        return NextResponse.json(
          {
            error:
              "Role invalido (socio|funcionario|promotor|supervisor|gerente_regional|gestor_consorcio)",
          },
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

    // VENDA PROPRIA — atributo do PAPEL DE GESTAO (NAO e vinculo a promotor). So
    // SOCIO altera; so vale para gestor_consorcio/supervisor/gerente_regional. Ao sair
    // de um papel de gestao o flag e zerado, senao o CHECK do banco recusaria o UPDATE
    // (e o usuario ficaria com uma habilitacao invisivel).
    const papelFinal = (body.role ?? target.role) as UserRole;
    const papelDeGestao = (PAPEIS_COM_VENDA_PROPRIA as readonly string[]).includes(papelFinal);
    if (body.venda_propria !== undefined) {
      if (!canChangeUserRole(session.appUser.role)) {
        return NextResponse.json(
          { error: "Apenas socios podem habilitar venda propria." },
          { status: 403 }
        );
      }
      if (body.venda_propria === true && !papelDeGestao) {
        return NextResponse.json(
          { error: "Venda propria so existe para papeis de gestao." },
          { status: 400 }
        );
      }
      update.venda_propria = body.venda_propria === true;
    } else if (body.role !== undefined && !papelDeGestao) {
      update.venda_propria = false;
    }

    // CPF — segue o role FINAL (mesma regra do POST). funcionario/promotor:
    // valida e normaliza quando vier no body; obrigatorio quando o usuario
    // PASSA A SER funcionario/promotor. socio e gestor_consorcio logam por e-mail:
    // zera (NULL) ao virar um deles.
    const finalRole = (body.role ?? target.role) as UserRole;
    if (finalRole === "socio" || finalRole === "gestor_consorcio") {
      if (body.role === "socio" || body.role === "gestor_consorcio") update.cpf = null;
    } else if (body.cpf !== undefined) {
      const cpfDigits = onlyDigits(typeof body.cpf === "string" ? body.cpf : "");
      if (!isValidCPF(cpfDigits)) {
        return NextResponse.json({ error: "CPF invalido" }, { status: 400 });
      }
      update.cpf = cpfDigits;
    } else if (body.role !== undefined && body.role !== target.role) {
      // Passou a ser funcionario/promotor sem informar CPF.
      return NextResponse.json(
        { error: "CPF invalido (obrigatorio para funcionario/promotor)" },
        { status: 400 }
      );
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
      .select("id, auth_user_id, email, full_name, role, cnpj_id, promoter_id, cpf, venda_propria, active, created_at")
      .single();

    if (error || !data) {
      // Unique violation (23505): CPF/e-mail ja cadastrado -> 409 amigavel,
      // sem expor SQL/constraint.
      const dup = uniqueViolationResponse(error);
      if (dup) return dup;
      return NextResponse.json(
        { error: error?.message ?? "Usuario nao encontrado" },
        { status: 404 }
      );
    }

    // Sincroniza o e-mail no auth.users quando mudou. app_users.email já foi
    // atualizado acima (a unique de e-mail lá pega duplicidade via 23505).
    // email_confirm:true marca o novo e-mail como confirmado — evita disparar
    // o fluxo de confirmação dupla do Supabase. Se o Auth falhar (ex.: e-mail
    // já usado por outra conta no Auth), revertemos app_users p/ não dessincronizar.
    if (newEmail && target.auth_user_id) {
      const { error: authEmailError } = await supabase.auth.admin.updateUserById(
        target.auth_user_id,
        { email: newEmail, email_confirm: true }
      );
      if (authEmailError) {
        await supabase
          .from("app_users")
          .update({ email: target.email })
          .eq("id", id)
          .then(() => undefined);
        const msg = (authEmailError.message ?? "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
          return NextResponse.json(
            { error: "Este e-mail já está cadastrado." },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: "Falha ao sincronizar o e-mail no Auth." },
          { status: 500 }
        );
      }
    }

    // SEGURANCA — Desativar corta o acesso de verdade: ao mudar active para
    // FALSE, banimos a conta no Auth (login falha na hora + sessao ativa cai);
    // ao reativar (TRUE) removemos o ban. So agimos quando `active` REALMENTE
    // muda (evita chamadas desnecessarias). Falha aqui nao reverte o UPDATE do
    // DB — a checagem de active no login (Parte B) e no getCurrentUser ja barra
    // como defesa em profundidade.
    if (
      typeof body.active === "boolean" &&
      body.active !== target.active &&
      target.auth_user_id
    ) {
      try {
        await supabase.auth.admin.updateUserById(target.auth_user_id, {
          ban_duration: body.active ? "none" : "876000h",
        });
      } catch (banErr) {
        console.error(
          "Falha ao (des)banir no Auth em PATCH /api/admin/usuarios",
          banErr
        );
      }
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
