import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAdmin,
} from "@/lib/auth/guards";
import { calcularRbt12 } from "@/lib/rbt12";

// ============================================================
// ETAPA 6 — GET /api/rbt12?ano=&mes=
// Monitor de faixa do Simples (Anexo III) por CNPJ. Leitura pura
// (fechamento_mensal_empresa + receita_lancamento_manual, union real+TEMP).
// Default: mai/2026 (ultimo fechado), janela 12m.
// ============================================================

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const { searchParams } = new URL(req.url);
    const ano = searchParams.get("ano") ? Number(searchParams.get("ano")) : undefined;
    const mes = searchParams.get("mes") ? Number(searchParams.get("mes")) : undefined;

    const result = await calcularRbt12(supabase, { ano, mes });
    return NextResponse.json(result);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
