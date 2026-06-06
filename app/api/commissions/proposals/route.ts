import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioOrFuncionarioAnon } from "@/lib/auth/guards";
import { canManageCommissionRule } from "@/lib/auth/permissions";
import {
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
  type InsuranceShareTier,
} from "@/lib/insuranceCalculator";
import {
  computeComissaoPromotor,
  computePromoterInsuranceAmount,
  fetchPromoterShareData,
  getAVistaPercent,
  getAgencyCode,
  getCompanyCommissionAmount,
  getInstallmentCount,
  getSrccRestrictionLabel,
  isInssRecord,
  recalculateSingleProposal,
  resolvePromoterShareSync,
} from "@/lib/proposalDetailing";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectClosedMonth } from "@/lib/cmsMonthly";
import { buildCmsProposalRows, buildCmsProposalRowsBatch } from "@/lib/promoterReportData";

// Mês FECHADO (cms) — mapeia a CmsProposalRow (ground truth pago) para o shape
// que a tela /comissoes/editar renderiza, em modo READ-ONLY. Sem chave de edição
// (id é da entry cms, não daily_production_record_id) e sem cascata de share.
function mapCmsRowToEditor(r: any, promoterName: string) {
  return {
    ...r,
    promoter_name: promoterName,
    a_vista_percent: r.company_received_percent,
    promoter_insurance_amount: r.insurance_commission_amount,
    promoter_share_amount: r.promoter_commission_amount,
    commission_rule_id: null,
    manual_notes: "",
    share_percent_input: "",
    share_percent_effective: null,
    share_percent_source: "cms",
    share_percent_override: null,
    promotiva_status: "FECHADO",
    read_only: true,
  };
}

// FIX-1.E.6.F — formata uma faixa da scale SEGURO_SLIP em rotulo
// legivel para a UI. Bordas inferiores inclusivas, superiores
// exclusivas (consistente com lookupInsuranceShareFromPenetration).
//   [0.00, 0.10) → 0.10 → "0-10% → 10%"
//   [0.10, 0.20) → 0.25 → "10-20% → 25%"
//   [0.20, 0.30) → 0.35 → "20-30% → 35%"
//   [0.30, NULL) → 0.50 → "30%+ → 50%"
function formatInsuranceShareBandLabel(tier: InsuranceShareTier | null): string {
  if (!tier) return "—";
  const minPct = Math.round(tier.volume_min * 100);
  const sharePct = Math.round(tier.share_percent * 100);
  if (tier.volume_max === null) {
    return `${minPct}%+ → ${sharePct}%`;
  }
  const maxPct = Math.round(tier.volume_max * 100);
  return `${minPct}-${maxPct}% → ${sharePct}%`;
}

function findInsuranceShareTier(
  tiers: InsuranceShareTier[],
  penetracaoDecimal: number
): InsuranceShareTier | null {
  if (!Number.isFinite(penetracaoDecimal)) return null;
  return (
    tiers.find((t) => {
      if (penetracaoDecimal < t.volume_min) return false;
      if (t.volume_max !== null && penetracaoDecimal >= t.volume_max) return false;
      return true;
    }) || null
  );
}

// audit_logs RLS bloqueia INSERT via PostgREST. Mesmo padrao usado em
// /api/financeiro/[id] e /api/admin/usuarios/[id]: service_role para
// escrever, fail-safe try/catch para nao bloquear a operacao primaria.
async function writeAuditEntry(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string,
  entityId: string | null,
  action: string
) {
  try {
    const admin = getSupabaseAdmin();
    await admin.from("audit_logs").insert({
      entity_name: "promoter_proposal_commissions",
      entity_id: entityId,
      action,
      description,
      payload,
      created_by: createdBy,
    });
  } catch (auditErr) {
    console.error(
      "Falha ao escrever audit_logs em /api/commissions/proposals",
      auditErr
    );
  }
}

type ProductionRecord = {
  id: string;
  company_id: string | null;
  assigned_promoter_id: string | null;
  proposal_number: string | null;
  contract_number: string | null;
  product_code: string | null;
  product_description: string | null;
  convenio_code: string | null;
  j_key: string | null;
  contract_date: string | null;
  interest_rate: number | null;
  installments: number | null;
  term_months: number | null;
  company_received_percent: number | null;
  is_srcc_restricted: boolean | null;
  gross_value: number | null;
  net_value: number | null;
  insurance_value: number | null;
  promoter_commission_percent: number | null;
  promoter_commission_amount: number | null;
  insurance_commission_percent: number | null;
  insurance_commission_amount: number | null;
  commission_rule_source: string | null;
  movement_date: string | null;
  status: string | null;
  raw_payload: Record<string, unknown> | null;
};

type PromoterRow = {
  id: string;
  name: string;
};

type ManualRuleRow = {
  id: string;
  daily_production_record_id: string;
  promoter_id: string;
  commission_percent: number | null;
  insurance_commission_percent: number | null;
  share_percent_override: number | null;
  notes: string | null;
  active: boolean | null;
};

function getMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function fetchAllPaged<T>(baseQueryBuilder: () => any): Promise<T[]> {
  let from = 0;
  const pageSize = 1000;
  const all: T[] = [];

  while (true) {
    const { data, error } = await baseQueryBuilder().range(
      from,
      from + pageSize - 1
    );

    if (error) throw error;
    if (!data || data.length === 0) break;

    all.push(...(data as T[]));

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioOrFuncionarioAnon();
    const { searchParams } = new URL(req.url);

    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));
    const companyId = searchParams.get("companyId");
    const promoterId = searchParams.get("promoterId");

    if (!year || !month) {
      return NextResponse.json(
        { error: "Informe year e month." },
        { status: 400 }
      );
    }

    // Mês FECHADO por cms -> a produção vive em cms_promoter_entries (ground
    // truth pago), NÃO no daily. Retorna as linhas do cms em READ-ONLY (mesma
    // fonte do PromotorView/relatório). Sem caminho de edição.
    let closedMonth = false;
    try {
      closedMonth = await detectClosedMonth(supabase, year, month);
    } catch {
      closedMonth = false;
    }
    if (closedMonth) {
      let ids: string[] = [];
      if (promoterId) {
        ids = [promoterId];
      } else {
        let q = supabase
          .from("cms_promoter_entries")
          .select("promoter_id")
          .eq("prod_year", year)
          .eq("prod_month", month)
          .not("promoter_id", "is", null);
        if (companyId) q = q.eq("company_id", companyId);
        const { data } = await q;
        ids = [...new Set((data || []).map((r: any) => r.promoter_id as string))];
      }
      if (ids.length === 0) {
        return NextResponse.json({ rows: [], promoterInsuranceSummaries: [], closed: true, proposalSource: "cms" });
      }
      const { data: proms } = await supabase.from("promoters").select("id, name").in("id", ids);
      const nameById = new Map((proms || []).map((p: any) => [p.id, p.name as string]));
      const cmsRows: any[] = [];
      if (ids.length === 1) {
        const list = await buildCmsProposalRows(supabase, ids[0], year, month);
        for (const r of list) cmsRows.push(mapCmsRowToEditor(r, nameById.get(ids[0]) || ""));
      } else {
        const byProm = await buildCmsProposalRowsBatch(supabase, ids, year, month);
        for (const [pid, list] of byProm) {
          for (const r of list) cmsRows.push(mapCmsRowToEditor(r, nameById.get(pid) || ""));
        }
      }
      return NextResponse.json({ rows: cmsRows, promoterInsuranceSummaries: [], closed: true, proposalSource: "cms" });
    }

    const { start, end } = getMonthRange(year, month);

    const records = await fetchAllPaged<ProductionRecord>(() => {
      let query = supabase
        .from("daily_production_records")
        .select(`
          id,
          company_id,
          assigned_promoter_id,
          proposal_number,
          contract_number,
          product_code,
          product_description,
          convenio_code,
          j_key,
          contract_date,
          interest_rate,
          installments,
          term_months,
          company_received_percent,
          is_srcc_restricted,
          gross_value,
          net_value,
          insurance_value,
          promoter_commission_percent,
          promoter_commission_amount,
          insurance_commission_percent,
          insurance_commission_amount,
          commission_rule_source,
          movement_date,
          status,
          raw_payload
        `)
        .gte("movement_date", start)
        .lt("movement_date", end)
        .not("assigned_promoter_id", "is", null)
        // FIX-1.E.2: filtra Status='Produção' server-side. Cancelados +
        // Em Aberto inflavam a tela /comissoes/editar (Thaynara 36 vs 31
        // real abr/2026) e geravam falsos NULL em company_received_percent.
        // Promotiva exporta exatamente "Produção" (com acento). Cancelados
        // ficam em /promotores -> bloco Descontos. /api/calculate/monthly
        // ja faz o mesmo filtro via isProductionStatus(record.status).
        .eq("status", "Produção")
        .order("movement_date", { ascending: false });

      if (companyId) {
        query = query.eq("company_id", companyId);
      }

      if (promoterId) {
        query = query.eq("assigned_promoter_id", promoterId);
      }

      return query;
    });

    const promoterIds: string[] = [
      ...new Set(
        records
          .map((r) => r.assigned_promoter_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    let promoters: PromoterRow[] = [];
    if (promoterIds.length > 0) {
      const { data, error } = await supabase
        .from("promoters")
        .select("id, name")
        .in("id", promoterIds);

      if (error) throw error;
      promoters = (data || []) as PromoterRow[];
    }

    // 4.4-fix-1.E (D2): "% PENETRACAO" e agregacao mensal por (promoter,
    // company) vinda de promoter_monthly_results, NAO eh por proposta.
    // Fetch agregado em batch para todos os promotores que aparecem nas
    // rows do mes, mapeado para `${promoter_id}|${company_id}`.
    //
    // FIX-1.E.6.F — alem da penetracao, agora trazemos
    // insurance_commission_value (gravado em promoter_monthly_results)
    // para o card "Comissao seguro promotor" na UI. Em abril/2026 esse
    // valor ainda eh Promotiva total (gate insuranceShareScaleActive=false
    // em /api/calculate/monthly); em maio+ vira o repasse Modelo B real.
    const penetrationMap = new Map<string, number | null>();
    const persistedInsuranceMap = new Map<string, number | null>();
    if (promoterIds.length > 0) {
      const { data: penetrationRows, error: penetrationError } = await supabase
        .from("promoter_monthly_results")
        .select(
          "promoter_id, company_id, insurance_penetration_percent, insurance_commission_value"
        )
        .eq("year", year)
        .eq("month", month)
        .in("promoter_id", promoterIds);

      if (penetrationError) throw penetrationError;
      for (const row of penetrationRows ?? []) {
        const key = `${row.promoter_id}|${row.company_id}`;
        penetrationMap.set(key, row.insurance_penetration_percent ?? null);
        persistedInsuranceMap.set(key, row.insurance_commission_value ?? null);
      }
    }

    // FIX-1.E.6.F — pre-carrega tiers da scale SEGURO_SLIP_MAIO_2026
    // (cardinality 4 apos E.2). 1 round-trip, reusado para todos os
    // promotores do mes.
    const insuranceShareTiers: InsuranceShareTier[] = await fetchInsuranceSlipTiers(
      supabase
    );

    // FIX-1.E.6.F — gate de vigencia espelha o de /api/calculate/monthly:
    // UI usa essa flag para decidir se mostra badge "Projetado" no card de
    // seguro promotor.
    // FIX-6 (Diego): repasse de 50% vale desde MARCO/2026. Gate antecipado
    // de month>=5 para month>=3 (espelha o de calculate/monthly:739).
    const insuranceShareScaleActive =
      year > 2026 || (year === 2026 && month >= 3);

    // FIX-1.E.6.F.4 — manualRules filtrado por promoter_id (39 ids) em
    // vez de daily_production_record_id (519 ids). Em abr/2026 sem
    // filtro de promoter, 519 UUIDs no .in() faziam a URL ao PostgREST
    // estourar 16KB de headers (UND_ERR_HEADERS_OVERFLOW, undici).
    // promoter_proposal_commissions nao tem coluna de mes/empresa, mas o
    // .find() client-side em records.map ja matcha por daily_production_
    // record_id === record.id e descarta naturalmente regras de outros
    // meses (records ja esta recortado pelo movement_date do mes).
    // .eq("active", true) reduz transferencia (find ja checa active).
    let manualRules: ManualRuleRow[] = [];
    if (promoterIds.length > 0) {
      const { data, error } = await supabase
        .from("promoter_proposal_commissions")
        .select(
          "id, daily_production_record_id, promoter_id, commission_percent, insurance_commission_percent, share_percent_override, notes, active"
        )
        .in("promoter_id", promoterIds)
        .eq("active", true);

      if (error) throw error;
      manualRules = (data || []) as ManualRuleRow[];
    }

    // Dia 4.5 Etapa B: pre-carrega 3 maps (profiles + escalas + volume
    // mensal) para a cascata sync de share_percent. fetchPromoterShareData
    // faz no maximo 3-4 queries em batch independente do numero de rows.
    const {
      profilesMap,
      scalesMap,
      monthlyVolumesMap,
      goalRepasseMap,
      targetsMap,
      frenteCProductionMap,
    } = await fetchPromoterShareData(supabase, promoterIds, year, month);

    const rows = records.map((record) => {
      const promoter = promoters.find((p) => p.id === record.assigned_promoter_id);
      const manual = manualRules.find(
        (m) => m.daily_production_record_id === record.id && m.active !== false
      );

      // 4.4-fix-1.E: % efetivo legacy (mantido em promoter_commission_percent
      // para back-compat com outras telas/consumidores). 4.5 Etapa B nao
      // mexe nesse comportamento.
      const promoterPercentEffective =
        manual?.commission_percent ?? record.promoter_commission_percent;
      const insurancePercentEffective =
        manual?.insurance_commission_percent ??
        record.insurance_commission_percent;

      // 4.4-fix-1.E (D2): % PENETRACAO mensal por (promoter, company).
      const penetrationKey = `${record.assigned_promoter_id ?? ""}|${record.company_id ?? ""}`;
      const insurancePenetrationPercent =
        penetrationMap.get(penetrationKey) ?? null;

      // Dia 4.5 Etapa B: cascata nova de share_percent.
      const aVistaPercent = getAVistaPercent(record);
      const overrideValue = manual?.share_percent_override ?? null;
      // FRENTE C — monta o input da fonte única (mesma do calculate/monthly):
      // produção VÁLIDA, metas, Aldalene INSS, faixa 5,80%.
      const pid = record.assigned_promoter_id ?? "";
      const aVistaClampedRec = Math.min(Math.max(Number(aVistaPercent ?? 0), 0), 5.8);
      const tgt = targetsMap.get(pid);
      const frenteC = {
        goalRepasse: goalRepasseMap.get(pid) ?? null,
        productionValue: frenteCProductionMap.get(pid) ?? 0,
        target1Value: tgt?.meta1 ?? 0,
        target2Value: tgt?.meta2 ?? 0,
        isAldaleneInss:
          String(promoter?.name ?? "").toUpperCase().includes("ALDALENE") && isInssRecord(record),
        isFaixa580: aVistaClampedRec >= 5.8 - 0.001,
      };
      const shareResolution = resolvePromoterShareSync({
        record: {
          assigned_promoter_id: record.assigned_promoter_id,
          share_percent_override: overrideValue,
        },
        profilesMap,
        scalesMap,
        monthlyVolumesMap,
        frenteC,
      });

      return {
        ...record,
        commission_base_value: record.net_value,
        promoter_name: promoter?.name || null,
        commission_rule_id: manual?.id ?? null,
        promoter_commission_percent: promoterPercentEffective,
        insurance_commission_percent: insurancePercentEffective,
        manual_notes: manual?.notes || "",
        // 4.4-fix-1.B
        agency_code: getAgencyCode(record),
        srcc_restriction: getSrccRestrictionLabel(record),
        installment_count: getInstallmentCount(record),
        company_commission_amount: getCompanyCommissionAmount(record),
        // 4.4-fix-1.E (D1+D2)
        a_vista_percent: aVistaPercent,
        insurance_penetration_percent: insurancePenetrationPercent,
        // Dia 4.5 Etapa B: novos campos de cascata.
        // share_percent_effective vem em DECIMAL (0..1). UI multiplica
        // por 100 para exibir "66,66%". sharePercent === 1.0 = 100%.
        share_percent_effective: shareResolution.sharePercent,
        share_percent_source: shareResolution.source,
        share_percent_override: overrideValue,
        // COMISSAO PROMOTOR recalculada com a cascata nova:
        // net_value × min(a_vista, 5.8) / 100 × sharePercent
        promoter_share_amount: computeComissaoPromotor(
          record.net_value,
          aVistaPercent,
          shareResolution.sharePercent
        ),
        // COMISSAO SEGURO PROMOTOR: formula legada mantida (Etapa C
        // refatora). insurance_commission_amount × % seguro / 100.
        promoter_insurance_amount: computePromoterInsuranceAmount(
          record.insurance_commission_amount,
          insurancePercentEffective
        ),
        // FIX-1.E.2: expoe status da Promotiva. SELECT filtra por
        // 'Produção', entao todos os rows tem esse valor; manter no
        // shape facilita debug/auditoria e prepara para futura coluna
        // visual (badge "Cancelado"/"Em Aberto" se filtro for relaxado).
        promotiva_status: record.status,
      };
    });

    // FIX-1.E.6.F.3 — promoterInsuranceSummaries soh eh montado quando
    // promoterId foi informado no request. A UI (/comissoes/editar) soh
    // renderiza os 2 cards de seguro Modelo B quando ha promotor
    // selecionado; sem promoterId os cards ficam escondidos. Computar o
    // mes inteiro era custo morto + caminho onde a regressao do GET sem
    // promoterId aparecia. Quando "Todos", retornamos array vazio.
    const promoterInsuranceSummaries: Array<{
      promoter_id: string;
      company_id: string;
      insurance_penetration_percent: number | null;
      insurance_share_applied: number;
      insurance_share_band_label: string;
      insurance_promotiva_total: number;
      insurance_projected_promoter_value: number;
      insurance_commission_value: number | null;
      insurance_share_scale_active: boolean;
    }> = [];

    if (promoterId) {
      const summariesByKey = new Map<
        string,
        { promoter_id: string; company_id: string; promotiva_total: number }
      >();
      for (const r of records) {
        if (!r.assigned_promoter_id || !r.company_id) continue;
        const key = `${r.assigned_promoter_id}|${r.company_id}`;
        const prev =
          summariesByKey.get(key) ||
          {
            promoter_id: r.assigned_promoter_id,
            company_id: r.company_id,
            promotiva_total: 0,
          };
        prev.promotiva_total += Number(r.insurance_commission_amount ?? 0);
        summariesByKey.set(key, prev);
      }
      for (const s of summariesByKey.values()) {
        const key = `${s.promoter_id}|${s.company_id}`;
        const penetrationPct = penetrationMap.get(key) ?? null;
        const penetracaoDecimal =
          penetrationPct == null ? 0 : penetrationPct / 100;
        const tier = findInsuranceShareTier(
          insuranceShareTiers,
          penetracaoDecimal
        );
        const shareApplied = tier ? tier.share_percent : 0;
        const bandLabel = formatInsuranceShareBandLabel(tier);
        const projected = s.promotiva_total * shareApplied;
        promoterInsuranceSummaries.push({
          promoter_id: s.promoter_id,
          company_id: s.company_id,
          insurance_penetration_percent: penetrationPct,
          insurance_share_applied: shareApplied,
          insurance_share_band_label: bandLabel,
          insurance_promotiva_total: s.promotiva_total,
          insurance_projected_promoter_value: projected,
          insurance_commission_value: persistedInsuranceMap.get(key) ?? null,
          insurance_share_scale_active: insuranceShareScaleActive,
        });
      }
    }

    return NextResponse.json({ rows, promoterInsuranceSummaries, closed: false, proposalSource: "daily" });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    if (!canManageCommissionRule(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para editar regras de comissao." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as {
      dailyProductionRecordId?: string;
      promoterId?: string;
      commissionPercent?: number | null;
      insuranceCommissionPercent?: number | null;
      sharePercentOverride?: number | null;
      notes?: string | null;
    };

    const dailyProductionRecordId = body.dailyProductionRecordId;
    const promoterId = body.promoterId;
    const commissionPercent = body.commissionPercent;
    const insuranceCommissionPercent = body.insuranceCommissionPercent;
    // Dia 4.5 Etapa B: novo campo de override editavel pela UI.
    const sharePercentOverride = body.sharePercentOverride;
    const notes = body.notes;

    if (!dailyProductionRecordId || !promoterId) {
      return NextResponse.json(
        { error: "Informe dailyProductionRecordId e promoterId." },
        { status: 400 }
      );
    }

    // Trava de servidor (defesa em profundidade): mês FECHADO por cms é
    // ground truth da Promotiva — não editável. Bloqueia mesmo que a UI
    // (que esconde os controles em read-only) seja burlada.
    {
      const { data: rec } = await supabase
        .from("daily_production_records")
        .select("movement_date")
        .eq("id", dailyProductionRecordId)
        .maybeSingle();
      if (!rec || !rec.movement_date) {
        return NextResponse.json(
          { error: "Proposta não encontrada (mês consolidado via cms não é editável)." },
          { status: 404 }
        );
      }
      const d = new Date(rec.movement_date);
      const closed = await detectClosedMonth(supabase, d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => false);
      if (closed) {
        return NextResponse.json(
          { error: "Mês consolidado via cms (valores finais da Promotiva) — não editável." },
          { status: 403 }
        );
      }
    }

    // Fetch previo para audit (snapshot do valor anterior, se existir)
    const { data: previous } = await supabase
      .from("promoter_proposal_commissions")
      .select(
        "id, commission_percent, insurance_commission_percent, share_percent_override, notes"
      )
      .eq("daily_production_record_id", dailyProductionRecordId)
      .maybeSingle();

    // Monta payload preservando os campos NAO enviados (back-compat).
    const upsertPayload: Record<string, unknown> = {
      daily_production_record_id: dailyProductionRecordId,
      promoter_id: promoterId,
      active: true,
    };
    if (commissionPercent !== undefined) {
      upsertPayload.commission_percent = commissionPercent;
    }
    if (insuranceCommissionPercent !== undefined) {
      upsertPayload.insurance_commission_percent = insuranceCommissionPercent;
    }
    if (sharePercentOverride !== undefined) {
      upsertPayload.share_percent_override = sharePercentOverride;
    }
    if (notes !== undefined) {
      upsertPayload.notes = notes;
    }

    const { data: upserted, error } = await supabase
      .from("promoter_proposal_commissions")
      .upsert(upsertPayload, {
        onConflict: "daily_production_record_id",
      })
      .select("id")
      .single();

    if (error) throw error;

    await writeAuditEntry(
      `${user.role} ${user.session.appUser.email} ${previous ? "atualizou" : "criou"} regra manual de comissao por proposta`,
      {
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        target_proposal_id: upserted?.id ?? null,
        target_daily_production_record_id: dailyProductionRecordId,
        target_promoter_id: promoterId,
        old_value: previous?.commission_percent ?? null,
        new_value: commissionPercent ?? null,
        old_insurance_percent: previous?.insurance_commission_percent ?? null,
        new_insurance_percent: insuranceCommissionPercent ?? null,
        old_notes: previous?.notes ?? null,
        new_notes: notes ?? null,
      },
      user.session.appUser.email,
      upserted?.id ?? null,
      previous ? "commission_updated" : "commission_created"
    );

    // Dia 4.5 Etapa B: recalcula promoter_commission_amount em
    // daily_production_records usando a cascata nova. Fail-safe: erro
    // de recalc nao desfaz o upsert (ja gravado).
    const recalc = await recalculateSingleProposal(
      supabase,
      dailyProductionRecordId
    );
    if (!recalc.ok) {
      console.error(
        "[recalculateSingleProposal] falhou apos POST:",
        recalc.error
      );
    }

    return NextResponse.json({
      success: true,
      message: "Regra manual da proposta salva com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();

    if (!canManageCommissionRule(user.role)) {
      return NextResponse.json(
        { error: "Voce nao tem permissao para remover regras de comissao." },
        { status: 403 }
      );
    }

    const body = (await req.json()) as { dailyProductionRecordId?: string };
    const dailyProductionRecordId = body.dailyProductionRecordId;

    if (!dailyProductionRecordId) {
      return NextResponse.json(
        { error: "Informe dailyProductionRecordId." },
        { status: 400 }
      );
    }

    // Trava de servidor: mês FECHADO por cms não é editável (idem POST).
    {
      const { data: rec } = await supabase
        .from("daily_production_records")
        .select("movement_date")
        .eq("id", dailyProductionRecordId)
        .maybeSingle();
      if (!rec || !rec.movement_date) {
        return NextResponse.json(
          { error: "Proposta não encontrada (mês consolidado via cms não é editável)." },
          { status: 404 }
        );
      }
      const d = new Date(rec.movement_date);
      const closed = await detectClosedMonth(supabase, d.getUTCFullYear(), d.getUTCMonth() + 1).catch(() => false);
      if (closed) {
        return NextResponse.json(
          { error: "Mês consolidado via cms (valores finais da Promotiva) — não editável." },
          { status: 403 }
        );
      }
    }

    // Fetch para audit snapshot antes de deletar
    const { data: target } = await supabase
      .from("promoter_proposal_commissions")
      .select(
        "id, promoter_id, commission_percent, insurance_commission_percent, notes"
      )
      .eq("daily_production_record_id", dailyProductionRecordId)
      .maybeSingle();

    const { error } = await supabase
      .from("promoter_proposal_commissions")
      .delete()
      .eq("daily_production_record_id", dailyProductionRecordId);

    if (error) throw error;

    await writeAuditEntry(
      `${user.role} ${user.session.appUser.email} removeu regra manual de comissao`,
      {
        performed_by_user_id: user.session.appUser.id,
        performed_by_email: user.session.appUser.email,
        target_daily_production_record_id: dailyProductionRecordId,
        deleted_proposal: target,
      },
      user.session.appUser.email,
      target?.id ?? null,
      "commission_deleted"
    );

    // Dia 4.5 Etapa B: recalc apos DELETE (override removido -> cascata
    // cai no profile do promotor).
    const recalc = await recalculateSingleProposal(
      supabase,
      dailyProductionRecordId
    );
    if (!recalc.ok) {
      console.error(
        "[recalculateSingleProposal] falhou apos DELETE:",
        recalc.error
      );
    }

    return NextResponse.json({
      success: true,
      message: "Regra manual removida com sucesso.",
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
