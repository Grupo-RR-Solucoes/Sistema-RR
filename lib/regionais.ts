// ============================================================================
// REGIONAIS — REGUA DE NEGOCIO, NAO GEOGRAFIA.
//
// Sergipe e Bahia entram em ALAGOAS porque tem POUCOS PROMOTORES, nao porque
// sejam vizinhos. Medido em 02/08/2026 sobre os promotores ativos nao-master:
//
//     AL 35  +  SE 1  +  BA 3   =  ALAGOAS      39
//     PE 10                     =  PERNAMBUCO   10
//                                  total        49
//
// Um ranking com 1 promotor (SE) ou 3 (BA) nao e ranking: a posicao vira
// constrangimento publico e a comparacao nao informa nada. Agrupar da tamanho
// de amostra as duas regionais.
//
// QUANDO SE OU BA CRESCEREM, muda UMA LINHA aqui — tirar o estado da lista de
// ALAGOAS e criar a chave nova. Nenhum `if (estado === "SE")` deve existir em
// tela, rota ou gate: esta e a UNICA fonte. Se voce for escrever a regra em
// outro arquivo, pare e importe daqui.
// ============================================================================

import type { Estado } from "@/lib/projecaoMetas";

export type Regional = "ALAGOAS" | "PERNAMBUCO";

/** Estados de cada regional. A ordem nao importa; a cobertura sim. */
export const REGIONAIS: Record<Regional, readonly Estado[]> = {
  ALAGOAS: ["AL", "SE", "BA"],
  PERNAMBUCO: ["PE"],
} as const;

/** Rotulo para a tela. Nao derivar da chave: "PERNAMBUCO" nao se exibe assim. */
export const REGIONAL_LABEL: Record<Regional, string> = {
  ALAGOAS: "Alagoas",
  PERNAMBUCO: "Pernambuco",
};

const POR_ESTADO: ReadonlyMap<string, Regional> = new Map(
  (Object.entries(REGIONAIS) as Array<[Regional, readonly Estado[]]>).flatMap(([reg, estados]) =>
    estados.map((e) => [e, reg] as [string, Regional]),
  ),
);

/**
 * Regional de um estado. `null` quando o estado e desconhecido ou ausente —
 * NAO se chuta uma regional: promotor sem estado fica fora do ranking, o que e
 * honesto, em vez de entrar num grupo que nao e o dele.
 */
export function regionalDoEstado(estado: string | null | undefined): Regional | null {
  if (!estado) return null;
  return POR_ESTADO.get(String(estado).trim().toUpperCase()) ?? null;
}

export type PosicaoRanking = {
  regional: Regional;
  /** Quantos promotores a regional tem. O "de 39". */
  total: number;
  /**
   * Posicao 1-based por producao acumulada. `null` quando o promotor ainda
   * NAO produziu nesta competencia — ver a justificativa em rankingDaRegional.
   */
  posicao: number | null;
};

/**
 * Posicao do promotor no ranking da REGIONAL dele. SO a posicao e o total.
 *
 * NAO devolve — e nao deve passar a devolver — nome, valor, quem esta acima,
 * quem esta abaixo, nem distancia para a proxima posicao. "Faltam R$ X para o
 * 11o" e o valor do vizinho por subtracao, e vazaria o dado de outra pessoa
 * pela porta dos fundos. Esta funcao existe para ser o unico caminho.
 *
 * CRITERIO (C.4): producao acumulada da competencia, maior primeiro.
 * DESEMPATE: promoter_id crescente. E arbitrario de proposito — qualquer
 * criterio "melhor" (meta, penetracao, seguro) seria inventar uma regra de
 * negocio que ninguem pediu, e ordenar por nome exporia ordem alfabetica como
 * se fosse merito. O que importa no desempate e ser ESTAVEL: posicao que
 * oscila entre dois refreshes com o mesmo dado parece defeito.
 *
 * SEM PRODUCAO (C.5): `posicao` volta null em vez de ultima colocacao. No
 * comeco do mes a maioria da regional esta em zero — medido em 03/08/2026,
 * agosto tinha 0 de producao para praticamente todo mundo. Dizer "39o de 39"
 * ali nao informa desempenho nenhum: informa o desempate. E, numa tela cujo
 * proposito e estimular, entregar a lanterna por nao ter comecado o mes e o
 * oposto do que se quer. A tela mostra "sem posicao ainda".
 */
export function rankingDaRegional(params: {
  promotores: ReadonlyArray<{
    promoter_id: string;
    estado: string | null;
    producao_acumulada: number;
  }>;
  promoterId: string;
}): PosicaoRanking | null {
  const { promotores, promoterId } = params;
  const eu = promotores.find((p) => p.promoter_id === promoterId);
  if (!eu) return null;

  const regional = regionalDoEstado(eu.estado);
  if (!regional) return null;

  const daRegional = promotores.filter((p) => regionalDoEstado(p.estado) === regional);
  const total = daRegional.length;

  if (!(Number(eu.producao_acumulada) > 0)) {
    return { regional, total, posicao: null };
  }

  const ordenados = [...daRegional]
    .filter((p) => Number(p.producao_acumulada) > 0)
    .sort(
      (a, b) =>
        Number(b.producao_acumulada) - Number(a.producao_acumulada) ||
        a.promoter_id.localeCompare(b.promoter_id),
    );

  const idx = ordenados.findIndex((p) => p.promoter_id === promoterId);
  return { regional, total, posicao: idx >= 0 ? idx + 1 : null };
}
