// ============================================================
// MONITOR DE INADIMPLÊNCIA PRT — Camada 2: persistência do snapshot mensal.
//
// persistInadimplenciaSnapshot(supabase, competencia):
//   (a) UPSERT dos novos detectados (buildInadimplenciaNovos) por
//       (competencia, operation_number). primeira_deteccao = a mais antiga se o
//       contrato já existe, senão = competencia. status_acompanhamento = NOVO.
//   (b) Reconcilia os ABERTOS (NOVO/EM_COBRANCA) cruzando com cobranca_itens
//       (tipo=PRT) → EM_COBRANCA + ja_cobrado + cobranca_id; com
//       cobrancas_emitidas.status='PAGA' → RECUPERADO; e com os ressurgidos
//       (op que não está mais em suspeitosAtuaisOps) → RESSURGIU.
//
// Idempotente (UPSERT por chave única). dryRun=true NÃO escreve e devolve o
// plano — usado para revisar/validar antes da migration ser aplicada. NÃO há
// gatilho automático aqui (isso é Camada 3).
//
// READ-ONLY quando dryRun=true.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllRows } from "@/lib/queryHelpers";
import {
  buildInadimplenciaNovos,
  type InadimplenciaNovoItem,
} from "./inadimplenciaNovos.ts";

const TABLE = "prt_inadimplencia_monitor";

type Competencia = { year: number; month: number };
// AGUARDANDO_EXPLICACAO e JUSTIFICADO são novos (ver ALTER proposto no fim do
// arquivo). NOVO = fase A_COBRAR; AGUARDANDO_EXPLICACAO = fase homônima. BAIXADO/
// JUSTIFICADO = baixa MANUAL (nunca automática). Abertos = NOVO + EM_COBRANCA +
// AGUARDANDO_EXPLICACAO.
type Acompanhamento =
  | "NOVO"
  | "AGUARDANDO_EXPLICACAO"
  | "EM_COBRANCA"
  | "RECUPERADO"
  | "RESSURGIU"
  | "BAIXADO"
  | "JUSTIFICADO";

/** Estados "abertos" (em aberto na fila) — todos contam no recuperável. */
const ABERTOS: Acompanhamento[] = ["NOVO", "AGUARDANDO_EXPLICACAO", "EM_COBRANCA"];

/** Fase (A_COBRAR/AGUARDANDO_EXPLICACAO) → status_acompanhamento inicial. */
function statusInicialDaFase(fase: InadimplenciaNovoItem["fase"]): Acompanhamento {
  return fase === "A_COBRAR" ? "NOVO" : "AGUARDANDO_EXPLICACAO";
}

export interface MonitorUpsert {
  competencia: string;
  operation_number: string;
  company_cnpj: string | null;
  status: string;
  parcelas_pagas: number;
  parcelas_total: number;
  ultimo_mes_pago: string | null;
  meses_parado: number | null;
  recuperavel_estimado: number;
  primeira_deteccao: string;
  status_acompanhamento: Acompanhamento;
}

export interface MonitorUpdate {
  /** Linha-alvo identificada por (competencia, operation_number). */
  competencia: string;
  operation_number: string;
  status_acompanhamento: Acompanhamento;
  ja_cobrado?: boolean;
  cobranca_id?: string | null;
}

export interface PersistResult {
  competencia: string;
  dryRun: boolean;
  upserts: MonitorUpsert[];
  updates: MonitorUpdate[];
  resumo: {
    novos: number;
    aCobrar: number;
    aguardandoExplicacao: number;
    emCobranca: number;
    recuperados: number;
    ressurgidos: number;
    recuperavelNovo: number;
  };
}

export interface PersistOptions {
  competencia: Competencia;
  lookbackParadaMeses?: number;
  /** true: não escreve, só devolve o plano (revisão pré-migration). */
  dryRun?: boolean;
}

function compLabel(c: Competencia): string {
  return `${c.year}-${String(c.month).padStart(2, "0")}`;
}
function ympLabel(u: { year: number; month: number } | null): string | null {
  return u ? `${u.year}-${String(u.month).padStart(2, "0")}` : null;
}
function mesesParado(c: Competencia, u: { year: number; month: number } | null): number | null {
  if (!u) return null;
  return c.year * 12 + (c.month - 1) - (u.year * 12 + (u.month - 1));
}

export async function persistInadimplenciaSnapshot(
  supabase: SupabaseClient,
  options: PersistOptions,
): Promise<PersistResult> {
  const { competencia } = options;
  const dryRun = options.dryRun ?? false;
  const competenciaStr = compLabel(competencia);

  const det = await buildInadimplenciaNovos(supabase, {
    competencia,
    lookbackParadaMeses: options.lookbackParadaMeses,
  });
  const suspeitosAtuais = new Set(det.suspeitosAtuaisOps);

  // ---- (a) primeira_deteccao (menor competência do contrato) + preservação do
  //         status atual da linha desta competência (não clobberar baixa manual
  //         nem EM_COBRANCA/RECUPERADO já reconciliados num re-import). ----
  const primeiraByOp = new Map<string, string>();
  const statusAtualByKey = new Map<string, Acompanhamento>();
  if (!dryRun && det.novos.length > 0) {
    const ops = det.novos.map((n) => n.operationNumber);
    const rows = await fetchAllRows<{
      competencia: string;
      operation_number: string;
      primeira_deteccao: string;
      status_acompanhamento: Acompanhamento;
    }>(() =>
      supabase
        .from(TABLE)
        .select("competencia, operation_number, primeira_deteccao, status_acompanhamento")
        .in("operation_number", ops),
    );
    for (const r of rows) {
      const cur = primeiraByOp.get(r.operation_number);
      if (!cur || r.primeira_deteccao < cur) primeiraByOp.set(r.operation_number, r.primeira_deteccao);
      if (r.competencia === competenciaStr) {
        statusAtualByKey.set(r.operation_number, r.status_acompanhamento);
      }
    }
  }

  const upserts: MonitorUpsert[] = det.novos.map((n: InadimplenciaNovoItem) => ({
    competencia: competenciaStr,
    operation_number: n.operationNumber,
    company_cnpj: n.companyCnpj ?? null,
    status: n.status,
    parcelas_pagas: n.parcelasPagas,
    parcelas_total: n.parcelasTotal,
    ultimo_mes_pago: ympLabel(n.ultimoMesPago),
    meses_parado: mesesParado(competencia, n.ultimoMesPago),
    recuperavel_estimado: n.recuperavelEstimado,
    primeira_deteccao: primeiraByOp.get(n.operationNumber) ?? competenciaStr,
    // Linha nova → status da fase (NOVO ou AGUARDANDO_EXPLICACAO). Linha que já
    // existe → PRESERVA o status atual (idempotente; respeita baixa manual).
    status_acompanhamento:
      statusAtualByKey.get(n.operationNumber) ?? statusInicialDaFase(n.fase),
  }));

  // ---- (b) reconciliação dos abertos (NOVO/EM_COBRANCA) ----
  const itens = await fetchAllRows<{ tipo: string; contract_number: string; cobranca_id: string }>(
    () => supabase.from("cobranca_itens").select("tipo, contract_number, cobranca_id"),
  );
  const cobrPrt = new Map<string, string>();
  for (const i of itens) {
    if (i.tipo === "PRT") cobrPrt.set(String(i.contract_number ?? "").trim(), i.cobranca_id);
  }
  const cobrancas = await fetchAllRows<{ id: string; status: string }>(() =>
    supabase.from("cobrancas_emitidas").select("id, status"),
  );
  const pagaSet = new Set(cobrancas.filter((c) => c.status === "PAGA").map((c) => c.id));

  const updates: MonitorUpdate[] = [];
  if (!dryRun) {
    const abertos = await fetchAllRows<{
      competencia: string;
      operation_number: string;
      status_acompanhamento: string;
      ja_cobrado: boolean;
    }>(() =>
      supabase
        .from(TABLE)
        .select("competencia, operation_number, status_acompanhamento, ja_cobrado")
        .in("status_acompanhamento", ABERTOS),
    );

    for (const row of abertos) {
      const op = row.operation_number;
      const cid = cobrPrt.get(op);
      if (cid) {
        const novoStatus: Acompanhamento = pagaSet.has(cid) ? "RECUPERADO" : "EM_COBRANCA";
        if (row.status_acompanhamento !== novoStatus || !row.ja_cobrado) {
          updates.push({
            competencia: row.competencia,
            operation_number: op,
            status_acompanhamento: novoStatus,
            ja_cobrado: true,
            cobranca_id: cid,
          });
        }
      } else if (!suspeitosAtuais.has(op)) {
        // deixou de ser inadimplente e não foi cobrado => voltou a pagar.
        updates.push({
          competencia: row.competencia,
          operation_number: op,
          status_acompanhamento: "RESSURGIU",
        });
      }
    }
  }

  // ---- escrita (só fora do dry-run) ----
  if (!dryRun) {
    if (upserts.length > 0) {
      const { error } = await supabase
        .from(TABLE)
        .upsert(upserts, { onConflict: "competencia,operation_number" });
      if (error) throw new Error(`upsert monitor: ${error.message}`);
    }
    for (const u of updates) {
      const patch: Record<string, unknown> = {
        status_acompanhamento: u.status_acompanhamento,
        atualizado_em: new Date().toISOString(),
      };
      if (u.ja_cobrado !== undefined) patch.ja_cobrado = u.ja_cobrado;
      if (u.cobranca_id !== undefined) patch.cobranca_id = u.cobranca_id;
      const { error } = await supabase
        .from(TABLE)
        .update(patch)
        .eq("competencia", u.competencia)
        .eq("operation_number", u.operation_number);
      if (error) throw new Error(`update monitor ${u.operation_number}: ${error.message}`);
    }
  }

  return {
    competencia: competenciaStr,
    dryRun,
    upserts,
    updates,
    resumo: {
      novos: upserts.length,
      aCobrar: det.aCobrar,
      aguardandoExplicacao: det.aguardandoExplicacao,
      emCobranca: updates.filter((u) => u.status_acompanhamento === "EM_COBRANCA").length,
      recuperados: updates.filter((u) => u.status_acompanhamento === "RECUPERADO").length,
      ressurgidos: updates.filter((u) => u.status_acompanhamento === "RESSURGIU").length,
      recuperavelNovo: det.recuperavelNovo,
    },
  };
}

// ============================================================
// ALTER PROPOSTO (NÃO aplicado — banco é manual no Supabase Studio).
// A migration 20260621000000_inadimplencia_monitor.sql tem:
//   check (status_acompanhamento in
//     ('NOVO','EM_COBRANCA','RECUPERADO','RESSURGIU','BAIXADO'))
// Faltam os 2 estados novos. Rodar no Studio antes de persistir AGUARDANDO_EXPLICACAO:
//
//   alter table public.prt_inadimplencia_monitor
//     drop constraint if exists prt_inadimplencia_monitor_status_acompanhamento_check;
//   alter table public.prt_inadimplencia_monitor
//     add constraint prt_inadimplencia_monitor_status_acompanhamento_check
//     check (status_acompanhamento in
//       ('NOVO','AGUARDANDO_EXPLICACAO','EM_COBRANCA',
//        'RECUPERADO','RESSURGIU','BAIXADO','JUSTIFICADO'));
//
// (Confirme o nome real da constraint com:
//   select conname from pg_constraint
//   where conrelid = 'public.prt_inadimplencia_monitor'::regclass and contype = 'c';)
// JUSTIFICADO = baixa manual quando a Promotiva justifica e o Diego ACEITA.
// ============================================================
