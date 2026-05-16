import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";

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
          "daily_production_record_id, promoter_id, commission_percent, insurance_commission_percent, notes, active"
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
    const { supabase } = await withSocioOrFuncionarioAnon();
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

    const { error } = await supabase
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
      );

    if (error) throw error;

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
    const { supabase } = await withSocioOrFuncionarioAnon();
    const body = (await req.json()) as { dailyProductionRecordId?: string };
    const dailyProductionRecordId = body.dailyProductionRecordId;

    if (!dailyProductionRecordId) {
      return NextResponse.json(
        { error: "Informe dailyProductionRecordId." },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("promoter_proposal_commissions")
      .delete()
      .eq("daily_production_record_id", dailyProductionRecordId);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Regra manual removida com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
