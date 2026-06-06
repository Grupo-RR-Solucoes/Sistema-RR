import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAnon } from "@/lib/auth/guards";
import { buildClosingAnalytics } from "@/lib/closingAnalytics";
import { getClosingPeriods } from "@/lib/auditoria";
import { fetchAllRows } from "@/lib/queryHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function toNum(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function round(n: number) { return Math.round(n * 100) / 100; }
function digits(s: unknown) { return String(s ?? "").replace(/\D/g, ""); }
// "RR ALAGOAS 1" -> "RR Alagoas 1" (mantém sigla RR). Padroniza igual dashboard/RBT12.
function displayCompany(name: string) {
  return String(name || "").split(/\s+/).filter(Boolean)
    .map((w) => (w.toUpperCase() === "RR" ? "RR" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

export async function GET(req: Request) {
  try {
    // D18 — socio-only. Fechamento mensal por empresa (previsto vs recebido).
    const { supabase } = await withSocioAnon();

    const { searchParams } = new URL(req.url);
    const yParam = Number(searchParams.get("year")) || undefined;
    const mParam = Number(searchParams.get("month")) || undefined;
    const nowD = new Date();
    const now = { year: nowD.getUTCFullYear(), month: nowD.getUTCMonth() + 1 };

    const { periods, lastClosed } = await getClosingPeriods(supabase, now);
    const selected =
      (yParam && mParam ? periods.find((p) => p.year === yParam && p.month === mParam) || null : lastClosed) || lastClosed;

    if (!selected) {
      return NextResponse.json({ periods, selectedPeriod: null, aguardandoFechamento: true, summary: null, companyRows: [], recebidoPorMes: [] });
    }
    // Mês aberto (sem fechamento) -> não mostra zeros, mostra "aguardando".
    if (!selected.fechado) {
      return NextResponse.json({ periods, selectedPeriod: selected, aguardandoFechamento: true, summary: null, companyRows: [], recebidoPorMes: [] });
    }

    const [payload, companies] = await Promise.all([
      buildClosingAnalytics(supabase, { year: selected.year, month: selected.month }),
      fetchAllRows<{ cnpj: string; name: string }>(() => supabase.from("companies").select("cnpj, name")),
    ]);
    const nameByDigits = new Map(companies.map((c) => [digits(c.cnpj), displayCompany(c.name)]));

    // Foco em RECEBIDO (real). Previsto/cobertura/gap ficam de fora: o forecast vem
    // zerado pelo Bug 1 nos meses fechados — não exibir número enganoso.
    const selRows = payload.companyRows.filter((r) => r.year === selected.year && r.month === selected.month);
    const recebidoTotal = round(selRows.reduce((a, r) => a + toNum(r.actualNet), 0));
    const companyRows = selRows
      .map((r) => ({
        nome: nameByDigits.get(digits(r.empresa_cnpj)) || r.empresa_nome,
        cnpj: r.empresa_cnpj,
        recebido: round(toNum(r.actualNet)),
        participacao: recebidoTotal > 0 ? round((toNum(r.actualNet) / recebidoTotal) * 100) : 0,
      }))
      .sort((a, b) => b.recebido - a.recebido);

    // recebido por mês (barras) — meses fechados (actualNet > 0)
    const recebidoPorMes = payload.trend
      .filter((t) => toNum(t.actualNet) > 0)
      .map((t) => ({ mes: t.label.split("/")[0], key: t.key, recebido: round(toNum(t.actualNet)) }));

    // variação vs mês fechado anterior (do array recebidoPorMes)
    const idxSel = recebidoPorMes.findIndex((b) => b.key === selected.key);
    const prev = idxSel > 0 ? recebidoPorMes[idxSel - 1] : null;
    const variacaoPct = prev && prev.recebido > 0 ? round(((recebidoTotal - prev.recebido) / prev.recebido) * 100) : null;

    return NextResponse.json({
      periods,
      selectedPeriod: selected,
      aguardandoFechamento: false,
      summary: { recebido: recebidoTotal, empresas: companyRows.length, variacaoPct },
      companyRows,
      recebidoPorMes,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
