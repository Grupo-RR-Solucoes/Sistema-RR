import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface BulkBody {
  proposalIds?: unknown;
  productionRecordIds?: unknown;
  mode?: unknown;
  value?: unknown;
}

const MAX_BATCH = 5000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// audit_logs RLS bloqueia INSERT via PostgREST. Mesmo padrao usado em
// /api/financeiro/[id] e /api/admin/usuarios/[id]: service_role para
// escrever, fail-safe try/catch para nao bloquear a operacao primaria.
async function writeAuditEntry(
  action: string,
  description: string,
  payload: Record<string, unknown>,
  createdBy: string,
  entityId: string
) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      entity_name: "promoter_proposal_commissions",
      entity_id: entityId,
      action,
      description,
      payload,
      created_by: createdBy,
    });
  } catch (auditErr) {
    console.error(
      "Falha ao escrever audit_logs em /api/commissions/proposals/bulk",
      auditErr
    );
  }
}

/**
 * POST /api/commissions/proposals/bulk
 *
 * Aplica % de repasse (commission_percent) a um lote misto:
 *   - proposalIds (UUIDs de promoter_proposal_commissions ja existentes) -> UPDATE
 *   - productionRecordIds (UUIDs de daily_production_records sem override) -> INSERT
 *     com ON CONFLICT (daily_production_record_id) DO UPDATE para race-safety
 *
 * Modos:
 *   - absolute: substitui pelo `value` (0..100); aplicavel a UPDATE e INSERT
 *   - relative: soma `value` (-100..100) ao valor atual, clamp [0..100];
 *     so funciona em proposalIds (UPDATE). Bloqueia se productionRecordIds
 *     for usado junto — INSERT precisa de valor absoluto.
 *
 * Cada linha afetada (UPDATE ou INSERT) gera 1 entrada em audit_logs com
 * batch_id compartilhado. Actions:
 *   - "commission_bulk_updated"     (UPDATE em row existente)
 *   - "commission_created_via_bulk" (INSERT de override novo)
 *
 * Falha pontual nao invalida o lote (sem transacao explicita).
 *
 * RLS Grupo D restringe quem ve/escreve. Gate adicional via
 * canManageCommissionRule (socio + funcionario).
 */
export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    if (!canManageCommissionRule(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para editar regras de comissao." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as BulkBody;
    const proposalIds = Array.isArray(body.proposalIds)
      ? (body.proposalIds.filter((x) => typeof x === "string") as string[])
      : [];
    const productionRecordIds = Array.isArray(body.productionRecordIds)
      ? (body.productionRecordIds.filter((x) => typeof x === "string") as string[])
      : [];
    const mode = body.mode === "absolute" || body.mode === "relative"
      ? body.mode
      : null;
    const valueRaw = Number(body.value);
    const value = Number.isFinite(valueRaw) ? valueRaw : NaN;

    const totalIds = proposalIds.length + productionRecordIds.length;

    if (totalIds === 0) {
      return NextResponse.json(
        { error: "Informe ao menos um proposalId ou productionRecordId." },
        { status: 400 }
      );
    }
    if (totalIds > MAX_BATCH) {
      return NextResponse.json(
        { error: `Lote excede o limite de ${MAX_BATCH} linhas.` },
        { status: 400 }
      );
    }
    if (!mode) {
      return NextResponse.json(
        { error: "Modo deve ser 'absolute' ou 'relative'." },
        { status: 400 }
      );
    }
    if (!Number.isFinite(value)) {
      return NextResponse.json(
        { error: "value invalido." },
        { status: 400 }
      );
    }
    if (mode === "absolute" && (value < 0 || value > 100)) {
      return NextResponse.json(
        { error: "Modo absolute: value deve estar entre 0 e 100." },
        { status: 400 }
      );
    }
    if (mode === "relative" && (value < -100 || value > 100)) {
      return NextResponse.json(
        { error: "Modo relative: value deve estar entre -100 e 100." },
        { status: 400 }
      );
    }
    if (mode === "relative" && productionRecordIds.length > 0) {
      return NextResponse.json(
        {
          error:
            "Ajuste relativo so funciona em propostas que ja tem override. Use modo absoluto para criar overrides novos.",
        },
        { status: 400 }
      );
    }

    const batchId = randomUUID();
    const nowIso = new Date().toISOString();
    const actorEmail = user.session.appUser.email;
    const actorUserId = user.session.appUser.id;

    let updatedCount = 0;
    let createdCount = 0;
    const failures: { id: string; error: string; kind: "update" | "insert" }[] = [];

    // ---------------- UPDATE loop (proposalIds existentes) ----------------
    let deniedIds: string[] = [];

    if (proposalIds.length > 0) {
      const { data: targets, error: fetchErr } = await supabase
        .from("promoter_proposal_commissions")
        .select(
          "id, commission_percent, daily_production_record_id, promoter_id"
        )
        .in("id", proposalIds);

      if (fetchErr) {
        return NextResponse.json(
          { error: fetchErr.message },
          { status: 500 }
        );
      }

      const fetched = targets ?? [];
      const fetchedIds = new Set(fetched.map((r) => r.id));
      deniedIds = proposalIds.filter((id) => !fetchedIds.has(id));

      for (const row of fetched) {
        const oldValue = Number(row.commission_percent ?? 0);
        const newValue =
          mode === "absolute"
            ? clamp(value, 0, 100)
            : clamp(oldValue + value, 0, 100);

        const { error: updateErr } = await supabase
          .from("promoter_proposal_commissions")
          .update({
            commission_percent: newValue,
            updated_at: nowIso,
          })
          .eq("id", row.id);

        if (updateErr) {
          failures.push({ id: row.id, error: updateErr.message, kind: "update" });
          continue;
        }

        updatedCount += 1;

        await writeAuditEntry(
          "commission_bulk_updated",
          `${user.role} ${actorEmail} aplicou bulk em comissao (batch ${batchId})`,
          {
            performed_by_user_id: actorUserId,
            performed_by_email: actorEmail,
            target_proposal_id: row.id,
            target_daily_production_record_id: row.daily_production_record_id,
            target_promoter_id: row.promoter_id,
            batch_id: batchId,
            mode,
            value,
            old_value: oldValue,
            new_value: newValue,
          },
          actorEmail,
          row.id
        );
      }
    }

    // ---------------- INSERT loop (productionRecordIds sem override) ----------------
    if (productionRecordIds.length > 0) {
      const newValue = clamp(value, 0, 100); // garantido absolute (validado acima)

      // Fetch promoter_id obrigatorio (NOT NULL na tabela) — 1 query em batch
      const { data: records, error: recordErr } = await supabase
        .from("daily_production_records")
        .select("id, assigned_promoter_id")
        .in("id", productionRecordIds);

      if (recordErr) {
        return NextResponse.json(
          { error: recordErr.message },
          { status: 500 }
        );
      }

      const recordById = new Map(
        (records ?? []).map((r) => [r.id, r.assigned_promoter_id])
      );

      for (const recordId of productionRecordIds) {
        const promoterId = recordById.get(recordId);
        if (!promoterId) {
          failures.push({
            id: recordId,
            error: "daily_production_record nao encontrado ou sem promoter atribuido",
            kind: "insert",
          });
          continue;
        }

        // UPSERT defensivo: UNIQUE (daily_production_record_id) garante que
        // race entre 2 cliques bulk simultaneos nao gera erro 23505 — o
        // segundo vira UPDATE silencioso do commission_percent.
        const { data: upserted, error: upsertErr } = await supabase
          .from("promoter_proposal_commissions")
          .upsert(
            {
              daily_production_record_id: recordId,
              promoter_id: promoterId,
              commission_percent: newValue,
              active: true,
              updated_at: nowIso,
            },
            { onConflict: "daily_production_record_id" }
          )
          .select("id")
          .single();

        if (upsertErr || !upserted) {
          failures.push({
            id: recordId,
            error: upsertErr?.message ?? "Falha desconhecida no upsert",
            kind: "insert",
          });
          continue;
        }

        createdCount += 1;

        await writeAuditEntry(
          "commission_created_via_bulk",
          `${user.role} ${actorEmail} criou override de comissao via bulk (batch ${batchId})`,
          {
            performed_by_user_id: actorUserId,
            performed_by_email: actorEmail,
            target_proposal_id: upserted.id,
            target_daily_production_record_id: recordId,
            target_promoter_id: promoterId,
            batch_id: batchId,
            mode,
            value,
            old_value: null,
            new_value: newValue,
          },
          actorEmail,
          upserted.id
        );
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      batch_id: batchId,
      updated_count: updatedCount,
      created_count: createdCount,
      denied_count: deniedIds.length,
      denied_ids: deniedIds.length > 0 ? deniedIds : undefined,
      failure_count: failures.length,
      failures: failures.length > 0 ? failures : undefined,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
