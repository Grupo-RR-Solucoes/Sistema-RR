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
//   CONSORCIO -> carteira_consorcio, que JA esta materializada (316 linhas), JA
//     tem `promoter_id` vindo da ancora e JA e renderizada em PromotorView:517.
//     Reusar e melhor que refazer: a carteira sabe a POSICAO da parcela no
//     contrato (3a de 6) e o que ainda esta por vir, coisas que
//     monthly_closing_entries nao sabe. O recorte aqui e a competencia PEDIDA
//     (competencia_recebida = 'YYYY-MM'): o detalhamento e do mes, e a visao da
//     carteira inteira continua sendo a de PromotorView, que nao muda.
// ============================================================
import { chaveNaturalProduto } from "../produtoAssignments.ts";
import { repassePromotor } from "../produtoRepasse.ts";
import { repasseConsorcioPromotor } from "../consorcio/trp210.ts";

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

/**
 * Linhas de produto do promotor na competencia. `promoterId` e OBRIGATORIO —
 * chamar sem ele e erro de programacao, nao um "traz tudo".
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
  const competencia = `${year}-${String(month).padStart(2, "0")}`;
  const rows: ProdutoProposalRow[] = [];
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
    // SO ASSIGNED, e SO deste promotor. As duas condicoes no mesmo Set: uma
    // linha ASSIGNED para OUTRA pessoa nao pode cair aqui por descuido.
    const minhas = new Set(
      fila
        .filter((a) => a.status === "ASSIGNED" && a.promoter_id === promoterId)
        .map((a) => chaveNaturalProduto(a))
    );
    const semDono = new Set(
      fila.filter((a) => a.status !== "ASSIGNED" || !a.promoter_id).map((a) => chaveNaturalProduto(a))
    );

    for (const e of entries) {
      const chave = chaveNaturalProduto(e);
      if (semDono.has(chave)) {
        if (e.entry_type === "BBCAP") sem_atribuicao.bbcap += 1;
        else sem_atribuicao.conta_corrente += 1;
      }
      if (!minhas.has(chave)) continue;
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
        rows.push({
          ...base,
          cpf_cliente: txt(md.cpf_cliente),
          data_venda: e.operation_date ?? null,
          data_debito: txt(md.data_debito),
          codigo_produto: txt(md.codigo_produto),
          valor_produto: num(md.valor_produto) || num(e.gross_value),
          login_agente: txt(md.login_agente),
        });
      } else {
        rows.push({
          ...base,
          agencia: txt(md.agencia),
          j_key: e.j_key ?? null,
          data: e.operation_date ?? null,
          produto_texto: txt(md.produto_texto),
        });
      }
    }
  }

  // ---- 2. CONSORCIO: carteira_consorcio (ja materializada e ja com dono) ----
  // Sem try/catch por tabela ausente: carteira_consorcio existe desde a migration
  // 20260721_000001 e e lida pela /api/promotores/consorcio-carteira em producao.
  const carteira = await paged<any>(() =>
    supabase
      .from("carteira_consorcio")
      .select(
        "company_id, proposta, posicao, teto_parcelas, segmento_grupo, segmento_codigo, valor_bem, pct_comissao_ref, comissao_recebida, competencia_recebida, status, promoter_id"
      )
      .eq("competencia_recebida", competencia)
  );
  for (const p of carteira) {
    if (!p.promoter_id) {
      sem_atribuicao.consorcio += 1;
      continue;
    }
    if (p.promoter_id !== promoterId) continue;
    const empresa = num(p.comissao_recebida);
    rows.push({
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
    });
  }

  rows.sort(
    (a, b) =>
      a.entry_type.localeCompare(b.entry_type) || a.operacao.localeCompare(b.operacao)
  );

  const soma = (t: string) =>
    r2(rows.filter((r) => r.entry_type === t).reduce((s, r) => s + r.comissao_promotor, 0));
  const bbcap = soma("BBCAP");
  const conta_corrente = soma("CONTA_CORRENTE");
  const consorcio = soma("CONSORCIO");

  return {
    rows,
    totais: { bbcap, conta_corrente, consorcio, total: r2(bbcap + conta_corrente + consorcio) },
    sem_atribuicao,
  };
}
