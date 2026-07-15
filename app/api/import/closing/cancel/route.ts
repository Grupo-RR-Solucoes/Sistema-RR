import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";

export async function POST(req: Request) {
  try {
    // FIX-1.E.6.PRE.D.D — destrava manualmente PROCESSING zumbi. Guard de
    // socio porque cancelar import afeta o fechamento mensal (mesma alcada
    // do upload).
    const { user, supabase: supabaseAdmin } = await withSocioAdmin();

    const body = await req.json().catch(() => ({}));
    const importId = body?.importId ? String(body.importId) : "";

    if (!importId) {
      return NextResponse.json(
        { error: "Informe o importId do registro PROCESSING a cancelar." },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("monthly_closing_imports")
      .select("id, company_id, year, month, file_name, status, created_at")
      .eq("id", importId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Import nao encontrado." },
        { status: 404 }
      );
    }

    if (existing.status !== "PROCESSING") {
      return NextResponse.json(
        {
          error: `Import nao esta em PROCESSING (status atual: ${existing.status}). Nada a cancelar.`,
        },
        { status: 409 }
      );
    }

    // Limpa entries parciais (caso INSERT em massa tenha completado parcial).
    const { error: deleteEntriesError } = await supabaseAdmin
      .from("monthly_closing_entries")
      .delete()
      .eq("monthly_closing_import_id", importId);

    if (deleteEntriesError) {
      throw new Error(deleteEntriesError.message);
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("monthly_closing_imports")
      .update({
        status: "CANCELLED",
        error_message: "Cancelado manualmente pelo usuario",
        error_at: nowIso,
        finished_at: nowIso,
      })
      .eq("id", importId)
      .eq("status", "PROCESSING"); // defensivo contra race

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Guarda #8 (defesa da janela de crash): apagar as entries deste import pode
    // ter deixado o PMR da competencia calculado sobre um conjunto que ja mudou
    // (ex.: import que rodou a reconsolidacao e foi cancelado ANTES do
    // markImportCompleted). Reconsolida best-effort: reconsolidarCompetenciaFechada
    // SE AUTO-GUARDA — recomputa do conjunto RESTANTE de entries se a competencia
    // ainda e 'fechamento', e e no-op se caiu para 'open'. NAO apaga o PMR (isso
    // quebraria a invariante do Mov 1: regime fechado => PMR existe). Falha aqui
    // NAO invalida o cancel (o destravamento do PROCESSING zumbi ja aconteceu).
    let reconsolidado: unknown = null;
    try {
      reconsolidado = await reconsolidarCompetenciaFechada(supabaseAdmin, {
        year: existing.year,
        month: existing.month,
        dryRun: false,
      });
    } catch (reconErr) {
      console.error(
        `[cancel] reconsolidacao best-effort falhou para ${existing.month}/${existing.year}`,
        reconErr
      );
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        entity_name: "monthly_closing_imports",
        entity_id: importId,
        action: "IMPORT_CANCELLED",
        description: `Import de fechamento ${existing.month}/${existing.year} cancelado manualmente.`,
        payload: {
          importId,
          fileName: existing.file_name,
          companyId: existing.company_id,
          year: existing.year,
          month: existing.month,
          startedAt: existing.created_at,
        },
        created_by: user.session.appUser.email,
      });
    } catch {
      // Audit best-effort.
    }

    return NextResponse.json({
      success: true,
      importId,
      previousStatus: "PROCESSING",
      newStatus: "CANCELLED",
      reconsolidado,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
