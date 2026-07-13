/**
 * lib/trp/trpSource.ts — flag da FONTE das regras de crédito da TRP.
 *
 * ESTADO ATUAL (produção): TRP_SOURCE=db. O flip foi feito na F4 (02/07/2026) e
 * o motor de crédito passou a ler do banco no PR #89 — a fonte viva é
 * trp_rule_versions (regra_json versionado por competência, alimentado pela tela
 * de upload de TRP). O JSON estático é FALLBACK/legado: cobre as competências
 * históricas (pré-abril/2026) e serve de rollback (env TRP_SOURCE=json +
 * redeploy) caso o caminho do banco precise ser desligado.
 *
 * TRP_SOURCE = "json" | "db".
 *   - "db":   lê trp_rule_versions (o que roda em prod hoje: à-vista e crédito).
 *   - "json": lê os JSON estáticos (getRegra/MAPA_MES_REGRA) — rollback/histórico.
 *
 * Default DEFENSIVO: qualquer valor ausente/desconhecido → "json". Só a string
 * exata "db" liga o caminho do banco (em prod a env está setada como "db").
 */

export type TrpSource = "json" | "db";

export function trpSource(): TrpSource {
  return (process.env.TRP_SOURCE || "").trim().toLowerCase() === "db" ? "db" : "json";
}

/** Conveniência: true só quando TRP_SOURCE=db. */
export function isTrpDbSource(): boolean {
  return trpSource() === "db";
}
