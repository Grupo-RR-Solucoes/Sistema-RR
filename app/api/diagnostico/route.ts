import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { getSupabaseAdmin, hasSupabaseEnv } from "@/lib/supabaseAdmin";
import { buildLedgerHealth, type LedgerHealth } from "@/lib/diagnostico/ledgerHealth";

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

type GuardSupabase = Awaited<ReturnType<typeof withSocioAnon>>["supabase"];

async function checkTable(supabase: GuardSupabase, table: string): Promise<TableStatus> {
  try {
    const { count, error } = await supabase
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
  try {
    const { supabase } = await withSocioAnon();

    const env = {
      supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    };

    if (!hasSupabaseEnv()) {
      return NextResponse.json({
        status: "warning",
        timestamp: new Date().toISOString(),
        env,
        database: {
          connected: false,
          checkedTables: 0,
          healthyTables: 0,
        },
        tables: [] satisfies TableStatus[],
        // Sem env nao ha service_role para ler o PMR: a secao ledger fica nula
        // (nao ha como afirmar integridade, nem faz sentido acender erro).
        ledger: null,
        message:
          "As variaveis principais do Supabase ainda nao foram configuradas. O sistema pode compilar, mas nao consegue consultar o banco.",
      });
    }

    const tableChecks = await Promise.all(
      criticalTables.map((table) => checkTable(supabase, table))
    );
    const healthyTables = tableChecks.filter((table) => table.ok).length;

    // Secao 'ledger' — o vigia do cofre (promoter_monthly_results). ADITIVA:
    // env/database/tables ficam INALTERADOS. Roda com service_role (as RPCs do
    // detector sao grant-to-service_role e as tabelas RLS default-deny); por
    // isso NAO reusa o client anon acima. Se falhar, reporta como erro do
    // ledger em vez de derrubar o diagnostico inteiro (a base ja respondeu).
    let ledger: LedgerHealth | { status: "erro"; checks: []; message: string } | null = null;
    try {
      ledger = await buildLedgerHealth(getSupabaseAdmin());
    } catch (error: any) {
      ledger = {
        status: "erro",
        checks: [],
        message: `Falha ao avaliar o ledger (PMR): ${error?.message || "erro desconhecido"}`,
      };
    }

    // Status do envelope: parte da saude das tabelas (ok|warning) e ESCALA com
    // o ledger — 'error' se o ledger tem erro; 'warning' se so alerta. Info do
    // ledger nunca muda o status.
    const tablesStatus: "ok" | "warning" =
      healthyTables === criticalTables.length ? "ok" : "warning";
    let status: "ok" | "warning" | "error" = tablesStatus;
    if (ledger && ledger.status === "erro") status = "error";
    else if (ledger && ledger.status === "alerta" && status === "ok") status = "warning";

    const tablesMessage =
      healthyTables === criticalTables.length
        ? "Ambiente e banco responderam normalmente."
        : "O ambiente respondeu, mas ainda existe tabela critica sem leitura valida.";

    return NextResponse.json({
      status,
      timestamp: new Date().toISOString(),
      env,
      database: {
        connected: healthyTables > 0,
        checkedTables: criticalTables.length,
        healthyTables,
      },
      tables: tableChecks,
      ledger,
      message:
        status === "error"
          ? "O ambiente respondeu, mas o cofre (PMR) tem invariante violada."
          : status === "warning"
            ? tablesStatus === "warning"
              ? tablesMessage
              : "Base integra; ha alerta brando no ledger (PMR)."
            : tablesMessage,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
