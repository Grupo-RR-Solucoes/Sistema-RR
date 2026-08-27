import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { extractBbtsClosingFromPdfs } from "@/lib/bbtsPdfExtract";
import { importBbtsClosing, BBTS_COMPANY_ID } from "@/lib/bbtsClosingImport";
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

    // ------------------------------------------------------------------------
    // AUSENCIA != ZERO. Sem o PDF de seguro, a ancora seguro_calculo fica
    // esperado=0 / obtido=0 e o gate PASSA — medido em 27/08/2026 com o
    // fechamento de julho: ancora_ok=true, e nada avisava. O importador ja nao
    // ZERA mais as colunas de seguro (as chaves sao OMITIDAS), mas seguir em
    // frente ainda deixa a competencia META-PROCESSADA em silencio. Entao: PARA,
    // com o tamanho do que ficaria de fora, e so segue com semSeguro=true.
    // ------------------------------------------------------------------------
    if (!seguroData && body.semSeguro !== true) {
      const propostas = input.credito.map((r) => String(r.contrato).trim());
      const { data: jaGravadas } = await supabase
        .from("daily_production_records")
        .select("proposal_number, bbts_seguro_pago, insurance_value")
        .eq("company_id", BBTS_COMPANY_ID)
        .in("proposal_number", propostas);
      const comSeguro = (jaGravadas ?? []).filter(
        (r) => Number(r.bbts_seguro_pago) > 0 || Number(r.insurance_value) > 0
      );
      const somaSeguroPago = comSeguro.reduce((a, r) => a + (Number(r.bbts_seguro_pago) || 0), 0);
      const somaInsurance = comSeguro.reduce((a, r) => a + (Number(r.insurance_value) || 0), 0);
      const brl = (v: number) =>
        v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      return NextResponse.json(
        {
          error:
            `O PDF de SEGURO nao foi enviado. A competencia ${input.month}/${input.year} ficaria ` +
            `meio processada: o crédito entra e o seguro nao — e o gate NAO detecta isso ` +
            `sozinho, porque a ancora sai do proprio arquivo (ausencia e zero sao ` +
            `indistinguiveis para ele).`,
          competencia: `${input.year}-${String(input.month).padStart(2, "0")}`,
          propostas_credito: input.credito.length,
          linhas_com_seguro_ja_gravado: comSeguro.length,
          seguro_pago_ja_gravado: somaSeguroPago,
          insurance_value_ja_gravado: somaInsurance,
          detalhe:
            comSeguro.length > 0
              ? `Hoje ha ${comSeguro.length} linhas destas propostas com seguro gravado ` +
                `(${brl(somaSeguroPago)} de comissao paga e ${brl(somaInsurance)} de base ` +
                `segurada). Elas NAO serao apagadas — as colunas de seguro ficam ` +
                `intocadas —, mas o seguro desta competencia continuara faltando.`
              : "Nenhuma linha destas propostas tem seguro gravado hoje.",
          como_prosseguir:
            "Envie tambem o PDF de seguro, ou reenvie com semSeguro=true para importar so o credito.",
        },
        { status: 409 }
      );
    }

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
      seguro_pdf_ausente: res.seguro_pdf_ausente,
      abertura_conta: res.abertura_conta,
      cabecalho_gravado: res.cabecalho_gravado,
      cabecalho_aviso: (res as { cabecalho_aviso?: string }).cabecalho_aviso ?? null,
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
