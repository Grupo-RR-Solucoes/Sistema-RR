import { buildClosingAnalytics } from "@/lib/closingAnalytics";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0) || undefined;
    const month = Number(searchParams.get("month") || 0) || undefined;

    const payload = await buildClosingAnalytics({ year, month });
    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao carregar fechamento." },
      { status: 500 }
    );
  }
}

