import { apiGuardErrorResponse, withAuthenticatedAnon } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/auth/supabaseServerClient";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nowInFortaleza } from "@/lib/dateFortaleza";
import { buildTeamProduction } from "@/lib/equipe/teamProduction";
import { montarPayloadGestor } from "@/lib/projecao/gestorAdapter";
import {
  agruparPorEstado,
  agruparPorSupervisor,
  buildProjecaoMetas,
  consolidarGrupoEquipe,
  promotoresEmRisco,
} from "@/lib/projecaoMetas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PAINEL DE METAS & PROJEÇÃO.
// socio/funcionario -> visao de equipe (consolidado + grupos por CNPJ + risco).
// promotor -> SOMENTE a projecao do proprio promoter_id (nunca outros, nunca ranking).
export async function GET(req: Request) {
  try {
    const { user, supabase } = await withAuthenticatedAnon();
    const role = user.session.appUser.role;

    const { searchParams } = new URL(req.url);
    // Competência corrente no fuso America/Fortaleza, NÃO UTC (mesma base do
    // Dashboard) — senão às 21h BRT a Projeção pularia para o mês seguinte e
    // divergiria do Dashboard. searchParams continua podendo sobrescrever.
    const hoje = nowInFortaleza();
    const year = Number(searchParams.get("year") || 0) || hoje.year;
    const month = Number(searchParams.get("month") || 0) || hoje.month;
    // GESTOR (supervisor | gerente_regional) — ramo PROPRIO, antes do motor do
    // socio. Nao passa por buildProjecaoMetas de proposito: aquele motor le 8
    // tabelas CRUAS que nao tem policy para estes papeis e devolveria vazio.
    //
    // A autorizacao e a mesma da /equipe e nasce no BANCO: buildTeamProduction le
    // vw_team_production (WHERE por current_user_team_promoter_ids) com o client
    // ANON, e monthly_targets pela policy monthly_targets_gestor_select. O
    // service_role entra la dentro so para resolver ATRIBUTO (nome, estado,
    // empresa, PMR de producao/penetracao) sobre ids que a view ja autorizou.
    //
    // O adaptador e PURO: nao le banco, so troca o formato para o que os 4
    // agregadores da /projecao ja consomem.
    if (role === "supervisor" || role === "gerente_regional") {
      const db = await createSupabaseServerClient();
      const admin = getSupabaseAdmin();
      const team = await buildTeamProduction(db, admin, { year, month });
      // O payload e montado no adaptador, NAO aqui: e a mesma funcao que o
      // scripts/gate_projecao_gestor.mts exercita. Inline, o gate testaria copia.
      return Response.json(montarPayloadGestor(team));
    }

    // Promotor nao filtra por empresa (so ve a si mesmo).
    const companyId =
      role === "promotor" ? undefined : searchParams.get("companyId") || undefined;

    const res = await buildProjecaoMetas(supabase, { year, month, companyId });

    if (role === "promotor") {
      const myId = user.session.appUser.promoterId;
      const promotor = res.promotores.find((p) => p.promoter_id === myId) || null;

      // Historico dos 3 meses anteriores SO do proprio promotor.
      let historico: Array<{ key: string; production: number }> = [];
      if (myId) {
        const priors = [3, 2, 1].map((k) => {
          const dt = new Date(Date.UTC(year, month - 1 - k, 1));
          return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
        });
        const { data } = await supabase
          .from("promoter_monthly_results")
          .select("year, month, production_value")
          .eq("promoter_id", myId);
        const map = new Map(
          (data || []).map((r: any) => [`${r.year}-${r.month}`, Number(r.production_value || 0)])
        );
        historico = priors.map((p) => ({
          key: `${String(p.month).padStart(2, "0")}/${String(p.year).slice(-2)}`,
          production: map.get(`${p.year}-${p.month}`) || 0,
        }));
      }

      return Response.json({
        scope: "promotor",
        year,
        month,
        referenceDate: res.referenceDate,
        fechado: res.fechado,
        janela: res.janela,
        promotor,
        historico,
      });
    }

    // Lista de empresas para o filtro (estavel, independente do filtro atual).
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name, cnpj")
      .order("name", { ascending: true });

    const consolidado = consolidarGrupoEquipe(res);
    // TOTAL de comissao-EMPRESA de seguro do GRUPO (KPI da EquipeView):
    //   ABERTO = Σ §188 por promotor (consolidado.seguro_comissao_acumulada);
    //   FECHADO = fechamento_mensal_empresa.valor_seguro (mesma fonte do dashboard/
    //   financeiro — nao existe empresa por-promotor no fechado).
    let seguroComissaoGrupoEmpresa = consolidado.seguro_comissao_acumulada;
    if (res.fechado) {
      const { data: fechSeguro } = await supabase
        .from("fechamento_mensal_empresa")
        .select("valor_seguro")
        .eq("ano", year)
        .eq("mes", month);
      const soma = (fechSeguro || []).reduce(
        (sum, r) => sum + (Number((r as { valor_seguro?: number | null }).valor_seguro ?? 0) || 0),
        0
      );
      seguroComissaoGrupoEmpresa = Math.round(soma * 100) / 100;
    }

    return Response.json({
      scope: "equipe",
      year,
      month,
      referenceDate: res.referenceDate,
      fechado: res.fechado,
      janela: res.janela,
      selectedCompanyId: companyId || "",
      companies: companies || [],
      consolidado,
      seguro_comissao_grupo_empresa: seguroComissaoGrupoEmpresa,
      grupos: agruparPorEstado(res),
      gruposSupervisor: agruparPorSupervisor(res),
      gestores: res.gestores ?? [],
      risco: promotoresEmRisco(res),
      total_promotores: res.promotores.length,
      // ADITIVO — séries do drill-down histórico HÍBRIDO (só socio/funcionario,
      // escopo equipe). Guard inalterado; sem expansão de role.
      perPromoterMonthly: res.perPromoterMonthly ?? [],
      perEstadoMonthly: res.perEstadoMonthly ?? [],
      perSupervisorMonthly: res.perSupervisorMonthly ?? [],
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
