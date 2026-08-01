import type { Tendencia } from "@/lib/projecaoMetas";

/**
 * MEDIA DOS 3 MESES ANTERIORES + TENDENCIA — FONTE UNICA.
 *
 * Regra (decisao Diego, 31/07/2026): SOMA POR COMPETENCIA e so entao tira a
 * media das competencias. NUNCA media por linha.
 *
 * POR QUE ISSO IMPORTA
 * A chave de promoter_monthly_results tem 4 campos e inclui company_id: um
 * promotor que produziu em RR (source 'fechamento') e em ADS (source 'bbts') na
 * MESMA competencia tem DUAS linhas. Dividir pelo numero de LINHAS trata as duas
 * como dois meses e corta a media dele pela metade. E a mesma familia de
 * truncamento que o Movimento 2 matou no relatorio e no DRE.
 *
 * DOIS CHAMADORES, UMA IMPLEMENTACAO:
 *   - lib/projecaoMetas.ts        (caminho socio/funcionario) — entrega as linhas
 *     CRUAS do PMR, varias por competencia; o agrupamento acontece aqui.
 *   - lib/projecao/gestorAdapter  (caminho supervisor/gerente) — entrega a serie
 *     ja somada por competencia; o agrupamento aqui vira no-op e o resultado e o
 *     mesmo. E de proposito que a entrada aceita as duas formas.
 *
 * `import type` do Tendencia: apagado na compilacao, entao nao ha ciclo em
 * runtime com projecaoMetas (que importa este modulo de verdade).
 */

/** Uma observacao de producao. Pode haver VARIAS para a mesma competencia. */
export type EntradaMensal = {
  year: number;
  month: number;
  valor: number;
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const chave = (year: number, month: number) => `${year}-${pad2(month)}`;

/**
 * As N competencias ANTERIORES a (year, month). Default 3.
 * Usa aritmetica UTC para nao depender de fuso na virada de ano.
 */
export function competenciasAnteriores(year: number, month: number, n = 3): Set<string> {
  const out = new Set<string>();
  for (let k = 1; k <= n; k += 1) {
    const dt = new Date(Date.UTC(year, month - 1 - k, 1));
    out.add(chave(dt.getUTCFullYear(), dt.getUTCMonth() + 1));
  }
  return out;
}

/**
 * Media das competencias anteriores.
 *
 * DENOMINADOR = numero de COMPETENCIAS distintas com observacao, nunca o numero
 * de observacoes. Competencia sem nenhuma observacao nao entra (nao vira zero no
 * numerador nem no denominador) — quem nao produziu naquele mes nao tem o mes
 * contado contra si.
 *
 * Devolve 0 quando nao ha nenhuma competencia anterior com observacao; 0 e o
 * sinal que tendenciaDe le como "sem_historico".
 */
export function mediaTresMeses(
  entradas: readonly EntradaMensal[],
  year: number,
  month: number,
  n = 3,
): number {
  const alvo = competenciasAnteriores(year, month, n);
  const porCompetencia = new Map<string, number>();
  for (const e of entradas) {
    const k = chave(e.year, e.month);
    if (!alvo.has(k)) continue;
    const v = Number(e.valor);
    porCompetencia.set(k, (porCompetencia.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  if (porCompetencia.size === 0) return 0;
  let soma = 0;
  for (const v of porCompetencia.values()) soma += v;
  return soma / porCompetencia.size;
}

/**
 * Tendencia da projecao contra a media. Limiar de +-0,001 (0,1%) separa
 * "estavel" de variacao real — abaixo disso e ruido de arredondamento.
 *
 * media3m <= 0 significa sem base de comparacao: "sem_historico" e percentual
 * NULO (nao zero — zero seria "variou 0%", que e afirmacao diferente).
 */
export function tendenciaDe(
  projecao: number,
  media3m: number,
): { tendencia: Tendencia; tendencia_percent: number | null } {
  if (!(media3m > 0)) return { tendencia: "sem_historico", tendencia_percent: null };
  const vari = (projecao - media3m) / media3m;
  return {
    tendencia: vari > 0.001 ? "crescimento" : vari < -0.001 ? "queda" : "estavel",
    tendencia_percent: vari,
  };
}
