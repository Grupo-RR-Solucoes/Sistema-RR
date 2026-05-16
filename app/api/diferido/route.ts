import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";

export async function GET() {
  try {
    const { supabase } = await withSocioAnon();

    const { data, error } = await supabase
      .from("diferido_parcelas")
      .select("*")
      .order("data_prevista");

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
