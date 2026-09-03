// ============================================================
// descontoNaoAplicado — O DESCONTO QUE O PISO NÃO DEIXOU ACONTECER.
//
// A REGRA (decisão Diego, 20/08/2026, em promoterAnalytics.ts:1486-1509):
// quando o piso de produção zera o repasse, payable = 0 e a parcela de desconto
// daquela competência NÃO É CONSUMIDA. Não é `max(0, final - desconto)`: um
// desconto de R$ 3,14 num mês zerado não vira zero — ele NÃO ACONTECE.
//
// O QUE ESTE ARQUIVO CONSERTA: a linha em promoter_discounts continuava
// `status='PENDING'` para sempre. PENDING diz "ainda vai ser cobrado", e isso é
// falso — nenhum leitor de dinheiro consulta `status`, e todos amarram por
// (year, month) (medido 02/09/2026: promoterAnalytics:998 lê a tabela inteira e
// casa por competência; dre.ts:612 e financialAnalytics:811 filtram por
// (year,month)). Uma linha de 2026-08 só pode ser lida COMO 2026-08. Logo a
// cobrança não é adiada: ela não existe mais. O status tem de dizer isso.
//
// POR QUE 'WAIVED' E NÃO UM 'NAO_APLICADO_PISO' NOVO
// --------------------------------------------------
// O CHECK da coluna (migration 20260709_000001) aceita
// PENDING | APPLIED | WAIVED | CANCELLED. Um valor novo exigiria migration, e
// migration NESTE repo é aplicada à mão no Studio — o padrão que já deixou
// código inerte várias vezes, e que é a origem desta própria frente. 'WAIVED'
// (dispensado) descreve o efeito com exatidão: a cobrança não ocorreu e não será
// recuperada. Estava LIVRE — medido: 0 linhas WAIVED no banco e nenhuma escrita
// de 'WAIVED' em todo o código. A nuance ("foi o piso, não uma decisão humana")
// não se perde: vai no `notes`, com MARCADOR estável, e é ela que torna a
// marcação REVERSÍVEL sem pisar num waiver feito por gente.
//
// ESCOPO DELIBERADO: isto NÃO devolve dinheiro nem desloca parcela. A cauda de
// um plano parcelado continua sem deslocar — hoje os dois únicos casos reais são
// parcela 1/1 (cobrança avulsa), então não há cauda. Se um dia cair um
// ADIANTAMENTO 3/9 aqui, o item `desconto_nao_cobrado_por_piso` do ledgerHealth
// acende no mesmo dia, que é justamente o que não existia.
// ============================================================

/** Status usado para a parcela que o piso impediu. Ver o cabeçalho. */
export const STATUS_NAO_APLICADO_PISO = "WAIVED";

/** Marcador estável em `notes`. É por ele que a reversão sabe o que é NOSSO. */
export const MARCADOR_PISO = "[PISO_NAO_COBRADO]";

export interface LinhaPmrPiso {
  promoter_id: string;
  year: number;
  month: number;
  piso_zerou?: boolean | null;
}

export interface LinhaDesconto {
  id: string;
  promoter_id: string;
  year: number;
  month: number;
  amount: number | string | null;
  apply_to_company?: boolean | null;
  status?: string | null;
  notes?: string | null;
  discount_type?: string | null;
}

export interface DescontoNaoAplicado {
  desconto_id: string;
  promoter_id: string;
  year: number;
  month: number;
  competencia: string;
  valor: number;
  discount_type: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const comp = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/**
 * Descontos que NÃO aconteceram porque o piso zerou o repasse do promotor
 * naquela competência.
 *
 * TRÊS REGRAS, e são estas que o portão muta:
 *   1. `piso_zerou === true` — comparação ESTRITA. `!piso_zerou` classificaria
 *      todo o histórico (onde a coluna é null/false) como zerado; é a mesma
 *      armadilha do `trp_multi_versao`;
 *   2. o casamento é por (promoter_id, year, month) — a competência do desconto
 *      é a do PMR, nunca "a próxima";
 *   3. `apply_to_company === true` fica FORA: esse desconto não reduz o repasse
 *      do promotor, então o piso não tem o que impedir.
 */
export function descontosNaoAplicadosPorPiso(
  pmr: LinhaPmrPiso[],
  descontos: LinhaDesconto[]
): DescontoNaoAplicado[] {
  const zerados = new Set(
    (pmr || [])
      .filter((r) => r.piso_zerou === true) // regra 1 — estrito
      .map((r) => `${r.promoter_id}|${r.year}|${r.month}`)
  );
  if (zerados.size === 0) return [];

  const saida: DescontoNaoAplicado[] = [];
  for (const d of descontos || []) {
    if (d.apply_to_company === true) continue; // regra 3
    if (!zerados.has(`${d.promoter_id}|${d.year}|${d.month}`)) continue; // regra 2
    saida.push({
      desconto_id: d.id,
      promoter_id: d.promoter_id,
      year: d.year,
      month: d.month,
      competencia: comp(d.year, d.month),
      valor: num(d.amount),
      discount_type: d.discount_type ?? null,
    });
  }
  return saida;
}

/**
 * Remove só a(s) linha(s) do marcador, devolvendo o `notes` humano intacto.
 * É a metade que garante que marcar e desmarcar não corrói o texto de ninguém.
 */
export function notasSemMarcador(notesAtual: string | null | undefined): string | null {
  const base = (notesAtual || "")
    .split(/\r?\n/)
    .filter((l) => l.indexOf(MARCADOR_PISO) < 0)
    .join("\n")
    .trim();
  return base === "" ? null : base;
}

/**
 * `notes` com o marcador, sem perder o que já estava escrito e sem empilhar o
 * marcador a cada rodada (tira o antigo com notasSemMarcador antes de pôr).
 */
export function notasComMarcador(notesAtual: string | null | undefined, competencia: string): string {
  const base = notasSemMarcador(notesAtual);
  const nota = `${MARCADOR_PISO} Nao cobrado: o piso de producao zerou o repasse em ${competencia}.`;
  return base ? `${base}\n${nota}` : nota;
}

/** Foi ESTE código que marcou a linha? (só então a reversão pode tocá-la) */
export function marcadaPeloPiso(d: LinhaDesconto): boolean {
  return (d.notes || "").indexOf(MARCADOR_PISO) >= 0;
}

export interface ResultadoMarcacaoPiso {
  competencia: string;
  dry_run: boolean;
  /** Linhas que passaram a WAIVED nesta rodada. */
  marcadas: DescontoNaoAplicado[];
  /** Linhas que voltaram a PENDING porque o piso não as alcança mais. */
  revertidas: Array<{ desconto_id: string; promoter_id: string; valor: number }>;
  /** Já estavam corretas — a rodada foi idempotente. */
  ja_corretas: number;
  total_nao_cobrado: number;
}

interface SupabaseLike {
  from: (t: string) => any;
}

/**
 * Marca/desmarca as parcelas de UMA competência. IDEMPOTENTE e REVERSÍVEL.
 *
 * Reversível importa: se a competência for reconsolidada e o promotor deixar de
 * bater no piso, a parcela volta a PENDING — e volta SÓ se o marcador disser que
 * fomos nós que a mexemos. Um WAIVED posto por uma pessoa não é tocado.
 *
 * Escreve APENAS `status` e `notes`. Não toca `amount`, `year`, `month` nem
 * `installment_number`: nenhum centavo muda de lugar aqui.
 */
export async function marcarDescontosNaoAplicadosPorPiso(
  supabase: SupabaseLike,
  params: { year: number; month: number; dryRun?: boolean }
): Promise<ResultadoMarcacaoPiso> {
  const { year, month } = params;
  const dryRun = params.dryRun === true;
  const competencia = comp(year, month);

  const { data: pmr, error: ePmr } = await supabase
    .from("promoter_monthly_results")
    .select("promoter_id, year, month, piso_zerou")
    .eq("year", year)
    .eq("month", month);
  if (ePmr) throw new Error(`PMR ${competencia}: ${ePmr.message}`);

  const { data: descontos, error: eDesc } = await supabase
    .from("promoter_discounts")
    .select("id, promoter_id, year, month, amount, apply_to_company, status, notes, discount_type")
    .eq("year", year)
    .eq("month", month);
  if (eDesc) throw new Error(`promoter_discounts ${competencia}: ${eDesc.message}`);

  const lista: LinhaDesconto[] = descontos || [];
  const alvos = descontosNaoAplicadosPorPiso((pmr || []) as LinhaPmrPiso[], lista);
  const idsAlvo = new Set(alvos.map((a) => a.desconto_id));
  const porId = new Map(lista.map((d) => [d.id, d]));

  const marcadas: DescontoNaoAplicado[] = [];
  let jaCorretas = 0;
  for (const a of alvos) {
    const atual = porId.get(a.desconto_id);
    if (atual && atual.status === STATUS_NAO_APLICADO_PISO && marcadaPeloPiso(atual)) {
      jaCorretas++;
      continue;
    }
    marcadas.push(a);
    if (dryRun) continue;
    const { error } = await supabase
      .from("promoter_discounts")
      .update({
        status: STATUS_NAO_APLICADO_PISO,
        notes: notasComMarcador(atual?.notes ?? null, a.competencia),
      })
      .eq("id", a.desconto_id);
    if (error) throw new Error(`marcar desconto ${a.desconto_id}: ${error.message}`);
  }

  const revertidas: Array<{ desconto_id: string; promoter_id: string; valor: number }> = [];
  for (const d of lista) {
    if (idsAlvo.has(d.id)) continue;
    if (!marcadaPeloPiso(d)) continue; // waiver humano: não é nosso, não mexe
    revertidas.push({ desconto_id: d.id, promoter_id: d.promoter_id, valor: num(d.amount) });
    if (dryRun) continue;
    const { error } = await supabase
      .from("promoter_discounts")
      .update({ status: "PENDING", notes: notasSemMarcador(d.notes) })
      .eq("id", d.id);
    if (error) throw new Error(`reverter desconto ${d.id}: ${error.message}`);
  }

  return {
    competencia,
    dry_run: dryRun,
    marcadas,
    revertidas,
    ja_corretas: jaCorretas,
    total_nao_cobrado: alvos.reduce((s, a) => s + a.valor, 0),
  };
}
