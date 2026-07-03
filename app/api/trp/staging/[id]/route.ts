import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { PARSER_VERSION } from "@/lib/trp/parseTrpDraft";
import { competenciaKey, vigenciaDaCompetencia } from "@/lib/trp/vigencia";

// F6b sub-fase 3 — GET /api/trp/staging/[id] (socio-only).
//
// Devolve um rascunho pendente no MESMO shape que /api/trp/parse (regraDraft +
// meta + confianca + diff), para o sócio revisar na tela exatamente como na
// F6b.2 antes de confirmar. O diff é RECOMPUTADO contra a TRP ativa anterior
// (só-leitura de trp_rule_versions — nunca escreve).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase } = await withSocioAdmin();
    const { id } = await params;

    const { data: row, error } = await supabase
      .from("trp_rule_uploads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: "erro ao ler o rascunho", detalhe: error.message },
        { status: 500 },
      );
    }
    if (!row) {
      return NextResponse.json({ error: "rascunho não encontrado" }, { status: 404 });
    }

    const comp = competenciaKey(String(row.competencia));
    const vig = vigenciaDaCompetencia(comp);

    // DIFF (só-leitura): versão ATIVA da competência anterior mais recente.
    const prev = await supabase
      .from("trp_rule_versions")
      .select("competencia, version_no, regra_json")
      .lt("competencia", row.competencia)
      .eq("is_active", true)
      .order("competencia", { ascending: false })
      .limit(1);
    if (prev.error) {
      return NextResponse.json(
        { error: "erro ao ler a TRP anterior para o diff", detalhe: prev.error.message },
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
      uploadId: row.id,
      status: row.status,
      regraDraft: row.regra_draft,
      meta: {
        competencia: comp,
        regime: row.regime,
        vigencia_inicio: vig.validFrom,
        vigencia_fim: vig.validUntil,
        source_filename: row.source_filename ?? null,
        sha256: row.source_sha256 ?? null,
        parser_version: row.parser_version ?? PARSER_VERSION,
        n_lines: 0,
      },
      confianca:
        row.confianca ?? { provado: { totalPct: 0, produtos: {} }, conferir: [] },
      diff: { anterior },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
