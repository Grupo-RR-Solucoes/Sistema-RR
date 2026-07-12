import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { congelarPrevisao } from "@/lib/recebiveis/congelarPrevisao";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pipeline de Recebíveis (sub-PR 1) — ação MANUAL de congelamento da previsão.
// Sócio-only (ferramenta financeira, escreve em previsao_snapshot via service_role).
// Serve para: (a) o SEED inicial (congelar a curva forward vigente já, sem esperar o
// próximo fechamento), (b) rede de segurança se o hook do fechamento falhar e
// (c) RECONGELAR um vintage depois de apagá-lo (é a rota que reconstrói jun/2026).
// Write-once (ON CONFLICT DO NOTHING) — rodar 2x não duplica E AVISA que não gravou.
//
// ?dryRun=1 — calcula e confere SEM gravar (útil pra ver o que o recongelamento
// produziria antes de apagar o vintage velho).
export async function POST(req: Request) {
  try {
    await withSocioAdmin();
    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const congel = await congelarPrevisao(getSupabaseAdmin(), { dryRun });
    return NextResponse.json({
      success: true,
      dryRun: congel.dryRun,
      snapshot: congel.competenciaSnapshot,
      linhasGravadas: congel.linhasGravadas,
      linhasProjetadas: congel.linhasProjetadas,
      // Anti-silêncio: se o vintage já existia, isto DIZ que nada foi gravado —
      // e se o que está gravado está incompleto, diz isso também.
      vintageJaExistia: congel.vintageJaExistia,
      linhasDescartadas: congel.linhasDescartadas,
      vintageIncompleto: congel.vintageIncompleto,
      avisos: congel.avisos,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
