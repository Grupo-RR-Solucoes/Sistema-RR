import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("diferido_parcelas")
    .select("*")
    .order("data_prevista");

  return Response.json(data);
}
