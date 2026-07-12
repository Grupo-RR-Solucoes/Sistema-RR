import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDonaCompanyForPromoter } from "./closingMonthly.ts";
// TRAVA de mes fechado — deteccao CANONICA do sistema (mesma do fechamento e da rota).
// Nao duplicar essa nocao aqui: uma segunda regra de "mes fechado" seria retalho.
import { detectClosedMonth } from "./cmsMonthly.ts";
// RÉGUA ÚNICA do valor do débito (lib/debitRules). NÃO reimplementar aqui.
import { debitAmountFor, fetchDebitRule, round2 } from "./debitRules.ts";

// ============================================================================
// debitsData — leitura e AÇÕES dos débitos do promotor (itens 3/4/5).
//   fetchPromoterDebits  — débitos do promotor no mês (com sources/origem + saldo)
//   fetchDebitQueue      — fila dos estornos MASTER/ADS aguardando atribuição
//   createManualDebit    — cadastro manual: gera o plano + N parcelas
//   assignQueuedDebit    — atribui um item da fila ao promotor e cria o débito
// Parcela = promoter_discounts (reuso). Saldo = total − Σ(status='APPLIED').
// ============================================================================

type SupabaseLike = SupabaseClient;


export type PromoterDebitRow = {
  id: string;
  kind: string;
  debit_type: string;
  total_amount: number;
  installments_total: number;
  status: string;
  // parcela do mês corrente (se houver) + saldo do plano
  parcela_mes: number;
  installment_number: number | null;
  parcela_status: string | null;
  desceu: number; // Σ parcelas APPLIED
  falta: number; // total − desceu
  sources: Array<{ operation: string | null; estorno_amount: number; resolved_via: string | null }>;
};

// Débitos que TOCAM o mês (têm parcela na competência) do promotor, com saldo e origem.
export async function fetchPromoterDebits(
  supabase: SupabaseLike,
  params: { year: number; month: number; promoterId: string }
): Promise<PromoterDebitRow[]> {
  const { year, month, promoterId } = params;
  // parcelas do mês (promoter_discounts com debit_id)
  const { data: parcelasMes } = await supabase
    .from("promoter_discounts")
    .select("debit_id, amount, installment_number, status")
    .eq("promoter_id", promoterId)
    .eq("year", year)
    .eq("month", month)
    .not("debit_id", "is", null);
  const debitIds = [...new Set((parcelasMes || []).map((p: any) => p.debit_id))];
  if (debitIds.length === 0) return [];

  const { data: debits } = await supabase
    .from("promoter_debits")
    .select("id, kind, debit_type, total_amount, installments_total, status")
    .in("id", debitIds);
  const { data: allParcelas } = await supabase
    .from("promoter_discounts")
    .select("debit_id, amount, status")
    .in("debit_id", debitIds);
  const { data: sources } = await supabase
    .from("promoter_debit_sources")
    .select("debit_id, operation, estorno_amount, resolved_via")
    .in("debit_id", debitIds);

  const parcelaMesByDebit = new Map((parcelasMes || []).map((p: any) => [p.debit_id, p]));
  return (debits || []).map((d: any) => {
    const pm = parcelaMesByDebit.get(d.id);
    const desceu = round2((allParcelas || []).filter((p: any) => p.debit_id === d.id && p.status === "APPLIED").reduce((a: number, p: any) => a + Number(p.amount), 0));
    return {
      id: d.id,
      kind: d.kind,
      debit_type: d.debit_type,
      total_amount: Number(d.total_amount),
      installments_total: d.installments_total,
      status: d.status,
      parcela_mes: pm ? Number(pm.amount) : 0,
      installment_number: pm ? pm.installment_number : null,
      parcela_status: pm ? pm.status : null,
      desceu,
      falta: round2(Number(d.total_amount) - desceu),
      sources: (sources || []).filter((sc: any) => sc.debit_id === d.id).map((sc: any) => ({ operation: sc.operation, estorno_amount: Number(sc.estorno_amount), resolved_via: sc.resolved_via })),
    };
  });
}

export type DebitQueueRow = {
  id: string;
  operation: string;
  source_kind: string;
  estorno_amount: number;
  chave_j: string | null;
  debit_type: string;
};

export async function fetchDebitQueue(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<DebitQueueRow[]> {
  const { data } = await supabase
    .from("promoter_debit_assignments")
    .select("id, operation, source_kind, estorno_amount, chave_j, debit_type")
    .eq("year", params.year)
    .eq("month", params.month)
    .eq("status", "PENDING")
    .order("estorno_amount", { ascending: false });
  return (data || []).map((r: any) => ({ ...r, estorno_amount: Number(r.estorno_amount) }));
}

// Cadastro MANUAL: cria o plano + N parcelas (total/N, ajuste de centavos na última).
export async function createManualDebit(
  supabase: SupabaseLike,
  params: {
    promoterId: string;
    companyId: string | null;
    debitType: string;
    totalAmount: number;
    installmentsTotal: number;
    startYear: number;
    startMonth: number;
    notes?: string | null;
    createdBy?: string | null;
  }
): Promise<{ debitId: string; parcelas: number }> {
  const n = Math.max(1, Math.floor(params.installmentsTotal || 1));
  const total = round2(params.totalAmount);
  const { data: ins, error: e1 } = await supabase
    .from("promoter_debits")
    .insert({
      promoter_id: params.promoterId,
      company_id: params.companyId,
      kind: "MANUAL",
      debit_type: params.debitType,
      total_amount: total,
      installments_total: n,
      start_year: params.startYear,
      start_month: params.startMonth,
      status: "ACTIVE",
      notes: params.notes ?? null,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const debitId = ins.id;

  const base = round2(total / n);
  const rows = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    let m = params.startMonth + i;
    let y = params.startYear;
    while (m > 12) { m -= 12; y += 1; }
    const amount = i === n - 1 ? round2(total - acc) : base;
    acc = round2(acc + base);
    rows.push({
      promoter_id: params.promoterId,
      company_id: params.companyId,
      year: y,
      month: m,
      discount_type: params.debitType,
      amount,
      installments: n,
      installment_number: i + 1,
      apply_to_company: false,
      debit_id: debitId,
      status: "PENDING",
      notes: params.notes ?? null,
    });
  }
  const { error: e2 } = await supabase.from("promoter_discounts").insert(rows);
  if (e2) throw e2;
  return { debitId, parcelas: rows.length };
}

/**
 * EDIÇÃO TRANSVERSAL de um débito — vale para AUTO e MANUAL igualmente. O automático
 * faz o trabalho inicial (resolve o promotor, lança o valor), mas nunca trava: sócio/
 * auxiliar pode depois mudar o VALOR TOTAL, PARCELAR em N (eixo 2 — decisão manual
 * sobreposta, independente de o débito ser automático) e trocar o PROMOTOR.
 *
 * LIMITE DURO: parcelas já APLICADAS (APPLIED) são de meses já pagos e NÃO são
 * tocadas — nem valor, nem promotor. A edição só reescreve as PENDENTES. Por isso:
 *   - o novo total não pode ser menor que o já descontado (não dá pra "desdescontar");
 *   - o nº de parcelas tem que caber as já aplicadas;
 *   - as novas parcelas começam no mês seguinte à última aplicada (ou no mês inicial
 *     do plano, se nada foi aplicado ainda).
 *
 * CORREÇÃO DE DONO COM PARCELA JÁ PAGA (ver estornarParcelasPagas): se o débito foi
 * descontado do promotor ERRADO e é movido para o CERTO, o que desceu do errado é
 * ESTORNADO (crédito no mês corrente) e o certo assume o débito INTEIRO. O mês fechado
 * continua intocado — o estorno é lançamento novo, não reescrita.
 */
export async function updateDebit(
  supabase: SupabaseLike,
  params: {
    debitId: string;
    promoterId?: string | null;
    totalAmount?: number | null;
    installmentsTotal?: number | null;
    updatedBy?: string | null;
    // Competência CORRENTE (mês aberto) onde entram o estorno e as parcelas do novo
    // dono. Injetável para teste; default = mês de hoje.
    currentYear?: number;
    currentMonth?: number;
    // Injetável só para teste (simular mês fechado). Default: detectClosedMonth real.
    isClosed?: (year: number, month: number) => Promise<boolean>;
  }
): Promise<{
  debitId: string;
  totalAmount: number;
  installmentsTotal: number;
  desceu: number;
  restante: number;
  parcelasReescritas: number;
  parcelasPreservadas: number;
  estorno?: {
    promoterId: string;
    valor: number;
    year: number;
    month: number;
    debitId: string;
    parcelasOrigem: number;
    // > 0 quando a competência corrente estava FECHADA e o crédito foi empurrado
    // para a próxima ABERTA (mês fechado nunca é reescrito).
    pulouMesesFechados: number;
  };
}> {
  const { data: debit, error: eD } = await supabase
    .from("promoter_debits")
    .select("id, promoter_id, company_id, kind, debit_type, total_amount, installments_total, start_year, start_month")
    .eq("id", params.debitId)
    .single();
  if (eD) throw eD;

  const { data: parcelas, error: eP } = await supabase
    .from("promoter_discounts")
    .select("id, promoter_id, year, month, amount, status, installment_number")
    .eq("debit_id", params.debitId)
    .order("year", { ascending: true })
    .order("month", { ascending: true });
  if (eP) throw eP;

  // APLICADAS DO DONO ATUAL. Filtrar por promoter_id importa: depois de uma correção de
  // dono, a parcela paga continua registrada no débito mas pertence ao promotor ANTIGO —
  // ela não pode contar como "já descontado" do dono novo numa edição seguinte.
  const aplicadas = (parcelas || []).filter(
    (p: any) => p.status === "APPLIED" && p.promoter_id === debit.promoter_id
  );
  const desceu = round2(aplicadas.reduce((s: number, p: any) => s + Number(p.amount), 0));

  const promoterIdNovo = params.promoterId || debit.promoter_id;
  const trocouPromotor = promoterIdNovo !== debit.promoter_id;

  // CORREÇÃO DE DONO com parcela já paga pelo promotor ERRADO -> caminho do estorno.
  if (trocouPromotor && desceu > 0.005) {
    return estornarParcelasPagas(supabase, {
      debit,
      parcelas: parcelas || [],
      aplicadas,
      desceu,
      promoterIdNovo,
      totalAmount: params.totalAmount,
      installmentsTotal: params.installmentsTotal,
      currentYear: params.currentYear,
      currentMonth: params.currentMonth,
      isClosed: params.isClosed,
      updatedBy: params.updatedBy ?? null,
    });
  }

  const novoTotal = round2(
    params.totalAmount === null || params.totalAmount === undefined
      ? Number(debit.total_amount)
      : params.totalAmount
  );
  if (novoTotal < desceu - 0.005) {
    throw new Error(
      `Total (${novoTotal.toFixed(2)}) menor que o ja descontado em parcelas pagas (${desceu.toFixed(2)}). ` +
        `Parcelas APLICADAS nao sao alteradas retroativamente.`
    );
  }
  const restante = round2(novoTotal - desceu);

  const n = Math.max(
    1,
    Math.floor(
      params.installmentsTotal === null || params.installmentsTotal === undefined
        ? Number(debit.installments_total) || 1
        : params.installmentsTotal
    )
  );
  const pendentesAGerar = n - aplicadas.length;
  if (pendentesAGerar < 1 && restante > 0.005) {
    throw new Error(
      `${n} parcela(s) nao comporta(m) as ${aplicadas.length} ja aplicada(s) mais o saldo de ${restante.toFixed(2)}.`
    );
  }

  // Aqui só se chega SEM parcela paga do dono atual (o caminho com estorno já retornou
  // acima). Promotor novo => empresa DONA determinística do promotor na competência
  // (mesma régua do fechamento). Sem troca, mantém a empresa que já estava no débito.
  const promoterId = promoterIdNovo;
  const companyId = trocouPromotor
    ? await resolveDonaCompanyForPromoter(supabase, {
        year: debit.start_year,
        month: debit.start_month,
        promoterId,
      })
    : debit.company_id;

  // Apaga só as PENDENTES (as APPLIED ficam como estão — mês já pago).
  const idsPendentes = (parcelas || []).filter((p: any) => p.status !== "APPLIED").map((p: any) => p.id);
  if (idsPendentes.length) {
    const { error } = await supabase.from("promoter_discounts").delete().in("id", idsPendentes);
    if (error) throw error;
  }

  // Regera as pendentes a partir do mês seguinte à última aplicada.
  const rows: any[] = [];
  if (restante > 0.005 && pendentesAGerar > 0) {
    const ultima = aplicadas[aplicadas.length - 1];
    let y = ultima ? Number(ultima.year) : Number(debit.start_year);
    let m = ultima ? Number(ultima.month) + 1 : Number(debit.start_month);
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    const base = round2(restante / pendentesAGerar);
    let acc = 0;
    for (let i = 0; i < pendentesAGerar; i++) {
      const amount = i === pendentesAGerar - 1 ? round2(restante - acc) : base;
      acc = round2(acc + base);
      rows.push({
        promoter_id: promoterId,
        company_id: companyId,
        year: y,
        month: m,
        discount_type: debit.debit_type,
        amount,
        installments: n,
        installment_number: aplicadas.length + i + 1,
        apply_to_company: false,
        debit_id: debit.id,
        status: "PENDING",
        notes: "Parcela reescrita na edicao do debito.",
      });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    const { error } = await supabase.from("promoter_discounts").insert(rows);
    if (error) throw error;
  }

  // status: 'PAID' quando não sobrou saldo e já houve parcela aplicada. O CHECK da
  // tabela só aceita ACTIVE|PAID|CANCELLED — não inventar valor novo aqui.
  // A tabela não tem coluna updated_by; a autoria da edição fica no audit_logs (rota).
  const { error: eU } = await supabase
    .from("promoter_debits")
    .update({
      promoter_id: promoterId,
      company_id: companyId,
      total_amount: novoTotal,
      installments_total: n,
      status: restante <= 0.005 && aplicadas.length > 0 ? "PAID" : "ACTIVE",
    })
    .eq("id", debit.id);
  if (eU) throw eU;

  return {
    debitId: debit.id,
    totalAmount: novoTotal,
    installmentsTotal: n,
    desceu,
    restante,
    parcelasReescritas: rows.length,
    parcelasPreservadas: aplicadas.length,
  };
}

/** Tipo do lançamento de crédito gerado pela correção de dono. */
export const ESTORNO_CORRECAO = "ESTORNO_CORRECAO";

/** Quantos meses à frente procurar uma competência aberta antes de desistir. */
const MAX_MESES_PROCURA_ABERTA = 24;

/**
 * Primeira competência ABERTA a partir de (year, month) — inclusive.
 *
 * REUSA a detecção canônica de mês fechado do sistema: `detectClosedMonth` de
 * lib/cmsMonthly (que delega a `detectMonthRegime`, a mesma que a rota /api/promotores
 * e o fechamento usam). NÃO existe uma segunda noção de "mês fechado" aqui — seria
 * retalho: duas regras de fechamento divergindo é exatamente o bug que a régua única
 * dos débitos veio matar.
 *
 * `isClosed` é injetável só para teste (simular mês fechado sem montar o banco todo);
 * em produção o default é a função real.
 */
export async function resolveCompetenciaAberta(
  supabase: SupabaseLike,
  year: number,
  month: number,
  isClosed?: (y: number, m: number) => Promise<boolean>
): Promise<{ year: number; month: number; pulou: number }> {
  const fechado = isClosed ?? ((y: number, m: number) => detectClosedMonth(supabase as any, y, m));
  let y = year;
  let m = month;
  for (let i = 0; i < MAX_MESES_PROCURA_ABERTA; i++) {
    if (!(await fechado(y, m))) return { year: y, month: m, pulou: i };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  throw new Error(
    `Nenhuma competencia ABERTA encontrada a partir de ${year}-${String(month).padStart(2, "0")} ` +
      `em ${MAX_MESES_PROCURA_ABERTA} meses. Estorno nao lancado (mes fechado nunca e reescrito).`
  );
}

/**
 * CORREÇÃO DE DONO quando o débito JÁ FOI DESCONTADO do promotor ERRADO.
 *
 * Regra: estorna o que desceu do errado e cobra o valor INTEIRO do certo.
 *
 * MÊS FECHADO NUNCA É REESCRITO. A parcela APPLIED do promotor errado FICA como está
 * (é histórico: aquele dinheiro desceu mesmo, naquele mês). O acerto é um LANÇAMENTO
 * NOVO na competência CORRENTE (mês aberto):
 *
 *   promoter_discounts.amount NEGATIVO = CRÉDITO. O payable é
 *   `final_commission_value - Σ(amount)` (promoterAnalytics), então um amount de −100
 *   AUMENTA em 100 o líquido do promotor errado no mês corrente. É o mecanismo nativo
 *   da tabela — `amount` é numeric(18,2) sem CHECK de sinal, não precisa coluna nova.
 *
 * O promotor CERTO assume o débito INTEIRO (não o saldo): as parcelas PENDENTES são
 * recriadas cobrindo o total, a partir da competência corrente.
 *
 * Rastreabilidade: o estorno é um promoter_debits próprio (debit_type ESTORNO_CORRECAO,
 * total negativo) + promoter_debit_sources apontando para o débito de ORIGEM e quantas
 * parcelas pagas o geraram. Quem→quem vai para audit_logs na rota.
 */
async function estornarParcelasPagas(
  supabase: SupabaseLike,
  args: {
    debit: any;
    parcelas: any[];
    aplicadas: any[];
    desceu: number;
    promoterIdNovo: string;
    totalAmount?: number | null;
    installmentsTotal?: number | null;
    currentYear?: number;
    currentMonth?: number;
    isClosed?: (year: number, month: number) => Promise<boolean>;
    updatedBy: string | null;
  }
) {
  const { debit, parcelas, aplicadas, desceu, promoterIdNovo } = args;
  const promoterIdErrado = debit.promoter_id;

  const agora = new Date();
  const hojeY = args.currentYear ?? agora.getUTCFullYear();
  const hojeM = args.currentMonth ?? agora.getUTCMonth() + 1;

  // TRAVA: o crédito do estorno (e as parcelas do dono certo) NUNCA caem em mês fechado.
  // Se a competência corrente já estiver fechada/paga, tudo vai para a próxima ABERTA.
  // Reusa detectClosedMonth (lib/cmsMonthly) — a detecção canônica do sistema.
  const alvo = await resolveCompetenciaAberta(supabase, hojeY, hojeM, args.isClosed);
  const cy = alvo.year;
  const cm = alvo.month;

  const novoTotal = round2(
    args.totalAmount === null || args.totalAmount === undefined
      ? Number(debit.total_amount)
      : args.totalAmount
  );
  const n = Math.max(
    1,
    Math.floor(
      args.installmentsTotal === null || args.installmentsTotal === undefined
        ? Number(debit.installments_total) || 1
        : args.installmentsTotal
    )
  );

  // 1) ESTORNO — crédito para o promotor ERRADO, na competência CORRENTE (mês aberto).
  //    Débito próprio, com total NEGATIVO: é um crédito, não um débito.
  const { data: estornoDebit, error: eE } = await supabase
    .from("promoter_debits")
    .insert({
      promoter_id: promoterIdErrado,
      company_id: debit.company_id,
      kind: "AUTO",
      debit_type: ESTORNO_CORRECAO,
      total_amount: round2(-desceu),
      installments_total: 1,
      start_year: cy,
      start_month: cm,
      status: "ACTIVE",
      notes:
        `Estorno da correcao de dono do debito ${debit.id} (${debit.debit_type}): ` +
        `${aplicadas.length} parcela(s) ja paga(s) pelo promotor errado, total ${desceu.toFixed(2)}. ` +
        `Mes fechado preservado; credito lancado na competencia corrente.`,
      created_by: args.updatedBy,
    })
    .select("id")
    .single();
  if (eE) throw eE;

  const { error: eEP } = await supabase.from("promoter_discounts").insert({
    promoter_id: promoterIdErrado,
    company_id: debit.company_id,
    year: cy,
    month: cm,
    discount_type: ESTORNO_CORRECAO,
    amount: round2(-desceu), // NEGATIVO = crédito (aumenta o payable)
    installments: 1,
    installment_number: 1,
    apply_to_company: false,
    debit_id: estornoDebit.id,
    status: "PENDING",
    notes: `Estorno: debito ${debit.id} era de outro promotor.`,
  });
  if (eEP) throw eEP;

  const { error: eES } = await supabase.from("promoter_debit_sources").insert({
    debit_id: estornoDebit.id,
    source_kind: "DEBIT_CORRECTION",
    operation: String(debit.id), // débito de ORIGEM (rastreabilidade)
    estorno_amount: round2(desceu),
    resolved_via: "correcao-dono",
  });
  if (eES) throw eES;

  // 2) O promotor CERTO assume o débito INTEIRO. Apaga as PENDENTES antigas e recria
  //    cobrindo o TOTAL (não o saldo), a partir da competência corrente.
  const idsPendentes = parcelas.filter((p: any) => p.status !== "APPLIED").map((p: any) => p.id);
  if (idsPendentes.length) {
    const { error } = await supabase.from("promoter_discounts").delete().in("id", idsPendentes);
    if (error) throw error;
  }

  const companyIdNovo = await resolveDonaCompanyForPromoter(supabase, {
    year: cy,
    month: cm,
    promoterId: promoterIdNovo,
  });

  const base = round2(novoTotal / n);
  const rows: any[] = [];
  let acc = 0;
  let y = cy;
  let m = cm;
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? round2(novoTotal - acc) : base;
    acc = round2(acc + base);
    rows.push({
      promoter_id: promoterIdNovo,
      company_id: companyIdNovo,
      year: y,
      month: m,
      discount_type: debit.debit_type,
      amount,
      installments: n,
      installment_number: i + 1,
      apply_to_company: false,
      debit_id: debit.id,
      status: "PENDING",
      notes: `Debito movido de promotor; valor integral cobrado do dono correto.`,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  const { error: eI } = await supabase.from("promoter_discounts").insert(rows);
  if (eI) throw eI;

  const { error: eU } = await supabase
    .from("promoter_debits")
    .update({
      promoter_id: promoterIdNovo,
      company_id: companyIdNovo,
      total_amount: novoTotal,
      installments_total: n,
      status: "ACTIVE",
      notes:
        `${debit.notes ? `${debit.notes} | ` : ""}Dono corrigido: o que desceu do promotor anterior ` +
        `(${desceu.toFixed(2)}) foi estornado em ${cy}-${String(cm).padStart(2, "0")}; valor integral cobrado do dono correto.`,
    })
    .eq("id", debit.id);
  if (eU) throw eU;

  return {
    debitId: debit.id,
    totalAmount: novoTotal,
    installmentsTotal: n,
    desceu,
    restante: novoTotal, // o dono novo assume o total INTEIRO, não o saldo
    parcelasReescritas: rows.length,
    parcelasPreservadas: aplicadas.length, // ficam com o promotor antigo (histórico)
    estorno: {
      promoterId: promoterIdErrado,
      valor: round2(desceu),
      year: cy,
      month: cm,
      debitId: estornoDebit.id,
      parcelasOrigem: aplicadas.length,
      pulouMesesFechados: alvo.pulou,
    },
  };
}

// Atribui um item da FILA a um promotor e cria o débito (AUTO) + source + parcela.
export async function assignQueuedDebit(
  supabase: SupabaseLike,
  params: { assignmentId: string; promoterId: string; createdBy?: string | null }
): Promise<{ debitId: string; amount: number }> {
  const { data: a, error: eA } = await supabase
    .from("promoter_debit_assignments")
    .select("id, year, month, operation, source_kind, closing_entry_id, estorno_amount, chave_j, debit_type, status")
    .eq("id", params.assignmentId)
    .single();
  if (eA) throw eA;
  if (a.status === "RESOLVED") throw new Error("Item da fila já resolvido.");

  const ruleRow = await fetchDebitRule(supabase, a.debit_type, a.year, a.month);
  const estorno = Number(a.estorno_amount);
  const amount = round2(debitAmountFor(estorno, ruleRow?.rule));
  const isAds = a.source_kind === "DAILY_CANCEL";
  // ADS mantém a company ADS. MASTER (fechamento) resolve a empresa DONA
  // determinística pela MESMA régua do fechamento (computeDonaCompanyMap) — antes
  // gravava null e o débito sumia ao filtrar por empresa.
  const companyId = isAds
    ? "375aea6d-3b9c-4490-87f0-e739e312c8ef"
    : await resolveDonaCompanyForPromoter(supabase, { year: a.year, month: a.month, promoterId: params.promoterId });

  const { data: ins, error: e1 } = await supabase
    .from("promoter_debits")
    .insert({
      promoter_id: params.promoterId,
      company_id: companyId,
      kind: "AUTO",
      debit_type: a.debit_type,
      total_amount: amount,
      installments_total: 1,
      start_year: a.year,
      start_month: a.month,
      rule_version_id: ruleRow?.id ?? null,
      status: "ACTIVE",
      notes: `Atribuído da fila (operação ${a.operation}).`,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const debitId = ins.id;

  const { error: e2 } = await supabase.from("promoter_discounts").insert({
    promoter_id: params.promoterId,
    company_id: companyId,
    year: a.year,
    month: a.month,
    discount_type: a.debit_type,
    amount,
    installments: 1,
    installment_number: 1,
    apply_to_company: false,
    debit_id: debitId,
    status: "PENDING",
    notes: `Atribuído da fila (operação ${a.operation}).`,
  });
  if (e2) throw e2;

  const { error: e3 } = await supabase.from("promoter_debit_sources").insert({
    debit_id: debitId,
    source_kind: a.source_kind,
    operation: a.operation,
    closing_entry_id: a.closing_entry_id,
    estorno_amount: estorno,
    chave_j: a.chave_j,
    resolved_via: "fila-atribuida",
  });
  if (e3) throw e3;

  const { error: e4 } = await supabase
    .from("promoter_debit_assignments")
    .update({ promoter_id: params.promoterId, status: "RESOLVED", assigned_by: params.createdBy ?? null, assigned_at: new Date().toISOString() })
    .eq("id", params.assignmentId);
  if (e4) throw e4;

  return { debitId, amount };
}
