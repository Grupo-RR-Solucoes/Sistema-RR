import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";

export async function GET(req: Request) {
  try {
    const { supabase } = await withAuthenticatedAnon();
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

    return NextResponse.json({
      promoters: data || [],
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
