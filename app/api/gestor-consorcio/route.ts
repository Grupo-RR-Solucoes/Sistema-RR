import { NextResponse } from "next/server";

import { apiGuardErrorResponse, requireGestorConsorcio } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchAllRows } from "@/lib/queryHelpers";
import { fetchVendaPropriaDoUsuario } from "@/lib/gestaoVendaPropria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// TELA DO GESTOR DE CONSORCIO (M3 PARTE C). O gestor e definido pelo ROLE
// (gestor_consorcio, standing — igual supervisor/gerente). Ele ve:
//   1) o payout de 10% (consorcio_gestor_payout) — TODO o payout, pois e o unico
//      gestor. Sem filtro por id -> ele ve inclusive as linhas orfas (gestor_user_id
//      null gravado antes de existir gestor). Trocar o gestor = trocar o role.
//   2) a PRODUCAO GERAL do consorcio (carteira_consorcio, todos os vendedores) —
//      valor/segmento/base, "quem vendeu quanto".
//   3) a VENDA PROPRIA dele (gestao_venda_propria, SO as linhas do proprio
//      app_user_id): as vendas que ele mesmo fez, com o mesmo percentual de um
//      promotor. Ele NAO e promotor — nao ha promoter_id nem PMR envolvidos.
//      Os 10% de gestao e a venda propria SOMAM (na venda dele: 40% aqui + 10% la),
//      porque a base do payout ja inclui a parcela que ele vendeu.
// CRITICO: NUNCA le promoter_monthly_results.consorcio_commission_value (o repasse de
// 40% dos promotores). Mesma disciplina INVERTIDA do /equipe: mostra producao, esconde
// a comissao alheia. Escola A: requireGestorConsorcio (gate por role) + service_role.
// READ-ONLY.
// ============================================================

type PayoutRow = {
  competencia: string;
  company_id: string | null;
  base_comissao_empresa: number;
  gestor_10: number;
  status: string;
};

type CarteiraRow = {
  promoter_id: string | null;
  app_user_id: string | null;
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
        .select("promoter_id, app_user_id, proposta, segmento_grupo, valor_bem, comissao_esperada, comissao_recebida, status")
    );
    const proms = await admin.from("promoters").select("id, name");
    if (proms.error) throw new Error(proms.error.message);
    const nameOf = new Map((proms.data || []).map((p: any) => [p.id, p.name]));
    // Vendedores que NAO sao promotores (papeis de gestao com venda propria). Sem isto
    // a proposta vendida pela gestao apareceria como "(nao atribuido)" — a tela
    // mentiria sobre uma venda que tem dono. Allow-list: so id e nome.
    const gest = await admin
      .from("app_users")
      .select("id, full_name, email")
      .eq("venda_propria", true);
    if (gest.error) throw new Error(gest.error.message);
    const gestaoNameOf = new Map(
      (gest.data || []).map((g: any) => [g.id, String(g.full_name || g.email || "(gestão)")])
    );

    type Acc = {
      promoter_id: string | null;
      promoter_name: string;
      is_gestao: boolean;
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
      const k = c.promoter_id ?? (c.app_user_id ? `gestao:${c.app_user_id}` : "__NAO_ATRIBUIDO__");
      let a = porProm.get(k);
      if (!a) {
        const nome = c.promoter_id
          ? nameOf.get(c.promoter_id) ?? "(promotor removido)"
          : c.app_user_id
            ? `${gestaoNameOf.get(c.app_user_id) ?? "(gestão)"} — venda própria`
            : "(não atribuído)";
        a = {
          promoter_id: c.promoter_id,
          promoter_name: nome,
          is_gestao: Boolean(!c.promoter_id && c.app_user_id),
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
        is_gestao: a.is_gestao,
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

    // 3) MINHA VENDA PROPRIA — as vendas que o PROPRIO gestor fez, com o mesmo
    // percentual de um promotor. Le gestao_venda_propria filtrado pelo app_user_id
    // DELE (fetchVendaPropriaDoUsuario nem tem variante "todos"): nunca vaza a venda
    // propria de outro papel de gestao, nem a comissao de promotor.
    //
    // Ele NAO e promotor: aqui nao ha promoter_id, PMR nem buildPromoterAnalytics.
    // Vazio (sem venda propria habilitada/atribuida) -> o bloco nao aparece na tela.
    const vp = await fetchVendaPropriaDoUsuario(admin, session.appUser.id);
    const vendaPropria =
      vp.competencias.length > 0
        ? { habilitada: true, total: vp.total, competencias: vp.competencias }
        : null;

    return NextResponse.json({ competencias, total, producao, vendaPropria });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
