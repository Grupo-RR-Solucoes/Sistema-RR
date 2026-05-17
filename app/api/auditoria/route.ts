import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";

export async function GET(req: Request) {
  try {
    // D13 - socio-only. Auditoria de fechamento mensal expoe gaps por
    // empresa que sao sensiveis (decisao executiva).
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    const payload = await buildClosingAnalytics(supabase, { year, month });

    return NextResponse.json({
      periods: payload.periods,
      selectedPeriod: payload.selectedPeriod,
      summary: payload.summary,
      highlights: payload.highlights,
      alerts: payload.alerts,
      rows: payload.companyRows
        .map((row) => ({
          ...row,
          severity:
            Math.abs(row.deltaTotal) >= 10000
              ? "critico"
              : Math.abs(row.deltaTotal) >= 3000
                ? "atencao"
                : "ok",
        }))
        .sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal)),
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
