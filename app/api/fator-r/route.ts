import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { calcularFatorR } from "@/lib/fatorR";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// MONITOR FISCAL / FATOR R — API por CNPJ. socio-only (mesmo guard do dashboard).
// READ-ONLY. Default = competência fiscal atual (calcularRbt12 trata o shift).
// ============================================================

export async function GET() {
  try {
    const { supabase } = await withSocioAnon();
    const now = new Date();
    const payload = await calcularFatorR(supabase, {
      ano: now.getUTCFullYear(),
      mes: now.getUTCMonth() + 1,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
