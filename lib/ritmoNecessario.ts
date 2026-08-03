import type { JanelaRitmo } from "./janelaRitmo.ts";
import { semaforoFromPercent, type Semaforo } from "./semaforo.ts";

// ============================================================================
// RITMO DIARIO NECESSARIO — fonte UNICA. Nenhuma tela divide meta por dia na
// mao. Se voce esta escrevendo `(meta - acumulado) / dias` em qualquer outro
// arquivo, pare: a conta mora aqui, pelo mesmo motivo que o delta mora em
// lib/delta/calcularDelta.ts — um numero que ninguem confere de cabeca precisa
// de UM lugar so, senao duas telas divergem e as duas parecem plausiveis.
//
// A CONTA RODA NO SERVIDOR. As rotas chamam este helper e mandam o RESULTADO
// pronto no payload; a tela so desenha. Nao e preciosismo de arquitetura: a
// /projecao e client component, e importar este modulo no cliente arrastaria
// projecaoMetas -> supabase-js + motor para dentro do bundle.
//
// ESTADOS EXPLICITOS, e o motivo de existirem
// ---------------------------------------------------------------------------
// Um card de ritmo tem quatro jeitos de mentir, e cada estado mata um:
//   - dividir por zero quando nao ha dia restante        -> SEM_DIAS
//   - exibir ritmo NEGATIVO quando a meta ja foi batida  -> META_BATIDA
//   - exibir ritmo de um mes que ja acabou               -> MES_FECHADO
//   - exibir "R$ 0,00/dia" quando nao ha meta cadastrada -> SEM_META
// Nenhum deles e caso raro. SEM_DIAS e o estado REAL de julho/2026 (a janela
// de producao encerrou em 30/07, mas o regime segue 'open' porque o fechamento
// nao foi importado).
//
// SEM_META foi o estado de agosto/2026 ate 03/08/2026 02:47 UTC, quando as 50
// metas da competencia foram cadastradas (medido pelo created_at das linhas de
// monthly_targets). Ou seja: e um estado que o sistema ATRAVESSA todo comeco de
// mes, entre a virada e o cadastro das metas — nao uma hipotese de laboratorio.
// NAO "simplifique" sumindo com o card nesse intervalo: e justamente quando a
// ausencia de cadastro precisa ficar visivel (decisao Diego).
// ============================================================================

export type EstadoRitmo =
  /** Meta ausente ou zero. A tela diz "sem meta cadastrada" — NAO some. */
  | "SEM_META"
  /** Acumulado >= meta. Mostra o quanto PASSOU, nunca um ritmo negativo. */
  | "META_BATIDA"
  /** Competencia FECHADA e meta nao batida: retrospectivo (faltou X). */
  | "MES_FECHADO"
  /** Zero dia restante com a competencia ainda aberta: janela encerrada. */
  | "SEM_DIAS"
  /** 1 dia restante: o ritmo E o que falta. Dividir por 1 e ruido. */
  | "ULTIMO_DIA"
  /** (meta - acumulado) / dias restantes. */
  | "NORMAL";

export type ResultadoRitmo = {
  estado: EstadoRitmo;
  meta: number;
  acumulado: number;
  /** meta - acumulado, PISADO EM ZERO. Nunca negativo. */
  falta: number;
  /** acumulado - meta quando batida; 0 nos demais estados. */
  excedente: number;
  /** total - diasParaRitmo. Ver a nota de DIAS RESTANTES abaixo. */
  diasRestantes: number;
  /** Dias uteis TOTAIS da competencia (vem da janela, nao recontados). */
  diasTotais: number;
  /**
   * Quanto precisa sair POR DIA UTIL restante. `null` quando nao ha ritmo a
   * mostrar (SEM_META, META_BATIDA, MES_FECHADO, SEM_DIAS) — a tela renderiza
   * o texto do estado, nunca um numero.
   */
  ritmoDiario: number | null;
  /** projecao / meta. Fracao, nao pontos percentuais. null = sem meta. */
  percent: number | null;
  /** Cor, pela MESMA escala da /projecao. Ver a equivalencia abaixo. */
  semaforo: Semaforo;
};

export type ParametrosRitmo = {
  /** Meta da competencia. <= 0 ou null => SEM_META. */
  meta: number | null | undefined;
  /** Producao acumulada ate agora, na MESMA unidade da meta. */
  acumulado: number | null | undefined;
  /** Janela de resolverJanelaRitmo. Fonte dos dias — nunca conte dia aqui. */
  janela: JanelaRitmo;
  /**
   * Projecao de fechamento da competencia, JA CALCULADA por quem chama —
   * `projetarPorRitmo(janela, acumulado)` (lib/janelaRitmo.ts) ou o
   * `projecao` que consolidarGrupo/consolidarGrupoEquipe ja devolvem.
   *
   * POR QUE ENTRA COMO PARAMETRO EM VEZ DE SER CALCULADA AQUI: a formula da
   * projecao ja tem dono (projetarPorRitmo) e recalcula-la aqui criaria uma
   * SEGUNDA implementacao — o mesmo erro que a escala de cor duplicada. Este
   * modulo fica PURO (nenhum import de runtime alem da escala de cor), o que
   * tambem o torna testavel com node:test sem arrastar supabase/motor.
   */
  projecao: number | null | undefined;
  /**
   * Regime da competencia: `true` quando o mes esta FECHADO (cms/fechamento).
   *
   * NAO da para deduzir isto de `janela.periodoCompleto`: aquele campo e
   * `closed || refDate > end`, e portanto fica true tambem numa competencia
   * ABERTA cuja janela de producao ja encerrou. E exatamente o caso de
   * julho/2026 hoje — e sao situacoes diferentes para o usuario ("acabou e ja
   * fechou" x "acabou e ainda vai fechar").
   */
  mesFechado: boolean;
};

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * DIAS RESTANTES = total - diasParaRitmo.
 *
 * POR QUE `diasParaRitmo` E NAO `diasDecorridos`. A producao de HOJE so entra
 * no sistema amanha (a diaria e importada no dia seguinte). Entao hoje ainda
 * esta em aberto e conta como dia A PRODUZIR, nao como dia gasto.
 * `diasParaRitmo` ja e `diasDecorridos - 1` quando a competencia esta aberta e
 * hoje e dia util — subtrair ele devolve os dias futuros MAIS hoje.
 *
 * Em dia NAO util os dois coincidem (nao ha o que descontar) e a formula
 * devolve so os futuros — que e o certo, porque hoje nao produz. Medido em
 * 02/08/2026, um domingo: total=21, diasParaRitmo=1, restantes=20.
 *
 * E em competencia com a janela encerrada devolve 0, que e o SEM_DIAS.
 */
export function diasRestantesDe(janela: JanelaRitmo): number {
  return Math.max(0, janela.total - janela.diasParaRitmo);
}

/**
 * Ritmo diario necessario para bater a meta.
 *
 * ---------------------------------------------------------------------------
 * A COR SAI DE semaforoFromPercent, A MESMA DA /projecao — e isso NAO e uma
 * aproximacao conveniente, e uma identidade algebrica. Demonstracao:
 *
 *   Seja  r  = ritmo REALIZADO      = acumulado / diasParaRitmo
 *         T  = dias uteis totais    = janela.total
 *         d  = dias restantes       = T - diasParaRitmo
 *         rn = ritmo NECESSARIO     = (meta - acumulado) / d
 *
 *   projecao >= meta
 *     <=>  r * T >= meta                          [projetarPorRitmo]
 *
 *   r >= rn
 *     <=>  r >= (meta - acumulado) / d
 *     <=>  r * d >= meta - acumulado
 *     <=>  r * (T - diasParaRitmo) >= meta - acumulado
 *     <=>  r * T - r * diasParaRitmo >= meta - acumulado
 *     <=>  r * T - acumulado >= meta - acumulado   [r * diasParaRitmo = acumulado]
 *     <=>  r * T >= meta
 *
 *   As duas ultimas linhas sao a MESMA desigualdade. "Vou bater a meta no
 *   ritmo atual" e "meu ritmo atual ja e o suficiente" sao a mesma afirmacao,
 *   entao usar duas escalas de cor seria exibir a mesma verdade com dois
 *   veredictos — que e como um numero perde a confianca do usuario.
 *
 * ONDE A EQUIVALENCIA NAO SE APLICA (nao "quebra" — deixa de ter os dois lados):
 *
 *   - diasParaRitmo == 0 (inicio da competencia, nenhum dia util vencido):
 *     `r` nao existe (divisao por zero) e projetarPorRitmo devolve 0 por
 *     contrato. O percent vai a 0 e a cor sai VERMELHA, enquanto `rn` existe e
 *     e finito. Nao ha contradicao: nao ha ritmo realizado para comparar. E o
 *     dia 1 do mes, e vermelho ali le como "ainda nao produziu", que e verdade.
 *
 *   - d == 0 (SEM_DIAS / MES_FECHADO): `rn` nao existe. A cor passa a ser
 *     retrospectiva (projetarPorRitmo devolve o proprio acumulado quando
 *     periodoCompleto), isto e, acumulado/meta. Continua sendo a leitura certa:
 *     sem dia restante, o que importa e se bateu.
 * ---------------------------------------------------------------------------
 */
export function calcularRitmoNecessario(params: ParametrosRitmo): ResultadoRitmo {
  const { janela, mesFechado } = params;
  const meta = num(params.meta);
  const acumulado = num(params.acumulado);
  const diasRestantes = diasRestantesDe(janela);
  const diasTotais = janela.total;

  // percent: MESMA projecao da /projecao (projetarPorRitmo, calculada pelo
  // chamador), MESMA escala de cor. Sem meta nao ha percentual — e
  // semaforoFromPercent(null) devolve "sem_meta", entao a cor se auto-declara.
  const percent = meta > 0 ? num(params.projecao) / meta : null;
  const semaforo = semaforoFromPercent(percent);

  const base = {
    meta: round2(meta),
    acumulado: round2(acumulado),
    falta: 0,
    excedente: 0,
    diasRestantes,
    diasTotais,
    ritmoDiario: null as number | null,
    percent,
    semaforo,
  };

  // ORDEM DAS GUARDAS — cada uma responde a pergunta mais util naquele ponto.
  // SEM_META vem antes de tudo porque sem meta nao ha o que comparar, nem
  // retrospectiva possivel: o problema e de CADASTRO, e e isso que a tela tem
  // de dizer. Decisao Diego (02/08): nao sumir em silencio.
  if (meta <= 0) {
    return { ...base, estado: "SEM_META" };
  }

  // META_BATIDA vem antes de MES_FECHADO de proposito: num mes fechado que
  // bateu, "bateu (+X)" JA E a retrospectiva. Sem esta ordem, o mes fechado
  // engoliria a boa noticia.
  if (acumulado >= meta) {
    return { ...base, estado: "META_BATIDA", excedente: round2(acumulado - meta) };
  }

  const falta = round2(meta - acumulado);

  if (mesFechado) {
    return { ...base, estado: "MES_FECHADO", falta };
  }
  if (diasRestantes <= 0) {
    // Janela de producao encerrada, regime ainda aberto. Nao ha dia para
    // produzir e nao ha fechamento importado — nao ha ritmo, e nao e derrota
    // consumada ainda. ESTE E O ESTADO DE julho/2026 HOJE.
    return { ...base, estado: "SEM_DIAS", falta };
  }
  if (diasRestantes === 1) {
    // Dividir por 1 e ruido: o ritmo E o que falta.
    return { ...base, estado: "ULTIMO_DIA", falta, ritmoDiario: falta };
  }

  return {
    ...base,
    estado: "NORMAL",
    falta,
    ritmoDiario: round2(falta / diasRestantes),
  };
}

/** Constante da meta PROPRIA do grupo. Ver o comentario no ponto de uso. */
export const META_DIARIA_GRUPO = 250_000;

/**
 * Meta propria do grupo na competencia = META_DIARIA_GRUPO x dias uteis TOTAIS.
 *
 * DECISAO DIEGO (02/08/2026): constante FIXA, nomeada, e mudar exige deploy.
 * Ela cobre o GRUPO INTEIRO (4 CNPJs RR + ADS), nao so a RR.
 *
 * Os dias vem da janela ja resolvida — nunca de uma contagem nova. Duas
 * contagens de dia util divergem no primeiro feriado municipal, e ai a meta
 * do card deixa de bater com a projecao da mesma tela.
 *
 * Ordem de grandeza medida em 02/08/2026: julho tem 23 dias uteis
 * (R$ 5.750.000) e agosto tem 21 (R$ 5.250.000).
 */
export function metaPropriaDoGrupo(janela: JanelaRitmo): number {
  return META_DIARIA_GRUPO * janela.total;
}
