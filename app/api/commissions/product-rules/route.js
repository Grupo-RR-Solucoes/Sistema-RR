import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function toNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year") || 0);
    const month = Number(searchParams.get("month") || 0);
    const companyId = searchParams.get("companyId");
    const promoterId = searchParams.get("promoterId");

    if (!year || !month) {
      return Response.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }

    let query = supabase
      .from("promoter_product_commissions")
      .select("*")
      .eq("year", year)
      .eq("month", month)
      .eq("active", true)
      .order("product_description", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    if (promoterId) {
      query = query.eq("promoter_id", promoterId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return Response.json({ rows: data || [] });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao carregar regras por produto." },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const supabase = getSupabaseAdmin();
    const { year, month, companyId, promoterId, rows } = await req.json();

    if (!year || !month || !promoterId || !Array.isArray(rows)) {
      return Response.json(
        { error: "Informe competencia, promotor e linhas validas." },
        { status: 400 }
      );
    }

    const cleanRows = rows
      .filter(
        (row) =>
          String(row.product_description || "").trim() ||
          String(row.product_code || "").trim()
      )
      .map((row) => ({
        company_id: companyId || null,
        promoter_id: promoterId,
        year,
        month,
        product_code: String(row.product_code || "").trim() || null,
        product_description: String(row.product_description || "").trim(),
        company_received_percent_from:
          row.company_received_percent_from === "" ||
          row.company_received_percent_from === null ||
          row.company_received_percent_from === undefined
            ? null
            : toNumber(row.company_received_percent_from),
        company_received_percent_to:
          row.company_received_percent_to === "" ||
          row.company_received_percent_to === null ||
          row.company_received_percent_to === undefined
            ? null
            : toNumber(row.company_received_percent_to),
        commission_percent: toNumber(row.commission_percent),
        insurance_commission_percent: toNumber(
          row.insurance_commission_percent
        ),
        notes: String(row.notes || "").trim() || null,
        active: true,
      }));

    let deactivateQuery = supabase
      .from("promoter_product_commissions")
      .update({ active: false })
      .eq("year", year)
      .eq("month", month)
      .eq("promoter_id", promoterId);

    if (companyId) {
      deactivateQuery = deactivateQuery.eq("company_id", companyId);
    }

    const { error: deleteError } = await deactivateQuery;

    if (deleteError) throw deleteError;

    if (cleanRows.length > 0) {
      const { error: insertError } = await supabase
        .from("promoter_product_commissions")
        .insert(cleanRows);

      if (insertError) throw insertError;
    }

    return Response.json({ success: true, count: cleanRows.length });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao salvar regras por produto." },
      { status: 500 }
    );
  }
}
