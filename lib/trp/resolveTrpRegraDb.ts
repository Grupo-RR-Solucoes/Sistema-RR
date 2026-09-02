/**
 * lib/trp/resolveTrpRegraDb.ts — resolvedor da regra de crédito da TRP a partir
 * do BANCO (trp_rule_versions), atrás da flag TRP_SOURCE (ver trpSource.ts).
 *
 * O QUE FAZ:
 *   1. Resolve a competência-alvo (por competência explícita OU por contract_date
 *      via janela de vigência holiday-aware — competenciaDaData).
 *   2. Busca as versões ATIVAS daquela competência (is_active = true) e escolhe a
 *      FATIA cuja vigência própria [valid_from .. valid_until] contém a data do
 *      contrato. Sem data, escolhe a de MAIOR valid_from (a que vale ao fim da
 *      janela).
 *   3. FALLBACK em cascata: se a competência-alvo não tem versão ativa nenhuma,
 *      usa a competência ANTERIOR mais recente que tenha (isFallback = true). A
 *      vigência de COMPETÊNCIA retornada é SEMPRE a da competência-ALVO.
 *   4. valid_from/valid_until DE COMPETÊNCIA vêm do util (lib/trp/vigencia.ts),
 *      NUNCA cravados.
 *
 * VIGÊNCIA INTRA-MÊS (31/08/2026 — a TRP39 valendo a partir de 05/08).
 * ------------------------------------------------------------------
 * Até aqui valia a identidade "1 competência = 1 régua ativa", imposta pelo
 * índice parcial uq_trp_rule_versions_active. A TRP39 quebrou isso: a data de
 * início dela (05/08/2026) só existe no e-mail da Promotiva, nunca vai estar no
 * PDF, e a régua padrão (vigenciaDaCompetencia) não tem como derivá-la. Agosto
 * passa a ter DUAS réguas ativas — TRP38 de 31/07 a 04/08 e TRP39 de 05/08 a
 * 28/08 (decisão 5a do Diego: as duas fatias EXPLÍCITAS, nada por cascata).
 *
 * Este arquivo é a FASE 1: tolera N ativas e escolhe por data. Enquanto o índice
 * antigo continuar no banco (a troca é a Fase 2), toda competência tem no máximo
 * UMA ativa, cuja vigência própria é a janela inteira da competência — logo
 * qualquer data cai nela e o resultado é IDÊNTICO ao de antes. Isso não é
 * promessa: é consequência de o intervalo ser a janela, e o portão
 * gate_trp_vigencia_intra_mes.cjs mede os dois lados no mesmo run.
 *
 * ORDEM DE DEPLOY (não negociável): código primeiro, migration depois. A busca
 * exata usava .maybeSingle(), que com 2 linhas ativas devolve ERRO — convertido
 * em TrpInfraError, que PROPAGA de propósito. Migration antes do código derruba
 * /promotores, /recebiveis e o motor no primeiro upload partido.
 *
 * regra_json é o RegraMes canônico (mesmo shape do JSON estático) — por isso o
 * consumidor usa lookupPctInRegra sem adaptação.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { RegraMes } from "@/lib/regrasData";
import {
  competenciaDaData,
  competenciaFirstDay,
  competenciaKey,
  vigenciaDaCompetencia,
} from "@/lib/trp/vigencia";
import { limiteEfetivoDaFatia } from "@/lib/trp/vigenciaRegua";

/** Entrada do resolvedor: competência explícita OU data do contrato. */
export interface ResolveTrpRegraDbParams {
  /** "YYYY-MM" (ou "YYYY-MM-DD"). Define a COMPETÊNCIA-alvo. */
  competencia?: string;
  /**
   * "YYYY-MM-DD". Sem `competencia`, define a competência-alvo pela janela
   * holiday-aware. COM `competencia`, é usada só para escolher a FATIA dentro da
   * competência (vigência intra-mês) — a competência-alvo continua sendo a
   * explícita.
   */
  contractDate?: string;
}

export interface TrpRegraDbResolved {
  /** RegraMes canônico (== JSON estático) da versão ativa encontrada. */
  regra: RegraMes;
  /** Competência pedida (YYYY-MM). */
  competenciaAlvo: string;
  /** Competência cuja versão foi de fato usada (== alvo, salvo fallback). */
  competenciaFornecedora: string;
  /** true quando a regra veio de uma competência anterior (cascata). */
  isFallback: boolean;
  /**
   * Vigência holiday-aware da COMPETÊNCIA-ALVO (ISO YYYY-MM-DD). NÃO é a da
   * fatia — é a janela inteira do mês. Consumidores que buscam operações da
   * competência (ex.: scripts/trp_paridade_f5_json.cjs:165) dependem disso.
   */
  validFrom: string;
  validUntil: string;
  /**
   * Vigência PRÓPRIA da linha escolhida (ISO YYYY-MM-DD). Igual a
   * validFrom/validUntil quando a competência tem uma régua só; recortada quando
   * a competência está PARTIDA. No fallback em cascata, é a janela do ALVO (a
   * régua da competência anterior cobre o alvo inteiro).
   */
  rowValidFrom: string;
  rowValidUntil: string;
  /** Quantas réguas ATIVAS a competência-alvo tem (0 quando caiu na cascata). */
  fatiasAtivas: number;
  /**
   * true quando a competência-alvo tem 2+ réguas ativas — a vigência está
   * PARTIDA. É o que o carimbo do PMR consome (decisão (b) do Diego, 31/08):
   * competência partida grava trp_version_id = NULL + trp_multi_versao = true,
   * porque carimbar UMA versão seria afirmação falsa que CONFERE.
   */
  competenciaPartida: boolean;
  /** id/version_no da linha trp_rule_versions usada. */
  versionId: string;
  versionNo: number;
}

/** Todas as fatias ativas de uma competência, já resolvidas. */
export interface TrpRegraDbCompetencia {
  competenciaAlvo: string;
  /** Janela holiday-aware da competência. */
  validFrom: string;
  validUntil: string;
  /**
   * Fatias em ordem DECRESCENTE de rowValidFrom (a mais recente primeiro). Com a
   * competência sem régua própria, contém no máximo 1 item: o fallback da
   * cascata, cobrindo a janela inteira. Vazio = nem alvo nem anterior têm régua.
   */
  fatias: TrpRegraDbResolved[];
  /** true quando a competência-alvo tem 2+ réguas ATIVAS próprias. */
  partida: boolean;
}

/** Colunas lidas de trp_rule_versions. */
interface RuleVersionRow {
  id: string;
  competencia: string; // "YYYY-MM-DD" (1º dia do mês)
  version_no: number;
  valid_from: string; // "YYYY-MM-DD" — vigência PRÓPRIA da linha
  valid_until: string;
  regra_json: RegraMes;
}

const SELECT_COLS = "id, competencia, version_no, valid_from, valid_until, regra_json";

/**
 * Erro de INFRAESTRUTURA ao ler trp_rule_versions (RLS/permission denied,
 * conexão, query malformada). É DISTINTO de "competência sem regra": este
 * PROPAGA (deixa os Recebíveis falharem visível), NUNCA vira null nem cai no
 * fallback. O fallback em cascata é só para "não subiram a TRP deste mês" —
 * jamais para "não consegui ler o banco".
 */
export class TrpInfraError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TrpInfraError";
  }
}

/**
 * BURACO de vigência: a competência TEM réguas ativas, mas NENHUMA cobre a data
 * do contrato (ex.: só a fatia de 05/08 em diante existe e o contrato é de
 * 03/08). É defeito de DADO, não de leitura — e a única resposta honesta é
 * falhar alto: escolher "a fatia mais próxima" pagaria pela régua errada em
 * silêncio, que é exatamente o defeito que esta frente conserta.
 *
 * INALCANÇÁVEL enquanto o índice uq_trp_rule_versions_active estiver no banco
 * (1 ativa por competência, cobrindo a janela inteira). Depois da Fase 2, o RPC
 * de commit TRUNCA a fatia anterior em vez de deixar buraco — só SQL na mão
 * chega aqui.
 */
export class TrpVigenciaGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrpVigenciaGapError";
  }
}

/**
 * Client para ler trp_rule_versions. A tabela é RLS default-deny (F1): SÓ o
 * service_role (getSupabaseAdmin) lê. NUNCA usar o client anon do request —
 * ele é negado pelo RLS (foi a causa do "permission denied" no flip). Default =
 * service_role. O parâmetro `client` existe só para testes/ferramentas (ex.: o
 * gate F3 passa seu próprio service_role, os smokes passam stub) — produção
 * NÃO deve passar o client do request.
 */
function resolveClient(client?: SupabaseClient): SupabaseClient {
  return client ?? (getSupabaseAdmin() as unknown as SupabaseClient);
}

/**
 * Carrega TODAS as fatias ativas de uma competência (ou o fallback em cascata,
 * quando ela não tem nenhuma). É a primitiva async; a escolha por data é
 * SÍNCRONA (escolherFatia), para o motor continuar síncrono.
 */
export async function resolveTrpRegraDbCompetencia(
  competencia: string,
  client?: SupabaseClient,
): Promise<TrpRegraDbCompetencia> {
  const competenciaAlvo = competenciaKey(competencia);
  const { validFrom, validUntil } = vigenciaDaCompetencia(competenciaAlvo);
  const firstDayAlvo = competenciaFirstDay(competenciaAlvo);
  const sb = resolveClient(client);

  // 1) Versões ATIVAS da competência-alvo. NÃO usa .maybeSingle(): a competência
  //    pode estar PARTIDA (2+ fatias). Ordem decrescente de valid_from — a fatia
  //    mais recente primeiro, que é a escolhida quando não há data.
  const exact = await sb
    .from("trp_rule_versions")
    .select(SELECT_COLS)
    .eq("competencia", firstDayAlvo)
    .eq("is_active", true)
    .order("valid_from", { ascending: false });
  if (exact.error) {
    // ERRO DE INFRA (ex.: permission denied) -> PROPAGA, não vira fallback.
    throw new TrpInfraError(
      `resolveTrpRegraDb: erro ao buscar competência ${competenciaAlvo}: ${exact.error.message}`,
      exact.error,
    );
  }

  const rows = (exact.data ?? []) as RuleVersionRow[];
  if (rows.length > 0) {
    const partida = rows.length > 1;
    return {
      competenciaAlvo,
      validFrom,
      validUntil,
      partida,
      fatias: rows.map((row) => ({
        regra: row.regra_json,
        competenciaAlvo,
        competenciaFornecedora: competenciaAlvo,
        isFallback: false,
        validFrom,
        validUntil,
        rowValidFrom: String(row.valid_from).slice(0, 10),
        rowValidUntil: String(row.valid_until).slice(0, 10),
        fatiasAtivas: rows.length,
        competenciaPartida: partida,
        versionId: row.id,
        versionNo: row.version_no,
      })),
    };
  }

  // 2) FALLBACK em cascata: competência anterior ativa mais recente.
  //    TIE-BREAK POR valid_from (caminho de DINHEIRO): com a competência anterior
  //    PARTIDA, o .limit(1) sem esse desempate pegaria uma fatia ARBITRÁRIA. A que
  //    vale é a ÚLTIMA (maior valid_from) — a que estava em vigor quando aquele
  //    mês terminou.
  const prev = await sb
    .from("trp_rule_versions")
    .select(SELECT_COLS)
    .lt("competencia", firstDayAlvo)
    .eq("is_active", true)
    .order("competencia", { ascending: false })
    .order("valid_from", { ascending: false })
    .limit(1);
  if (prev.error) {
    // ERRO DE INFRA na busca do fallback -> PROPAGA (não engole como "sem regra").
    throw new TrpInfraError(
      `resolveTrpRegraDb: erro no fallback de ${competenciaAlvo}: ${prev.error.message}`,
      prev.error,
    );
  }
  // AUSÊNCIA REAL: query OK, mas nenhuma competência (nem alvo nem anterior) tem
  // versão ativa. Aí sim devolve lista vazia (o chamador mantém o comportamento).
  const fallbackRow = (prev.data && prev.data[0]) as RuleVersionRow | undefined;
  if (!fallbackRow) {
    return { competenciaAlvo, validFrom, validUntil, partida: false, fatias: [] };
  }

  return {
    competenciaAlvo,
    validFrom,
    validUntil,
    partida: false,
    fatias: [
      {
        regra: fallbackRow.regra_json,
        competenciaAlvo,
        competenciaFornecedora: competenciaKey(fallbackRow.competencia),
        isFallback: true,
        validFrom,
        validUntil,
        // a régua da competência anterior cobre a janela do ALVO inteira.
        rowValidFrom: validFrom,
        rowValidUntil: validUntil,
        fatiasAtivas: 0,
        competenciaPartida: false,
        versionId: fallbackRow.id,
        versionNo: fallbackRow.version_no,
      },
    ],
  };
}

/**
 * Escolha SÍNCRONA da fatia pela data do contrato.
 *
 *   - sem data  -> a de MAIOR rowValidFrom (a que vale ao fim da janela). Com uma
 *                  fatia só, é ela — retrocompatível por construção.
 *   - com data  -> a fatia cujo [rowValidFrom .. rowValidUntil] contém a data.
 *   - com data, competência com fatias, nenhuma cobrindo -> TrpVigenciaGapError.
 *   - sem fatia nenhuma -> null (competência sem régua nem cascata).
 *
 * `fatias` chega em ordem decrescente de rowValidFrom, então o primeiro match é
 * também o mais recente.
 */
export function escolherFatia(
  comp: TrpRegraDbCompetencia,
  contractDate?: string | null,
): TrpRegraDbResolved | null {
  if (comp.fatias.length === 0) return null;
  const data = contractDate ? String(contractDate).slice(0, 10) : null;
  if (!data) return comp.fatias[0];

  // COBERTURA DA CAUDA (02/09/2026). As janelas de competência NÃO particionam o
  // calendário: entre o penúltimo dia útil de um mês (fim da janela de M) e o
  // último (início da janela de M+1) sobram dias ÓRFÃOS — 29-30/08/2026,
  // 28-29/11/2026, 29-30/05/2027, e 25 meses em 191 medidos. Um contract_date
  // ali não era coberto por fatia nenhuma e o resolvedor lançava, derrubando
  // /promotores e /recebiveis.
  //
  // A ÚLTIMA fatia (a de maior rowValidFrom) cobre até o dia anterior ao
  // valid_from da competência seguinte. A régua e o porquê da separação em
  // relação à janela de PRODUÇÃO estão em lib/trp/vigenciaRegua.ts — leia lá
  // antes de unificar as duas.
  //
  // A ÚLTIMA é CALCULADA, não `fatias[0]`. O `.order()` da query diz o que eu
  // QUERO; se ele sumir ou o PostgREST devolver de outro jeito, `fatias[0]` vira
  // arbitrária e a extensão cairia numa fatia do MEIO — um contrato de 04/08
  // escorregaria da TRP38 para a TRP39. Isso é dinheiro. (Mesma disciplina de
  // commitVersion.ts; o portão entrega o fixture FORA DE ORDEM de propósito.)
  const ultima = comp.fatias.reduce((a, b) => (b.rowValidFrom > a.rowValidFrom ? b : a));
  const cobre = (f: TrpRegraDbResolved) =>
    data >= f.rowValidFrom &&
    data <= limiteEfetivoDaFatia(comp.competenciaAlvo, f.rowValidUntil, f === ultima);

  const hit = comp.fatias.find(cobre);
  if (hit) return hit;

  throw new TrpVigenciaGapError(
    `resolveTrpRegraDb: BURACO de vigência em ${comp.competenciaAlvo} — a data ${data} ` +
      `não é coberta por nenhuma das ${comp.fatias.length} régua(s) ativa(s) ` +
      `[${comp.fatias.map((f) => `${f.rowValidFrom}..${f.rowValidUntil}`).join(", ")}]. ` +
      `Não escolho "a mais próxima": isso pagaria pela régua errada em silêncio.`,
  );
}

/**
 * Resolve a regra da TRP a partir do banco. Retorna null quando NEM a
 * competência-alvo NEM qualquer competência anterior têm versão ativa.
 *
 * @param params  { competencia } define a competência; { contractDate } define a
 *   competência quando `competencia` falta, e SEMPRE escolhe a fatia intra-mês.
 * @param client  SupabaseClient opcional (default: service-role admin).
 */
export async function resolveTrpRegraDb(
  params: ResolveTrpRegraDbParams,
  client?: SupabaseClient
): Promise<TrpRegraDbResolved | null> {
  const competenciaAlvo = resolveCompetenciaAlvo(params);
  const comp = await resolveTrpRegraDbCompetencia(competenciaAlvo, client);
  return escolherFatia(comp, params.contractDate ?? null);
}

function resolveCompetenciaAlvo(params: ResolveTrpRegraDbParams): string {
  if (params.competencia) return competenciaKey(params.competencia);
  if (params.contractDate) return competenciaDaData(params.contractDate);
  throw new Error("resolveTrpRegraDb: informe competencia OU contractDate");
}

// ---------------------------------------------------------------------------
// Preload por request — lookup SÍNCRONO sobre versões carregadas 1x (async).
// ---------------------------------------------------------------------------
//
// getRegra (JSON) é síncrono; o banco é async. Este preloader resolve as
// competências necessárias UMA vez (async) para um Map competência→fatias, e
// depois o consumidor faz o lookup SÍNCRONO — agora podendo passar a
// contract_date, que escolhe a fatia dentro da competência.

export interface TrpRegraDbPreloader {
  /** Resolve e memoiza as competências dadas (YYYY-MM). Idempotente. */
  preload(competencias: string[]): Promise<void>;
  /**
   * Lookup SÍNCRONO do resolvido (null se não pré-carregado ou sem versão).
   * `contractDate` escolhe a FATIA quando a competência está partida; sem ela,
   * vale a fatia de maior valid_from.
   */
  getResolvedSync(competencia: string, contractDate?: string | null): TrpRegraDbResolved | null;
  /** Lookup SÍNCRONO só da RegraMes (null se não pré-carregado ou sem versão). */
  getRegraSync(competencia: string, contractDate?: string | null): RegraMes | null;
  /** true se a competência já passou por preload (mesmo que sem versão). */
  hasLoaded(competencia: string): boolean;
  /**
   * Fatias ativas já carregadas da competência (null se não pré-carregada). É o
   * que o carimbo do PMR usa para decidir NULL + trp_multi_versao quando a
   * competência está PARTIDA (decisão (b), Fase 3).
   */
  getCompetenciaSync(competencia: string): TrpRegraDbCompetencia | null;
}

export function createTrpRegraDbPreloader(client?: SupabaseClient): TrpRegraDbPreloader {
  const sb = resolveClient(client);
  const cache = new Map<string, TrpRegraDbCompetencia>();

  return {
    async preload(competencias: string[]): Promise<void> {
      const alvos = Array.from(new Set(competencias.map((c) => competenciaKey(c))));
      const pendentes = alvos.filter((c) => !cache.has(c));
      await Promise.all(
        pendentes.map(async (comp) => {
          const resolved = await resolveTrpRegraDbCompetencia(comp, sb);
          cache.set(comp, resolved);
        })
      );
    },
    getResolvedSync(competencia: string, contractDate?: string | null): TrpRegraDbResolved | null {
      const comp = cache.get(competenciaKey(competencia));
      return comp ? escolherFatia(comp, contractDate ?? null) : null;
    },
    getRegraSync(competencia: string, contractDate?: string | null): RegraMes | null {
      const comp = cache.get(competenciaKey(competencia));
      return comp ? escolherFatia(comp, contractDate ?? null)?.regra ?? null : null;
    },
    hasLoaded(competencia: string): boolean {
      return cache.has(competenciaKey(competencia));
    },
    getCompetenciaSync(competencia: string): TrpRegraDbCompetencia | null {
      return cache.get(competenciaKey(competencia)) ?? null;
    },
  };
}
