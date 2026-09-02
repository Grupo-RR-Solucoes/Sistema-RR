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

    // FATIAS ATIVAS DA PRÓPRIA COMPETÊNCIA (item 2, 02/09/2026). A tela precisa
    // saber se já EXISTE régua aqui para decidir se avisa que confirmar este
    // rascunho vai SUBSTITUIR em vez de PARTIR. Só-leitura, e é estado do banco
    // — o client não tem como saber sozinho.
    const ativas = await supabase
      .from("trp_rule_versions")
      .select("version_no, valid_from, valid_until")
      .eq("competencia", row.competencia)
      .eq("is_active", true)
      .order("valid_from", { ascending: true });
    if (ativas.error) {
      return NextResponse.json(
        { error: "erro ao ler a vigência atual da competência", detalhe: ativas.error.message },
        { status: 500 },
      );
    }

    // DIFF (só-leitura): versão ATIVA da competência anterior mais recente.
    const prev = await supabase
      .from("trp_rule_versions")
      .select("competencia, version_no, regra_json")
      .lt("competencia", row.competencia)
      .eq("is_active", true)
      // TIE-BREAK por valid_from (vigencia intra-mes): com a competencia anterior
      // PARTIDA em 2+ reguas ativas, .limit(1) sem este desempate pegaria uma
      // fatia ARBITRARIA. A que vale para o diff e a ULTIMA do mes anterior.
      .order("competencia", { ascending: false })
      .order("valid_from", { ascending: false })
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
      // Fase 3: o início de vigência informado por FORA do PDF, se houver. A tela
      // do sócio mostra em destaque — é o único campo da revisão que não veio do
      // documento, e é ele que PARTE a competência.
      validFromOverride: row.valid_from_override ?? null,
      // Fatias ATIVAS desta competência (vazio = mês ainda sem régua).
      fatiasAtivas: ativas.data ?? [],
      diff: { anterior },
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
