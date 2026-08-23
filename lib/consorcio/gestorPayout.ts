// FRENTE DE PRODUTO — Movimento 2b: PAYOUT do gestor de consorcio (10%).
//
// O gestor recebe 10% de TODA a comissao-empresa do consorcio, de TODAS as empresas.
// NAO depende da atribuicao ao promotor (e sobre o total): a proposta que o PROPRIO
// gestor vender continua na base — ele recebe os dois lados (0,40 como beneficiario
// de gestao, em gestao_venda_propria, e 0,10 aqui). Nao ha, nem deve haver, exclusao
// por dono: computeGestorBaseByCompany recebe SO as entries e nao conhece a fila.
//
// Calculado no reconsolidar e gravado em consorcio_gestor_payout (SEPARADO da PMR).
// Idempotente: upsert por (competencia, company_id) -> recomputar nao paga 2x.
//
// DOIS NIVEIS, decisao Diego de 23/08/2026 ("o pagamento deve ser por proposta"):
//   QUEM PAGA  -> consorcio_gestor_payout, por (competencia, company_id), com UM
//                 round sobre o agregado. E o registro do pagamento; nao muda.
//   O DETALHE  -> consorcio_gestor_payout_proposta, uma linha por PROPOSTA, com um
//                 round cada. Informativo: responde "quanto o gestor ganhou nesta
//                 proposta", que e a pergunta que a tela faz.
//
// A SOMA DO DETALHE NAO FECHA COM O AGREGADO, e isso e esperado. MEDIDO em
// 23/08/2026: 2026-06 agregado 1.190,31 x detalhe 1.190,30; 2026-07 agregado
// 1.480,32 x detalhe 1.480,31. Delta -0,01 nos dois. E a diferenca entre 1 round e
// N rounds, nao um defeito — por isso ela e GRAVADA em
// consorcio_gestor_payout.delta_arredondamento, em vez de ser redescoberta a cada
// vez que alguem conferir.
//
// JUNHO/2026 E LEGADO: ja foi paga ao gestor pelo valor agregado. A linha dela leva
// formato='AGREGADO_LEGADO' e NAO recebe detalhe — reconsolidar junho nao inventa
// linhas por proposta numa competencia paga. Ver
// scripts/sql/2026-08-23_consorcio_gestor_por_proposta.sql
//
// FECHADO PROTEGE O VALOR (decisao Diego, 23/08/2026). A linha do AGREGADO com
// status='FECHADO' NAO e reescrita pelo reconsolidar: o upsert dela e pulado, e o
// retorno diz quais foram puladas (`agregado_pulado`) — nunca em silencio, porque
// quem chama precisa saber que pediu gravacao e nao houve.
//
// POR QUE: sem isso, FECHADO seria rotulo decorativo. Medido em 23/08 com as duas
// competencias ja fechadas, o proximo reconsolidar reescreveria
// base_comissao_empresa, gestor_10, gestor_user_id e delta_arredondamento. Hoje os
// numeros recalculados sao iguais, entao seria inocuo — mas uma reimportacao com
// dado diferente mudaria em silencio o valor de uma competencia PAGA. O guard e por
// (competencia, company_id), nao pela competencia inteira: uma empresa fechada nao
// congela a outra.
//
// AUSENCIA DE LINHA NAO E FECHADO. Competencia nova (sem linha no payout) grava
// normal — senao a guarda impediria o primeiro calculo de existir.
//
// O DETALHE CONTINUA RODANDO com a competencia fechada. Ele nao e o registro de
// pagamento; e a explicacao de como o numero se formou. Travar o detalhe deixaria
// uma competencia fechada sem como conferir a propria conta.
//
// CONSEQUENCIA ACEITA, ESCRITA PARA NAO VIRAR BUG-REPORT: com julho ja FECHADA
// antes de qualquer reconsolidar, o `delta_arredondamento` dela fica NULL PARA
// SEMPRE — o -0,01 so entraria pelo upsert do agregado, que agora nao roda. Gravar
// o centavo la e um UPDATE consciente no Studio, nao efeito colateral de recalculo.
import type { SupabaseClient } from "@supabase/supabase-js";
import { FATOR_REPASSE_GESTOR_CONSORCIO } from "./trp210.ts";
import { fetchConsorcioEntries, isRegular, type ConsorcioEntry } from "./fila.ts";

type SupabaseLike = SupabaseClient;

const round2 = (v: number) => Math.round(v * 100) / 100;

export type GestorPayoutLinha = {
  company_id: string | null;
  base_comissao_empresa: number;
  gestor_10: number;
};

/** Uma linha de DETALHE: os 10% do gestor numa PROPOSTA. */
export type GestorPayoutProposta = {
  company_id: string | null;
  proposta: string;
  base_comissao_empresa: number;
  gestor_10: number;
  parcelas: number;
};

/** Rotulo do formato da competencia (coluna `formato` do agregado). */
export const FORMATO_LEGADO = "AGREGADO_LEGADO";

// Base por empresa (PURA): Sigma comissao-empresa consorcio das parcelas regulares.
export function computeGestorBaseByCompany(entries: ConsorcioEntry[]): GestorPayoutLinha[] {
  const base = new Map<string, number>();
  for (const e of entries.filter(isRegular)) {
    const k = e.company_id ?? "NULL";
    base.set(k, (base.get(k) || 0) + Number(e.commission_value || 0));
  }
  return [...base.entries()].map(([k, v]) => ({
    company_id: k === "NULL" ? null : k,
    base_comissao_empresa: round2(v),
    gestor_10: round2(v * FATOR_REPASSE_GESTOR_CONSORCIO),
  }));
}

// Base por PROPOSTA (PURA): mesma regua do agregado — Sigma comissao-empresa das
// parcelas REGULARES — so que agrupada por (empresa, proposta) e com UM round por
// proposta. NAO substitui computeGestorBaseByCompany: as duas convivem de proposito
// (uma paga, a outra detalha). Ver o cabecalho do arquivo.
export function computeGestorBaseByProposta(entries: ConsorcioEntry[]): GestorPayoutProposta[] {
  const por = new Map<string, GestorPayoutProposta>();
  for (const e of entries.filter(isRegular)) {
    const proposta = String(e.operation_number ?? "").trim();
    if (!proposta) continue; // sem proposta nao ha unidade de detalhe
    const k = `${e.company_id ?? "NULL"}|${proposta}`;
    const cur =
      por.get(k) ||
      ({
        company_id: e.company_id ?? null,
        proposta,
        base_comissao_empresa: 0,
        gestor_10: 0,
        parcelas: 0,
      } as GestorPayoutProposta);
    cur.base_comissao_empresa += Number(e.commission_value || 0);
    cur.parcelas += 1;
    por.set(k, cur);
  }
  // O round da BASE vem antes do round do repasse, para o detalhe reproduzir
  // exatamente o que a tela mostra (que soma a comissao-empresa da proposta e so
  // depois aplica o fator).
  for (const l of por.values()) {
    l.base_comissao_empresa = round2(l.base_comissao_empresa);
    l.gestor_10 = round2(l.base_comissao_empresa * FATOR_REPASSE_GESTOR_CONSORCIO);
  }
  return [...por.values()].sort((a, b) => a.proposta.localeCompare(b.proposta));
}

// Resolve o gestor ATIVO pelo ROLE (standing, igual supervisor/gerente). O grupo tem
// um; se houver mais de um ativo (transitorio), pega o mais antigo (determinismo).
// null quando ninguem tem o role ainda -> payout nasce orfao (a RLS por role o resolve
// quando o gestor for cadastrado).
async function gestorAtivoPorRole(supabase: SupabaseLike): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_users")
    .select("id")
    .eq("role", "gestor_consorcio")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function computeConsorcioGestorPayout(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<{
  competencia: string;
  gestor_user_id: string | null;
  total_10: number;
  linhas: GestorPayoutLinha[];
  propostas: GestorPayoutProposta[];
  total_10_detalhe: number;
  delta_arredondamento: number;
  legado: boolean;
  /** Linhas de agregado efetivamente gravadas (0 em dryRun). */
  agregado_gravado: number;
  /** Empresas cujo agregado NAO foi gravado porque a competencia esta FECHADA. */
  agregado_pulado: Array<{ company_id: string | null; motivo: "FECHADO" }>;
}> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  const entries = await fetchConsorcioEntries(supabase, { year, month });
  const linhas = computeGestorBaseByCompany(entries);
  const total_10 = round2(linhas.reduce((s, l) => s + l.gestor_10, 0));

  // DETALHE por proposta + o delta que o round por linha produz.
  const propostas = computeGestorBaseByProposta(entries);
  const total_10_detalhe = round2(propostas.reduce((s, l) => s + l.gestor_10, 0));
  const delta_arredondamento = round2(total_10_detalhe - total_10);

  // UM probe responde as tres perguntas: a migration ja rodou? esta competencia e
  // LEGADO (paga pelo agregado, sem detalhe)? e quais empresas ja estao FECHADAS?
  // Tudo isso mora no BANCO, nao aqui — data ou lista hardcoded envelheceria em
  // silencio.
  const { aplicada, legado, fechadas } = await probeCompetencia(supabase, competencia);
  // CARIMBO LEVE: quem e o gestor NO MOMENTO da reconsolidacao (resolvido pelo role
  // ativo, nao por tela). Cada competencia guarda quem estava responsavel quando foi
  // paga (historico do pagamento). null = ainda sem gestor cadastrado.
  const gestor_user_id = await gestorAtivoPorRole(supabase);

  // GUARD DO FECHADO — por (competencia, company_id). A linha fechada sai do
  // payload; as demais gravam normal. Sai do payload, nao do calculo: `linhas` e
  // `total_10` continuam inteiros no retorno, para quem so quer conferir.
  const chaveFechada = (companyId: string | null) => `${companyId ?? "NULL"}`;
  const agregado_pulado = linhas
    .filter((l) => fechadas.has(chaveFechada(l.company_id)))
    .map((l) => ({ company_id: l.company_id, motivo: "FECHADO" as const }));
  const gravaveis = linhas.filter((l) => !fechadas.has(chaveFechada(l.company_id)));
  let agregado_gravado = 0;

  if (!dryRun && gravaveis.length > 0) {
    const payload = gravaveis.map((l) => ({
      competencia,
      company_id: l.company_id,
      gestor_user_id,
      base_comissao_empresa: l.base_comissao_empresa,
      gestor_10: l.gestor_10,
      updated_at: new Date().toISOString(),
      // O centavo vai no MESMO upsert que ja grava a linha — um write, nao dois.
      // So quando a coluna existe: sem a migration, mandar o campo derrubaria a
      // gravacao do payout inteiro por coluna desconhecida.
      ...(aplicada ? { delta_arredondamento } : {}),
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("consorcio_gestor_payout")
        .upsert(payload.slice(i, i + 500), { onConflict: "competencia,company_id" });
      if (error) throw new Error(error.message);
    }
    agregado_gravado = payload.length;
  }
  // ---- DETALHE por proposta ----
  // Tolera a migration ainda NAO aplicada: so PGRST204/205 (tabela ou coluna que o
  // PostgREST nao conhece) passa. Qualquer outro erro SOBE — senao um bug de
  // escrita viraria "nao gravou e ninguem viu".
  if (!dryRun && aplicada && !legado && propostas.length > 0) {
    const payload = propostas.map((l) => ({
      competencia,
      company_id: l.company_id,
      proposta: l.proposta,
      gestor_user_id,
      base_comissao_empresa: l.base_comissao_empresa,
      gestor_10: l.gestor_10,
      parcelas: l.parcelas,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("consorcio_gestor_payout_proposta")
        .upsert(payload.slice(i, i + 500), { onConflict: "competencia,company_id,proposta" });
      if (error && !ausenteNoSchema(error)) throw new Error(error.message);
      if (error) break; // migration ainda nao aplicada: segue sem detalhe
    }
  }

  return {
    competencia,
    gestor_user_id,
    total_10,
    linhas,
    propostas,
    total_10_detalhe,
    delta_arredondamento,
    legado,
    agregado_gravado,
    agregado_pulado,
  };
}

/**
 * "Isto ainda nao existe no banco" — migration nao aplicada.
 *
 * SAO QUATRO CODIGOS, NAO UM. Medido em 23/08/2026 contra producao: pedir uma
 * COLUNA que nao existe devolve **42703** (undefined_column) do proprio Postgres,
 * NAO um PGRST*. Tolerar so PGRST205 derrubava o reconsolidar inteiro enquanto o
 * SQL nao rodasse no Studio — que e exatamente a janela em que a tolerancia
 * precisa existir.
 *   42703   coluna inexistente (o caso de `formato`)
 *   42P01   tabela/relacao inexistente
 *   PGRST205 tabela fora do schema cache do PostgREST
 *   PGRST204 coluna fora do schema cache (aparece no upsert)
 */
function ausenteNoSchema(error: { code?: string; message?: string }): boolean {
  const code = String(error?.code || "");
  if (["42703", "42P01", "PGRST205", "PGRST204"].includes(code)) return true;
  return /schema cache|does not exist/i.test(String(error?.message || ""));
}

/**
 * Le o estado da competencia no payout. Responde tres perguntas de uma vez:
 *   aplicada -> a migration 2026-08-23 ja rodou (a coluna `formato` existe)?
 *   legado   -> esta competencia foi paga pelo agregado e NAO recebe detalhe?
 *   fechadas -> quais company_id ja estao com status='FECHADO' (nao reescrever).
 *
 * DUAS TENTATIVAS DE PROPOSITO. `status` existe desde a migration original;
 * `formato` so depois de 2026-08-23. Uma consulta unica pedindo as duas colunas
 * falharia INTEIRA quando a segunda nao existe (42703) e levaria junto a leitura
 * do status — que e a guarda do dinheiro. Entao: tenta com as duas; se a coluna
 * nova nao existe, refaz so com `status`. Sem NENHUMA das duas (tabela ausente),
 * devolve tudo vazio e o codigo segue como antes.
 */
async function probeCompetencia(
  supabase: SupabaseLike,
  competencia: string
): Promise<{ aplicada: boolean; legado: boolean; fechadas: Set<string> }> {
  const vazio = { aplicada: false, legado: false, fechadas: new Set<string>() };

  let aplicada = true;
  let res: any = await supabase
    .from("consorcio_gestor_payout")
    .select("company_id, formato, status")
    .eq("competencia", competencia);
  if (res.error) {
    if (!ausenteNoSchema(res.error)) throw new Error(res.error.message);
    aplicada = false;
    res = await supabase
      .from("consorcio_gestor_payout")
      .select("company_id, status")
      .eq("competencia", competencia);
    if (res.error) {
      if (ausenteNoSchema(res.error)) return vazio;
      throw new Error(res.error.message);
    }
  }

  const linhas = (res.data || []).filter((r: any) => r && typeof r === "object");
  const fechadas = new Set<string>();
  for (const r of linhas) {
    // AUSENCIA DE LINHA NAO E FECHADO: so entra aqui a linha que EXISTE e diz
    // FECHADO. Competencia nova nao tem linha, o Set fica vazio, e grava normal.
    if (String(r.status) === "FECHADO") fechadas.add(`${r.company_id ?? "NULL"}`);
  }
  return {
    aplicada,
    legado: linhas.some((r: any) => String(r.formato) === FORMATO_LEGADO),
    fechadas,
  };
}
