/**
 * lib/trp/trpSource.ts — flag da FONTE das regras de crédito da TRP.
 *
 * Fase 2 (TRP self-service): existe o resolvedor DB (resolveTrpRegraDb), mas o
 * motor CONTINUA lendo os JSON estáticos. Esta flag existe para que a Fase 3
 * (gate de paridade) e a Fase 4 (flip) escolham a fonte SEM tocar o motor.
 *
 * TRP_SOURCE = "json" (default) | "db".
 *   - "json": comportamento atual, 100% inalterado (getRegra/MAPA_MES_REGRA).
 *   - "db":   lê de trp_rule_versions (só exercitado pelo script de paridade F3).
 *
 * Default DEFENSIVO: qualquer valor ausente/desconhecido → "json". Só a string
 * exata "db" liga o caminho do banco.
 */

export type TrpSource = "json" | "db";

export function trpSource(): TrpSource {
  return (process.env.TRP_SOURCE || "").trim().toLowerCase() === "db" ? "db" : "json";
}

/** Conveniência: true só quando TRP_SOURCE=db. */
export function isTrpDbSource(): boolean {
  return trpSource() === "db";
}
