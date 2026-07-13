// ============================================================================
// Auditoria ADS/BBTS — 1A: commitBbtsVersion — o ÚNICO ponto do código que ESCREVE
// em bbts_rule_versions (via o RPC atômico bbts_commit_version).
//
// INVARIANTE (auditável): nenhum outro módulo/rota chama bbts_commit_version nem
// emite insert/update/delete em bbts_rule_versions. Este arquivo é chamado APENAS
// por app/api/bbts/commit/route.ts, que roda atrás de requireSocio (socio-only).
// As rotas de staging escrevem só em bbts_rule_uploads e nunca importam isto.
//
// Antes de gravar (defesa em profundidade — não confia no client):
//   1. normaliza + valida a competência;
//   2. re-valida a régua inteira (validarRegraBbts — gate de sanidade);
//   3. RECOMPUTA a vigência no servidor (vigenciaDaCompetencia, lib/trp/vigencia)
//      — a mesma janela holiday-aware do resto do sistema, ignorando a do client.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validarCompetenciaBbts } from "@/lib/bbts/buildBbtsDraft";
import { SHAPE_VERSION_BBTS } from "@/lib/bbts/regraBbts";
import { validarRegraBbts } from "@/lib/bbts/validateRegraBbts";
import { competenciaFirstDay, competenciaKey, vigenciaDaCompetencia } from "@/lib/trp/vigencia";

export interface CommitBbtsInput {
  /** "YYYY-MM" ou "YYYY-MM-DD" — normalizada e validada no servidor. */
  competencia: string;
  /** RegraBbts revisada (vira regra_json). Re-validada aqui. */
  regraJson: Record<string, unknown>;
  docRef?: string | null;
  sourceFilename?: string | null;
  sourceSha256?: string | null;
  parserVersion?: string | null;
  /** app_users.id do SÓCIO que confirmou (responsável pela régua viva). */
  uploadedBy: string;
  notes?: string | null;
}

/** Linha gravada (subset de bbts_rule_versions retornado pelo RPC). */
export interface CommittedBbtsVersion {
  id: string;
  competencia: string; // "YYYY-MM-DD"
  shape_version: string;
  valid_from: string;
  valid_until: string;
  version_no: number;
  is_active: boolean;
  uploaded_at: string;
}

/**
 * Grava uma nova versão ativa da régua BBTS. Lança BbtsValidationError se a régua
 * for inválida (a rota converte em 422 — nada gravado) e Error em falha de infra.
 */
export async function commitBbtsVersion(
  input: CommitBbtsInput,
  client?: SupabaseClient,
): Promise<CommittedBbtsVersion> {
  const comp = competenciaKey(input.competencia);
  validarCompetenciaBbts(comp);
  validarRegraBbts(input.regraJson, comp);
  const vig = vigenciaDaCompetencia(comp); // RECOMPUTA no servidor

  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);

  const { data, error } = await sb.rpc("bbts_commit_version", {
    p_competencia: competenciaFirstDay(comp),
    p_shape_version: SHAPE_VERSION_BBTS,
    p_valid_from: vig.validFrom,
    p_valid_until: vig.validUntil,
    p_regra_json: input.regraJson,
    p_doc_ref: input.docRef ?? null,
    p_source_filename: input.sourceFilename ?? null,
    p_source_sha256: input.sourceSha256 ?? null,
    p_parser_version: input.parserVersion ?? null,
    p_uploaded_by: input.uploadedBy,
    p_notes: input.notes ?? null,
  });

  if (error) {
    throw new Error(`falha ao gravar versao da regua BBTS (bbts_commit_version): ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as CommittedBbtsVersion | undefined;
  if (!row || !row.id) {
    throw new Error("bbts_commit_version nao retornou a versao gravada");
  }
  return row;
}
