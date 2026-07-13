import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractBbtsClosingFromPdfs } from "@/lib/bbtsPdfExtract";
import { importBbtsClosing } from "@/lib/bbtsClosingImport";
import { clearMemoryCache } from "@/lib/memoryCache";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";

// ============================================================================
// /api/import/closing/ads — FECHAMENTO da ADS/BBTS por 2 PDFs (crédito + seguro).
// Extrai server-side (unpdf, âncora-em-rótulo) → BbtsClosingInput → importBbtsClosing,
// que VALIDA as âncoras e ABORTA sem gravar se não fechar (nunca parcial). Escreve
// em daily_production_records (company ADS) via merge por dono de coluna (FULL).
// Socio-only (mesmo guard do fechamento). dryRun=true só valida/conta.
// ============================================================================

export async function POST(req: Request) {
  try {
    const { user } = await withSocioAdmin();
    const body = await req.json();

    if (!body.creditoFile) {
      return NextResponse.json({ error: "Envie ao menos o PDF de crédito da ADS." }, { status: 400 });
    }
    const dryRun = body.dryRun === true;

    const creditoData = new Uint8Array(Buffer.from(String(body.creditoFile), "base64"));
    const seguroData = body.seguroFile
      ? new Uint8Array(Buffer.from(String(body.seguroFile), "base64"))
      : null;

    let input;
    try {
      input = await extractBbtsClosingFromPdfs(creditoData, seguroData);
    } catch (e: any) {
      // erro de extração (PDF imagem, âncora não fecha, layout desconhecido)
      return NextResponse.json({ error: `Extração do PDF falhou: ${e?.message || e}` }, { status: 422 });
    }

    const supabase = getSupabaseAdmin();
    let res;
    try {
      res = await importBbtsClosing(supabase, input, {
        dryRun,
        fileName: String(body.fileName || "fechamento_ads.pdf"),
      });
    } catch (e: any) {
      // gate de âncora do importBbtsClosing (não fechou => nada gravado)
      return NextResponse.json({ error: `Âncora do fechamento não fechou: ${e?.message || e}` }, { status: 422 });
    }

    // MOVIMENTO 1 — LEDGER: o fechamento da ADS tambem muda a linha ADS do PMR
    // (e, via penetracao/meta CONSOLIDADAS RR+ADS, a linha RR junto). Se a
    // competencia ja estiver FECHADA, reconsolida na hora — senao a ADS
    // dependeria de rodar rodarBbtsOrchestrator na mao. Em mes ABERTO a funcao
    // e no-op por guarda de regime. NAO best-effort: falha aqui vira erro.
    let pmrFechado = null;
    if (!dryRun) {
      pmrFechado = await reconsolidarCompetenciaFechada(supabase, {
        year: input.year,
        month: input.month,
        dryRun: false,
      });
      clearMemoryCache("closing:");
      clearMemoryCache("promoters:");
      clearMemoryCache("dashboard:");
    }

    return NextResponse.json({
      success: true,
      dry_run: res.dry_run,
      year: input.year,
      month: input.month,
      pmr_fechado: pmrFechado,
      ancora_ok: res.ancora_ok,
      ancora_detalhe: res.ancora_detalhe,
      propostas: res.propostas,
      soma_valor_financiado: res.soma_valor_financiado,
      soma_pag_avista: res.soma_pag_avista,
      soma_seguro_calculo: res.soma_seguro_calculo,
      soma_seguro_debito: res.soma_seguro_debito,
      com_seguro: res.com_seguro,
      seguro_only_lines: res.seguro_only_lines,
      gravadas: res.gravadas,
      importedBy: user.session.appUser.email,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
