import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/auth/supabaseServerClient";
import { getCurrentUser } from "@/lib/auth/getUser";

import DespesasList, {
  type CompanyOption,
  type CategoryOption,
  type ExpenseRow,
} from "./DespesasList";

export const dynamic = "force-dynamic";

/**
 * /despesas — server component.
 *
 * Gate manual (server-side equivalente ao requireSocioOrFuncionario):
 *   - sem sessao -> middleware ja redirecionou para /login
 *   - role 'promotor' -> redirect para /
 *   - socio + funcionario: acesso liberado (Dia 4.3 Etapa 4.3.1
 *     ja preparou backend role-aware com guards no /api/financeiro)
 *
 * Fetch inicial server-side via Escola B (cliente anon autenticado):
 * RLS Grupo F naturalmente filtra para o role corrente. Atualizacoes
 * subsequentes via mutations no DespesasList passam pelos handlers
 * /api/financeiro (POST) e /api/financeiro/[id] (PATCH/DELETE) que
 * tem guards proprios.
 */
export default async function DespesasPage() {
  const session = await getCurrentUser();
  if (!session) {
    redirect("/login");
  }
  if (
    session.appUser.role !== "socio" &&
    session.appUser.role !== "funcionario"
  ) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();

  const [companiesRes, categoriesRes, expensesRes] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, cnpj, active")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("expense_categories")
      .select("id, name, active")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("financial_expenses")
      .select(
        "id, company_id, year, month, category_id, scope, description, amount, due_date, payment_date, status, notes, created_at"
      )
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .order("due_date", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  const initialCompanies = (companiesRes.data ?? []) as CompanyOption[];
  const initialCategories = (categoriesRes.data ?? []) as CategoryOption[];
  const initialExpenses = (expensesRes.data ?? []) as ExpenseRow[];
  const loadError =
    companiesRes.error?.message ??
    categoriesRes.error?.message ??
    expensesRes.error?.message ??
    null;

  return (
    <DespesasList
      initialCompanies={initialCompanies}
      initialCategories={initialCategories}
      initialExpenses={initialExpenses}
      loadError={loadError}
      currentUserId={session.appUser.id}
      currentUserRole={session.appUser.role}
    />
  );
}
