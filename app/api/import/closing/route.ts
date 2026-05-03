import { importMonthlyClosingWorkbook } from "@/lib/monthlyClosingImport";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);

    if (!body.file || !year || !month) {
      return Response.json(
        { error: "Informe arquivo, ano e mes da importacao." },
        { status: 400 }
      );
    }

    const payload = await importMonthlyClosingWorkbook({
      fileBase64: String(body.file),
      fileName: String(body.fileName || "fechamento.xlsx"),
      year,
      month,
      companyId: body.companyId ? String(body.companyId) : undefined,
    });

    return Response.json(payload);
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Erro ao importar fechamento mensal." },
      { status: 500 }
    );
  }
}

