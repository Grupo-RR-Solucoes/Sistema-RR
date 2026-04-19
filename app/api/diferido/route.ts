import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data } = await supabaseAdmin
    .from("diferido_parcelas")
    .select("*")
    .order("data_prevista");

  return Response.json(data);
}
