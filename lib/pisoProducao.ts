import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// PISO DE PRODUCAO PARA O REPASSE — o LEITOR da regua versionada.
//
// REGRA (decisao Diego): abaixo de um PISO de producao liquida CONSOLIDADA da
// pessoa na competencia, o REPASSE e ZERO — zera credito E seguro. A comissao da
// EMPRESA NAO muda: a RR recebe da Promotiva pela producao, independente de
// repassar. Piso e regra de REPASSE, nao de receita.
//
// ESTE MODULO NAO ESTA LIGADO A NADA. Nenhum consolidador, orquestrador ou rota
// o importa hoje — de proposito. Ele existe para ser revisado ANTES de morder
// qualquer numero. Quem ligar precisa fazer as tres coisas da secao COMO LIGAR.
//
// ONDE O PISO VAI SER APLICADO — lib/bbtsOrchestrator.ts, entre :216 e :218.
// E o UNICO ponto do sistema onde a producao consolidada RR+ADS existe para as
// duas empresas ao mesmo tempo:
//     :195        prodTotal = prodRR + prodADS        -> base do DIARIO
//     :198-199    rr.get(pid).net + ads.get(pid).prod -> base do FECHAMENTO
// NAO em lib/closingMonthly.ts: la o consolidado pode simplesmente nao existir
// (as injecoes sao opcionais, :216-223) e o fallback `?? RR-puro` de :300
// zeraria quem tem producao na ADS. E NAO dentro de insuranceShareForPenetration:
// o orquestrador INJETA seguroShareByPromoter e a injecao vence o `??` de
// closingMonthly:415 / bbtsMonthly:334 — o piso escondido la seria letra morta.
//
// POR QUE FATORES E NAO UM SHARE ZERADO. montarPlanoPiso devolve fatores 0|1 por
// promotor, e nao um seguroShareByPromoter zerado. Zerar o share funcionaria (o
// `??` preserva 0 — e `??`, nao `||`), mas passaria a MENTIR no diagnostico:
// closingMonthly:465 e bbtsOrchestrator:245 exibem seguro_share como "faixa de
// penetracao". Faixa e piso sao duas regras; no mesmo campo, uma esconde a outra.
//
// COMO LIGAR (checklist para o commit seguinte, que NAO e este):
//   1. bbtsOrchestrator, bloco novo entre :216 e :218: resolver a regua, montar
//      o plano com as DUAS bases ja disponiveis, e por os fatores em `inject`.
//      O universo do piso e `pids` UNIAO os alcancados: quem tem so seguro
//      avulso nao entra em pids (:170) e passaria batido.
//   2. closingMonthly:418-419 e bbtsMonthly:336-337 multiplicam por
//      `params.fatorCreditoByPromoter?.get(pid) ?? 1` (e o de seguro). `?? 1` e
//      neutro: todo chamador existente fica byte-identico.
//   3. reconsolidarCompetencia:160 repassa fatorProdutoByPromoter para
//      applyProdutoRepasseAoPmr (produtoAssignments:318). Hoje `zera` nao inclui
//      PRODUTO, entao esse fator sai 1 e o caminho e no-op — mas o encanamento
//      precisa existir antes de a regra mudar.
//   4. assertPisoInjetado nos dois consolidadores, logo apos o `dryRun` ser
//      resolvido (closingMonthly:230, bbtsMonthly:118).
//
// CHAMADOR DIRETO QUE GRAVA — o motivo do assertPisoInjetado. Medido:
//   scripts/rodarClosingMonthly.ts:52 chama consolidateMonthlyFromClosing SEM
//   dryRun, e closingMonthly:230 (`dryRun = params.dryRun === true`) faz o
//   default ser GRAVAR. Sem a guarda, esse script reescreve o PMR sem piso
//   nenhum e desfaz o zeramento da rodada anterior, em silencio.
//
// ============================================================================
// TODO — PENDENTE DE DECISAO DO DIEGO. NAO RESOLVER SOZINHO.
//
// PAYABLE NEGATIVO. O desconto (promoter_discounts) e lancado ANTES do repasse
// ser calculado, e o payable e uma SUBTRACAO:
//     lib/promoterAnalytics.ts:1507      payable = final - discountValue   (mes fechado)
//     lib/promoterAnalytics.ts:1385-1386 idem, ramo nao-consolidado
//     lib/dre.ts:476-477                 "payable = comissao - DESCONTOS"
//     lib/financialAnalytics.ts:466-468  mesma base no Caixa
// Com o piso zerando o final, quem tiver desconto na competencia fica com
// payable NEGATIVO — a pessoa "deve" para a empresa um dinheiro que ela nunca
// recebeu. Medido nas duas alcancadas:
//     2026-06 LILIAN  3,75  (final hoje 582,09)  -> payable -3,75
//     2026-06 MARIA 166,34  (final hoje 778,51)  -> payable -166,34
//     2026-07 MARIA  24,51  (final hoje 382,49)  -> payable -24,51
// Com a vigencia 2026-08 da regua seedada isto e LATENTE (as duas nao tem
// desconto de 2026-08 em diante). Retroagindo para 2026-04 vira VIVO: -194,60.
//
// AS DUAS SAIDAS POSSIVEIS (nenhuma implementada, nenhuma recomendada aqui):
//   (a) PERDOAR NA COMPETENCIA — piso zerou => desconto da competencia nao e
//       cobrado; payable piso 0. Simples de ler, mas a empresa PERDE o
//       adiantamento/estorno que ja saiu do caixa.
//   (b) MANTER PENDENTE — o desconto sobrevive e rola para a competencia
//       seguinte (ou fica em aberto no ledger de debitos). Preserva o valor, mas
//       exige onde guardar o saldo: promoter_discounts nao tem "nao cobrado
//       ainda", e a fila de debitos tem regua propria (lib/debitRules).
// Enquanto nao houver decisao, o piso NAO deve ser ligado em competencia com
// desconto lancado para um alcancado — ou o payable sai negativo em tela.
// ============================================================================

type SupabaseLike = SupabaseClient;

/** Nome da tabela versionada. Criada por scripts/sql/2026-08-18_piso_producao_repasse.sql. */
export const PISO_TABELA = "piso_producao_rule_versions";

/**
 * Qual producao o piso julga. Os dois valores DIVERGEM — medido em 2026-04:
 * LILIAN fechamento 115.030,26 x diario valido 137.620,26 (22.590,00 de
 * diferenca). Por isso a escolha e DADO na regua, nunca constante em codigo.
 */
export type BaseCalculoPiso = "PRODUCAO_LIQUIDA_FECHAMENTO" | "PRODUCAO_VALIDA_DIARIO";

/** MENOR_QUE => o valor EXATO do piso PAGA. (LILIAN fechou 2026-05 a R$ 66,98 do piso.) */
export type ComparacaoPiso = "MENOR_QUE" | "MENOR_OU_IGUAL";

/** O que o piso zera. PRODUTO existe no dominio mas NAO esta na regua vigente. */
export type AlvoZerado = "CREDITO" | "SEGURO" | "PRODUTO";

const BASES_CONHECIDAS: readonly BaseCalculoPiso[] = [
  "PRODUCAO_LIQUIDA_FECHAMENTO",
  "PRODUCAO_VALIDA_DIARIO",
];
const COMPARACOES_CONHECIDAS: readonly ComparacaoPiso[] = ["MENOR_QUE", "MENOR_OU_IGUAL"];
const ALVOS_CONHECIDOS: readonly AlvoZerado[] = ["CREDITO", "SEGURO", "PRODUTO"];

/**
 * Chaves de escopo que o BANCO aceita (ck_piso_scope_chaves). Nem todas estao
 * implementadas aqui — ver ESCOPOS_IMPLEMENTADOS. Uma chave aceita pelo banco e
 * nao implementada LANCA; nunca e ignorada em silencio (ignorar significaria
 * "a regua nao alcanca ninguem" = pagar quem nao devia).
 */
const ESCOPOS_ACEITOS_NO_BANCO = ["promoter_ids", "profile_types", "company_ids", "estados"];
const ESCOPOS_IMPLEMENTADOS = ["promoter_ids"];

export type ReguaPiso = {
  id: string;
  competenciaInicio: string; // 'YYYY-MM-DD' (1o dia da competencia)
  competenciaFim: string | null;
  piso: number;
  comparacao: ComparacaoPiso;
  baseCalculo: BaseCalculoPiso;
  escopoProducao: "CONSOLIDADO_RR_ADS";
  zera: AlvoZerado[];
  /** Ids resolvidos do scope. Hoje sai de scope.promoter_ids. */
  promoterIds: string[];
};

/**
 * A producao consolidada de UMA pessoa, nas DUAS bases, para o piso escolher.
 * Quem preenche e o orquestrador, que tem as duas a mao (bbtsOrchestrator:195 e
 * :198-199). Passar as duas — e nao so a escolhida — mantem a decisao no DADO.
 */
export type ProducaoConsolidada = {
  promoterId: string;
  /** rr.net + ads.prod — vira production_value no PMR. */
  fechamento: number;
  /** frenteCProductionMap RR + ADS — diario valido na janela. */
  diario: number;
};

export type VeredictoPiso = {
  promoterId: string;
  baseCalculo: BaseCalculoPiso;
  producao: number;
  piso: number;
  abaixoDoPiso: boolean;
  fatorCredito: number;
  fatorSeguro: number;
  fatorProduto: number;
};

export type PlanoPiso = {
  regua: ReguaPiso | null;
  /** Mapas prontos para virar injecao. Ausencia de chave => o motor usa `?? 1`. */
  fatorCreditoByPromoter: Map<string, number>;
  fatorSeguroByPromoter: Map<string, number>;
  fatorProdutoByPromoter: Map<string, number>;
  /** Um por alcancado, com o numero que decidiu — e o que o dry-run mostra. */
  veredictos: VeredictoPiso[];
};

function competenciaLabel(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Competencia -> 1o dia do mes, o eixo de vigencia da regua. */
export function competenciaParaData(year: number, month: number): string {
  return `${competenciaLabel(year, month)}-01`;
}

/** numeric(18,2) atravessa a soma em float; arredonda antes de comparar. */
function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function ehTexto(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/**
 * Le UMA linha crua da tabela e devolve a regua tipada. PURA (sem I/O) — e o
 * nucleo testavel offline.
 *
 * LANCA em tudo que nao reconhece: base, comparacao, alvo de `zera`, chave de
 * escopo. O banco ja tem CHECKs equivalentes; esta e a segunda linha de defesa,
 * para o caso de a tabela ser criada a mao ou de um valor novo ser seedado sem
 * o codigo que o entenda. Silencio aqui = pagamento errado.
 */
export function parseReguaPiso(row: unknown): ReguaPiso {
  const r = (row ?? {}) as Record<string, unknown>;
  const id = ehTexto(r.id) ? r.id : "(sem id)";
  const onde = `${PISO_TABELA} id=${id}`;

  const regra = (r.regra ?? null) as Record<string, unknown> | null;
  if (!regra || typeof regra !== "object" || Array.isArray(regra)) {
    throw new Error(`${onde}: coluna 'regra' ausente ou nao e objeto jsonb.`);
  }

  const piso = Number(regra.piso);
  if (!Number.isFinite(piso) || piso < 0) {
    throw new Error(`${onde}: 'piso' invalido (${String(regra.piso)}). Esperado numero >= 0.`);
  }

  const comparacao = String(regra.comparacao ?? "") as ComparacaoPiso;
  if (!COMPARACOES_CONHECIDAS.includes(comparacao)) {
    throw new Error(
      `${onde}: 'comparacao' desconhecida (${String(regra.comparacao)}). ` +
        `Conhecidas: ${COMPARACOES_CONHECIDAS.join(", ")}.`
    );
  }

  const baseCalculo = String(regra.base_calculo ?? "") as BaseCalculoPiso;
  if (!BASES_CONHECIDAS.includes(baseCalculo)) {
    throw new Error(
      `${onde}: 'base_calculo' desconhecida (${String(regra.base_calculo)}). ` +
        `Conhecidas: ${BASES_CONHECIDAS.join(", ")}. Um valor novo aqui sem codigo ` +
        `que o compute seria pagamento decidido por base errada.`
    );
  }

  const escopoProducao = regra.escopo_producao === undefined || regra.escopo_producao === null
    ? "CONSOLIDADO_RR_ADS"
    : String(regra.escopo_producao);
  if (escopoProducao !== "CONSOLIDADO_RR_ADS") {
    throw new Error(
      `${onde}: 'escopo_producao' desconhecido (${escopoProducao}). ` +
        `Conhecido: CONSOLIDADO_RR_ADS.`
    );
  }

  if (!Array.isArray(regra.zera) || regra.zera.length === 0) {
    throw new Error(`${onde}: 'zera' deve ser array nao-vazio.`);
  }
  const zera: AlvoZerado[] = [];
  for (const bruto of regra.zera as unknown[]) {
    const alvo = String(bruto) as AlvoZerado;
    if (!ALVOS_CONHECIDOS.includes(alvo)) {
      throw new Error(
        `${onde}: 'zera' contem alvo desconhecido (${String(bruto)}). ` +
          `Conhecidos: ${ALVOS_CONHECIDOS.join(", ")}.`
      );
    }
    if (!zera.includes(alvo)) zera.push(alvo);
  }

  const scope = (r.scope ?? null) as Record<string, unknown> | null;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new Error(`${onde}: coluna 'scope' ausente ou nao e objeto jsonb.`);
  }
  const chaves = Object.keys(scope);
  if (chaves.length === 0) {
    throw new Error(`${onde}: 'scope' vazio. Regua sem alcance nao alcanca ninguem.`);
  }
  for (const chave of chaves) {
    if (!ESCOPOS_ACEITOS_NO_BANCO.includes(chave)) {
      throw new Error(`${onde}: 'scope' tem chave desconhecida '${chave}'.`);
    }
    if (!ESCOPOS_IMPLEMENTADOS.includes(chave)) {
      throw new Error(
        `${onde}: 'scope.${chave}' e uma forma de escopo aceita pela tabela mas ` +
          `AINDA NAO IMPLEMENTADA em lib/pisoProducao.ts. Implemente antes de ` +
          `seedar — ignorar a chave faria a regua nao alcancar ninguem, em silencio.`
      );
    }
  }

  const idsBrutos = scope.promoter_ids;
  if (!Array.isArray(idsBrutos) || idsBrutos.length === 0) {
    throw new Error(`${onde}: 'scope.promoter_ids' deve ser array nao-vazio.`);
  }
  const promoterIds: string[] = [];
  for (const bruto of idsBrutos as unknown[]) {
    if (!ehTexto(bruto)) {
      throw new Error(`${onde}: 'scope.promoter_ids' tem elemento nao-texto (${String(bruto)}).`);
    }
    const pid = bruto.trim();
    if (!promoterIds.includes(pid)) promoterIds.push(pid);
  }

  return {
    id,
    competenciaInicio: String(r.competencia_inicio ?? "").slice(0, 10),
    competenciaFim: ehTexto(r.competencia_fim) ? r.competencia_fim.slice(0, 10) : null,
    piso,
    comparacao,
    baseCalculo,
    escopoProducao: "CONSOLIDADO_RR_ADS",
    zera,
    promoterIds,
  };
}

/** Plano NEUTRO — sem regua vigente, nada e zerado. */
export function planoPisoVazio(): PlanoPiso {
  return {
    regua: null,
    fatorCreditoByPromoter: new Map<string, number>(),
    fatorSeguroByPromoter: new Map<string, number>(),
    fatorProdutoByPromoter: new Map<string, number>(),
    veredictos: [],
  };
}

/**
 * Aplica a regua sobre a producao consolidada e devolve os fatores. PURA — o
 * outro nucleo testavel offline.
 *
 * LANCA quando um ALCANCADO nao tem producao consolidada na lista. Este e o
 * fail-loud do A2: sem consolidado nao ha veredicto honesto, e "assumir zero"
 * zeraria quem tem producao na ADS. O orquestrador deve mandar uma entrada por
 * alcancado — inclusive zerada, para quem nao produziu (ai o piso zera de
 * verdade, e nao por ignorancia).
 */
export function montarPlanoPiso(
  regua: ReguaPiso | null,
  producoes: ProducaoConsolidada[]
): PlanoPiso {
  if (!regua) return planoPisoVazio();

  const porPid = new Map<string, ProducaoConsolidada>();
  for (const p of producoes) porPid.set(p.promoterId, p);

  const plano = planoPisoVazio();
  plano.regua = regua;

  const zeraCredito = regua.zera.includes("CREDITO");
  const zeraSeguro = regua.zera.includes("SEGURO");
  const zeraProduto = regua.zera.includes("PRODUTO");

  for (const pid of regua.promoterIds) {
    const entrada = porPid.get(pid);
    if (!entrada) {
      throw new Error(
        `Piso de producao: o promotor ${pid} e alcancado pela regua ` +
          `${regua.id} (vigencia ${regua.competenciaInicio}) mas NAO veio producao ` +
          `consolidada para ele. Sem o consolidado RR+ADS nao ha veredicto: ` +
          `assumir zero zeraria quem produziu na ADS. Monte o plano com uma ` +
          `entrada por alcancado (zerada, se ele nao produziu).`
      );
    }

    const producao = round2(
      regua.baseCalculo === "PRODUCAO_LIQUIDA_FECHAMENTO" ? entrada.fechamento : entrada.diario
    );
    const piso = round2(regua.piso);
    const abaixoDoPiso =
      regua.comparacao === "MENOR_QUE" ? producao < piso : producao <= piso;

    const fatorCredito = abaixoDoPiso && zeraCredito ? 0 : 1;
    const fatorSeguro = abaixoDoPiso && zeraSeguro ? 0 : 1;
    const fatorProduto = abaixoDoPiso && zeraProduto ? 0 : 1;

    plano.fatorCreditoByPromoter.set(pid, fatorCredito);
    plano.fatorSeguroByPromoter.set(pid, fatorSeguro);
    plano.fatorProdutoByPromoter.set(pid, fatorProduto);
    plano.veredictos.push({
      promoterId: pid,
      baseCalculo: regua.baseCalculo,
      producao,
      piso,
      abaixoDoPiso,
      fatorCredito,
      fatorSeguro,
      fatorProduto,
    });
  }

  return plano;
}

/**
 * Resolve a regua VIGENTE na competencia. Devolve null quando nao ha regua —
 * "sem piso" e resposta legitima.
 *
 * LANCA em erro de leitura, em vigencia ambigua e em qualquer valor que nao
 * reconheca. Tambem valida o alcance contra `promoters`: como scope.promoter_ids
 * mora em jsonb, nao ha FK, e um uuid errado alcancaria NINGUEM em silencio.
 *
 * CLIENTE: precisa ser service_role. A tabela e RLS default-deny (igual a
 * trp_rule_versions), e sob RLS o PostgREST devolve LISTA VAZIA, nao erro — ou
 * seja, um client de usuario faria esta funcao responder "sem regua" e ninguem
 * seria zerado. Medido em 2026-08-20: os 5 caminhos que gravam PMR usam
 * service_role (lib/auth/guards.ts:219-223, app/api/pmr/reconsolidar/route.ts:37,
 * app/api/import/closing/ads/route.ts:41, app/api/calculate/monthly/route.ts:638,
 * lib/monthlyClosingImport.ts:680). Um chamador novo com client de usuario e o
 * unico jeito de o piso sumir calado — se aparecer, o gate de chamadores tem de
 * vir junto.
 */
export async function resolverReguaPisoVigente(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ReguaPiso | null> {
  const { year, month } = params;
  const dia = competenciaParaData(year, month);
  const comp = competenciaLabel(year, month);

  const { data, error } = await supabase
    .from(PISO_TABELA)
    .select("id, competencia_inicio, competencia_fim, regra, scope")
    .lte("competencia_inicio", dia)
    .order("competencia_inicio", { ascending: false });

  if (error) {
    throw new Error(`${PISO_TABELA} (${comp}): ${error.message}`);
  }

  const vigentes = (data ?? []).filter((linha: Record<string, unknown>) => {
    const fim = linha.competencia_fim;
    return !ehTexto(fim) || fim.slice(0, 10) >= dia;
  });

  if (vigentes.length === 0) return null;
  if (vigentes.length > 1) {
    throw new Error(
      `${PISO_TABELA} (${comp}): ${vigentes.length} vigencias SIMULTANEAS ` +
        `(${vigentes.map((l: Record<string, unknown>) => String(l.id)).join(", ")}). ` +
        `Duas reguas abertas fazem a ORDEM da consulta decidir dinheiro. O indice ` +
        `uq_piso_uma_vigencia_aberta deveria impedir — confira a tabela.`
    );
  }

  const regua = parseReguaPiso(vigentes[0]);
  await validarAlcance(supabase, regua, comp);
  return regua;
}

/**
 * Confere que todo id do scope existe em `promoters`. Substitui o FK que o jsonb
 * nao tem. LANCA no primeiro que nao resolver — id errado no scope significaria
 * "a regua nao alcanca essa pessoa", que e exatamente o erro caro.
 */
async function validarAlcance(
  supabase: SupabaseLike,
  regua: ReguaPiso,
  comp: string
): Promise<void> {
  const encontrados = new Set<string>();
  const ids = regua.promoterIds;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const { data, error } = await supabase.from("promoters").select("id").in("id", chunk);
    if (error) {
      throw new Error(`${PISO_TABELA} (${comp}): falha ao validar o alcance — ${error.message}`);
    }
    for (const linha of (data ?? []) as Array<{ id: string }>) encontrados.add(linha.id);
  }
  const ausentes = ids.filter((pid) => !encontrados.has(pid));
  if (ausentes.length > 0) {
    throw new Error(
      `${PISO_TABELA} (${comp}): scope.promoter_ids aponta para ${ausentes.length} id(s) ` +
        `inexistente(s) em promoters: ${ausentes.join(", ")}. jsonb nao tem FK — um id ` +
        `errado alcancaria NINGUEM em silencio, e a pessoa continuaria recebendo.`
    );
  }
}

/**
 * Existe regua de piso vigente nesta competencia? Uma pergunta, zero semantica
 * vazada: quem chama nao fica sabendo o piso, a base, nem quem e alcancado.
 *
 * E o que permite os consolidadores AFIRMAREM UM CONTRATO ("se esta competencia
 * tem piso, alguem tinha que me passar o fator") sem hospedar a regra.
 */
export async function competenciaExigePiso(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<boolean> {
  const dia = competenciaParaData(params.year, params.month);
  const { data, error } = await supabase
    .from(PISO_TABELA)
    .select("competencia_fim")
    .lte("competencia_inicio", dia)
    .order("competencia_inicio", { ascending: false });

  if (error) {
    throw new Error(
      `${PISO_TABELA} (${competenciaLabel(params.year, params.month)}): ${error.message}`
    );
  }
  return (data ?? []).some((linha: Record<string, unknown>) => {
    const fim = linha.competencia_fim;
    return !ehTexto(fim) || fim.slice(0, 10) >= dia;
  });
}

/**
 * FAIL-LOUD do contrato de injecao. PURA — recebe o veredicto ja medido.
 *
 * Vai ser chamada nos dois consolidadores logo apos o dryRun ser resolvido
 * (closingMonthly:230, bbtsMonthly:118), com `temRegua` vindo de
 * competenciaExigePiso. LANCA TAMBEM EM dryRun: um dry-run que mostra o numero
 * errado e como o numero errado vira verdade.
 */
export function assertPisoInjetado(params: {
  funcao: string;
  year: number;
  month: number;
  temRegua: boolean;
  fatorInjetado: boolean;
}): void {
  const { funcao, year, month, temRegua, fatorInjetado } = params;
  if (!temRegua || fatorInjetado) return;
  throw new Error(
    `${funcao} ${competenciaLabel(year, month)}: existe REGUA DE PISO DE REPASSE ` +
      `vigente e o fator NAO foi injetado. Chame via consolidateMonthlyGroup ` +
      `(lib/bbtsOrchestrator.ts): o piso depende da producao CONSOLIDADA RR+ADS, ` +
      `que NAO existe dentro desta funcao — o fallback RR-puro zeraria quem tem ` +
      `producao na ADS.`
  );
}
