import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { conferirBbtsMes } from "@/lib/bbts/conferenciaBbts";

// Auditoria ADS/BBTS — 1C: GET /api/auditoria/bbts-conferencia?year=&month=[&format=csv]
//
// Espelho de /api/auditoria/trp-conferencia. É a CASCA: toda a lógica está em
// lib/bbts/conferenciaBbts (motor) + lib/bbts/resolveBbtsRegra (régua), que são
// libs GENÉRICAS — recebíveis/caixa da ADS vão consumir as mesmas funções sem
// passar por aqui. Esta rota só empacota.
//
// Guard: withSocioAdmin (socio-only, checado NO SERVIDOR) + service_role — as
// tabelas da régua e do PRT são RLS default-deny.
//
// READ-ONLY: não escreve nada.
//
// PRÉ-CONDIÇÕES (a rota NÃO quebra em nenhuma delas — devolve o estado):
//   - sem fechamento ADS na competência -> resumo.auditados = 0 (a tela mostra
//     "sem universo");
//   - sem régua BBTS ativa em lugar nenhum -> regua = null e todas as linhas em
//     FORA_DA_TABELA com motivo (a tela manda subir a tabela em Importações);
//   - régua de OUTRA competência -> isFallback + aviso ("junho auditado com a
//     tabela de julho").
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { supabase } = await withSocioAdmin();

    const url = new URL(req.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));
    const format = url.searchParams.get("format");
    if (!Number.isInteger(year) || year < 2022 || year > 2030) {
      return NextResponse.json({ error: "year inválido" }, { status: 400 });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "month inválido (1-12)" }, { status: 400 });
    }

    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const res = await conferirBbtsMes(supabase, ym);

    if (format === "csv") {
      const head = [
        "contrato",
        "status",
        "grupo",
        "prazo_usado",
        "juros",
        "faixa",
        "valor_financiado",
        "pct_tabela_f4",
        "pct_avista",
        "pct_diferido",
        "pct_realizado",
        "devido_avista",
        "pago_avista",
        "diferenca",
        "devido_prt_total",
        "devido_prt_mensal",
        "motivo",
      ].join(";");
      const linhas = res.linhas.map((l) =>
        [
          l.contrato,
          l.status,
          l.grupo ?? "",
          l.prazoUsado,
          l.juros,
          l.faixa,
          l.valorFinanciado,
          l.pctTabela ?? "",
          l.pctAvista ?? "",
          l.pctDiferido ?? "",
          l.pctRealizado ?? "",
          l.devidoAvista ?? "",
          l.pagoAvista,
          l.diferenca ?? "",
          l.devidoPrtTotal ?? "",
          l.devidoPrtMensal ?? "",
          (l.motivo ?? "").replace(/;/g, ","),
        ].join(";"),
      );
      const csv = "﻿" + [head, ...linhas].join("\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="conferencia-bbts-${ym}.csv"`,
        },
      });
    }

    return NextResponse.json(res);
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
