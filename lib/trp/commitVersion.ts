// ============================================================================
// F6b sub-fase 3 — commitTrpVersion: o ÚNICO ponto do código que ESCREVE em
// trp_rule_versions (via o RPC atômico trp_commit_version).
//
// INVARIANTE (auditável): nenhum outro módulo/rota chama trp_commit_version nem
// emite insert/update/delete em trp_rule_versions. Este arquivo é chamado APENAS
// por app/api/trp/commit/route.ts, que roda atrás de requireSocio (socio-only).
// As rotas de staging escrevem só em trp_rule_uploads e nunca importam isto.
//
// Antes de gravar, aqui (defesa em profundidade):
//   1. normaliza + valida a competência (validarCompetencia da F6b.1);
//   2. re-valida o draft (validateRegraDraft — 11 produtos, pct em (0,0.15], etc.);
//   3. RECOMPUTA a vigência no servidor (vigenciaDaCompetencia) — ignora a do client.
// Só então chama o RPC (service_role), que faz version_no+1 → desativa a ativa →
// insere a nova, atômico e serializado por competência (advisory lock).
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { validarCompetencia } from "@/lib/trp/parseTrpDraft";
import { validateRegraDraft } from "@/lib/trp/validateRegraDraft";
import {
  competenciaFirstDay,
  competenciaKey,
  vigenciaDaCompetencia,
} from "@/lib/trp/vigencia";

export interface CommitVersionInput {
  /** "YYYY-MM" ou "YYYY-MM-DD" — normalizada e validada no servidor. */
  competencia: string;
  /** RegraMes DRAFT revisado (vira regra_json). Re-validado aqui. */
  regraJson: Record<string, unknown>;
  trpDocRef?: string | null;
  sourceFilename?: string | null;
  sourceSha256?: string | null;
  parserVersion?: string | null;
  /** app_users.id do SÓCIO que confirmou (responsável pela regra viva). */
  uploadedBy: string;
  notes?: string | null;
}

/** Linha gravada (subset de trp_rule_versions retornado pelo RPC). */
export interface CommittedVersion {
  id: string;
  competencia: string; // "YYYY-MM-DD"
  regime: string;
  valid_from: string;
  valid_until: string;
  version_no: number;
  is_active: boolean;
  uploaded_at: string;
}

/**
 * Grava uma nova versão ativa da TRP. Lança TrpValidationError se o draft for
 * inválido (a rota converte em 422 — nada gravado) e Error em falha de infra/RPC.
 *
 * @param client service_role (default: getSupabaseAdmin). A rota passa o dela.
 */
export async function commitTrpVersion(
  input: CommitVersionInput,
  client?: SupabaseClient,
): Promise<CommittedVersion> {
  const comp = competenciaKey(input.competencia); // normaliza YYYY-MM (lança em formato inválido)
  validarCompetencia(comp);                       // faixa/mês (F6b.1) — lança TrpValidationError
  validateRegraDraft(input.regraJson, comp);      // re-valida o draft — lança TrpValidationError
  const vig = vigenciaDaCompetencia(comp);        // RECOMPUTA no servidor (ignora vigência do client)

  const sb = client ?? (getSupabaseAdmin() as unknown as SupabaseClient);

  const { data, error } = await sb.rpc("trp_commit_version", {
    p_competencia: competenciaFirstDay(comp),
    p_regime: "VOLUME_5_FAIXAS",
    p_valid_from: vig.validFrom,
    p_valid_until: vig.validUntil,
    p_regra_json: input.regraJson,
    p_trp_doc_ref: input.trpDocRef ?? null,
    p_source_filename: input.sourceFilename ?? null,
    p_source_sha256: input.sourceSha256 ?? null,
    p_parser_version: input.parserVersion ?? null,
    p_uploaded_by: input.uploadedBy,
    p_notes: input.notes ?? null,
  });

  if (error) {
    throw new Error(`falha ao gravar versão da TRP (trp_commit_version): ${error.message}`);
  }
  // A função retorna UMA linha (returns trp_rule_versions) — PostgREST manda objeto;
  // aceitamos array defensivamente.
  const row = (Array.isArray(data) ? data[0] : data) as CommittedVersion | undefined;
  if (!row || !row.id) {
    throw new Error("trp_commit_version não retornou a versão gravada");
  }
  return row;
}
