import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
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
  product_description: string | null;
  gross_value: number | null;
  net_value: number | null;
  insurance_value: number | null;
  promoter_commission_percent: number | null;
  promoter_commission_amount: number | null;
  insurance_commission_percent: number | null;
  insurance_commission_amount: number | null;
  commission_rule_source: string | null;
  movement_date: string | null;
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
          product_description,
          gross_value,
          net_value,
          insurance_value,
          promoter_commission_percent,
          promoter_commission_amount,
          insurance_commission_percent,
          insurance_commission_amount,
          commission_rule_source,
          movement_date
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

      return {
        ...record,
        commission_base_value: record.net_value,
        promoter_name: promoter?.name || null,
        // Dia 4.4: expor commission_rule_id (promoter_proposal_commissions.id)
        // para a UI poder enviar ao /bulk endpoint. NULL quando nao existe
        // override ainda — UI precisa criar via POST upsert antes do bulk.
        commission_rule_id: manual?.id ?? null,
        promoter_commission_percent:
          manual?.commission_percent ?? record.promoter_commission_percent,
        insurance_commission_percent:
          manual?.insurance_commission_percent ??
          record.insurance_commission_percent,
        manual_notes: manual?.notes || "",
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
