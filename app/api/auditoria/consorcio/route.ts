import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { fetchAllRows } from "@/lib/queryHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// AUDITORIA FORTE DO CONSORCIO (M2b) — API da fila de parcelas que nao vieram.
// Le o snapshot persistido (consorcio_inadimplencia_monitor) e devolve, por
// competencia, as parcelas ESPERADAS que nao chegaram (PARCELA_NAO_VEIO), com o
// valor previsto pela TRP 210 e o recuperavel da cauda. socio-only. READ-ONLY.
// ============================================================

const TABLE = "consorcio_inadimplencia_monitor";

type MonitorRow = {
  competencia: string;
  proposta: string;
  posicao: number;
  status: string;
  segmento_grupo: string | null;
  teto_parcelas: number;
  posicao_recebida_max: number;
  ultimo_mes_recebido: string | null;
  cauda_restante: number;
  valor_previsto: number;
  recuperavel_estimado: number;
  primeira_deteccao: string;
  status_acompanhamento: string;
  resolucao_status: string | null;
  resolucao_por: string | null;
  resolucao_em: string | null;
};

const COLUMNS =
  "competencia, proposta, posicao, status, segmento_grupo, teto_parcelas, " +
  "posicao_recebida_max, ultimo_mes_recebido, cauda_restante, valor_previsto, " +
  "recuperavel_estimado, primeira_deteccao, status_acompanhamento, " +
  "resolucao_status, resolucao_por, resolucao_em";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const pedida = (searchParams.get("competencia") || "").trim();
    const competenciaParam = COMPETENCIA_RE.test(pedida) ? pedida : null;

    const rows = await fetchAllRows<MonitorRow>(() => supabase.from(TABLE).select(COLUMNS));

    const competencias = Array.from(new Set(rows.map((r) => r.competencia))).sort((a, b) =>
      a < b ? 1 : a > b ? -1 : 0
    );
    const competencia =
      competenciaParam && competencias.includes(competenciaParam)
        ? competenciaParam
        : competencias[0] ?? null;

    const doMes = rows.filter((r) => r.competencia === competencia);
    const fila = doMes
      .map((r) => ({
        proposta: r.proposta,
        posicao: Number(r.posicao ?? 0),
        status: r.status,
        segmento_grupo: r.segmento_grupo,
        teto_parcelas: Number(r.teto_parcelas ?? 0),
        posicao_recebida_max: Number(r.posicao_recebida_max ?? 0),
        ultimo_mes_recebido: r.ultimo_mes_recebido,
        cauda_restante: Number(r.cauda_restante ?? 0),
        valor_previsto: Number(r.valor_previsto ?? 0),
        recuperavel_estimado: Number(r.recuperavel_estimado ?? 0),
        primeira_deteccao: r.primeira_deteccao,
        status_acompanhamento: r.status_acompanhamento,
        resolucao_status: r.resolucao_status ?? "PENDENTE",
        resolucao_por: r.resolucao_por,
        resolucao_em: r.resolucao_em,
      }))
      .sort(
        (a, b) => b.recuperavel_estimado - a.recuperavel_estimado || a.proposta.localeCompare(b.proposta)
      );

    const pendentes = fila.filter((r) => r.resolucao_status !== "SOLUCIONADO");
    const solucionadas = fila.filter((r) => r.resolucao_status === "SOLUCIONADO");
    const agregados = {
      suspeitos: pendentes.filter((r) => r.status === "PARCELA_NAO_VEIO_SUSPEITO").length,
      quitacoes: pendentes.filter((r) => r.status === "PARCELA_NAO_VEIO_QUITACAO").length,
      recuperavelAberto: pendentes.reduce((s, r) => s + r.recuperavel_estimado, 0),
      solucionado: {
        contagem: solucionadas.length,
        valor: solucionadas.reduce((s, r) => s + r.recuperavel_estimado, 0),
      },
    };

    return NextResponse.json({ competencia, competencias, fila, agregados });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
