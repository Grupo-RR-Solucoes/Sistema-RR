import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// PISO DE PRODUCAO PARA O REPASSE — o LEITOR da regua versionada.
//
// REGRA (decisao Diego): abaixo de um PISO de producao liquida CONSOLIDADA da
// pessoa na competencia, o REPASSE e ZERO — zera credito E seguro. A comissao da
// EMPRESA NAO muda: a RR recebe da Promotiva pela producao, independente de
// repassar. Piso e regra de REPASSE, nao de receita.
//
// LIGADO desde 20/08/2026. Consumidores: lib/bbtsOrchestrator.ts (bloco F, o
// UNICO ponto que avalia a regra), lib/closingMonthly.ts e lib/bbtsMonthly.ts
// (recebem FATORES, nunca a regra), lib/produtoAssignments.ts (Frente C) e os
// tres leitores de payable. O piso so morde de verdade quando a tabela existir e
// tiver regua vigente — sem isso, todos os mapas saem vazios e cada motor cai no
// `?? 1`, byte-identico ao comportamento anterior.
//
// ONDE O PISO E APLICADO — lib/bbtsOrchestrator.ts, bloco F.
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
// O CAMINHO COMPLETO (os 3 alvos do piso):
//   1. bbtsOrchestrator, bloco F: resolve a regua, monta o plano com as DUAS
//      bases e poe os fatores em `inject`. O universo e `pids` UNIAO os
//      alcancados — quem tem so seguro avulso nao entra em pids e passaria
//      batido.
//   2. CREDITO e SEGURO: closingMonthly e bbtsMonthly multiplicam por
//      `params.fatorCreditoByPromoter?.get(pid) ?? 1` (idem seguro). `?? 1` e
//      neutro: todo chamador existente fica byte-identico.
//   3. FRENTE C: reconsolidarCompetencia repassa fatorProdutoByPromoter para
//      applyProdutoRepasseAoPmr. Hoje `zera` NAO inclui PRODUTO, entao o fator
//      sai 1 e este caminho e no-op — o encanamento existe para a regra poder
//      mudar sem commit.
//   4. assertPisoInjetado nos dois consolidadores, com a valvula
//      PISO_ALLOW_RR_PURE=1.
//   5. RASTRO: a linha zerada grava piso_zerou=true e discount_value=0, e e por
//      esse flag que os leitores sabem suprimir o desconto. NAO da para o leitor
//      reavaliar o piso: promoterAnalytics.ts:1421 filtra o agregado por
//      empresa, entao sob filtro de CNPJ a producao sairia PARCIAL e zeraria
//      quem esta acima do piso.
//
// CHAMADOR DIRETO QUE GRAVA — o motivo do assertPisoInjetado. Medido:
//   scripts/rodarClosingMonthly.ts:52 chama consolidateMonthlyFromClosing SEM
//   dryRun, e closingMonthly:230 (`dryRun = params.dryRun === true`) faz o
//   default ser GRAVAR. Sem a guarda, esse script reescreve o PMR sem piso
//   nenhum e desfaz o zeramento da rodada anterior, em silencio.
//
// ============================================================================
// DESCONTO NA COMPETENCIA ZERADA — decisao Diego (20/08/2026): FICA PENDENTE.
// Quando o piso zera o repasse, payable = 0 e o desconto NAO e aplicado. NAO e
// `max(0, final - desconto)`: isso mascararia: um desconto de 514,59 num mes
// zerado nao vira zero, ele NAO ACONTECE.
//
// COMO ISSO E IMPLEMENTAVEL (medido em 20/08/2026, ver REGISTRO abaixo):
// promoter_discounts nao tem contador. Sao linhas INDEPENDENTES, uma por
// competencia, criadas todas de uma vez em lib/debitsData.ts:153-179, cada uma
// ja carimbada com year/month e installment_number fixo. Nada "avanca": nenhum
// caminho da aplicacao escreve status='APPLIED' (o unico que escreveu foi o seed
// scripts/seed_debitos_junho.cjs:69,75). E os leitores de dinheiro IGNORAM o
// status e amarram por (year, month) — promoterAnalytics.ts:1467-1476,
// dre.ts:506-520, financialAnalytics.ts:498-502. Entao "nao consumir" e
// simplesmente NAO APLICAR a linha daquela competencia.
//
// O sitio da supressao, com o aviso completo, esta em promoterAnalytics (busque
// por "PISO ZEROU O REPASSE"). Ver tambem dre.ts e financialAnalytics.ts.
//
// FRENTE SEPARADA, NAO E DESTE PISO: payable_commission_value JA pode ser
// negativo hoje, sem piso nenhum — medido em 2026-08, EDUARDA MANOELA tem
// desconto de 234,59 contra comissao 0,00. Nao consertar aqui.
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
  /** Ruido que precisa chegar na tela/no log (ex.: tabela ainda nao criada). */
  avisos: string[];
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
    avisos: [],
  };
}

/**
 * A tabela da regua ainda nao existe no banco? PostgREST responde PGRST205
 * ("Could not find the table ... in the schema cache"), nao 500.
 *
 * POR QUE ISTO E TOLERADO, contra o instinto de nunca engolir ausencia: entre o
 * merge do codigo e o Diego rodar o SQL no Studio ha uma janela em que a tabela
 * NAO existe. Lancar nessa janela derrubaria TODA consolidacao de mes fechado —
 * import de fechamento, /api/calculate/monthly, /api/pmr/reconsolidar. E a
 * ausencia da tabela e, nessa janela, a verdade: o piso ainda nao esta em vigor.
 * Por isso a tolerancia e ESTREITA (so este codigo de erro) e BARULHENTA (vira
 * aviso no retorno). Qualquer outro erro de leitura LANCA.
 * Remover quando a migration estiver aplicada em producao.
 */
function ehTabelaInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (String(error.code ?? "") === "PGRST205") return true;
  return /Could not find the table/i.test(String(error.message ?? ""));
}

const AVISO_TABELA_AUSENTE =
  `${PISO_TABELA} ainda NAO existe no banco: o piso de repasse esta INATIVO nesta ` +
  `execucao. Rode scripts/sql/2026-08-18_piso_producao_repasse.sql no Studio.`;

/**
 * Valvula de escape do fail-loud: PISO_ALLOW_RR_PURE=1 deixa uma execucao RR-pura
 * seguir mesmo com regua vigente. Existe para diagnostico e para o dia em que um
 * script precise rodar o consolidador solto — NUNCA para producao. Quando ligada,
 * o resultado sai com aviso.
 */
export function pisoRrPuroPermitido(): boolean {
  return String(process.env.PISO_ALLOW_RR_PURE ?? "").trim() === "1";
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
export async function lerReguaPisoVigente(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<{ regua: ReguaPiso | null; avisos: string[] }> {
  const { year, month } = params;
  const dia = competenciaParaData(year, month);
  const comp = competenciaLabel(year, month);

  const { data, error } = await supabase
    .from(PISO_TABELA)
    .select("id, competencia_inicio, competencia_fim, regra, scope")
    .lte("competencia_inicio", dia)
    .order("competencia_inicio", { ascending: false });

  if (error) {
    // ver ehTabelaInexistente: tolerancia ESTREITA e BARULHENTA.
    if (ehTabelaInexistente(error)) return { regua: null, avisos: [AVISO_TABELA_AUSENTE] };
    throw new Error(`${PISO_TABELA} (${comp}): ${error.message}`);
  }

  // VIGENCIA CONFERIDA NOS DOIS EXTREMOS, EM CODIGO. O `.lte()` acima ja recorta
  // o inicio no banco — mas confiar so nele deixa a retroatividade a UMA linha de
  // distancia: qualquer camada que devolva linha a mais (stub, cache, proxy de
  // diagnostico, um select reescrito) faria a regua alcancar competencia FECHADA
  // e zerar repasse ja pago, sem erro nenhum. Medido em 20/08/2026: um dry-run
  // com proxy que nao implementava `lte` aplicou a regua de 2026-08 em jun e abr.
  // O filtro do banco e otimizacao; a decisao de vigencia e daqui.
  const vigentes = (data ?? []).filter((linha: Record<string, unknown>) => {
    const inicio = linha.competencia_inicio;
    if (!ehTexto(inicio) || String(inicio).slice(0, 10) > dia) return false;
    const fim = linha.competencia_fim;
    return !ehTexto(fim) || fim.slice(0, 10) >= dia;
  });

  if (vigentes.length === 0) return { regua: null, avisos: [] };
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
  return { regua, avisos: [] };
}

/** Atalho fino de lerReguaPisoVigente, para quem so quer a regua. */
export async function resolverReguaPisoVigente(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ReguaPiso | null> {
  return (await lerReguaPisoVigente(supabase, params)).regua;
}

/**
 * A ENTRADA QUE O ORQUESTRADOR CONSOME. Resolve a regua da competencia e aplica
 * sobre a producao consolidada, devolvendo os fatores prontos para injecao.
 *
 * `producoes` tem que trazer uma entrada por promotor do universo — e o universo
 * e `pids UNIAO alcancados pela regua`, nunca so `pids`: quem tem apenas seguro
 * avulso nao entra em bbtsOrchestrator:170 e passaria batido pelo piso.
 */
export async function resolverPiso(
  supabase: SupabaseLike,
  params: { year: number; month: number; producoes: ProducaoConsolidada[] }
): Promise<PlanoPiso> {
  const { regua, avisos } = await lerReguaPisoVigente(supabase, {
    year: params.year,
    month: params.month,
  });
  const plano = montarPlanoPiso(regua, params.producoes);
  plano.avisos.push(...avisos);
  if (regua) {
    const zerados = plano.veredictos.filter((v) => v.abaixoDoPiso).length;
    plano.avisos.push(
      `PISO DE REPASSE ativo (${competenciaLabel(params.year, params.month)}): piso ` +
        `${regua.piso.toFixed(2)} sobre ${regua.baseCalculo}, zera ${regua.zera.join("+")}; ` +
        `${plano.veredictos.length} alcancado(s), ${zerados} abaixo do piso.`
    );
  }
  return plano;
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
    if (ehTabelaInexistente(error)) return false; // ver ehTabelaInexistente
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
  /** PISO_ALLOW_RR_PURE=1 — ver pisoRrPuroPermitido. Devolve aviso em vez de lancar. */
  permitirRrPuro?: boolean;
}): string | null {
  const { funcao, year, month, temRegua, fatorInjetado } = params;
  if (!temRegua || fatorInjetado) return null;
  if (params.permitirRrPuro === true) {
    return (
      `PISO IGNORADO por PISO_ALLOW_RR_PURE=1 em ${funcao} ` +
      `${competenciaLabel(year, month)}: ha regua de piso vigente e o fator NAO foi ` +
      `injetado. O numero desta execucao NAO e o que a producao paga.`
    );
  }
  throw new Error(
    `${funcao} ${competenciaLabel(year, month)}: existe REGUA DE PISO DE REPASSE ` +
      `vigente e o fator NAO foi injetado. Chame via consolidateMonthlyGroup ` +
      `(lib/bbtsOrchestrator.ts): o piso depende da producao CONSOLIDADA RR+ADS, ` +
      `que NAO existe dentro desta funcao — o fallback RR-puro zeraria quem tem ` +
      `producao na ADS. Valvula de escape (diagnostico, NUNCA producao): ` +
      `PISO_ALLOW_RR_PURE=1.`
  );
}
