import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
import {
  computeComissaoPromotor,
  computePromoterInsuranceAmount,
  fetchPromoterShareData,
  getAVistaPercent,
  getAgencyCode,
  getCompanyCommissionAmount,
  getInstallmentCount,
  getSrccRestrictionLabel,
  recalculateSingleProposal,
  resolvePromoterShareSync,
} from "@/lib/proposalDetailing";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// audit_logs RLS bloqueia INSERT via PostgREST. Mesmo padrao usado em
// /api/financeiro/[id] e /api/admin/usuarios/[id]: service_role para
// escrever, fail-safe try/catch para nao bloquear a operacao primaria.
async function writeAuditEntry(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string,
  entityId: string | null,
  action: string
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
      "Falha ao escrever audit_logs em /api/commissions/proposals",
      auditErr
    );
  }
}

type ProductionRecord = {
  id: string;
  company_id: string | null;
  assigned_promoter_id: string | null;
  proposal_number: string | null;
  contract_number: string | null;
  product_code: string | null;
  product_description: string | null;
  j_key: string | null;
  contract_date: string | null;
  interest_rate: number | null;
  installments: number | null;
  term_months: number | null;
  company_received_percent: number | null;
  is_srcc_restricted: boolean | null;
  gross_value: number | null;
  net_value: number | null;
  insurance_value: number | null;
  promoter_commission_percent: number | null;
  promoter_commission_amount: number | null;
  insurance_commission_percent: number | null;
  insurance_commission_amount: number | null;
  commission_rule_source: string | null;
  movement_date: string | null;
  raw_payload: Record<string, unknown> | null;
};

type PromoterRow = {
  id: string;
  name: string;
};

type ManualRuleRow = {
  id: string;
  daily_production_record_id: string;
  promoter_id: string;
  commission_percent: number | null;
  insurance_commission_percent: number | null;
  share_percent_override: number | null;
  notes: string | null;
  active: boolean | null;
};

function getMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function fetchAllPaged<T>(baseQueryBuilder: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];

  while (true) {
    const { data, error } = await baseQueryBuilder().range(
      from,
      from + pageSize - 1
    );

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAnon();
    const { searchParams } = new URL(req.url);

    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    const companyId = searchParams.get("companyId");
    const promoterId = searchParams.get("promoterId");

    if (!year || !month) {
      return NextResponse.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }

    const { start, end } = getMonthRange(year, month);

    const records = await fetchAllPaged<ProductionRecord>(() => {
      let query = supabase
        .from("daily_production_records")
        .select(`
          id,
          company_id,
          assigned_promoter_id,
          proposal_number,
          contract_number,
          product_code,
          product_description,
          j_key,
          contract_date,
          interest_rate,
          installments,
          term_months,
          company_received_percent,
          is_srcc_restricted,
          gross_value,
          net_value,
          insurance_value,
          promoter_commission_percent,
          promoter_commission_amount,
          insurance_commission_percent,
          insurance_commission_amount,
          commission_rule_source,
          movement_date,
          raw_payload
        `)
        .gte("movement_date", start)
        .lt("movement_date", end)
        .not("assigned_promoter_id", "is", null)
        .order("movement_date", { ascending: false });

      if (companyId) {
        query = query.eq("company_id", companyId);
      }

      if (promoterId) {
        query = query.eq("assigned_promoter_id", promoterId);
      }

      return query;
    });

    const promoterIds: string[] = [
      ...new Set(
        records
          .map((r) => r.assigned_promoter_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    let promoters: PromoterRow[] = [];
    if (promoterIds.length > 0) {
      const { data, error } = await supabase
        .from("promoters")
        .select("id, name")
        .in("id", promoterIds);

      if (error) throw error;
      promoters = (data || []) as PromoterRow[];
    }

    // 4.4-fix-1.E (D2): "% PENETRACAO" e agregacao mensal por (promoter,
    // company) vinda de promoter_monthly_results, NAO eh por proposta.
    // Fetch agregado em batch para todos os promotores que aparecem nas
    // rows do mes, mapeado para `${promoter_id}|${company_id}`.
    const penetrationMap = new Map<string, number | null>();
    if (promoterIds.length > 0) {
      const { data: penetrationRows, error: penetrationError } = await supabase
        .from("promoter_monthly_results")
        .select("promoter_id, company_id, insurance_penetration_percent")
        .eq("year", year)
        .eq("month", month)
        .in("promoter_id", promoterIds);

      if (penetrationError) throw penetrationError;
      for (const row of penetrationRows ?? []) {
        penetrationMap.set(
          `${row.promoter_id}|${row.company_id}`,
          row.insurance_penetration_percent ?? null
        );
      }
    }

    const proposalIds = records.map((r) => r.id);

    let manualRules: ManualRuleRow[] = [];
    if (proposalIds.length > 0) {
      const { data, error } = await supabase
        .from("promoter_proposal_commissions")
        .select(
          "id, daily_production_record_id, promoter_id, commission_percent, insurance_commission_percent, share_percent_override, notes, active"
        )
        .in("daily_production_record_id", proposalIds);

      if (error) throw error;
      manualRules = (data || []) as ManualRuleRow[];
    }

    // Dia 4.5 Etapa B: pre-carrega 3 maps (profiles + escalas + volume
    // mensal) para a cascata sync de share_percent. fetchPromoterShareData
    // faz no maximo 3-4 queries em batch independente do numero de rows.
    const { profilesMap, scalesMap, monthlyVolumesMap } =
      await fetchPromoterShareData(supabase, promoterIds, year, month);

    const rows = records.map((record) => {
      const promoter = promoters.find((p) => p.id === record.assigned_promoter_id);
      const manual = manualRules.find(
        (m) => m.daily_production_record_id === record.id && m.active !== false
      );

      // 4.4-fix-1.E: % efetivo legacy (mantido em promoter_commission_percent
      // para back-compat com outras telas/consumidores). 4.5 Etapa B nao
      // mexe nesse comportamento.
      const promoterPercentEffective =
        manual?.commission_percent ?? record.promoter_commission_percent;
      const insurancePercentEffective =
        manual?.insurance_commission_percent ??
        record.insurance_commission_percent;

      // 4.4-fix-1.E (D2): % PENETRACAO mensal por (promoter, company).
      const penetrationKey = `${record.assigned_promoter_id ?? ""}|${record.company_id ?? ""}`;
      const insurancePenetrationPercent =
        penetrationMap.get(penetrationKey) ?? null;

      // Dia 4.5 Etapa B: cascata nova de share_percent.
      const aVistaPercent = getAVistaPercent(record);
      const overrideValue = manual?.share_percent_override ?? null;
      const shareResolution = resolvePromoterShareSync({
        record: {
          assigned_promoter_id: record.assigned_promoter_id,
          share_percent_override: overrideValue,
        },
        profilesMap,
        scalesMap,
        monthlyVolumesMap,
      });

      return {
        ...record,
        commission_base_value: record.net_value,
        promoter_name: promoter?.name || null,
        commission_rule_id: manual?.id ?? null,
        promoter_commission_percent: promoterPercentEffective,
        insurance_commission_percent: insurancePercentEffective,
        manual_notes: manual?.notes || "",
        // 4.4-fix-1.B
        agency_code: getAgencyCode(record),
        srcc_restriction: getSrccRestrictionLabel(record),
        installment_count: getInstallmentCount(record),
        company_commission_amount: getCompanyCommissionAmount(record),
        // 4.4-fix-1.E (D1+D2)
        a_vista_percent: aVistaPercent,
        insurance_penetration_percent: insurancePenetrationPercent,
        // Dia 4.5 Etapa B: novos campos de cascata.
        // share_percent_effective vem em DECIMAL (0..1). UI multiplica
        // por 100 para exibir "66,66%". sharePercent === 1.0 = 100%.
        share_percent_effective: shareResolution.sharePercent,
        share_percent_source: shareResolution.source,
        share_percent_override: overrideValue,
        // COMISSAO PROMOTOR recalculada com a cascata nova:
        // net_value × min(a_vista, 5.8) / 100 × sharePercent
        promoter_share_amount: computeComissaoPromotor(
          record.net_value,
          aVistaPercent,
          shareResolution.sharePercent
        ),
        // COMISSAO SEGURO PROMOTOR: formula legada mantida (Etapa C
        // refatora). insurance_commission_amount × % seguro / 100.
        promoter_insurance_amount: computePromoterInsuranceAmount(
          record.insurance_commission_amount,
          insurancePercentEffective
        ),
      };
    });

    return NextResponse.json({ rows });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    if (!canManageCommissionRule(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para editar regras de comissao." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      dailyProductionRecordId?: string;
      promoterId?: string;
      commissionPercent?: number | null;
      insuranceCommissionPercent?: number | null;
      sharePercentOverride?: number | null;
      notes?: string | null;
    };

    const dailyProductionRecordId = body.dailyProductionRecordId;
    const promoterId = body.promoterId;
    const commissionPercent = body.commissionPercent;
    const insuranceCommissionPercent = body.insuranceCommissionPercent;
    // Dia 4.5 Etapa B: novo campo de override editavel pela UI.
    const sharePercentOverride = body.sharePercentOverride;
    const notes = body.notes;

    if (!dailyProductionRecordId || !promoterId) {
      return NextResponse.json(
        { error: "Informe dailyProductionRecordId e promoterId." },
        { status: 400 }
      );
    }

    // Fetch previo para audit (snapshot do valor anterior, se existir)
    const { data: previous } = await supabase
      .from("promoter_proposal_commissions")
      .select(
        "id, commission_percent, insurance_commission_percent, share_percent_override, notes"
      )
      .eq("daily_production_record_id", dailyProductionRecordId)
      .maybeSingle();

    // Monta payload preservando os campos NAO enviados (back-compat).
    const upsertPayload: Record<string, unknown> = {
      daily_production_record_id: dailyProductionRecordId,
      promoter_id: promoterId,
      active: true,
    };
    if (commissionPercent !== undefined) {
      upsertPayload.commission_percent = commissionPercent;
    }
    if (insuranceCommissionPercent !== undefined) {
      upsertPayload.insurance_commission_percent = insuranceCommissionPercent;
    }
    if (sharePercentOverride !== undefined) {
      upsertPayload.share_percent_override = sharePercentOverride;
    }
    if (notes !== undefined) {
      upsertPayload.notes = notes;
    }

    const { data: upserted, error } = await supabase
      .from("promoter_proposal_commissions")
      .upsert(upsertPayload, {
        onConflict: "daily_production_record_id",
      })
      .select("id")
      .single();

    if (error) throw error;

    await writeAuditEntry(
      `${user.role} ${user.session.appUser.email} ${previous ? "atualizou" : "criou"} regra manual de comissao por proposta`,
      {
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        target_proposal_id: upserted?.id ?? null,
        target_daily_production_record_id: dailyProductionRecordId,
        target_promoter_id: promoterId,
        old_value: previous?.commission_percent ?? null,
        new_value: commissionPercent ?? null,
        old_insurance_percent: previous?.insurance_commission_percent ?? null,
        new_insurance_percent: insuranceCommissionPercent ?? null,
        old_notes: previous?.notes ?? null,
        new_notes: notes ?? null,
      },
      user.session.appUser.email,
      upserted?.id ?? null,
      previous ? "commission_updated" : "commission_created"
    );

    // Dia 4.5 Etapa B: recalcula promoter_commission_amount em
    // daily_production_records usando a cascata nova. Fail-safe: erro
    // de recalc nao desfaz o upsert (ja gravado).
    const recalc = await recalculateSingleProposal(
      supabase,
      dailyProductionRecordId
    );
    if (!recalc.ok) {
      console.error(
        "[recalculateSingleProposal] falhou apos POST:",
        recalc.error
      );
    }

    return NextResponse.json({
      success: true,
      message: "Regra manual da proposta salva com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    if (!canManageCommissionRule(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para remover regras de comissao." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as { dailyProductionRecordId?: string };
    const dailyProductionRecordId = body.dailyProductionRecordId;

    if (!dailyProductionRecordId) {
      return NextResponse.json(
        { error: "Informe dailyProductionRecordId." },
        { status: 400 }
      );
    }

    // Fetch para audit snapshot antes de deletar
    const { data: target } = await supabase
      .from("promoter_proposal_commissions")
      .select(
        "id, promoter_id, commission_percent, insurance_commission_percent, notes"
      )
      .eq("daily_production_record_id", dailyProductionRecordId)
      .maybeSingle();

    const { error } = await supabase
      .from("promoter_proposal_commissions")
      .delete()
      .eq("daily_production_record_id", dailyProductionRecordId);

    if (error) throw error;

    await writeAuditEntry(
      `${user.role} ${user.session.appUser.email} removeu regra manual de comissao`,
      {
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        target_daily_production_record_id: dailyProductionRecordId,
        deleted_proposal: target,
      },
      user.session.appUser.email,
      target?.id ?? null,
      "commission_deleted"
    );

    // Dia 4.5 Etapa B: recalc apos DELETE (override removido -> cascata
    // cai no profile do promotor).
    const recalc = await recalculateSingleProposal(
      supabase,
      dailyProductionRecordId
    );
    if (!recalc.ok) {
      console.error(
        "[recalculateSingleProposal] falhou apos DELETE:",
        recalc.error
      );
    }

    return NextResponse.json({
      success: true,
      message: "Regra manual removida com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
