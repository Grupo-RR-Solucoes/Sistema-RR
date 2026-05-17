import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";

export async function GET() {
  try {
    const { supabase } = await withAuthenticatedAnon();

    const { data, error } = await supabase
      .from("companies")
      .select("id, name, cnpj")
      .eq("active", true)
      // Filtra empresas placeholder (criadas por /api/import/cadastros
      // quando importacao nao bate com empresa real). Para listagem de
      // criacao de usuario, so faz sentido amarrar a empresas com CNPJ
      // real. Cleanup arquitetural dessas placeholders fica para Disc.11.
      .not("cnpj", "like", "TEMP-%")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      companies: data || [],
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
