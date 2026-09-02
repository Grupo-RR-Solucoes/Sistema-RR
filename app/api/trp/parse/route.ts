import { createHash } from "crypto";

import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAdmin } from "@/lib/auth/guards";
import {
  buildTrpDraft,
  TrpParseError,
  TrpValidationError,
} from "@/lib/trp/parseTrpDraft";
import { resolverBaseDoDiff } from "@/lib/trp/baseDoDiff";
import { competenciaKey } from "@/lib/trp/vigencia";

// F6b sub-fase 1 — POST /api/trp/parse (READ-ONLY, NÃO grava).
//
// Recebe o PDF da TRP (base64), roda parseTrpPdf no SERVIDOR e devolve o draft +
// _meta + confiança (provado/conferir) + a TRP anterior (só-leitura) para o diff
// da tela. Guard: socio OU funcionario (ambos sobem/revisam). service_role é usado
// APENAS para LER trp_rule_versions (RLS default-deny) — esta rota NÃO escreve.
//
// Falha do parser/validação -> 422 com erro VISÍVEL e estruturado (nada de
// meia-regra; princípio TrpInfraError).
export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();

    const { file, fileName, competencia } = await req.json();
    if (!file || typeof file !== "string") {
      return NextResponse.json({ error: "Arquivo não enviado (envie o PDF em base64)" }, { status: 400 });
    }
    if (!competencia || typeof competencia !== "string") {
      return NextResponse.json({ error: "Competência não informada (YYYY-MM)" }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(file, "base64");
    const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const pdfBytes = new Uint8Array(pdfBuffer);

    let draft;
    try {
      draft = await buildTrpDraft(pdfBytes, {
        competencia,
        sourceFilename: typeof fileName === "string" ? fileName : null,
        sha256,
      });
    } catch (e) {
      if (e instanceof TrpParseError || e instanceof TrpValidationError) {
        // erro VISÍVEL e estruturado — não retorna draft pela metade
        return NextResponse.json(
          { error: e.message, detalhe: e.detalhe ?? null, tipo: e.name },
          { status: 422 },
        );
      }
      throw e;
    }

    // DIFF (só-leitura): a base sai da RÉGUA ÚNICA lib/trp/baseDoDiff.ts — a
    // última fatia ATIVA da PRÓPRIA competência, com fallback para a anterior
    // quando o mês ainda não tem régua. Ver o cabeçalho de lá: o `.lt` daqui
    // mentia o rótulo assim que a competência passava a ter régua, e isso virou
    // possível em 01/09/2026.
    let anterior = null;
    try {
      anterior = await resolverBaseDoDiff(supabase, competenciaKey(competencia));
    } catch (e) {
      // erro de infra na leitura da base -> falha visível (não mascara)
      return NextResponse.json(
        {
          error: "erro ao ler a TRP anterior para o diff",
          detalhe: e instanceof Error ? e.message : String(e),
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      regraDraft: draft.regraDraft,
      meta: draft.meta,
      confianca: draft.confianca,
      diff: { anterior },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
