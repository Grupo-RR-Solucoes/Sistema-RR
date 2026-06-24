/**
 * GET /api/auditoria/avista-viva?year=2026&month=4[&format=csv]
 *
 * Conferência mensal à vista VIVA — FECHAMENTO-PRIMÁRIO. Audita a competência ao
 * vivo: universo = monthly_closing_entries CASH do mês (o pago), devido pela TRP
 * da competência (lib/auditoriaAvistaViva.auditAvistaMesVivo). READ-ONLY.
 *
 * Auth: withSocioAnon (socio-only). Dados vivos via getSupabaseAdmin (service
 * role), mesmo padrão do /api/auditoria/historico.
 *
 * Não exige diária: o fechamento basta. A diária (quando existe) só enriquece
 * (faixa exata + lane de reconciliação "produzido não pago"). ?format=csv
 * exporta as divergências.
 */
import { NextRequest, NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { auditAvistaMesVivo } from "@/lib/auditoriaAvistaViva";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Divergencia = {
  contrato: string;
  empresa: string;
  produto: string | null;
  txJuros: number;
  prazo: number;
  valorLiquido: number;
  comissaoPaga: number;
  comissaoDevida: number;
  diferenca: number;
  pctDevido: number | null;
  regraTrp: string;
};

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const startMs = Date.now();

  try {
    await withSocioAnon();
  } catch (error) {
    return apiGuardErrorResponse(error);
  }

  const { searchParams } = new URL(req.url);
  const year = Number.parseInt(searchParams.get("year") ?? "", 10);
  const month = Number.parseInt(searchParams.get("month") ?? "", 10);
  const format = searchParams.get("format");

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json(
      { error: "year e month obrigatórios e válidos (month: 1-12)" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const r = await auditAvistaMesVivo(sb, year, month);

    const inputByOp = new Map(r.itensAuditados.map((i) => [i.operacao, i.contrato]));

    const divergencias: Divergencia[] = r.resultados
      .filter((x) => x.bloco === "PEDIDO_FIRME_2.1")
      .map((x) => {
        const c = inputByOp.get(x.contractNumber);
        const t = x.trace;
        const regraTrp =
          [t.categoriaProduto, t.tabLabelUsado].filter(Boolean).join(" ") ||
          (t.celula ?? "—");
        return {
          contrato: x.contractNumber,
          empresa: c?.empresa ?? "",
          produto: c?.produto ?? null,
          txJuros: c?.txJuros ?? 0,
          prazo: c?.prazo ?? 0,
          valorLiquido: c?.valorLiquido ?? 0,
          comissaoPaga: c?.comissaoPaga ?? 0,
          comissaoDevida: x.comissaoDevida,
          diferenca: x.diferenca,
          pctDevido: x.pctDevido,
          regraTrp,
        };
      })
      .sort((a, b) => a.diferenca - b.diferenca);

    if (format === "csv") {
      const head = [
        "contrato",
        "empresa",
        "produto",
        "tx_juros",
        "prazo",
        "valor_liquido",
        "comissao_paga",
        "comissao_devida",
        "diferenca",
        "pct_devido",
        "regra_trp",
      ];
      const lines = [head.join(";")];
      for (const d of divergencias) {
        lines.push(
          [
            d.contrato,
            d.empresa,
            d.produto ?? "",
            d.txJuros,
            d.prazo,
            d.valorLiquido.toFixed(2),
            d.comissaoPaga.toFixed(2),
            d.comissaoDevida.toFixed(2),
            d.diferenca.toFixed(2),
            d.pctDevido != null ? (d.pctDevido * 100).toFixed(4) : "",
            d.regraTrp,
          ]
            .map(csvCell)
            .join(";")
        );
      }
      const csv = "﻿" + lines.join("\r\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="divergencias-avista-${r.ym}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      meta: {
        year,
        month,
        ym: r.ym,
        regime: r.regime,
        fonte: r.fonte,
        totalMs: Date.now() - startMs,
      },
      universo: {
        total: r.universo,
        srccExcluidos: r.srccExcluidos,
        faixa: r.faixa,
      },
      resumo: {
        totalAuditados: r.resumo.auditados,
        somaPaga: r.resumo.somaComissaoPaga,
        somaDevida: r.resumo.somaComissaoDevida,
        somaDivergencia: r.resumo.somaSubpagamento,
        nSubpagamentos: r.resumo.subpagamentos,
        porStatus: r.resumo.porStatus,
        batimento: r.batimento,
      },
      reconciliacao: {
        diariaDisponivel: r.diariaDisponivel,
        produzidoNaoPago: r.reconciliacao.produzidoNaoPago.length,
        nMaduro: r.reconciliacao.nMaduro,
        nRecente: r.reconciliacao.nRecente,
      },
      segmentoAConfirmar: {
        total: r.segmentoAConfirmar.length,
        itens: r.segmentoAConfirmar.slice(0, 100),
      },
      divergencias,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
