import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectRulesStale } from "@/lib/rulesFingerprint";

// ============================================================================
// GET /api/detector/regras — DETECTOR de regua obsoleta, CAMADA 2 (hash de
// conteudo). READ-ONLY: recomputa o fingerprint das reguas de cada competencia
// fechada e confronta com o baseline gravado. NAO grava, NAO recalcula PMR.
// Devolve os buckets SEPARADOS (alteradas = STALE ; desconhecidas) + a lista de
// competencias para o contador clicavel do PmrReconsolidarCard. Socio-only
// (mesmo guard do reconsolidar e da Camada 1). Ver lib/rulesFingerprint.ts.
// ============================================================================

export async function GET() {
  try {
    await withSocioAdmin();

    const supabase = getSupabaseAdmin();
    const res = await detectRulesStale(supabase);

    return NextResponse.json({ success: true, ...res });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
