import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { canManageExpense } from "@/lib/auth/permissions";
import { fetchAllRows } from "@/lib/queryHelpers";
import { buildFinancialAnalytics } from "@/lib/financialAnalytics";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// audit_logs RLS bloqueia INSERT via PostgREST para todos os roles
// (Dia 3 grupo G). writeAuditLog usa service_role para escrever, idem
// pattern Dia 4.1 (/api/admin/usuarios) + Etapa 3.3/3.4. createdBy recebe
// o email do usuario autenticado vindo do guard (T5 do mapa de decisoes).
async function writeAuditLog(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "financial",
      action: "MANUAL_ENTRY",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // Nao interrompe o fluxo principal se a trilha falhar.
  }
}

export async function GET(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    // Funcionario recebe payload slim: companies + categorias ativas +
    // despesas. Fluxo de caixa (closings, opening balances, deferred) fica
    // bloqueado tanto via RLS Grupo F quanto explicitamente aqui — evita
    // queries inuteis e mantem o shape de resposta previsivel para a
    // /despesas (Etapa 4.3.2). /financeiro continua socio-only via menu.
    if (user.role === "funcionario") {
      const [companies, categories, expenses] = await Promise.all([
        fetchAllRows<{ id: string; name: string; cnpj: string; active: boolean | null }>(
          () =>
            supabase
              .from("companies")
              .select("id, name, cnpj, active")
              .order("name", { ascending: true })
        ),
        fetchAllRows<{ id: string; name: string; is_default: boolean | null; active: boolean | null }>(
          () =>
            supabase
              .from("expense_categories")
              .select("id, name, is_default, active")
              .eq("active", true)
              .order("name", { ascending: true })
        ),
        fetchAllRows<{
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
          created_at: string | null;
        }>(() =>
          supabase
            .from("financial_expenses")
            .select(
              "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes, created_at"
            )
            .order("year", { ascending: true })
            .order("month", { ascending: true })
            .order("created_at", { ascending: false })
        ),
      ]);

      return NextResponse.json({ companies, categories, expenses });
    }

    const payload = await buildFinancialAnalytics(supabase, { year, month });
    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();
    const auditActor = user.session.appUser.email;

    const body = await req.json();
    const action = String(body?.action || "").trim();

    if (action === "expense") {
      if (!canManageExpense(user.role)) {
        return NextResponse.json(
          { error: "Voce nao tem permissao para lancar despesa." },
          { status: 403 }
        );
      }
      const year = Number(body.year);
      const month = Number(body.month);
      const amount = toNumber(body.amount);
      const description = String(body.description || "").trim();
      const scope = String(body.scope || "GROUP").toUpperCase();
      const companyId = body.companyId ? String(body.companyId) : null;
      const categoryId = body.categoryId ? String(body.categoryId) : null;
      const status = String(body.status || "PLANNED").toUpperCase();
      const dueDate = body.dueDate ? String(body.dueDate) : null;
      const paymentDate = body.paymentDate ? String(body.paymentDate) : null;
      const notes = body.notes ? String(body.notes) : null;

      if (!year || !month || amount <= 0 || !description) {
        return NextResponse.json(
          { error: "Informe competencia, descricao e valor valido para a despesa." },
          { status: 400 }
        );
      }

      const { data, error } = await supabase
        .from("financial_expenses")
        .insert({
          company_id: scope === "COMPANY" ? companyId : null,
          year,
          month,
          category_id: categoryId,
          scope,
          description,
          amount,
          due_date: dueDate,
          payment_date: paymentDate,
          status,
          notes,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      await writeAuditLog(
        "Lancamento manual de despesa",
        {
          expense_id: data.id,
          year,
          month,
          scope,
          company_id: scope === "COMPANY" ? companyId : null,
          amount,
        },
        auditActor
      );

      return NextResponse.json({ success: true, id: data.id });
    }

    if (action === "opening_balance") {
      if (user.role !== "socio") {
        return NextResponse.json(
          { error: "Apenas socios podem lancar saldo inicial." },
          { status: 403 }
        );
      }
      const year = Number(body.year);
      const month = Number(body.month);
      const openingBalance = toNumber(body.openingBalance);
      const scope = String(body.scope || "GROUP").toUpperCase();
      const companyId = body.companyId ? String(body.companyId) : null;

      if (!year || !month) {
        return NextResponse.json(
          { error: "Informe a competencia do saldo inicial." },
          { status: 400 }
        );
      }

      const query = supabase
        .from("cash_opening_balances")
        .select("id")
        .eq("year", year)
        .eq("month", month);

      const existingQuery =
        scope === "COMPANY" && companyId
          ? query.eq("company_id", companyId)
          : query.is("company_id", null);

      const { data: existing, error: existingError } = await existingQuery.maybeSingle();

      if (existingError) {
        throw existingError;
      }

      if (existing) {
        const { error } = await supabase
          .from("cash_opening_balances")
          .update({
            opening_balance: openingBalance,
          })
          .eq("id", existing.id);

        if (error) {
          throw error;
        }

        await writeAuditLog(
          "Atualizacao manual de saldo inicial",
          {
            opening_balance_id: existing.id,
            year,
            month,
            scope,
            company_id: scope === "COMPANY" ? companyId : null,
            opening_balance: openingBalance,
          },
          auditActor
        );

        return NextResponse.json({ success: true, id: existing.id, updated: true });
      }

      const { data, error } = await supabase
        .from("cash_opening_balances")
        .insert({
          company_id: scope === "COMPANY" ? companyId : null,
          year,
          month,
          opening_balance: openingBalance,
        })
        .select("id")
        .single();

      if (error) {
        throw error;
      }

      await writeAuditLog(
        "Lancamento manual de saldo inicial",
        {
          opening_balance_id: data.id,
          year,
          month,
          scope,
          company_id: scope === "COMPANY" ? companyId : null,
          opening_balance: openingBalance,
        },
        auditActor
      );

      return NextResponse.json({ success: true, id: data.id, updated: false });
    }

    if (action === "category") {
      if (user.role !== "socio") {
        return NextResponse.json(
          { error: "Apenas socios podem gerenciar categorias." },
          { status: 403 }
        );
      }
      const name = String(body.name || "").trim();

      if (!name) {
        return NextResponse.json(
          { error: "Informe o nome da categoria." },
          { status: 400 }
        );
      }

      const { data, error } = await supabase
        .from("expense_categories")
        .upsert(
          {
            name,
            is_default: false,
            active: true,
          },
          {
            onConflict: "name",
          }
        )
        .select("id, name")
        .single();

      if (error) {
        throw error;
      }

      await writeAuditLog(
        "Criacao ou reativacao de categoria de despesa",
        {
          category_id: data.id,
          name: data.name,
        },
        auditActor
      );

      return NextResponse.json({ success: true, category: data });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
