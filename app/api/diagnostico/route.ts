import { getSupabaseAdmin, hasSupabaseEnv } from "@/lib/supabaseAdmin";

const criticalTables = [
  "companies",
  "promoters",
  "j_keys",
  "daily_production_records",
  "fechamento_mensal_empresa",
  "expense_categories",
  "access_profiles",
  "app_users",
] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TableStatus = {
  table: string;
  ok: boolean;
  count: number | null;
  error?: string;
};

async function checkTable(table: string): Promise<TableStatus> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { count, error } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) {
      return {
        table,
        ok: false,
        count: null,
        error: error.message,
      };
    }

    return {
      table,
      ok: true,
      count: Number(count ?? 0),
    };
  } catch (error: any) {
    return {
      table,
      ok: false,
      count: null,
      error: error.message || "Falha ao consultar tabela.",
    };
  }
}

export async function GET() {
  const env = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  if (!hasSupabaseEnv()) {
    return Response.json({
      status: "warning",
      timestamp: new Date().toISOString(),
      env,
      database: {
        connected: false,
        checkedTables: 0,
        healthyTables: 0,
      },
      tables: [] satisfies TableStatus[],
      message:
        "As variaveis principais do Supabase ainda nao foram configuradas. O sistema pode compilar, mas nao consegue consultar o banco.",
    });
  }

  const tableChecks = await Promise.all(criticalTables.map((table) => checkTable(table)));
  const healthyTables = tableChecks.filter((table) => table.ok).length;

  return Response.json({
    status: healthyTables === criticalTables.length ? "ok" : "warning",
    timestamp: new Date().toISOString(),
    env,
    database: {
      connected: healthyTables > 0,
      checkedTables: criticalTables.length,
      healthyTables,
    },
    tables: tableChecks,
    message:
      healthyTables === criticalTables.length
        ? "Ambiente e banco responderam normalmente."
        : "O ambiente respondeu, mas ainda existe tabela critica sem leitura valida.",
  });
}
