import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * REMUNERACAO DE LIDERANCA — FONTE UNICA DO CALCULO.
 *
 * Substitui a constante em codigo (lib/comissaoGestao.ts:27,
 * `export const PERCENTUAL_COMISSAO_GESTAO = 0.001`) por uma regua VERSIONADA
 * POR VIGENCIA, lida de leadership_rule_versions. A regra passa a ser DADO.
 *
 * DUAS REGUAS (seed em supabase/migrations/20260801_000001):
 *
 *   ate 2026-07   base PRODUCAO_LIQUIDA
 *     supervisor 0,10% / gerente_regional 0,10%, piso 0.
 *     Reproduz exatamente o que o codigo aplica hoje.
 *
 *   de 2026-08    base AVISTA_CREDITO_PF
 *     supervisor 2,50% + piso 0,07% / gerente_regional 3,50% + piso 0,10%.
 *     Pagamento = MAIOR entre (aliquota x comissao a vista) e
 *                             (piso x producao liquida).
 *
 * UMA FORMULA SO. O `base_calculo` decide o que a ALIQUOTA multiplica; o PISO
 * multiplica sempre a producao liquida. Com piso 0 (regua antiga) o max() cai
 * sempre no termo da aliquota, entao a regua antiga e um caso particular da
 * nova — nao ha dois caminhos de codigo.
 *
 * NINGUEM RECALCULA ISTO INLINE. Se aparecer um `* 0.001`, `* 0.025` ou
 * `* 0.035` em tela, rota ou script, e bug: chame calcularRemuneracaoLideranca.
 *
 * O QUE ESTE MODULO NAO FAZ:
 *   - nao soma producao nem comissao. A base ENTRA pronta, de quem ja somou;
 *   - nao decide QUEM esta na rede (isso e da vw_team_production / RLS);
 *   - nao tem nada a ver com repasse de PROMOTOR.
 */

export type CargoLideranca = "supervisor" | "gerente_regional";

/** Qual base a ALIQUOTA multiplica. O piso multiplica sempre a producao liquida. */
export type BaseCalculo = "PRODUCAO_LIQUIDA" | "AVISTA_CREDITO_PF";

/** Qual dos dois termos prevaleceu no max(). */
export type CriterioLideranca = "aliquota" | "piso";

export type ReguaLideranca = {
  cargo: CargoLideranca;
  aliquota: number;
  piso: number;
  base_calculo: BaseCalculo;
  /** 'YYYY-MM-01' */
  competencia_inicio: string;
  /** 'YYYY-MM-01' ou null (vigente ate segunda ordem) */
  competencia_fim: string | null;
  desconta_cancelamento_seguro: boolean;
};

/**
 * A base ja somada da rede, na competencia.
 *
 * `comissao_avista` = comissao da EMPRESA (monthly_closing_entries.commission_value)
 * das linhas CASH + INSURANCE na aba a vista, excluindo contratos com SRCC
 * restrita. Decisao Diego 01/08/2026: e a comissao da empresa, nao o repasse do
 * promotor.
 *
 * `producao_liquida` = net_value das MESMAS linhas.
 *
 * NAO inclui PRT, consorcio, bonus de credito (CREDIT), debito nem conta
 * corrente. Cancelamento de seguro nao entra: ver `desconta_cancelamento_seguro`.
 */
export type BaseLideranca = {
  comissao_avista: number;
  producao_liquida: number;
};

export type ResultadoLideranca = {
  cargo: CargoLideranca;
  /** 'YYYY-MM' */
  competencia: string;
  regua: ReguaLideranca;
  base: BaseLideranca;
  /** aliquota x (comissao a vista OU producao liquida, conforme base_calculo) */
  valor_aliquota: number;
  /** piso x producao liquida */
  valor_piso: number;
  /** o maior dos dois */
  valor: number;
  criterio: CriterioLideranca;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 'YYYY-MM' -> 'YYYY-MM-01', para comparar com as colunas date da tabela. */
export function competenciaParaData(competencia: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(competencia);
  if (!m) throw new Error(`competencia invalida: ${competencia} (esperado YYYY-MM)`);
  return `${m[1]}-${m[2]}-01`;
}

/**
 * APLICA a regua sobre uma base JA SOMADA. Pura: sem banco, sem I/O.
 *
 * O empate (valor_aliquota === valor_piso) resolve para "aliquota". E o caso
 * degenerado da regua antiga, onde o piso e 0 e a comissao tambem pode ser 0 —
 * chamar de "piso" ali seria mentir sobre qual regra pagou.
 */
export function calcularRemuneracaoLideranca(
  regua: ReguaLideranca,
  base: BaseLideranca,
  competencia: string,
): ResultadoLideranca {
  const comissao = num(base.comissao_avista);
  const liquido = num(base.producao_liquida);

  const baseDaAliquota = regua.base_calculo === "AVISTA_CREDITO_PF" ? comissao : liquido;

  const valorAliquota = round2(baseDaAliquota * regua.aliquota);
  const valorPiso = round2(liquido * regua.piso);

  const criterio: CriterioLideranca = valorPiso > valorAliquota ? "piso" : "aliquota";

  return {
    cargo: regua.cargo,
    competencia,
    regua,
    base: { comissao_avista: round2(comissao), producao_liquida: round2(liquido) },
    valor_aliquota: valorAliquota,
    valor_piso: valorPiso,
    valor: criterio === "piso" ? valorPiso : valorAliquota,
    criterio,
  };
}

type LinhaRegua = {
  cargo: string;
  aliquota: number | string;
  piso: number | string;
  base_calculo: string;
  competencia_inicio: string;
  competencia_fim: string | null;
  desconta_cancelamento_seguro: boolean;
};

function paraRegua(l: LinhaRegua): ReguaLideranca {
  return {
    cargo: l.cargo as CargoLideranca,
    aliquota: num(l.aliquota),
    piso: num(l.piso),
    base_calculo: l.base_calculo as BaseCalculo,
    competencia_inicio: String(l.competencia_inicio).slice(0, 10),
    competencia_fim: l.competencia_fim ? String(l.competencia_fim).slice(0, 10) : null,
    desconta_cancelamento_seguro: Boolean(l.desconta_cancelamento_seguro),
  };
}

/**
 * Resolve a regua vigente de um cargo numa competencia.
 *
 * Vigencia por COMPETENCIA, nao por data-calendario: a regra vale para o mes
 * inteiro. fim NULO = vigente ate segunda ordem.
 *
 * Lanca se nao houver regua. Silenciar com um default seria pagar por um numero
 * que ninguem versionou — o oposto do motivo desta tabela existir.
 */
export async function resolverReguaLideranca(
  supabase: SupabaseClient,
  cargo: CargoLideranca,
  competencia: string,
): Promise<ReguaLideranca> {
  const dia = competenciaParaData(competencia);

  const { data, error } = await supabase
    .from("leadership_rule_versions")
    .select(
      "cargo, aliquota, piso, base_calculo, competencia_inicio, competencia_fim, desconta_cancelamento_seguro",
    )
    .eq("cargo", cargo)
    .lte("competencia_inicio", dia)
    .order("competencia_inicio", { ascending: false });

  if (error) throw new Error(`leadership_rule_versions: ${error.message}`);

  const vigente = (data ?? []).find(
    (l) => !l.competencia_fim || String(l.competencia_fim).slice(0, 10) >= dia,
  );

  if (!vigente) {
    throw new Error(
      `Sem regua de lideranca para ${cargo} em ${competencia}. ` +
        `Verifique leadership_rule_versions (seed em 20260801_000001).`,
    );
  }
  return paraRegua(vigente as LinhaRegua);
}

/** Atalho: resolve a regua e aplica sobre a base. */
export async function remuneracaoLideranca(
  supabase: SupabaseClient,
  cargo: CargoLideranca,
  competencia: string,
  base: BaseLideranca,
): Promise<ResultadoLideranca> {
  const regua = await resolverReguaLideranca(supabase, cargo, competencia);
  return calcularRemuneracaoLideranca(regua, base, competencia);
}

// ============================================================
// TRAVA DE COMPETENCIA CONGELADA
// ============================================================

/**
 * Impede que uma alteracao de regua alcance competencia JA FECHADA.
 *
 * POR QUE NA APLICACAO E NAO EM TRIGGER: "fechada" nao e um booleano no banco.
 * O regime da competencia e resolvido por detectMonthRegime (lib/cmsMonthly),
 * que olha a presenca de fechamento/cms. Um trigger SQL teria de duplicar essa
 * regra e as duas versoes divergiriam — o mesmo erro que a copia do ritmo
 * causou entre /equipe e /projecao.
 *
 * REGRA: uma regua so pode ser criada ou alterada se a vigencia dela comecar em
 * competencia ABERTA. Escrever uma regua que retroage sobre mes fechado
 * reescreveria pagamento ja apurado.
 *
 * @param competenciasFechadas competencias em regime != 'open', formato 'YYYY-MM'.
 *        Quem chama resolve (detectMonthRegime) e passa — este modulo nao le banco
 *        para isso, pelo mesmo motivo que nao soma producao.
 */
export function assertReguaNaoAlcancaFechado(
  regua: Pick<ReguaLideranca, "cargo" | "competencia_inicio" | "competencia_fim">,
  competenciasFechadas: readonly string[],
): void {
  const inicio = String(regua.competencia_inicio).slice(0, 7);
  const fim = regua.competencia_fim ? String(regua.competencia_fim).slice(0, 7) : null;

  const alcancadas = competenciasFechadas
    .map((c) => String(c).slice(0, 7))
    .filter((c) => c >= inicio && (fim === null || c <= fim))
    .sort();

  if (alcancadas.length > 0) {
    throw new Error(
      `Regua de ${regua.cargo} com vigencia ${inicio}..${fim ?? "aberta"} alcanca ` +
        `competencia JA FECHADA: ${alcancadas.join(", ")}. ` +
        `Alteracao de regua nunca reescreve competencia fechada — ` +
        `crie uma vigencia nova comecando na primeira competencia aberta.`,
    );
  }
}

// ============================================================
// NORMALIZACAO DA ABA DO FECHAMENTO
// ============================================================

/**
 * Normaliza sheet_name de monthly_closing_entries.
 *
 * NAO E ZELO EXCESSIVO: medido em 01/08/2026, a aba a vista esta gravada como
 * 'A Vista ' — COM ESPACO NO FIM. Comparacao literal com 'A Vista' devolve
 * ZERO linhas de seguro prestamista e a base sai R$ 4.372,62 menor em jun/2026.
 */
export function normalizarAba(sheet: unknown): string {
  return String(sheet ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/** Aba a vista, ja normalizada. */
export const ABA_A_VISTA = "A VISTA";

/**
 * Uma linha de fechamento entra na base AVISTA_CREDITO_PF?
 *
 * ENTRA:  CASH (credito PF a vista) e INSURANCE na aba a vista (prestamista).
 * FICA FORA: PRT, CONSORCIO, CREDIT (bonus), DEBIT, BBCAP, CONTA_CORRENTE, e
 * INSURANCE na aba 'Seguro' (cancelamento — ver a migration).
 */
export function entraNaBaseAvista(entryType: unknown, sheetName: unknown): boolean {
  const t = String(entryType ?? "").trim().toUpperCase();
  if (t === "CASH") return true;
  if (t === "INSURANCE") return normalizarAba(sheetName) === ABA_A_VISTA;
  return false;
}
