import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectTrpStaleCrossFechadas } from "@/lib/trp/detectorReguaObsoleta";

// ============================================================================
// GET /api/detector/trp-fechadas — DETECTOR de regua obsoleta, CAMADA 1 (TRP),
// CROSS-COMPETENCIA. READ-ONLY: roda detectTrpStaleForCompetencia em cada
// competencia FECHADA (>= 2026-01) e devolve os buckets SEPARADOS (alteradas =
// STALE ; desconhecidas) no MESMO shape que a Camada 2 (/api/detector/regras)
// para o contador clicavel do PmrReconsolidarCard. NAO grava, NAO recalcula PMR.
// Socio-only (mesmo guard do reconsolidar e da Camada 1 por competencia).
// Ver lib/trp/detectorReguaObsoleta.ts (detectTrpStaleCrossFechadas).
// ============================================================================

export async function GET() {
  try {
    await withSocioAdmin();

    const supabase = getSupabaseAdmin();
    const res = await detectTrpStaleCrossFechadas(supabase);

    return NextResponse.json({ success: true, ...res });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
