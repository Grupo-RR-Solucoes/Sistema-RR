import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAtribuicaoProdutosAdmin } from "@/lib/auth/guards";
import { assignProductLine, syncPendingProductAssignments } from "@/lib/produtoAssignments";
import { assignConsorcioProposta, syncPendingConsorcioAnchors } from "@/lib/consorcio/fila";
import { PAPEIS_COM_VENDA_PROPRIA, parseBeneficiarioValue } from "@/lib/produtoBeneficiario";
import {
  EVENTO_UNICO,
  montarPayloadFilaAtribuicao,
} from "@/lib/produtos/filaAtribuicao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// FRENTE DE PRODUTO — M3 PARTE A1 + VENDA PROPRIA DE GESTAO: fila de atribuicao.
// GET  -> lista (READ-ONLY) as linhas de produto da fila (product_line_assignments)
//         agrupadas por produto: BBCAP / CONTA_CORRENTE (por competencia) e CONSORCIO
//         (por PROPOSTA, ancora, todas as competencias). NAO escreve nada.
// POST action=sync   -> popula a fila (syncPending*) — passo explicito.
// POST action=assign -> atribui/reatribui o dono de uma linha (evento unico) ou de
//         uma PROPOSTA inteira (consorcio, heranca).
//
// DONO = BENEFICIARIO: promotor OU papel de gestao com venda propria habilitada
// (app_users.venda_propria). O dropdown lista os dois; o valor trafega como
// "promotor:<uuid>" / "gestao:<uuid>" (ver lib/produtoBeneficiario).
//
// ESCOPO (requireAtribuicaoProdutos):
//   socio/funcionario -> TODOS os produtos.
//   gestor_consorcio  -> SO CONSORCIO. Nao le nem escreve BBCAP/CONTA_CORRENTE; o
//                        filtro esta neste arquivo porque a rota usa service_role
//                        (que bypassa a RLS). A policy da fila e defesa em profundidade.
// ============================================================

export async function GET(req: Request) {
  try {
    const { user, supabase } = await withAtribuicaoProdutosAdmin();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json({ error: "Informe year e month." }, { status: 400 });
    }
    // A montagem (e a VISIBILIDADE da comissao do promotor) vive na lib, para o
    // gate poder chama-la com cada papel. A rota so passa quem esta pedindo.
    const payload = await montarPayloadFilaAtribuicao(supabase, {
      year,
      month,
      role: user.role,
      escopo: user.escopo,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}


export async function POST(req: Request) {
  try {
    const { user, supabase } = await withAtribuicaoProdutosAdmin();
    const soConsorcio = user.escopo === "CONSORCIO";
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "sync") {
      const year = Number(body.year);
      const month = Number(body.month);
      if (!year || !month) {
        return NextResponse.json({ error: "Informe year e month." }, { status: 400 });
      }
      // escopo CONSORCIO: so as ancoras por proposta. Sincronizar evento unico criaria
      // linhas de BBCAP/Conta Corrente na fila a mando de quem nao pode ve-las.
      const eu = soConsorcio
        ? { criadas: 0 }
        : await syncPendingProductAssignments(supabase, { year, month });
      const cons = await syncPendingConsorcioAnchors(supabase, {});
      return NextResponse.json({
        ok: true,
        criadas: eu.criadas + cons.criadas,
        evento_unico: eu.criadas,
        consorcio: cons.criadas,
      });
    }

    if (action === "assign") {
      const entry_type = String(body.entry_type || "");
      const operation_number = String(body.operation_number || "");
      const company_id = body.company_id ?? null;
      // "" / ausente = desatribuir (volta ao balde). Aceita tambem promoter_id cru,
      // por compatibilidade com chamadas antigas.
      const beneficiario = parseBeneficiarioValue(
        body.beneficiario ?? body.beneficiario_value ?? body.promoter_id
      );
      const assigned_by = user.session.appUser.email;
      if (!entry_type || !operation_number) {
        return NextResponse.json({ error: "Informe entry_type e operation_number." }, { status: 400 });
      }
      if (soConsorcio && entry_type !== "CONSORCIO") {
        return NextResponse.json(
          { error: "O gestor de consorcio so atribui linhas de CONSORCIO." },
          { status: 403 }
        );
      }

      // Beneficiario de GESTAO precisa do flag LIGADO agora — senao a atribuicao
      // viraria um pagamento que o ledger depois recusaria em silencio (a trava de
      // coerencia de applyVendaPropriaGestao). Falha aqui, visivel, e melhor.
      if (beneficiario?.kind === "gestao") {
        const { data: alvo, error: alvoErr } = await supabase
          .from("app_users")
          .select("id, role, venda_propria, active")
          .eq("id", beneficiario.id)
          .maybeSingle();
        if (alvoErr) throw new Error(alvoErr.message);
        const ok =
          alvo &&
          alvo.active !== false &&
          alvo.venda_propria === true &&
          (PAPEIS_COM_VENDA_PROPRIA as readonly string[]).includes(String(alvo.role));
        if (!ok) {
          return NextResponse.json(
            { error: "Este usuario nao tem venda propria habilitada." },
            { status: 400 }
          );
        }
      }

      if (entry_type === "CONSORCIO") {
        await assignConsorcioProposta(supabase, {
          company_id,
          proposta: operation_number,
          beneficiario,
          assigned_by,
        });
      } else if (EVENTO_UNICO.includes(entry_type)) {
        await assignProductLine(supabase, {
          company_id,
          year: Number(body.year),
          month: Number(body.month),
          entry_type,
          operation_number,
          contract_number: String(body.contract_number ?? ""),
          beneficiario,
          assigned_by,
        });
      } else {
        return NextResponse.json({ error: "entry_type invalido." }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action invalida (sync|assign)." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
