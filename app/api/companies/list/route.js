import { createClient } from "@supabase/supabase-js";

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("companies")
      .select("id, name, cnpj")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return Response.json({
      companies: data || [],
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao listar empresas." },
      { status: 500 }
    );
  }
}
