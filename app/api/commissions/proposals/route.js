import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function fetchAllPaged(baseQueryBuilder) {
  let from = 0;
  const pageSize = 1000;
  const all = [];

  while (true) {
    const { data, error } = await baseQueryBuilder().range(
      from,
      from + pageSize - 1
    );

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function GET(req) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);

    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    const companyId = searchParams.get("companyId");

    if (!year || !month) {
      return Response.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }

    const { start, end } = getMonthRange(year, month);

    const records = await fetchAllPaged(() => {
      let query = supabase
        .from("daily_production_records")
        .select(`
          id,
          company_id,
          assigned_promoter_id,
          proposal_number,
          product_description,
          gross_value,
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

      return query;
    });

    const promoterIds = [...new Set(records.map((r) => r.assigned_promoter_id).filter(Boolean))];

    let promoters = [];
    if (promoterIds.length > 0) {
      const { data, error } = await supabase
        .from("promoters")
        .select("id, name")
        .in("id", promoterIds);

      if (error) throw error;
      promoters = data || [];
    }

    const proposalIds = records.map((r) => r.id);

    let manualRules = [];
    if (proposalIds.length > 0) {
      const { data, error } = await supabase
        .from("promoter_proposal_commissions")
        .select("daily_production_record_id, notes, active")
        .in("daily_production_record_id", proposalIds);

      if (error) throw error;
      manualRules = data || [];
    }

    const rows = records.map((record) => {
      const promoter = promoters.find((p) => p.id === record.assigned_promoter_id);
      const manual = manualRules.find(
        (m) => m.daily_production_record_id === record.id && m.active !== false
      );

      return {
        ...record,
        promoter_name: promoter?.name || null,
        manual_notes: manual?.notes || "",
      };
    });

    return Response.json({ rows });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao listar propostas." },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const supabase = getSupabase();
    const body = await req.json();

    const dailyProductionRecordId = body.dailyProductionRecordId;
    const promoterId = body.promoterId;
    const commissionPercent = body.commissionPercent;
    const insuranceCommissionPercent = body.insuranceCommissionPercent;
    const notes = body.notes;

    if (!dailyProductionRecordId || !promoterId) {
      return Response.json(
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

    return Response.json({
      success: true,
      message: "Regra manual da proposta salva com sucesso.",
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao salvar comissão." },
      { status: 500 }
    );
  }
}

export async function DELETE(req) {
  try {
    const supabase = getSupabase();
    const body = await req.json();
    const dailyProductionRecordId = body.dailyProductionRecordId;

    if (!dailyProductionRecordId) {
      return Response.json(
        { error: "Informe dailyProductionRecordId." },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("promoter_proposal_commissions")
      .delete()
      .eq("daily_production_record_id", dailyProductionRecordId);

    if (error) throw error;

    return Response.json({
      success: true,
      message: "Regra manual removida com sucesso.",
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao remover regra manual." },
      { status: 500 }
    );
  }
}
