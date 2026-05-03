import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function GET(req) {
  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    let query = supabase
      .from("promoters")
      .select("id, company_id, name, active")
      .eq("active", true)
      .order("name", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return Response.json({
      promoters: data || [],
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao listar promotores." },
      { status: 500 }
    );
  }
}
