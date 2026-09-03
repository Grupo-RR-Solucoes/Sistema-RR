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
//
// ?competencia=YYYY-MM — congela ESSA competência, em vez do max(competencia) de
// carteira_contrato. É a CHAMADA EXPLÍCITA do catch-up (a outra porta é o import
// seguinte, que lê a fila de materialização). Sem este parâmetro, o vintage de
// 2026-07 é inalcançável: a materialização morreu em 07/07, e quando rodou
// (02/09) reconstruiu a carteira de 2026-01 em diante — julho ESTÁ lá — mas o
// max já era 2026-08 e só o max podia ser pedido. previsao_snapshot é
// write-once: vintage não congelado na hora só volta por aqui.
export async function POST(req: Request) {
  try {
    await withSocioAdmin();
    const params = new URL(req.url).searchParams;
    const dryRun = params.get("dryRun") === "1";
    const competencia = params.get("competencia") || undefined;
    const congel = await congelarPrevisao(getSupabaseAdmin(), { dryRun, competencia });
    return NextResponse.json({
      success: true,
      dryRun: congel.dryRun,
      snapshot: congel.competenciaSnapshot,
      // Diz se a competência veio do parâmetro ou do max da carteira — o max é o
      // caminho que perdeu um vintage, e quem lê a resposta tem de saber qual foi.
      competenciaOrigem: congel.competenciaOrigem,
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
