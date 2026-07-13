import { createHash } from "crypto";

import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAdmin } from "@/lib/auth/guards";
import { buildBbtsDraft } from "@/lib/bbts/buildBbtsDraft";
import { BbtsParseError, BbtsValidationError } from "@/lib/bbts/regraBbts";
import { competenciaFirstDay, competenciaKey } from "@/lib/trp/vigencia";

// Auditoria ADS/BBTS — 1A: POST /api/bbts/parse (READ-ONLY, NÃO grava).
//
// Recebe o PDF da tabela BBTS (base64), roda o parser no SERVIDOR e devolve a
// régua lida + _meta + confiança (provado / conferir) + a régua anterior (só-
// leitura) para o diff da tela. Guard: socio OU funcionario (ambos sobem/revisam).
// service_role é usado APENAS para LER bbts_rule_versions (RLS default-deny).
//
// Falha do parser/gate -> 422 com erro VISÍVEL e estruturado: nunca meia-régua.
//
// A competência é OPCIONAL: sem ela, o parser deduz da vigência declarada no PDF
// ("Vigência a partir de 30/06/2026" -> competência 2026-07 pela janela RR).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAdmin();

    const { file, fileName, competencia } = await req.json();
    if (!file || typeof file !== "string") {
      return NextResponse.json({ error: "Arquivo não enviado (envie o PDF em base64)" }, { status: 400 });
    }

    const pdfBuffer = Buffer.from(file, "base64");
    const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
    const pdfBytes = new Uint8Array(pdfBuffer);

    let draft;
    try {
      draft = await buildBbtsDraft(pdfBytes, {
        competencia: typeof competencia === "string" && competencia ? competencia : undefined,
        sourceFilename: typeof fileName === "string" ? fileName : null,
        sha256,
      });
    } catch (e) {
      if (e instanceof BbtsParseError || e instanceof BbtsValidationError) {
        return NextResponse.json(
          { error: e.message, detalhe: e.detalhe ?? null, tipo: e.name },
          { status: 422 },
        );
      }
      throw e;
    }

    // DIFF (só-leitura): versão ATIVA da competência anterior mais recente.
    const firstDayAlvo = competenciaFirstDay(competenciaKey(draft.meta.competencia));
    const prev = await supabase
      .from("bbts_rule_versions")
      .select("competencia, version_no, regra_json")
      .lt("competencia", firstDayAlvo)
      .eq("is_active", true)
      .order("competencia", { ascending: false })
      .limit(1);
    if (prev.error) {
      return NextResponse.json(
        { error: "erro ao ler a régua BBTS anterior para o diff", detalhe: prev.error.message },
        { status: 500 },
      );
    }
    const anterior =
      prev.data && prev.data[0]
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
