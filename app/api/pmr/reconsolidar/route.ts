import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { clearMemoryCache } from "@/lib/memoryCache";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";

// ============================================================================
// /api/pmr/reconsolidar — MOVIMENTO 1: reescreve o PMR FECHADO da competencia
// (RR + ADS) pelo orquestrador e reconcilia a fatia (apaga sobras 'daily' e
// orfaos 'fechamento'/'bbts'). Socio-only.
//
// PARA QUE SERVE:
//   - BACKFILL: competencias que fecharam ANTES desta frente e ficaram sem PMR
//     fechado (abril/2026: regime 'fechamento' com PMR 100% source='daily').
//   - RE-FECHAMENTO: reimportou o fechamento, atribuiu orfaos, mexeu na chave
//     master -> reconsolida sem precisar reimportar o arquivo.
//
// Idempotente: rodar 2x = mesmo estado. dryRun=true devolve o plano sem gravar.
// Em regime 'cms' (jan-mai) e 'open' a funcao se recusa por guarda — o
// historico do financeiro e o mes vivo nao sao tocados.
// ============================================================================

export async function POST(req: Request) {
  try {
    await withSocioAdmin();

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const dryRun = body.dryRun === true;

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Informe ano e mes validos." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const res = await reconsolidarCompetenciaFechada(supabase, { year, month, dryRun });

    if (!dryRun && res.ran) {
      clearMemoryCache("closing:");
      clearMemoryCache("financial:");
      clearMemoryCache("promoters:");
      clearMemoryCache("dashboard:");
    }

    return NextResponse.json({ success: true, ...res });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
