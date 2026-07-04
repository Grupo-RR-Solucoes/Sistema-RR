import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { congelarPrevisao } from "@/lib/recebiveis/congelarPrevisao";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pipeline de Recebíveis (sub-PR 1) — ação MANUAL de congelamento da previsão.
// Sócio-only (ferramenta financeira, escreve em previsao_snapshot via service_role).
// Serve para: (a) o SEED inicial (congelar a curva forward vigente já, sem esperar o
// próximo fechamento) e (b) rede de segurança se o hook do fechamento falhar.
// Idempotente (ON CONFLICT DO NOTHING) — rodar 2x não duplica.
export async function POST() {
  try {
    await withSocioAdmin();
    const congel = await congelarPrevisao(getSupabaseAdmin());
    return NextResponse.json({
      success: true,
      snapshot: congel.competenciaSnapshot,
      linhasGravadas: congel.linhasGravadas,
      linhasProjetadas: congel.linhasProjetadas,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
