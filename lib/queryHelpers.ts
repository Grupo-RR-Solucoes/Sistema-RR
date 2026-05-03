const DEFAULT_PAGE_SIZE = 1000;

/**
 * Pagina automaticamente uma query do Supabase usando .range(),
 * carregando todas as linhas em memória. Use com cuidado em tabelas grandes.
 */
export async function fetchAllRows<T>(
  queryFactory: () => any,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  let from = 0;
  const allRows: T[] = [];

  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data || []) as T[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}
