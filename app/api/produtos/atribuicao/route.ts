import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAdmin } from "@/lib/auth/guards";
import { assignProductLine, syncPendingProductAssignments } from "@/lib/produtoAssignments";
import { assignConsorcioProposta, syncPendingConsorcioAnchors } from "@/lib/consorcio/fila";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// FRENTE DE PRODUTO — M3 PARTE A1: fila de atribuicao.
// GET  -> lista (READ-ONLY) as linhas de produto da fila (product_line_assignments)
//         agrupadas por produto: BBCAP / CONTA_CORRENTE (por competencia) e CONSORCIO
//         (por PROPOSTA, ancora, todas as competencias). NAO escreve nada.
// POST action=sync   -> popula a fila (syncPending*) — passo explicito do socio.
// POST action=assign -> atribui/reatribui o promotor de uma linha (evento unico) ou de
//         uma PROPOSTA inteira (consorcio, heranca). socio/funcionario. READ do que
//         existe: se a fila estiver vazia, devolve listas vazias (nao erro).
// ============================================================

const EVENTO_UNICO = ["BBCAP", "CONTA_CORRENTE"];

function isBalde(entryType: string, operation: string | null): boolean {
  return entryType === "CONTA_CORRENTE" && String(operation || "").startsWith("SEMID|");
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json({ error: "Informe year e month." }, { status: 400 });
    }

    // eventos unicos da competencia + ancoras de consorcio (todas as competencias).
    const [eu, cons, proms] = await Promise.all([
      supabase
        .from("product_line_assignments")
        .select("id, company_id, entry_type, operation_number, contract_number, promoter_id, status, source, year, month")
        .in("entry_type", EVENTO_UNICO)
        .eq("year", year)
        .eq("month", month),
      supabase
        .from("product_line_assignments")
        .select("id, company_id, entry_type, operation_number, contract_number, promoter_id, status, source, year, month")
        .eq("entry_type", "CONSORCIO"),
      supabase.from("promoters").select("id, name, company_id, active"),
    ]);
    if (eu.error) throw new Error(eu.error.message);
    if (cons.error) throw new Error(cons.error.message);
    if (proms.error) throw new Error(proms.error.message);

    const nameOf = new Map((proms.data || []).map((p: any) => [p.id, p.name]));
    const promoters = (proms.data || [])
      .filter((p: any) => p.active !== false)
      .map((p: any) => ({ id: p.id, name: p.name, company_id: p.company_id }))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

    const toItem = (r: any) => ({
      id: r.id,
      company_id: r.company_id,
      entry_type: r.entry_type,
      operation_number: r.operation_number,
      contract_number: r.contract_number ?? "",
      promoter_id: r.promoter_id,
      promoter_name: r.promoter_id ? nameOf.get(r.promoter_id) ?? "(promotor removido)" : null,
      status: r.status,
      balde: isBalde(r.entry_type, r.operation_number),
    });

    const euRows = (eu.data || []).map(toItem);
    const grupos = {
      bbcap: euRows.filter((r) => r.entry_type === "BBCAP").sort(ordena),
      conta_corrente: euRows.filter((r) => r.entry_type === "CONTA_CORRENTE").sort(ordena),
      consorcio: (cons.data || []).map(toItem).sort(ordena),
    };

    const resumo = {
      pendentes:
        grupos.bbcap.filter((r) => r.status === "PENDING").length +
        grupos.conta_corrente.filter((r) => r.status === "PENDING").length +
        grupos.consorcio.filter((r) => r.status === "PENDING").length,
      atribuidas:
        grupos.bbcap.filter((r) => r.status === "ASSIGNED").length +
        grupos.conta_corrente.filter((r) => r.status === "ASSIGNED").length +
        grupos.consorcio.filter((r) => r.status === "ASSIGNED").length,
    };

    return NextResponse.json({ year, month, grupos, promoters, resumo });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

function ordena(a: any, b: any) {
  if (a.status !== b.status) return a.status === "PENDING" ? -1 : 1; // pendentes primeiro
  return String(a.operation_number).localeCompare(String(b.operation_number));
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAdmin();
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "sync") {
      const year = Number(body.year);
      const month = Number(body.month);
      if (!year || !month) {
        return NextResponse.json({ error: "Informe year e month." }, { status: 400 });
      }
      const eu = await syncPendingProductAssignments(supabase, { year, month });
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
      const promoter_id = body.promoter_id ? String(body.promoter_id) : null; // null = desatribuir
      const assigned_by = user.session.appUser.email;
      if (!entry_type || !operation_number) {
        return NextResponse.json({ error: "Informe entry_type e operation_number." }, { status: 400 });
      }

      if (entry_type === "CONSORCIO") {
        await assignConsorcioProposta(supabase, {
          company_id,
          proposta: operation_number,
          promoter_id,
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
          promoter_id,
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
