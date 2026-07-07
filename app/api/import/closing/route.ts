import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { persistInadimplenciaSnapshot } from "@/lib/auditoria/persistInadimplencia";
import {
  DuplicateImportInFlightError,
  importMonthlyClosingWorkbook,
} from "@/lib/monthlyClosingImport";
import { congelarPrevisao } from "@/lib/recebiveis/congelarPrevisao";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    // D34 - Escola A: service_role com guard de socio. Bulk write em
    // fechamento_mensal_empresa + monthly_closing_entries (D5 bloqueia
    // promotor; D2 bloqueia funcionario).
    const { user } = await withSocioAdmin();

    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);

    if (!body.file || !year || !month) {
      return NextResponse.json(
        { error: "Informe arquivo, ano e mes da importacao." },
        { status: 400 }
      );
    }

    const payload = await importMonthlyClosingWorkbook({
      fileBase64: String(body.file),
      fileName: String(body.fileName || "fechamento.xlsx"),
      year,
      month,
      companyId: body.companyId ? String(body.companyId) : undefined,
      createdBy: user.session.appUser.email,
    });

    // ============================================================
    // Pós-import (efeitos colaterais best-effort): cada etapa loga e NÃO derruba
    // o import. ORDEM CRÍTICA:
    //   (1) materializar producao_contrato + carteira_contrato →
    //   (2) congelarPrevisao (lê carteira_contrato via buildPrtAgenda) →
    //   (3) monitor de inadimplência (independente, lê metadata).
    // Materializar DEPOIS de congelar deixaria a previsão congelada sobre uma
    // carteira desatualizada — por isso (1) vem antes de (2).
    // ============================================================

    // (1) Materialização da carteira PRT por-contrato: TRUNCATE + INSERT via as
    // funções versionadas (migration 20260706_000004), com service_role (mesmo
    // client das demais escritas). SÓ no import COMPLETO com entries
    // (fileType === "TODOS"); os caminhos de idempotência (alreadyProcessed) e
    // parciais não gravam entries PRT novas, então não há o que rematerializar.
    let materializacaoCarteira: { ran: boolean; error?: string } = { ran: false };
    const importCompleto = "fileType" in payload && payload.fileType === "TODOS";
    if (importCompleto) {
      try {
        const admin = getSupabaseAdmin();
        const prod = await admin.rpc("fn_materializar_producao_contrato");
        if (prod.error) throw new Error(prod.error.message);
        const cart = await admin.rpc("fn_materializar_carteira_contrato");
        if (cart.error) throw new Error(cart.error.message);
        materializacaoCarteira = { ran: true };
        console.log(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `carteira materializada (producao_contrato + carteira_contrato).`
        );
      } catch (matError) {
        const message =
          matError instanceof Error ? matError.message : "Erro desconhecido na materialização.";
        materializacaoCarteira = { ran: false, error: message };
        console.error(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `materialização da carteira falhou (import preservado; carteira fica ` +
            `desatualizada até o próximo fechamento): ${message}`
        );
      }
    }

    // (2) Pipeline de Recebíveis — congela a previsão vigente no momento do
    // fechamento (para depois confrontar "previsto ENTÃO vs recebido DEPOIS").
    // LÊ carteira_contrato (buildPrtAgenda → fetchCarteiraSnapshot) → depende da
    // materialização (1) acima. Efeito colateral: falha aqui é logada mas NÃO
    // derruba o import. Idempotente (ON CONFLICT DO NOTHING). SÓ nesta rota
    // (fechamento corrente), NÃO na import/closing-history (backfill — ali o
    // previsto seria contaminado pelo estoque atual).
    let congelamentoPrevisao: { ran: boolean; linhas?: number; snapshot?: string; error?: string } = {
      ran: false,
    };
    try {
      const congel = await congelarPrevisao(getSupabaseAdmin());
      congelamentoPrevisao = {
        ran: true,
        linhas: congel.linhasGravadas,
        snapshot: congel.competenciaSnapshot,
      };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `congelamento de previsão: ${congel.linhasGravadas} novas linhas ` +
          `(snapshot ${congel.competenciaSnapshot}, ${congel.linhasProjetadas} projetadas).`
      );
    } catch (congelError) {
      const message =
        congelError instanceof Error ? congelError.message : "Erro desconhecido no congelamento.";
      congelamentoPrevisao = { ran: false, error: message };
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `congelamento de previsão falhou (import preservado): ${message}`
      );
    }

    // (3) Camada 3 — gatilho pós-importação do monitor de inadimplência PRT.
    // Independente da carteira (lê metadata). Roda para a competência DO
    // FECHAMENTO recém-importado. Efeito colateral: falha aqui é logada mas NÃO
    // derruba o import. Idempotente — UPSERT por (competencia, operation_number).
    let inadimplenciaMonitor: {
      ran: boolean;
      novos?: number;
      error?: string;
    } = { ran: false };
    try {
      const snapshot = await persistInadimplenciaSnapshot(getSupabaseAdmin(), {
        competencia: { year, month },
        lookbackParadaMeses: 3,
      });
      inadimplenciaMonitor = { ran: true, novos: snapshot.resumo.novos };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `monitor inadimplência: ${snapshot.resumo.novos} novos detectados ` +
          `(emCobranca=${snapshot.resumo.emCobranca}, recuperados=${snapshot.resumo.recuperados}, ` +
          `ressurgidos=${snapshot.resumo.ressurgidos}).`
      );
    } catch (monitorError) {
      const message =
        monitorError instanceof Error
          ? monitorError.message
          : "Erro desconhecido no monitor de inadimplência.";
      inadimplenciaMonitor = { ran: false, error: message };
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `monitor de inadimplência falhou (import preservado): ${message}`
      );
    }

    return NextResponse.json({
      ...payload,
      materializacaoCarteira,
      congelamentoPrevisao,
      inadimplenciaMonitor,
    });
  } catch (error) {
    if (error instanceof DuplicateImportInFlightError) {
      return NextResponse.json(
        {
          error: error.message,
          importId: error.importId,
          startedAt: error.startedAt,
        },
        { status: 409 }
      );
    }
    return apiGuardErrorResponse(error);
  }
}
