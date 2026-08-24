// ============================================================
// DETALHAMENTO POR PRODUTO — linha a linha, do promotor.
//
// Analogo a lib/closingProposalRows.ts (que faz o mesmo para o credito a vista):
// le a fonte FECHADA, resolve o dono e devolve uma linha por operacao, ja com o
// repasse calculado. O consumidor e a aba "Produtos" da /promotores e o card
// "Meus produtos" do PromotorView.
//
// O ESCOPO E A GUARDA. `promoterId` e OBRIGATORIO e o filtro acontece na ORIGEM,
// nao na tela: quem nao e dono da linha nao a recebe, e nao ha parametro que
// mude isso. Isso e proposital e e diferente da visibilidade de CAMPO:
//
//   podeVerComissaoDePromotor(role) devolve FALSE para o papel `promotor`, de
//   proposito — o direito dele e sobre a comissao DELE, e isso e escopo. Ligar o
//   helper para `promotor` faria ele ver a comissao dos COLEGAS no instante em
//   que alguem passasse ?promoterId= de outra pessoa. NAO LIGUE.
//
// O helper entra aqui so como CINTO DE SEGURANCA (`incluirComissaoEmpresa`),
// para o dia em que um quarto papel ganhar acesso a /promotores: hoje supervisor
// e gerente_regional levam 403 na rota (route.ts:148-154), entao nao ha o que
// barrar — mas a rota nao pode ser a unica coisa entre um papel novo e o dado.
//
// TRES PRODUTOS, DUAS FONTES:
//   BBCAP / CONTA_CORRENTE -> monthly_closing_entries (as linhas que o M1
//     desdobrou) juntadas a product_line_assignments pela CHAVE NATURAL
//     (chaveNaturalProduto — o mesmo helper da fila e do calculo).
//   CONSORCIO -> DUAS fontes, com papeis separados:
//     O DONO sai das ANCORAS (product_line_assignments, via
//       resolveConsorcioBeneficiarioByProposta) — a MESMA funcao de onde o
//       PAGAMENTO tira o dono (computeConsorcioCommissionByBeneficiario).
//     A LINHA sai de carteira_consorcio, que sabe o que a master nao sabe: a
//       POSICAO da parcela no contrato (3a de 6), o teto e o valor do bem.
//     O recorte e a competencia PEDIDA (competencia_recebida = 'YYYY-MM'); a
//       visao da carteira INTEIRA continua sendo a de PromotorView.
//
// POR QUE O DONO NAO SAI MAIS DA CARTEIRA (medido em 23/08/2026, e era bug meu):
// carteira_consorcio.promoter_id e um RETRATO DO IMPORT —
// materializarCarteiraConsorcio so e chamada de app/api/import/closing/route.ts.
// Atribuir na fila NAO re-materializa nada. Resultado: 27 ancoras ASSIGNED e as
// 316 linhas da carteira com promoter_id NULO, porque o ultimo import foi 14/08,
// antes de qualquer atribuicao. O detalhamento mostrava 0,00 de consorcio para
// TODO MUNDO enquanto o PMR pagava certo — duas fontes de verdade para "de quem e
// esta parcela", e a minha era a que envelhecia. Agora ha uma so.
// ============================================================
import { chaveNaturalProduto } from "../produtoAssignments.ts";
import { repassePromotor } from "../produtoRepasse.ts";
import { repasseConsorcioPromotor } from "../consorcio/trp210.ts";
import {
  chaveProposta,
  resolveConsorcioBeneficiarioByProposta,
} from "../consorcio/fila.ts";

type SupabaseLike = { from: (t: string) => any };

/** Produtos de evento unico que vivem em monthly_closing_entries. */
const EVENTO_UNICO = ["BBCAP", "CONTA_CORRENTE"] as const;

export type ProdutoProposalRow = {
  entry_type: "BBCAP" | "CONTA_CORRENTE" | "CONSORCIO";
  /** Proposta (BBCAP/consorcio) ou numero da conta (conta corrente). */
  operacao: string;
  company_id: string | null;
  /** Comissao da EMPRESA. Ausente quando o consumidor nao tem direito. */
  comissao_empresa?: number;
  /** O repasse do promotor — o que e DELE. Sempre presente. */
  comissao_promotor: number;

  // --- colunas do fechamento manual; nulas onde nao se aplicam ao produto ---
  cpf_cliente?: string | null;
  data_venda?: string | null;
  data_debito?: string | null;
  codigo_produto?: string | null;
  valor_produto?: number | null;
  login_agente?: string | null;

  agencia?: string | null;
  j_key?: string | null;
  produto_texto?: string | null;
  data?: string | null;

  segmento?: string | null;
  valor_bem?: number | null;
  parcela?: string | null;
  pct_comissao?: number | null;
  parcelas?: number | null;
};

export type ProdutoProposalRows = {
  rows: ProdutoProposalRow[];
  totais: { bbcap: number; conta_corrente: number; consorcio: number; total: number };
  /** Diagnostico honesto: quantas linhas do mes existem SEM dono atribuido. */
  sem_atribuicao: { bbcap: number; conta_corrente: number; consorcio: number };
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

async function paged<T = any>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

/** Linha de produto JA com o dono resolvido. Uso interno. */
type LinhaComDono = { promoterId: string; row: ProdutoProposalRow };

/**
 * COLETOR: todas as linhas de produto da competencia que tem dono PROMOTOR, cada
 * uma com o id do dono. Uso INTERNO — nao e exportado de proposito: quem chama de
 * fora passa por buildProdutoProposalRows (escopo de um promotor) ou por
 * buildProdutoResumoGrupo (visao do grupo, so para socio/funcionario). Nao ha
 * caminho que devolva "as linhas de todo mundo, uma a uma".
 *
 * As duas saidas nascem DAQUI, e e por isso que a soma do grupo e identica a soma
 * dos individuais por CONSTRUCAO, e nao por coincidencia de dois codigos.
 */
async function coletarLinhasComDono(
  supabase: SupabaseLike,
  params: { year: number; month: number; incluirComissaoEmpresa: boolean }
): Promise<{
  linhas: LinhaComDono[];
  sem_atribuicao: { bbcap: number; conta_corrente: number; consorcio: number };
}> {
  const { year, month, incluirComissaoEmpresa } = params;
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const linhas: LinhaComDono[] = [];
  const sem_atribuicao = { bbcap: 0, conta_corrente: 0, consorcio: 0 };

  // ---- 1. BBCAP e CONTA CORRENTE: master + fila, pela chave natural ----
  const entries = await paged<any>(() =>
    supabase
      .from("monthly_closing_entries")
      .select(
        "company_id, entry_type, operation_number, contract_number, j_key, commission_value, gross_value, operation_date, metadata"
      )
      .eq("year", year)
      .eq("month", month)
      .in("entry_type", EVENTO_UNICO as unknown as string[])
  );

  if (entries.length > 0) {
    const fila = await paged<any>(() =>
      supabase
        .from("product_line_assignments")
        .select("company_id, entry_type, operation_number, contract_number, promoter_id, status")
        .eq("year", year)
        .eq("month", month)
        .in("entry_type", EVENTO_UNICO as unknown as string[])
    );
    // SO ASSIGNED e SO com promoter_id: a linha de um papel de GESTAO (venda
    // propria) nao e de promotor nenhum — vai para gestao_venda_propria.
    const donoDaChave = new Map<string, string>();
    for (const a of fila) {
      if (a.status !== "ASSIGNED" || !a.promoter_id) continue;
      donoDaChave.set(chaveNaturalProduto(a), a.promoter_id as string);
    }
    const semDono = new Set(
      fila.filter((a) => a.status !== "ASSIGNED" || !a.promoter_id).map((a) => chaveNaturalProduto(a))
    );

    for (const e of entries) {
      const chave = chaveNaturalProduto(e);
      if (semDono.has(chave)) {
        if (e.entry_type === "BBCAP") sem_atribuicao.bbcap += 1;
        else sem_atribuicao.conta_corrente += 1;
      }
      const donoEU = donoDaChave.get(chave);
      if (!donoEU) continue;
      const md = (e.metadata || {}) as Record<string, unknown>;
      const empresa = num(e.commission_value);
      const base: ProdutoProposalRow = {
        entry_type: e.entry_type,
        operacao: String(e.operation_number ?? ""),
        company_id: e.company_id ?? null,
        comissao_promotor: repassePromotor(empresa),
        ...(incluirComissaoEmpresa ? { comissao_empresa: empresa } : {}),
      };
      if (e.entry_type === "BBCAP") {
        linhas.push({
          promoterId: donoEU,
          row: {
            ...base,
            cpf_cliente: txt(md.cpf_cliente),
            data_venda: e.operation_date ?? null,
            data_debito: txt(md.data_debito),
            codigo_produto: txt(md.codigo_produto),
            valor_produto: num(md.valor_produto) || num(e.gross_value),
            login_agente: txt(md.login_agente),
          },
        });
      } else {
        linhas.push({
          promoterId: donoEU,
          row: {
            ...base,
            agencia: txt(md.agencia),
            j_key: e.j_key ?? null,
            data: e.operation_date ?? null,
            produto_texto: txt(md.produto_texto),
          },
        });
      }
    }
  }

  // ---- 2. CONSORCIO: dono da ANCORA, linha da CARTEIRA ----
  // Sem try/catch por tabela ausente: carteira_consorcio existe desde a migration
  // 20260721_000001 e e lida pela /api/promotores/consorcio-carteira em producao.
  const donoPorProposta = await resolveConsorcioBeneficiarioByProposta(supabase as any);
  const carteira = await paged<any>(() =>
    supabase
      .from("carteira_consorcio")
      .select(
        "company_id, proposta, posicao, teto_parcelas, segmento_grupo, segmento_codigo, valor_bem, pct_comissao_ref, comissao_recebida, competencia_recebida, status"
      )
      .eq("competencia_recebida", competencia)
  );
  for (const p of carteira) {
    // O dono vem da FILA, nao da carteira. `sem_atribuicao` tambem: contava 39
    // orfas lendo o promoter_id defasado enquanto havia 27 ancoras ASSIGNED.
    const dono = donoPorProposta.get(chaveProposta(p.company_id, p.proposta));
    if (!dono) {
      sem_atribuicao.consorcio += 1;
      continue;
    }
    // Linha de um papel de GESTAO (venda propria) nao e de promotor nenhum: vai
    // para gestao_venda_propria, nao para o PMR. Nao entra aqui nem conta como orfa.
    if (dono.kind !== "promotor") continue;
    const empresa = num(p.comissao_recebida);
    linhas.push({
      promoterId: dono.id,
      row: {
        entry_type: "CONSORCIO",
        operacao: String(p.proposta ?? ""),
        company_id: p.company_id ?? null,
        comissao_promotor: repasseConsorcioPromotor(empresa),
        ...(incluirComissaoEmpresa ? { comissao_empresa: empresa } : {}),
        segmento: txt(p.segmento_codigo) ?? txt(p.segmento_grupo),
        valor_bem: num(p.valor_bem),
        // "3ª / 6" — a POSICAO no contrato, que so a carteira sabe. E o que
        // responde "quantas ainda vem", pergunta que o promotor faz sempre.
        parcela: `${num(p.posicao)}/${num(p.teto_parcelas)}`,
        pct_comissao: p.pct_comissao_ref === null ? null : num(p.pct_comissao_ref),
        parcelas: 1,
        data: null,
      },
    });
  }

  return { linhas, sem_atribuicao };
}

/** Soma o repasse de um produto num conjunto de linhas. */
const somaProduto = (rows: ProdutoProposalRow[], t: string) =>
  r2(rows.filter((r) => r.entry_type === t).reduce((s, r) => s + r.comissao_promotor, 0));

const totaisDe = (rows: ProdutoProposalRow[]) => {
  const bbcap = somaProduto(rows, "BBCAP");
  const conta_corrente = somaProduto(rows, "CONTA_CORRENTE");
  const consorcio = somaProduto(rows, "CONSORCIO");
  return { bbcap, conta_corrente, consorcio, total: r2(bbcap + conta_corrente + consorcio) };
};

/**
 * Linhas de produto do promotor na competencia. `promoterId` e OBRIGATORIO —
 * chamar sem ele e erro de programacao, nao um "traz tudo". Ver o topo: o escopo
 * e a guarda.
 */
export async function buildProdutoProposalRows(
  supabase: SupabaseLike,
  params: {
    promoterId: string;
    year: number;
    month: number;
    /** Cinto de seguranca: false esconde a comissao da EMPRESA. Ver o topo. */
    incluirComissaoEmpresa: boolean;
  }
): Promise<ProdutoProposalRows> {
  const { promoterId, year, month, incluirComissaoEmpresa } = params;
  if (!promoterId) {
    throw new Error("buildProdutoProposalRows: promoterId e obrigatorio (o escopo e a guarda)");
  }
  const { linhas, sem_atribuicao } = await coletarLinhasComDono(supabase, {
    year,
    month,
    incluirComissaoEmpresa,
  });
  const rows = linhas.filter((l) => l.promoterId === promoterId).map((l) => l.row);
  rows.sort(
    (a, b) =>
      a.entry_type.localeCompare(b.entry_type) || a.operacao.localeCompare(b.operacao)
  );
  return { rows, totais: totaisDe(rows), sem_atribuicao };
}

export type ProdutoResumoGrupoLinha = {
  promoter_id: string;
  promoter_name: string;
  bbcap: number;
  conta_corrente: number;
  consorcio: number;
  total: number;
  /** Quantas linhas de produto formam esse total (o gancho para o drill-down). */
  linhas: number;
};

export type ProdutoResumoGrupo = {
  totais: { bbcap: number; conta_corrente: number; consorcio: number; total: number };
  por_promotor: ProdutoResumoGrupoLinha[];
  sem_atribuicao: { bbcap: number; conta_corrente: number; consorcio: number };
  /** Diagnostico: quantos promotores e quantas linhas formam o total. */
  promotores: number;
  linhas: number;
};

/**
 * VISAO DO GRUPO — a aba Produtos com "Promotor: todos".
 *
 * O CORTE E POR PROMOTOR, NAO POR LINHA, e isso e a decisao de projeto: sao 198
 * parcelas de consorcio em julho contra ~21 promotores. Despejar as 198 numa tela
 * de visao geral seria trocar uma resposta por uma pilha — e a pergunta que o
 * socio faz aqui e "quem vendeu quanto de cada produto", nao "qual foi a 3a
 * parcela da proposta 8526498". Uma linha por promotor, os tres produtos em
 * colunas, mais a CONTAGEM de linhas: quem quiser o detalhe seleciona a pessoa e
 * cai na visao que ja existe.
 *
 * Escolhi isto em vez de tres tabelas (uma por produto) porque repetiria o nome
 * de cada promotor tres vezes e obrigaria a somar de cabeca para saber o total de
 * alguem — que e justamente a coluna que interessa na hora de pagar.
 *
 * VISIBILIDADE: esta funcao NAO tem escopo de promotor, entao so pode ser chamada
 * por quem enxerga o grupo inteiro. Hoje isso e socio/funcionario — supervisor e
 * gerente_regional levam 403 antes, em app/api/promotores/route.ts:148-154. Quem
 * chamar daqui e responsavel por ter passado por essa porta; a funcao nao a
 * reimplementa, e por isso NAO recebe `role`: um parametro de papel aqui daria a
 * impressao de que ela decide permissao, e ela nao decide.
 */
export async function buildProdutoResumoGrupo(
  supabase: SupabaseLike,
  params: { year: number; month: number }
): Promise<ProdutoResumoGrupo> {
  const { year, month } = params;
  // A visao do grupo e de quem ve tudo, entao a comissao da EMPRESA vem junto —
  // e o mesmo `true` que a rota ja passa para socio/funcionario no caminho
  // individual. As linhas em si nao saem daqui; so os agregados.
  const { linhas, sem_atribuicao } = await coletarLinhasComDono(supabase, {
    year,
    month,
    incluirComissaoEmpresa: true,
  });

  const porPid = new Map<string, ProdutoProposalRow[]>();
  for (const l of linhas) {
    const lista = porPid.get(l.promoterId) || [];
    lista.push(l.row);
    porPid.set(l.promoterId, lista);
  }

  // Nomes: uma consulta so, nos ids que realmente aparecem.
  const ids = [...porPid.keys()];
  const nomes = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase
      .from("promoters")
      .select("id, name")
      .in("id", ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const p of data || []) nomes.set(p.id, String(p.name));
  }

  const por_promotor: ProdutoResumoGrupoLinha[] = [...porPid.entries()]
    .map(([pid, rows]) => {
      const t = totaisDe(rows);
      return {
        promoter_id: pid,
        promoter_name: nomes.get(pid) ?? "(promotor removido)",
        bbcap: t.bbcap,
        conta_corrente: t.conta_corrente,
        consorcio: t.consorcio,
        total: t.total,
        linhas: rows.length,
      };
    })
    .sort((a, b) => b.total - a.total || a.promoter_name.localeCompare(b.promoter_name));

  // O TOTAL sai das linhas, nao da soma dos arredondados por promotor: somar
  // valores ja arredondados acumularia centavo. Cada `total` de promotor continua
  // sendo o que ele recebe; o total do grupo e o que a empresa repassa.
  const todasAsRows = linhas.map((l) => l.row);
  return {
    totais: totaisDe(todasAsRows),
    por_promotor,
    sem_atribuicao,
    promotores: por_promotor.length,
    linhas: todasAsRows.length,
  };
}
