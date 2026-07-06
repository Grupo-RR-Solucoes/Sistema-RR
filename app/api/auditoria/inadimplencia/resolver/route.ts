import { NextResponse } from "next/server";

import {
  ApiGuardError,
  apiGuardErrorResponse,
  withSocioAdmin,
} from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// INADIMPLÊNCIA PRT — Fatia B: rota de ESCRITA da resolução manual.
// POST marca (ou reabre) um contrato como SOLUCIONADO. socio-only
// (withSocioAdmin → requireSocio + service_role; não-sócio recebe 403).
//
// body { competencia, operation_number, reabrir? }:
//   reabrir ausente/false → resolucao_status=SOLUCIONADO, resolucao_por=<sócio>,
//                           resolucao_em=now  → sai da fila / do recuperável.
//   reabrir=true          → resolucao_status=PENDENTE, por/em=null → volta pra fila.
//
// Toca SÓ as 3 colunas de resolução — status_acompanhamento (do motor) fica
// intacto. Idempotente: re-marcar não duplica (é UPDATE por chave única).
// ============================================================

const TABLE = "prt_inadimplencia_monitor";
const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

// audit_logs bloqueia INSERT via PostgREST p/ todos os roles (Dia 3 grupo G);
// escreve com service_role, mesmo pattern de /api/financeiro. Falha na trilha
// não derruba a operação principal.
async function writeAuditLog(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string,
) {
  try {
    await getSupabaseAdmin().from("audit_logs").insert({
      entity_name: "inadimplencia_prt",
      action: "RESOLUCAO",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // silencioso de propósito.
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioAdmin();

    const body = (await req.json().catch(() => ({}))) as {
      competencia?: unknown;
      operation_number?: unknown;
      reabrir?: unknown;
    };
    const competencia = String(body.competencia ?? "").trim();
    const operationNumber = String(body.operation_number ?? "").trim();
    const reabrir = body.reabrir === true;

    if (!COMPETENCIA_RE.test(competencia)) {
      throw new ApiGuardError(400, "competencia inválida (esperado YYYY-MM)");
    }
    if (!operationNumber) {
      throw new ApiGuardError(400, "operation_number obrigatório");
    }

    const email = user.session.appUser.email;
    const patch = reabrir
      ? { resolucao_status: "PENDENTE", resolucao_por: null, resolucao_em: null }
      : {
          resolucao_status: "SOLUCIONADO",
          resolucao_por: email,
          resolucao_em: new Date().toISOString(),
        };

    const { data, error } = await supabase
      .from(TABLE)
      .update(patch)
      .eq("competencia", competencia)
      .eq("operation_number", operationNumber)
      .select(
        "competencia, operation_number, resolucao_status, resolucao_por, resolucao_em",
      );

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Contrato não encontrado nesta competência." },
        { status: 404 },
      );
    }

    await writeAuditLog(
      reabrir
        ? `Reabriu inadimplência ${operationNumber} (${competencia}) → volta à fila`
        : `Marcou SOLUCIONADO ${operationNumber} (${competencia})`,
      { competencia, operation_number: operationNumber, reabrir },
      email,
    );

    return NextResponse.json({ ok: true, row: data[0] });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
