import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("recebimento_mensal")
    .select("*");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return Response.json([]);
  }

  const auditoria = data.map((r: any) => {
    const esperado = r.valor_recebido * 0.058;

    return {
      ...r,
      valor_promotor: esperado,
      diferenca: r.valor_recebido - esperado,
    };
  });

  return Response.json(auditoria);
}
