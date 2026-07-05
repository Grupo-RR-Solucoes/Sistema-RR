// ============================================================
// RECEBIVEIS — Camada 3: AGREGADOR previsto-vs-recebido, GAP like-for-like.
//
// Quadro por COMPETÊNCIA juntando os componentes existentes, comparando
// PRODUTO A PRODUTO (não total-vs-parte) e com cobertura explícita.
//
//   - PREVISTO PRT (Camada 1, prtAgenda): direito contratado da carteira para a
//     competência.
//   - RECEBIDO PRT: actual valor_diferido da competência (summary.actualPrt do
//     /financeiro), só meses fechados.
//   - GAP PRT (acionável) = recebido PRT − previsto PRT, MESMA competência.
//     Negativo => recebeu menos diferido que o direito contratado => candidato a
//     questionamento à Promotiva.
//   - À VISTA: previsto (Camada 2, produção aberta) vs recebido (actual
//     valor_avista) — INFORMATIVO, não classificado como gap de auditoria (base
//     ainda com arestas: produção parcial, 47 sem match no motor).
//   - COBERTURA: o que está incluído vs a incluir (lacunas nomeadas, não zero).
//
// NÃO há "gap total" (recebido caixa total − previsto só PRT) — era falso. Os
// gaps são decompostos por produto. NÃO reimplementa nada: orquestra as camadas.
//
// READ-ONLY.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildFinancialAnalytics } from "@/lib/financialAnalytics";
import { buildPrtAgenda } from "./prtAgenda.ts";
import { buildAvistaProducao } from "./avistaProducao.ts";

export interface CoberturaMes {
  incluido: string[];
  aIncluir: string[];
  nota: string;
}

export interface AgregadorMes {
  /** Competência ("YYYY-MM"). */
  competencia: string;
  /** true se há fechamento desta competência (recebido real). */
  fechado: boolean;

  // ---- PRT (like-for-like, acionável) ----
  /** Direito contratado da carteira para a competência (agenda). */
  previstoPrt: number | null;
  /** Diferido realizado da competência (actual valor_diferido), só se fechado. */
  recebidoPrt: number | null;
  /** recebidoPrt − previstoPrt (mesma competência). Negativo = questionar. */
  gapPrt: number | null;

  // ---- À vista (INFORMATIVO, não auditoria) ----
  /** À vista crédito PF previsto da produção aberta (Camada 2). */
  previstoAvista: number | null;
  /** À vista realizado da competência (actual valor_avista), só se fechado. */
  recebidoAvista: number | null;
  /** recebido − previsto à vista (INFORMATIVO; base com arestas). */
  gapAvistaInformativo: number | null;

  // ---- Previsão CONGELADA (sub-PR 1, ADITIVO — não altera os campos acima) ----
  /** previsto PRT congelado num snapshot ANTERIOR a esta competência (o que se
   *  previu ENTÃO, não o re-derivado). null se não há snapshot com lead. */
  previstoPrtCongelado: number | null;
  /** previsto à vista congelado (idem). */
  previstoAvistaCongelado: number | null;
  /** recebidoPrt − previstoPrtCongelado (só fechado + com congelado). O confronto
   *  contra a previsão de VERDADE (não a re-derivada). */
  gapVsCongelado: number | null;
  /** competência do snapshot usado (rastreabilidade do lead). */
  competenciaSnapshotUsado: string | null;

  // ---- Diferido de PRODUÇÃO NOVA (sub-PR 2, ADITIVO — não altera os campos acima) ----
  /** cauda do diferido (excedente acima do teto 6% da produção aberta) previsto para
   *  esta competência. Contratos da produção aberta, DISJUNTOS do prtAgenda (estoque)
   *  => sem dupla contagem. null quando não há cauda nesta competência. */
  previstoDiferido: number | null;

  /** Régua TRP em fallback: à vista calculado com a TRP de uma competência
   *  anterior (esta competência não tem TRP própria publicada). null quando a
   *  competência tem TRP própria. competenciaFornecedora = competência da régua
   *  usada (mais recente anterior); contratos = nº de contratos à vista afetados. */
  avistaFallback: { competenciaFornecedora: string; contratos: number } | null;

  cobertura: CoberturaMes;
}

export interface AgregadorResult {
  snapshotPrt: string;
  competenciaProducaoAberta: string;
  competenciaCaixaAvista: string;
  avistaContratosSemTrp: number;
  meses: AgregadorMes[];
}

export interface AgregadorOptions {
  refDate?: Date;
  /** Meses à frente do snapshot do PRT (default 6). */
  horizonteMeses?: number;
  /**
   * Meses realizados ANTES do snapshot a incluir (default 0). Útil para a tela:
   * dá a linha "realizado" (recebido PRT histórico) antes do previsto.
   */
  lookbackMeses?: number;
  /** Competência inicial; default = snapshot − lookbackMeses. */
  competenciaInicial?: { year: number; month: number };
}

// ------------------------------------------------------------------ helpers --

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function label(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}
function parseComp(comp: string): { year: number; month: number } {
  const [y, m] = comp.split("-").map(Number);
  return { year: y, month: m };
}
function addMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CongeladoAlvo {
  previstoPrt: number | null;
  previstoAvista: number | null;
  competenciaSnapshot: string;
}

/** Lê previsao_snapshot e, por competência-alvo, escolhe o snapshot mais recente
 *  ANTERIOR ao alvo (o LEAD: previsão feita ANTES do mês previsto). Tolera a tabela
 *  ausente (migration manual ainda não aplicada) => mapa vazio, sem campos
 *  congelados, comportamento atual preservado. ADITIVO. */
async function fetchPrevisaoCongelada(
  supabase: SupabaseClient,
): Promise<Map<string, CongeladoAlvo>> {
  const out = new Map<string, CongeladoAlvo>();
  try {
    const { data, error } = await supabase
      .from("previsao_snapshot")
      .select("competencia_snapshot, competencia_alvo, previsto_prt, previsto_avista");
    if (error || !data) return out;
    for (const r of data as Array<{
      competencia_snapshot: string;
      competencia_alvo: string;
      previsto_prt: number | null;
      previsto_avista: number | null;
    }>) {
      // LEAD: só previsões feitas ANTES do alvo (snapshot < alvo). Exclui o próprio
      // snapshot (gap ~0 por construção), que não é um teste de previsão forward.
      if (!(r.competencia_snapshot < r.competencia_alvo)) continue;
      const cur = out.get(r.competencia_alvo);
      if (!cur || r.competencia_snapshot > cur.competenciaSnapshot) {
        out.set(r.competencia_alvo, {
          previstoPrt: r.previsto_prt,
          previstoAvista: r.previsto_avista,
          competenciaSnapshot: r.competencia_snapshot,
        });
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** Conjunto de competências (YYYY-MM) com fechamento. */
async function fetchClosedMonths(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("fechamento_mensal_empresa")
    .select("ano, mes");
  if (error) throw new Error(error.message);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ ano: number; mes: number }>) {
    set.add(label(Number(r.ano), Number(r.mes)));
  }
  return set;
}

// ----------------------------------------------------------- orquestrador --

export async function buildAgregadorRecebiveis(
  supabase: SupabaseClient,
  options: AgregadorOptions = {},
): Promise<AgregadorResult> {
  const horizonteMeses = options.horizonteMeses ?? 6;
  const refDate = options.refDate ?? new Date();

  const [agenda, avista, closedSet, congeladoByAlvo] = await Promise.all([
    buildPrtAgenda(supabase, { horizonteMeses: horizonteMeses + 2 }),
    buildAvistaProducao(supabase, { refDate }),
    fetchClosedMonths(supabase),
    fetchPrevisaoCongelada(supabase),
  ]);

  // Diferido de produção nova por competência (sub-PR 2, aditivo).
  const diferidoByComp = new Map<string, number>(
    avista.diferidoSerie.map((d) => [d.competencia, d.diferido]),
  );

  // PRT previsto por competência: snapshot (base) + a série projetada.
  const previstoPrtByComp = new Map<string, number>();
  previstoPrtByComp.set(agenda.snapshot.competencia, agenda.baseComissao);
  for (const p of agenda.serie) previstoPrtByComp.set(p.competencia, p.previsto);

  // Janela: do (snapshot − lookback) até (snapshot + horizonte). O lookback traz
  // meses realizados (recebido PRT) antes do snapshot; o horizonte é o previsto.
  const lookbackMeses = options.lookbackMeses ?? 0;
  const snap = parseComp(agenda.snapshot.competencia);
  const ini = options.competenciaInicial ?? addMonth(snap.year, snap.month, -lookbackMeses);
  const totalSteps = lookbackMeses + horizonteMeses;

  const meses: AgregadorMes[] = [];
  for (let h = 0; h <= totalSteps; h++) {
    const m = addMonth(ini.year, ini.month, h);
    const comp = label(m.year, m.month);
    const fechado = closedSet.has(comp);

    const previstoPrt = previstoPrtByComp.has(comp) ? (previstoPrtByComp.get(comp) as number) : null;
    const previstoAvista = avista.competenciaProducao === comp ? avista.avistaPrevisto : null;

    // Recebido por produto: actual* da PRÓPRIA competência (só se fechada).
    let recebidoPrt: number | null = null;
    let recebidoAvista: number | null = null;
    if (fechado) {
      const fin = await buildFinancialAnalytics(supabase, { year: m.year, month: m.month });
      recebidoPrt = round2(fin.summary.actualPrt);
      recebidoAvista = round2(fin.summary.actualCash);
    }

    const gapPrt =
      fechado && recebidoPrt !== null && previstoPrt !== null
        ? round2(recebidoPrt - previstoPrt)
        : null;
    const gapAvistaInformativo =
      fechado && recebidoAvista !== null && previstoAvista !== null
        ? round2(recebidoAvista - previstoAvista)
        : null;

    // ---- cobertura (transparência honesta) ----
    const incluido: string[] = [];
    if (previstoPrt !== null) incluido.push("PRT (agenda — direito contratado)");
    if (previstoAvista !== null) incluido.push("à vista crédito PF (produção aberta, só realizado)");

    const aIncluir: string[] = [
      "outros produtos (consórcio, bbcap, conta corrente, dental, lob)",
    ];
    if (previstoPrt === null) aIncluir.push("PRT além do horizonte da agenda");
    if (previstoAvista !== null && avista.contratosSemTrp > 0) {
      aIncluir.push(`${avista.contratosSemTrp} contratos à vista sem match no motor TRP`);
    }
    // TRP self-service F6b.4: sinal de fallback ESTRUTURADO (badge por tela, no
    // lugar do texto solto em aIncluir). Dispara em QUALQUER fonte (db ou json —
    // ambas fazem fallback simétrico) quando a competência usou a TRP de um mês
    // anterior. Só estrutura a saída; a lógica de fallback (avistaProducao) não muda.
    const avistaFallback =
      previstoAvista !== null && avista.contratosFallback > 0 && avista.competenciaFallback
        ? {
            competenciaFornecedora: avista.competenciaFallback,
            contratos: avista.contratosFallback,
          }
        : null;
    if (previstoAvista === null) {
      aIncluir.push("à vista crédito PF (sem produção importada para esta competência ainda)");
    }

    let nota: string;
    if (fechado && gapPrt !== null) {
      nota =
        comp === agenda.snapshot.competencia
          ? "Competência do snapshot: previsto = base da agenda = recebido, gap PRT ~0 por construção. Gaps reais surgem nas competências futuras ao fecharem."
          : "GAP PRT like-for-like (recebido diferido − agenda da MESMA competência). Negativo = recebeu menos que o direito contratado => questionar Promotiva.";
    } else {
      nota =
        "Competência futura: ainda não fechada. PRT é o direito contratado (agenda)" +
        (previstoAvista !== null ? " + à vista crédito PF da produção aberta (parcial, cresce com novas diárias)" : "") +
        ". Gap só após o fechamento.";
    }

    // ---- Previsão CONGELADA (sub-PR 1, ADITIVO) ----
    const cong = congeladoByAlvo.get(comp) ?? null;
    const previstoPrtCongelado = cong ? cong.previstoPrt : null;
    const previstoAvistaCongelado = cong ? cong.previstoAvista : null;
    const gapVsCongelado =
      fechado && recebidoPrt !== null && previstoPrtCongelado !== null
        ? round2(recebidoPrt - previstoPrtCongelado)
        : null;

    meses.push({
      competencia: comp,
      fechado,
      previstoPrt: previstoPrt === null ? null : round2(previstoPrt),
      recebidoPrt,
      gapPrt,
      previstoAvista: previstoAvista === null ? null : round2(previstoAvista),
      recebidoAvista,
      gapAvistaInformativo,
      previstoPrtCongelado,
      previstoAvistaCongelado,
      gapVsCongelado,
      competenciaSnapshotUsado: cong ? cong.competenciaSnapshot : null,
      previstoDiferido: diferidoByComp.has(comp) ? round2(diferidoByComp.get(comp) as number) : null,
      avistaFallback,
      cobertura: { incluido, aIncluir, nota },
    });
  }

  return {
    snapshotPrt: agenda.snapshot.competencia,
    competenciaProducaoAberta: avista.competenciaProducao,
    competenciaCaixaAvista: avista.competenciaCaixa,
    avistaContratosSemTrp: avista.contratosSemTrp,
    meses,
  };
}
