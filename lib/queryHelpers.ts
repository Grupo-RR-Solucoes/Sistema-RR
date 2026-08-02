const DEFAULT_PAGE_SIZE = 1000;

/**
 * Pagina automaticamente uma query do Supabase usando .range(),
 * carregando todas as linhas em memória. Use com cuidado em tabelas grandes.
 *
 * ============================================================================
 * ORDEM ESTÁVEL É OBRIGATÓRIA — E É RESPONSABILIDADE DAQUI, NÃO DO CHAMADOR
 * ============================================================================
 * `.range()` sem ORDER BY não tem ordem definida: o Postgres pode devolver a
 * mesma linha em duas páginas e nenhuma vez uma terceira. Isso REPETE e PULA
 * linhas silenciosamente — o total sai errado sem erro nenhum.
 *
 * Medido em 01/08/2026: dos 88 call sites deste helper, 57 não ordenavam. O
 * defeito já produziu número publicado e retratado (CASH lido como 1164 linhas
 * / R$ 313.000,01 quando o correto era 707 / R$ 187.848,62).
 *
 * POR QUE DESEMPATE E NÃO DETECÇÃO. Não dá para perguntar ao builder do
 * supabase-js se o chamador já ordenou sem depender de estrutura interna dele
 * (`builder.url.searchParams`), que é privada e muda de versão. Mas não
 * precisa: PostgREST ACUMULA cláusulas de ordem, então aplicar `.order()`
 * DEPOIS da factory vira ordem SECUNDÁRIA e preserva a primária do chamador.
 * Sem detecção, sem sobrescrita.
 *
 * E o desempate é justamente o que faltava em quem já ordenava por coluna
 * NÃO-ÚNICA. Caso medido: promoterAnalytics.ts:973 lê
 * daily_production_records ordenado por `movement_date` — 2.319 linhas para
 * apenas 64 datas distintas, até 53 empatadas na mesma chave, paginando em 3
 * páginas. Ali a ordem nunca foi total.
 *
 * `tiebreak` existe porque nem toda relação tem `id`: as tabelas curadas
 * `audit_v9_avista` (23.879 linhas) e `audit_v9_prt` (12.612) não têm, e as
 * duas paginam. Nelas o chamador passa `"contract_number"`, medido único nas
 * duas em 01/08/2026 — portanto ordem total.
 */
export async function fetchAllRows<T>(
  queryFactory: () => any,
  pageSize: number = DEFAULT_PAGE_SIZE,
  tiebreak: string = "id"
): Promise<T[]> {
  let from = 0;
  const allRows: T[] = [];

  while (true) {
    // O .order() vem DEPOIS da factory de propósito: é desempate, não
    // substituição. Ver o bloco acima.
    const { data, error } = await queryFactory()
      .order(tiebreak, { ascending: true })
      .range(from, from + pageSize - 1);

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
