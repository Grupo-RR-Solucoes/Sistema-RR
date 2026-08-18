import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
import { carregarContextoTaxaAvista } from "@/lib/promoterAnalytics";
import { recalculateSingleProposal } from "@/lib/proposalDetailing";
import { getProductionPeriodFromValue } from "@/lib/productionPeriod";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

interface BulkBody {
  proposalIds?: unknown;
  productionRecordIds?: unknown;
  mode?: unknown;
  value?: unknown;
  // Dia 4.5 Etapa B: qual coluna em promoter_proposal_commissions o
  // bulk vai atualizar. Default = share_percent_override (escala 0..1
  // no DB; input do user em 0..100, convertido aqui).
  // Legado: commission_percent (escala 0..100 no DB).
  targetField?: "share_percent_override" | "commission_percent";
}

const MAX_BATCH = 5000;

// Coluna alvo + escala. Escala 0.01 = grava (input / 100) no DB
// (share_percent_override armazena decimal). Escala 1 = grava input
// direto (commission_percent legado armazena 0..100).
const TARGET_FIELDS = {
  share_percent_override: {
    column: "share_percent_override",
    dbScaleFactor: 0.01,
  },
  commission_percent: {
    column: "commission_percent",
    dbScaleFactor: 1,
  },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Guarda #6: resolve quais daily_production_records estao em competencia FECHADA
 * (regime !== 'open'). A rota UNITARIA barra mes fechado com 403; o bulk e
 * MULTI-competencia, entao em vez de 403 no lote inteiro os records fechados sao
 * REJEITADOS PARCIALMENTE (denied_closed). Assim um bulk legitimo de mes aberto
 * nao e bloqueado se a selecao pegar 1 record fechado por acidente. Motivo da
 * trava: um override plantado em mes fechado altera a comissao na PROXIMA
 * reconsolidacao (bomba latente). Escala 1 query + cache de regime por competencia.
 * Fail-open: erro de infra NAO inventa rejeicao (retorna conjunto vazio).
 */
async function fetchClosedDprIds(
  supabase: SupabaseClient,
  dprIds: string[]
): Promise<Set<string>> {
  const closed = new Set<string>();
  const unique = [...new Set(dprIds.filter(Boolean))];
  if (unique.length === 0) return closed;

  const { data, error } = await supabase
    .from("daily_production_records")
    .select("id, movement_date")
    .in("id", unique);
  if (error || !data) return closed;

  const regimeCache = new Map<string, MonthRegime>();
  for (const r of data) {
    if (!r.movement_date) continue;
    // A COMPETENCIA E A JANELA. Era `new Date(...).getUTCMonth()+1`, calendario:
    // uma proposta de 2026-07-31 e producao de AGOSTO, mes aberto, e vinha aqui
    // julgada como julho, que esta em 'fechamento' — entrava em
    // `denied_closed` sem ser de competencia fechada. Medido em 18/08/2026: 35
    // linhas. Mesma regua da trava unitaria em ../route.ts.
    const periodo = getProductionPeriodFromValue(r.movement_date);
    if (!periodo) continue;
    const year = periodo.year;
    const month = periodo.month;
    const key = `${year}-${month}`;
    let regime = regimeCache.get(key);
    if (regime === undefined) {
      regime = await detectMonthRegime(supabase, year, month).catch(
        () => "open" as MonthRegime
      );
      regimeCache.set(key, regime);
    }
    if (regime !== "open") closed.add(String(r.id));
  }
  return closed;
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
    // Dia 4.5 Etapa B: alvo do bulk. Default = override editavel novo;
    // fallback explicito para legado commission_percent se body pedir.
    const targetField =
      body.targetField === "commission_percent"
        ? "commission_percent"
        : "share_percent_override";
    const targetConfig = TARGET_FIELDS[targetField];

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
    // Guarda #6: records de competencia FECHADA sao rejeitados PARCIALMENTE aqui
    // (nunca 403 no lote). Coletados em denied_closed e devolvidos na resposta.
    const deniedClosedIds: string[] = [];

    // Production record IDs afetados nesta operacao (para recalc no fim).
    const affectedProductionRecordIds = new Set<string>();

    // Busca as propostas ANTES do loop para conhecer os daily_production_record_id
    // (necessarios p/ resolver a competencia — e o regime — de cada uma).
    let fetched: Array<Record<string, unknown>> = [];
    if (proposalIds.length > 0) {
      const { data: targets, error: fetchErr } = await supabase
        .from("promoter_proposal_commissions")
        .select(
          `id, ${targetConfig.column}, daily_production_record_id, promoter_id`
        )
        .in("id", proposalIds);

      if (fetchErr) {
        return NextResponse.json(
          { error: fetchErr.message },
          { status: 500 }
        );
      }

      fetched = (targets ?? []) as Array<Record<string, unknown>>;
      const fetchedIds = new Set(fetched.map((r) => String(r.id)));
      deniedIds = proposalIds.filter((id) => !fetchedIds.has(id));
    }

    // Conjunto de daily_production_records em competencia FECHADA (guarda #6):
    // cobre os records do INSERT (productionRecordIds) e os das propostas do UPDATE.
    const closedDprIds = await fetchClosedDprIds(supabase, [
      ...productionRecordIds,
      ...fetched
        .map((r) => String(r.daily_production_record_id ?? ""))
        .filter(Boolean),
    ]);

    if (fetched.length > 0) {
      for (const row of fetched) {
        // Guarda #6: proposta de competencia FECHADA -> denied_closed, nao edita.
        const dprIdGuard = String(row.daily_production_record_id ?? "");
        if (dprIdGuard && closedDprIds.has(dprIdGuard)) {
          deniedClosedIds.push(String(row.id));
          continue;
        }
        const oldRaw = Number(row[targetConfig.column] ?? 0);
        // Display sempre em escala 0..100 para audit; converte com base
        // no dbScaleFactor (share_percent_override armazena 0..1).
        const oldValueDisplay = oldRaw / targetConfig.dbScaleFactor;
        const newValueDisplay =
          mode === "absolute"
            ? clamp(value, 0, 100)
            : clamp(oldValueDisplay + value, 0, 100);
        const newValueDb = newValueDisplay * targetConfig.dbScaleFactor;

        const updatePayload: Record<string, unknown> = {
          [targetConfig.column]: newValueDb,
          updated_at: nowIso,
        };

        const { error: updateErr } = await supabase
          .from("promoter_proposal_commissions")
          .update(updatePayload)
          .eq("id", row.id);

        if (updateErr) {
          failures.push({
            id: String(row.id),
            error: updateErr.message,
            kind: "update",
          });
          continue;
        }

        updatedCount += 1;
        const dprId = String(row.daily_production_record_id ?? "");
        if (dprId) affectedProductionRecordIds.add(dprId);

        await writeAuditEntry(
          "commission_bulk_updated",
          `${user.role} ${actorEmail} aplicou bulk em comissao (batch ${batchId})`,
          {
            performed_by_user_id: actorUserId,
            performed_by_email: actorEmail,
            target_proposal_id: String(row.id),
            target_daily_production_record_id: dprId,
            target_promoter_id: row.promoter_id,
            target_field: targetField,
            batch_id: batchId,
            mode,
            value,
            old_value: oldValueDisplay,
            new_value: newValueDisplay,
          },
          actorEmail,
          String(row.id)
        );
      }
    }

    // ---------------- INSERT loop (productionRecordIds sem override) ----------------
    if (productionRecordIds.length > 0) {
      const newValueDisplay = clamp(value, 0, 100); // absolute (validado acima)
      const newValueDb = newValueDisplay * targetConfig.dbScaleFactor;

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
        // Guarda #6: record de competencia FECHADA -> denied_closed, nao cria override.
        if (closedDprIds.has(recordId)) {
          deniedClosedIds.push(recordId);
          continue;
        }
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
        // segundo vira UPDATE silencioso do campo alvo.
        const upsertPayload: Record<string, unknown> = {
          daily_production_record_id: recordId,
          promoter_id: promoterId,
          [targetConfig.column]: newValueDb,
          active: true,
          updated_at: nowIso,
        };

        const { data: upserted, error: upsertErr } = await supabase
          .from("promoter_proposal_commissions")
          .upsert(upsertPayload, {
            onConflict: "daily_production_record_id",
          })
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
        affectedProductionRecordIds.add(recordId);

        await writeAuditEntry(
          "commission_created_via_bulk",
          `${user.role} ${actorEmail} criou override de comissao via bulk (batch ${batchId})`,
          {
            performed_by_user_id: actorUserId,
            performed_by_email: actorEmail,
            target_proposal_id: upserted.id,
            target_daily_production_record_id: recordId,
            target_promoter_id: promoterId,
            target_field: targetField,
            batch_id: batchId,
            mode,
            value,
            old_value: null,
            new_value: newValueDisplay,
          },
          actorEmail,
          upserted.id
        );
      }
    }

    // Dia 4.5 Etapa B: recalcula promoter_commission_amount em
    // daily_production_records para cada record afetado. Sequencial
    // (mantemos previsibilidade; carga tipica < 50 records por bulk).
    // MEDIDA B — a cascata COMPLETA vai como parametro do recalculo.
    //
    // O contexto (producao do grupo no mes + provider da TRP) e caro, entao vai
    // em CACHE POR COMPETENCIA e nao por registro. Um lote pode atravessar mais
    // de uma competencia aberta — por isso o cache, e nao um contexto so: usar
    // a competencia errada como base da faixa daria taxa de outra faixa, um
    // numero plausivel e errado.
    let recalcFailures = 0;
    const { data: datasDosAfetados } = await supabase
      .from("daily_production_records")
      .select("id, movement_date")
      .in("id", [...affectedProductionRecordIds]);
    const compPorId = new Map<string, string>();
    for (const r of datasDosAfetados ?? []) {
      if (r.movement_date) compPorId.set(String(r.id), String(r.movement_date).slice(0, 7));
    }
    const ctxPorComp = new Map<string, Awaited<ReturnType<typeof carregarContextoTaxaAvista>>>();
    for (const dprId of affectedProductionRecordIds) {
      const comp = compPorId.get(dprId);
      if (!comp) {
        recalcFailures += 1;
        console.error(`[recalculateSingleProposal] sem movement_date para ${dprId}; recalculo pulado`);
        continue;
      }
      let ctx = ctxPorComp.get(comp);
      if (!ctx) {
        const [y, m] = comp.split("-").map(Number);
        ctx = await carregarContextoTaxaAvista(supabase, { year: y, month: m });
        ctxPorComp.set(comp, ctx);
      }
      const res = await recalculateSingleProposal(supabase, dprId, ctx.percentDe);
      if (!res.ok) {
        recalcFailures += 1;
        console.error(
          `[recalculateSingleProposal] falhou para ${dprId} (bulk batch ${batchId}):`,
          res.error
        );
      }
    }

    return NextResponse.json({
      success: failures.length === 0,
      batch_id: batchId,
      target_field: targetField,
      updated_count: updatedCount,
      created_count: createdCount,
      denied_count: deniedIds.length,
      denied_ids: deniedIds.length > 0 ? deniedIds : undefined,
      // Guarda #6: records de competencia FECHADA rejeitados (nao 403 no lote).
      denied_closed_count: deniedClosedIds.length,
      denied_closed_ids: deniedClosedIds.length > 0 ? deniedClosedIds : undefined,
      failure_count: failures.length,
      failures: failures.length > 0 ? failures : undefined,
      recalc_failures: recalcFailures,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
