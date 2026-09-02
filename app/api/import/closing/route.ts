import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { persistInadimplenciaSnapshot } from "@/lib/auditoria/persistInadimplencia";
import {
  DuplicateImportInFlightError,
  importMonthlyClosingWorkbook,
} from "@/lib/monthlyClosingImport";
import { congelarPrevisao } from "@/lib/recebiveis/congelarPrevisao";
import { materializarCarteiraConsorcio } from "@/lib/consorcio/carteira";
import { persistConsorcioInadimplenciaSnapshot } from "@/lib/consorcio/inadimplencia";
import {
  COLUNA_POS_IMPORT_DIAG,
  montarPosImportDiag,
} from "@/lib/diagnostico/posImportDiag";
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
    //
    // O ERRO DE CADA BLOCO NÃO MORRE MAIS NO console.error. Cada um é
    // cronometrado e o resultado vai para monthly_closing_imports.pos_import_diag
    // (migration 20260902_000001). Motivo: a materialização (1) falhava desde
    // 2026-07-07 e passou DOIS fechamentos sem ninguém ver, porque a única
    // testemunha era o log da invocação serverless. O `ms` faz parte do rastro —
    // foi o tempo (bloco 2 em 5,5s dentro de uma janela de 43-57s) que revelou
    // que (1) morre depois de ~38-51s em vez de falhar na hora.
    // ============================================================

    // (1) Materialização da carteira PRT por-contrato: TRUNCATE + INSERT via as
    // funções versionadas (migration 20260706_000004), com service_role (mesmo
    // client das demais escritas). SÓ no import COMPLETO com entries
    // (fileType === "TODOS"); os caminhos de idempotência (alreadyProcessed) e
    // parciais não gravam entries PRT novas, então não há o que rematerializar.
    let materializacaoCarteira: { ran: boolean; error?: string } = { ran: false };
    const importCompleto = "fileType" in payload && payload.fileType === "TODOS";
    const tMat = Date.now();
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
    const msMat = Date.now() - tMat;

    // (2) Pipeline de Recebíveis — congela a previsão vigente no momento do
    // fechamento (para depois confrontar "previsto ENTÃO vs recebido DEPOIS").
    // LÊ carteira_contrato (buildPrtAgenda → fetchCarteiraSnapshot) → depende da
    // materialização (1) acima. Efeito colateral: falha aqui é logada mas NÃO
    // derruba o import. Idempotente (ON CONFLICT DO NOTHING). SÓ nesta rota
    // (fechamento corrente), NÃO na import/closing-history (backfill — ali o
    // previsto seria contaminado pelo estoque atual).
    let congelamentoPrevisao: {
      ran: boolean;
      linhas?: number;
      snapshot?: string;
      error?: string;
      vintageJaExistia?: boolean;
      vintageIncompleto?: boolean;
      avisos?: string[];
    } = {
      ran: false,
    };
    const tCongel = Date.now();
    try {
      const congel = await congelarPrevisao(getSupabaseAdmin());
      congelamentoPrevisao = {
        ran: true,
        linhas: congel.linhasGravadas,
        snapshot: congel.competenciaSnapshot,
        // Anti-silêncio: o import passa a DIZER quando o congelamento não gravou nada
        // porque o vintage já existia — e quando o vintage gravado está incompleto.
        vintageJaExistia: congel.vintageJaExistia,
        vintageIncompleto: congel.vintageIncompleto,
        avisos: congel.avisos.length ? congel.avisos : undefined,
      };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `congelamento de previsão: ${congel.linhasGravadas} novas linhas ` +
          `(snapshot ${congel.competenciaSnapshot}, ${congel.linhasProjetadas} projetadas).`
      );
      for (const aviso of congel.avisos) {
        console.warn(
          `[import closing ${year}-${String(month).padStart(2, "0")}] congelamento: ${aviso}`
        );
      }
    } catch (congelError) {
      const message =
        congelError instanceof Error ? congelError.message : "Erro desconhecido no congelamento.";
      congelamentoPrevisao = { ran: false, error: message };
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `congelamento de previsão falhou (import preservado): ${message}`
      );
    }
    const msCongel = Date.now() - tCongel;

    // (3) Camada 3 — gatilho pós-importação do monitor de inadimplência PRT.
    // Independente da carteira (lê metadata). Roda para a competência DO
    // FECHAMENTO recém-importado. Efeito colateral: falha aqui é logada mas NÃO
    // derruba o import. Idempotente — UPSERT por (competencia, operation_number).
    let inadimplenciaMonitor: {
      ran: boolean;
      novos?: number;
      error?: string;
    } = { ran: false };
    const tMonitor = Date.now();
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
    const msMonitor = Date.now() - tMonitor;

    // (4) FRENTE DE PRODUTO M2b — carteira do consorcio (rebuild) + monitor de
    // inadimplencia forte. Independente do PRT. Le monthly_closing_entries
    // entry_type='CONSORCIO' (de qualquer tipo de arquivo — consorcio chega em
    // avulso e em TODOS). Best-effort: falha aqui e logada mas NAO derruba o import.
    let consorcioCarteira: { ran: boolean; linhas?: number; naoVeio?: number; error?: string } = {
      ran: false,
    };
    const tConsorcio = Date.now();
    try {
      const admin = getSupabaseAdmin();
      const mat = await materializarCarteiraConsorcio(admin, {});
      const snap = await persistConsorcioInadimplenciaSnapshot(admin, {
        competencia: { year, month },
      });
      consorcioCarteira = { ran: true, linhas: mat.linhas, naoVeio: snap.total };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `consorcio: carteira ${mat.linhas} linhas / ${mat.propostas} propostas, ` +
          `monitor ${snap.total} parcelas nao vieram (${snap.novos} novas).`
      );
    } catch (consError) {
      const message =
        consError instanceof Error ? consError.message : "Erro desconhecido no consorcio.";
      consorcioCarteira = { ran: false, error: message };
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `carteira/monitor do consorcio falhou (import preservado): ${message}`
      );
    }
    const msConsorcio = Date.now() - tConsorcio;

    // ============================================================
    // (5) O RASTRO. Grava o resultado dos 4 blocos em
    // monthly_closing_imports.pos_import_diag. É a única testemunha que
    // sobrevive à invocação — ver lib/diagnostico/posImportDiag.ts.
    //
    // Este bloco também é best-effort (não pode derrubar um import que já
    // gravou o ledger), MAS a sua falha NÃO é aceitável em silêncio: se a
    // coluna não existir (migration 20260902_000001 não aplicada no Studio), o
    // console diz isso com todas as letras E o portão
    // scripts/gate_pos_import_diag.cjs reprova. Um verde aqui sem a coluna
    // seria exatamente a mentira que este conserto veio desfazer.
    // ============================================================
    const posImportDiag = montarPosImportDiag([
      {
        nome: "materializacao_carteira_prt",
        ok: materializacaoCarteira.ran,
        ms: msMat,
        erro: materializacaoCarteira.error,
        extra: { pulado_por_filetype: !importCompleto },
      },
      {
        nome: "congelamento_previsao",
        ok: congelamentoPrevisao.ran,
        ms: msCongel,
        erro: congelamentoPrevisao.error,
        extra: {
          linhas_gravadas: congelamentoPrevisao.linhas ?? null,
          vintage: congelamentoPrevisao.snapshot ?? null,
          vintage_ja_existia: congelamentoPrevisao.vintageJaExistia ?? null,
          vintage_incompleto: congelamentoPrevisao.vintageIncompleto ?? null,
          avisos: congelamentoPrevisao.avisos ?? null,
        },
      },
      {
        nome: "monitor_inadimplencia_prt",
        ok: inadimplenciaMonitor.ran,
        ms: msMonitor,
        erro: inadimplenciaMonitor.error,
        extra: { novos: inadimplenciaMonitor.novos ?? null },
      },
      {
        nome: "carteira_consorcio",
        ok: consorcioCarteira.ran,
        ms: msConsorcio,
        erro: consorcioCarteira.error,
        extra: {
          linhas: consorcioCarteira.linhas ?? null,
          nao_vieram: consorcioCarteira.naoVeio ?? null,
        },
      },
    ]);

    const importId = (payload as { importId?: string }).importId;
    if (importId) {
      try {
        const { error: diagError } = await getSupabaseAdmin()
          .from("monthly_closing_imports")
          .update({ [COLUNA_POS_IMPORT_DIAG]: posImportDiag })
          .eq("id", importId);
        if (diagError) throw new Error(`${diagError.code || ""} ${diagError.message}`.trim());
      } catch (diagWriteError) {
        const message =
          diagWriteError instanceof Error ? diagWriteError.message : String(diagWriteError);
        console.error(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `NAO FOI POSSIVEL GRAVAR pos_import_diag (o rastro dos efeitos colaterais ` +
            `voltou a ser invisivel). Se o erro for de coluna inexistente, aplique a ` +
            `migration 20260902_000001_pos_import_diag.sql no Studio. Detalhe: ${message}`
        );
      }
    }

    if (posImportDiag.houve_falha) {
      console.error(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `pos-import com falha em: ${posImportDiag.falharam.join(", ")} ` +
          `(rastro em monthly_closing_imports.pos_import_diag do import ${importId ?? "?"}).`
      );
    }

    return NextResponse.json({
      ...payload,
      materializacaoCarteira,
      congelamentoPrevisao,
      inadimplenciaMonitor,
      consorcioCarteira,
      posImportDiag,
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
