import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin, withSocioOrFuncionarioAdmin } from "@/lib/auth/guards";
import { SHAPE_VERSION_BBTS, BbtsValidationError } from "@/lib/bbts/regraBbts";
import { validarRegraBbts } from "@/lib/bbts/validateRegraBbts";
import { competenciaFirstDay, competenciaKey } from "@/lib/trp/vigencia";

// Auditoria ADS/BBTS — 1A: /api/bbts/staging (RASCUNHOS).
//
// INVARIANTE: estas rotas escrevem SÓ em bbts_rule_uploads. Nunca chamam
// commitBbtsVersion / bbts_commit_version, nunca escrevem em bbts_rule_versions.
//
// POST  (socio+funcionario): salva/atualiza o rascunho PENDENTE da competência.
// GET   ?status=pendente (socio-only): inbox de rascunhos para o sócio revisar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAdmin();
    const uid = user.session.appUser.id;

    const body = await req.json().catch(() => ({}));
    const regraDraft = body?.regraDraft;
    const meta = body?.meta ?? {};
    const competenciaRaw = body?.competencia ?? meta?.competencia;
    if (!regraDraft || !competenciaRaw) {
      return NextResponse.json({ error: "envie { competencia, regraDraft, meta }" }, { status: 400 });
    }

    let comp: string;
    try {
      comp = competenciaKey(String(competenciaRaw));
    } catch (e) {
      return NextResponse.json(
        { error: "competência inválida", detalhe: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }

    // defesa em profundidade: o gate roda também no staging (mesma regra do commit)
    try {
      validarRegraBbts(regraDraft, comp);
    } catch (e) {
      if (e instanceof BbtsValidationError) {
        return NextResponse.json(
          { error: e.message, detalhe: e.detalhe ?? null, tipo: e.name },
          { status: 422 },
        );
      }
      throw e;
    }

    const firstDay = competenciaFirstDay(comp);
    const row = {
      competencia: firstDay,
      shape_version: SHAPE_VERSION_BBTS,
      regra_draft: regraDraft,
      confianca: body?.confianca ?? null,
      doc_ref: meta?.doc_ref ?? null,
      source_filename: meta?.source_filename ?? null,
      source_sha256: meta?.sha256 ?? null,
      parser_version: meta?.parser_version ?? null,
      status: "pendente" as const,
      uploaded_by: uid,
      uploaded_at: new Date().toISOString(),
    };

    // Upsert manual respeitando o índice parcial único (1 pendente/competência).
    const upd = await supabase
      .from("bbts_rule_uploads")
      .update(row)
      .eq("competencia", firstDay)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (upd.error) {
      return NextResponse.json({ error: "erro ao salvar rascunho", detalhe: upd.error.message }, { status: 500 });
    }
    if (upd.data?.id) {
      return NextResponse.json({ uploadId: upd.data.id, replaced: true });
    }

    const ins = await supabase.from("bbts_rule_uploads").insert(row).select("id").single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code === "23505") {
        const retry = await supabase
          .from("bbts_rule_uploads")
          .update(row)
          .eq("competencia", firstDay)
          .eq("status", "pendente")
          .select("id")
          .maybeSingle();
        if (!retry.error && retry.data?.id) {
          return NextResponse.json({ uploadId: retry.data.id, replaced: true });
        }
      }
      return NextResponse.json({ error: "erro ao salvar rascunho", detalhe: ins.error.message }, { status: 500 });
    }
    return NextResponse.json({ uploadId: ins.data.id, replaced: false });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAdmin();
    const status = new URL(req.url).searchParams.get("status") ?? "pendente";
    const { data, error } = await supabase
      .from("bbts_rule_uploads")
      .select("id, competencia, doc_ref, source_filename, parser_version, status, uploaded_by, uploaded_at")
      .eq("status", status)
      .order("competencia", { ascending: false })
      .order("uploaded_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: "erro ao listar rascunhos", detalhe: error.message }, { status: 500 });
    }
    return NextResponse.json({ pendentes: data ?? [] });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
