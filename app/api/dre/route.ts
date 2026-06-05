import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { buildDre } from "@/lib/dre";

export async function GET(req: Request) {
  try {
    // DRE = lucro consolidado (dado de SÓCIO). Autorização socio-only (requireSocio).
    // Cliente service_role (Escola A) porque o DRE lê `cms_imports`, que NÃO tem
    // grant para `authenticated` (só service_role) — sob RLS daria "permission
    // denied" e zeraria a lista de meses fechados. Mesmo padrão do
    // /api/calculate/monthly, que também lê cms_imports via admin. Para sócio o
    // conteúdo é idêntico (policies = "socio vê tudo").
    const { supabase } = await withSocioAdmin();

    const { searchParams } = new URL(req.url);
    const yearRaw = searchParams.get("year");
    const monthRaw = searchParams.get("month");
    const year = yearRaw ? Number(yearRaw) : undefined;
    const month = monthRaw ? Number(monthRaw) : undefined;

    const payload = await buildDre(
      supabase,
      Number.isFinite(year as number) ? year : undefined,
      Number.isFinite(month as number) ? month : undefined
    );

    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
