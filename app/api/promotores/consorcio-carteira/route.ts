import { NextResponse } from "next/server";

import { apiGuardErrorResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { FATOR_REPASSE_PROMOTOR_CONSORCIO } from "@/lib/consorcio/trp210";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// FRENTE DE PRODUTO — M3 PARTE B: carteira de consorcio do PROMOTOR.
// Le carteira_consorcio filtrando pelo promoter_id do proprio promotor (RLS de
// promotor nao existe na tabela, entao service_role + FILTRO explicito pelo id da
// sessao — mesma disciplina do /api/promotores). Mostra as parcelas recebidas x a vir
// e o REPASSE do promotor (comissao-empresa x 0,40). socio/funcionario podem passar
// ?promoterId=. Gestor/outros: bloqueado (so proprio promotor ou admin).
// ============================================================

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: Request) {
  try {
    const { session, role } = await requireAuthenticated();
    const { searchParams } = new URL(req.url);

    // ISOLAMENTO: promotor -> so o proprio id; socio/funcionario -> id do query.
    let promoterId: string | null = null;
    if (role === "promotor") {
      promoterId = session.appUser.promoterId;
    } else if (role === "socio" || role === "funcionario") {
      promoterId = searchParams.get("promoterId");
    } else {
      return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    }
    if (!promoterId) {
      return NextResponse.json({ rows: [], resumo: emptyResumo() });
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("carteira_consorcio")
      .select(
        "proposta, posicao, segmento_grupo, teto_parcelas, valor_bem, comissao_esperada, comissao_recebida, competencia_recebida, status"
      )
      .eq("promoter_id", promoterId)
      .order("proposta", { ascending: true })
      .order("posicao", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data || []).map((r: any) => {
      const recebida = r.status === "RECEBIDA" || r.status === "ENCERRADA";
      const baseEmpresa = recebida ? Number(r.comissao_recebida || 0) : Number(r.comissao_esperada || 0);
      return {
        proposta: r.proposta,
        posicao: Number(r.posicao),
        segmento_grupo: r.segmento_grupo,
        teto_parcelas: Number(r.teto_parcelas),
        valor_bem: Number(r.valor_bem || 0),
        status: r.status,
        competencia_recebida: r.competencia_recebida,
        // repasse do promotor = comissao-empresa da parcela x 0,40 (recebida) ou
        // projetado (a vir).
        repasse: r2(baseEmpresa * FATOR_REPASSE_PROMOTOR_CONSORCIO),
        recebida,
      };
    });

    const recebidas = rows.filter((r) => r.recebida);
    const aVir = rows.filter((r) => r.status === "ESPERADA" || r.status === "NAO_VEIO");
    const resumo = {
      parcelas_recebidas: recebidas.length,
      parcelas_a_vir: aVir.length,
      propostas: new Set(rows.map((r) => r.proposta)).size,
      repasse_recebido: r2(recebidas.reduce((s, r) => s + r.repasse, 0)),
      repasse_a_vir: r2(aVir.reduce((s, r) => s + r.repasse, 0)),
    };

    return NextResponse.json({ rows, resumo });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

function emptyResumo() {
  return { parcelas_recebidas: 0, parcelas_a_vir: 0, propostas: 0, repasse_recebido: 0, repasse_a_vir: 0 };
}
