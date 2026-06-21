import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
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
};

const COLUMNS =
  "competencia, operation_number, company_cnpj, status, parcelas_pagas, " +
  "parcelas_total, ultimo_mes_pago, meses_parado, recuperavel_estimado, " +
  "primeira_deteccao, status_acompanhamento";

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
      }))
      // recuperável desc; empate → parou há mais tempo primeiro.
      .sort(
        (a, b) =>
          b.recuperavel_estimado - a.recuperavel_estimado ||
          (b.meses_parado ?? 0) - (a.meses_parado ?? 0),
      );

    // Aberto = recebível em aberto: A_COBRAR (NOVO) + AGUARDANDO_EXPLICACAO +
    // EM_COBRANCA. Nada é descartado automaticamente (decisão do Diego).
    const aberta = fila.filter(
      (r) =>
        r.status_acompanhamento === "NOVO" ||
        r.status_acompanhamento === "AGUARDANDO_EXPLICACAO" ||
        r.status_acompanhamento === "EM_COBRANCA",
    );

    const agregados = {
      novo: fila.filter((r) => r.status_acompanhamento === "NOVO").length,
      aguardandoExplicacao: fila.filter(
        (r) => r.status_acompanhamento === "AGUARDANDO_EXPLICACAO",
      ).length,
      emCobranca: fila.filter((r) => r.status_acompanhamento === "EM_COBRANCA")
        .length,
      recuperado: fila.filter((r) => r.status_acompanhamento === "RECUPERADO")
        .length,
      recuperavelAberto: aberta.reduce(
        (acc, r) => acc + r.recuperavel_estimado,
        0,
      ),
    };

    return NextResponse.json({ competencia, competencias, fila, agregados });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
