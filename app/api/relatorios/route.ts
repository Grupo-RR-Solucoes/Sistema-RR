import { buildReportPreview } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const payload = await buildReportPreview({
      type: searchParams.get("type"),
      scope: searchParams.get("scope") || undefined,
      year: Number(searchParams.get("year") || 0) || undefined,
      month: Number(searchParams.get("month") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: searchParams.get("promoterId") || undefined,
    });

    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar relatorios." },
      { status: 500 }
    );
  }
}
