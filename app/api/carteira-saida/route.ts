import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saídas da carteira (Opção B): lista os contratos que sumiram ANTES do prazo =
// diferido interrompido que a Promotiva TEM QUE justificar (ônus da prova dela).
// SÓCIO-ONLY (auditoria sensível). READ-ONLY — esta fatia só LISTA e EXPORTA; a
// marcação de status_justificativa é a fatia seguinte.

interface SaidaRow {
  numero_operacao: string;
  competencia_ultima: string;
  parcelas_pagas: number | null;
  prazo: number | null;
  parcelas_restantes: number | null;
  comissao: number | null;
  diferido_interrompido: number | null;
  status_justificativa: string | null;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Faixa de parcelas_restantes (o >36 é o núcleo material). */
function naFaixa(restantes: number | null, faixa: string): boolean {
  const r = restantes ?? 0;
  if (faixa === ">36") return r > 36;
  if (faixa === "13-36") return r >= 13 && r <= 36;
  if (faixa === "4-12") return r >= 4 && r <= 12;
  if (faixa === "1-3") return r >= 1 && r <= 3;
  return true; // all
}

function csvCampo(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  try {
    // Auditoria de cobrança = dado de SÓCIO. service_role (Escola A) + guard socio.
    const { supabase } = await withSocioAdmin();

    const url = new URL(req.url);
    const faixa = url.searchParams.get("faixa") || "all";
    const status = url.searchParams.get("status") || "all";
    const format = url.searchParams.get("format") || "json";

    const { data, error } = await supabase
      .from("carteira_saida")
      .select(
        "numero_operacao, competencia_ultima, parcelas_pagas, prazo, parcelas_restantes, comissao, diferido_interrompido, status_justificativa"
      )
      .order("diferido_interrompido", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SaidaRow[];

    // KPIs sobre o TOTAL (não filtrado) — o recorte material (>36) em destaque.
    const total = rows.length;
    const valorEmRisco = round2(rows.reduce((s, r) => s + toNum(r.diferido_interrompido), 0));
    const materiais = rows.filter((r) => (r.parcelas_restantes ?? 0) > 36);
    const material = {
      contratos: materiais.length,
      valor: round2(materiais.reduce((s, r) => s + toNum(r.diferido_interrompido), 0)),
    };

    // Itens respeitam o filtro (faixa + status); ordenação já vem desc do banco.
    const itens = rows.filter(
      (r) => naFaixa(r.parcelas_restantes, faixa) && (status === "all" || r.status_justificativa === status)
    );

    if (format === "csv") {
      const header = [
        "numero_operacao",
        "competencia_ultima",
        "parcelas_pagas",
        "prazo",
        "parcelas_restantes",
        "comissao",
        "diferido_interrompido",
        "status_justificativa",
      ];
      const linhas = [header.join(";")];
      for (const r of itens) {
        linhas.push(
          [
            r.numero_operacao,
            r.competencia_ultima,
            r.parcelas_pagas,
            r.prazo,
            r.parcelas_restantes,
            r.comissao,
            r.diferido_interrompido,
            r.status_justificativa,
          ]
            .map(csvCampo)
            .join(";")
        );
      }
      const somaFiltrada = round2(itens.reduce((s, r) => s + toNum(r.diferido_interrompido), 0));
      linhas.push(
        ["TOTAL", "", "", "", "", "", somaFiltrada, `${itens.length} contratos`].map(csvCampo).join(";")
      );
      // BOM p/ o Excel abrir os acentos corretamente.
      const csv = "﻿" + linhas.join("\r\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="saidas-carteira.csv"',
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      { kpis: { total, valorEmRisco, material }, itens },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
