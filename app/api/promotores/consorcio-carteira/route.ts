import { NextResponse } from "next/server";

import { apiGuardErrorResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { FATOR_REPASSE_PROMOTOR_CONSORCIO } from "@/lib/consorcio/trp210";
import { resolveConsorcioBeneficiarioByProposta } from "@/lib/consorcio/fila";
import { filtrarCarteiraDoPromotor } from "@/lib/consorcio/carteira";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// FRENTE DE PRODUTO — M3 PARTE B: carteira de consorcio do PROMOTOR.
// Le carteira_consorcio e devolve as parcelas DO PROMOTOR. RLS de promotor nao
// existe nesta tabela, entao service_role + FILTRO explicito pelo id da sessao —
// mesma disciplina do /api/promotores. Mostra as parcelas recebidas x a vir e o
// REPASSE do promotor (comissao-empresa x 0,40). socio/funcionario podem passar
// ?promoterId=. Gestor/outros: bloqueado (so proprio promotor ou admin).
//
// O DONO VEM DA ANCORA, NAO DA COLUNA. Esta rota filtrava por
// `carteira_consorcio.promoter_id`, que e um RETRATO DO IMPORT:
// materializarCarteiraConsorcio so roda em app/api/import/closing, e atribuir na
// fila NAO re-materializa. Medido em 23/08/2026: 27 ancoras de consorcio
// ASSIGNED contra 316 linhas de carteira com promoter_id NULO — a carteira do
// promotor aparecia VAZIA em PromotorView:517 para todo mundo, com a atribuicao
// feita e o PMR pagando certo.
//
// Agora o dono sai de resolveConsorcioBeneficiarioByProposta, a MESMA funcao que
// o pagamento (computeConsorcioCommissionByBeneficiario) e o detalhamento
// (lib/produtos/produtoProposalRows, commit ea262db) usam. Uma fonte para o dono.
//
// O FILTRO SAIU DO SQL E FOI PARA O JS, e a guarda NAO mudou: `promoterId`
// continua vindo da sessao (o ?promoterId= do promotor segue descartado) e
// nenhuma linha de outro dono e devolvida. Sao 316 linhas no total — trazer
// todas e filtrar em memoria custa menos que uma segunda ida ao banco.
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
    const [carteira, donoPorProposta] = await Promise.all([
      admin
        .from("carteira_consorcio")
        .select(
          "company_id, proposta, posicao, segmento_grupo, teto_parcelas, valor_bem, comissao_esperada, comissao_recebida, competencia_recebida, status"
        )
        .order("proposta", { ascending: true })
        .order("posicao", { ascending: true }),
      resolveConsorcioBeneficiarioByProposta(admin),
    ]);
    if (carteira.error) throw new Error(carteira.error.message);

    // SO as parcelas cuja ANCORA aponta para ESTE promotor. Proposta de papel de
    // GESTAO (venda propria) nao e de promotor nenhum — vai para
    // gestao_venda_propria, e nao entra aqui.
    const data = filtrarCarteiraDoPromotor(
      (carteira.data || []) as any[],
      donoPorProposta,
      promoterId
    );

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
