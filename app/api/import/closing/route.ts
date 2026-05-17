import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { importMonthlyClosingWorkbook } from "@/lib/monthlyClosingImport";

export async function POST(req: Request) {
  try {
    // D34 - Escola A: service_role com guard de socio. Bulk write em
    // fechamento_mensal_empresa + monthly_closing_entries (D5 bloqueia
    // promotor; D2 bloqueia funcionario).
    await withSocioAdmin();

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);

    if (!body.file || !year || !month) {
      return NextResponse.json(
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

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
