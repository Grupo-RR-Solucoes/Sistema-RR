// ============================================================================
// VIGÊNCIA DA RÉGUA — deliberadamente SEPARADA da janela de produção.
//
// DECISÃO DO DIEGO (02/09/2026). Leia isto antes de "unificar" com
// `vigenciaDaCompetencia`: a semelhança é real e a separação é de propósito.
//
// ---------------------------------------------------------------------------
// SÃO PERGUNTAS DIFERENTES
// ---------------------------------------------------------------------------
// `vigenciaDaCompetencia` (lib/trp/vigencia.ts) responde:
//     "QUE PRODUÇÃO CONTA NESTE MÊS?"
// É a janela de produção da REGRA RR — último dia útil do mês anterior até o
// PENÚLTIMO dia útil do mês nominal. Ela tem consequência em meta, ritmo, faixa
// de repasse e VALOR PAGO: é o recorte que `lib/proposalDetailing.ts` protege
// com a TRAVA ("REPROCESSAR COMPETÊNCIA FECHADA COM ESTE CÓDIGO PODE MUDAR
// VALOR JÁ PAGO"), e são 17 os sítios que a consomem.
//
// Este arquivo responde outra coisa:
//     "QUE TABELA REGE ESTE CONTRATO?"
//
// Até 02/09/2026 as duas compartilhavam implementação — por CONVENIÊNCIA, não
// por identidade. E a conveniência tinha um furo.
//
// ---------------------------------------------------------------------------
// A ASSIMETRIA QUE DECIDE (é ela que impede a unificação)
// ---------------------------------------------------------------------------
// As janelas de competência NÃO particionam o calendário. Entre o PENÚLTIMO dia
// útil de um mês (onde a janela de M termina) e o ÚLTIMO dia útil do mesmo mês
// (onde a janela de M+1 começa) pode haver dias no meio. Esses dias são ÓRFÃOS:
// nenhuma janela os cobre, e `competenciaDaData` mesmo assim devolve uma
// competência para eles (o `return competenciaKey(current)` do fim da função).
//
// MEDIDO em 02/09/2026, sobre 191 meses (2020-01..2035-11): 25 meses com órfão,
// 13,1%. Nas competências vivas: 29-30/08/2026, 28-29/11/2026, 29-30/05/2027.
//
// E aqui está a assimetria:
//
//   - Um dia órfão é SEMPRE não-útil (fim de semana, ou feriado — ele está,
//     por construção, ENTRE dois dias úteis consecutivos na contagem). Então a
//     JANELA DE PRODUÇÃO não perde nada ignorando-o: nenhum contrato de
//     produção existe lá. Medido: 0 contratos nas 6 datas órfãs vivas, e 0 em
//     2.621 linhas desde 2024.
//
//   - A RÉGUA, não. Ela precisa cobrir TODA data que possa carregar um
//     `contract_date` — inclusive sábado por import atrasado, ajuste manual, ou
//     carimbo de data não-útil pela Promotiva. Sem cobertura, o resolvedor
//     lança TrpVigenciaGapError e derrubam-se /promotores, /recebiveis e
//     /dashboard na PRIMEIRA linha (o erro propaga de propósito: ninguém o
//     captura, e escolher "a régua mais próxima" pagaria errado em silêncio).
//
// Requisitos diferentes. Por isso, implementações separadas.
//
// ---------------------------------------------------------------------------
// O QUE ESTE ARQUIVO **NÃO** MUDA
// ---------------------------------------------------------------------------
// Nada da janela de produção. `vigenciaDaCompetencia` continua exatamente como
// estava, e os 17 sítios dela não sabem que este arquivo existe. Nenhum dia
// ÚTIL entra ou sai de nenhuma janela — logo `countBusinessDays`, o ritmo, a
// meta e a faixa de repasse são bit-a-bit os mesmos.
//
// E não mexe em LINHA GRAVADA: `trp_rule_versions` não é reescrita. A cobertura
// estendida é decidida na LEITURA (ver `escolherFatia` em resolveTrpRegraDb.ts),
// o que também cobre o fallback em cascata — que monta uma fatia VIRTUAL e
// portanto não teria linha para um UPDATE alcançar.
// ============================================================================

import {
  competenciaKey,
  parseCompetencia,
  subtraiUmDia,
  vigenciaDaCompetencia,
  type CompetenciaYM,
} from "@/lib/trp/vigencia";

export interface VigenciaRegua {
  /** Igual ao validFrom da janela: a emenda da FRENTE já é adjacente por
   *  construção (o valid_from de M é o dia seguinte ao fim estendido de M-1). */
  reguaFrom: string;
  /** O dia ANTERIOR ao valid_from da competência SEGUINTE. É aqui que diverge
   *  da janela de produção — e só aqui. */
  reguaUntil: string;
}

/** Competência seguinte a "YYYY-MM" (rolagem de ano incluída). */
function competenciaSeguinte(competencia: string | CompetenciaYM): string {
  const { year, month } = parseCompetencia(competencia);
  const d = new Date(Date.UTC(year, month, 1)); // month é 1-based: +1 mês
  return competenciaKey({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
}

/**
 * Vigência DA RÉGUA da competência: do início da janela até o dia ANTERIOR ao
 * início da janela da competência seguinte.
 *
 * Por construção, isto PARTICIONA o calendário — não sobra dia órfão entre duas
 * competências consecutivas. É a única diferença em relação a
 * `vigenciaDaCompetencia`, e ela vive só na CAUDA do mês.
 *
 * NO-OP em 21 dos 24 meses de 2026-27: quando o penúltimo e o último dia útil
 * são consecutivos, `reguaUntil === validUntil`.
 */
export function vigenciaReguaDaCompetencia(competencia: string | CompetenciaYM): VigenciaRegua {
  const comp = competenciaKey(competencia);
  const { validFrom } = vigenciaDaCompetencia(comp);
  const proxima = vigenciaDaCompetencia(competenciaSeguinte(comp));
  return { reguaFrom: validFrom, reguaUntil: subtraiUmDia(proxima.validFrom) };
}

/**
 * Limite superior EFETIVO de cobertura de uma fatia.
 *
 * REGRA (a única deste arquivo que o resolvedor aplica):
 *   a ÚLTIMA fatia ativa da competência cobre até o dia anterior ao valid_from
 *   da competência seguinte. As demais mantêm o limite GRAVADO, sem exceção.
 *
 * Três propriedades, e as três são cobradas pelo portão:
 *
 *   (1) `max`, NUNCA substituição. O limite efetivo jamais ENCOLHE uma fatia
 *       gravada. Se alguém gravar à mão um valid_until maior, ele vence.
 *
 *   (2) SÓ A ÚLTIMA. "Última" é a de maior valid_from, e tem de ser CALCULADA
 *       pelo chamador, nunca tomada de `fatias[0]` — mesma lição já escrita em
 *       commitVersion.ts sobre o `.order()` ser otimização de tráfego e a
 *       decisão ser do código. Esticar uma fatia do MEIO faria um contrato
 *       escorregar para a régua seguinte: dinheiro errado, em silêncio.
 *
 *   (3) SÓ NA CAUDA. A extensão só existe DEPOIS do validUntil da janela. Ela
 *       é, por construção, incapaz de tapar um buraco no MEIO da competência —
 *       e é isso que preserva as três conferências de commitTrpVersion, que
 *       existem porque "o EXCLUDE do banco pega SOBREPOSIÇÃO, nunca AUSÊNCIA".
 */
export function limiteEfetivoDaFatia(
  competencia: string | CompetenciaYM,
  rowValidUntil: string,
  ehUltimaFatia: boolean,
): string {
  if (!ehUltimaFatia) return rowValidUntil;
  const { reguaUntil } = vigenciaReguaDaCompetencia(competencia);
  return reguaUntil > rowValidUntil ? reguaUntil : rowValidUntil; // (1) max, nunca encolhe
}
