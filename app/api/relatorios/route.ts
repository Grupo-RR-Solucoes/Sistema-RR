import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioAnon,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { buildReportPreview } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    // Etapa 8 — preview de PROMOTORES liberado p/ socio + funcionario (espelha o
    // guard do /export e o que o func ja ve em /promotores). Os tipos financeiros
    // (financeiro/fechamento/auditoria) tocam tabelas de empresa restritas a
    // socio por D2 -> seguem socio-only. ZERO financeiro da empresa pro func.
    const { supabase } =
      type === "promotores"
        ? await withSocioOrFuncionarioAnon()
        : await withSocioAnon();

    const payload = await buildReportPreview(supabase, {
      type,
      scope: searchParams.get("scope") || undefined,
      year: Number(searchParams.get("year") || 0) || undefined,
      month: Number(searchParams.get("month") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: searchParams.get("promoterId") || undefined,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
