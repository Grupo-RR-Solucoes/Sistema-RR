import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { buildPromoterBatchExport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ETAPA 7 — EXPORT EM LOTE de relatorios de promotor.
// Guard socio + funcionario (igual ao export individual de promotor); promotor
// NAO acessa. Self-hosted, sincrono: fetch-once + N workbooks em memoria.
export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAnon();

    const { searchParams } = new URL(req.url);

    const file = await buildPromoterBatchExport(supabase, {
      year: Number(searchParams.get("ano") || 0) || undefined,
      month: Number(searchParams.get("mes") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      mode: searchParams.get("modo") || undefined,
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
