import { NextResponse } from "next/server";

import { apiGuardErrorResponse, requireGestorConsorcio } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllRows } from "@/lib/queryHelpers";
import { buildPromoterAnalytics } from "@/lib/promoterAnalytics";
import { detectMonthRegime } from "@/lib/cmsMonthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M3 PARTE C). O gestor e definido pelo ROLE
// (gestor_consorcio, standing — igual supervisor/gerente). Ele ve:
//   1) o payout de 10% (consorcio_gestor_payout) — TODO o payout, pois e o unico
//      gestor. Sem filtro por id -> ele ve inclusive as linhas orfas (gestor_user_id
//      null gravado antes de existir gestor). Trocar o gestor = trocar o role.
//   2) a PRODUCAO GERAL do consorcio (carteira_consorcio, todos os promotores) —
//      valor/segmento/base, "quem vendeu quanto".
// CRITICO: NUNCA le promoter_monthly_results.consorcio_commission_value (o repasse de
// 40% dos promotores). Mesma disciplina INVERTIDA do /equipe: mostra producao, esconde
// a comissao alheia. Escola A: requireGestorConsorcio (gate por role) + service_role.
//
//   3) "MINHAS VENDAS": quando o gestor TAMBEM e promotor (app_users.promoter_id
//      setado, standing — mesmo campo do papel promotor, ja na sessao), mostra a
//      producao COMPLETA dele como promotor (credito+seguro+bbcap+cc+consorcio) reusando
//      o MESMO buildPromoterAnalytics da /promotores, filtrado por session.appUser
//      .promoterId. So o proprio id -> nao vaza a comissao de OUTROS promotores.
// READ-ONLY.
// ============================================================

const COMP_RE = /^\d{4}-\d{2}$/;

type PayoutRow = {
  competencia: string;
  company_id: string | null;
  base_comissao_empresa: number;
  gestor_10: number;
  status: string;
};

type CarteiraRow = {
  promoter_id: string | null;
  proposta: string;
  segmento_grupo: string | null;
  valor_bem: number;
  comissao_esperada: number;
  comissao_recebida: number | null;
  status: string;
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: Request) {
  try {
    // Gate por role. O gestor logado -> so o proprio payout.
    const { session } = await requireGestorConsorcio();
    const admin = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    // 1) PAYOUT dos 10%. O gestor e UNICO (definido pelo role) -> ele ve TODO o payout
    // do consorcio, inclusive as linhas ainda ORFAS (gestor_user_id null, gravadas
    // antes de existir gestor). Sem filtro por id: e assim que o Alan passa a ver os
    // R$1.190,31 de junho no instante em que ganha o role, sem re-carimbar.
    const payoutRows = await fetchAllRows<PayoutRow>(() =>
      admin
        .from("consorcio_gestor_payout")
        .select("competencia, company_id, base_comissao_empresa, gestor_10, status")
    );
    const porComp = new Map<string, { competencia: string; base: number; gestor_10: number; empresas: number }>();
    for (const r of payoutRows) {
      const cur =
        porComp.get(r.competencia) || { competencia: r.competencia, base: 0, gestor_10: 0, empresas: 0 };
      cur.base = r2(cur.base + Number(r.base_comissao_empresa || 0));
      cur.gestor_10 = r2(cur.gestor_10 + Number(r.gestor_10 || 0));
      cur.empresas += 1;
      porComp.set(r.competencia, cur);
    }
    const competencias = [...porComp.values()].sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
    const total = r2(competencias.reduce((s, c) => s + c.gestor_10, 0));

    // 2) PRODUCAO GERAL do consorcio — carteira_consorcio. ALLOW-LIST de producao:
    // proposta/segmento/valor/base. NUNCA a coluna de repasse do promotor (PMR).
    const carteira = await fetchAllRows<CarteiraRow>(() =>
      admin
        .from("carteira_consorcio")
        .select("promoter_id, proposta, segmento_grupo, valor_bem, comissao_esperada, comissao_recebida, status")
    );
    const proms = await admin.from("promoters").select("id, name");
    if (proms.error) throw new Error(proms.error.message);
    const nameOf = new Map((proms.data || []).map((p: any) => [p.id, p.name]));

    type Acc = {
      promoter_id: string | null;
      promoter_name: string;
      propostas: Set<string>;
      parcelas_recebidas: number;
      base_recebida: number; // comissao-empresa recebida (base do consorcio, NAO o 40%)
      valor_bem: number;
    };
    const porProm = new Map<string, Acc>();
    let totBaseRecebida = 0;
    const propostasGerais = new Set<string>();
    for (const c of carteira) {
      const recebida = c.status === "RECEBIDA" || c.status === "ENCERRADA";
      const k = c.promoter_id ?? "__NAO_ATRIBUIDO__";
      let a = porProm.get(k);
      if (!a) {
        a = {
          promoter_id: c.promoter_id,
          promoter_name: c.promoter_id ? nameOf.get(c.promoter_id) ?? "(promotor removido)" : "(não atribuído)",
          propostas: new Set(),
          parcelas_recebidas: 0,
          base_recebida: 0,
          valor_bem: 0,
        };
        porProm.set(k, a);
      }
      a.propostas.add(c.proposta);
      propostasGerais.add(c.proposta);
      if (recebida) {
        a.parcelas_recebidas += 1;
        const base = Number(c.comissao_recebida || 0);
        a.base_recebida = r2(a.base_recebida + base);
        totBaseRecebida = r2(totBaseRecebida + base);
      }
      // valor_bem e por parcela; somamos so a 1a posicao por proposta para nao inflar.
    }
    const porPromotor = [...porProm.values()]
      .map((a) => ({
        promoter_id: a.promoter_id,
        promoter_name: a.promoter_name,
        propostas: a.propostas.size,
        parcelas_recebidas: a.parcelas_recebidas,
        base_recebida: a.base_recebida,
      }))
      .sort((x, y) => y.base_recebida - x.base_recebida);

    const producao = {
      total_propostas: propostasGerais.size,
      total_base_recebida: totBaseRecebida,
      por_promotor: porPromotor,
    };

    // 3) MINHAS VENDAS — o gestor tambem e promotor? O vinculo e STANDING em
    // app_users.promoter_id (mesmo campo do papel promotor), ja carregado na sessao.
    // Se houver, reusa buildPromoterAnalytics (mesma logica da /promotores) filtrado
    // por esse id, para a competencia pedida (?competencia) ou a corrente. NUNCA outros
    // promotores. null = gestor puro -> bloco nao aparece.
    let minhasVendas: any = null;
    const meuPromoterId: string | null = session.appUser.promoterId ?? null;
    if (meuPromoterId) {
      const compParam = searchParams.get("competencia") || "";
      let year: number;
      let month: number;
      if (COMP_RE.test(compParam)) {
        const [y, m] = compParam.split("-").map(Number);
        year = y;
        month = m;
      } else {
        // sem parametro: usa a competencia mais recente do payout.
        const base = competencias[0]?.competencia || "";
        const [y, m] = (COMP_RE.test(base) ? base : "2026-06").split("-").map(Number);
        year = y;
        month = m;
      }

      let closed = false;
      let closedSource: "cms" | "fechamento" | undefined;
      try {
        const regime = await detectMonthRegime(admin, year, month);
        closed = regime !== "open";
        closedSource = regime === "open" ? undefined : regime;
      } catch {
        closed = false;
      }

      const analytics = await buildPromoterAnalytics(admin, {
        year,
        month,
        promoterId: meuPromoterId,
        closed,
        closedSource,
      });
      const s = (analytics.summaryRows || []).find((r: any) => r.promoter_id === meuPromoterId);
      const nome = s?.promoter_name || nameOf.get(meuPromoterId) || "(minhas vendas)";
      const num = (v: any) => Number(v || 0);
      minhasVendas = {
        vinculado: true,
        promoter_id: meuPromoterId,
        promoter_nome: nome,
        competencia: `${year}-${String(month).padStart(2, "0")}`,
        production_value: num(s?.production_value),
        production_commission_value: num(s?.production_commission_value),
        insurance_commission_value: num(s?.insurance_commission_value),
        bbcap_commission_value: num(s?.bbcap_commission_value),
        conta_corrente_commission_value: num(s?.conta_corrente_commission_value),
        consorcio_commission_value: num(s?.consorcio_commission_value),
        final_commission_value: num(s?.final_commission_value),
        payable_commission_value: num(s?.payable_commission_value),
      };
    }

    return NextResponse.json({ competencias, total, producao, minhasVendas });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
