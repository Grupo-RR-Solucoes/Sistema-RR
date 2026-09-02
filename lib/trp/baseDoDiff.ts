// ============================================================================
// lib/trp/baseDoDiff.ts — QUAL régua a tela compara quando o sócio revisa um PDF.
//
// Item 1 da frente de dívidas (02/09/2026). O defeito que ele conserta:
// `app/api/trp/parse/route.ts` e `app/api/trp/staging/[id]/route.ts` buscavam a
// base do diff com `.lt("competencia", alvo)` — a competência ESTRITAMENTE
// ANTERIOR. Enquanto uma competência tinha UMA régua e o upload SUBSTITUÍA, "a
// anterior" era a única base possível e o rótulo era verdadeiro. Com vigência
// partida isso deixa de valer no instante em que a competência JÁ TEM régua —
// que aconteceu pela primeira vez na história em 01/09/2026, no passo 2 da
// subida da TRP39.
//
// POR QUE PASSOU DESPERCEBIDO, e é o detalhe que importa para quem for mexer:
// naquele dia as duas bases eram A MESMA RÉGUA (2026-07 v2 e 2026-08 v1 são as
// duas a TRP38 — medido: 11 produtos, 0 diferenças), então o destaque amarelo
// saiu idêntico ao que a base certa produziria. O erro era só de RÓTULO. Numa
// v3 corrigindo a TRP39 ele deixaria de ser: a base certa seria a 2026-08 v2, e
// a tela mostraria a TRP38 de julho, pintando de amarelo tudo o que a TRP39 já
// havia mudado — como se fosse novidade da correção.
//
// A REGRA:
//   1. a última fatia ATIVA da PRÓPRIA competência (a de maior valid_from — a
//      mesma contra quem o RPC decide substituir/partir);
//   2. se a competência ainda não tem régua, a última fatia ATIVA da competência
//      anterior mais recente — o comportamento de sempre, que é o certo no
//      PRIMEIRO upload de todo mês.
//
// O fallback NÃO é decoração: sem ele o diff sumiria justamente na subida
// inicial de cada competência, que é quando o sócio mais precisa comparar.
//
// SÓ-LEITURA. Nunca escreve; erro de infra PROPAGA (o chamador devolve 500) em
// vez de virar "não há base", que seria um diff vazio mentindo que nada mudou.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { competenciaFirstDay, competenciaKey } from "@/lib/trp/vigencia";

export interface BaseDoDiff {
  /** Competência da régua usada como base ("YYYY-MM"). */
  competencia: string;
  version_no: number;
  /** Vigência PRÓPRIA da fatia — é o que o rótulo da tela mostra. */
  valid_from: string;
  valid_until: string;
  regra_json: unknown;
  /**
   * `propria` = a competência já tinha régua (re-upload ou partição);
   * `anterior` = primeiro upload da competência, base herdada do mês anterior.
   * A tela usa isto para dizer a verdade sobre o que está comparando.
   */
  origem: "propria" | "anterior";
}

const COLS = "competencia, version_no, valid_from, valid_until, regra_json";

/**
 * Resolve a base do diff. Lança em erro de infra (RLS, conexão, query),
 * devolve null quando não há NENHUMA régua ativa em lugar nenhum.
 */
export async function resolverBaseDoDiff(
  sb: SupabaseClient,
  competencia: string,
): Promise<BaseDoDiff | null> {
  const comp = competenciaKey(competencia);
  const firstDay = competenciaFirstDay(comp);

  // 1) A PRÓPRIA competência. `order(valid_from desc).limit(1)` = a última fatia,
  //    que é contra quem o commit decide — e portanto a única base honesta para
  //    "o que muda se eu subir este PDF agora".
  const propria = await sb
    .from("trp_rule_versions")
    .select(COLS)
    .eq("competencia", firstDay)
    .eq("is_active", true)
    .order("valid_from", { ascending: false })
    .limit(1);
  if (propria.error) {
    throw new Error(`erro ao ler a régua atual de ${comp}: ${propria.error.message}`);
  }
  const daPropria = propria.data && propria.data[0];
  if (daPropria) return montar(daPropria, "propria");

  // 2) FALLBACK — a anterior mais recente (o comportamento de sempre). O
  //    tie-break por valid_from importa: com a competência ANTERIOR partida, o
  //    .limit(1) sem ele pegaria uma fatia arbitrária.
  const anterior = await sb
    .from("trp_rule_versions")
    .select(COLS)
    .lt("competencia", firstDay)
    .eq("is_active", true)
    .order("competencia", { ascending: false })
    .order("valid_from", { ascending: false })
    .limit(1);
  if (anterior.error) {
    throw new Error(`erro ao ler a TRP anterior a ${comp}: ${anterior.error.message}`);
  }
  const daAnterior = anterior.data && anterior.data[0];
  return daAnterior ? montar(daAnterior, "anterior") : null;
}

function montar(row: Record<string, unknown>, origem: "propria" | "anterior"): BaseDoDiff {
  return {
    competencia: competenciaKey(String(row.competencia)),
    version_no: Number(row.version_no),
    valid_from: String(row.valid_from).slice(0, 10),
    valid_until: String(row.valid_until).slice(0, 10),
    regra_json: row.regra_json,
    origem,
  };
}
