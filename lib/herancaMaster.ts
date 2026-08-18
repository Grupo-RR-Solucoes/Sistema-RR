import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductionPeriodFromValue } from "./productionPeriod.ts";

// ============================================================
// HERANCA MASTER — fonte UNICA do "contrato de chave master herda o promotor
// do DIARIO".
//
// Extraido VERBATIM de lib/closingMonthly.ts (buildMasterHeirMap). Existia uma
// SEGUNDA copia literal em lib/bbtsOrchestrator.ts, inline dentro de
// consolidateMonthlyGroup — mesmo `prefix`, mesmo `startsWith`, mesma estrutura
// `best`/`upd`. Duas copias da mesma regra = consertar uma e deixar a outra
// sangrando. Agora ha UMA.
//
// DIVERGENCIA RESOLVIDA NA EXTRACAO: a copia do bbtsOrchestrator declarava
// `best` DENTRO do laco de chunks, entao o desempate por updated_at so valia
// dentro do chunk. Na pratica empatava porque `contracts` e um Set fatiado (uma
// chave cai em um unico chunk), mas a versao canonica e a do closingMonthly,
// com `best` FORA do laco. Nenhum valor muda; some a assimetria.
//
// A COMPETENCIA E A JANELA, NAO O MES DO CALENDARIO. A janela de producao vai do
// ultimo dia util do mes anterior ao penultimo do mes vigente — em jul/2026,
// 30/06 -> 30/07. Filtrar por `movement_date.startsWith("2026-07")` descarta as
// linhas de 30/06, que sao julho pela competencia: o contrato master fica orfao
// e a producao nao pousa no promotor. Medido em jul/2026: 26 linhas de 30/06,
// R$ 45.582,69 perdidos em 5 promotores (CAMILA GOMES 7.207,04; REBECA ARAUJO
// 7.100,00; CLEVITON ARAUJO 7.804,44; GLEICE KAMILA 2.471,21; JUSSARA DA SILVA
// 21.000,00). Quem decide competencia aqui e getProductionPeriodFromValue — a
// mesma regua que o resto do sistema usa. Gate: scripts/heranca_master_janela_gate.cjs
// ============================================================

type SupabaseLike = SupabaseClient;

/** Orfao do fechamento: contrato sem promotor individual, na empresa dele. */
export type OrfaoMaster = { contrato: string | null; companyId: string | null };

/**
 * A linha do diario pertence a competencia (year, month)? UNICO ponto onde essa
 * decisao e tomada na heranca. Extraido para ser testavel PURO pelo gate.
 */
export function pertenceACompetencia(
  movementDate: unknown,
  year: number,
  month: number
): boolean {
  const periodo = getProductionPeriodFromValue(movementDate);
  return !!periodo && periodo.year === year && periodo.month === month;
}

/**
 * Herança master: para cada contrato SEM promotor individual, busca no DIÁRIO a
 * linha cujo proposal_number == contract_number do fechamento, na MESMA empresa e
 * na competência do mês; usa o assigned_promoter_id (mais recente se houver mais
 * de uma). Devolve Map<`${companyId}|${contrato}`, promoterId>.
 */
export async function buildMasterHeirMap(
  supabase: SupabaseLike,
  orphans: OrfaoMaster[],
  year: number,
  month: number
): Promise<Map<string, string>> {
  const contracts = [
    ...new Set(orphans.map((c) => (c.contrato || "").trim()).filter(Boolean)),
  ];
  const heir = new Map<string, string>();
  if (contracts.length === 0) return heir;

  const best = new Map<string, { pid: string; updatedAt: string }>();
  for (let i = 0; i < contracts.length; i += 300) {
    const chunk = contracts.slice(i, i + 300);
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("proposal_number, company_id, assigned_promoter_id, movement_date, updated_at")
      .in("proposal_number", chunk);
    if (error) throw error;
    for (const d of data || []) {
      if (!d.assigned_promoter_id) continue;
      if (!pertenceACompetencia(d.movement_date, year, month)) continue; // competência do mês
      const key = `${d.company_id}|${String(d.proposal_number || "").trim()}`;
      const prev = best.get(key);
      const upd = String(d.updated_at || "");
      if (!prev || upd > prev.updatedAt) best.set(key, { pid: d.assigned_promoter_id, updatedAt: upd });
    }
  }
  for (const [key, v] of best) heir.set(key, v.pid);
  return heir;
}
