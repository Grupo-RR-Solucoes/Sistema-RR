import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
import {
  computePromoterInsuranceAmount,
  computePromoterShareAmount,
  getAVistaPercent,
  getAgencyCode,
  getCompanyCommissionAmount,
  getInstallmentCount,
  getSrccRestrictionLabel,
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

    const promoterIds = [
      ...new Set(records.map((r) => r.assigned_promoter_id).filter(Boolean)),
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
          "id, daily_production_record_id, promoter_id, commission_percent, insurance_commission_percent, notes, active"
        )
        .in("daily_production_record_id", proposalIds);

      if (error) throw error;
      manualRules = (data || []) as ManualRuleRow[];
    }

    const rows = records.map((record) => {
      const promoter = promoters.find((p) => p.id === record.assigned_promoter_id);
      const manual = manualRules.find(
        (m) => m.daily_production_record_id === record.id && m.active !== false
      );

      // 4.4-fix-1.E: % efetivo do promotor = override OR Promotiva default.
      const promoterPercentEffective =
        manual?.commission_percent ?? record.promoter_commission_percent;
      const insurancePercentEffective =
        manual?.insurance_commission_percent ??
        record.insurance_commission_percent;

      // 4.4-fix-1.E (D2): % PENETRACAO mensal por (promoter, company).
      const penetrationKey = `${record.assigned_promoter_id ?? ""}|${record.company_id ?? ""}`;
      const insurancePenetrationPercent =
        penetrationMap.get(penetrationKey) ?? null;

      return {
        ...record,
        commission_base_value: record.net_value,
        promoter_name: promoter?.name || null,
        // Dia 4.4: expor commission_rule_id (promoter_proposal_commissions.id)
        // para a UI poder enviar ao /bulk endpoint. NULL quando nao existe
        // override ainda — UI precisa criar via POST upsert antes do bulk.
        commission_rule_id: manual?.id ?? null,
        promoter_commission_percent: promoterPercentEffective,
        insurance_commission_percent: insurancePercentEffective,
        manual_notes: manual?.notes || "",
        // 4.4-fix-1.B: derivados que o Detalhamento de /promotores ja
        // expoe; helpers compartilhados em lib/proposalDetailing.ts.
        agency_code: getAgencyCode(record),
        srcc_restriction: getSrccRestrictionLabel(record),
        installment_count: getInstallmentCount(record),
        company_commission_amount: getCompanyCommissionAmount(record),
        // 4.4-fix-1.E (D1): "% A VISTA" pura Promotiva, lida do
        // raw_payload (regra TRP/OPP original, antes da cascata).
        a_vista_percent: getAVistaPercent(record),
        // 4.4-fix-1.E (D2): "% PENETRACAO" agregada mensal de seguro,
        // constante para todas as propostas do mesmo promotor no mes.
        insurance_penetration_percent: insurancePenetrationPercent,
        // COMISSAO PROMOTOR = COMISSAO PF * % repasse efetivo / 100.
        promoter_share_amount: computePromoterShareAmount(
          record.promoter_commission_amount,
          promoterPercentEffective
        ),
        // COMISSAO SEGURO PROMOTOR = insurance_commission_amount * % seguro
        // promotor efetivo / 100. Dia 4.5 tornara o % editavel.
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
      notes?: string | null;
    };

    const dailyProductionRecordId = body.dailyProductionRecordId;
    const promoterId = body.promoterId;
    const commissionPercent = body.commissionPercent;
    const insuranceCommissionPercent = body.insuranceCommissionPercent;
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
      .select("id, commission_percent, insurance_commission_percent, notes")
      .eq("daily_production_record_id", dailyProductionRecordId)
      .maybeSingle();

    const { data: upserted, error } = await supabase
      .from("promoter_proposal_commissions")
      .upsert(
        {
          daily_production_record_id: dailyProductionRecordId,
          promoter_id: promoterId,
          commission_percent: commissionPercent,
          insurance_commission_percent: insuranceCommissionPercent,
          notes,
          active: true,
        },
        {
          onConflict: "daily_production_record_id",
        }
      )
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

    return NextResponse.json({
      success: true,
      message: "Regra manual removida com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
