// Fonte da regra de CREDITO do motor atras da flag TRP_SOURCE (self-service).
//
// Espelha EXATAMENTE o padrao da a-vista F4 (lib/recebiveis/avistaProducao.ts:184-198):
// pre-carga async 1x das competencias -> lookup SINCRONO por contrato. O motor
// (calcularOperacao/getCreditPercent) continua sincrono; a unica parte async e o
// preload, feito UMA vez aqui, fora do loop de calculo.
//
//   TRP_SOURCE=db  -> provider le trp_rule_versions (createTrpRegraDbPreloader).
//   TRP_SOURCE=json (default) -> retorna undefined; o motor le so o JSON embutido
//                                (getRegra/MAPA_MES_REGRA) = comportamento historico.
//
// FONTE por competencia: o provider (db) devolve regra para 2026-04+ (o que existe
// versionado) e null para pre-abril; no motor, o `?? getRegra(mes)` cai no JSON no
// historico -> jan-mar/2026 e anteriores ficam byte-identicos. abr/mai/jun no db sao
// deep-equal ao JSON (gates F2/F3) -> no-op. So 2026-07+ (ja no db, TRP38) muda.

import type { SupabaseClient } from "@supabase/supabase-js";

import { competenciaDaDataContrato } from "@/lib/motor";
import type { TrpRegraProvider } from "@/lib/motor";
import type { RegraMes } from "@/lib/regrasData";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createTrpRegraDbPreloader } from "@/lib/trp/resolveTrpRegraDb";
import { isTrpDbSource } from "@/lib/trp/trpSource";

/**
 * Constroi o provider SINCRONO de RegraMes (DB) para injetar em calcularOperacao.
 *
 * @param contractDates datas de contrato (YYYY-MM-DD) dos registros que vao passar
 *   pelo motor. As competencias sao derivadas com competenciaDaDataContrato — a
 *   MESMA chave que o motor consulta no provider (sem miss no getRegraSync).
 * @param client SupabaseClient service_role (default: getSupabaseAdmin). Obrigatorio
 *   service_role: trp_rule_versions e RLS default-deny (F1); o client anon e negado.
 * @returns TrpRegraProvider quando TRP_SOURCE=db; undefined quando json (o motor
 *   entao le so o JSON — 100% retrocompativel).
 */
export async function buildTrpCreditProvider(
  contractDates: Iterable<string | null | undefined>,
  client?: SupabaseClient,
): Promise<TrpRegraProvider | undefined> {
  if (!isTrpDbSource()) return undefined;

  const comps = new Set<string>();
  for (const cd of contractDates) {
    const comp = competenciaDaDataContrato(cd);
    if (comp) comps.add(comp);
  }

  const preloader = createTrpRegraDbPreloader(
    client ?? (getSupabaseAdmin() as unknown as SupabaseClient),
  );
  await preloader.preload([...comps]);

  return (competencia: string): RegraMes | null => preloader.getRegraSync(competencia);
}
