import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { persistInadimplenciaSnapshot } from "@/lib/auditoria/persistInadimplencia";
import {
  DuplicateImportInFlightError,
  importMonthlyClosingWorkbook,
} from "@/lib/monthlyClosingImport";
import { congelarPrevisao } from "@/lib/recebiveis/congelarPrevisao";
import {
  enfileirarMaterializacao,
  lerFilaRecente,
  marcarCongelamentoFeito,
} from "@/lib/materializacao/fila";
import {
  congelamentosPendentes,
  diagnosticoFila,
  blocoEnfileiramento,
  type DiagnosticoFila,
  type LinhaFila,
} from "@/lib/materializacao/filaRegras";
import { materializarCarteiraConsorcio } from "@/lib/consorcio/carteira";
import { persistConsorcioInadimplenciaSnapshot } from "@/lib/consorcio/inadimplencia";
import {
  montarPosImportDiag,
  registrarPosImportDiag,
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
    // o import.
    //   (1) ENFILEIRA a materialização de producao_contrato + carteira_contrato
    //       (o job pg_cron executa dentro do banco) →
    //   (2) congelarPrevisao em CATCH-UP das competências que a fila já
    //       materializou e ainda não congelou →
    //   (3) monitor de inadimplência (independente, lê metadata).
    //
    // A ORDEM (1)→(2) DEIXOU DE SER A GARANTIA, e isso é deliberado. Enquanto a
    // materialização era síncrona, (2) só podia rodar depois de (1) na mesma
    // requisição. Com a fila, (1) só PEDE — e a dependência "congelar sobre
    // carteira fresca" passou a ser garantida pelo DADO, não pela ordem das
    // linhas: (2) congela apenas competências com status='OK' na fila. Fazer a
    // rota esperar a fila teria reposto o sincronismo (e os mesmos 38-51s).
    //
    // O ERRO DE CADA BLOCO NÃO MORRE MAIS NO console.error. Cada um é
    // cronometrado e o resultado vai para a tabela `import_pos_diag`
    // (migration 20260903_000001), com origem='closing_rr'. Motivo: a
    // materialização (1) falhava desde 2026-07-07 e passou DOIS fechamentos sem
    // ninguém ver, porque a única testemunha era o log da invocação serverless.
    // O `ms` faz parte do rastro — foi o tempo (bloco 2 em 5,5s dentro de uma
    // janela de 43-57s) que revelou que (1) morre depois de ~38-51s em vez de
    // falhar na hora.
    //
    // A ADS escreve no MESMO lugar, com origem='closing_ads'
    // (app/api/import/closing/ads/route.ts). Rastro que só existe numa das duas
    // rotas de fechamento não é rastro — foi assim que o import da ADS de agosto
    // passou sem deixar foto.
    // ============================================================

    // (1) MATERIALIZAÇÃO DA CARTEIRA PRT — ASSÍNCRONA desde 03/09/2026.
    // (migration 20260903_000002_materializacao_fila.sql)
    //
    // ANTES: este bloco chamava fn_materializar_producao_contrato e
    // fn_materializar_carteira_contrato direto pelo PostgREST. MEDIDO: o role
    // `authenticator` tem statement_timeout=8s e lock_timeout=8s, e as duas
    // funções juntas queimam 38-51s. A chamada não podia terminar por aquela
    // porta — e não terminava desde 2026-07-07. As mesmas funções rodam no
    // Studio sem problema (foi assim que a carteira chegou a 2026-08 em 02/09).
    //
    // AGORA: um INSERT na fila (milissegundos) e o job pg_cron
    // `materializacao_fila` executa DENTRO do banco, sem o teto da API.
    //
    // Escopar por competência NÃO era saída: a 2ª função não tem competência
    // para escopar — ela começa com TRUNCATE e reconstrói a janela 2026+ toda.
    //
    // "ENFILEIREI" NÃO É "FUNCIONOU", e é aqui que o assíncrono poderia trocar
    // um defeito visível por um invisível: se o job do cron não estiver vivo, o
    // insert continua devolvendo 200 e a carteira envelhece calada. Por isso o
    // bloco lê a fila INTEIRA e só sai ok=true quando o insert passou E a fila
    // está saudável — a denúncia de um import atrasado chega no import seguinte.
    // SÓ no import COMPLETO (fileType === "TODOS"); os caminhos de idempotência
    // (alreadyProcessed) e parciais não gravam entries PRT novas.
    const importId = (payload as { importId?: string }).importId;
    let materializacaoFila: {
      enfileirado: boolean;
      jobId: string | null;
      error?: string;
      diagnostico: DiagnosticoFila | null;
    } = { enfileirado: false, jobId: null, diagnostico: null };
    let filaRecente: LinhaFila[] = [];
    const importCompleto = "fileType" in payload && payload.fileType === "TODOS";
    const tMat = Date.now();
    if (importCompleto) {
      const admin = getSupabaseAdmin();
      let erroEnfileirar: string | undefined;
      let jobId: string | null = null;
      try {
        jobId = await enfileirarMaterializacao(admin, {
          origem: "closing_rr",
          importId,
          year,
          month,
        });
      } catch (matError) {
        erroEnfileirar =
          matError instanceof Error ? matError.message : "Erro desconhecido ao enfileirar.";
      }
      // A leitura da fila acontece TAMBÉM quando o insert falhou: o diagnóstico
      // do que já estava na fila é a informação mais útil nesse caso.
      try {
        filaRecente = await lerFilaRecente(admin);
      } catch (leituraError) {
        const msg =
          leituraError instanceof Error ? leituraError.message : "Erro ao ler a fila.";
        erroEnfileirar = erroEnfileirar ? `${erroEnfileirar} | ${msg}` : msg;
      }
      materializacaoFila = {
        enfileirado: !!jobId && !erroEnfileirar,
        jobId,
        error: erroEnfileirar,
        diagnostico: filaRecente.length > 0 ? diagnosticoFila(filaRecente, Date.now()) : null,
      };
      console.log(
        `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
          `materializacao ENFILEIRADA (job ${jobId ?? "?"}); o job pg_cron ` +
          `materializacao_fila executa em ate 1 min.`
      );
      if (materializacaoFila.diagnostico && !materializacaoFila.diagnostico.saudavel) {
        console.error(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `FILA DE MATERIALIZACAO DOENTE: ${materializacaoFila.diagnostico.mensagem}`
        );
      }
    }
    const msMat = Date.now() - tMat;

    // (2) CONGELAMENTO DA PREVISÃO — virou CATCH-UP, e por COMPETÊNCIA EXPLÍCITA.
    //
    // POR QUE NÃO ESPERA A FILA: esperar reintroduziria o sincronismo que esta
    // frente veio matar (e o tempo total continuaria sendo os 38-51s, só num
    // lugar diferente). O congelamento roda para as competências que a fila
    // marca como JÁ MATERIALIZADAS e ainda não congeladas — na prática, o do
    // import ANTERIOR. Também dá para forçar pela rota /api/recebiveis/congelar.
    //
    // POR QUE A COMPETÊNCIA VEM DA FILA, E NÃO DO max DA CARTEIRA: o max é o que
    // deixou o vintage de 2026-07 INALCANÇÁVEL. A materialização morreu em
    // 07/07; quando finalmente rodou (02/09) ela reconstruiu a carteira de
    // 2026-01 em diante — julho ESTÁ lá — mas o max já era 2026-08, e como o
    // congelamento só sabia pedir o max, julho nunca mais teve como ser pedido.
    // previsao_snapshot é write-once: vintage perdido não volta.
    //
    // Efeito colateral: falha aqui é registrada mas NÃO derruba o import.
    // Idempotente (ON CONFLICT DO NOTHING). A dívida da fila só é baixada
    // DEPOIS de o congelamento daquela competência voltar sem lançar.
    let congelamentoPrevisao: {
      ran: boolean;
      nadaADever: boolean;
      competencias: Array<{
        competencia: string;
        linhas: number;
        vintageJaExistia: boolean;
        vintageIncompleto: boolean;
        competenciaOrigem: string;
      }>;
      avisos?: string[];
      error?: string;
    } = { ran: false, nadaADever: false, competencias: [] };
    const tCongel = Date.now();
    try {
      const admin = getSupabaseAdmin();
      const devidos = congelamentosPendentes(filaRecente);
      const feitas: typeof congelamentoPrevisao.competencias = [];
      const avisos: string[] = [];
      for (const devido of devidos) {
        const congel = await congelarPrevisao(admin, { competencia: devido.competencia });
        // Só depois de voltar sem lançar. Baixar antes (ou num finally) marcaria
        // como pago um congelamento que falhou, e aquela competência nunca mais
        // entraria no catch-up.
        await marcarCongelamentoFeito(admin, devido.id);
        feitas.push({
          competencia: devido.competencia,
          linhas: congel.linhasGravadas,
          vintageJaExistia: congel.vintageJaExistia,
          vintageIncompleto: congel.vintageIncompleto,
          competenciaOrigem: congel.competenciaOrigem,
        });
        for (const aviso of congel.avisos) avisos.push(`${devido.competencia}: ${aviso}`);
        console.log(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `congelamento (catch-up) de ${devido.competencia}: ${congel.linhasGravadas} ` +
            `novas linhas (${congel.linhasProjetadas} projetadas, origem da ` +
            `competencia=${congel.competenciaOrigem}).`
        );
      }
      congelamentoPrevisao = {
        ran: true,
        nadaADever: devidos.length === 0,
        competencias: feitas,
        avisos: avisos.length ? avisos : undefined,
      };
      if (devidos.length === 0) {
        console.log(
          `[import closing ${year}-${String(month).padStart(2, "0")}] ` +
            `congelamento: nada a dever na fila (a materializacao deste import ` +
            `ainda esta PENDENTE; ela sera congelada no import seguinte ou por ` +
            `POST /api/recebiveis/congelar).`
        );
      }
      for (const aviso of congelamentoPrevisao.avisos ?? []) {
        console.warn(
          `[import closing ${year}-${String(month).padStart(2, "0")}] congelamento: ${aviso}`
        );
      }
    } catch (congelError) {
      const message =
        congelError instanceof Error ? congelError.message : "Erro desconhecido no congelamento.";
      congelamentoPrevisao = { ran: false, nadaADever: false, competencias: [], error: message };
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
      // O NOME DO BLOCO NAO MUDA com a troca de sincrono para fila: quem procura
      // "materializacao_carteira_prt" no rastro tem de achar as duas eras. O que
      // ele passou a ser esta em extra.via='fila'.
      blocoEnfileiramento({
        jobId: materializacaoFila.jobId,
        ms: msMat,
        erro: materializacaoFila.error,
        diagnostico: materializacaoFila.diagnostico,
        puladoPorFileType: !importCompleto,
      }),
      {
        nome: "congelamento_previsao",
        ok: congelamentoPrevisao.ran,
        ms: msCongel,
        erro: congelamentoPrevisao.error,
        extra: {
          // `nada_a_dever` separa "congelou" de "nao havia o que congelar" — as
          // duas dao ok=true e sao coisas diferentes.
          nada_a_dever: congelamentoPrevisao.nadaADever,
          competencias: congelamentoPrevisao.competencias,
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

    const diagGravado = await registrarPosImportDiag(getSupabaseAdmin(), {
      origem: "closing_rr",
      importId,
      year,
      month,
      diag: posImportDiag,
    });

    return NextResponse.json({
      ...payload,
      materializacaoFila,
      congelamentoPrevisao,
      inadimplenciaMonitor,
      consorcioCarteira,
      posImportDiag,
      posImportDiagGravado: diagGravado,
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
