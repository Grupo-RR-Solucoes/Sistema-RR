import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";

export async function GET() {
  try {
    const { supabase } = await withAuthenticatedAnon();

    const { data, error } = await supabase
      .from("companies")
      .select("id, name, cnpj")
      .eq("active", true)
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
