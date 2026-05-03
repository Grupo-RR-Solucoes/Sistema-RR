import { buildReportExport } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const file = await buildReportExport({
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
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao exportar relatorio." },
      { status: 500 }
    );
  }
}
