/* ============================================================================
 * _competenciaAberta — QUAL competencia esta ABERTA, resolvida no proprio run.
 *
 * Prefixo `_`: BIBLIOTECA, nao portao. Mesma convencao de _fakeFechamento.cjs e
 * _diffContraRef.ts — o runner nao a executa e ela nao assere nada sozinha.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO EXISTE (medido em 29/08/2026)
 * ---------------------------------------------------------------------------
 * SEIS portoes needs-db-lento estavam vermelhos pela MESMA causa, e nenhuma
 * delas era defeito: todos cravavam 2026-07 como "o mes ABERTO" porque julho
 * estava aberto quando foram escritos. Julho FECHOU. As 24 assercoes que caiam
 * por isso:
 *
 *   guardas_regime_gate        5   "julho = open"
 *   projecao_dias_ritmo_gate   9   divisores de ritmo com julho ainda em curso
 *   janela_ritmo_paridade_gate 4   REF cravada em 2026-07-30, periodoCompleto=false
 *   mov1_ledger_gate           3   "PMR de julho intacto (so daily)"
 *   mov2_grupoA_gate           2   "libera em julho(open)"
 *   mov3_equipe_gate           1   "2) JULHO (open) — hash identico"
 *
 * O que esses portoes provam — "em mes ABERTO tal coisa e no-op / nao barra" — e
 * PERMANENTE e vale a pena guardar. O que venceu foi a ESCOLHA de julho como
 * representante do regime aberto. Entao a competencia deixa de ser literal e
 * passa a sair do MESMO run, por detectMonthRegime: os dois lados computados,
 * que e a regra que este repo ja aplica as ancoras.
 *
 * Sem isto, todo portao que precise de "um mes aberto" nasce com prazo de
 * validade de algumas semanas e cobra manutencao de quem nao quebrou nada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM ARQUIVO SO, E NAO A MESMA FUNCAO COLADA EM SEIS
 * ---------------------------------------------------------------------------
 * O cabecalho do lib/diagnostico/ledgerHealth.ts registra que este codebase ja
 * pagou caro por COPIAS DIVERGENTES de logica de regime. Seis copias desta
 * resolucao seriam seis chances de divergir.
 * ========================================================================== */

const { detectMonthRegime } = require("../lib/cmsMonthly.ts");

/**
 * A competencia ABERTA mais ANTIGA a partir de hoje, varrendo para tras e para
 * frente a partir do mes corrente.
 *
 * POR QUE A MAIS ANTIGA ABERTA, e nao simplesmente "o mes corrente": o mes
 * corrente e quase sempre aberto, mas nos primeiros dias de um mes o anterior
 * ainda nao fechou, e e ELE que carrega producao de verdade. Um portao que
 * precisa de "mes aberto com dado dentro" quer esse, nao um mes de 3 dias.
 *
 * REPROVA EM VEZ DE ADIVINHAR: se nao houver NENHUM mes aberto na janela, lanca.
 * Devolver um mes fechado disfarcado de aberto faria o portao passar medindo a
 * coisa errada — exatamente o modo de falha que esta biblioteca existe para
 * matar.
 *
 * @param {object} sb cliente supabase
 * @param {object} [opts]
 * @param {Date}   [opts.hoje]        ancora do calendario (default: agora)
 * @param {number} [opts.paraTras=3]  quantos meses olhar para tras
 * @returns {Promise<{year:number, month:number, comp:string, regime:string}>}
 */
async function resolverCompetenciaAberta(sb, opts = {}) {
  const hoje = opts.hoje instanceof Date ? opts.hoje : new Date();
  const paraTras = Number.isInteger(opts.paraTras) ? opts.paraTras : 3;

  const y0 = hoje.getUTCFullYear();
  const m0 = hoje.getUTCMonth() + 1;

  const candidatos = [];
  for (let d = -paraTras; d <= 1; d++) {
    const t = new Date(Date.UTC(y0, m0 - 1 + d, 1));
    candidatos.push({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 });
  }

  const vistos = [];
  for (const c of candidatos) {
    const regime = await detectMonthRegime(sb, c.year, c.month).catch(() => null);
    const comp = `${c.year}-${String(c.month).padStart(2, "0")}`;
    vistos.push(`${comp}=${regime ?? "erro"}`);
    if (regime === "open") return { ...c, comp, regime };
  }

  throw new Error(
    "_competenciaAberta: NENHUMA competencia aberta na janela varrida " +
      `(${vistos.join(", ")}). O portao que chamou precisa de um mes ABERTO para ` +
      "provar o lado 'nao barra' / 'no-op' do regime; sem ele a assercao seria " +
      "vacua, entao isto REPROVA em vez de devolver um mes fechado.",
  );
}

/** Competencia FECHADA (cms ou fechamento) mais recente — o contraponto. */
async function resolverCompetenciaFechada(sb, opts = {}) {
  const hoje = opts.hoje instanceof Date ? opts.hoje : new Date();
  const y0 = hoje.getUTCFullYear();
  const m0 = hoje.getUTCMonth() + 1;
  const vistos = [];
  for (let d = 0; d >= -12; d--) {
    const t = new Date(Date.UTC(y0, m0 - 1 + d, 1));
    const year = t.getUTCFullYear();
    const month = t.getUTCMonth() + 1;
    const regime = await detectMonthRegime(sb, year, month).catch(() => null);
    const comp = `${year}-${String(month).padStart(2, "0")}`;
    vistos.push(`${comp}=${regime ?? "erro"}`);
    if (regime && regime !== "open") return { year, month, comp, regime };
  }
  throw new Error(
    `_competenciaAberta: nenhuma competencia FECHADA nos ultimos 13 meses (${vistos.join(", ")}).`,
  );
}

module.exports = { resolverCompetenciaAberta, resolverCompetenciaFechada };
