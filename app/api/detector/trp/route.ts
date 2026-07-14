import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectTrpStaleForCompetencia } from "@/lib/trp/detectorReguaObsoleta";

// ============================================================================
// GET /api/detector/trp?year=&month= — DETECTOR de regua obsoleta, CAMADA 1 (TRP).
// READ-ONLY: compara a versao da TRP que produziu cada linha do PMR com a versao
// vigente HOJE. NAO grava, NAO recalcula. So torna visivel o que estava mudo.
// Socio-only (mesmo guard do reconsolidar). Ver lib/trp/detectorReguaObsoleta.ts.
// ============================================================================

export async function GET(req: Request) {
  try {
    await withSocioAdmin();

    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Informe ano e mes validos." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const res = await detectTrpStaleForCompetencia({ year, month }, supabase);

    return NextResponse.json({ success: true, ...res });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
