import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";
import { fetchAllRows } from "@/lib/queryHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M2b) — le SO o payout dos 10% dele.
// Escola B: client ANON autenticado + RLS. A policy
// consorcio_gestor_payout_gestor_select restringe as linhas ao gestor logado
// (role gestor_consorcio + gestor_user_id = seu app_user id). O gestor NUNCA ve
// a comissao dos promotores (que vive na PMR / outra tabela). READ-ONLY.
// ============================================================

type PayoutRow = {
  competencia: string;
  company_id: string | null;
  base_comissao_empresa: number;
  gestor_10: number;
  status: string;
};

export async function GET(req: Request) {
  try {
    // Autenticado; a RLS faz o corte fino (so as linhas do proprio gestor).
    const { supabase } = await withAuthenticatedAnon();

    const rows = await fetchAllRows<PayoutRow>(() =>
      supabase
        .from("consorcio_gestor_payout")
        .select("competencia, company_id, base_comissao_empresa, gestor_10, status")
    );

    // agrega por competencia (o gestor recebe 1 numero por mes = soma das empresas).
    const porComp = new Map<string, { competencia: string; base: number; gestor_10: number; empresas: number }>();
    for (const r of rows) {
      const cur =
        porComp.get(r.competencia) || { competencia: r.competencia, base: 0, gestor_10: 0, empresas: 0 };
      cur.base = Math.round((cur.base + Number(r.base_comissao_empresa || 0)) * 100) / 100;
      cur.gestor_10 = Math.round((cur.gestor_10 + Number(r.gestor_10 || 0)) * 100) / 100;
      cur.empresas += 1;
      porComp.set(r.competencia, cur);
    }
    const competencias = [...porComp.values()].sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
    const total = Math.round(competencias.reduce((s, c) => s + c.gestor_10, 0) * 100) / 100;

    return NextResponse.json({ competencias, total });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
