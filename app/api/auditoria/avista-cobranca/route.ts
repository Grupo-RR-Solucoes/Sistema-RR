/**
 * GET /api/auditoria/avista-cobranca?year=2026&month=4
 *
 * Gera a MINUTA DE COBRANÇA À VISTA da competência: carta .docx + anexo .xlsx
 * (lista completa das divergências), empacotados num único .zip. Consome a
 * auditoria viva (FECHAMENTO-PRIMÁRIO) e cobra os subpagamentos vs a TRP.
 *
 * Auth: withSocioAnon (socio-only). READ-ONLY (não grava). Se a competência não
 * tem divergências cobráveis → 400 (não há o que cobrar; nada é gerado).
 */
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  auditAvistaMesVivo,
  extrairDivergenciasCobravel,
} from "@/lib/auditoriaAvistaViva";
import { construirDocx } from "@/lib/minutas/docxBuilder";
import {
  construirAnexoAvistaXlsx,
  montarMinutaAvista,
} from "@/lib/minutas/minutaAvista";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await withSocioAnon();
  } catch (error) {
    return apiGuardErrorResponse(error);
  }

  const { searchParams } = new URL(req.url);
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const month = Number.parseInt(searchParams.get("month") ?? "", 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "year e month obrigatórios e válidos (month: 1-12)" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const r = await auditAvistaMesVivo(sb, year, month);
    const divergencias = extrairDivergenciasCobravel(r);

    if (divergencias.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhum subpagamento à vista nesta competência. Não há cobrança a emitir.",
        },
        { status: 400 }
      );
    }

    const minuta = montarMinutaAvista({
      ym: r.ym,
      faixa: r.faixa.faixa,
      divergencias,
      somaACobrar: r.resumo.somaSubpagamento,
      emissao: new Date(),
    });

    const [docxBuffer, xlsxBuffer] = await Promise.all([
      construirDocx(minuta),
      construirAnexoAvistaXlsx(r.ym, divergencias, r.faixa.faixa),
    ]);

    const zip = new JSZip();
    zip.file(`${minuta.nomeArquivo}.docx`, docxBuffer);
    zip.file(`anexo-divergencias-avista-${r.ym}.xlsx`, xlsxBuffer);
    const zipBuffer = (await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    })) as Buffer;

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="cobranca-avista-${r.ym}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
