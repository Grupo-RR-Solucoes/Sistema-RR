import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";

export async function GET(req: Request) {
  try {
    const { supabase } = await withAuthenticatedAnon();
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    // Filtra chaves master operacionais (Disc.12). Master eh
    // promoter "tecnico" - recebe producao via fluxo
    // MASTER_REASSIGNED quando importador nao bate Chave J,
    // mas nao deve aparecer em dropdowns para amarrar com
    // usuario humano.
    let query = supabase
      .from("promoters")
      .select("id, company_id, name, active")
      .eq("active", true)
      .eq("is_master", false)
      .order("name", { ascending: true });

    if (companyId) {
      query = query.eq("company_id", companyId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({
      promoters: data || [],
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
