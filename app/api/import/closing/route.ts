import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { persistInadimplenciaSnapshot } from "@/lib/auditoria/persistInadimplencia";
import {
  DuplicateImportInFlightError,
  importMonthlyClosingWorkbook,
} from "@/lib/monthlyClosingImport";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    // D34 - Escola A: service_role com guard de socio. Bulk write em
    // fechamento_mensal_empresa + monthly_closing_entries (D5 bloqueia
    // promotor; D2 bloqueia funcionario).
    const { user } = await withSocioAdmin();

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
      createdBy: user.session.appUser.email,
    });

    // Camada 3 — gatilho pós-importação do monitor de inadimplência PRT.
    // Roda para a competência DO FECHAMENTO recém-importado (year/month = a
    // mesma competência usada em fechamento_mensal_empresa, não a de caixa).
    // É efeito colateral: a importação já concluiu com sucesso acima, então
    // qualquer falha aqui é logada mas NÃO derruba o import. Idempotente — o
    // UPSERT por (competencia, operation_number) garante que re-importar a
    // mesma competência não duplica linhas.
    let inadimplenciaMonitor: {
      ran: boolean;
      novos?: number;
      error?: string;
    } = { ran: false };
    try {
      const snapshot = await persistInadimplenciaSnapshot(getSupabaseAdmin(), {
        competencia: { year, month },
        lookbackParadaMeses: 3,
      });
      inadimplenciaMonitor = { ran: true, novos: snapshot.resumo.novos };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `monitor inadimplência: ${snapshot.resumo.novos} novos detectados ` +
          `(emCobranca=${snapshot.resumo.emCobranca}, recuperados=${snapshot.resumo.recuperados}, ` +
          `ressurgidos=${snapshot.resumo.ressurgidos}).`
      );
    } catch (monitorError) {
      const message =
        monitorError instanceof Error
          ? monitorError.message
          : "Erro desconhecido no monitor de inadimplência.";
      inadimplenciaMonitor = { ran: false, error: message };
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `monitor de inadimplência falhou (import preservado): ${message}`
      );
    }

    return NextResponse.json({ ...payload, inadimplenciaMonitor });
  } catch (error) {
    if (error instanceof DuplicateImportInFlightError) {
      return NextResponse.json(
        {
          error: error.message,
          importId: error.importId,
          startedAt: error.startedAt,
        },
        { status: 409 }
      );
    }
    return apiGuardErrorResponse(error);
  }
}
