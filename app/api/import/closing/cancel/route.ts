import { NextResponse } from "next/server";

import { apiGuardErrorResponse, withSocioAdmin } from "@/lib/auth/guards";
import { reconsolidarCompetenciaFechada } from "@/lib/reconsolidarCompetencia";

export async function POST(req: Request) {
  try {
    // FIX-1.E.6.PRE.D.D — destrava manualmente PROCESSING zumbi. Guard de
    // socio porque cancelar import afeta o fechamento mensal (mesma alcada
    // do upload).
    const { user, supabase: supabaseAdmin } = await withSocioAdmin();

    const body = await req.json().catch(() => ({}));
    const importId = body?.importId ? String(body.importId) : "";
    // Confirmacao EXPLICITA, reenviada. Nasce ausente e some a cada requisicao —
    // nunca e padrao ligado. Mesmo desenho da recusa do so-credito da ADS
    // (app/api/import/closing/ads/route.ts:86-107).
    const confirmaOrfao = body?.confirmarAgregadoOrfao === true;

    if (!importId) {
      return NextResponse.json(
        { error: "Informe o importId do registro PROCESSING a cancelar." },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("monthly_closing_imports")
      .select("id, company_id, year, month, file_name, status, created_at")
      .eq("id", importId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!existing) {
      return NextResponse.json(
        { error: "Import nao encontrado." },
        { status: 404 }
      );
    }

    if (existing.status !== "PROCESSING") {
      return NextResponse.json(
        {
          error: `Import nao esta em PROCESSING (status atual: ${existing.status}). Nada a cancelar.`,
        },
        { status: 409 }
      );
    }

    // ============================================================
    // GUARDA DO AGREGADO ORFAO. Antes de apagar, CONTA o que sobraria na
    // competencia. Se zerar e existir linha em fechamento_mensal_empresa, o
    // cancel RECUSA: apagar aqui deixaria um agregado sem uma unica linha de
    // detalhe por tras — exatamente o estado de 2025-02 RR ALAGOAS 1, medido em
    // 28/08/2026 com operacoes=6.491 e valor_liquido=97.535,61 e ZERO entries.
    // Das 100 linhas de fechamento_mensal_empresa e a UNICA quebrada.
    //
    // NAO RECOMPOE o agregado, de proposito (decisao de Diego, 28/08/2026):
    //   - recompor SEMPRE reescreveria competencia sadia que ja diverge — medido
    //     em 2026-05 AL1: operacoes 5.970 no FME contra 5.963 chaves nas entries,
    //     e valor_diferido 34.622,63 contra Sigma PRT 36.373,45;
    //   - recompor SO quando zera escreveria 0,00 sobre 97.535,61, completando a
    //     perda em vez de reparar. O agregado orfao e hoje o UNICO registro
    //     daquele dinheiro.
    // Recusar e a unica acao que nao destroi informacao.
    //
    // A contagem e do que RESTA (`.neq` do import a cancelar), nao do que sai:
    // depois do conserto do import (INSERE primeiro, APAGA depois) a competencia
    // pode ter os dois conjuntos vivos, e o que decide e o que fica.
    // Gate: scripts/cancel_agregado_orfao_gate.cjs (bloco 3)
    // ============================================================
    const { count: restantes, error: countError } = await supabaseAdmin
      .from("monthly_closing_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", existing.company_id)
      .eq("year", existing.year)
      .eq("month", existing.month)
      .neq("monthly_closing_import_id", importId);

    if (countError) {
      throw new Error(countError.message);
    }

    if ((restantes ?? 0) === 0 && !confirmaOrfao) {
      const { data: empresaRow } = await supabaseAdmin
        .from("companies")
        .select("name, cnpj")
        .eq("id", existing.company_id)
        .maybeSingle();
      const empresa = String((empresaRow as { name?: string } | null)?.name || "").trim();
      const cnpj = String((empresaRow as { cnpj?: string } | null)?.cnpj || "").trim();

      // O agregado so importa se EXISTIR e nao for zerado. 2023-12 AL1 tem linha
      // com operacoes=0 e valor_liquido=0,00: nao ha detalhe a perder, e travar
      // ali seria trava sem dano. Ver o mesmo criterio no vigia.
      const { data: fme } = cnpj
        ? await supabaseAdmin
            .from("fechamento_mensal_empresa")
            .select("operacoes, valor_liquido, valor_avista, valor_seguro")
            .eq("empresa_cnpj", cnpj)
            .eq("ano", existing.year)
            .eq("mes", existing.month)
            .maybeSingle()
        : { data: null };

      const operacoes = Number((fme as { operacoes?: number } | null)?.operacoes || 0);
      const valorLiquido = Number((fme as { valor_liquido?: number } | null)?.valor_liquido || 0);

      if (fme && (operacoes > 0 || Math.abs(valorLiquido) > 0.005)) {
        const brl = (v: number) =>
          v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        const competencia = `${String(existing.month).padStart(2, "0")}/${existing.year}`;
        // O DANO EM NUMEROS VAI NO `error`: a tela renderiza SO esse campo
        // (app/importacoes/page.tsx). Numero em campo que ninguem exibe e numero
        // que nao foi dito.
        return NextResponse.json(
          {
            error:
              `RECUSADO: cancelar este import deixaria a competencia ${competencia} da ${empresa} ` +
              `SEM NENHUMA linha de detalhe, e o agregado ficaria orfao. ` +
              `fechamento_mensal_empresa registra ${operacoes} operacoes e ` +
              `${brl(valorLiquido)} de valor liquido que perderiam o lastro — nao ha outro ` +
              `import com entries vivas nesta competencia. O agregado NAO e recomposto ` +
              `(recompor escreveria zero por cima do valor). Reimporte o arquivo antes de ` +
              `cancelar, ou confirme e reenvie para cancelar assim mesmo.`,
            competencia,
            empresa,
            empresa_cnpj: cnpj,
            entries_que_restariam: 0,
            agregado_operacoes: operacoes,
            agregado_valor_liquido: valorLiquido,
            como_prosseguir:
              "Reimporte o fechamento desta competencia e cancele depois, ou reenvie com " +
              "confirmarAgregadoOrfao=true para cancelar mesmo deixando o agregado sem detalhe.",
            confirmacao_necessaria: true,
          },
          { status: 409 }
        );
      }
    }

    // Limpa entries parciais (caso INSERT em massa tenha completado parcial).
    const { error: deleteEntriesError } = await supabaseAdmin
      .from("monthly_closing_entries")
      .delete()
      .eq("monthly_closing_import_id", importId);

    if (deleteEntriesError) {
      throw new Error(deleteEntriesError.message);
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("monthly_closing_imports")
      .update({
        status: "CANCELLED",
        error_message: "Cancelado manualmente pelo usuario",
        error_at: nowIso,
        finished_at: nowIso,
      })
      .eq("id", importId)
      .eq("status", "PROCESSING"); // defensivo contra race

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Guarda #8 (defesa da janela de crash): apagar as entries deste import pode
    // ter deixado o PMR da competencia calculado sobre um conjunto que ja mudou
    // (ex.: import que rodou a reconsolidacao e foi cancelado ANTES do
    // markImportCompleted). Reconsolida best-effort: reconsolidarCompetenciaFechada
    // SE AUTO-GUARDA — recomputa do conjunto RESTANTE de entries se a competencia
    // ainda e 'fechamento', e e no-op se caiu para 'open'. NAO apaga o PMR (isso
    // quebraria a invariante do Mov 1: regime fechado => PMR existe). Falha aqui
    // NAO invalida o cancel (o destravamento do PROCESSING zumbi ja aconteceu).
    let reconsolidado: unknown = null;
    try {
      reconsolidado = await reconsolidarCompetenciaFechada(supabaseAdmin, {
        year: existing.year,
        month: existing.month,
        dryRun: false,
      });
    } catch (reconErr) {
      console.error(
        `[cancel] reconsolidacao best-effort falhou para ${existing.month}/${existing.year}`,
        reconErr
      );
    }

    try {
      await supabaseAdmin.from("audit_logs").insert({
        entity_name: "monthly_closing_imports",
        entity_id: importId,
        action: "IMPORT_CANCELLED",
        description: `Import de fechamento ${existing.month}/${existing.year} cancelado manualmente.`,
        payload: {
          importId,
          fileName: existing.file_name,
          companyId: existing.company_id,
          year: existing.year,
          month: existing.month,
          startedAt: existing.created_at,
        },
        created_by: user.session.appUser.email,
      });
    } catch {
      // Audit best-effort.
    }

    return NextResponse.json({
      success: true,
      importId,
      previousStatus: "PROCESSING",
      newStatus: "CANCELLED",
      reconsolidado,
    });
  } catch (error) {
    return apiGuardErrorResponse(error);
  }
}
