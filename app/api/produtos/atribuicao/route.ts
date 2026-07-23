import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withAtribuicaoProdutosAdmin } from "@/lib/auth/guards";
import { assignProductLine, syncPendingProductAssignments } from "@/lib/produtoAssignments";
import { assignConsorcioProposta, syncPendingConsorcioAnchors } from "@/lib/consorcio/fila";
import {
  PAPEIS_COM_VENDA_PROPRIA,
  beneficiarioDaLinha,
  beneficiarioValue,
  parseBeneficiarioValue,
} from "@/lib/produtoBeneficiario";

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

const EVENTO_UNICO = ["BBCAP", "CONTA_CORRENTE"];

function isBalde(entryType: string, operation: string | null): boolean {
  return entryType === "CONTA_CORRENTE" && String(operation || "").startsWith("SEMID|");
}

export async function GET(req: Request) {
  try {
    const { user, supabase } = await withAtribuicaoProdutosAdmin();
    const soConsorcio = user.escopo === "CONSORCIO";
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json({ error: "Informe year e month." }, { status: 400 });
    }

    // eventos unicos da competencia + ancoras de consorcio (todas as competencias).
    // No escopo CONSORCIO os eventos unicos nem sao consultados.
    const [eu, cons, proms, gestores] = await Promise.all([
      soConsorcio
        ? Promise.resolve({ data: [], error: null } as any)
        : supabase
            .from("product_line_assignments")
            .select(
              "id, company_id, entry_type, operation_number, contract_number, promoter_id, assigned_app_user_id, status, source, year, month"
            )
            .in("entry_type", EVENTO_UNICO)
            .eq("year", year)
            .eq("month", month),
      supabase
        .from("product_line_assignments")
        .select(
          "id, company_id, entry_type, operation_number, contract_number, promoter_id, assigned_app_user_id, status, source, year, month"
        )
        .eq("entry_type", "CONSORCIO"),
      supabase.from("promoters").select("id, name, company_id, active"),
      // papeis de gestao COM venda propria habilitada — os outros beneficiarios.
      supabase
        .from("app_users")
        .select("id, full_name, email, role, venda_propria, active")
        .eq("venda_propria", true)
        .eq("active", true),
    ]);
    if (eu.error) throw new Error(eu.error.message);
    if (cons.error) throw new Error(cons.error.message);
    if (proms.error) throw new Error(proms.error.message);
    if (gestores.error) throw new Error(gestores.error.message);

    const nameOf = new Map((proms.data || []).map((p: any) => [p.id, p.name]));
    const gestaoRows = (gestores.data || []).filter((g: any) =>
      (PAPEIS_COM_VENDA_PROPRIA as readonly string[]).includes(String(g.role))
    );
    const gestaoNameOf = new Map(
      gestaoRows.map((g: any) => [g.id, String(g.full_name || g.email || "(gestao)")])
    );

    // LISTA UNICA do dropdown: promotores + gestao. `kind` separa os dois na tela
    // (a linha de gestao aparece em destaque para conferencia — auto-atribuicao e
    // liberada, entao ela precisa ser visivel).
    const beneficiarios = [
      ...(proms.data || [])
        .filter((p: any) => p.active !== false)
        .map((p: any) => ({
          value: beneficiarioValue({ kind: "promotor", id: p.id }),
          kind: "promotor" as const,
          id: p.id,
          nome: String(p.name),
          sub: "",
        }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome)),
      ...gestaoRows
        .map((g: any) => ({
          value: beneficiarioValue({ kind: "gestao", id: g.id }),
          kind: "gestao" as const,
          id: g.id,
          nome: String(g.full_name || g.email || "(gestao)"),
          sub: ROLE_LABEL[String(g.role)] ?? String(g.role),
        }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome)),
    ];

    const toItem = (r: any) => {
      const dono = beneficiarioDaLinha(r);
      return {
        id: r.id,
        company_id: r.company_id,
        entry_type: r.entry_type,
        operation_number: r.operation_number,
        contract_number: r.contract_number ?? "",
        beneficiario_value: dono ? beneficiarioValue(dono) : "",
        beneficiario_kind: dono?.kind ?? null,
        beneficiario_nome: dono
          ? dono.kind === "promotor"
            ? nameOf.get(dono.id) ?? "(promotor removido)"
            : gestaoNameOf.get(dono.id) ?? "(gestao sem venda propria)"
          : null,
        status: r.status,
        balde: isBalde(r.entry_type, r.operation_number),
      };
    };

    const euRows = (eu.data || []).map(toItem);
    const grupos = {
      bbcap: euRows.filter((r: any) => r.entry_type === "BBCAP").sort(ordena),
      conta_corrente: euRows.filter((r: any) => r.entry_type === "CONTA_CORRENTE").sort(ordena),
      consorcio: (cons.data || []).map(toItem).sort(ordena),
    };

    const todas = [...grupos.bbcap, ...grupos.conta_corrente, ...grupos.consorcio];
    const resumo = {
      pendentes: todas.filter((r: any) => r.status === "PENDING").length,
      atribuidas: todas.filter((r: any) => r.status === "ASSIGNED").length,
      gestao: todas.filter((r: any) => r.beneficiario_kind === "gestao").length,
    };

    return NextResponse.json({
      year,
      month,
      escopo: user.escopo,
      role: user.role,
      grupos,
      beneficiarios,
      resumo,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

const ROLE_LABEL: Record<string, string> = {
  gestor_consorcio: "Gestor de Consórcio",
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
};

function ordena(a: any, b: any) {
  if (a.status !== b.status) return a.status === "PENDING" ? -1 : 1; // pendentes primeiro
  return String(a.operation_number).localeCompare(String(b.operation_number));
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
