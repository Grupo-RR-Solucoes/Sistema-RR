import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildAgregadorForecast } from "@/lib/forecast/agregador";
import { buildPrtInadimplencia } from "@/lib/forecast/prtInadimplencia";

// Forecast (Camada 4): serve o agregador previsto-vs-recebido (Camada 3) +
// a detecção de inadimplência (Camada 1). Sócio-only (ferramenta financeira),
// igual ao /financeiro pelo menu. READ-ONLY.
//
// ?ref=YYYY-MM-DD (opcional) força a data de referência para a competência da
// produção aberta — útil em ambiente cujo relógio difira da base. Sem ref usa
// a data corrente do servidor.
export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const ref = searchParams.get("ref");
    const refDate = ref ? new Date(`${ref}T00:00:00Z`) : undefined;

    const [agregador, inadimplencia] = await Promise.all([
      buildAgregadorForecast(supabase, { refDate, lookbackMeses: 5, horizonteMeses: 6 }),
      buildPrtInadimplencia(supabase),
    ]);

    return NextResponse.json({ agregador, inadimplencia });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
