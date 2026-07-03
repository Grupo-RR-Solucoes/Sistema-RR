/**
 * GET /api/auditoria/trp-conferencia?year=2026&month=6[&format=csv]
 *
 * Conferência TRP × REALIZADO — sub-fase (b). A TRP versionada é a RÉGUA (o pct
 * que DEVERIA ser); o realizado (comissaoPaga/valorLiquido do universo de
 * fechamento) é o FATO. Compara os dois por contrato e sinaliza divergências.
 * TETO EMPRESA 6% LISO (NÃO BACEN) — distinto da à-vista viva. READ-ONLY.
 *
 * Delega 100% a lib/trp/conferenciaTrp.conferirTrpMes (sub-fase a). Retorna
 * { ym, regua, linhas, resumo }. ?format=csv exporta as linhas (ordenadas,
 * subpagamentos no topo).
 *
 * Auth: withSocioAdmin (socio-only, checado no servidor + service_role para ler
 * os dados vivos). Sem tela ainda (sub-fase c).
 */
import { NextRequest, NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { conferirTrpMes } from "@/lib/trp/conferenciaTrp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pctCsv = (v: number | null) => (v == null ? "" : (v * 100).toFixed(4));
const brlCsv = (v: number | null) => (v == null ? "" : v.toFixed(2));

export async function GET(req: NextRequest) {
  // Guard socio-only NO SERVIDOR (403 para não-sócio) + service_role.
  let supabase;
  try {
    ({ supabase } = await withSocioAdmin());
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
      { status: 400 },
    );
  }

  try {
    const r = await conferirTrpMes(supabase, year, month);

    if (format === "csv") {
      const head = [
        "contrato",
        "empresa",
        "produto",
        "tipo",
        "prazo",
        "tx_juros",
        "faixa",
        "valor_liquido",
        "pct_realizado",
        "pct_regua",
        "pct_tabela_cru",
        "comissao_paga",
        "comissao_devida",
        "diferenca",
        "status",
      ];
      const lines = [head.join(";")];
      for (const l of r.linhas) {
        lines.push(
          [
            l.contrato,
            l.empresa,
            l.produto ?? "",
            l.tipo ?? "",
            l.prazo,
            l.txJuros,
            l.faixa ?? "",
            brlCsv(l.valorLiquido),
            pctCsv(l.pctRealizado),
            pctCsv(l.pctRegua),
            pctCsv(l.pctTabelaCru),
            brlCsv(l.comissaoPaga),
            brlCsv(l.comissaoDevida),
            brlCsv(l.diferenca),
            l.status,
          ]
            .map(csvCell)
            .join(";"),
        );
      }
      const csv = "﻿" + lines.join("\r\n");
      const fonte = r.regua.fonte ?? "sem-regua";
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="conferencia-trp-${r.ym}-${fonte}${r.regua.isFallback ? "-fallback" : ""}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      ym: r.ym,
      regua: r.regua,
      linhas: r.linhas,
      resumo: r.resumo,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
