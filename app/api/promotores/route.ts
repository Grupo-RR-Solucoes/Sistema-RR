import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ApiGuardError,
  apiGuardErrorResponse,
  requireSocio,
  withAuthenticatedAnon,
  withSocioOrFuncionarioAnon,
} from "@/lib/auth/guards";
import { buildPromoterAnalytics } from "@/lib/promoterAnalytics";
import { clearMemoryCache } from "@/lib/memoryCache";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectMonthRegime, type MonthRegime } from "@/lib/cmsMonthly";
// FRENTE 2 / ETAPA 7 — buildCmsProposalRows agora vive em lib compartilhada
// (mesma fonte usada pelo export de relatorio, sem divergencia).
import { buildCmsProposalRows } from "@/lib/promoterReportData";
// VIRADA DE TELA — proposalRows do mês FECHADO por fechamento (jun+): fonte
// monthly_closing_entries + linhas ADS, com o campo SRCC p/ a UI colorir.
import { buildClosingProposalRows } from "@/lib/closingProposalRows";
// FRENTE DÉBITOS — leitura (detalhe + fila) e ações (cadastro manual, atribuição).
import {
  fetchPromoterDebits,
  fetchDebitQueue,
  createManualDebit,
  assignQueuedDebit,
  updateDebit,
} from "@/lib/debitsData";
// RÉGUA ÚNICA do valor do débito automático (mata o 0.7 legado desta rota).
import { debitAmountFor, fetchDebitRule, isAutoDebitType, round2 } from "@/lib/debitRules";

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Valor INICIAL que desce do promotor. É um ponto de partida, não uma trava:
 * todo débito é editável depois (valor, parcelas, promotor).
 *
 * O percentual vem SEMPRE da regra versionada da competência (debit_rule_versions,
 * via lib/debitRules) — nunca de hardcode. Até 12/07/2026 esta função aplicava
 * `companyAmount * 0.7` fixo, uma SEGUNDA régua rodando à margem do
 * debit_rule_versions e divergindo do resolvedor automático. Foi removida.
 *
 * SEM regra versionada para (tipo, competência): NÃO bloqueia e NÃO chuta percentual
 * — lança o valor CHEIO do estorno como inicial, e o sócio/auxiliar ajusta na tela.
 * O automático faz o trabalho inicial; ele nunca impede o lançamento.
 */
async function resolveDiscountAmount(
  supabase: SupabaseClient,
  discountType: string,
  amountInput: unknown,
  companyAmountInput: unknown,
  year: number,
  month: number
): Promise<number> {
  const explicitAmount = toNumber(amountInput);
  if (explicitAmount > 0) return round2(explicitAmount);

  const companyAmount = toNumber(companyAmountInput);
  if (companyAmount <= 0) return 0;

  // Tipo não-automático: desce o valor cheio.
  if (!isAutoDebitType(discountType)) return round2(companyAmount);

  // Tipo automático: regra da competência quando existe; senão, valor cheio (editável).
  const ruleRow = await fetchDebitRule(supabase, discountType, year, month);
  return round2(debitAmountFor(companyAmount, ruleRow?.rule ?? null));
}

// audit_logs RLS bloqueia INSERT via PostgREST para todos os roles
// (Dia 3 grupo G). writeAudit usa service_role para escrever, idem
// pattern Dia 4.1 (/api/admin/usuarios). createdBy recebe o email do
// usuario autenticado vindo do guard (T5 do mapa de decisoes).
async function writeAudit(
  description: string,
  payload: Record<string, unknown>,
  createdBy: string
) {
  try {
    const supabase = getSupabaseAdmin();

    await supabase.from("audit_logs").insert({
      entity_name: "promotores",
      action: "MANUAL_CHANGE",
      description,
      payload,
      created_by: createdBy,
    });
  } catch {
    // Mantem fluxo principal.
  }
}

function clearPromoterReadCaches() {
  clearMemoryCache("promoters:");
  clearMemoryCache("closing:");
  clearMemoryCache("dashboard:");
}

/**
 * Guarda #7 (AVISAR, NAO barrar): as acoes que mexem em INPUT do consolidador
 * (reassign_proposal, target_upsert, agreement_upsert, prefixar_metas) sao
 * LEGITIMAS em mes fechado — o Diego reatribui balde/master depois do fechamento
 * (medido: 38 em abril, 74 em junho). Barrar quebraria o fluxo dele. Mas a
 * mudanca fica LATENTE: o PMR ja gravado so reflete apos reconsolidar. Entao a
 * resposta carrega competencia_fechada + o alvo, e a UI oferece "Reconsolidar
 * competencia" (o fluxo Simular->Reconsolidar que ja existe, sem bypass novo).
 *
 * Mes ABERTO -> objeto vazio (nenhum flag, nenhum aviso). NAO muda numero nenhum.
 * detectMonthRegime falha -> trata como 'open' (nao inventa aviso por erro de infra).
 */
async function flagCompetenciaFechada(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<Record<string, unknown>> {
  const regime: MonthRegime = await detectMonthRegime(supabase, year, month).catch(
    () => "open" as MonthRegime
  );
  if (regime === "open") return {};
  return {
    competencia_fechada: true,
    regime,
    reconsolidar: { year, month },
    aviso:
      "Competencia fechada — a alteracao foi salva, mas o repasse so muda apos reconsolidar a competencia (Fechamento -> Reconsolidar competencia).",
  };
}

export async function GET(req: Request) {
  try {
    const { user, supabase } = await withAuthenticatedAnon();

    // Defesa em profundidade: gestores têm a própria tela (/equipe, guard
    // requireGestor). /promotores é do sócio (comissão bruta/a pagar) — a RLS
    // já não expõe o dado a eles; aqui a aplicação também barra com 403.
    // socio/funcionario/promotor seguem pelo fluxo original abaixo, intactos.
    if (
      user.session.appUser.role === "supervisor" ||
      user.session.appUser.role === "gerente_regional"
    ) {
      throw new ApiGuardError(403, "Gestores acessam /equipe, nao /promotores");
    }

    const { searchParams } = new URL(req.url);

    // 3.5.6.1 - Promotor sempre recebe propria carteira (handler-level
    // hardening). Socio/funcionario controlam via query param normalmente.
    // Necessario porque buildPromoterAnalytics so popula proposalRows
    // quando selectedPromoterId existe (lib originalmente assumia UI
    // com dropdown). RLS ja filtra os records, mas a lib precisa do id
    // explicito para sair do early-return em proposalRows = [].
    const queryPromoterId = searchParams.get("promoterId") || undefined;
    const effectivePromoterId =
      user.session.appUser.role === "promotor"
        ? user.session.appUser.promoterId ?? undefined
        : queryPromoterId;

    // buildPromoterAnalytics agora recebe o cliente do guard (Etapa 3.7).
    // Promotor passa supabase autenticado anon -> RLS filtra para o
    // proprio promoter_id; socio/funcionario veem dados completos.
    const yearN = Number(searchParams.get("year") || 0) || undefined;
    const monthN = Number(searchParams.get("month") || 0) || undefined;

    // Regime do mês ANTES do analytics (VIRADA): 'open' => LIVE_BASE (daily ao vivo);
    // 'cms' (jan-mai, seed) / 'fechamento' (jun+) => CONSOLIDADO do PMR. A precedência
    // cms > fechamento vive em detectMonthRegime. Sem year/month => 'open' aqui, mas
    // closedSource fica undefined e o analytics mantém o CALCULATED (.find) legado.
    let regime: MonthRegime = "open";
    if (yearN && monthN) {
      try {
        regime = await detectMonthRegime(supabase, yearN, monthN);
      } catch {
        regime = "open"; // tabela ausente / erro -> trata como aberto
      }
    }
    const closed = regime !== "open";
    const closedSource = regime === "open" ? undefined : regime; // 'cms' | 'fechamento'

    // DELTA (Fase 3): regime da competência ANTERIOR — define de qual fonte sai
    // o M-1 do delta ('cms' vs 'fechamento'+'bbts'). Se o M-1 ainda estiver
    // aberto (ou a detecção falhar), fica undefined e o delta some sozinho.
    let previousClosedSource: "cms" | "fechamento" | undefined;
    if (yearN && monthN) {
      const anterior = monthN <= 1 ? { year: yearN - 1, month: 12 } : { year: yearN, month: monthN - 1 };
      try {
        const regimeAnterior = await detectMonthRegime(supabase, anterior.year, anterior.month);
        previousClosedSource = regimeAnterior === "open" ? undefined : regimeAnterior;
      } catch {
        previousClosedSource = undefined;
      }
    }

    const payload = await buildPromoterAnalytics(supabase, {
      year: yearN,
      month: monthN,
      companyId: searchParams.get("companyId") || undefined,
      promoterId: effectivePromoterId,
      closed,
      closedSource,
      previousClosedSource,
      // Master é balde temporário: ao selecioná-la na aba Migração, listar o que
      // ainda está sem promotor (assigned_promoter_id NULL) p/ redistribuir.
      // Só atua no mês ABERTO — no fechado a rota retorna cmsRows antes (abaixo).
      masterUnassigned: true,
      // Modo agregado: link "aguardando atribuição" do Dashboard chega com
      // ?unassigned=1 → lista todo o balde pendente sem promotor selecionado.
      allUnassigned: searchParams.get("unassigned") === "1",
    });

    // FRENTE DÉBITOS — no mês fechado: detalhe dos débitos do promotor + fila de
    // atribuição (estornos MASTER/ADS sem dono). Só leitura; erro não quebra a tela.
    let debitRows: Awaited<ReturnType<typeof fetchPromoterDebits>> = [];
    let debitQueue: Awaited<ReturnType<typeof fetchDebitQueue>> = [];
    if (closed && yearN && monthN) {
      try {
        if (effectivePromoterId) {
          debitRows = await fetchPromoterDebits(supabase, { year: yearN, month: monthN, promoterId: effectivePromoterId });
        }
        debitQueue = await fetchDebitQueue(supabase, { year: yearN, month: monthN });
      } catch {
        // débitos são aditivos — falha aqui não derruba a tela.
      }
    }

    // Mês FECHADO: o detalhe (proposalRows) vem da fonte fechada, não do diário.
    //   'cms' (jan-mai)        -> cms_promoter_entries (ground truth do seed).
    //   'fechamento' (jun+)    -> monthly_closing_entries + linhas ADS, com SRCC.
    let proposalSource: "daily" | "cms" | "fechamento" = "daily";
    if (yearN && monthN && effectivePromoterId && closed) {
      if (regime === "cms") {
        proposalSource = "cms";
        const cmsRows = await buildCmsProposalRows(
          supabase,
          effectivePromoterId,
          yearN,
          monthN
        );
        return NextResponse.json({ ...payload, proposalRows: cmsRows, proposalSource, debitRows, debitQueue });
      }
      // regime === 'fechamento'
      proposalSource = "fechamento";
      const closingRows = await buildClosingProposalRows(
        supabase,
        effectivePromoterId,
        yearN,
        monthN
      );
      return NextResponse.json({ ...payload, proposalRows: closingRows, proposalSource, debitRows, debitQueue });
    }

    return NextResponse.json({ ...payload, proposalSource, debitRows, debitQueue });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}

export async function POST(req: Request) {
  // Hardening 3.5.5: GET continua withAuthenticatedAnon (D17 - promotor
  // le suas proprias rows via RLS), mas TODAS as 5 POST actions
  // (target_upsert, reassign_proposal, agreement_upsert, discount_upsert,
  // discount_delete) exigem socio ou funcionario. Promotor que tenta
  // qualquer escrita recebe 403 explicito do guard (vs erro silencioso
  // do RLS no INSERT/UPDATE).
  try {
    const { user, supabase } = await withSocioOrFuncionarioAnon();
    const auditActor = user.session.appUser.email;

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "target_upsert") {
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const year = Number(body.year);
      const month = Number(body.month);

      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia da meta." },
          { status: 400 }
        );
      }

      const { error } = await supabase
        .from("monthly_targets")
        .upsert(
          {
            promoter_id: promoterId,
            company_id: companyId,
            year,
            month,
            meta: toNumber(body.meta),
            meta_1: toNumber(body.meta1),
            meta_2: toNumber(body.meta2),
          },
          {
            onConflict: "promoter_id,year,month",
          }
        );

      if (error) throw error;

      clearPromoterReadCaches();
      await writeAudit(
        "Atualizacao manual de meta mensal",
        { promoter_id: promoterId, year, month },
        auditActor
      );

      // AVISAR (nao barrar): meta e input do consolidador (faixa/repasse) — em
      // mes fechado a mudanca so vale apos reconsolidar.
      const aviso = await flagCompetenciaFechada(supabase, year, month);
      return NextResponse.json({ success: true, ...aviso });
    }

    if (action === "reassign_proposal") {
      const dailyProductionRecordId = String(body.dailyProductionRecordId || "");
      const toPromoterId = String(body.toPromoterId || "");
      const reason = body.reason ? String(body.reason) : null;

      if (!dailyProductionRecordId || !toPromoterId) {
        return NextResponse.json(
          { error: "Informe a proposta e o promotor de destino." },
          { status: 400 }
        );
      }

      const { data: currentRecord, error: currentError } = await supabase
        .from("daily_production_records")
        .select("id, assigned_promoter_id, movement_date")
        .eq("id", dailyProductionRecordId)
        .single();

      if (currentError) throw currentError;

      const { error: updateError } = await supabase
        .from("daily_production_records")
        .update({
          assigned_promoter_id: toPromoterId,
          promoter_source: "MANUAL_REASSIGNMENT",
          updated_at: new Date().toISOString(),
        })
        .eq("id", dailyProductionRecordId);

      if (updateError) throw updateError;

      const { error: insertError } = await supabase
        .from("proposal_reassignments")
        .insert({
          daily_production_record_id: dailyProductionRecordId,
          from_promoter_id: currentRecord.assigned_promoter_id,
          to_promoter_id: toPromoterId,
          reason,
          changed_by: auditActor,
        });

      if (insertError) throw insertError;

      clearPromoterReadCaches();
      await writeAudit(
        "Migracao manual de proposta",
        {
          daily_production_record_id: dailyProductionRecordId,
          from_promoter_id: currentRecord.assigned_promoter_id,
          to_promoter_id: toPromoterId,
        },
        auditActor
      );

      // AVISAR (nao barrar): a reatribuicao SEMPRE funciona, inclusive em mes
      // fechado (fluxo real do Diego: migracao de balde/master pos-fechamento).
      // Em mes fechado a comissao so migra de promotor apos reconsolidar.
      const mv = currentRecord.movement_date
        ? new Date(String(currentRecord.movement_date))
        : null;
      const aviso = mv
        ? await flagCompetenciaFechada(supabase, mv.getUTCFullYear(), mv.getUTCMonth() + 1)
        : {};
      return NextResponse.json({ success: true, ...aviso });
    }

    if (action === "agreement_upsert") {
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const year = Number(body.year);
      const month = Number(body.month);
      const productionShare = String(body.productionShare ?? "").trim();
      const insuranceShare = String(body.insuranceShare ?? "").trim();
      const notes = body.notes ? String(body.notes).trim() : null;

      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia do acordo comercial." },
          { status: 400 }
        );
      }

      let deactivateQuery = supabase
        .from("promoter_agreements")
        .update({ active: false })
        .eq("promoter_id", promoterId)
        .eq("year", year)
        .eq("month", month)
        .in("agreement_type", ["PRODUCTION", "INSURANCE"]);

      if (companyId) {
        deactivateQuery = deactivateQuery.eq("company_id", companyId);
      }

      const { error: deactivateError } = await deactivateQuery;
      if (deactivateError) throw deactivateError;

      const rows = [];

      if (productionShare !== "" && toNumber(productionShare) > 0) {
        rows.push({
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          agreement_type: "PRODUCTION",
          commission_type: "SHARE_OF_COMPANY",
          commission_value: toNumber(productionShare),
          active: true,
          notes,
        });
      }

      if (insuranceShare !== "" && toNumber(insuranceShare) > 0) {
        rows.push({
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          agreement_type: "INSURANCE",
          commission_type: "SHARE_OF_COMPANY",
          commission_value: toNumber(insuranceShare),
          active: true,
          notes,
        });
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from("promoter_agreements")
          .insert(rows);

        if (insertError) throw insertError;
      }

      clearPromoterReadCaches();
      await writeAudit(
        "Atualizacao de acordo comercial do promotor",
        {
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          production_share: productionShare || null,
          insurance_share: insuranceShare || null,
        },
        auditActor
      );

      // AVISAR (nao barrar): acordo e input do share do consolidador — em mes
      // fechado so vale apos reconsolidar.
      const aviso = await flagCompetenciaFechada(supabase, year, month);
      return NextResponse.json({ success: true, ...aviso });
    }

    if (action === "discount_upsert") {
      const id = body.id ? String(body.id) : null;
      const promoterId = String(body.promoterId || "");
      const companyId = body.companyId ? String(body.companyId) : null;
      const dailyProductionRecordId = body.dailyProductionRecordId
        ? String(body.dailyProductionRecordId)
        : null;
      const year = Number(body.year);
      const month = Number(body.month);
      const discountType = normalizeText(body.discountType || "OUTROS");
      const companyAmount = toNumber(body.companyAmount);
      if (!promoterId || !year || !month) {
        return NextResponse.json(
          { error: "Informe promotor e competencia do desconto." },
          { status: 400 }
        );
      }
      // Valor INICIAL pela régua VERSIONADA da competência (nunca hardcode). Sem regra
      // para o tipo, cai no valor cheio — nunca bloqueia. Editável depois.
      const amount = await resolveDiscountAmount(
        supabase as unknown as SupabaseClient,
        discountType,
        body.amount,
        body.companyAmount,
        year,
        month
      );
      const installments = Math.max(1, toNumber(body.installments) || 1);
      const installmentNumber = Math.max(
        1,
        Math.min(installments, toNumber(body.installmentNumber) || 1)
      );
      const applyToCompany = Boolean(body.applyToCompany);
      const notesParts = [];

      if (companyAmount > 0) {
        notesParts.push(`Base empresa: ${companyAmount.toFixed(2)}`);
      }

      if (body.notes) {
        notesParts.push(String(body.notes).trim());
      }

      if (amount <= 0) {
        return NextResponse.json(
          { error: "Informe um valor valido para o desconto do promotor." },
          { status: 400 }
        );
      }

      const payload = {
        promoter_id: promoterId,
        company_id: companyId,
        daily_production_record_id: dailyProductionRecordId,
        year,
        month,
        discount_type: discountType,
        amount,
        installments,
        installment_number: installmentNumber,
        apply_to_company: applyToCompany,
        notes: notesParts.join(" | ") || null,
      };

      if (id) {
        const { error: updateError } = await supabase
          .from("promoter_discounts")
          .update(payload)
          .eq("id", id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("promoter_discounts")
          .insert(payload);

        if (insertError) throw insertError;
      }

      clearPromoterReadCaches();
      await writeAudit(
        "Lancamento manual de desconto do promotor",
        {
          id,
          promoter_id: promoterId,
          company_id: companyId,
          year,
          month,
          discount_type: discountType,
          amount,
          installments,
          installment_number: installmentNumber,
          apply_to_company: applyToCompany,
        },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "discount_delete") {
      const id = String(body.id || "");

      if (!id) {
        return NextResponse.json(
          { error: "Informe o desconto que deve ser removido." },
          { status: 400 }
        );
      }

      const { error: deleteError } = await supabase
        .from("promoter_discounts")
        .delete()
        .eq("id", id);

      if (deleteError) throw deleteError;

      clearPromoterReadCaches();
      await writeAudit(
        "Remocao manual de desconto do promotor",
        { id },
        auditActor
      );

      return NextResponse.json({ success: true });
    }

    if (action === "prefixar_metas") {
      // Prefixacao de metas: a competencia ALVO (year/month) nasce com as metas do
      // mes IMEDIATAMENTE anterior (M-1), editavel depois. SOCIO-ONLY (escrita em
      // massa). ON CONFLICT (promoter_id, year, month) DO NOTHING -> NUNCA sobrescreve
      // meta ja editada. Cadeia quebrada (M-1 sem metas) -> AVISA, nao insere nada
      // (NUNCA pula para M-2 silenciosamente).
      await requireSocio();

      const year = Number(body.year);
      const month = Number(body.month);
      if (!year || !month || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "Informe a competencia alvo (year, month)." },
          { status: 400 }
        );
      }

      // M-1: mes anterior; dezembro do ano anterior se month=1 (virada de ano).
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const pad = (n: number) => String(n).padStart(2, "0");
      const mesAnterior = `${prevYear}-${pad(prevMonth)}`;
      const alvo = `${year}-${pad(month)}`;

      const admin = getSupabaseAdmin();

      const { data: origem, error: selErr } = await admin
        .from("monthly_targets")
        .select("promoter_id, company_id, meta, meta_1, meta_2")
        .eq("year", prevYear)
        .eq("month", prevMonth);
      if (selErr) throw selErr;

      if (!origem || origem.length === 0) {
        return NextResponse.json({
          success: false,
          motivo: "mes anterior sem metas",
          mesAnterior,
          alvo,
        });
      }

      const rows = origem.map((r) => ({
        promoter_id: r.promoter_id,
        company_id: r.company_id,
        year,
        month,
        meta: toNumber(r.meta),
        meta_1: toNumber(r.meta_1),
        meta_2: toNumber(r.meta_2),
      }));

      // ON CONFLICT DO NOTHING: insere so o que nao existe; .select() devolve apenas
      // as linhas realmente inseridas -> prefixadas = novas, mantidas = ja existiam.
      const { data: inseridas, error: insErr } = await admin
        .from("monthly_targets")
        .upsert(rows, { onConflict: "promoter_id,year,month", ignoreDuplicates: true })
        .select("id");
      if (insErr) throw insErr;

      const prefixadas = (inseridas ?? []).length;
      const mantidas = rows.length - prefixadas;

      clearPromoterReadCaches();
      await writeAudit(
        "Prefixacao de metas a partir do mes anterior",
        { origem: mesAnterior, alvo, prefixadas, mantidas, total_origem: rows.length },
        auditActor
      );

      // AVISAR (nao barrar): metas prefixadas sao input do consolidador — em mes
      // fechado so valem apos reconsolidar (prefixar mira quase sempre mes futuro,
      // entao o flag raramente aparece; existe para o caso de prefixar retroativo).
      const aviso = await flagCompetenciaFechada(supabase, year, month);
      return NextResponse.json({
        success: true,
        origem: mesAnterior,
        alvo,
        prefixadas,
        mantidas,
        total_origem: rows.length,
        ...aviso,
      });
    }

    // FRENTE DÉBITOS — cadastro MANUAL (gera o plano + N parcelas).
    if (action === "debit_upsert") {
      const promoterId = String(body.promoterId || "");
      const debitType = String(body.debitType || "").trim();
      const totalAmount = toNumber(body.totalAmount);
      const installmentsTotal = Math.max(1, toNumber(body.installmentsTotal) || 1);
      const startYear = Number(body.startYear);
      const startMonth = Number(body.startMonth);
      const companyId = body.companyId ? String(body.companyId) : null;
      if (!promoterId || !debitType || totalAmount <= 0 || !startYear || !startMonth) {
        return NextResponse.json(
          { error: "Informe promotor, tipo, valor total e competencia inicial." },
          { status: 400 }
        );
      }
      const res = await createManualDebit(supabase, {
        promoterId,
        companyId,
        debitType,
        totalAmount,
        installmentsTotal,
        startYear,
        startMonth,
        notes: body.notes ? String(body.notes) : null,
        createdBy: auditActor,
      });
      clearPromoterReadCaches();
      await writeAudit(
        "Cadastro de debito manual do promotor",
        { promoter_id: promoterId, debit_type: debitType, total: totalAmount, parcelas: installmentsTotal },
        auditActor
      );
      return NextResponse.json({ success: true, ...res });
    }

    // FRENTE DÉBITOS — EDIÇÃO transversal (vale p/ AUTO e MANUAL igualmente):
    // valor total, nº de parcelas (parcelar um débito automático) e promotor.
    // Parcelas já APLICADAS não são tocadas — só as PENDENTES são reescritas.
    if (action === "debit_update") {
      const debitId = String(body.debitId || "");
      if (!debitId) {
        return NextResponse.json({ error: "Informe o debito a editar." }, { status: 400 });
      }
      const temTotal = body.totalAmount !== undefined && body.totalAmount !== null && body.totalAmount !== "";
      const temParcelas =
        body.installmentsTotal !== undefined && body.installmentsTotal !== null && body.installmentsTotal !== "";
      const novoPromotor = body.promoterId ? String(body.promoterId) : null;
      if (!temTotal && !temParcelas && !novoPromotor) {
        return NextResponse.json(
          { error: "Informe ao menos um campo: valor total, parcelas ou promotor." },
          { status: 400 }
        );
      }
      try {
        // Competência CORRENTE (mês aberto) — é onde entra o estorno da correção de dono
        // e onde recomeçam as parcelas do dono correto. O mês fechado não é reescrito.
        const hoje = new Date();
        const res = await updateDebit(supabase, {
          debitId,
          promoterId: novoPromotor,
          totalAmount: temTotal ? toNumber(body.totalAmount) : null,
          installmentsTotal: temParcelas ? Math.max(1, toNumber(body.installmentsTotal) || 1) : null,
          updatedBy: auditActor,
          currentYear: hoje.getUTCFullYear(),
          currentMonth: hoje.getUTCMonth() + 1,
        });
        clearPromoterReadCaches();
        await writeAudit(
          res.estorno ? "Correcao de dono de debito com estorno" : "Edicao de debito do promotor",
          {
            debit_id: debitId,
            promoter_id: novoPromotor,
            total: res.totalAmount,
            parcelas: res.installmentsTotal,
            parcelas_preservadas: res.parcelasPreservadas,
            // Correção de dono: quem -> quem, e o crédito devolvido ao promotor errado.
            estorno: res.estorno
              ? {
                  de_promotor: res.estorno.promoterId,
                  para_promotor: novoPromotor,
                  valor_creditado: res.estorno.valor,
                  competencia: `${res.estorno.year}-${String(res.estorno.month).padStart(2, "0")}`,
                  debito_estorno_id: res.estorno.debitId,
                  parcelas_pagas_origem: res.estorno.parcelasOrigem,
                }
              : null,
          },
          auditActor
        );
        return NextResponse.json({ success: true, ...res });
      } catch (e: any) {
        // Regras de negócio da edição (total menor que o já pago, parcelas insuficientes)
        // voltam como 400 com a mensagem — não como 500.
        return NextResponse.json({ error: e?.message || "Falha ao editar o debito." }, { status: 400 });
      }
    }

    // FRENTE DÉBITOS — atribui um estorno da FILA (MASTER/ADS) ao promotor.
    if (action === "debit_assign") {
      const assignmentId = String(body.assignmentId || "");
      const promoterId = String(body.promoterId || "");
      if (!assignmentId || !promoterId) {
        return NextResponse.json(
          { error: "Informe o item da fila e o promotor de destino." },
          { status: 400 }
        );
      }
      const res = await assignQueuedDebit(supabase, { assignmentId, promoterId, createdBy: auditActor });
      clearPromoterReadCaches();
      await writeAudit(
        "Atribuicao de debito da fila",
        { assignment_id: assignmentId, promoter_id: promoterId },
        auditActor
      );
      return NextResponse.json({ success: true, ...res });
    }

    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
