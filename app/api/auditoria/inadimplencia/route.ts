import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildInadimplenciaAgregados } from "@/lib/auditoria/inadimplenciaAgregados";
import { fetchAllRows } from "@/lib/queryHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// MONITOR DE INADIMPLÊNCIA PRT — Camada 4: API da fila para a Auditoria.
// Lê o snapshot persistido (prt_inadimplencia_monitor, Camada 2/3) e devolve a
// fila de PRT interrompido não cobrado da competência pedida (default = última
// competência com snapshot), mais os agregados para o KpiBand. socio-only
// (mesmo guard das outras rotas de /api/auditoria).
// READ-ONLY.
// ============================================================

const TABLE = "prt_inadimplencia_monitor";

type MonitorRow = {
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
  status_acompanhamento: string;
  resolucao_status: string | null;
  resolucao_por: string | null;
  resolucao_em: string | null;
};

const COLUMNS =
  "competencia, operation_number, company_cnpj, status, parcelas_pagas, " +
  "parcelas_total, ultimo_mes_pago, meses_parado, recuperavel_estimado, " +
  "primeira_deteccao, status_acompanhamento, resolucao_status, " +
  "resolucao_por, resolucao_em";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const pedida = (searchParams.get("competencia") || "").trim();
    const competenciaParam = COMPETENCIA_RE.test(pedida) ? pedida : null;

    const rows = await fetchAllRows<MonitorRow>(() =>
      supabase.from(TABLE).select(COLUMNS),
    );

    // competências disponíveis (desc) — alimenta o dropdown da tela.
    const competencias = Array.from(new Set(rows.map((r) => r.competencia))).sort(
      (a, b) => (a < b ? 1 : a > b ? -1 : 0),
    );

    // default = última competência com snapshot.
    const competencia =
      competenciaParam && competencias.includes(competenciaParam)
        ? competenciaParam
        : competencias[0] ?? null;

    const fila = rows
      .filter((r) => r.competencia === competencia)
      .map((r) => ({
        status_acompanhamento: r.status_acompanhamento,
        operation_number: r.operation_number,
        company_cnpj: r.company_cnpj,
        status: r.status,
        parcelas_pagas: Number(r.parcelas_pagas ?? 0),
        parcelas_total: Number(r.parcelas_total ?? 0),
        ultimo_mes_pago: r.ultimo_mes_pago,
        meses_parado: r.meses_parado == null ? null : Number(r.meses_parado),
        recuperavel_estimado: Number(r.recuperavel_estimado ?? 0),
        primeira_deteccao: r.primeira_deteccao,
        // Fatia B — resolução manual (mecanismo separado do motor).
        resolucao_status: r.resolucao_status ?? "PENDENTE",
        resolucao_por: r.resolucao_por,
        resolucao_em: r.resolucao_em,
      }))
      // recuperável desc; empate → parou há mais tempo primeiro.
      .sort(
        (a, b) =>
          b.recuperavel_estimado - a.recuperavel_estimado ||
          (b.meses_parado ?? 0) - (a.meses_parado ?? 0),
      );

    // Fatia B — SOLUCIONADO (resolução manual) sai da fila e de TODO agregado
    // de fila (não conta em novo/emCobranca/recuperado nem no recuperável
    // aberto); vira agregado informativo próprio. Lógica pura e testável.
    const agregados = buildInadimplenciaAgregados(fila);

    return NextResponse.json({ competencia, competencias, fila, agregados });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
