import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { commitBbtsVersion } from "@/lib/bbts/commitBbtsVersion";
import { BbtsValidationError } from "@/lib/bbts/regraBbts";

// Auditoria ADS/BBTS — 1A: POST /api/bbts/commit (SOCIO-ONLY, GRAVA a versão viva).
//
// Guard: withSocioAdmin = requireSocio (403 para não-sócio, checado NO SERVIDOR) +
// service_role. Único caminho do sistema que escreve em bbts_rule_versions, e faz
// isso via commitBbtsVersion (que chama o RPC atômico bbts_commit_version).
//
// Aceita:
//   { uploadId }         -> fluxo DELEGADO: lê o rascunho pendente do staging.
//   { regraDraft, meta } -> fluxo DIRETO do sócio (subiu + revisou na mesma sessão).
//
// Re-valida a régua e recomputa a vigência no servidor. Régua inválida -> 422,
// NADA gravado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioAdmin();
    const socioId = user.session.appUser.id;

    const body = await req.json().catch(() => ({}));

    let regraJson: Record<string, unknown> | undefined;
    let competencia: string | undefined;
    let docRef: string | null = null;
    let sourceFilename: string | null = null;
    let sourceSha256: string | null = null;
    let parserVersion: string | null = null;
    let uploadId: string | null = null;

    if (body?.uploadId) {
      // ---- fluxo delegado: draft vem do STAGING (não do client) ----
      uploadId = String(body.uploadId);
      const { data: draftRow, error } = await supabase
        .from("bbts_rule_uploads")
        .select("id, competencia, regra_draft, doc_ref, source_filename, source_sha256, parser_version, status")
        .eq("id", uploadId)
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: "erro ao ler o rascunho do staging", detalhe: error.message },
          { status: 500 },
        );
      }
      if (!draftRow) {
        return NextResponse.json({ error: "rascunho não encontrado" }, { status: 404 });
      }
      if (draftRow.status !== "pendente") {
        return NextResponse.json(
          { error: `rascunho não está pendente (status atual: ${draftRow.status})` },
          { status: 409 },
        );
      }
      regraJson = draftRow.regra_draft as Record<string, unknown>;
      competencia = String(draftRow.competencia);
      docRef = draftRow.doc_ref ?? null;
      sourceFilename = draftRow.source_filename ?? null;
      sourceSha256 = draftRow.source_sha256 ?? null;
      parserVersion = draftRow.parser_version ?? null;
    } else {
      // ---- fluxo direto: régua vem do client (re-validada no servidor) ----
      regraJson = body?.regraDraft;
      const meta = body?.meta ?? {};
      competencia = meta?.competencia;
      docRef = meta?.doc_ref ?? null;
      sourceFilename = meta?.source_filename ?? null;
      sourceSha256 = meta?.sha256 ?? null;
      parserVersion = meta?.parser_version ?? null;
      if (!regraJson || !competencia) {
        return NextResponse.json(
          { error: "envie { uploadId } ou { regraDraft, meta } com competência" },
          { status: 400 },
        );
      }
    }

    let committed;
    try {
      committed = await commitBbtsVersion(
        {
          competencia,
          regraJson: regraJson as Record<string, unknown>,
          docRef,
          sourceFilename,
          sourceSha256,
          parserVersion,
          uploadedBy: socioId,
          notes: null,
        },
        supabase,
      );
    } catch (e) {
      if (e instanceof BbtsValidationError) {
        return NextResponse.json(
          { error: e.message, detalhe: e.detalhe ?? null, tipo: e.name },
          { status: 422 },
        );
      }
      throw e;
    }

    // Fecha o rascunho do staging (delegado). Mesma limitação conhecida da TRP:
    // é "logo após" o RPC, não na mesma transação; o WHERE status='pendente' +
    // o advisory lock por competência do RPC mitigam a janela.
    let avisoStaging: string | undefined;
    if (uploadId) {
      const { error: upErr } = await supabase
        .from("bbts_rule_uploads")
        .update({
          status: "confirmado",
          reviewed_by: socioId,
          reviewed_at: new Date().toISOString(),
          committed_version_id: committed.id,
        })
        .eq("id", uploadId)
        .eq("status", "pendente");
      if (upErr) {
        avisoStaging = `versão gravada, mas não consegui marcar o rascunho como confirmado: ${upErr.message}`;
      }
    }

    return NextResponse.json({
      id: committed.id,
      competencia: committed.competencia,
      version_no: committed.version_no,
      is_active: committed.is_active,
      valid_from: committed.valid_from,
      valid_until: committed.valid_until,
      ...(avisoStaging ? { avisoStaging } : {}),
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
