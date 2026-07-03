import { createHash } from "crypto";

import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAdmin } from "@/lib/auth/guards";
import {
  buildTrpDraft,
  TrpParseError,
  TrpValidationError,
} from "@/lib/trp/parseTrpDraft";
import { competenciaKey, competenciaFirstDay } from "@/lib/trp/vigencia";

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

    // DIFF (só-leitura): versão ATIVA da competência anterior mais recente.
    const firstDayAlvo = competenciaFirstDay(competenciaKey(competencia));
    const prev = await supabase
      .from("trp_rule_versions")
      .select("competencia, version_no, regra_json")
      .lt("competencia", firstDayAlvo)
      .eq("is_active", true)
      .order("competencia", { ascending: false })
      .limit(1);
    if (prev.error) {
      // erro de infra na leitura do anterior -> falha visível (não mascara)
      return NextResponse.json(
        { error: "erro ao ler a TRP anterior para o diff", detalhe: prev.error.message },
        { status: 500 },
      );
    }
    const anterior = prev.data && prev.data[0]
      ? {
          competencia: competenciaKey(String((prev.data[0] as { competencia: string }).competencia)),
          version_no: (prev.data[0] as { version_no: number }).version_no,
          regra_json: (prev.data[0] as { regra_json: unknown }).regra_json,
        }
      : null;

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
