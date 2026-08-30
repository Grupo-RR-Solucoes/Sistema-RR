// ============================================================================
// Auditoria ADS/BBTS — 1A: resolveBbtsRegra — o RESOLVER da régua BBTS.
//
// LIB GENÉRICA, de propósito. A auditoria (1C) é a PRIMEIRA consumidora, não a
// dona: recebíveis e caixa da ADS vão chamar exatamente estas funções depois. Por
// isso o resolver NÃO mora dentro da auditoria — mora aqui, e não sabe nada sobre
// conferência/divergência.
//
// Espelho de lib/trp/resolveTrpRegraDb.ts:
//   1. resolve a competência-alvo (explícita ou pela data do contrato, via janela
//      holiday-aware — competenciaDaData de lib/trp/vigencia.ts, REUSADO: não
//      existe segunda lógica de vigência no sistema);
//   2. busca a versão ATIVA daquela competência em bbts_rule_versions;
//   3. FALLBACK EM CASCATA, nas duas direções (ver abaixo);
//   4. a vigência devolvida é SEMPRE a da competência-ALVO, nunca a da fornecedora.
//
// FALLBACK PARA TRÁS (diferença vs a TRP — deliberada):
//   Na TRP, o fallback só olha para competências ANTERIORES: se julho não subiu,
//   usa junho. Aqui a régua NASCEU em julho/2026 (é a primeira tabela BBTS que
//   temos em PDF) e precisamos auditar JUNHO — que é ANTERIOR a qualquer régua
//   gravada. Então, quando não há competência anterior com versão ativa, o
//   resolver aceita a MAIS ANTIGA POSTERIOR, marcando direcao='posterior'.
//   Isso está sustentado numa premissa de negócio (a tabela BBTS não mudou de
//   junho para julho — decisão do sócio) e é SEMPRE sinalizado: isFallback=true +
//   direcao, para a tela poder mostrar "junho auditado com a tabela de julho".
//   Se um dia a tabela de junho for subida, ela passa a ganhar por ser exata.
//
// LOOKUP + FAIXA DA ADS:
//   lookupPctBbts recebe a faixa como PARÂMETRO, com default FAIXA_ADS ("Faixa 4")
//   — o acordo comercial (o Grupo RR/ADS recebe sempre na Faixa 4, em todos os
//   convênios) vive AQUI, não no dado. A régua guarda as 5 faixas fiéis à tabela.
//   Trocar de faixa (ou auditar "e se fosse Faixa 1?") é passar outro parâmetro.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolverGrupoBbts, type OperacaoBbts } from "@/lib/bbts/grupoBbts";
import { AVT_TETO, FAIXA_ADS, type CelulaBbts, type RegraBbts } from "@/lib/bbts/regraBbts";
import {
  competenciaDaData,
  competenciaFirstDay,
  competenciaKey,
  vigenciaDaCompetencia,
} from "@/lib/trp/vigencia";

/** Erro de INFRA ao ler bbts_rule_versions (RLS/conexão). PROPAGA — nunca vira
 *  "sem régua" nem cai em fallback: fallback é só para "não subiram a tabela". */
export class BbtsInfraError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BbtsInfraError";
  }
}

export interface ResolveBbtsParams {
  /** "YYYY-MM" (ou "YYYY-MM-DD"). Tem precedência sobre contractDate. */
  competencia?: string;
  /** "YYYY-MM-DD" — mapeada para competência pela janela holiday-aware. */
  contractDate?: string;
}

export interface BbtsRegraResolved {
  regra: RegraBbts;
  competenciaAlvo: string;
  /** competência cuja versão foi de fato usada (== alvo, salvo fallback). */
  competenciaFornecedora: string;
  isFallback: boolean;
  /** de onde veio a régua quando é fallback (null quando exata). */
  direcao: "anterior" | "posterior" | null;
  /** vigência holiday-aware da competência-ALVO. */
  validFrom: string;
  validUntil: string;
  versionId: string;
  versionNo: number;
}

interface RuleRow {
  id: string;
  competencia: string;
  version_no: number;
  regra_json: RegraBbts;
}

const SELECT_COLS = "id, competencia, version_no, regra_json";

/** Client: bbts_rule_versions é RLS default-deny — só service_role lê. O parâmetro
 *  existe para testes/ferramentas (stub/gate); produção usa o default. */
function resolveClient(client?: SupabaseClient): SupabaseClient {
  return client ?? (getSupabaseAdmin() as unknown as SupabaseClient);
}

function competenciaAlvoDe(params: ResolveBbtsParams): string {
  if (params.competencia) return competenciaKey(params.competencia);
  if (params.contractDate) return competenciaDaData(params.contractDate);
  throw new Error("resolveBbtsRegraDb: informe competencia OU contractDate");
}

/**
 * Resolve a régua BBTS da competência. Retorna null só quando NÃO EXISTE nenhuma
 * versão ativa em lugar nenhum (banco vazio) — aí o chamador decide o que fazer.
 */
export async function resolveBbtsRegraDb(
  params: ResolveBbtsParams,
  client?: SupabaseClient,
): Promise<BbtsRegraResolved | null> {
  const competenciaAlvo = competenciaAlvoDe(params);
  const { validFrom, validUntil } = vigenciaDaCompetencia(competenciaAlvo);
  const firstDayAlvo = competenciaFirstDay(competenciaAlvo);
  const sb = resolveClient(client);

  const monta = (row: RuleRow, direcao: "anterior" | "posterior" | null): BbtsRegraResolved => ({
    regra: row.regra_json,
    competenciaAlvo,
    competenciaFornecedora: competenciaKey(String(row.competencia)),
    isFallback: direcao !== null,
    direcao,
    validFrom,
    validUntil,
    versionId: row.id,
    versionNo: row.version_no,
  });

  // 1) versão ATIVA da competência-alvo (exata).
  const exact = await sb
    .from("bbts_rule_versions")
    .select(SELECT_COLS)
    .eq("competencia", firstDayAlvo)
    .eq("is_active", true)
    .maybeSingle();
  if (exact.error) {
    throw new BbtsInfraError(
      `resolveBbtsRegraDb: erro ao buscar competencia ${competenciaAlvo}: ${exact.error.message}`,
      exact.error,
    );
  }
  if (exact.data) return monta(exact.data as RuleRow, null);

  // 2) fallback PARA TRÁS no tempo: competência anterior ativa mais recente.
  const prev = await sb
    .from("bbts_rule_versions")
    .select(SELECT_COLS)
    .lt("competencia", firstDayAlvo)
    .eq("is_active", true)
    .order("competencia", { ascending: false })
    .limit(1);
  if (prev.error) {
    throw new BbtsInfraError(
      `resolveBbtsRegraDb: erro no fallback anterior de ${competenciaAlvo}: ${prev.error.message}`,
      prev.error,
    );
  }
  const prevRow = prev.data && (prev.data[0] as RuleRow | undefined);
  if (prevRow) return monta(prevRow, "anterior");

  // 3) fallback PARA FRENTE: a régua mais ANTIGA posterior ao alvo. É o caso de
  //    junho/2026 (a primeira tabela em PDF é a de julho e a BBTS não mudou a
  //    tabela entre as duas competências).
  const next = await sb
    .from("bbts_rule_versions")
    .select(SELECT_COLS)
    .gt("competencia", firstDayAlvo)
    .eq("is_active", true)
    .order("competencia", { ascending: true })
    .limit(1);
  if (next.error) {
    throw new BbtsInfraError(
      `resolveBbtsRegraDb: erro no fallback posterior de ${competenciaAlvo}: ${next.error.message}`,
      next.error,
    );
  }
  const nextRow = next.data && (next.data[0] as RuleRow | undefined);
  if (nextRow) return monta(nextRow, "posterior");

  // Nenhuma régua BBTS em lugar nenhum.
  return null;
}

// ---------------------------------------------------------------------------
// Preloader (mesmo padrão da TRP): resolve N competências async, lookup síncrono.
// ---------------------------------------------------------------------------
export interface BbtsRegraPreloader {
  preload(competencias: string[]): Promise<void>;
  getResolvedSync(competencia: string): BbtsRegraResolved | null;
  getRegraSync(competencia: string): RegraBbts | null;
  hasLoaded(competencia: string): boolean;
}

export function createBbtsRegraPreloader(client?: SupabaseClient): BbtsRegraPreloader {
  const sb = resolveClient(client);
  const cache = new Map<string, BbtsRegraResolved | null>();
  return {
    async preload(competencias: string[]): Promise<void> {
      const alvos = Array.from(new Set(competencias.map((c) => competenciaKey(c))));
      const pendentes = alvos.filter((c) => !cache.has(c));
      await Promise.all(
        pendentes.map(async (comp) => {
          cache.set(comp, await resolveBbtsRegraDb({ competencia: comp }, sb));
        }),
      );
    },
    getResolvedSync: (c) => cache.get(competenciaKey(c)) ?? null,
    getRegraSync: (c) => cache.get(competenciaKey(c))?.regra ?? null,
    hasLoaded: (c) => cache.has(competenciaKey(c)),
  };
}

// ---------------------------------------------------------------------------
// LOOKUP: operação -> percentual devido pela tabela BBTS.
// ---------------------------------------------------------------------------

export interface LookupBbtsOptions {
  /** Faixa de produção usada. Default: FAIXA_ADS ("Faixa 4") — o acordo comercial. */
  faixa?: string;
}

export interface PctBbtsResolvido {
  grupo: string;
  tableKey: string | null;
  celulaIndex: number;
  celula: CelulaBbts;
  faixa: string;
  /** percentual base da célula. */
  pctBase: number;
  /** bonificação (0 quando o grupo não é bonificado). */
  pctAdicional: number;
  /** o que a tabela manda pagar no total (base + adicional — o PDF diz que o
   *  "total do pagamento é a soma dos percentuais"). */
  pctTabela: number;
  /** parte à vista: min(pctTabela, teto do AVT — 6% pela tabela). */
  pctAvista: number;
  /** excedente do teto: a BBTS paga a prazo (PRT), diluído no prazo da operação. */
  pctDiferido: number;
  /** pctDiferido / prazo — a parcela mensal do PRT (pág. 8 do PDF). */
  pctDiferidoMensal: number;
  motivos: string[];
}

/** Célula do grupo que casa com (juros, prazo). Limite null = aberto. */
function acharCelula(celulas: CelulaBbts[], juros: number, prazo: number): number {
  return celulas.findIndex((c) => {
    const txOk =
      (c.tx_min == null || juros >= c.tx_min - 1e-9) && (c.tx_max == null || juros <= c.tx_max + 1e-9);
    const przOk =
      (c.prazo_min == null || prazo >= c.prazo_min) && (c.prazo_max == null || prazo <= c.prazo_max);
    return txOk && przOk;
  });
}

/**
 * O percentual que a tabela BBTS manda pagar por uma operação da ADS.
 *
 * Retorna null quando a operação NÃO tem célula na tabela (produto/juros/prazo
 * fora da matriz) — e o motivo. Isso NUNCA deve virar "subpagamento": é o
 * equivalente ao NAO_CONFERIVEL da conferência do RR (a 1C decide o rótulo).
 */
export function lookupPctBbts(
  regra: RegraBbts,
  op: OperacaoBbts,
  opts: LookupBbtsOptions = {},
): { ok: PctBbtsResolvido } | { ok: null; motivo: string } {
  const faixa = opts.faixa ?? FAIXA_ADS;
  const roteado = resolverGrupoBbts(op, regra);
  if (!roteado.grupo) {
    return { ok: null, motivo: roteado.motivos.join(" | ") || "grupo nao resolvido" };
  }
  const grupo = regra.grupos?.[roteado.grupo];
  if (!grupo) {
    // RECUSA POR CONTRATO, com o motivo NOMEADO. Desde 30/08/2026 a regua pode
    // ser gravada sem um grupo que a BBTS removeu do documento (ver
    // RegraBbts.grupos_ausentes) — e ai a operacao que cai nesse grupo NAO e
    // calculada com fallback nem zerada: ela para aqui, e quem le sabe POR QUE.
    // A distincao importa: "a BBTS tirou o grupo da tabela" e um fato do
    // documento; "grupo ausente na regua" pode ser defeito de leitura. Antes
    // desta separacao os dois davam a MESMA mensagem.
    const declarado = Array.isArray(regra.grupos_ausentes) && regra.grupos_ausentes.includes(roteado.grupo);
    return {
      ok: null,
      motivo: declarado
        ? `grupo ${roteado.grupo} REMOVIDO da tabela BBTS desta competencia ` +
          `(ausencia declarada na regua) — contrato nao conferivel, nunca calculado por fallback`
        : `grupo ${roteado.grupo} ausente na regua da competencia`,
    };
  }

  const idx = acharCelula(grupo.celulas, op.taxa_juros, op.prazo);
  if (idx < 0) {
    return {
      ok: null,
      motivo: `fora da tabela: ${roteado.grupo} nao tem celula para juros ${(op.taxa_juros * 100).toFixed(2)}% e prazo ${op.prazo}`,
    };
  }
  const celula = grupo.celulas[idx];

  // BB Energia tem coluna única: se a faixa pedida não existe, usa a única que há.
  const pct = celula.faixas[faixa] ?? Object.values(celula.faixas)[0];
  if (!pct) {
    return { ok: null, motivo: `celula sem a faixa '${faixa}'` };
  }

  const teto = regra._meta?.modelo_pagamento?.avt_teto ?? AVT_TETO;
  const pctBase = pct.base;
  const pctAdicional = pct.adicional ?? 0;
  const pctTabela = pctBase + pctAdicional;
  const pctAvista = Math.min(pctTabela, teto);
  const pctDiferido = Math.max(0, pctTabela - pctAvista);

  return {
    ok: {
      grupo: roteado.grupo,
      tableKey: roteado.tableKey,
      celulaIndex: idx,
      celula,
      faixa: celula.faixas[faixa] ? faixa : Object.keys(celula.faixas)[0],
      pctBase,
      pctAdicional,
      pctTabela,
      pctAvista,
      pctDiferido,
      pctDiferidoMensal: op.prazo > 0 ? pctDiferido / op.prazo : 0,
      motivos: roteado.motivos,
    },
  };
}
