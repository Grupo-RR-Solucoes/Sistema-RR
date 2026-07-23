// FRENTE DE PRODUTO — VENDA PROPRIA DE GESTAO: quem e o DONO de uma linha de produto.
//
// Ate aqui o dono era sempre um promotor (product_line_assignments.promoter_id). Com a
// venda propria, um PAPEL DE GESTAO (gestor_consorcio/supervisor/gerente_regional com
// app_users.venda_propria = true) tambem pode ser dono — e ele NAO e promotor.
//
// A regua NAO muda: o repasse do beneficiario de gestao e o MESMO do promotor
// (BBCAP/Conta Corrente x 0,5833; consorcio x 0,40). O que muda e SO o destino do
// valor: promotor -> promoter_monthly_results; gestao -> gestao_venda_propria.
//
// Este modulo e PURO (sem IO) e e a fonte unica do vocabulario "beneficiario", para
// que fila, calculo, rota e tela nao inventem cada um o seu formato.

export type BeneficiarioKind = "promotor" | "gestao";

export type Beneficiario = { kind: BeneficiarioKind; id: string };

/** Papeis de gestao que podem ter venda propria (espelha o CHECK da migration). */
export const PAPEIS_COM_VENDA_PROPRIA = [
  "gestor_consorcio",
  "supervisor",
  "gerente_regional",
] as const;

/** Chave de agregacao/transporte: "promotor:<uuid>" | "gestao:<uuid>". */
export function beneficiarioValue(b: Beneficiario): string {
  return `${b.kind}:${b.id}`;
}

/**
 * Le o valor composto vindo da tela (o <option value> do dropdown).
 * "" / null / lixo -> null (= desatribuir, volta para o balde).
 * Aceita tambem um uuid cru como promotor, para nao quebrar chamadas antigas da rota.
 */
export function parseBeneficiarioValue(raw: unknown): Beneficiario | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const sep = s.indexOf(":");
  if (sep < 0) return { kind: "promotor", id: s }; // compatibilidade: uuid cru
  const kind = s.slice(0, sep);
  const id = s.slice(sep + 1).trim();
  if (!id) return null;
  if (kind === "promotor" || kind === "gestao") return { kind, id };
  return null;
}

/** Dono de uma linha da fila. null = PENDING (balde). */
export function beneficiarioDaLinha(row: {
  promoter_id?: string | null;
  assigned_app_user_id?: string | null;
}): Beneficiario | null {
  if (row.assigned_app_user_id) return { kind: "gestao", id: row.assigned_app_user_id };
  if (row.promoter_id) return { kind: "promotor", id: row.promoter_id };
  return null;
}

/**
 * Colunas de dono para gravar na fila. Sempre escreve as DUAS (uma delas null) — assim
 * reatribuir de promotor para gestao (ou o inverso) nao deixa o dono antigo para tras,
 * o que violaria o CHECK product_line_assignments_um_dono_check.
 */
export function colunasDeDono(b: Beneficiario | null): {
  promoter_id: string | null;
  assigned_app_user_id: string | null;
} {
  return {
    promoter_id: b?.kind === "promotor" ? b.id : null,
    assigned_app_user_id: b?.kind === "gestao" ? b.id : null,
  };
}
