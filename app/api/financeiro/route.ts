import { buildFinancialAnalytics } from "@/lib/financialAnalytics";
import { clearMemoryCache } from "@/lib/memoryCache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeAuditLog(description: string, payload: Record<string, unknown>) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    await supabaseAdmin.from("audit_logs").insert({
      entity_name: "financial",
      action: "MANUAL_ENTRY",
      description,
      payload,
      created_by: "sistema",
    });
  } catch {
    // Nao interrompe o fluxo principal se a trilha falhar.
  }
}

function clearFinancialReadCaches() {
  clearMemoryCache("financial:");
  clearMemoryCache("closing:");
  clearMemoryCache("dashboard:");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    const payload = await buildFinancialAnalytics({ year, month });
    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar financeiro." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body?.action || "").trim();
    const supabaseAdmin = getSupabaseAdmin();

    if (action === "expense") {
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
        return Response.json(
          { error: "Informe competencia, descricao e valor valido para a despesa." },
          { status: 400 }
        );
      }

      const { data, error } = await supabaseAdmin
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

      clearFinancialReadCaches();
      await writeAuditLog("Lancamento manual de despesa", {
        expense_id: data.id,
        year,
        month,
        scope,
        company_id: scope === "COMPANY" ? companyId : null,
        amount,
      });

      return Response.json({ success: true, id: data.id });
    }

    if (action === "opening_balance") {
      const year = Number(body.year);
      const month = Number(body.month);
      const openingBalance = toNumber(body.openingBalance);
      const scope = String(body.scope || "GROUP").toUpperCase();
      const companyId = body.companyId ? String(body.companyId) : null;

      if (!year || !month) {
        return Response.json(
          { error: "Informe a competencia do saldo inicial." },
          { status: 400 }
        );
      }

      const query = supabaseAdmin
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
        const { error } = await supabaseAdmin
          .from("cash_opening_balances")
          .update({
            opening_balance: openingBalance,
          })
          .eq("id", existing.id);

        if (error) {
          throw error;
        }

        clearFinancialReadCaches();
        await writeAuditLog("Atualizacao manual de saldo inicial", {
          opening_balance_id: existing.id,
          year,
          month,
          scope,
          company_id: scope === "COMPANY" ? companyId : null,
          opening_balance: openingBalance,
        });

        return Response.json({ success: true, id: existing.id, updated: true });
      }

      const { data, error } = await supabaseAdmin
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

      clearFinancialReadCaches();
      await writeAuditLog("Lancamento manual de saldo inicial", {
        opening_balance_id: data.id,
        year,
        month,
        scope,
        company_id: scope === "COMPANY" ? companyId : null,
        opening_balance: openingBalance,
      });

      return Response.json({ success: true, id: data.id, updated: false });
    }

    if (action === "category") {
      const name = String(body.name || "").trim();

      if (!name) {
        return Response.json(
          { error: "Informe o nome da categoria." },
          { status: 400 }
        );
      }

      const { data, error } = await supabaseAdmin
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

      clearFinancialReadCaches();
      await writeAuditLog("Criacao ou reativacao de categoria de despesa", {
        category_id: data.id,
        name: data.name,
      });

      return Response.json({ success: true, category: data });
    }

    return Response.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao salvar informacao financeira." },
      { status: 500 }
    );
  }
}
