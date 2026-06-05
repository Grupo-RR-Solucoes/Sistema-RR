import {
  apiGuardErrorResponse,
  withSocioAnon,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { buildReportExport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    // ETAPA 7 — relatorio de PROMOTOR: socio + funcionario (espelha o
    // PromotorView, que funcionario ja acessa). Demais tipos (financeiro/
    // fechamento/auditoria) tocam tabelas restritas a socio por D2 -> socio-only.
    const { supabase } =
      type === "promotores"
        ? await withSocioOrFuncionarioAnon()
        : await withSocioAnon();

    const file = await buildReportExport(supabase, {
      type,
      format: searchParams.get("format"),
      scope: searchParams.get("scope") || undefined,
      order: searchParams.get("order") || undefined,
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
