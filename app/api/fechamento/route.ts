import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";

export async function GET(req: Request) {
  try {
    // D18 - socio-only. Fechamento mensal por empresa.
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    const payload = await buildClosingAnalytics(supabase, { year, month });
    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
