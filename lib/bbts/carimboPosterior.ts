// ============================================================================
// carimboPosterior — o fechamento ANTIGO nao move a linha que um fechamento
// POSTERIOR ja colocou.
//
// O CASO QUE ORIGINOU ISTO, medido em 30/08/2026. O contrato 212021557 foi
// vendido em 29/05. A BBTS pagou o CREDITO dele no fechamento de JUNHO (a vista
// 255,26, bruto 4.254,32) e o SEGURO no de MAIO. Maio nunca foi importado.
// Importar maio agora acharia a linha ja existente — o merge de
// daily_production_records e por (company_id, proposal_number) e o dono FULL
// sobrescreve movement_date — e MESCLARIA: gross_value 4.254,32 -> 0,
// bbts_pag_avista 255,26 -> 0, movement_date 2026-06-15 -> 2026-05-15, carimbo
// 2026-06-01 -> 2026-05-01. Junho cairia de 7.707,03 para 7.451,77 e a ancora do
// fechamento de junho deixaria de fechar.
//
// A REGRA, e por que ela e geral e nao uma excecao. Nao ha nada de especial
// naquele contrato: qualquer proposta cuja venda cruze a virada do mes pode ter
// as duas pernas pagas em competencias diferentes. Entao o predicado nao cita
// contrato nenhum — ele pergunta ao BANCO quem ja esta carimbado por um
// fechamento posterior ao que esta entrando. O fechamento mais recente e a
// verdade mais recente sobre ONDE aquela proposta esta; um fechamento antigo
// chegando depois nao pode desfazer isso.
//
// A DIVIDA QUE ISTO **NAO** PAGA, e e importante que fique claro: a tabela tem
// UMA linha por (empresa, proposta) e UM carimbo, e por isso nao existe lugar
// para as duas pernas. Este modulo nao conserta o modelo — ele impede que o
// import destrua o que ja esta la, e devolve o tamanho do que ficou de fora para
// quem opera decidir. O seguro de maio da 212021557 continua sem entrar em lugar
// nenhum. Ver HANDOFF_ADS_ABRIL_MAIO.md, secao "DIVIDA ESTRUTURAL NOMEADA".
//
// POR QUE O FILTRO E EM JS E NAO UM .gt() NA QUERY. Porque o tratamento do NULL
// tem de ser VISIVEL (ver o bloco do buraco, mais abaixo). Num `.gt()` o NULL
// sumiria por regra do SQL e ninguem leria a decisao em lugar nenhum.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

/** O minimo que este modulo usa do cliente — e o que o portao precisa falsificar. */
export interface ClienteCarimbo {
  from: (tabela: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        in: (col: string, vals: string[]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export interface PropostaCarimboPosterior {
  proposal_number: string;
  /** o carimbo que a linha JA tem no banco ('YYYY-MM-DD'). */
  carimbo_existente: string;
  /** a competencia do fechamento que esta entrando ('YYYY-MM-01'). */
  competencia_entrando: string;
  bbts_pag_avista: number;
  bbts_seguro_pago: number;
  gross_value: number;
  movement_date: string | null;
  promoter_source: string | null;
}

/** A competencia de um fechamento como o carimbo a escreve: dia 01. */
export function competenciaCarimbo(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * TODAS as propostas que o import TOCARIA — nao so as de credito.
 *
 * O seguro 'calculo' SEM credito no mes vira linha SO-SEGURO (bloco 3b do
 * bbtsClosingImport) e passa pelo MESMO merge, entao tambem pode sobrescrever
 * linha existente. Foi exatamente esse o caso da 212021557: ela esta no seguro de
 * maio e NAO no credito de maio. Um predicado que olhasse so o credito nao a
 * teria pego — e o dano teria acontecido do mesmo jeito.
 *
 * O seguro 'debito' (CANCELADO) fica de fora: ele nao vira linha de producao,
 * vira debito do promotor.
 */
export function propostasAlvoDoFechamento(input: {
  credito?: Array<{ contrato: string | number }> | null;
  seguro?: Array<{ contrato: string | number; tratamento?: string | null }> | null;
}): string[] {
  const alvo = new Set<string>();
  for (const r of input.credito ?? []) {
    const c = String(r.contrato ?? "").trim();
    if (c) alvo.add(c);
  }
  for (const s of input.seguro ?? []) {
    if (String(s.tratamento ?? "").trim().toUpperCase() !== "CALCULO") continue;
    const c = String(s.contrato ?? "").trim();
    if (c) alvo.add(c);
  }
  return [...alvo];
}

/**
 * Quais das `propostas` ja estao carimbadas em competencia POSTERIOR a que esta
 * entrando. Lista vazia = nada a barrar.
 */
export async function propostasComCarimboPosterior(
  supabase: SupabaseClient | ClienteCarimbo,
  params: { companyId: string; year: number; month: number; propostas: string[] }
): Promise<PropostaCarimboPosterior[]> {
  const competencia = competenciaCarimbo(params.year, params.month);
  const alvo = [...new Set(params.propostas.map((p) => String(p).trim()).filter(Boolean))];
  if (alvo.length === 0) return [];

  const achadas: PropostaCarimboPosterior[] = [];
  for (let i = 0; i < alvo.length; i += 500) {
    const lote = alvo.slice(i, i + 500);
    const { data, error } = await (supabase as ClienteCarimbo)
      .from("daily_production_records")
      .select(
        "proposal_number, bbts_competencia_fechamento, movement_date, bbts_pag_avista, bbts_seguro_pago, gross_value, promoter_source"
      )
      .eq("company_id", params.companyId)
      .in("proposal_number", lote);

    if (error) {
      // AUSENCIA DE MEDICAO NAO E APROVACAO. Se a coluna do carimbo nao existir
      // (42703 — migration 20260830_000001 nao aplicada), a guarda nao TEM como
      // responder, e seguir em frente seria importar sem ela justamente no
      // ambiente onde ela faz mais falta. Entao LANCA, e o import inteiro para.
      throw new Error(
        `Guarda de carimbo posterior NAO pode ser avaliada: ${error.message}. ` +
          `Se for 'column daily_production_records.bbts_competencia_fechamento does not exist', ` +
          `a migration 20260830_000001_bbts_competencia_fechamento.sql nao foi aplicada — ` +
          `aplique antes de importar. O import foi ABORTADO sem gravar nada: seguir sem esta ` +
          `guarda pode sobrescrever fechamento de competencia posterior.`
      );
    }

    for (const linha of (data ?? []) as Array<Record<string, unknown>>) {
      const carimbo = linha.bbts_competencia_fechamento;
      // ---------------------------------------------------------------------
      // O BURACO DESTA GUARDA, DITO AQUI E NAO SO NO HANDOFF.
      //
      // NULL nao e "posterior", entao a linha com carimbo NULO **passa** e pode
      // ser sobrescrita. Isso e deliberado e e o recorte que foi pedido — a
      // guarda fala de carimbo, e linha sem carimbo nunca veio de um fechamento.
      //
      // O buraco NAO e teorico. Censo do diario da ADS em 30/08/2026: 18 linhas
      // carimbadas 2026-06, 43 carimbadas 2026-07 e **43 com NULL** — dessas, 42
      // sao de agosto (mes ABERTO, que ainda nao teve fechamento) e **1 e de
      // junho** (contrato 212850402, valor 0,00). Ou seja: existe linha antiga
      // sem carimbo, nao so a do mes corrente.
      //
      // Para abril e maio o buraco esta VAZIO: nenhuma das 48 propostas alvo tem
      // linha com carimbo NULL (medido em scripts/diag-ads-carimbo-posterior.cjs).
      //
      // Fechar o buraco exigiria cair para movement_date quando o carimbo falta —
      // o que passaria a barrar linha de MES ABERTO, que e outra decisao e nao a
      // que foi tomada. Fica NOMEADO, nao silencioso.
      // ---------------------------------------------------------------------
      if (carimbo == null) continue;
      const carimboIso = String(carimbo).slice(0, 10);
      // Datas ISO comparam corretamente como texto (largura fixa, mais
      // significativo a esquerda) — nao ha Date envolvido, logo nao ha fuso.
      if (carimboIso <= competencia) continue;
      achadas.push({
        proposal_number: String(linha.proposal_number),
        carimbo_existente: carimboIso,
        competencia_entrando: competencia,
        bbts_pag_avista: Number(linha.bbts_pag_avista) || 0,
        bbts_seguro_pago: Number(linha.bbts_seguro_pago) || 0,
        gross_value: Number(linha.gross_value) || 0,
        movement_date: linha.movement_date == null ? null : String(linha.movement_date).slice(0, 10),
        promoter_source: linha.promoter_source == null ? null : String(linha.promoter_source),
      });
    }
  }
  achadas.sort((a, b) => a.proposal_number.localeCompare(b.proposal_number));
  return achadas;
}

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O DANO EM NUMEROS, no texto que vai para o campo `error` da resposta.
 *
 * Vai para o `error` e nao para um `detalhe`: a tela de importacoes renderiza SO
 * o `error` (app/importacoes/page.tsx). Numero que fica em campo que ninguem
 * exibe e numero que nao foi dito — foi a licao da recusa do PDF de seguro
 * ausente, e vale identica aqui.
 */
export function textoRecusaCarimboPosterior(params: {
  competencia: string;
  empresa: string;
  bloqueadas: PropostaCarimboPosterior[];
  totalAlvo: number;
  campoConfirmacao: string;
}): string {
  const { competencia, empresa, bloqueadas, totalAlvo, campoConfirmacao } = params;
  const somaAvista = bloqueadas.reduce((a, p) => a + p.bbts_pag_avista, 0);
  const somaBruto = bloqueadas.reduce((a, p) => a + p.gross_value, 0);
  const somaSeguro = bloqueadas.reduce((a, p) => a + p.bbts_seguro_pago, 0);
  const linhas = bloqueadas
    .map(
      (p) =>
        `contrato ${p.proposal_number} ja carimbado em ${p.carimbo_existente} ` +
        `(movimento ${p.movement_date ?? "sem data"}), carregando ${brl(p.bbts_pag_avista)} de ` +
        `pagamento a vista, ${brl(p.gross_value)} de producao e ${brl(p.bbts_seguro_pago)} de ` +
        `comissao de seguro`
    )
    .join("; ");

  return (
    `RECUSADO: este fechamento e ANTERIOR ao que ja carimbou parte destas propostas. ` +
    `Competencia entrando ${competencia}, empresa ${empresa}. ` +
    `${bloqueadas.length} de ${totalAlvo} proposta(s) ficariam de fora: ${linhas}. ` +
    `Somando ${brl(somaAvista)} de pagamento a vista, ${brl(somaBruto)} de producao e ` +
    `${brl(somaSeguro)} de comissao de seguro que sairiam da competencia posterior e ` +
    `viriam para ${competencia} — a ancora daquele fechamento deixaria de fechar. ` +
    `A causa nao e erro de atribuicao: a BBTS pagou as duas pernas da proposta em ` +
    `competencias diferentes e a tabela guarda uma linha e um carimbo so. ` +
    `Para importar o RESTANTE assim mesmo, reenvie com ${campoConfirmacao}=true. ` +
    `ATENCAO: a confirmacao autoriza importar o resto — ela NAO grava estas propostas, ` +
    `que continuam excluidas da gravacao.`
  );
}
