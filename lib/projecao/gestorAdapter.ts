import type { BaseLiderancaDetalhada } from "@/lib/lideranca/baseLideranca";
import type { ResultadoLideranca } from "@/lib/remuneracaoLideranca";
import type { TeamProductionPayload, TeamPromoterRow } from "@/lib/equipe/teamProduction";
import { agregarSerieGrupo, type SerieMesPonto } from "@/lib/historicoMensal";
// Media dos 3 meses + tendencia: MESMO helper que lib/projecaoMetas usa. Havia
// duas implementacoes; agora ha uma.
import {
  mediaTresMeses,
  tendenciaDe,
  type EntradaMensal,
} from "@/lib/projecao/mediaTresMeses";
import {
  agruparPorEstado,
  agruparPorSupervisor,
  asEstado,
  consolidarGrupoEquipe,
  ESTADO_LABEL,
  promotoresEmRisco,
  semaforoFromPercent,
  type Estado,
  type EstadoHistorico,
  type ProjecaoGestor,
  type ProjecaoPromotor,
  type ProjecaoResultado,
  type PromotorHistorico,
  type SupervisorHistorico,
} from "@/lib/projecaoMetas";

/**
 * ADAPTADOR /projecao DO GESTOR — converte a saída de buildTeamProduction no
 * ProjecaoResultado que os agregadores da /projecao já sabem consumir.
 *
 * POR QUE ELE EXISTE
 * O motor da /projecao (buildProjecaoMetas → loadPromoterAnalyticsBase) lê 8
 * tabelas CRUAS. Nenhuma delas tem policy para supervisor/gerente_regional, então
 * para o gestor ele devolve vazio. O /equipe já resolve o mesmo problema pelo
 * caminho certo — vw_team_production + policy de monthly_targets — e já calcula
 * ritmo com o MESMO helper (resolverJanelaRitmo/projetarPorRitmo). Este arquivo
 * só traduz o formato; não recalcula nada e não lê banco.
 *
 * RÉGUA DE AUTORIZAÇÃO (herdada, não afrouxada)
 * QUEM entra vem exclusivamente da vw_team_production / current_user_team_promoter_ids
 * e da policy de monthly_targets, resolvidos lá em buildTeamProduction. Aqui é
 * função PURA: recebe o payload já autorizado e devolve outro formato. Não há
 * client de banco neste módulo — nem anon, nem service_role.
 *
 * OS 4 AGREGADORES RODAM SEM ALTERAÇÃO
 * O alvo é exatamente o parâmetro que eles pedem (lib/projecaoMetas.ts):
 *   :514  consolidarGrupoEquipe(res: ProjecaoResultado): ProjecaoConsolidadoGrupo
 *   :623  agruparPorEstado(res: ProjecaoResultado): ProjecaoGrupoEstado[]
 *   :668  promotoresEmRisco(res: ProjecaoResultado): ProjecaoPromotor[]
 *   :688  agruparPorSupervisor(res: ProjecaoResultado, gestores = res.gestores ?? [])
 * Todos leem só `res.promotores`, `res.naoAtribuido` (com `?.`) e `res.gestores`.
 * Devolvendo um ProjecaoResultado bem formado, nenhum precisa mudar.
 */

/** Zerado e explícito: a árvore do gestor não tem balde master (ver naoAtribuido abaixo). */
const NAO_ATRIBUIDO_VAZIO = {
  total: { acumulada: 0, projecao: 0, count: 0 },
  porCnpj: {},
};

/**
 * Série do promotor -> EntradaMensal[], para o helper canônico de média.
 *
 * A conversão é só de nome de campo: a série do /equipe já vem somada por
 * competência (uma entrada por mês), então o agrupamento que mediaTresMeses faz
 * é no-op aqui. É de propósito que o helper aceita as duas formas — o caminho do
 * sócio entrega linhas cruas do PMR, várias por competência.
 */
function entradasDaSerie(
  meses: TeamProductionPayload["perPromoterMonthly"][number]["months"],
): EntradaMensal[] {
  return meses.map((m) => ({ year: m.year, month: m.month, valor: m.production_value }));
}

/**
 * Uma linha do time vira um ProjecaoPromotor.
 *
 * O QUE NÃO É RECALCULADO: `projecao` é o `projection_value` que
 * buildTeamProduction já produziu com projetarPorRitmo sobre a janela dele
 * (teamProduction.ts, bloco "projeção do mês SELECIONADO"). Reimplementar ritmo
 * aqui recriaria a divergência que aquele bloco documenta ter eliminado.
 *
 * `percent_projetado` é razão projeção/meta — a MESMA conta de
 * projecaoMetas.ts:374 (`meta > 0 ? projecao / meta : null`). Note que NÃO é o
 * `attainment_percent` do /equipe, que é realizado/meta em pontos percentuais:
 * a /projecao raciocina sobre a projeção, e em ratio 0-1.
 */
function promotorDoGestor(
  row: TeamPromoterRow,
  janela: TeamProductionPayload["janela"],
  media3m: number,
): ProjecaoPromotor {
  const projecao = row.projection_value;
  const meta = row.meta;
  const percent = meta > 0 ? projecao / meta : null;
  const tend = tendenciaDe(projecao, media3m);

  return {
    promoter_id: row.promoter_id,
    promoter_name: row.promoter_name,
    company_id: row.company_id ?? "",
    company_name: row.company_name ?? "—",
    // A vw_team_production não expõe CNPJ e o /equipe não o resolve. A tela do
    // gestor não renderiza CNPJ em lugar nenhum (só company_name), então vazio
    // aqui é ausência honesta, não zero inventado.
    company_cnpj: "",
    estado: asEstado(row.estado),
    supervisor_user_id: row.supervisor_id,
    producao_acumulada: row.production_value,
    dias_uteis_decorridos: janela.dias_uteis_decorridos,
    dias_uteis_ritmo: janela.dias_uteis_ritmo,
    dias_uteis_totais: janela.dias_uteis_totais,
    projecao,
    meta,
    percent_projetado: percent,
    // media_3m: soma por competência, média dos meses. Ver mediaTresMesesAnteriores.
    media_3m: media3m,
    tendencia: tend.tendencia,
    tendencia_percent: tend.tendencia_percent,
    semaforo: semaforoFromPercent(percent),
    // SEGURO — comissão fica ZERO por IMPOSSIBILIDADE de origem, não por opção:
    // insurance_commission_amount é uma das colunas fisicamente omitidas da
    // vw_team_production (migration 20260701_000003, linhas 26-33). O ramo do
    // gestor na rota OMITE o KPI que leria esses campos, então o zero não chega
    // à tela como número.
    seguro_comissao_acumulada: 0,
    seguro_comissao_projecao: 0,
    seguro_share_acumulada: 0,
    seguro_share_projecao: 0,
    // Penetração VEM (a view tem has_insurance/insurance_value/gross_value).
    // /equipe entrega em pontos percentuais; a /projecao trabalha em fração.
    seguro_penetracao: row.insurance_penetration_percent / 100,
  };
}

/** PromoterMonthPoint (0-100) -> SerieMesPonto (fração), para reusar agregarSerieGrupo. */
function pontosDaSerie(
  meses: TeamProductionPayload["perPromoterMonthly"][number]["months"],
): SerieMesPonto[] {
  return meses.map((m) => ({
    year: m.year,
    month: m.month,
    label: m.label,
    producao: m.production_value,
    // O /equipe já colapsou "sem base" em 0 (teamProduction, montagem de
    // perPromoterMonthly). Não dá para recuperar o null aqui; 0 entra como
    // penetração real. Só afeta a MÉDIA PONDERADA das séries por estado/
    // supervisor, e nenhum dos dois drills plota penetração — só produção.
    penetracao_seg: m.insurance_penetration_percent / 100,
    fonte: "pmr",
  }));
}

/**
 * Converte o payload do time no ProjecaoResultado do gestor.
 *
 * `naoAtribuido` sai ZERADO e a rota o OMITE do JSON. Não é lacuna a preencher
 * depois: a chave master tem assigned_promoter_id nulo e is_master=true, e o
 * helper current_user_team_promoter_ids exclui master explicitamente
 * (migration 20260701_000003, linha 86 — `and coalesce(p.is_master, false) = false`).
 * Balde master não é rede de ninguém; a view o exclui por construção.
 */
export function projecaoResultadoDoGestor(
  team: TeamProductionPayload,
): ProjecaoResultado {
  const janela = team.janela;

  // Série por promotor indexada ANTES do map: a média dos 3 meses sai dela.
  const mesesById = new Map(team.perPromoterMonthly.map((pm) => [pm.promoter_id, pm.months]));

  const promotores = team.rows.map((r) =>
    promotorDoGestor(
      r,
      janela,
      mediaTresMeses(
        entradasDaSerie(mesesById.get(r.promoter_id) ?? []),
        team.period.year,
        team.period.month,
      ),
    ),
  );

  // gestores: montado a partir dos PRÓPRIOS pares (supervisor_id, supervisor_name)
  // que buildTeamProduction já resolveu por service_role sobre ids autorizados.
  // NÃO consulta app_users daqui — a policy app_users_select_own devolveria só a
  // linha do próprio gestor. `role` e `manager_user_id` ficam nulos: o /equipe não
  // os traz, e agruparPorSupervisor lida com ausência (role null -> a tela rotula
  // o card como "Supervisor"; manager_name null -> o sufixo some).
  const gestoresById = new Map<string, ProjecaoGestor>();
  for (const r of team.rows) {
    if (!r.supervisor_id || gestoresById.has(r.supervisor_id)) continue;
    gestoresById.set(r.supervisor_id, {
      id: r.supervisor_id,
      full_name: r.supervisor_name,
      email: "",
      role: "supervisor",
      manager_user_id: null,
    });
  }

  // ---- séries do drill-down ----
  const infoById = new Map(promotores.map((p) => [p.promoter_id, p]));
  const serieById = new Map<string, SerieMesPonto[]>();
  for (const pm of team.perPromoterMonthly) {
    serieById.set(pm.promoter_id, pontosDaSerie(pm.months));
  }

  const perPromoterMonthly: PromotorHistorico[] = team.perPromoterMonthly.map((pm) => {
    const info = infoById.get(pm.promoter_id);
    return {
      promoter_id: pm.promoter_id,
      promoter_name: info?.promoter_name ?? "—",
      estado: info?.estado ?? null,
      supervisor_user_id: info?.supervisor_user_id ?? null,
      company_id: info?.company_id ?? "",
      company_name: info?.company_name ?? "—",
      meses: pm.months.map((m) => ({
        year: m.year,
        month: m.month,
        label: m.label,
        producao: m.production_value,
        penetracao_seg: m.insurance_penetration_percent / 100,
        meta: m.meta,
        percent: m.meta > 0 ? m.production_value / m.meta : null,
        fonte: "pmr" as SerieMesPonto["fonte"],
      })),
    };
  });

  // Agrupa as séries por estado e por supervisor com o MESMO agregador que o
  // /equipe usa para a série do time (média de penetração ponderada por produção).
  const agrupaSeries = (chaveDe: (p: ProjecaoPromotor) => string) => {
    const buckets = new Map<string, { ids: string[]; series: SerieMesPonto[][] }>();
    for (const p of promotores) {
      const k = chaveDe(p);
      const b = buckets.get(k) ?? { ids: [], series: [] };
      b.ids.push(p.promoter_id);
      const s = serieById.get(p.promoter_id);
      if (s) b.series.push(s);
      buckets.set(k, b);
    }
    return buckets;
  };

  const NULO = "__NULL__";

  const perEstadoMonthly: EstadoHistorico[] = Array.from(
    agrupaSeries((p) => p.estado ?? NULO).entries(),
  ).map(([key, b]) => {
    const estado = key === NULO ? null : (key as Estado);
    return {
      estado,
      estado_label: estado ? ESTADO_LABEL[estado] : "Não classificado",
      promotor_count: b.ids.length,
      meses: agregarSerieGrupo(b.series),
    };
  });

  const perSupervisorMonthly: SupervisorHistorico[] = Array.from(
    agrupaSeries((p) => p.supervisor_user_id ?? NULO).entries(),
  ).map(([key, b]) => {
    const g = key === NULO ? undefined : gestoresById.get(key);
    return {
      supervisor_user_id: key === NULO ? null : key,
      supervisor_name:
        key === NULO ? "Sem supervisor" : (g?.full_name && g.full_name.trim()) || "Supervisor",
      supervisor_role: g ? g.role : null,
      promotor_count: b.ids.length,
      meses: agregarSerieGrupo(b.series),
    };
  });

  return {
    year: team.period.year,
    month: team.period.month,
    // A janela já traz o recorte; referenceDate espelha o fim dela. A tela não lê
    // este campo (é o único de ProjecaoResultado sem consumidor na /projecao).
    referenceDate: janela.fim,
    fechado: team.fechado,
    janela: {
      inicio: janela.inicio,
      fim: janela.fim,
      dias_uteis_totais: janela.dias_uteis_totais,
      dias_uteis_decorridos: janela.dias_uteis_decorridos,
      dias_uteis_ritmo: janela.dias_uteis_ritmo,
    },
    promotores,
    naoAtribuido: NAO_ATRIBUIDO_VAZIO,
    gestores: Array.from(gestoresById.values()),
    perPromoterMonthly,
    perEstadoMonthly,
    perSupervisorMonthly,
  };
}

// ============================================================
// PAYLOAD DA ROTA — montado AQUI, não inline no route.ts, para que o gate
// (scripts/gate_projecao_gestor.mts) exercite a MESMA função que a rota serve.
// Se isto vivesse no handler, o gate testaria uma cópia.
// ============================================================

/**
 * Chaves de COMISSÃO que saem do payload do gestor.
 *
 * Os agregadores precisam delas para rodar (totaliza() soma
 * seguro_comissao_* e daria NaN se faltassem), então a limpeza acontece DEPOIS
 * da agregação, na saída. Zeradas elas seriam inofensivas na tela, mas a régua
 * é AUSÊNCIA e não zero: campo de comissão presente convida o próximo a
 * preenchê-lo. `seguro_penetracao` NÃO entra nesta lista — o gestor tem
 * penetração e ela é renderizada.
 */
const CHAVES_COMISSAO = [
  "seguro_comissao_acumulada",
  "seguro_comissao_projecao",
  "seguro_share_acumulada",
  "seguro_share_projecao",
] as const;

function semComissao<T extends object>(o: T): Omit<T, (typeof CHAVES_COMISSAO)[number]> {
  const copia = { ...o } as Record<string, unknown>;
  for (const k of CHAVES_COMISSAO) delete copia[k];
  return copia as Omit<T, (typeof CHAVES_COMISSAO)[number]>;
}

/** Idem para nao_atribuido: balde master não é rede de ninguém, então some. */
function semNaoAtribuido<T extends object>(o: T): Omit<T, "nao_atribuido"> {
  const copia = { ...o } as Record<string, unknown>;
  delete copia.nao_atribuido;
  return copia as Omit<T, "nao_atribuido">;
}

/**
 * Monta o JSON que /api/projecao devolve ao supervisor/gerente_regional.
 *
 * COMISSÃO DE GESTÃO — a base NÃO é somada aqui. Entra pronta:
 *   base realizada  = team.totals.production_value
 *                     (lib/equipe/teamProduction.ts:663, `production_value: tNet`,
 *                      onde tNet é acumulado na :479 `tNet += acc.net`)
 *   base projetada  = team.period_projection.production_value
 *                     (lib/equipe/teamProduction.ts:679, `projetar(tNet)`)
 * Em mês FECHADO a projeção não é oferecida: passa null e o card mostra só o
 * realizado.
 */
export function montarPayloadGestor(
  team: TeamProductionPayload,
  lideranca: { resultado: ResultadoLideranca; base: BaseLiderancaDetalhada },
) {
  const res = projecaoResultadoDoGestor(team);

  // A remuneracao NAO e calculada aqui. Chega pronta de lib/remuneracaoLideranca
  // (regua versionada) sobre a base de lib/lideranca/baseLideranca. Esta funcao
  // so monta o JSON — e por isso o gate consegue provar que tela e motor dao o
  // MESMO numero: e literalmente o mesmo objeto.
  const comissao = {
    percentual: lideranca.resultado.regua.aliquota,
    piso: lideranca.resultado.regua.piso,
    base_calculo: lideranca.resultado.regua.base_calculo,
    criterio: lideranca.resultado.criterio,
    valor: lideranca.resultado.valor,
    valor_aliquota: lideranca.resultado.valor_aliquota,
    valor_piso: lideranca.resultado.valor_piso,
    base_comissao_avista: lideranca.base.comissao_avista,
    base_producao_liquida: lideranca.base.producao_liquida,
    comissao_media: lideranca.base.comissao_media,
    fonte: lideranca.base.fonte,
    parcial: lideranca.base.parcial,
    ads_producao_sem_comissao_apurada: lideranca.base.ads_producao_sem_comissao_apurada,
    ads_linhas_sem_comissao_apurada: lideranca.base.ads_linhas_sem_comissao_apurada,
  };

  const consolidado = semNaoAtribuido(semComissao(consolidarGrupoEquipe(res)));

  const grupos = agruparPorEstado(res).map((g) => ({
    ...semNaoAtribuido(semComissao(g)),
    promotores: g.promotores.map(semComissao),
  }));

  const gruposSupervisor = agruparPorSupervisor(res).map((g) => ({
    ...semComissao(g),
    promotores: g.promotores.map(semComissao),
  }));

  // OMISSÕES DELIBERADAS (ausência, nunca zero inventado):
  //   companies                      -> o gestor não escolhe empresa; a rede
  //                                     dele é o recorte, não o CNPJ.
  //   seguro_comissao_grupo_empresa  -> comissão da empresa não é do gestor
  //                                     (decisão Diego) e a coluna está fora da
  //                                     view (20260701_000003:26-33).
  //   nao_atribuido                  -> o helper exclui is_master (:86).
  // A tela esconde cada seção pela AUSÊNCIA do campo — ver EquipeView.
  return {
    scope: "equipe" as const,
    year: res.year,
    month: res.month,
    referenceDate: res.referenceDate,
    fechado: res.fechado,
    janela: res.janela,
    consolidado,
    comissao_gestao: comissao,
    grupos,
    gruposSupervisor,
    gestores: res.gestores ?? [],
    risco: promotoresEmRisco(res).map(semComissao),
    total_promotores: res.promotores.length,
    perPromoterMonthly: res.perPromoterMonthly ?? [],
    perEstadoMonthly: res.perEstadoMonthly ?? [],
    perSupervisorMonthly: res.perSupervisorMonthly ?? [],
  };
}
