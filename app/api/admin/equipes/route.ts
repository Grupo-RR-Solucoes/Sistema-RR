import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  requireSocioOrFuncionario,
} from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchEquipesModel } from "@/lib/equipes/model";

/**
 * GET /api/admin/equipes
 * Monta a árvore de gestão (gerente -> supervisores -> promotores) a partir
 * das 2 FKs (F2). Guard socio|funcionario. Retorna o read-model completo:
 * listas planas (para os pickers) + árvore montada.
 */
export async function GET() {
  try {
    await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();
    const model = await fetchEquipesModel(supabase);
    return NextResponse.json(model);
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

interface PatchBody {
  /** qual aresta gravar */
  entity?: "promoter" | "supervisor";
  /** id da linha alvo: promoters.id (promoter) OU app_users.id (supervisor) */
  id?: string;
  /** aresta promotor -> supervisor (entity='promoter'); null = desvincular */
  supervisor_user_id?: string | null;
  /** aresta supervisor -> gerente (entity='supervisor'); null = desvincular */
  manager_user_id?: string | null;
}

// Códigos pg que representam violação de regra de domínio (trigger/FK/CHECK):
// devolvemos a mensagem (em pt-BR, vinda da trigger) como 400 amigável.
const DOMAIN_ERROR_CODES = new Set(["23514", "23503", "P0001"]);

function pgCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return null;
}

function pgMessage(error: unknown): string | null {
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

function isDomainError(error: unknown): boolean {
  const code = pgCode(error);
  return code !== null && DOMAIN_ERROR_CODES.has(code);
}

/**
 * PATCH /api/admin/equipes
 * Grava UMA aresta de vínculo. A integridade de papel/nível é garantida pela
 * trigger no banco (F2); aqui capturamos o erro da trigger e o devolvemos como
 * 400. Registra em audit_logs, no mesmo padrão de /api/admin/usuarios.
 */
export async function PATCH(req: Request) {
  try {
    const { session } = await requireSocioOrFuncionario();
    const supabase = getSupabaseAdmin();

    const body = (await req.json()) as PatchBody;
    const { entity, id } = body;

    if (!id || (entity !== "promoter" && entity !== "supervisor")) {
      return NextResponse.json(
        { error: "Requisição inválida: informe entity ('promoter'|'supervisor') e id." },
        { status: 400 }
      );
    }

    if (entity === "promoter") {
      const supervisorUserId = body.supervisor_user_id ?? null;

      const { data: target, error: targetError } = await supabase
        .from("promoters")
        .select("id, name, supervisor_user_id")
        .eq("id", id)
        .single();
      if (targetError || !target) {
        return NextResponse.json({ error: "Promotor não encontrado." }, { status: 404 });
      }

      const { data, error } = await supabase
        .from("promoters")
        .update({ supervisor_user_id: supervisorUserId })
        .eq("id", id)
        .select("id, name, supervisor_user_id")
        .single();

      if (error || !data) {
        if (isDomainError(error)) {
          return NextResponse.json(
            { error: pgMessage(error) ?? "Vínculo inválido." },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: pgMessage(error) ?? "Falha ao vincular promotor." },
          { status: 500 }
        );
      }

      await auditLink(supabase, session, {
        entity_name: "promoters",
        entity_id: target.id,
        action: "promoter_supervisor_linked",
        description: `${session.appUser.role} ${session.appUser.email} vinculou promotor ${target.name} ao supervisor ${supervisorUserId ?? "(nenhum)"}`,
        old_value: target.supervisor_user_id,
        new_value: supervisorUserId,
        field: "supervisor_user_id",
      });

      return NextResponse.json({ promoter: data });
    }

    // entity === "supervisor"
    const managerUserId = body.manager_user_id ?? null;

    const { data: target, error: targetError } = await supabase
      .from("app_users")
      .select("id, full_name, email, role, manager_user_id")
      .eq("id", id)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ error: "Supervisor não encontrado." }, { status: 404 });
    }
    if (target.role !== "supervisor") {
      return NextResponse.json(
        { error: "Só um supervisor pode ser vinculado a um gerente_regional." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("app_users")
      .update({ manager_user_id: managerUserId })
      .eq("id", id)
      .select("id, full_name, email, role, manager_user_id")
      .single();

    if (error || !data) {
      if (isDomainError(error)) {
        return NextResponse.json(
          { error: pgMessage(error) ?? "Vínculo inválido." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: pgMessage(error) ?? "Falha ao vincular supervisor." },
        { status: 500 }
      );
    }

    await auditLink(supabase, session, {
      entity_name: "app_users",
      entity_id: target.id,
      action: "supervisor_manager_linked",
      description: `${session.appUser.role} ${session.appUser.email} vinculou supervisor ${target.email} ao gerente ${managerUserId ?? "(nenhum)"}`,
      old_value: target.manager_user_id,
      new_value: managerUserId,
      field: "manager_user_id",
    });

    return NextResponse.json({ user: data });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

type SessionLike = Awaited<ReturnType<typeof requireSocioOrFuncionario>>["session"];

async function auditLink(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  session: SessionLike,
  entry: {
    entity_name: string;
    entity_id: string;
    action: string;
    description: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
  }
) {
  // Fail-safe: audit não reverte a operação primária (mesmo padrão de usuarios).
  try {
    await supabase.from("audit_logs").insert({
      entity_name: entry.entity_name,
      entity_id: entry.entity_id,
      action: entry.action,
      description: entry.description,
      payload: {
        performed_by_user_id: session.appUser.id,
        performed_by_email: session.appUser.email,
        target_id: entry.entity_id,
        field: entry.field,
        old_value: entry.old_value,
        new_value: entry.new_value,
      },
      created_by: session.appUser.email,
    });
  } catch (auditErr) {
    console.error("Falha ao escrever audit_logs em PATCH /api/admin/equipes", auditErr);
  }
}
