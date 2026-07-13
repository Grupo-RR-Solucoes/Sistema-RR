import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { PARSER_VERSION_BBTS, SHAPE_VERSION_BBTS, type RegraBbts } from "@/lib/bbts/regraBbts";
import { competenciaKey, vigenciaDaCompetencia } from "@/lib/trp/vigencia";

// Auditoria ADS/BBTS — 1A: GET /api/bbts/staging/[id] (socio-only).
//
// Devolve um rascunho pendente no MESMO shape que /api/bbts/parse (regraDraft +
// meta + confianca + diff), para o sócio revisar exatamente como no upload antes
// de confirmar. O diff é RECOMPUTADO contra a régua ativa anterior (só-leitura de
// bbts_rule_versions — nunca escreve).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await withSocioAdmin();
    const { id } = await params;

    const { data: row, error } = await supabase
      .from("bbts_rule_uploads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: "erro ao ler o rascunho", detalhe: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "rascunho não encontrado" }, { status: 404 });
    }

    const comp = competenciaKey(String(row.competencia));
    const vig = vigenciaDaCompetencia(comp);
    const regra = row.regra_draft as RegraBbts;

    const prev = await supabase
      .from("bbts_rule_versions")
      .select("competencia, version_no, regra_json")
      .lt("competencia", row.competencia)
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

    const celulasPorGrupo: Record<string, number> = {};
    let total = 0;
    for (const [k, g] of Object.entries(regra?.grupos ?? {})) {
      celulasPorGrupo[k] = g.celulas.length;
      total += g.celulas.length;
    }

    return NextResponse.json({
      uploadId: row.id,
      status: row.status,
      regraDraft: regra,
      meta: {
        competencia: comp,
        vigencia_pdf: regra?._meta?.vigencia_pdf ?? null,
        valid_from: vig.validFrom,
        valid_until: vig.validUntil,
        shape_version: row.shape_version ?? SHAPE_VERSION_BBTS,
        parser_version: row.parser_version ?? PARSER_VERSION_BBTS,
        source_filename: row.source_filename ?? null,
        sha256: row.source_sha256 ?? null,
        celulas_por_grupo: celulasPorGrupo,
        total_celulas: total,
        convenios_mapeados: Object.keys(regra?.convenios ?? {}).length,
      },
      confianca: row.confianca ?? { provado: [], conferir: [] },
      diff: { anterior },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
