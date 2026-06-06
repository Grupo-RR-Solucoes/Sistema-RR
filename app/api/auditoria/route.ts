import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildAuditoria } from "@/lib/auditoria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // D13 — socio-only. Recuperável NOVO (curado v9 vs cobranças emitidas, trava
    // anti-dupla) + já-cobrado (âncora) + Ciclo PRT do mês.
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year")) || undefined;
    const month = Number(searchParams.get("month")) || undefined;

    const nowD = new Date();
    const now = { year: nowD.getUTCFullYear(), month: nowD.getUTCMonth() + 1 };

    const payload = await buildAuditoria(supabase, now, year, month);
    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
