import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioOrFuncionarioAdmin,
} from "@/lib/auth/guards";

// ============================================================
// ETAPA 6 — CRUD de lancamentos manuais de receita (por CNPJ/mes).
// receita_total = fechamento + Σ lancamentos manuais (aditivo).
//
// GET    ?companyId=&ano=&mes=   -> lista (+ companies p/ filtro)
// POST   { company_id, ano, mes, categoria, valor, descricao }
// PATCH  { id, ...campos }
// DELETE ?id=
// socio/funcionario.
// ============================================================

const CATEGORIAS = ["CONSORCIO", "AJUSTE_CONTADOR", "OUTRO"];

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(String(v).replace(/\./g, "").replace(",", "."));
}

// data_credito: lancamento manual entra no caixa pela data REAL do credito
// (sem defasagem M+1). Default neutro = dia 1 da competencia (ano/mes); o
// usuario ajusta livremente do 1o ao ultimo dia (sem trava de dia util aqui).
function defaultCreditDate(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const ano = searchParams.get("ano");
    const mes = searchParams.get("mes");

    let q = supabase
      .from("receita_lancamento_manual")
      .select("id, company_id, ano, mes, categoria, valor, descricao, data_credito, created_at, updated_at")
      .order("ano", { ascending: false })
      .order("mes", { ascending: false })
      .order("created_at", { ascending: false });
    if (companyId) q = q.eq("company_id", companyId);
    if (ano) q = q.eq("ano", Number(ano));
    if (mes) q = q.eq("mes", Number(mes));
    const { data: lancamentos, error } = await q;
    if (error) throw error;

    const { data: companies } = await supabase
      .from("companies")
      .select("id, name, cnpj, group_code")
      .not("cnpj", "like", "TEMP-%")
      .order("group_code");

    return NextResponse.json({ lancamentos: lancamentos || [], companies: companies || [] });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const body = await req.json().catch(() => ({}));
    const company_id = body?.company_id ? String(body.company_id) : "";
    const ano = Number(body?.ano);
    const mes = Number(body?.mes);
    const categoria = String(body?.categoria || "");
    const valor = num(body?.valor);
    const descricao = body?.descricao ? String(body.descricao) : null;
    const data_credito = body?.data_credito
      ? String(body.data_credito)
      : defaultCreditDate(ano, mes);

    if (!company_id || !ano || !mes || mes < 1 || mes > 12) {
      return NextResponse.json({ error: "Informe empresa e competencia (ano/mes)." }, { status: 400 });
    }
    if (!CATEGORIAS.includes(categoria)) {
      return NextResponse.json({ error: "Categoria invalida." }, { status: 400 });
    }
    if (!Number.isFinite(valor)) {
      return NextResponse.json({ error: "Valor invalido." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("receita_lancamento_manual")
      .insert({ company_id, ano, mes, categoria, valor, descricao, data_credito })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, lancamento: data });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : "";
    if (!id) return NextResponse.json({ error: "Informe o id." }, { status: 400 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.ano !== undefined) patch.ano = Number(body.ano);
    if (body.mes !== undefined) patch.mes = Number(body.mes);
    if (body.categoria !== undefined) {
      if (!CATEGORIAS.includes(String(body.categoria))) {
        return NextResponse.json({ error: "Categoria invalida." }, { status: 400 });
      }
      patch.categoria = String(body.categoria);
    }
    if (body.valor !== undefined) {
      const v = num(body.valor);
      if (!Number.isFinite(v)) return NextResponse.json({ error: "Valor invalido." }, { status: 400 });
      patch.valor = v;
    }
    if (body.descricao !== undefined) patch.descricao = body.descricao ? String(body.descricao) : null;
    if (body.company_id !== undefined) patch.company_id = String(body.company_id);
    if (body.data_credito !== undefined && body.data_credito) patch.data_credito = String(body.data_credito);

    const { error } = await supabase.from("receita_lancamento_manual").update(patch).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe o id." }, { status: 400 });
    const { error } = await supabase.from("receita_lancamento_manual").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
