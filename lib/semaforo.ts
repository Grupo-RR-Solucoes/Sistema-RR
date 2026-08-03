// ============================================================================
// SEMAFORO — a UNICA escala de cor de atingimento de meta do sistema.
//
// POR QUE ESTE ARQUIVO EXISTE. A funcao nasceu dentro de lib/projecaoMetas.ts,
// que importa supabase-js, o motor e o analytics inteiro. Quem so precisa da
// COR — um componente de tela, um helper puro, um teste com node:test — era
// obrigado a arrastar esse grafo junto. lib/ritmoNecessario.ts precisa dela e
// e um modulo PURO; app/equipe/EquipeVisao.tsx e client component.
//
// A implementacao NAO mudou: foi movida verbatim. projecaoMetas continua
// exportando o mesmo nome (reexport), entao nenhum consumidor precisou mudar.
// O ponto e que continue existindo UMA escala: duas telas com limiares
// diferentes exibiriam a mesma verdade com veredictos diferentes.
// ============================================================================

export type Semaforo = "verde" | "amarelo" | "vermelho" | "sem_meta";

/**
 * Cor do atingimento. `percent` e FRACAO (1 = 100%), nunca pontos percentuais.
 *
 *   null    -> "sem_meta"   (nao ha meta cadastrada; a cor se auto-declara)
 *   >= 1    -> "verde"      (vai bater / bateu)
 *   >= 0.8  -> "amarelo"    (perto)
 *   resto   -> "vermelho"
 */
export function semaforoFromPercent(percent: number | null): Semaforo {
  if (percent === null) return "sem_meta";
  if (percent >= 1) return "verde";
  if (percent >= 0.8) return "amarelo";
  return "vermelho";
}
