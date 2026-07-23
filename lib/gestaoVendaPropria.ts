// FRENTE DE PRODUTO — VENDA PROPRIA DE GESTAO: o ledger de quem NAO e promotor.
//
// Espelha o papel do PMR para os papeis de gestao (gestor_consorcio, supervisor,
// gerente_regional) que tambem vendem. Mesma regua do promotor — o valor ja chega
// calculado por computeProductCommissionByBeneficiario (x 0,5833 nos eventos unicos,
// x 0,40 no consorcio). Aqui so decidimos ONDE ele e gravado.
//
// NAO CONFUNDIR com consorcio_gestor_payout (os 10% de gestao): aquilo e override
// sobre o TOTAL do consorcio e continua vivendo na sua propria tabela. Na venda propria
// do gestor de consorcio as duas coisas se somam NA LEITURA (40% aqui + 10% la), porque
// a base do payout ja inclui a parcela que ele mesmo vendeu. Nenhum codigo precisa
// saber que da 50%.
//
// CREDITO ESTA FORA DO ESCOPO (decisao do Diego, 22/07): credito nasce em
// daily_production_records.promoter_id (FK promoters) e a regua e escalonada por
// faixa/meta DO PROMOTOR. A venda propria cobre BBCAP, Conta Corrente e Consorcio.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductCommissionBucket } from "./produtoAssignments.ts";
import { PAPEIS_COM_VENDA_PROPRIA } from "./produtoBeneficiario.ts";

type SupabaseLike = SupabaseClient;

const round2 = (v: number) => Math.round(v * 100) / 100;

export type VendaPropriaLinha = {
  app_user_id: string;
  company_id: string | null;
  role_snapshot: string | null;
  bbcap: number;
  conta_corrente: number;
  consorcio: number;
  lob: number;
  final: number;
};

export type VendaPropriaResultado = {
  competencia: string;
  linhas: VendaPropriaLinha[];
  total: number;
  gravadas: number;
  ignoradas_sem_flag: number;
};

/**
 * Grava a venda propria da competencia em gestao_venda_propria.
 *
 * Idempotente: upsert por (app_user_id, year, month, company_id) — recomputar nao paga
 * duas vezes. RECONCILIA a competencia: as linhas que existiam e nao estao mais no
 * conjunto novo (a proposta foi reatribuida a um promotor, ou o flag foi desligado)
 * sao APAGADAS — senao o gestor continuaria vendo uma venda que deixou de ser dele.
 *
 * TRAVA DE COERENCIA: so paga quem tem app_users.venda_propria = true E um papel de
 * gestao. Uma atribuicao feita antes de o flag ser desligado nao vira pagamento
 * fantasma; ela e contada em `ignoradas_sem_flag` (o valor volta a ficar sem dono, como
 * qualquer linha no balde).
 */
export async function applyVendaPropriaGestao(
  supabase: SupabaseLike,
  params: { year: number; month: number; buckets: ProductCommissionBucket[]; dryRun?: boolean }
): Promise<VendaPropriaResultado> {
  const { year, month, buckets } = params;
  const dryRun = params.dryRun === true;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;

  const gestao = buckets.filter((b) => b.beneficiario.kind === "gestao");

  // Papel/flag ATUAIS dos beneficiarios (carimbo leve + trava de coerencia).
  const ids = [...new Set(gestao.map((b) => b.beneficiario.id))];
  const perfil = new Map<string, { role: string; venda_propria: boolean; active: boolean }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase
      .from("app_users")
      .select("id, role, venda_propria, active")
      .in("id", ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      perfil.set(r.id, {
        role: String(r.role ?? ""),
        venda_propria: r.venda_propria === true,
        active: r.active !== false,
      });
    }
  }

  const linhas: VendaPropriaLinha[] = [];
  let ignoradas = 0;
  for (const b of gestao) {
    const p = perfil.get(b.beneficiario.id);
    const habilitado =
      p?.venda_propria === true &&
      p.active &&
      (PAPEIS_COM_VENDA_PROPRIA as readonly string[]).includes(p.role);
    if (!habilitado) {
      ignoradas += 1;
      continue;
    }
    linhas.push({
      app_user_id: b.beneficiario.id,
      company_id: b.company_id,
      role_snapshot: p!.role,
      bbcap: b.bbcap,
      conta_corrente: b.conta_corrente,
      consorcio: b.consorcio,
      lob: b.lob,
      final: round2(b.bbcap + b.conta_corrente + b.consorcio + b.lob),
    });
  }
  const total = round2(linhas.reduce((s, l) => s + l.final, 0));

  if (dryRun) {
    return { competencia, linhas, total, gravadas: 0, ignoradas_sem_flag: ignoradas };
  }

  if (linhas.length > 0) {
    const payload = linhas.map((l) => ({
      app_user_id: l.app_user_id,
      company_id: l.company_id,
      year,
      month,
      role_snapshot: l.role_snapshot,
      bbcap_commission_value: l.bbcap,
      conta_corrente_commission_value: l.conta_corrente,
      consorcio_commission_value: l.consorcio,
      lob_commission_value: l.lob,
      final_commission_value: l.final,
      source: "fechamento",
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("gestao_venda_propria")
        .upsert(payload.slice(i, i + 500), { onConflict: "app_user_id,year,month,company_id" });
      if (error) throw new Error(error.message);
    }
  }

  // Reconciliacao da competencia (espelha a do PMR em reconsolidarCompetencia):
  // o conjunto novo passa a ser a verdade; sobras viram lixo e saem.
  const novoSet = new Set(linhas.map((l) => `${l.app_user_id}|${l.company_id ?? "NULL"}`));
  const { data: existentes, error: readErr } = await supabase
    .from("gestao_venda_propria")
    .select("id, app_user_id, company_id")
    .eq("year", year)
    .eq("month", month);
  if (readErr) throw new Error(readErr.message);

  const apagar = (existentes || [])
    .filter((r: any) => !novoSet.has(`${r.app_user_id}|${r.company_id ?? "NULL"}`))
    .map((r: any) => r.id);
  for (let i = 0; i < apagar.length; i += 100) {
    const { error } = await supabase
      .from("gestao_venda_propria")
      .delete()
      .in("id", apagar.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }

  return { competencia, linhas, total, gravadas: linhas.length, ignoradas_sem_flag: ignoradas };
}

export type VendaPropriaCompetencia = {
  competencia: string;
  bbcap: number;
  conta_corrente: number;
  consorcio: number;
  final: number;
};

/**
 * Le a venda propria de UM beneficiario, agregada por competencia (soma as empresas).
 * Usada pela tela do papel de gestao. Nunca devolve a de outra pessoa — o filtro por
 * app_user_id e obrigatorio no parametro (nao ha variante "todos" aqui de proposito).
 */
export async function fetchVendaPropriaDoUsuario(
  supabase: SupabaseLike,
  appUserId: string
): Promise<{ competencias: VendaPropriaCompetencia[]; total: number }> {
  const { data, error } = await supabase
    .from("gestao_venda_propria")
    .select(
      "year, month, bbcap_commission_value, conta_corrente_commission_value, consorcio_commission_value, final_commission_value"
    )
    .eq("app_user_id", appUserId);
  if (error) throw new Error(error.message);

  const porComp = new Map<string, VendaPropriaCompetencia>();
  for (const r of data || []) {
    const competencia = `${r.year}-${String(r.month).padStart(2, "0")}`;
    const cur =
      porComp.get(competencia) ||
      { competencia, bbcap: 0, conta_corrente: 0, consorcio: 0, final: 0 };
    cur.bbcap = round2(cur.bbcap + Number(r.bbcap_commission_value || 0));
    cur.conta_corrente = round2(cur.conta_corrente + Number(r.conta_corrente_commission_value || 0));
    cur.consorcio = round2(cur.consorcio + Number(r.consorcio_commission_value || 0));
    cur.final = round2(cur.final + Number(r.final_commission_value || 0));
    porComp.set(competencia, cur);
  }
  const competencias = [...porComp.values()].sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
  return { competencias, total: round2(competencias.reduce((s, c) => s + c.final, 0)) };
}
