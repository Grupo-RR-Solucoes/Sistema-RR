// ============================================================================
// companyScope — resolução do parâmetro companyId em um conjunto de company_ids.
// Compartilhado entre o analytics (/promotores) e o recálculo mensal
// (/api/calculate/monthly), p/ os dois entenderem os sentinelas de GRUPO e nunca
// mandarem "grupo:ads"/"grupo:rr" cru para um .eq(uuid) (22P02).
//
//   null            => sem restrição (consolidado)
//   "grupo:rr"      => company_ids com group_name = 'Grupo RR'
//   "grupo:ads"     => company_ids com group_name = 'BBTS'
//   <uuid>          => [uuid] (empresa individual)
// ============================================================================

export const COMPANY_SCOPE_GROUP_RR = "grupo:rr";
export const COMPANY_SCOPE_GROUP_ADS = "grupo:ads";

export type CompanyScopeRow = { id: string; group_name?: string | null };

export function resolveCompanyScope(
  companyIdParam: string,
  companies: CompanyScopeRow[]
): { companyIds: string[] | null } {
  if (!companyIdParam) return { companyIds: null };
  if (companyIdParam === COMPANY_SCOPE_GROUP_RR) {
    return { companyIds: companies.filter((c) => c.group_name === "Grupo RR").map((c) => c.id) };
  }
  if (companyIdParam === COMPANY_SCOPE_GROUP_ADS) {
    return { companyIds: companies.filter((c) => c.group_name === "BBTS").map((c) => c.id) };
  }
  return { companyIds: [companyIdParam] };
}
