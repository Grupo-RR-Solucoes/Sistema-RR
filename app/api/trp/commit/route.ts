import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { commitTrpVersion } from "@/lib/trp/commitVersion";
import { TrpValidationError } from "@/lib/trp/parseTrpDraft";

// F6b sub-fase 3 — POST /api/trp/commit (SOCIO-ONLY, GRAVA a versão viva).
//
// Guard: withSocioAdmin = requireSocio (403 para não-sócio, checado NO SERVIDOR —
// não confia no client) + service_role. Único caminho do sistema que escreve em
// trp_rule_versions, e faz isso via o módulo commitTrpVersion (que chama o RPC
// atômico trp_commit_version). As rotas de staging NÃO chamam nada disto.
//
// Aceita:
//   { uploadId }            -> fluxo DELEGADO: lê o rascunho pendente do staging
//                             (fonte confiável no servidor), grava e marca confirmado.
//   { regraDraft, meta }    -> fluxo DIRETO do sócio (subiu+revisou na mesma sessão).
//
// Re-valida o draft e recomputa a vigência no servidor (dentro de commitTrpVersion).
// Draft inválido/adulterado -> 422, NADA gravado.
export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioAdmin();
    const socioId = user.session.appUser.id;

    const body = await req.json().catch(() => ({}));

    let regraJson: Record<string, unknown> | undefined;
    let competencia: string | undefined;
    let trpDocRef: string | null = null;
    let sourceFilename: string | null = null;
    let sourceSha256: string | null = null;
    let parserVersion: string | null = null;
    let uploadId: string | null = null;

    if (body?.uploadId) {
      // ---- fluxo delegado: draft vem do STAGING (não do client) ----
      uploadId = String(body.uploadId);
      const { data: draftRow, error } = await supabase
        .from("trp_rule_uploads")
        .select(
          "id, competencia, regra_draft, trp_doc_ref, source_filename, source_sha256, parser_version, status",
        )
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
      competencia = String(draftRow.competencia); // "YYYY-MM-01" (competenciaKey normaliza)
      trpDocRef = draftRow.trp_doc_ref ?? null;
      sourceFilename = draftRow.source_filename ?? null;
      sourceSha256 = draftRow.source_sha256 ?? null;
      parserVersion = draftRow.parser_version ?? null;
    } else {
      // ---- fluxo direto: draft vem do client (será re-validado no servidor) ----
      regraJson = body?.regraDraft;
      const meta = body?.meta ?? {};
      competencia = meta?.competencia;
      trpDocRef = meta?.trp_doc_ref ?? null;
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

    // ---- grava (re-valida + recomputa vigência dentro de commitTrpVersion) ----
    let committed;
    try {
      committed = await commitTrpVersion(
        {
          competencia,
          regraJson: regraJson as Record<string, unknown>,
          trpDocRef,
          sourceFilename,
          sourceSha256,
          parserVersion,
          uploadedBy: socioId,
          notes: null,
        },
        supabase,
      );
    } catch (e) {
      if (e instanceof TrpValidationError) {
        // draft corrompido/adulterado -> 422, nada gravado
        return NextResponse.json(
          { error: e.message, detalhe: e.detalhe ?? null, tipo: e.name },
          { status: 422 },
        );
      }
      throw e;
    }

    // ---- logo após: fecha o rascunho do staging (delegado) ----
    // A versão já está gravada; o WHERE status='pendente' evita fechar duas vezes.
    //
    // LIMITAÇÃO CONHECIDA (aceita — F6b.3): este UPDATE é "logo após" o RPC, NÃO na
    // mesma transação. A janela só se abre se DOIS commits do MESMO rascunho rodarem
    // em paralelo — cenário que não ocorre com sócio único, e que o WHERE
    // status='pendente' (aqui e no load) + o advisory lock por competência do RPC
    // já mitigam. Optamos por NÃO estender o RPC com p_upload_id (o RPC
    // trp_commit_version já foi validado em prod) por uma janela que não existe na
    // prática. Se falhar, retornamos avisoStaging e a versão permanece viva.
    let avisoStaging: string | undefined;
    if (uploadId) {
      const { error: upErr } = await supabase
        .from("trp_rule_uploads")
        .update({
          status: "confirmado",
          reviewed_by: socioId,
          reviewed_at: new Date().toISOString(),
          committed_version_id: committed.id,
        })
        .eq("id", uploadId)
        .eq("status", "pendente");
      if (upErr) {
        // não falha o commit (versão já viva); sinaliza a inconsistência do rascunho
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
      // recálculo/badge de fallback é F6b.4; as LEITURAS VIVAS já usam a nova ativa.
      recalculoPendente: true,
      ...(avisoStaging ? { avisoStaging } : {}),
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
