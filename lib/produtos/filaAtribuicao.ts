// ============================================================
// FILA DE ATRIBUICAO DE PRODUTOS — montagem do payload.
//
// EXTRAIDO de app/api/produtos/atribuicao/route.ts para que o gate consiga
// exercitar a MESMA funcao que a rota serve, com cada papel, sem sessao HTTP.
// (mesmo motivo e mesmo padrao do scripts/gate_projecao_gestor.mts, que importa
// montarPayloadGestor em vez de reimplementar a /projecao.)
//
// A rota virou casca: guard -> parse do request -> esta funcao -> NextResponse.
// ============================================================
import { chaveNaturalProduto } from "../produtoAssignments.ts";
import { repassePromotor } from "../produtoRepasse.ts";
import { repasseConsorcioGestor, repasseConsorcioPromotor } from "../consorcio/trp210.ts";
import { beneficiarioDaLinha, beneficiarioValue, PAPEIS_COM_VENDA_PROPRIA } from "../produtoBeneficiario.ts";
import { podeVerComissaoDePromotor } from "../auth/visibilidadeComissao.ts";

export const EVENTO_UNICO = ["BBCAP", "CONTA_CORRENTE"];

// ============================================================
// DETALHE DA LINHA — as colunas do FECHAMENTO MANUAL.
//
// A fila (product_line_assignments) so guarda a identidade da linha e o dono. Todo
// o resto (datas, produto, valores, agencia...) mora na MASTER
// (monthly_closing_entries), gravado pelo desdobramento do M1. Os dois lados se
// juntam pela CHAVE NATURAL — chaveNaturalProduto, o mesmo helper que a fila usa
// para nao duplicar e que o calculo usa para achar o dono.
//
// COMPETENCIA DO VALOR EXIBIDO — decisao escrita:
//   BBCAP / CONTA CORRENTE : a competencia PEDIDA (year, month). A fila ja e por
//     competencia, entao fila e valor sao sempre o mesmo mes.
//   CONSORCIO : a ancora NAO tem competencia (uma atribuicao vale para todas as
//     parcelas, passadas e futuras — e o ponto da heranca). O valor exibido e o da
//     competencia PEDIDA: soma das parcelas RECEBIDAS naquele mes, com a contagem.
//     Proposta sem parcela no mes aparece com detalhe null (ainda atribuivel) — e
//     o unico jeito de a tela nao misturar meses. A competencia vai no payload
//     (`competencia`) para a tela dizer de qual mes sao os numeros.
//
// A comissao do promotor (e a do gestor) e DERIVADA aqui, na exibicao: nao existe
// coluna gravada para ela. Quem paga continua sendo o PMR / consorcio_gestor_payout.
// ============================================================

export type DetalheEventoUnico = {
  comissao_empresa: number;
  /** OPCIONAL de proposito: ausente para quem nao pode ver (ver podeVerComissaoDePromotor). */
  comissao_promotor?: number;
  j_key: string | null;
  operation_date: string | null;
  metadata: Record<string, unknown>;
};

export type DetalheConsorcio = {
  comissao_empresa: number;
  /** OPCIONAL de proposito: ausente para quem nao pode ver (ver podeVerComissaoDePromotor). */
  comissao_promotor?: number;
  comissao_gestor: number;
  parcelas: number;
  parcela_rotulo: string | null;
  operation_date: string | null;
  valor_bem: number;
  pct_comissao: number | null;
  segmento: string | null;
  razao_social: string | null;
};

type EntryRow = {
  company_id: string | null;
  entry_type: string;
  operation_number: string | null;
  contract_number: string | null;
  j_key: string | null;
  commission_value: number | null;
  gross_value: number | null;
  operation_date: string | null;
  metadata: Record<string, unknown> | null;
};

const ENTRY_COLS =
  "company_id, entry_type, operation_number, contract_number, j_key, commission_value, gross_value, operation_date, metadata";

async function fetchEntriesPaged(
  supabase: any,
  year: number,
  month: number,
  entryTypes: string[]
): Promise<EntryRow[]> {
  if (entryTypes.length === 0) return [];
  const out: EntryRow[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("monthly_closing_entries")
      .select(ENTRY_COLS)
      .eq("year", year)
      .eq("month", month)
      .in("entry_type", entryTypes)
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as EntryRow[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const txt = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Chave da PROPOSTA de consorcio (a ancora e por proposta, nao por parcela). */
const chaveProposta = (companyId: string | null, proposta: string | null) =>
  `${companyId}|${String(proposta ?? "").trim()}`;

export function isBalde(entryType: string, operation: string | null): boolean {
  return entryType === "CONTA_CORRENTE" && String(operation || "").startsWith("SEMID|");
}

const ROLE_LABEL: Record<string, string> = {
  gestor_consorcio: "Gestor de Consórcio",
  supervisor: "Supervisor",
  gerente_regional: "Gerente Regional",
};

function ordena(a: any, b: any) {
  if (a.status !== b.status) return a.status === "PENDING" ? -1 : 1; // pendentes primeiro
  return String(a.operation_number).localeCompare(String(b.operation_number));
}

export type ParamsFilaAtribuicao = {
  year: number;
  month: number;
  role: string;
  escopo: "TODOS" | "CONSORCIO";
};

export async function montarPayloadFilaAtribuicao(
  supabase: any,
  params: ParamsFilaAtribuicao
) {
const { year, month, role, escopo } = params;
const soConsorcio = escopo === "CONSORCIO";
// VISIBILIDADE: quem nao pode ver a comissao do promotor nao RECEBE o campo.
// A decisao acontece aqui, antes de montar a resposta — nao na tela.
const podeVerRepasse = podeVerComissaoDePromotor(role);

  // eventos unicos da competencia + ancoras de consorcio (todas as competencias).
  // No escopo CONSORCIO os eventos unicos nem sao consultados.
  // As linhas da MASTER da competencia pedida — o detalhe que a fila nao tem.
  const entriesPromise = fetchEntriesPaged(
    supabase,
    year,
    month,
    soConsorcio ? ["CONSORCIO"] : [...EVENTO_UNICO, "CONSORCIO"]
  );

  const [eu, cons, proms, gestores, entries] = await Promise.all([
    soConsorcio
      ? Promise.resolve({ data: [], error: null } as any)
      : supabase
          .from("product_line_assignments")
          .select(
            "id, company_id, entry_type, operation_number, contract_number, promoter_id, assigned_app_user_id, status, source, year, month"
          )
          .in("entry_type", EVENTO_UNICO)
          .eq("year", year)
          .eq("month", month),
    supabase
      .from("product_line_assignments")
      .select(
        "id, company_id, entry_type, operation_number, contract_number, promoter_id, assigned_app_user_id, status, source, year, month"
      )
      .eq("entry_type", "CONSORCIO"),
    supabase.from("promoters").select("id, name, company_id, active"),
    // papeis de gestao COM venda propria habilitada — os outros beneficiarios.
    supabase
      .from("app_users")
      .select("id, full_name, email, role, venda_propria, active")
      .eq("venda_propria", true)
      .eq("active", true),
    entriesPromise,
  ]);
  if (eu.error) throw new Error(eu.error.message);
  if (cons.error) throw new Error(cons.error.message);
  if (proms.error) throw new Error(proms.error.message);
  if (gestores.error) throw new Error(gestores.error.message);

  // ---- detalhe por CHAVE NATURAL (evento unico: 1 linha da fila = 1 entry) ----
  const detalheEU = new Map<string, DetalheEventoUnico>();
  for (const e of entries) {
    if (e.entry_type === "CONSORCIO") continue;
    const comissao = num(e.commission_value);
    detalheEU.set(chaveNaturalProduto(e), {
      comissao_empresa: comissao,
      ...(podeVerRepasse ? { comissao_promotor: repassePromotor(comissao) } : {}),
      j_key: e.j_key ?? null,
      operation_date: e.operation_date ?? null,
      metadata: e.metadata || {},
    });
  }

  // ---- detalhe por PROPOSTA (consorcio: 1 ancora = N parcelas no mes) ----
  // Soma a comissao-empresa das parcelas da competencia PEDIDA e conta quantas
  // sao. Nao cria linha por parcela: a fila continua sendo por proposta.
  const detalheCons = new Map<string, DetalheConsorcio>();
  for (const e of entries) {
    if (e.entry_type !== "CONSORCIO") continue;
    const k = chaveProposta(e.company_id, e.operation_number);
    const md = (e.metadata || {}) as Record<string, unknown>;
    const cur =
      detalheCons.get(k) ||
      ({
        comissao_empresa: 0,
        comissao_gestor: 0,
        parcelas: 0,
        parcela_rotulo: null,
        operation_date: null,
        valor_bem: 0,
        pct_comissao: null,
        segmento: null,
        razao_social: null,
      } as DetalheConsorcio);
    cur.comissao_empresa += num(e.commission_value);
    cur.parcelas += 1;
    // atributos da PROPOSTA (iguais em todas as parcelas): fica o 1o nao vazio.
    cur.valor_bem = cur.valor_bem || num(md.valor_bem) || num(e.gross_value);
    cur.pct_comissao = cur.pct_comissao ?? (md.pct_comissao == null ? null : num(md.pct_comissao));
    cur.segmento = cur.segmento ?? txt(md.segmento);
    cur.razao_social = cur.razao_social ?? txt(md.razao_social);
    cur.operation_date = cur.operation_date ?? (e.operation_date ?? null);
    // rotulo da parcela: uma so -> "PARC1"; varias -> "PARC1..PARC3".
    const rot = txt(md.parcela_liberacao);
    if (rot) {
      cur.parcela_rotulo = cur.parcela_rotulo
        ? [cur.parcela_rotulo.split("..")[0], rot].sort().join("..")
        : rot;
    }
    detalheCons.set(k, cur);
  }
  // repasses DERIVADOS sobre a soma da proposta (nao gravados em lugar nenhum).
  for (const d of detalheCons.values()) {
    d.comissao_empresa = Math.round(d.comissao_empresa * 100) / 100;
    // O repasse do PROMOTOR so existe no payload de quem tem direito. A comissao
    // do GESTOR (0,10) e a da EMPRESA (a base do calculo dele) ficam sempre — sao
    // dele e do negocio, nao do promotor.
    if (podeVerRepasse) d.comissao_promotor = repasseConsorcioPromotor(d.comissao_empresa);
    d.comissao_gestor = repasseConsorcioGestor(d.comissao_empresa);
  }

  const nameOf = new Map((proms.data || []).map((p: any) => [p.id, p.name]));
  const gestaoRows = (gestores.data || []).filter((g: any) =>
    (PAPEIS_COM_VENDA_PROPRIA as readonly string[]).includes(String(g.role))
  );
  const gestaoNameOf = new Map(
    gestaoRows.map((g: any) => [g.id, String(g.full_name || g.email || "(gestao)")])
  );

  // LISTA UNICA do dropdown: promotores + gestao. `kind` separa os dois na tela
  // (a linha de gestao aparece em destaque para conferencia — auto-atribuicao e
  // liberada, entao ela precisa ser visivel).
  const beneficiarios = [
    ...(proms.data || [])
      .filter((p: any) => p.active !== false)
      .map((p: any) => ({
        value: beneficiarioValue({ kind: "promotor", id: p.id }),
        kind: "promotor" as const,
        id: p.id,
        nome: String(p.name),
        sub: "",
      }))
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome)),
    ...gestaoRows
      .map((g: any) => ({
        value: beneficiarioValue({ kind: "gestao", id: g.id }),
        kind: "gestao" as const,
        id: g.id,
        nome: String(g.full_name || g.email || "(gestao)"),
        sub: ROLE_LABEL[String(g.role)] ?? String(g.role),
      }))
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome)),
  ];

  const toItem = (r: any) => {
    const dono = beneficiarioDaLinha(r);
    return {
      id: r.id,
      company_id: r.company_id,
      entry_type: r.entry_type,
      operation_number: r.operation_number,
      contract_number: r.contract_number ?? "",
      beneficiario_value: dono ? beneficiarioValue(dono) : "",
      beneficiario_kind: dono?.kind ?? null,
      beneficiario_nome: dono
        ? dono.kind === "promotor"
          ? nameOf.get(dono.id) ?? "(promotor removido)"
          : gestaoNameOf.get(dono.id) ?? "(gestao sem venda propria)"
        : null,
      status: r.status,
      balde: isBalde(r.entry_type, r.operation_number),
      // Detalhe do fechamento. null = nao ha linha na master para esta chave na
      // competencia pedida (consorcio sem parcela no mes, ou fila orfa de entry).
      detalhe:
        r.entry_type === "CONSORCIO"
          ? detalheCons.get(chaveProposta(r.company_id, r.operation_number)) ?? null
          : detalheEU.get(chaveNaturalProduto(r)) ?? null,
    };
  };

  const euRows = (eu.data || []).map(toItem);
  const grupos = {
    bbcap: euRows.filter((r: any) => r.entry_type === "BBCAP").sort(ordena),
    conta_corrente: euRows.filter((r: any) => r.entry_type === "CONTA_CORRENTE").sort(ordena),
    consorcio: (cons.data || []).map(toItem).sort(ordena),
  };

  const todas = [...grupos.bbcap, ...grupos.conta_corrente, ...grupos.consorcio];
  const resumo = {
    pendentes: todas.filter((r: any) => r.status === "PENDING").length,
    atribuidas: todas.filter((r: any) => r.status === "ASSIGNED").length,
    gestao: todas.filter((r: any) => r.beneficiario_kind === "gestao").length,
  };

return {
  year,
  month,
  competencia: `${String(month).padStart(2, "0")}/${year}`,
  escopo,
  role,
  // A tela usa para NAO desenhar a coluna. O dado ja saiu de fora quando e false —
  // este flag e conveniencia de render, nao a guarda.
  pode_ver_comissao_promotor: podeVerRepasse,
  grupos,
  beneficiarios,
  resumo,
};
}
