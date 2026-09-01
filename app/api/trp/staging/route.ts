import { NextResponse } from "next/server";

import {
  apiGuardErrorResponse,
  withSocioAdmin,
  withSocioOrFuncionarioAdmin,
} from "@/lib/auth/guards";
import { TrpValidationError } from "@/lib/trp/parseTrpDraft";
import { validateRegraDraft } from "@/lib/trp/validateRegraDraft";
import { competenciaFirstDay, competenciaKey } from "@/lib/trp/vigencia";

// F6b sub-fase 3 — /api/trp/staging (RASCUNHOS).
//
// INVARIANTE: estas rotas escrevem SÓ em trp_rule_uploads. Nunca chamam
// commitTrpVersion / trp_commit_version, nunca escrevem em trp_rule_versions.
// (A leitura de trp_rule_versions no diff é o GET :id, e é só-leitura.)
//
// POST  (socio+funcionario): salva/atualiza o rascunho PENDENTE da competência.
// GET   ?status=pendente (socio-only): inbox de rascunhos para o sócio revisar.
//
// valid_from_override (Fase 3, 01/09/2026): o início de vigência que vem de FORA
// do PDF. O FUNCIONÁRIO pode gravá-lo no rascunho — decisão do Diego (01/09) —
// porque rascunho NÃO é régua: nada aqui chega a trp_rule_versions. Quem grava a
// régua é o sócio, e a tela de revisão dele mostra a data EM DESTAQUE justamente
// porque ela não veio do documento. A validação séria (janela + anteparo do
// buraco) é de commitTrpVersion; aqui a data é só transportada.

// POST — salvar rascunho revisado (upsert por competência: 1 pendente).
export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAdmin();
    const uid = user.session.appUser.id;

    const body = await req.json().catch(() => ({}));
    const regraDraft = body?.regraDraft;
    const meta = body?.meta ?? {};
    const competenciaRaw = body?.competencia ?? meta?.competencia;
    if (!regraDraft || !competenciaRaw) {
      return NextResponse.json(
        { error: "envie { competencia, regraDraft, meta }" },
        { status: 400 },
      );
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

    // defesa em profundidade: valida o draft já no staging (mesma regra do commit)
    try {
      validateRegraDraft(regraDraft, comp);
    } catch (e) {
      if (e instanceof TrpValidationError) {
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
      regime: "VOLUME_5_FAIXAS",
      regra_draft: regraDraft,
      confianca: body?.confianca ?? null,
      trp_doc_ref: meta?.trp_doc_ref ?? null,
      source_filename: meta?.source_filename ?? null,
      source_sha256: meta?.sha256 ?? null,
      parser_version: meta?.parser_version ?? null,
      status: "pendente" as const,
      uploaded_by: uid,
      uploaded_at: new Date().toISOString(),
      // "" (input de data em branco) e undefined viram NULL: sem override.
      valid_from_override: body?.validFromOverride ? String(body.validFromOverride) : null,
    };

    // Upsert manual respeitando o índice parcial único (1 pendente/competência):
    // update-first; se nada foi atualizado, insere; corrida vira 23505 -> re-update.
    const upd = await supabase
      .from("trp_rule_uploads")
      .update(row)
      .eq("competencia", firstDay)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();
    if (upd.error) {
      return NextResponse.json(
        { error: "erro ao salvar rascunho", detalhe: upd.error.message },
        { status: 500 },
      );
    }
    if (upd.data?.id) {
      return NextResponse.json({ uploadId: upd.data.id, replaced: true });
    }

    const ins = await supabase.from("trp_rule_uploads").insert(row).select("id").single();
    if (ins.error) {
      if ((ins.error as { code?: string }).code === "23505") {
        const retry = await supabase
          .from("trp_rule_uploads")
          .update(row)
          .eq("competencia", firstDay)
          .eq("status", "pendente")
          .select("id")
          .maybeSingle();
        if (!retry.error && retry.data?.id) {
          return NextResponse.json({ uploadId: retry.data.id, replaced: true });
        }
      }
      return NextResponse.json(
        { error: "erro ao salvar rascunho", detalhe: ins.error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ uploadId: ins.data.id, replaced: false });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

// GET ?status=pendente — inbox do sócio (socio-only).
export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAdmin();
    const status = new URL(req.url).searchParams.get("status") ?? "pendente";
    const { data, error } = await supabase
      .from("trp_rule_uploads")
      .select(
        "id, competencia, regime, trp_doc_ref, source_filename, parser_version, status, uploaded_by, uploaded_at, valid_from_override",
      )
      .eq("status", status)
      .order("competencia", { ascending: false })
      .order("uploaded_at", { ascending: false });
    if (error) {
      return NextResponse.json(
        { error: "erro ao listar rascunhos", detalhe: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ pendentes: data ?? [] });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
