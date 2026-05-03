import { buildClosingAnalytics } from "@/lib/closingAnalytics";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    const payload = await buildClosingAnalytics({ year, month });

    return Response.json({
      periods: payload.periods,
      selectedPeriod: payload.selectedPeriod,
      summary: payload.summary,
      highlights: payload.highlights,
      alerts: payload.alerts,
      rows: payload.companyRows
        .map((row) => ({
          ...row,
          severity:
            Math.abs(row.deltaTotal) >= 10000
              ? "critico"
              : Math.abs(row.deltaTotal) >= 3000
                ? "atencao"
                : "ok",
        }))
        .sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal)),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar auditoria." },
      { status: 500 }
    );
  }
}

