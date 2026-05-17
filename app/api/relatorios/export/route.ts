import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildReportExport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // D33 - socio-only. Mesma justificativa de D32: export consome
    // buildClosingAnalytics + buildFinancialAnalytics + buildPromoterAnalytics
    // que tocam tabelas restritas a socio por D2.
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);

    const file = await buildReportExport(supabase, {
      type: searchParams.get("type"),
      format: searchParams.get("format"),
      scope: searchParams.get("scope") || undefined,
      year: Number(searchParams.get("year") || 0) || undefined,
      month: Number(searchParams.get("month") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: searchParams.get("promoterId") || undefined,
    });

    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
