import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioAnon,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import {
  canDeleteExpense,
  canManageExpense,
} from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type ExpenseRow = {
  id: string;
  company_id: string | null;
  year: number;
  month: number;
  category_id: string | null;
  scope: string | null;
  description: string;
  amount: number | null;
  due_date: string | null;
  payment_date: string | null;
  status: string | null;
  notes: string | null;
};

interface PatchExpenseBody {
  amount?: number;
  due_date?: string | null;
  payment_date?: string | null;
  status?: string;
  notes?: string | null;
  category_id?: string | null;
  description?: string;
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// audit_logs RLS bloqueia INSERT via PostgREST. Mesmo padrao do
// /api/financeiro POST + /api/admin/usuarios: service_role para escrever.
async function writeAuditLog(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "financial_expenses",
      action: payload.action_kind as string,
      description,
      payload,
      created_by: createdBy,
    });
  } catch (auditErr) {
    console.error(
      "Falha ao escrever audit_logs em /api/financeiro/[id]",
      auditErr
    );
  }
}

/**
 * PATCH /api/financeiro/[id]
 * Edita uma despesa existente. Aceito por socio + funcionario
 * (canManageExpense). Mudanca de empresa (company_id) e escopo (scope)
 * NAO sao permitidas — exigem delete + recriar (audit-friendly).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();
    const { id } = await params;

    if (!canManageExpense(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para editar despesa." },
        { status: 403 }
      );
    }

    const { data: target, error: targetError } = await supabase
      .from("financial_expenses")
      .select(
        "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes"
      )
      .eq("id", id)
      .single<ExpenseRow>();

    if (targetError || !target) {
      return NextResponse.json(
        { error: "Despesa nao encontrada" },
        { status: 404 }
      );
    }

    const body = (await req.json()) as PatchExpenseBody;
    const update: Record<string, unknown> = {};

    if (body.amount !== undefined) {
      const amount = toNumber(body.amount);
      if (amount === null || amount <= 0) {
        return NextResponse.json(
          { error: "Valor invalido." },
          { status: 400 }
        );
      }
      update.amount = amount;
    }
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (!description) {
        return NextResponse.json(
          { error: "Descricao nao pode ficar vazia." },
          { status: 400 }
        );
      }
      update.description = description;
    }
    if (body.due_date !== undefined) update.due_date = body.due_date || null;
    if (body.payment_date !== undefined)
      update.payment_date = body.payment_date || null;
    if (body.status !== undefined) {
      update.status = String(body.status).toUpperCase();
    }
    if (body.notes !== undefined) update.notes = body.notes || null;
    if (body.category_id !== undefined) update.category_id = body.category_id || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Nada para atualizar" },
        { status: 400 }
      );
    }

    update.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("financial_expenses")
      .update(update)
      .eq("id", id)
      .select(
        "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes, updated_at"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Falha ao atualizar despesa" },
        { status: 500 }
      );
    }

    await writeAuditLog(
      `${user.role} ${user.session.appUser.email} editou despesa ${target.id}`,
      {
        action_kind: "expense_updated",
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        target_expense_id: target.id,
        target_company_id: target.company_id,
        changes: body,
        old_status: target.status,
        new_status: data.status ?? target.status,
        old_amount: target.amount,
        new_amount: data.amount ?? target.amount,
      },
      user.session.appUser.email
    );

    return NextResponse.json({ expense: data });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}

/**
 * DELETE /api/financeiro/[id]
 * Remove uma despesa. SOCIO-ONLY — DELETE de despesa eh evento auditavel
 * (Dia 3 Grupo F: ausencia de policy financial_expenses_funcionario_delete).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, supabase } = await withSocioAnon();
    const { id } = await params;

    if (!canDeleteExpense(user.role)) {
      return NextResponse.json(
        { error: "Apenas socios podem deletar despesa." },
        { status: 403 }
      );
    }

    const { data: target, error: targetError } = await supabase
      .from("financial_expenses")
      .select(
        "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes"
      )
      .eq("id", id)
      .single<ExpenseRow>();

    if (targetError || !target) {
      return NextResponse.json(
        { error: "Despesa nao encontrada" },
        { status: 404 }
      );
    }

    const { error: deleteError } = await supabase
      .from("financial_expenses")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    await writeAuditLog(
      `socio ${user.session.appUser.email} deletou despesa ${target.id}`,
      {
        action_kind: "expense_deleted",
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        deleted_expense: target,
      },
      user.session.appUser.email
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
