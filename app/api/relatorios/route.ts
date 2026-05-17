import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildReportPreview } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // D32 - socio-only. Relatorios consomem buildClosingAnalytics +
    // buildFinancialAnalytics + buildPromoterAnalytics indiretamente via
    // lib/report; todas tocam tabelas restritas a socio por D2.
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);

    const payload = await buildReportPreview(supabase, {
      type: searchParams.get("type"),
      scope: searchParams.get("scope") || undefined,
      year: Number(searchParams.get("year") || 0) || undefined,
      month: Number(searchParams.get("month") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: searchParams.get("promoterId") || undefined,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
