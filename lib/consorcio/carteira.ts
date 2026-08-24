// FRENTE DE PRODUTO — Movimento 2b: materializacao da CARTEIRA do consorcio.
//
// Espelha a anatomia da carteira PRT, mas com projecao pela TRP 210 (o teto e o degrau
// nao vem no dado). Grao por-parcela: 1 linha por (company, proposta, posicao).
//
// Na 1a aparicao da proposta faz o BACK-OUT da classificacao pelo % observado e projeta
// 1..teto. Marca RECEBIDA conforme cada PARCn chega. A posicao seguinte a maxRecebida,
// quando ja passou o mes (referencia > ultima competencia recebida), vira NAO_VEIO — e
// e essa a linha que o monitor de inadimplencia persiste (auditoria forte).
//
// Rebuild total (delete-all + insert): a carteira e derivada; a verdade do promotor
// fica na fila. Idempotente (rebuild nao duplica). Em dryRun nao grava.
//
// ============================================================
// DUAS DIVIDAS NOMEADAS (23/08/2026). Nenhuma consertada; as duas medidas.
// ============================================================
//
// DIVIDA 1 — A MATERIALIZACAO E DESTRUTIVA, E O IMPORT CORRE ESSE RISCO HOJE.
// `materializarCarteiraConsorcio` faz DELETE das 316 linhas e depois INSERT em
// lotes de 500. Sao chamadas PostgREST SEPARADAS: nao ha transacao. Uma queda de
// rede entre o delete e o primeiro insert deixa a carteira VAZIA — e quem a
// reconstroi e o import de fechamento, que acontece UMA VEZ POR MES. Ate la,
// PromotorView:517 fica em branco para todo mundo.
//   O comentario acima diz que "o wipe nao perde nada autoritativo porque a
//   carteira e derivada". E verdade quanto ao CONTEUDO e FALSO quanto a
//   DISPONIBILIDADE: derivado e reconstruivel nao ajuda se quem reconstroi
//   demora um mes.
// Foi por isso que a materializacao NAO foi ligada no clique de atribuicao
// (decisao Diego, 23/08): um erro de rede num dropdown nao pode esvaziar a
// carteira. Custo medido do calculo, sem gravar: 533 / 888 / 2.599 ms em tres
// execucoes — a variacao de 5x e latencia, que num clique vira travamento.
// CONSERTO, quando alguem for mexer nela de qualquer jeito: upsert com
// onConflict (company_id, proposta, posicao) + delete restrito ao que sobrou.
// Ai "carteira vazia" deixa de ser um estado possivel, inclusive no import.
//
// DIVIDA 2 — `promoter_id` / `app_user_id` DESTA TABELA FICAM DEFASADOS POR
// DESENHO. Eles sao preenchidos AQUI, no import; atribuir na fila nao
// re-materializa nada. Medido em 23/08: 0 donos gravados contra 27 ancoras de
// consorcio ASSIGNED.
//   Depois do commit ea262db NENHUM leitor depende deles para saber o dono —
//   lib/produtos/produtoProposalRows e app/api/promotores/consorcio-carteira
//   resolvem por resolveConsorcioBeneficiarioByProposta, a mesma funcao do
//   pagamento. As colunas ficam porque a materializacao as grava e porque um dia
//   podem virar cache legitimo; mas QUEM VOLTAR A LE-LAS VAI LER DADO VELHO.
//   Antes de usar: ou conserte a Divida 1 e chame a materializacao na
//   atribuicao, ou resolva pela ancora como os outros tres fazem.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classificacaoPorPercentual,
  grupoDoSegmento,
  posicaoDaParcela,
  projetarParcelas,
  tetoDoGrupo,
  type Classificacao,
  type SegmentoGrupo,
} from "./trp210.ts";
import {
  chaveProposta,
  fetchConsorcioEntriesAll,
  isRegular,
  resolveConsorcioBeneficiarioByProposta,
  type ConsorcioEntry,
} from "./fila.ts";
import { colunasDeDono, type Beneficiario } from "../produtoBeneficiario.ts";

type SupabaseLike = SupabaseClient;

const compStr = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const compNum = (comp: string) => {
  const [y, m] = comp.split("-").map(Number);
  return y * 100 + m;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

export type CarteiraConsorcioRow = {
  company_id: string | null;
  proposta: string;
  posicao: number;
  segmento_codigo: string | null;
  segmento_grupo: SegmentoGrupo;
  teto_parcelas: number;
  valor_bem: number;
  classificacao: Classificacao | null;
  alerta_pct: boolean;
  pct_comissao_ref: number;
  comissao_esperada: number;
  comissao_recebida: number | null;
  competencia_recebida: string | null;
  status: "ESPERADA" | "RECEBIDA" | "NAO_VEIO" | "ENCERRADA";
  // dono DESNORMALIZADO (a verdade fica na fila). Mutuamente exclusivos: promotor OU
  // papel de gestao com venda propria.
  promoter_id: string | null;
  app_user_id: string | null;
  primeira_competencia: string;
};

type Recebida = { comissao: number; competencia: string; pct: number; valorBem: number; segmento: string | null };

// Constroi as linhas da carteira a partir das entries (todas as competencias) e do
// mapa de promotor por proposta. PURA (sem IO) — reusada pelo dry-run.
export function buildCarteiraConsorcioRows(
  entries: ConsorcioEntry[],
  beneficiarioByProposta: Map<string, Beneficiario>
): CarteiraConsorcioRow[] {
  const regulares = entries.filter(isRegular);
  if (regulares.length === 0) return [];

  // referencia = ultima competencia presente no dataset (a "foto atual").
  let referencia = 0;
  for (const e of regulares) referencia = Math.max(referencia, e.year * 100 + e.month);

  // agrupa por (company|proposta)
  type Grupo = {
    company_id: string | null;
    proposta: string;
    recebidas: Map<number, Recebida>; // posicao -> parcela recebida (mais antiga)
    primeira: string;
    valorBem: number;
    segmento: string | null;
  };
  const grupos = new Map<string, Grupo>();
  for (const e of regulares) {
    const proposta = String(e.operation_number || "");
    if (!proposta) continue;
    const k = `${e.company_id ?? "NULL"}|${proposta}`;
    const posicao = posicaoDaParcela(e.metadata?.parcela_liberacao ?? e.contract_number);
    if (!posicao) continue;
    const comp = compStr(e.year, e.month);
    const valorBem = Number(e.metadata?.valor_bem ?? e.gross_value ?? 0);
    const comissao = Number(e.commission_value ?? 0);
    const pct = Number(
      e.metadata?.pct_comissao ?? (valorBem > 0 ? comissao / valorBem : 0)
    );
    const segmento = (e.metadata?.segmento ?? null) as string | null;

    let g = grupos.get(k);
    if (!g) {
      g = { company_id: e.company_id, proposta, recebidas: new Map(), primeira: comp, valorBem, segmento };
      grupos.set(k, g);
    }
    if (compNum(comp) < compNum(g.primeira)) g.primeira = comp;
    if (valorBem > 0 && g.valorBem <= 0) g.valorBem = valorBem;
    if (!g.segmento && segmento) g.segmento = segmento;
    // parcela recebida: mantem a ocorrencia mais ANTIGA da posicao.
    const ja = g.recebidas.get(posicao);
    if (!ja || compNum(comp) < compNum(ja.competencia)) {
      g.recebidas.set(posicao, { comissao, competencia: comp, pct, valorBem, segmento });
    }
  }

  const rows: CarteiraConsorcioRow[] = [];
  for (const g of grupos.values()) {
    const grupo = grupoDoSegmento(g.segmento);
    const teto = tetoDoGrupo(grupo);
    const dono = colunasDeDono(
      beneficiarioByProposta.get(`${g.company_id ?? "NULL"}|${g.proposta}`) ?? null
    );

    // back-out: usa o % da MENOR posicao recebida <= 5 (Geral) / qualquer (Imovel),
    // pois a 6a do Geral tem % diferente (degrau).
    const recebidasOrdenadas = [...g.recebidas.entries()].sort((a, b) => a[0] - b[0]);
    let pctObs = 0;
    for (const [pos, r] of recebidasOrdenadas) {
      if (grupo === "IMOVEL" || pos <= 5) {
        pctObs = r.pct;
        break;
      }
    }
    if (pctObs === 0 && recebidasOrdenadas.length > 0) pctObs = recebidasOrdenadas[0][1].pct;
    const classificacao = classificacaoPorPercentual(grupo, pctObs);
    const proj = projetarParcelas({ grupo, valorBem: g.valorBem, pctObservado: pctObs, classificacao });

    const maxRecebida = recebidasOrdenadas.length ? recebidasOrdenadas[recebidasOrdenadas.length - 1][0] : 0;
    const ultimaComp = recebidasOrdenadas.length
      ? recebidasOrdenadas.reduce((mx, [, r]) => Math.max(mx, compNum(r.competencia)), 0)
      : 0;
    const completa = maxRecebida >= teto;

    for (const parc of proj.parcelas) {
      const rec = g.recebidas.get(parc.posicao);
      let status: CarteiraConsorcioRow["status"];
      if (rec) {
        status = completa && parc.posicao === teto ? "ENCERRADA" : "RECEBIDA";
      } else if (parc.posicao === maxRecebida + 1 && ultimaComp > 0 && ultimaComp < referencia) {
        status = "NAO_VEIO"; // a proxima parcela nao veio no mes esperado
      } else {
        status = "ESPERADA";
      }
      rows.push({
        company_id: g.company_id,
        proposta: g.proposta,
        posicao: parc.posicao,
        segmento_codigo: g.segmento,
        segmento_grupo: grupo,
        teto_parcelas: teto,
        valor_bem: round2(g.valorBem),
        classificacao,
        alerta_pct: proj.alerta,
        pct_comissao_ref: parc.pct,
        comissao_esperada: parc.comissaoEsperada,
        comissao_recebida: rec ? round2(rec.comissao) : null,
        competencia_recebida: rec ? rec.competencia : null,
        status,
        promoter_id: dono.promoter_id,
        app_user_id: dono.assigned_app_user_id,
        primeira_competencia: g.primeira,
      });
    }
  }
  return rows;
}

// Materializa a carteira no banco: rebuild total (delete-all + insert). Em dryRun so
// devolve as linhas que gravaria.
export async function materializarCarteiraConsorcio(
  supabase: SupabaseLike,
  params?: { dryRun?: boolean; origemImportId?: string | null }
): Promise<{ linhas: number; propostas: number; rows: CarteiraConsorcioRow[] }> {
  const dryRun = params?.dryRun === true;
  const entries = await fetchConsorcioEntriesAll(supabase);
  const beneficiarioByProposta = await resolveConsorcioBeneficiarioByProposta(supabase);
  const rows = buildCarteiraConsorcioRows(entries, beneficiarioByProposta);
  const propostas = new Set(rows.map((r) => `${r.company_id ?? "NULL"}|${r.proposta}`)).size;

  if (dryRun) return { linhas: rows.length, propostas, rows };

  // rebuild total: apaga tudo, insere de novo. Verdade do dono esta na fila, entao
  // o wipe nao perde nada autoritativo (a carteira e derivada).
  const { error: delErr } = await supabase
    .from("carteira_consorcio")
    .delete()
    .not("id", "is", null);
  if (delErr) throw new Error(delErr.message);

  const payload = rows.map((r) => ({ ...r, origem_import_id: params?.origemImportId ?? null }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await supabase.from("carteira_consorcio").insert(payload.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { linhas: rows.length, propostas, rows };
}

/**
 * As parcelas da carteira que sao DESTE promotor.
 *
 * O dono vem do mapa das ANCORAS (resolveConsorcioBeneficiarioByProposta), NAO
 * da coluna promoter_id desta tabela — ver a Divida 2 no topo do arquivo.
 * Proposta cujo dono e um papel de GESTAO (venda propria) nao e de promotor
 * nenhum: vai para gestao_venda_propria e nao entra aqui.
 *
 * PURA e EXPORTADA para o gate exercitar a MESMA funcao que a rota
 * (app/api/promotores/consorcio-carteira) usa, em vez de testar uma copia.
 */
export function filtrarCarteiraDoPromotor<
  T extends { company_id: string | null; proposta: string }
>(
  rows: T[],
  donoPorProposta: Map<string, Beneficiario>,
  promoterId: string
): T[] {
  if (!promoterId) return [];
  return rows.filter((r) => {
    const dono = donoPorProposta.get(chaveProposta(r.company_id, r.proposta));
    return !!dono && dono.kind === "promotor" && dono.id === promoterId;
  });
}
