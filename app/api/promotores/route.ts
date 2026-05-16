import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";
import { buildPromoterAnalytics } from "@/lib/promoterAnalytics";
import { clearMemoryCache } from "@/lib/memoryCache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveDiscountAmount(
  discountType: string,
  amountInput: unknown,
  companyAmountInput: unknown
) {
  const explicitAmount = toNumber(amountInput);
  if (explicitAmount > 0) return explicitAmount;

  const companyAmount = toNumber(companyAmountInput);
  if (companyAmount <= 0) return 0;

  const autoTypes = new Set([
    "LIQUIDACAO_ANTECIPADA",
    "CANCELAMENTO_SEGURO",
    "CANCELAMENTO_CREDITO",
    "ESTORNO_CREDITO",
    "RENOVACAO_ANTECIPADA",
  ]);

  if (autoTypes.has(discountType)) {
    return Number((companyAmount * 0.7).toFixed(2));
  }

  return companyAmount;
}

// audit_logs RLS bloqueia INSERT via PostgREST para todos os roles
// (Dia 3 grupo G). writeAudit usa service_role para escrever, idem
// pattern Dia 4.1 (/api/admin/usuarios). createdBy recebe o email do
// usuario autenticado vindo do guard (T5 do mapa de decisoes).
async function writeAudit(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabase = getSupabaseAdmin();

    await supabase.from("audit_logs").insert({
      entity_name: "promotores",
      action: "MANUAL_CHANGE",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // Mantem fluxo principal.
  }
}

function clearPromoterReadCaches() {
  clearMemoryCache("promoters:");
  clearMemoryCache("closing:");
  clearMemoryCache("dashboard:");
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withAuthenticatedAnon();

    const { searchParams } = new URL(req.url);

    // buildPromoterAnalytics agora recebe o cliente do guard (Etapa 3.7).
    // Promotor passa supabase autenticado anon -> RLS filtra para o
    // proprio promoter_id; socio/funcionario veem dados completos.
    const payload = await buildPromoterAnalytics(supabase, {
      year: Number(searchParams.get("year") || 0) || undefined,
      month: Number(searchParams.get("month") || 0) || undefined,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: searchParams.get("promoterId") || undefined,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withAuthenticatedAnon();
    const auditActor = user.session.appUser.email;

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "target_upsert") {
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const year = Number(body.year);
      const month = Number(body.month);

      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia da meta." },
          { status: 400 }
        );
      }

      const { error } = await supabase
        .from("monthly_targets")
        .upsert(
          {
            promoter_id: promoterId,
            company_id: companyId,
            year,
            month,
            meta: toNumber(body.meta),
            meta_1: toNumber(body.meta1),
            meta_2: toNumber(body.meta2),
          },
          {
            onConflict: "promoter_id,year,month",
          }
        );

      if (error) throw error;

      clearPromoterReadCaches();
      await writeAudit(
        "Atualizacao manual de meta mensal",
        { promoter_id: promoterId, year, month },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "reassign_proposal") {
      const dailyProductionRecordId = String(body.dailyProductionRecordId || "");
      const toPromoterId = String(body.toPromoterId || "");
      const reason = body.reason ? String(body.reason) : null;

      if (!dailyProductionRecordId || !toPromoterId) {
        return NextResponse.json(
          { error: "Informe a proposta e o promotor de destino." },
          { status: 400 }
        );
      }

      const { data: currentRecord, error: currentError } = await supabase
        .from("daily_production_records")
        .select("id, assigned_promoter_id")
        .eq("id", dailyProductionRecordId)
        .single();

      if (currentError) throw currentError;

      const { error: updateError } = await supabase
        .from("daily_production_records")
        .update({
          assigned_promoter_id: toPromoterId,
          promoter_source: "MANUAL_REASSIGNMENT",
          updated_at: new Date().toISOString(),
        })
        .eq("id", dailyProductionRecordId);

      if (updateError) throw updateError;

      const { error: insertError } = await supabase
        .from("proposal_reassignments")
        .insert({
          daily_production_record_id: dailyProductionRecordId,
          from_promoter_id: currentRecord.assigned_promoter_id,
          to_promoter_id: toPromoterId,
          reason,
          changed_by: auditActor,
        });

      if (insertError) throw insertError;

      clearPromoterReadCaches();
      await writeAudit(
        "Migracao manual de proposta",
        {
          daily_production_record_id: dailyProductionRecordId,
          from_promoter_id: currentRecord.assigned_promoter_id,
          to_promoter_id: toPromoterId,
        },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "agreement_upsert") {
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const year = Number(body.year);
      const month = Number(body.month);
      const productionShare = String(body.productionShare ?? "").trim();
      const insuranceShare = String(body.insuranceShare ?? "").trim();
      const notes = body.notes ? String(body.notes).trim() : null;

      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia do acordo comercial." },
          { status: 400 }
        );
      }

      let deactivateQuery = supabase
        .from("promoter_agreements")
        .update({ active: false })
        .eq("promoter_id", promoterId)
        .eq("year", year)
        .eq("month", month)
        .in("agreement_type", ["PRODUCTION", "INSURANCE"]);

      if (companyId) {
        deactivateQuery = deactivateQuery.eq("company_id", companyId);
      }

      const { error: deactivateError } = await deactivateQuery;
      if (deactivateError) throw deactivateError;

      const rows = [];

      if (productionShare !== "" && toNumber(productionShare) > 0) {
        rows.push({
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          agreement_type: "PRODUCTION",
          commission_type: "SHARE_OF_COMPANY",
          commission_value: toNumber(productionShare),
          active: true,
          notes,
        });
      }

      if (insuranceShare !== "" && toNumber(insuranceShare) > 0) {
        rows.push({
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          agreement_type: "INSURANCE",
          commission_type: "SHARE_OF_COMPANY",
          commission_value: toNumber(insuranceShare),
          active: true,
          notes,
        });
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("promoter_agreements")
          .insert(rows);

        if (insertError) throw insertError;
      }

      clearPromoterReadCaches();
      await writeAudit(
        "Atualizacao de acordo comercial do promotor",
        {
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          production_share: productionShare || null,
          insurance_share: insuranceShare || null,
        },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "discount_upsert") {
      const id = body.id ? String(body.id) : null;
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const dailyProductionRecordId = body.dailyProductionRecordId
        ? String(body.dailyProductionRecordId)
        : null;
      const year = Number(body.year);
      const month = Number(body.month);
      const discountType = normalizeText(body.discountType || "OUTROS");
      const companyAmount = toNumber(body.companyAmount);
      const amount = resolveDiscountAmount(
        discountType,
        body.amount,
        body.companyAmount
      );
      const installments = Math.max(1, toNumber(body.installments) || 1);
      const installmentNumber = Math.max(
        1,
        Math.min(installments, toNumber(body.installmentNumber) || 1)
      );
      const applyToCompany = Boolean(body.applyToCompany);
      const notesParts = [];

      if (companyAmount > 0) {
        notesParts.push(`Base empresa: ${companyAmount.toFixed(2)}`);
      }

      if (body.notes) {
        notesParts.push(String(body.notes).trim());
      }

      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia do desconto." },
          { status: 400 }
        );
      }

      if (amount <= 0) {
        return NextResponse.json(
          { error: "Informe um valor valido para o desconto do promotor." },
          { status: 400 }
        );
      }

      const payload = {
        promoter_id: promoterId,
        company_id: companyId,
        daily_production_record_id: dailyProductionRecordId,
        year,
        month,
        discount_type: discountType,
        amount,
        installments,
        installment_number: installmentNumber,
        apply_to_company: applyToCompany,
        notes: notesParts.join(" | ") || null,
      };

      if (id) {
        const { error: updateError } = await supabase
          .from("promoter_discounts")
          .update(payload)
          .eq("id", id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("promoter_discounts")
          .insert(payload);

        if (insertError) throw insertError;
      }

      clearPromoterReadCaches();
      await writeAudit(
        "Lancamento manual de desconto do promotor",
        {
          id,
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          discount_type: discountType,
          amount,
          installments,
          installment_number: installmentNumber,
          apply_to_company: applyToCompany,
        },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "discount_delete") {
      const id = String(body.id || "");

      if (!id) {
        return NextResponse.json(
          { error: "Informe o desconto que deve ser removido." },
          { status: 400 }
        );
      }

      const { error: deleteError } = await supabase
        .from("promoter_discounts")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      clearPromoterReadCaches();
      await writeAudit(
        "Remocao manual de desconto do promotor",
        { id },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
