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
//   4. (Fase 3, 01/09/2026) se veio validFromOverride: confere a data contra a
//      janela E confere no BANCO que a competência tem fatia ativa cobrindo o
//      início da janela — o ANTEPARO DO BURACO.
// Só então chama o RPC (service_role), que faz version_no+1 → desativa a ativa →
// insere a nova, atômico e serializado por competência (advisory lock).
//
// ============================================================================
// O ANTEPARO DO BURACO (item 4), e por que ele vive AQUI
// ============================================================================
// O RPC diz, no próprio cabeçalho, o que NÃO protege: ele não conhece a janela
// holiday-aware (ela é da aplicação, lib/trp/vigencia.ts), então não sabe dizer
// se um p_valid_from é o início do mês ou o meio dele. Consequência concreta:
// subir a PRIMEIRA régua de uma competência JÁ com override deixaria a fatia
// inicial do mês DESCOBERTA — de validFrom até override-1 não haveria régua
// nenhuma. O resolvedor então lança TrpVigenciaGapError no primeiro contrato
// daquele pedaço, e ele PROPAGA de propósito: /promotores, /recebiveis e o motor
// caem. É o único ponto desta frente capaz de derrubar produção.
//
// E o banco NÃO cobre isso. O ex_trp_vigencia_sem_overlap recusa fatias ativas
// que se CRUZAM; um buraco entre duas fatias não cruza nada — passa liso. O
// EXCLUDE pega sobreposição, nunca ausência.
//
// Por isso as 3 conferências abaixo rodam ANTES do RPC, e não depois:
//   (a) existe ao menos UMA fatia ativa na competência;
//   (b) alguma fatia ativa COBRE o início da janela (validFrom);
//   (c) a ÚLTIMA fatia ativa (a que o RPC vai truncar) satisfaz
//       valid_from < override <= valid_until.
// A (c) espelha a recusa que o RPC já faria, só que com mensagem que diz o que
// aconteceu. As (a) e (b) são as que o RPC não tem como fazer.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TrpValidationError, validarCompetencia } from "@/lib/trp/parseTrpDraft";
import { validateRegraDraft } from "@/lib/trp/validateRegraDraft";
import {
  competenciaFirstDay,
  competenciaKey,
  subtraiUmDia,
  validarOverrideNaJanela,
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
  /**
   * Início de vigência informado por FORA do PDF ("YYYY-MM-DD"), quando a fonte
   * externa (o e-mail da Promotiva) declara data que o documento não traz.
   *
   * AUSENTE (undefined/null) = caminho de sempre, BYTE-IDÊNTICO: p_valid_from
   * continua sendo a vigência derivada, o RPC cai na SAÍDA 1 (SUBSTITUI) e nada
   * neste módulo muda. Presente = a competência é PARTIDA: a fatia anterior é
   * truncada em override-1 e CONTINUA ATIVA.
   */
  validFromOverride?: string | null;
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

  // ---- override: a data que vem de fora do PDF (Fase 3) --------------------
  // `?? null` normaliza "" e undefined para null: string vazia vinda de um input
  // de data em branco NÃO pode ser tratada como override.
  const override = input.validFromOverride ? String(input.validFromOverride) : null;
  let validFromEfetivo = vig.validFrom;
  if (override) {
    const veredito = validarOverrideNaJanela(comp, override);
    if (!veredito.ok) {
      throw new TrpValidationError(veredito.motivo, veredito.detalhe);
    }
    await conferirFatiaAnteriorCobre(sb, comp, vig.validFrom, override);
    validFromEfetivo = override;
  }

  const { data, error } = await sb.rpc("trp_commit_version", {
    p_competencia: competenciaFirstDay(comp),
    p_regime: "VOLUME_5_FAIXAS",
    p_valid_from: validFromEfetivo,
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

/**
 * O ANTEPARO DO BURACO — conferência de ESTADO DO BANCO, só no caminho com
 * override. Lança TrpValidationError (a rota converte em 422, nada gravado).
 *
 * Não existe caminho "quase certo" aqui: qualquer uma das três recusas abaixo,
 * se passasse, produziria um intervalo de dias sem régua na competência viva.
 */
async function conferirFatiaAnteriorCobre(
  sb: SupabaseClient,
  comp: string,
  janelaValidFrom: string,
  override: string,
): Promise<void> {
  const { data, error } = await sb
    .from("trp_rule_versions")
    .select("id, version_no, valid_from, valid_until")
    .eq("competencia", competenciaFirstDay(comp))
    .eq("is_active", true)
    .order("valid_from", { ascending: false });
  if (error) {
    // Erro de INFRA na conferência do buraco NÃO vira "pode subir": propaga.
    throw new Error(
      `falha ao conferir a vigência atual de ${comp} antes de partir: ${error.message}`,
    );
  }

  const fatias = (data ?? []) as Array<{
    version_no: number;
    valid_from: string;
    valid_until: string;
  }>;

  // (a) nenhuma fatia ativa: é a PRIMEIRA régua da competência. Com override, o
  //     começo do mês ficaria a descoberto — e é exatamente o caso que o RPC não
  //     consegue ver (para ele é a SAÍDA 0, que insere sem perguntar).
  if (fatias.length === 0) {
    throw new TrpValidationError(
      "não dá para partir uma competência que ainda não tem régua",
      `${comp} não tem nenhuma versão ativa. Subir a PRIMEIRA régua já começando em ` +
        `${override} deixaria ${janelaValidFrom} a ${subtraiUmDia(override)} SEM régua — os ` +
        `contratos desse pedaço quebrariam /promotores e /recebiveis (TrpVigenciaGapError). ` +
        `Suba a régua da competência SEM data de início e só então parta o mês.`,
    );
  }

  // (b) o início da janela tem de estar coberto por ALGUMA fatia ativa.
  const cobreInicio = fatias.some(
    (f) => f.valid_from <= janelaValidFrom && f.valid_until >= janelaValidFrom,
  );
  if (!cobreInicio) {
    throw new TrpValidationError(
      "o início da competência ficaria sem régua",
      `nenhuma fatia ativa de ${comp} cobre ${janelaValidFrom} (o primeiro dia da janela). ` +
        `Fatias ativas hoje: ${fatias
          .map((f) => `v${f.version_no} ${f.valid_from}..${f.valid_until}`)
          .join(" | ")}.`,
    );
  }

  // (c) a ÚLTIMA fatia (a que o RPC vai truncar em override-1) tem de conter o
  //     override. Espelha a recusa do RPC, com mensagem que explica o que houve.
  //
  // O MÁXIMO É CALCULADO AQUI, não tomado de `fatias[0]`. O `.order()` da query
  // acima diz o que eu QUERO; se ele for removido, reescrito, ou se o PostgREST
  // devolver de outro jeito, `fatias[0]` vira uma fatia ARBITRÁRIA e a
  // conferência (c) passa a aprovar override que devia recusar. Numa competência
  // já partida isso é dinheiro: aprovar um override anterior à última fatia
  // reescreveria régua viva por baixo de outra. A ordenação é otimização de
  // tráfego; a decisão é do código. (Portão: o fixture do gate entrega as fatias
  // na ordem ERRADA de propósito.)
  const ultima = fatias.reduce((a, b) => (b.valid_from > a.valid_from ? b : a));
  if (override <= ultima.valid_from) {
    throw new TrpValidationError(
      "a data de início não é posterior à régua ativa mais recente",
      `${override} <= ${ultima.valid_from} (v${ultima.version_no}). Para reescrever uma fatia ` +
        `anterior, desative antes as posteriores — não adivinho o que fazer.`,
    );
  }
  // ESTA RIGIDEZ E DELIBERADA — decisao do Diego, 02/09/2026. NAO "conserte".
  //
  // Desde 02/09 a ULTIMA fatia ativa cobre, na LEITURA, ate o dia anterior ao
  // valid_from da competencia seguinte (lib/trp/vigenciaRegua.ts). Logo esta
  // conferencia e mais rigida do que precisaria: ela compara com o valid_until
  // GRAVADO, nao com o limite efetivo.
  //
  // EXEMPLO CONCRETO. Agosto/2026 v2 esta gravada ate 28/08 e cobre de fato ate
  // 30/08. Um override de 30/08 NAO deixaria buraco nenhum, e mesmo assim esta
  // conferencia o RECUSA, porque 30/08 > 28/08.
  //
  // Fica assim de proposito: recusar um split legitimo e o lado SEGURO do erro
  // (o socio ve a mensagem e decide), enquanto aceitar um que deixe buraco
  // derruba /promotores e /recebiveis em producao. Usar o limite efetivo aqui
  // aumentaria a superficie do conserto sem fechar buraco nenhum — a extensao
  // vive na CAUDA, e esta conferencia trata do MEIO da competencia.
  if (override > ultima.valid_until) {
    throw new TrpValidationError(
      "partir nesta data deixaria um BURACO",
      `a fatia ativa v${ultima.version_no} de ${comp} vai só até ${ultima.valid_until}, e o ` +
        `override é ${override}: os dias ${somaUmDiaLocal(ultima.valid_until)} a ` +
        `${subtraiUmDia(override)} ficariam sem régua. Não estico a régua anterior por conta própria.`,
    );
  }
}

/** Alias local para manter a mensagem legível sem mais um import no topo. */
function somaUmDiaLocal(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
