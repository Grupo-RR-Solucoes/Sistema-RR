import { NextResponse } from "next/server";

import { apiGuardErrorResponse, requireGestor } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/auth/supabaseServerClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildTeamProduction } from "@/lib/equipe/teamProduction";

export const dynamic = "force-dynamic";

/**
 * GET /api/equipe
 * Visão do gestor (F4): produção/desempenho + metas vs realizado do TIME do
 * gestor logado, SEM comissão/financeiro/PII. Guard requireGestor.
 *
 * A segurança do escopo é do BANCO: vw_team_production (F3) e a policy de
 * monthly_targets já filtram pela árvore do gestor via auth.uid(). Por isso o
 * client de leitura é o ANON autenticado (não service_role). O service_role é
 * usado SÓ para resolver nomes dos promotores já autorizados pelas fontes RLS.
 * NÃO consulta daily_production_records crua nem qualquer tabela de comissão.
 */
export async function GET(req: Request) {
  try {
    await requireGestor();
    const db = await createSupabaseServerClient();
    const admin = getSupabaseAdmin();

    const { searchParams } = new URL(req.url);
    const yearParam = Number(searchParams.get("year"));
    const monthParam = Number(searchParams.get("month"));
    const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : undefined;
    const month =
      Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
        ? monthParam
        : undefined;

    const payload = await buildTeamProduction(db, admin, { year, month });
    return NextResponse.json(payload);
  } catch (e) {
    return apiGuardErrorResponse(e);
  }
}
