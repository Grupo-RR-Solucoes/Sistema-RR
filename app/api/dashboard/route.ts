import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("fechamento_mensal_empresa")
    .select("*")
    .order("ano", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
