import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// reconsolidarCompetenciaFechada — MOVIMENTO 1 do ledger.
//
// FRATURA QUE ISTO FECHA: o PMR de mes fechado (source 'fechamento'/'bbts') nao
// era escrito por NENHUMA rota — so por script manual (rodarClosingMonthly /
// rodarBbtsOrchestrator). O regime da competencia, porem, vira 'fechamento'
// assim que monthly_closing_imports fica COMPLETED nas empresas ativas. Ou seja:
// o mes FECHAVA para os leitores e o ledger fechado nao existia. Quem lia caia
// no vazio (abril: regime 'fechamento' com PMR 100% source='daily') ou em
// numeros de fontes diferentes por tela.
//
// INVARIANTE que esta funcao sustenta: regime fechado => PMR fechado existe.
// Por isso ela e chamada DENTRO do pipeline de import, ANTES de marcar
// COMPLETED, e NAO e best-effort: se falhar, o import falha e a competencia NAO
// e marcada como fechada.
//
// O QUE ELA FAZ:
//   1. Guarda de regime (le a fonte canonica, detectMonthRegime):
//      - 'cms'  -> NAO MEXE. jan-mai/2026 sao seed historico do financeiro
//                  (cms_promoter_entries). Recalcular pelo fechamento
//                  sobrescreveria o ground truth e a reconciliacao apagaria as
//                  linhas source='cms'. Precedencia cms > fechamento, igual a
//                  regra de leitura das telas.
//      - 'open' -> NAO MEXE. Mes aberto e do pipeline diario (source='daily').
//      - 'fechamento' -> consolida.
//   2. consolidateMonthlyGroup (o ORQUESTRADOR, nunca os consolidadores soltos):
//      ele chama consolidateMonthlyFromClosing (linha RR) e
//      consolidateMonthlyFromBbts (linha ADS) INJETANDO meta/penetracao/volume
//      CONSOLIDADOS RR+ADS. Chamar os dois soltos daria o comportamento
//      "RR-puro" — numero diferente.
//   3. Reconciliacao: o PMR fechado da competencia passa a ser EXATAMENTE o
//      conjunto recem-calculado. Some:
//      - as sobras source='daily' (o mes nao e mais aberto; quem soma o PMR sem
//        filtrar source — /financeiro, /dashboard, /metas, /projecao — contaria
//        a fatia diaria por cima da fechada);
//      - os orfaos 'fechamento'/'bbts' que nao estao no conjunto novo (o upsert
//        nunca deleta: promotor que sumiu do fechamento corrigido, ou que trocou
//        de empresa-dona via computeDonaCompanyMap, deixava linha velha viva).
//      NUNCA apaga source='cms' (defesa em profundidade — a guarda de regime ja
//      impediria, mas o historico nao pode depender so dela).
//   4. Idempotente: rodar 2x = mesmo estado (a 2a rodada recalcula o mesmo
//      conjunto, o upsert reescreve as mesmas chaves e nao sobra nada a apagar).
//
// dryRun=true: calcula tudo e devolve o plano (chaves, o que seria apagado) sem
// gravar nem apagar.
// ============================================================================

import { consolidateMonthlyGroup } from "./bbtsOrchestrator.ts";
import { detectMonthRegime, type MonthRegime } from "./cmsMonthly.ts";
import { persistRulesFingerprint } from "./rulesFingerprint.ts";
import { applyProdutoRepasseAoPmr } from "./produtoAssignments.ts";
import { computeConsorcioGestorPayout } from "./consorcio/gestorPayout.ts";
import { applyVendaPropriaGestao } from "./gestaoVendaPropria.ts";

type SupabaseLike = SupabaseClient;

/** Sources que este pipeline É DONO e portanto pode apagar. 'cms' nunca entra. */
const SOURCES_RECONCILIAVEIS = new Set(["fechamento", "bbts", "daily"]);

const chaveDe = (promoterId: string, companyId: string | null | undefined) =>
  `${promoterId}|${companyId ?? "NULL"}`;

export type ReconsolidacaoResultado = {
  ran: boolean;
  regime: MonthRegime;
  competencia: string;
  dry_run: boolean;
  motivo?: string;
  promotores?: number;
  /** linhas do PMR fechado novo (em dryRun: o plano, sem gravar) */
  payload?: any[];
  gravadas?: number;
  reconciliacao?: {
    apagadas_daily: number;
    apagadas_orfaos: number;
    sobrescritas_daily: number;
    preservadas_cms: number;
    detalhe_orfaos: Array<{ promoter_id: string; company_id: string | null; source: string }>;
  };
  produtos?: { promotores: number; atualizadas: number; inseridas: number };
  /** venda propria dos papeis de GESTAO (fora do PMR — ver lib/gestaoVendaPropria) */
  venda_propria_gestao?: {
    competencia: string;
    beneficiarios: number;
    total: number;
    ignoradas_sem_flag: number;
  };
  gestor_consorcio?: {
    competencia: string;
    gestor_user_id: string | null;
    total_10: number;
    empresas: number;
  };
  grupo?: any;
};

export async function reconsolidarCompetenciaFechada(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    dryRun?: boolean;
    /**
     * Empresa cujo import de fechamento esta EM VOO (ainda nao marcado
     * COMPLETED). O import e por empresa e so marca COMPLETED no fim do
     * pipeline; sem isto, a ULTIMA empresa da competencia nunca veria o mes
     * fechar (ela mesma ainda nao esta marcada) e o PMR fechado jamais seria
     * escrito pela rota. Ver detectMonthRegime(opts.empresaEmVoo).
     */
    empresaEmVoo?: string | null;
  }
): Promise<ReconsolidacaoResultado> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  const regime = await detectMonthRegime(supabase, year, month, {
    empresaEmVoo: params.empresaEmVoo ?? null,
  });

  if (regime === "cms") {
    return {
      ran: false,
      regime,
      competencia,
      dry_run: dryRun,
      motivo:
        "Regime 'cms' (seed historico do financeiro): o PMR desta competencia e ground truth " +
        "e NAO se recalcula pelo fechamento. Nada gravado, nada apagado.",
    };
  }

  if (regime === "open") {
    return {
      ran: false,
      regime,
      competencia,
      dry_run: dryRun,
      motivo:
        "Mes ABERTO: o PMR e do pipeline diario (source='daily'). O PMR fechado so nasce " +
        "quando o fechamento cobrir as empresas ativas.",
    };
  }

  // ---- regime 'fechamento': consolida RR + ADS pelo ORQUESTRADOR ----
  const grupo: any = await consolidateMonthlyGroup(supabase, { year, month, dryRun });

  // payload = as linhas EXATAS do PMR fechado (RR + ADS). Em dryRun elas nao
  // foram gravadas — sao o plano.
  const novas: any[] = grupo.payload ?? [];
  const novoSet = new Set(novas.map((k) => chaveDe(k.promoter_id, k.company_id)));

  // ---- FRENTE DE PRODUTO (M2a) — repasse de BBCAP + Conta Corrente ----
  // Depois da consolidacao base (credito+seguro), grava as colunas de produto e
  // recompoe o final dos promotores COM produto atribuido. Aditivo: quem nao tem
  // produto fica byte-identico. As chaves so-produto entram no novoSet para o
  // reconciliador NAO as apagar. Roda mesmo em dryRun (nesse caso nao grava).
  // O fator de PRODUTO vem do MESMO plano de piso que zerou credito/seguro no
  // orquestrador — a regra e avaliada UMA vez, no bloco F, e viaja daqui para a
  // Frente C. Hoje `zera` nao inclui PRODUTO, entao o mapa e todo 1 e isto e
  // no-op; o encanamento existe para a decisao mudar por dado.
  const produtos = await applyProdutoRepasseAoPmr(supabase, {
    year,
    month,
    dryRun,
    fatorProdutoByPromoter: grupo?.piso?.fator_produto_by_promoter as
      | Map<string, number>
      | undefined,
  });
  for (const k of produtos.chaves) novoSet.add(k);

  // ---- VENDA PROPRIA DE GESTAO — o mesmo repasse, para quem NAO e promotor ----
  // As linhas de produto atribuidas a um papel de gestao (gestor_consorcio/supervisor/
  // gerente_regional com venda_propria) saem do calculo acima em `produtos.gestao` e
  // sao gravadas em gestao_venda_propria — NUNCA no PMR (promoter_id NOT NULL FK
  // promoters). Com ninguem habilitado, o array vem vazio e isto e no-op.
  const vendaPropria = await applyVendaPropriaGestao(supabase, {
    year,
    month,
    buckets: produtos.gestao,
    dryRun,
  });

  // ---- GESTOR de consorcio (M2b) — payout dos 10% SEPARADO da PMR ----
  // 10% de TODA a comissao-empresa do consorcio, de TODAS as empresas. NAO entra no
  // PMR (nao mexe em promotor). Gravado em consorcio_gestor_payout. Roda em dryRun (nao
  // grava). Best-effort no espirito: mas o payout e barato e determinístico.
  const gestorPayout = await computeConsorcioGestorPayout(supabase, { year, month, dryRun });

  // ---- Reconciliacao: o PMR fechado passa a ser SO o conjunto novo ----
  const { data: existentes, error: readError } = await supabase
    .from("promoter_monthly_results")
    .select("id, promoter_id, company_id, source")
    .eq("year", year)
    .eq("month", month);
  if (readError) throw readError;

  const apagarIds: string[] = [];
  const detalheOrfaos: Array<{ promoter_id: string; company_id: string | null; source: string }> = [];
  let apagadasDaily = 0;
  let apagadasOrfaos = 0;
  let sobrescritasDaily = 0;
  let preservadasCms = 0;

  for (const row of existentes || []) {
    const source = String(row.source ?? "");
    if (source === "cms") {
      preservadasCms += 1;
      continue; // historico: intocavel
    }
    if (!SOURCES_RECONCILIAVEIS.has(source)) {
      continue; // source desconhecido: nao e nosso, nao mexe
    }

    const noConjuntoNovo = novoSet.has(chaveDe(row.promoter_id, row.company_id));

    if (source === "daily") {
      // Chave que o conjunto novo cobre: o upsert do consolidador ja a
      // SOBRESCREVE (source vira fechamento/bbts) — 'source' nao faz parte do
      // onConflict. Nao ha o que apagar.
      if (noConjuntoNovo) {
        sobrescritasDaily += 1;
      } else {
        apagarIds.push(row.id);
        apagadasDaily += 1;
      }
      continue;
    }

    // 'fechamento' | 'bbts' fora do conjunto novo = orfao de uma rodada anterior.
    if (!noConjuntoNovo) {
      apagarIds.push(row.id);
      apagadasOrfaos += 1;
      detalheOrfaos.push({
        promoter_id: row.promoter_id,
        company_id: row.company_id,
        source,
      });
    }
  }

  if (!dryRun && apagarIds.length > 0) {
    for (let i = 0; i < apagarIds.length; i += 100) {
      const { error } = await supabase
        .from("promoter_monthly_results")
        .delete()
        .in("id", apagarIds.slice(i, i + 100));
      if (error) throw error;
    }
  }

  // ---- CAMADA 2 (detector de regua obsoleta por HASH DE CONTEUDO) ----
  // Grava o baseline do fingerprint das reguas que produziram este PMR fechado.
  // A partir daqui a competencia deixa de ser DESCONHECIDO e vira OK; se alguem
  // editar uma regua depois SEM reconsolidar, o detector a marca STALE.
  //
  // BEST-EFFORT de proposito: se a gravacao do fingerprint falhar, a competencia
  // apenas FICA DESCONHECIDO (estado honesto) — NAO derruba a reconsolidacao, que
  // ja escreveu o PMR (o ledger nao pode depender do detector auxiliar).
  //
  // MICRO-RACE registrada: consolidateMonthlyGroup leu as reguas em T e este
  // fingerprint le de novo em T+e; se uma regua mudar no intervalo, o baseline
  // gravado nao corresponde ao PMR calculado. Aceitavel (reconsolidacao e manual
  // e rara). Ver lib/rulesFingerprint.ts e a migration da Camada 2.
  if (!dryRun) {
    try {
      await persistRulesFingerprint(supabase, year, month, "fechado");
    } catch (e) {
      console.warn(
        `[reconsolidar] ${competencia}: falha ao gravar rules_fingerprint (Camada 2) — ` +
          `competencia fica DESCONHECIDO ate a proxima reconsolidacao. Detalhe:`,
        e,
      );
    }
  }

  return {
    ran: true,
    regime,
    competencia,
    dry_run: dryRun,
    promotores: grupo.promotores,
    payload: novas,
    gravadas: dryRun ? 0 : novas.length,
    reconciliacao: {
      apagadas_daily: apagadasDaily,
      apagadas_orfaos: apagadasOrfaos,
      sobrescritas_daily: sobrescritasDaily,
      preservadas_cms: preservadasCms,
      detalhe_orfaos: detalheOrfaos,
    },
    produtos: {
      promotores: produtos.promotores,
      atualizadas: produtos.atualizadas,
      inseridas: produtos.inseridas,
    },
    venda_propria_gestao: {
      competencia: vendaPropria.competencia,
      beneficiarios: vendaPropria.linhas.length,
      total: vendaPropria.total,
      ignoradas_sem_flag: vendaPropria.ignoradas_sem_flag,
    },
    gestor_consorcio: {
      competencia: gestorPayout.competencia,
      gestor_user_id: gestorPayout.gestor_user_id,
      total_10: gestorPayout.total_10,
      empresas: gestorPayout.linhas.length,
    },
    grupo,
  };
}
