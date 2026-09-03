// ============================================================
// RECEBIVEIS — sub-PR 1: CONGELAMENTO (snapshot) da previsão vigente.
//
// Congela, no momento do fechamento, a CURVA FORWARD que a projeção previu
// (buildPrtAgenda + buildAvistaProducao), para permitir depois o confronto
// "previsto ENTÃO vs recebido DEPOIS". Sem isto, o previsto é sempre re-derivado
// e o histórico de previsão é irrecuperável.
//
// Idempotente: ON CONFLICT (competencia_snapshot, competencia_alvo) DO NOTHING —
// o PRIMEIRO congelamento vence (re-importar o mesmo fechamento não sobrescreve a
// previsão autêntica). READ da projeção + WRITE só em previsao_snapshot; NÃO altera
// nada existente.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildPrtAgenda } from "./prtAgenda.ts";
import { buildAvistaProducao } from "./avistaProducao.ts";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "YYYY-MM" → {ano, mes}. null quando ausente OU malformada (não adivinha). */
function parseCompetencia(comp?: string | null): { ano: number; mes: number } | null {
  if (comp == null) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(String(comp).trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return { ano, mes };
}

export interface CongelarPrevisaoResult {
  /** Competência do snapshot (vintage) usado neste congelamento. */
  competenciaSnapshot: string;
  /** Linhas efetivamente inseridas (novas) — 0 se tudo já existia (idempotência). */
  linhasGravadas: number;
  /** Linhas da curva forward (inseridas OU já existentes). */
  linhasProjetadas: number;
  /** true se o vintage JÁ existia — nada foi gravado (write-once). */
  vintageJaExistia: boolean;
  /** Linhas recalculadas que NÃO foram gravadas por já existir o vintage. */
  linhasDescartadas: number;
  /**
   * true quando o vintage gravado tem campo NULL que o cálculo de AGORA preencheria.
   * É o sintoma do vintage congelado cedo demais (ex.: jun/2026 congelado antes de
   * carteira_contrato existir → previsto_diferido NULL para sempre).
   */
  vintageIncompleto: boolean;
  /** Avisos legíveis (também vão para console.warn). */
  avisos: string[];
  /** true quando rodou em dry-run (nada gravado). */
  dryRun: boolean;
  /** As linhas que seriam/foram gravadas — para conferência no dry-run. */
  linhas: PrevisaoSnapshotRow[];
  /**
   * De onde saiu a competência congelada: "parametro" (quem chamou pediu) ou
   * "max_carteira" (derivada do max(competencia) de carteira_contrato).
   *
   * NÃO é enfeite: "max_carteira" é o caminho que perdeu o vintage de 2026-07
   * para sempre. Ele continua existindo para as chamadas manuais legadas, mas
   * agora DIZ que foi ele — e o portão exige que os imports usem "parametro".
   */
  competenciaOrigem: "parametro" | "max_carteira";
}

export interface PrevisaoSnapshotRow {
  competencia_snapshot: string;
  competencia_alvo: string;
  previsto_prt: number | null;
  previsto_avista: number | null;
  previsto_diferido: number | null;
  base_snapshot_prt: string;
  contratos_avista_fallback: number | null;
}

/** Campos do snapshot que podem ficar NULL por congelamento prematuro. */
const CAMPOS_PREVISAO = ["previsto_prt", "previsto_avista", "previsto_diferido"] as const;

/**
 * Congela a projeção de recebíveis vigente em `previsao_snapshot`.
 * `horizonteMeses` = quantos meses à frente congelar (default 12).
 * `dryRun` = calcula e confere, mas NÃO grava.
 */
export async function congelarPrevisao(
  supabase: SupabaseClient,
  options: { horizonteMeses?: number; dryRun?: boolean; competencia?: string } = {},
): Promise<CongelarPrevisaoResult> {
  const horizonteMeses = options.horizonteMeses ?? 12;
  const dryRun = options.dryRun === true;

  // A COMPETÊNCIA VEM DE PARÂMETRO. O max(competencia) de carteira_contrato
  // sobrou como fallback das chamadas manuais legadas, e o resultado DIZ qual
  // dos dois foi usado — porque foi o max que deixou o vintage de 2026-07
  // inalcançável: entre 07/07 e 02/09 a materialização esteve morta; quando
  // rodou, o max já era 2026-08 e julho nunca mais pôde ser pedido.
  const pedida = parseCompetencia(options.competencia);
  if (options.competencia !== undefined && !pedida) {
    throw new Error(
      `competencia invalida: ${JSON.stringify(options.competencia)} — esperado "YYYY-MM".`,
    );
  }
  const competenciaOrigem: "parametro" | "max_carteira" = pedida ? "parametro" : "max_carteira";

  const [agenda, avista] = await Promise.all([
    buildPrtAgenda(supabase, {
      horizonteMeses,
      ...(pedida ? { competencia: { ano: pedida.ano, mes: pedida.mes } } : {}),
    }),
    // O à-vista TEM de ler a MESMA competência do PRT. Sem isto, um catch-up de
    // julho gravaria previsto_prt de julho ao lado de previsto_avista de
    // setembro na mesma linha — e write-once torna isso permanente.
    buildAvistaProducao(
      supabase,
      pedida ? { competencia: { year: pedida.ano, month: pedida.mes } } : {},
    ),
  ]);

  const competenciaSnapshot = agenda.snapshot.competencia;

  // previsto PRT por competência-alvo: base do snapshot (h=0) + a série forward.
  const previstoPrtByAlvo = new Map<string, number>();
  previstoPrtByAlvo.set(agenda.snapshot.competencia, agenda.baseComissao);
  for (const p of agenda.serie) previstoPrtByAlvo.set(p.competencia, p.previsto);

  // diferido de produção nova por competência-alvo (sub-PR 2).
  const diferidoByAlvo = new Map<string, number>(
    avista.diferidoSerie.map((d) => [d.competencia, d.diferido]),
  );

  // à-vista previsto só existe na competência da produção aberta. O diferido pode
  // cair em qualquer competência-alvo da cauda; unimos as chaves das duas fontes.
  const alvos = new Set<string>([...previstoPrtByAlvo.keys(), ...diferidoByAlvo.keys()]);
  const rows = Array.from(alvos).map((alvo) => {
    const ehProducaoAberta = avista.competenciaProducao === alvo;
    const previstoPrt = previstoPrtByAlvo.has(alvo) ? (previstoPrtByAlvo.get(alvo) as number) : null;
    return {
      competencia_snapshot: competenciaSnapshot,
      competencia_alvo: alvo,
      previsto_prt: previstoPrt === null ? null : round2(previstoPrt),
      previsto_avista: ehProducaoAberta ? round2(avista.avistaPrevisto) : null,
      previsto_diferido: diferidoByAlvo.has(alvo) ? round2(diferidoByAlvo.get(alvo) as number) : null,
      base_snapshot_prt: agenda.snapshot.competencia,
      contratos_avista_fallback:
        ehProducaoAberta && avista.competenciaFallback ? avista.contratosFallback : null,
    };
  });

  // AVISO ANTI-SILÊNCIO. O write-once (ON CONFLICT DO NOTHING) é CORRETO — a previsão
  // autêntica não pode ser sobrescrita por um re-import. Mas ele era SILENCIOSO: o
  // congelamento retornava sucesso com 0 linhas e ninguém via que o resultado tinha
  // sido descartado. Foi exatamente assim que jun/2026 ficou errado para sempre: o
  // seed manual congelou em 04/07 (antes de carteira_contrato existir) com
  // previsto_diferido NULL; o hook rodou no fechamento de 09/07 já com a carteira
  // certa, recalculou tudo — e o DO NOTHING jogou fora, em silêncio.
  //
  // A semântica NÃO muda (segue write-once, sem sobrescrever). O que muda é que agora
  // isso é VISÍVEL: dizemos que o vintage já existia, quantas linhas foram descartadas
  // e — o que importa de verdade — se o que está gravado está INCOMPLETO em relação ao
  // que o cálculo de hoje produziria. Consertar exige ação explícita (apagar o vintage
  // e recongelar), que é como tem que ser: dado congelado não se reescreve sozinho.
  const { data: existentes, error: erroExistentes } = await supabase
    .from("previsao_snapshot")
    .select("competencia_alvo, previsto_prt, previsto_avista, previsto_diferido")
    .eq("competencia_snapshot", competenciaSnapshot);
  if (erroExistentes) throw new Error(erroExistentes.message);

  const avisos: string[] = [];
  const vintageJaExistia = (existentes ?? []).length > 0;
  let vintageIncompleto = false;

  if (vintageJaExistia) {
    const existentePorAlvo = new Map(
      (existentes ?? []).map((e: any) => [String(e.competencia_alvo), e]),
    );
    // Campo NULL no gravado que o cálculo de AGORA preencheria => vintage incompleto.
    const lacunas: string[] = [];
    for (const nova of rows) {
      const velha = existentePorAlvo.get(nova.competencia_alvo);
      if (!velha) {
        lacunas.push(`${nova.competencia_alvo} (alvo ausente no vintage gravado)`);
        continue;
      }
      for (const campo of CAMPOS_PREVISAO) {
        if (velha[campo] === null && (nova as any)[campo] !== null) {
          lacunas.push(`${nova.competencia_alvo}.${campo}`);
        }
      }
    }
    if (lacunas.length > 0) {
      vintageIncompleto = true;
      avisos.push(
        `Vintage ${competenciaSnapshot} INCOMPLETO: ${lacunas.length} campo(s) estao NULL no ` +
          `snapshot gravado mas o calculo de agora os preencheria (${lacunas.slice(0, 6).join(", ")}` +
          `${lacunas.length > 6 ? ", ..." : ""}). Foi congelado cedo demais. Para corrigir: apague as ` +
          `linhas de competencia_snapshot='${competenciaSnapshot}' e recongele.`,
      );
    }
    avisos.push(
      `Vintage ${competenciaSnapshot} JA EXISTIA: ${rows.length} linha(s) recalculadas NAO foram ` +
        `gravadas (write-once — a previsao autentica nao e sobrescrita).`,
    );
  }

  for (const aviso of avisos) console.warn(`[congelarPrevisao] ${aviso}`);

  if (dryRun) {
    return {
      competenciaSnapshot,
      linhasGravadas: 0,
      linhasProjetadas: rows.length,
      vintageJaExistia,
      linhasDescartadas: vintageJaExistia ? rows.length : 0,
      vintageIncompleto,
      avisos,
      dryRun: true,
      linhas: rows,
      competenciaOrigem,
    };
  }

  // ON CONFLICT (competencia_snapshot, competencia_alvo) DO NOTHING.
  // ignoreDuplicates:true -> só insere o que não existe; .select() devolve apenas
  // as linhas realmente inseridas (2ª rodada = 0 linhas => idempotência provada).
  const { data, error } = await supabase
    .from("previsao_snapshot")
    .upsert(rows, {
      onConflict: "competencia_snapshot,competencia_alvo",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw new Error(error.message);

  const linhasGravadas = (data ?? []).length;

  return {
    competenciaSnapshot,
    linhasGravadas,
    linhasProjetadas: rows.length,
    vintageJaExistia,
    linhasDescartadas: rows.length - linhasGravadas,
    vintageIncompleto,
    avisos,
    dryRun: false,
    linhas: rows,
    competenciaOrigem,
  };
}
