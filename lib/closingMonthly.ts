import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// closingMonthly — consolidação do PMR a partir do FECHAMENTO (monthly_closing_
// entries, aba "A Vista"). Função IRMÃ de consolidateMonthlyFromCms (cmsMonthly.ts):
// mesma tabela (promoter_monthly_results), mesmo upsert onConflict
// (promoter_id,year,month,company_id — constraint por empresa, p/ RR e BBTS
// coexistirem no mesmo promotor/competência), mesma forma de retorno. A diferença
// é a FONTE e a RÉGUA — aqui o valor nasce do fechamento, não do cms.
//
// RÉGUA (validada contra o gabarito RR puro — sem chave BBTS — jun/2026: gap 0,3%):
//   à vista  : Σ(COMISSÃO PF do contrato) × acordo, onde acordo = resolve-
//              PromoterShareSync com Frente C — aplica a escala de repasse na
//              faixa 5,80% e o acordo base fora dela. NÃO recalcula de líquido × %.
//   herança  : contrato de chave MASTER herda o assigned_promoter_id do DIÁRIO
//              (contract_number → daily.proposal_number, MESMA company_id,
//              competência do mês). Chave INDIVIDUAL casa direto.
//   seguro   : Σ(COMISSÃO SEGURO empresa) × share do repasse. O share vem da
//              PENETRAÇÃO INDIVIDUAL do promotor (líquido_segurado/líquido_total,
//              "segurado" pelo FLAG PROD.SEGURADA), cortes oficiais 0,11/0,21/0,30
//              (lib/insurancePenetration). NÃO usa a penetração do GRUPO (era bug).
//              FONTE ÚNICA: a COMISSÃO SEGURO EMBUTIDA nas linhas CASH. Até
//              24/08/2026 somava-se também a aba "avulsa" INSURANCE/"A Vista",
//              que NÃO é uma segunda fonte: é a MESMA linha desdobrada pelo
//              importador, e o seguro saía DOBRADO (ver o bloco 5b). O BBTS-2d
//              pode INJETAR o share (penetração consolidada RR+ADS).
//   exclusões: chave BBTS (JJ552710) fica FORA (frente BBTS futura); SRCC="Sim"
//              sai do valor e volta em `restritas` para a UI.
//
// DÍVIDA NOMEADA (não tratada aqui): a aba INSURANCE/"Seguro" — ESTORNOS, com
// OPERACAO/DATA_CANCELAMENTO/NUMERO_SEGURO/STATUS=CANCELADO e comissões
// NEGATIVAS (−R$ 419,21 em jul/2026, 17 linhas; ~−R$ 901 em jun/2026) — NÃO é
// consumida por ninguém. Falta decisão de rateio (dedução da empresa?
// proporcional? ignorar?). É a aba que tem valor de verdade a somar.
//
// DÍVIDA NOMEADA (importação): abr/2026 tem 497 linhas CASH contra 707 em
// jun/2026 e 724 em jul/2026, e 5 linhas INSURANCE cujo contrato não existe em
// CASH nenhum — a importação daquela competência parece incompleta. Medido em
// 24/08/2026; nada foi feito a respeito.
//
// NÃO altera detectClosedMonth, NÃO toca /api/promotores, NÃO vira a tela. É
// chamada por script/endpoint de teste manual (scripts/rodarClosingMonthly.ts).
// ============================================================================

import {
  loadClosingPromoterBase,
  type ClosingContrato,
} from "./closingPromoterBase.ts";
import { buildDonoDoDiarioMap, resolvePromotorEfetivo } from "./herancaMaster.ts";
import {
  assertPisoInjetado,
  competenciaExigePiso,
  pisoRrPuroPermitido,
} from "./pisoProducao.ts";
import {
  fetchPromoterShareData,
  resolvePromoterShareSync,
} from "./proposalDetailing.ts";
import {
  individualPenetration,
  insuranceShareForPenetration,
  primeInsuranceShareTiers,
} from "./insurancePenetration.ts";
import { baseRepasseAvistaRR, isFaixaTetoAvistaRR } from "./tetoAvistaRR.ts";
import { detectSpecialAgreementsMesFechado } from "./agreements/specialFechadoAviso.ts";

// Chave master BBTS/ADS — excluída DESTA consolidação (a da RR, via fechamento).
// A produção da ADS/BBTS tem consolidador próprio: lib/bbtsMonthly.ts (PMR da ADS
// a partir do diário), orquestrado por promotor com a RR em lib/bbtsOrchestrator.ts
// (as escalas olham RR+ADS somadas). Aqui a chave só é filtrada para não duplicar.
const BBTS_KEY = "JJ552710";
// Teto à vista 5,80% (decimal); acima disso o contrato está na "faixa 5,80%" e a
// Frente C aplica a escala de repasse.
// FAIXA_580 era o teto 5,80% menos um epsilon de float. NÃO é cap: é
// CLASSIFICADOR (rotula "está na faixa do teto"). Valor e epsilon agora vêm da
// fonte única versionada — ver isFaixaTetoAvistaRR em lib/tetoAvistaRR.ts.

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")
    : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function normText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normKey(value: unknown): string {
  return normText(value).replace(/ /g, "");
}

function resolveTargetStatus(
  productionValue: number,
  target: number,
  target1: number,
  target2: number
) {
  if (target2 > 0 && productionValue >= target2) return "META_2";
  if (target1 > 0 && productionValue >= target1) return "META_1";
  if (target > 0 && productionValue >= target) return "META";
  return "BELOW_META";
}

async function fetchAllPaged<T = any>(build: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];
  while (true) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Promotor efetivo da linha: EXTRAÍDO para lib/herancaMaster.ts (fonte única).
// O DIÁRIO vence a chave J (honra a reatribuição manual); a chave J é fallback
// quando não há linha no diário. Os três consumidores chamam o mesmo helper.

type SupabaseLike = SupabaseClient;

type ClosingAgg = {
  companyId: string | null;
  net: number; // Σ valorLiquido (produção do fechamento) = denominador da penetração
  liquidoSegurado: number; // Σ valorLiquido de contratos com PROD.SEGURADA="Sim" = numerador
  count: number;
  avista: number; // Σ COMISSÃO PF × acordo (com Frente C)
  // Comissão-EMPRESA de seguro (COMISSÃO SEGURO), BRUTA — o share (individual) é
  // aplicado UMA vez no final. FONTE ÚNICA: o CASH. Não existe mais um campo
  // "avulso" somando aqui — ver o bloco 5b abaixo.
  seguroEmpresaEmbutido: number; // Σ COMISSÃO SEGURO do CASH
  insuredCount: number;
};

/**
 * Empresa "DONA" DETERMINÍSTICA por promotor (régua do bloco 3b, extraída p/ REUSO
 * — a fila de débitos master usa a MESMA lógica, sem duplicar). `contratos` já devem
 * ter `__pid` (promotor efetivo, pós-herança master). CRITÉRIO: 1º maior Σ net da
 * chave INDIVIDUAL (própria, não-herdada); 2º maior Σ net total; 3º company_id asc
 * (determinístico). Não altera valor — só o rótulo company_id da linha.
 */
export function computeDonaCompanyMap(
  contratos: Array<ClosingContrato & { __pid?: string | null }>
): Map<string, string | null> {
  const donaCompany = new Map<string, string | null>();
  const perPid = new Map<string, Map<string, { indiv: number; total: number }>>();
  for (const c of contratos) {
    const pid = (c as any).__pid as string | null;
    if (!pid || !c.companyId) continue;
    let byCo = perPid.get(pid);
    if (!byCo) {
      byCo = new Map();
      perPid.set(pid, byCo);
    }
    const e = byCo.get(c.companyId) || { indiv: 0, total: 0 };
    e.total += c.valorLiquido;
    if (c.promoterId === pid) e.indiv += c.valorLiquido; // chave PRÓPRIA (não herança)
    byCo.set(c.companyId, e);
  }
  for (const [pid, byCo] of perPid) {
    const ranked = [...byCo.entries()].sort(
      (a, b) =>
        b[1].indiv - a[1].indiv || // 1º: maior net da chave individual
        b[1].total - a[1].total || // 2º: maior net total
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) // 3º: company_id asc (determinístico)
    );
    donaCompany.set(pid, ranked[0][0]);
  }
  return donaCompany;
}

/**
 * Empresa DONA determinística de CADA promotor no mês, pela régua de
 * computeDonaCompanyMap: carrega a base do fechamento (todas as empresas), aplica
 * exclusão BBTS + herança master p/ obter o pid efetivo, e devolve o mapa inteiro.
 *
 * O MAPA, e não uma chamada por promotor: quem precisa da dona de VÁRIAS pessoas
 * (a Frente C grava produto de ~21 promotores) faria 21 cargas do fechamento
 * inteiro. Uma carga serve a todos. `resolveDonaCompanyForPromoter` virou um
 * `.get()` sobre isto — as duas nunca podem divergir porque só há um cálculo.
 */
/**
 * Empresa DONA de UM promotor. Açúcar sobre buildDonaCompanyMapDoMes. Usada pela
 * FILA de débitos (estorno master) p/ NÃO gravar company_id nulo — que faria o
 * débito sumir ao filtrar por empresa. Retorna null só se o promotor não aparece
 * no fechamento do mês.
 */
export async function buildDonaCompanyMapDoMes(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<Map<string, string | null>> {
  const { year, month } = params;
  const base = await loadClosingPromoterBase(supabase, { year, month, companyId: null });
  const isBbts = (c: ClosingContrato) => normKey(c.chaveJ) === BBTS_KEY;
  const contratos = base.contratos.filter((c) => !isBbts(c));
  const dono = await buildDonoDoDiarioMap(supabase, contratos, year, month);
  for (const c of contratos) {
    (c as any).__pid = resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      dono
    );
  }
  return computeDonaCompanyMap(contratos);
}

export async function resolveDonaCompanyForPromoter(
  supabase: SupabaseLike,
  params: { year: number; month: number; promoterId: string }
): Promise<string | null> {
  const { year, month, promoterId } = params;
  const mapa = await buildDonaCompanyMapDoMes(supabase, { year, month });
  return mapa.get(promoterId) ?? null;
}

/**
 * Consolida o PMR do mês a partir do FECHAMENTO. Grava em
 * promoter_monthly_results com source='fechamento', agregado por promotor.
 * READ das fontes + WRITE apenas em promoter_monthly_results (upsert onConflict).
 * Não vira a tela nem altera outras rotas.
 */
export async function consolidateMonthlyFromClosing(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    companyId?: string | null;
    promoterId?: string | null;
    dryRun?: boolean;
    // ===== INJEÇÕES DO ORQUESTRADOR (BBTS-2d) — produção CONSOLIDADA RR+ADS =====
    // Ausentes => comportamento RR-puro (cada uma cai no cálculo local).
    // (1) share de seguro pela penetração CONSOLIDADA RR+ADS.
    seguroShareByPromoter?: Map<string, number>;
    // (2) target_status pela meta CONSOLIDADA RR+ADS (coluna do PMR).
    statusMetaByPromoter?: Map<string, string>;
    // (3) volume CONSOLIDADO (RR+ADS) da escala ENTRANTE (monthlyVolumesMap).
    volumeConsolidadoByPromoter?: Map<string, number>;
    // (3b) produção VÁLIDA CONSOLIDADA (RR+ADS) da Frente C (frenteCProductionMap).
    //      Separada do volume: ENTRANTE usa TODOS os records; Frente C só válidos.
    prodConsolidadoByPromoter?: Map<string, number>;
    // (4) PISO DE REPASSE — fatores 0|1 por promotor. ESTA FUNÇÃO NÃO CONHECE A
    //     REGRA: quem avalia piso/base/alcance é o bloco F do bbtsOrchestrator,
    //     onde a produção CONSOLIDADA RR+ADS existe. Aqui só se multiplica.
    //     Ausentes => `?? 1` => byte-idêntico ao comportamento anterior.
    fatorCreditoByPromoter?: Map<string, number>;
    fatorSeguroByPromoter?: Map<string, number>;
  }
) {
  const { year, month } = params;
  const companyId = params.companyId ?? null;
  const promoterId = params.promoterId ?? null;
  const dryRun = params.dryRun === true;

  // CONTRATO DE INJEÇÃO DO PISO. Não é a regra — é a AFIRMAÇÃO de que, se esta
  // competência tem piso, alguém tinha que ter passado o fator. Sem isto,
  // scripts/rodarClosingMonthly.ts:52 (que chama sem dryRun, e :230 faz o default
  // ser GRAVAR) reescreveria o PMR sem piso e desfaria o zeramento, em silêncio.
  // Lança TAMBÉM em dryRun: dry-run com número errado é como número errado vira
  // verdade. Válvula de escape, só diagnóstico: PISO_ALLOW_RR_PURE=1.
  const avisosPiso: string[] = [];
  {
    const aviso = assertPisoInjetado({
      funcao: "consolidateMonthlyFromClosing",
      year,
      month,
      temRegua: await competenciaExigePiso(supabase, { year, month }),
      fatorInjetado: params.fatorCreditoByPromoter !== undefined,
      permitirRrPuro: pisoRrPuroPermitido(),
    });
    if (aviso) avisosPiso.push(aviso);
  }

  // Escala de seguro: fonte canônica é a TABELA (share_scale SEGURO_SLIP).
  // Prime ANTES de qualquer insuranceShareForPenetration; sem isto o resolvedor
  // cai na REDE (literal) silenciosamente.
  await primeInsuranceShareTiers(supabase);

  // 1. Base do fechamento (à vista + seguro embutido; SRCC="Sim" em restritas).
  const base = await loadClosingPromoterBase(supabase, { year, month, companyId });

  // 2. Exclui a chave BBTS (JJ552710) de TUDO — quem consolida a ADS/BBTS é
  //    bbtsMonthly (via bbtsOrchestrator), não esta função.
  const isBbts = (c: ClosingContrato) => normKey(c.chaveJ) === BBTS_KEY;
  const contratos = base.contratos.filter((c) => !isBbts(c));
  const restritas = base.restritas.filter((c) => !isBbts(c));

  // 3. Promotor efetivo: o DIÁRIO manda. `assigned_promoter_id` é o campo que o
  //    financeiro edita ao reatribuir; a chave J fica no dono ORIGINAL e por isso
  //    não pode ter a última palavra. O mapa é construído sobre TODAS as linhas
  //    (contratos + restritas) — filtrar só as órfãs de chave master era o defeito
  //    que desfazia toda reatribuição promotor->promotor no fechamento.
  //    A chave J segue como FALLBACK: sem linha no diário, nada muda.
  const dono = await buildDonoDoDiarioMap(supabase, [...contratos, ...restritas], year, month);
  const efetivoPid = (c: ClosingContrato): string | null =>
    resolvePromotorEfetivo(
      { promoterIdDaChave: c.promoterId, contrato: c.contrato, companyId: c.companyId },
      dono
    );
  for (const c of contratos) (c as any).__pid = efetivoPid(c);
  for (const c of restritas) (c as any).__pid = efetivoPid(c);

  // 3b. Empresa "DONA" DETERMINÍSTICA por promotor. Sem isto, getAgg fixava o
  //     company_id da linha do PMR pelo PRIMEIRO contrato processado — arbitrário
  //     e dependente da ordem de fetch. Quando a ordem mudava (ex.: re-importação),
  //     um promotor com produção em 2+ empresas RR (parte na chave própria, parte
  //     por herança master) migrava de empresa e o upsert onConflict
  //     (promoter_id,year,month,company_id) criava linha NOVA em vez de atualizar
  //     -> DUPLICATA (caso Mayanne jun/2026: AL2 direto + AL3 herança).
  //     CRITÉRIO (aprovado): empresa onde o Σ net da chave INDIVIDUAL (própria,
  //     não-herdada) é maior; fallback = maior Σ net geral; desempate por
  //     company_id (asc). Data-driven e ESTÁVEL entre re-importações. Não muda
  //     valor nenhum — só o rótulo company_id da linha (a régua RR segue
  //     consolidada por promotor). Não altera a separação RR × ADS.
  //     (Régua extraída em computeDonaCompanyMap — reusada pela fila de débitos.)
  const donaCompany = computeDonaCompanyMap(contratos);

  // 4. Dados de cascata/Frente C (profiles, escalas, metas, goal_repasse,
  //    produção válida) para os promotores EFETIVOS.
  const efetivos = [
    ...new Set(contratos.map((c) => (c as any).__pid).filter(Boolean)),
  ] as string[];
  // ESCOPO DE EMPRESA: a produção/volume que decide a escala do promotor
  // (monthlyVolumesMap/frenteCProductionMap) deve considerar SÓ o Grupo RR — sem
  // isso, a produção ADS atribuída no diário vazava na escala (bug Maria Letícia).
  // A meta CONSOLIDADA RR+ADS é aplicada explicitamente pelo BBTS-2d.
  const rrCompanies = await fetchAllPaged<any>(() =>
    supabase.from("companies").select("id").eq("group_name", "Grupo RR")
  );
  const rrCompanyIds = rrCompanies.map((c) => c.id as string);
  const share = await fetchPromoterShareData(supabase, efetivos, year, month, rrCompanyIds);

  // Nomes p/ carve-out Aldalene INSS.
  const nameById = new Map<string, string>();
  {
    const proms = await fetchAllPaged<any>(() =>
      supabase.from("promoters").select("id, name")
    );
    for (const p of proms) nameById.set(p.id, p.name);
  }

  // Volume/produção efetivos p/ a escala: CONSOLIDADO (RR+ADS) quando injetado
  // pelo orquestrador; senão RR-puro (monthlyVolumesMap / frenteCProductionMap).
  const volConsol = params.volumeConsolidadoByPromoter;
  const prodConsol = params.prodConsolidadoByPromoter;
  const volumeDe = (pid: string) => volConsol?.get(pid) ?? share.monthlyVolumesMap.get(pid) ?? 0;
  const producaoDe = (pid: string) => prodConsol?.get(pid) ?? share.frenteCProductionMap.get(pid) ?? 0;

  // acordo POR CONTRATO — Frente C aplica na faixa 5,80% (escala de repasse) e o
  // acordo base (profile/default) fora dela. isAldaleneInss usa nome + produto.
  function acordoDoContrato(pid: string, c: ClosingContrato): number {
    const tgt = share.targetsMap.get(pid);
    const res = resolvePromoterShareSync({
      record: { assigned_promoter_id: pid, share_percent_override: null },
      profilesMap: share.profilesMap,
      scalesMap: share.scalesMap,
      monthlyVolumesMap: new Map([[pid, volumeDe(pid)]]), // ENTRANTE: volume consolidado
      frenteC: {
        goalRepasse: share.goalRepasseMap.get(pid) ?? null,
        productionValue: producaoDe(pid), // Frente C: produção consolidada
        target1Value: tgt?.meta1 ?? 0,
        target2Value: tgt?.meta2 ?? 0,
        isAldaleneInss:
          normText(nameById.get(pid)).includes("ALDALENE") &&
          normText(c.produto).includes("INSS"),
        isFaixa580: isFaixaTetoAvistaRR(c.percentualEmpresa, { year, month }),
      },
    });
    return Math.min(Math.max(Number(res.sharePercent) || 0, 0), 1);
  }

  // 5. Agrega por promotor EFETIVO. Contratos órfãos (sem promotor mesmo após
  //    herança) NÃO entram no PMR — ficam com a empresa (igual ao cms).
  const agg = new Map<string, ClosingAgg>();
  const getAgg = (pid: string, companyId: string | null): ClosingAgg => {
    let a = agg.get(pid);
    if (!a) {
      a = {
        // Empresa DONA (determinística) para quem tem contrato CASH; fallback ao
        // company_id passado.
        companyId: donaCompany.get(pid) ?? companyId ?? null,
        net: 0,
        liquidoSegurado: 0,
        count: 0,
        avista: 0,
        seguroEmpresaEmbutido: 0,
        insuredCount: 0,
      };
      agg.set(pid, a);
    }
    return a;
  };

  let orfaosSemDono = 0;
  for (const c of contratos) {
    const pid = (c as any).__pid as string | null;
    if (!pid) {
      orfaosSemDono += 1;
      continue;
    }
    const a = getAgg(pid, c.companyId ?? null);
    // TETO 5,80% — a base do REPASSE e a comissao-empresa a vista TRAZIDA AO
    // TETO, nao a comissao cheia. A Promotiva paga ate 6,00%; a RR remunera o
    // promotor sobre 5,80% e o spread fica com a empresa. Ate 24/08/2026 este
    // ponto multiplicava `c.comissaoEmpresaAvista` cru pelo acordo e pagava
    // repasse sobre 6,00% em todo contrato acima do teto (jul/2026: 101
    // contratos, R$ 1.047,30 a mais; jun 96 / R$ 950,26; abr 99 / R$ 955,88).
    // O gemeo da ADS ja capava (bbtsMonthly:262) — dai a ADS bater e o RR nao.
    // O cap e PROPORCIONAL, nao um Math.min: ver baseRepasseAvistaRR.
    // NAO mexe na comissao da EMPRESA — `a.avista` e repasse ao promotor.
    a.avista +=
      baseRepasseAvistaRR(c.comissaoEmpresaAvista, c.percentualEmpresa, { year, month }) *
      acordoDoContrato(pid, c);
    a.seguroEmpresaEmbutido += c.comissaoSeguro;
    a.net += c.valorLiquido; // denominador da penetração (SRCC já fora — restritas separadas)
    a.count += 1;
    // "Segurado" pelo FLAG oficial PROD.SEGURADA (não insurance_value>0).
    if (c.prodSegurada) {
      a.insuredCount += 1;
      a.liquidoSegurado += c.valorLiquido; // numerador da penetração
    }
  }

  // 5b. NÃO EXISTE SEGURO AVULSO. (Removido em 24/08/2026.)
  //
  //     Havia aqui um `addSeguroAvulso` que somava a COMISSÃO SEGURO das linhas
  //     entry_type='INSURANCE' com sheet_name='A Vista ' num segundo campo do
  //     agregado, e o cálculo somava os dois lados. Isso DOBRAVA o seguro.
  //
  //     Essas linhas não são uma segunda fonte: são a MESMA linha da aba
  //     "A Vista", desdobrada pelo importador. `buildEntriesForRow`
  //     (monthlyClosingImport.ts:1075-1101) emite DUAS entries da mesma `row`
  //     — uma CASH com "Comissao PF" e uma INSURANCE com "Comissao Seguro" —
  //     e `buildBaseEntry` grava `metadata: row` nas duas. O arquivo da
  //     Promotiva tem UMA aba com o seguro embutido por contrato; a outra aba
  //     de seguro é a de ESTORNO (OPERACAO, DATA_CANCELAMENTO, NUMERO_SEGURO,
  //     STATUS=CANCELADO, comissões negativas), estrutura diferente.
  //
  //     MEDIDO em 24/08/2026, casando por (company_id, contrato):
  //       jun/2026  194 de 194 linhas INSURANCE têm par no CASH, valor idêntico
  //       jul/2026  184 de 184, idem
  //       abr/2026  149 de 154; as 5 restantes têm metadata de linha da aba
  //                 "A Vista" (% A VISTA, COMISSÃO PF, VALOR LÍQUIDO) e o
  //                 contrato não existe em CASH nenhum — são gêmeas CASH
  //                 PERDIDAS de uma importação incompleta (abril tem 497 linhas
  //                 CASH contra 707 em jun e 724 em jul), não avulso legítimo.
  //     Em nenhuma competência o valor da INSURANCE difere do embutido.
  //
  //     POR QUE NÃO "LER SÓ O QUE NÃO TEM PAR": deixaria a régua dependendo de
  //     uma coincidência (hoje zero) e manteria vivo um caminho que já
  //     CONTRABANDEAVA SRCC RESTRITA. O embutido exclui as restritas — elas não
  //     entram no agregado — mas a gêmea INSURANCE não carrega essa marca e o
  //     addSeguroAvulso a atribuía assim mesmo. SEVERINA em jun/2026 recebia
  //     seguro com embutido 0,00: o valor vinha inteiro de uma restrita
  //     (contrato 211317389, R$ 22,11). Em jul/2026 o mesmo com o 220065875
  //     (R$ 2,76). Remover a soma conserta isso de graça; dividir por dois não
  //     consertaria.
  //
  //     DÍVIDA NOMEADA (não consertada aqui): a aba INSURANCE/"Seguro" —
  //     ESTORNOS, −R$ 419,21 em jul/2026, 17 linhas — não é consumida por
  //     ninguém. O filtro sheet_name==='A Vista ' que a deixava de fora morreu
  //     junto com esta função; ela continua fora, agora por ausência de
  //     leitor. É a aba que tem valor de verdade a somar.

  // 6. Metas (para target_status e colunas de meta).
  const targets = await fetchAllPaged<any>(() => {
    let q = supabase
      .from("monthly_targets")
      .select("promoter_id, meta, meta_1, meta_2")
      .eq("year", year)
      .eq("month", month);
    if (companyId) q = q.eq("company_id", companyId);
    if (promoterId) q = q.eq("promoter_id", promoterId);
    return q;
  });
  const targetByPromoter = new Map<string, any>(
    targets.map((t: any) => [t.promoter_id, t])
  );

  // 7. Monta upserts + tabela de retorno. Se promoterId veio no filtro, só ele.
  const upserts: any[] = [];
  const table: Array<{
    promoter_id: string;
    promoter_name: string;
    // Diagnóstico de seguro para o dry-run/conferência.
    penetracao_individual: number; // decimal 0..1
    seguro_share: number; // 0..1 aplicado
    seguro_empresa: number; // comissão-empresa (embutido + avulso), BRUTA
    production_commission_value: number;
    insurance_commission_value: number;
    final_commission_value: number;
    source: string;
  }> = [];

  const nowIso = new Date().toISOString();
  for (const [pid, a] of agg) {
    if (promoterId && pid !== promoterId) continue;

    // PENETRAÇÃO INDIVIDUAL (líquido segurado / líquido total) + cortes oficiais.
    // O share pode ser INJETADO pelo BBTS-2d (penetração consolidada RR+ADS).
    const penetracao = individualPenetration(a.liquidoSegurado, a.net);
    const seguroShare =
      params.seguroShareByPromoter?.get(pid) ?? insuranceShareForPenetration(penetracao);
    // FONTE ÚNICA: o seguro embutido no CASH. Até 24/08/2026 esta linha somava
    // um `seguroEmpresaAvulso` que era a MESMA linha desdobrada pelo importador
    // — o seguro saía dobrado e o share o dividia de volta pela metade. Ver 5b.
    const seguroEmpresa = a.seguroEmpresaEmbutido;

    // PISO DE REPASSE — fatores injetados pelo bloco F do bbtsOrchestrator.
    // Multiplicam SÓ o repasse: `seguroEmpresa` (comissão da EMPRESA) fica
    // intacta acima, e `a.net` (produção) também. A RR recebe da Promotiva pela
    // produção, independente de repassar — se companyGross cair, o DRE mente.
    const fatorCredito = params.fatorCreditoByPromoter?.get(pid) ?? 1;
    const fatorSeguro = params.fatorSeguroByPromoter?.get(pid) ?? 1;
    const pisoZerou = fatorCredito === 0 || fatorSeguro === 0;

    const productionCommission = a.avista * fatorCredito;
    const insuranceCommission = seguroEmpresa * seguroShare * fatorSeguro;
    const finalCommission = productionCommission + insuranceCommission;

    const t = targetByPromoter.get(pid);
    const targetValue = t ? toNumber(t.meta) : 0;
    const target1Value = t ? toNumber(t.meta_1) : 0;
    const target2Value = t ? toNumber(t.meta_2) : 0;

    upserts.push({
      promoter_id: pid,
      company_id: a.companyId ?? null,
      year,
      month,
      production_value: a.net,
      proposal_count: a.count,
      insured_proposal_count: a.insuredCount,
      insured_production_value: a.liquidoSegurado,
      insurance_penetration_percent: penetracao * 100, // INDIVIDUAL, não a do grupo
      target_value: targetValue,
      target_1_value: target1Value,
      target_2_value: target2Value,
      projected_production_value: a.net, // mês fechado: sem projeção diária
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      agreement_adjustment_value: 0,
      // discount_value SEMPRE 0 nesta consolidação (o desconto real vive em
      // promoter_discounts). Com o piso ativo isso vira RASTRO: a linha diz que o
      // desconto NÃO aconteceu, não que aconteceu e foi absorvido.
      discount_value: 0,
      // RASTRO DO PISO. É por este flag que os leitores de payable sabem suprimir
      // o desconto da competência — eles NÃO podem reavaliar o piso sozinhos
      // (promoterAnalytics:1421 filtra por empresa e a produção sairia parcial).
      piso_zerou: pisoZerou,
      final_commission_value: finalCommission,
      // Meta CONSOLIDADA (RR+ADS) injetada pelo orquestrador; senão RR-pura.
      target_status:
        params.statusMetaByPromoter?.get(pid) ??
        resolveTargetStatus(a.net, targetValue, target1Value, target2Value),
      source: "fechamento",
      calculated_at: nowIso,
      // Detector Camada 1: NULL de PROPOSITO — o fechamento NAO usa a TRP. A
      // comissao de credito ja vem PRONTA do arquivo (monthly_closing_entries via
      // closingPromoterBase); a TRP aqui e regua de AUDITORIA, nao insumo do PMR.
      // NAO "consertar" para gravar versao: nao ha versao usada neste calculo.
      trp_version_id: null,
      trp_fallback: null,
    });

    table.push({
      promoter_id: pid,
      promoter_name: nameById.get(pid) ?? "(promotor desconhecido)",
      penetracao_individual: penetracao,
      seguro_share: seguroShare,
      seguro_empresa: seguroEmpresa,
      production_commission_value: productionCommission,
      insurance_commission_value: insuranceCommission,
      final_commission_value: finalCommission,
      source: "fechamento",
    });
  }

  // dryRun: NÃO grava (só calcula e devolve p/ conferência).
  if (!dryRun && upserts.length > 0) {
    const { error } = await supabase
      .from("promoter_monthly_results")
      .upsert(upserts, { onConflict: "promoter_id,year,month,company_id" });
    if (error) throw error;
  }

  table.sort(
    (x, y) => y.final_commission_value - x.final_commission_value
  );

  // GUARDA ANTI-SILENCIO: ajuste comercial (acordo SPECIAL) em mes FECHADO. O
  // fechamento RR reproduz o que a Promotiva pagou — o ajuste avulso NAO e
  // aplicado aqui (agreement_adjustment_value fica 0). Se houver SPECIAL ativo na
  // competencia, avisa em vez de gravar 0 mudo. NO-OP hoje (0 SPECIAL em prod).
  // Ver lib/agreements/specialFechadoAviso.ts para a decisao AVISAR-vs-HONRAR.
  const avisos: string[] = [...avisosPiso];
  const specialFechado = await detectSpecialAgreementsMesFechado(supabase, {
    year,
    month,
    companyId,
    promoterId,
  });
  if (specialFechado.aviso) avisos.push(specialFechado.aviso);

  return {
    dry_run: dryRun,
    promoters_calculated: upserts.length,
    avisos,
    gravadas: dryRun ? 0 : upserts.length,
    // Payload EXATO que foi (ou seria, em dryRun) gravado no PMR. A reconciliacao
    // da competencia usa as chaves disto para saber o que e o PMR fechado NOVO —
    // e, por exclusao, o que virou orfao. O gate de paridade compara este payload
    // contra o que esta no banco. So expoe o que ja estava em `upserts`.
    payload: upserts,
    table,
    // Diagnóstico / UI futura.
    contratos_processados: contratos.length,
    // Linhas cujo dono veio do DIÁRIO (reatribuição honrada + herança master):
    //   antes só contava a herança, porque o diário só era consultado p/ órfã.
    contratos_do_diario: contratos.filter(
      (c) => (c as any).__pid && (c as any).__pid !== c.promoterId
    ).length,
    orfaos_sem_dono: orfaosSemDono,
    restritas, // SRCC="Sim": fora do valor, para a UI listar depois.
    bbts_excluidos: base.contratos.length - contratos.length,
  };
}

