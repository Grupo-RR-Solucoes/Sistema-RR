// FRENTE DE PRODUTO — fila com memoria (M2a): atribuicao do promotor as linhas de
// produto de EVENTO UNICO (BBCAP / Conta Corrente), e o calculo do repasse
// consolidado por promotor para o ledger.
//
// - Nao ha heranca por parcela (evento unico); a heranca que importa e o REPROCESSO
//   do mesmo fechamento: a chave da fila = a chave natural do M1, entao reimportar
//   nao perde a atribuicao ja feita.
// - Upsert respeita decisao humana (status ASSIGNED nunca vira PENDING de volta).
import type { SupabaseClient } from "@supabase/supabase-js";
import { repassePromotor } from "./produtoRepasse.ts";
import { buildDonaCompanyMapDoMes } from "./closingMonthly.ts";
import {
  computeConsorcioCommissionByBeneficiario,
  syncPendingConsorcioAnchors,
} from "./consorcio/fila.ts";
import {
  beneficiarioDaLinha,
  beneficiarioValue,
  colunasDeDono,
  type Beneficiario,
} from "./produtoBeneficiario.ts";

type SupabaseLike = SupabaseClient;

// Produtos de evento unico cobertos pelo M2a. Consorcio/LOB (diferidos) = M2b.
export const EVENTO_UNICO_ENTRY_TYPES = ["BBCAP", "CONTA_CORRENTE"] as const;
export type ProductEntryType = (typeof EVENTO_UNICO_ENTRY_TYPES)[number];

/**
 * CHAVE NATURAL de uma linha de produto — o que liga a FILA
 * (product_line_assignments) a linha da MASTER (monthly_closing_entries).
 * Fonte UNICA: a fila usa para nao duplicar (syncPendingProductAssignments), o
 * calculo usa para achar o dono (computeProductCommissionByBeneficiario) e a rota
 * de atribuicao usa para juntar os dois lados e exibir as colunas do fechamento.
 * Tres copias da mesma expressao divergiriam no primeiro ajuste.
 */
export function chaveNaturalProduto(r: {
  company_id: string | null;
  entry_type: string;
  operation_number: string | null;
  contract_number?: string | null;
}): string {
  return `${r.company_id}|${r.entry_type}|${r.operation_number}|${r.contract_number ?? ""}`;
}

type ProductEntry = {
  company_id: string | null;
  year: number;
  month: number;
  entry_type: string;
  operation_number: string | null;
  contract_number: string | null;
  commission_value: number | null;
};

async function fetchProductEntries(
  supabase: SupabaseLike,
  year: number,
  month: number
): Promise<ProductEntry[]> {
  const out: ProductEntry[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select("company_id, year, month, entry_type, operation_number, contract_number, commission_value")
      .eq("year", year)
      .eq("month", month)
      .in("entry_type", EVENTO_UNICO_ENTRY_TYPES as unknown as string[])
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as ProductEntry[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

// Cria linhas PENDING na fila para toda linha de produto que ainda nao tem
// atribuicao. Idempotente: nunca toca linhas ja existentes (preserva ASSIGNED).
export async function syncPendingProductAssignments(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<{ criadas: number; existentes: number }> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const entries = await fetchProductEntries(supabase, year, month);

  const { data: existing, error } = await supabase
    .from("product_line_assignments")
    .select("company_id, entry_type, operation_number, contract_number")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  const seen = new Set((existing || []).map((a: any) => chaveNaturalProduto(a)));

  const novas: any[] = [];
  const novasChaves = new Set<string>();
  for (const e of entries) {
    const key = chaveNaturalProduto(e);
    if (seen.has(key) || novasChaves.has(key)) continue;
    novasChaves.add(key);
    novas.push({
      company_id: e.company_id,
      year,
      month,
      entry_type: e.entry_type,
      operation_number: e.operation_number,
      contract_number: e.contract_number ?? "",
      promoter_id: null,
      status: "PENDING",
      source: "MANUAL",
    });
  }

  if (!dryRun && novas.length > 0) {
    for (let i = 0; i < novas.length; i += 500) {
      const { error: insErr } = await supabase
        .from("product_line_assignments")
        .insert(novas.slice(i, i + 500));
      if (insErr) throw new Error(insErr.message);
    }
  }
  return { criadas: novas.length, existentes: seen.size };
}

// Atribui (ou reatribui) uma linha ao BENEFICIARIO (promotor OU papel de gestao com
// venda propria). Chamado pela tela de atribuicao e idempotente por chave natural.
// status vira ASSIGNED; reprocesso nao sobrescreve.
export async function assignProductLine(
  supabase: SupabaseLike,
  params: {
    company_id: string | null;
    year: number;
    month: number;
    entry_type: string;
    operation_number: string;
    contract_number?: string;
    beneficiario: Beneficiario | null; // null volta para PENDING (desatribuir)
    assigned_by?: string | null;
  }
): Promise<void> {
  const row = {
    company_id: params.company_id,
    year: params.year,
    month: params.month,
    entry_type: params.entry_type,
    operation_number: params.operation_number,
    contract_number: params.contract_number ?? "",
    // as DUAS colunas de dono, sempre (uma null) — ver colunasDeDono.
    ...colunasDeDono(params.beneficiario),
    status: params.beneficiario ? "ASSIGNED" : "PENDING",
    source: "MANUAL",
    assigned_by: params.assigned_by ?? null,
    assigned_at: params.beneficiario ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("product_line_assignments")
    .upsert(row, {
      onConflict: "company_id,year,month,entry_type,operation_number,contract_number",
    });
  if (error) throw new Error(error.message);
}

export type ProductCommissionBucket = {
  beneficiario: Beneficiario;
  company_id: string | null;
  bbcap: number;
  conta_corrente: number;
  consorcio: number; // M2b: repasse do consorcio (comissao-empresa x 0,40)
  lob: number; // M2b: adiado (sem fonte) — sempre 0
};

export type ProductCommissionByBeneficiario = Map<
  string, // `${kind}:${id}|${company_id}`
  ProductCommissionBucket
>;

// Repasse consolidado por (beneficiario, empresa): junta as linhas de produto
// (comissao-EMPRESA no fechamento) com a fila (ASSIGNED -> promotor OU app_user de
// gestao) e aplica o fator de repasse.
//
// ============================================================
// LINHA SEM DONO FICA 100% COM A EMPRESA (regra confirmada por Diego,
// 23/08/2026). Nao ha repasse, e nao ha para quem repassar.
//
// NAO E "dado faltando" nem bug: e o estado NORMAL de uma linha que ninguem
// atribuiu ainda, e e uma DECISAO de negocio — a comissao que a Promotiva pagou
// pela operacao fica inteira com a RR. O dinheiro nao some; so nao e repassado.
//
// TAMBEM NAO PRECISA de "chave master" no dropdown: "nao atribuido" JA E a forma
// de dizer "e da empresa". Oferecer um beneficiario-empresa criaria uma segunda
// maneira de expressar a mesma coisa, e duas maneiras divergem.
//
// ESTA ESCRITO AQUI porque ate 23/08/2026 isso era CONSEQUENCIA (um `continue`)
// e nao decisao registrada. Quem chegasse depois veria repasse zero numa linha
// com valor e teria motivo para achar que era defeito, e "consertar".
// ============================================================
//
// Consequencia pratica aqui: linha PENDING (ou ASSIGNED sem beneficiario) nao
// entra no acumulador — a comissao dela fica com a empresa.
//
// A REGUA E A MESMA para os dois tipos de dono — x 0,5833 nos eventos unicos, x 0,40
// no consorcio. O que separa promotor de gestao e so o DESTINO, decidido adiante:
// applyProdutoRepasseAoPmr (promotor) x applyVendaPropriaGestao (gestao).
export async function computeProductCommissionByBeneficiario(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ProductCommissionByBeneficiario> {
  const { year, month } = params;
  const entries = await fetchProductEntries(supabase, year, month);

  const { data: assigns, error } = await supabase
    .from("product_line_assignments")
    .select(
      "company_id, entry_type, operation_number, contract_number, promoter_id, assigned_app_user_id, status"
    )
    .eq("year", year)
    .eq("month", month)
    .eq("status", "ASSIGNED");
  if (error) throw new Error(error.message);
  const donoByKey = new Map<string, Beneficiario>();
  for (const a of assigns || []) {
    const b = beneficiarioDaLinha(a);
    if (!b) continue;
    donoByKey.set(chaveNaturalProduto(a), b);
  }

  const acc: ProductCommissionByBeneficiario = new Map();
  const novoBucket = (b: Beneficiario, company_id: string | null): ProductCommissionBucket => ({
    beneficiario: b,
    company_id,
    bbcap: 0,
    conta_corrente: 0,
    consorcio: 0,
    lob: 0,
  });
  for (const e of entries) {
    const key = chaveNaturalProduto(e);
    const dono = donoByKey.get(key);
    // SEM DONO -> 100% DA EMPRESA. Nao e "pular ate atribuir": e a regra. Ver o
    // bloco no cabecalho desta funcao antes de "consertar" o repasse zero.
    if (!dono) continue;
    const repasse = repassePromotor(Number(e.commission_value || 0));
    const ak = `${beneficiarioValue(dono)}|${e.company_id}`;
    const cur = acc.get(ak) || novoBucket(dono, e.company_id);
    if (e.entry_type === "BBCAP") cur.bbcap += repasse;
    else if (e.entry_type === "CONTA_CORRENTE") cur.conta_corrente += repasse;
    acc.set(ak, cur);
  }

  // M2b — CONSORCIO (diferido): resolve o dono pela ANCORA da proposta (heranca)
  // e soma a comissao-empresa das parcelas RECEBIDAS no mes x 0,40. LOB fica adiado.
  const cons = await computeConsorcioCommissionByBeneficiario(supabase, { year, month });
  for (const c of cons.values()) {
    const ak = `${beneficiarioValue(c.beneficiario)}|${c.company_id}`;
    const cur = acc.get(ak) || novoBucket(c.beneficiario, c.company_id);
    cur.consorcio += c.consorcio;
    acc.set(ak, cur);
  }

  // arredonda o agregado para 2 casas (numeric(18,2) do PMR / gestao_venda_propria).
  for (const v of acc.values()) {
    v.bbcap = Math.round(v.bbcap * 100) / 100;
    v.conta_corrente = Math.round(v.conta_corrente * 100) / 100;
    v.consorcio = Math.round(v.consorcio * 100) / 100;
    v.lob = Math.round(v.lob * 100) / 100;
  }
  return acc;
}

const chavePmr = (promoterId: string, companyId: string | null) =>
  `${promoterId}|${companyId ?? "NULL"}`;

/** numeric(18,2) do PMR / gestao_venda_propria. */
const round2Produto = (v: number) => Math.round(v * 100) / 100;

// Aplica o repasse de produto ao PMR fechado: grava as colunas por produto e
// RECOMPOE final = producao + seguro + bbcap + conta_corrente. Aditivo e
// idempotente (recompoe do proprio row). So toca promotores COM produto atribuido
// -> quem nao tem produto fica byte-identico (gate). Roda dentro do
// reconsolidarCompetenciaFechada, depois do consolidateMonthlyGroup.
//
// SO PROMOTORES entram aqui. Linhas cujo dono e um papel de GESTAO (venda propria)
// sao devolvidas em `gestao` e gravadas por applyVendaPropriaGestao em outra tabela —
// o PMR e keyed por promoter_id NOT NULL FK promoters e nao aceita nao-promotor.
//
// Devolve as chaves (promoter|company) tocadas, para o reconciliador NAO apagar os
// promotores que so tem produto (sem credito/seguro).
export async function applyProdutoRepasseAoPmr(
  supabase: SupabaseLike,
  params: {
    year: number;
    month: number;
    dryRun?: boolean;
    // PISO DE REPASSE — fator 0|1 por promotor, vindo do bloco F do
    // bbtsOrchestrator via reconsolidarCompetencia. Esta funcao NAO conhece a
    // regra. Ausente => `?? 1` => byte-identico ao comportamento anterior.
    //
    // HOJE E NO-OP: a regua vigente tem zera=[CREDITO,SEGURO], SEM PRODUTO, entao
    // o fator sai 1 para todo mundo. O encanamento existe para a decisao poder
    // mudar por DADO (uma linha no jsonb) em vez de commit.
    fatorProdutoByPromoter?: Map<string, number>;
  }
): Promise<{
  chaves: Set<string>;
  atualizadas: number;
  inseridas: number;
  promotores: number;
  gestao: ProductCommissionBucket[];
}> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;

  await syncPendingProductAssignments(supabase, { year, month, dryRun });
  await syncPendingConsorcioAnchors(supabase, { dryRun }); // M2b: ancoras por proposta
  const todos = await computeProductCommissionByBeneficiario(supabase, { year, month });

  // Separa os dois destinos. Enquanto ninguem tiver venda propria habilitada e
  // atribuida, `gestao` vem vazio e este caminho e byte-identico ao anterior.
  const porPromotor: Array<ProductCommissionBucket & { promoter_id: string }> = [];
  const gestao: ProductCommissionBucket[] = [];
  for (const v of todos.values()) {
    if (v.beneficiario.kind === "gestao") gestao.push(v);
    else porPromotor.push({ ...v, promoter_id: v.beneficiario.id });
  }

  // EMPRESA DONA — a MESMA regua do fechamento (computeDonaCompanyMap, via
  // buildDonaCompanyMapDoMes). Uma carga para todos os promotores.
  //
  // POR QUE NAO A EMPRESA DA LINHA DE PRODUTO (era `v.company_id`, ate 24/08/2026):
  // o PMR tem UNIQUE (promoter_id, year, month, company_id). O consorcio inteiro e
  // da AL1; se o credito do promotor e de outra empresa, gravar o produto na AL1
  // NAO atualiza a linha dele — CRIA UMA SEGUNDA. Medido em jul/2026: 8 linhas
  // "so produto" nasceram assim em 23/08 23:08, e 13 promotores ficaram com 2+
  // linhas de source='fechamento'.
  //
  // O ESTRAGO NAO E COSMETICO. closingProposalRows:73 faz
  // `(pmrRows||[]).find(r => r.source === "fechamento")` SEM ORDER BY: pegando a
  // linha so-produto, `fechCredit` sai 0 e a aba Detalhamento zera a comissao de
  // TODAS as propostas do promotor. Medido: 4 promotores zerados (THAYNARA,
  // MAYANNE, ERIVAN, JAMERSON) e outros 9 certos por sorte da ordem fisica.
  // E todo leitor que filtra por empresa — inclusive o piso em
  // promoterAnalytics:1421 — acha o consorcio numa empresa onde o promotor nao
  // produziu.
  //
  // FALLBACK a `v.company_id` quando o promotor NAO aparece no fechamento do mes
  // (so-produto, sem credito): nao ha dona a resolver, e a empresa da linha e a
  // unica informacao que existe.
  const donaCompany = await buildDonaCompanyMapDoMes(supabase, { year, month });
  const empresaDe = (v: { promoter_id: string; company_id: string | null }) =>
    donaCompany.get(v.promoter_id) ?? v.company_id;

  // `chaves` sai ANTES do early-return e ja com a empresa DONA. E o que o
  // reconciliador de reconsolidarCompetencia usa para NAO apagar o promotor que
  // so tem produto; devolve-lo vazio em dryRun faria o dry-run mentir sobre o que
  // a gravacao preservaria. (Ate 24/08 ele era montado com v.company_id, a
  // empresa da LINHA — a mesma origem do defeito da linha duplicada.)
  const chaves = new Set<string>();
  for (const v of porPromotor) chaves.add(chavePmr(v.promoter_id, empresaDe(v)));

  if (porPromotor.length === 0 || dryRun) {
    // `promotores` = DISTINTOS, igual ao retorno do caminho que grava (ver la).
    return {
      chaves,
      atualizadas: 0,
      inseridas: 0,
      promotores: new Set(porPromotor.map((v) => v.promoter_id)).size,
      gestao,
    };
  }

  // Le producao/seguro atuais dos promotores com produto (para recompor o final
  // SEM tocar producao/seguro).
  const pids = [...new Set(porPromotor.map((v) => v.promoter_id))];
  const existentes = new Map<string, { prod: number; ins: number }>();
  for (let i = 0; i < pids.length; i += 300) {
    const { data, error } = await supabase
      .from("promoter_monthly_results")
      .select("promoter_id, company_id, production_commission_value, insurance_commission_value")
      .eq("year", year)
      .eq("month", month)
      .in("promoter_id", pids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      existentes.set(chavePmr(r.promoter_id, r.company_id), {
        prod: Number(r.production_commission_value || 0),
        ins: Number(r.insurance_commission_value || 0),
      });
    }
  }

  // UMA LINHA POR CHAVE FINAL, NUNCA UMA POR BUCKET.
  //
  // Os buckets sao chaveados por `beneficiario|company_id da LINHA` (:248). Um
  // promotor com produto em tres empresas gera TRES buckets, e `empresaDe()`
  // manda os tres para a MESMA empresa dona. Ate 24/08/2026 o loop abaixo
  // empurrava um update POR BUCKET: tres linhas com a mesma
  // (promoter_id, year, month, company_id) no MESMO upsert, e o Postgres recusa
  // o lote inteiro com "ON CONFLICT DO UPDATE command cannot affect row a
  // second time".
  //
  // O ESTRAGO NAO E SO O ERRO. O reconsolidar aborta NO MEIO: o grupo (RR+ADS)
  // ja gravou producao e seguro, e quem recompoe o final com os produtos e
  // justamente este passo. Medido em jul/2026 depois do abort: 19 linhas com
  // final_commission_value SEM a parcela de produto (Sigma das partes
  // 140.505,21 contra 139.989,15 gravados, delta -516,06), 17 linhas orfas "so
  // produto" que o reconciliador nao chegou a apagar, e as colunas de produto
  // congeladas nas empresas da rodada anterior.
  //
  // Medido em jul/2026: 28 buckets -> 21 chaves finais -> 5 colapsos (JENIFFER
  // e BIANCA com 3 buckets; JARLES, JAMERSON e MAYANNE com 2). Em jun/2026, 8
  // buckets -> 8 chaves -> 0 colapsos: por isso junho passou e julho quebrou.
  //
  // `empresaDe()` esta certo — o defeito era a granularidade da escrita. Agora
  // os buckets sao SOMADOS por chave final antes de virar linha.
  const porChaveFinal = new Map<
    string,
    { promoter_id: string; companyId: string | null; bbcap: number; conta_corrente: number; consorcio: number; lob: number }
  >();
  for (const v of porPromotor) {
    const companyId = empresaDe(v);
    const k = chavePmr(v.promoter_id, companyId);
    const acc =
      porChaveFinal.get(k) ??
      { promoter_id: v.promoter_id, companyId, bbcap: 0, conta_corrente: 0, consorcio: 0, lob: 0 };
    acc.bbcap += Number(v.bbcap || 0);
    acc.conta_corrente += Number(v.conta_corrente || 0);
    acc.consorcio += Number(v.consorcio || 0);
    acc.lob += Number(v.lob || 0);
    porChaveFinal.set(k, acc);
  }

  const updates: any[] = []; // linhas ja existentes: nao mexe em producao/seguro
  const inserts: any[] = []; // promotores so-produto: nascem com producao/seguro 0
  for (const [k, v] of porChaveFinal) {
    const companyId = v.companyId;
    const base = existentes.get(k);
    const prod = base?.prod ?? 0;
    const ins = base?.ins ?? 0;
    // PISO: zera as colunas de produto TAMBEM, nao so a contribuicao para o
    // final. Coluna com valor e final sem ele seria um rastro que se contradiz.
    const fator = params.fatorProdutoByPromoter?.get(v.promoter_id) ?? 1;
    const bbcap = round2Produto(v.bbcap * fator);
    const contaCorrente = round2Produto(v.conta_corrente * fator);
    const consorcio = round2Produto(v.consorcio * fator);
    const lob = round2Produto(v.lob * fator);
    const final = round2Produto(prod + ins + bbcap + contaCorrente + consorcio + lob);
    if (base) {
      updates.push({
        promoter_id: v.promoter_id,
        company_id: companyId,
        year,
        month,
        bbcap_commission_value: bbcap,
        conta_corrente_commission_value: contaCorrente,
        consorcio_commission_value: consorcio,
        lob_commission_value: lob,
        final_commission_value: final,
      });
    } else {
      inserts.push({
        promoter_id: v.promoter_id,
        company_id: companyId,
        year,
        month,
        source: "fechamento",
        production_commission_value: 0,
        insurance_commission_value: 0,
        bbcap_commission_value: bbcap,
        conta_corrente_commission_value: contaCorrente,
        consorcio_commission_value: consorcio,
        lob_commission_value: lob,
        final_commission_value: final,
      });
    }
  }

  const onConflict = "promoter_id,year,month,company_id";
  for (const batch of [updates, inserts]) {
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await supabase
        .from("promoter_monthly_results")
        .upsert(batch.slice(i, i + 500), { onConflict });
      if (error) throw new Error(error.message);
    }
  }
  return {
    chaves,
    atualizadas: updates.length,
    inseridas: inserts.length,
    // PROMOTORES DISTINTOS, nao buckets. Antes de 24/08/2026 isto era
    // `porPromotor.length` — a contagem de BUCKETS, que conta o mesmo promotor
    // uma vez por empresa de origem do produto. Em jul/2026 dizia 28 onde ha 21
    // linhas e 21 promotores; o numero inflado era o mesmo sintoma do defeito
    // do upsert, so que no diagnostico.
    promotores: new Set(porPromotor.map((v) => v.promoter_id)).size,
    gestao,
  };
}
