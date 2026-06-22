import type { SupabaseClient } from "@supabase/supabase-js";

import { calcularRbt12, janelaMeses } from "@/lib/rbt12";

// ============================================================
// MONITOR FISCAL / FATOR R — por CNPJ. LEITURA PURA (não grava).
//
// O Simples é apurado POR CNPJ (cada um na sua faixa; nunca consolidado).
//   - Denominador (RBT12): reusa calcularRbt12 (lib/rbt12) — janela de 12 meses
//     fiscais por CNPJ (fechamento + lançamentos manuais).
//   - Alíquota efetiva = (RBT12 × nominal − PD) ÷ RBT12 (Anexo III, LC 123/2006).
//   - Fator R = (folha CLT + FGTS + pró-labore dos 12 meses) ÷ RBT12.
//       ≥ 28% → Anexo III (alíquota menor). < 28% → Anexo V (pior).
//       Semáforo: verde ≥30% · amarelo 28–30% · vermelho <28%.
//     O numerador vem de financial_expenses (entrada manual). Enquanto não há
//     lançamentos de folha, fatorR = null → "aguardando folha" (não quebra).
//   - Teto do Simples: R$ 4,8 MM/ano por CNPJ. Alerta se RBT12 > 80% do teto.
// ============================================================

const TETO_SIMPLES = 4_800_000;
const ALERTA_TETO_PCT = 0.8; // alerta quando RBT12 > 80% do teto
const FATOR_R_MIN_ANEXO_III = 0.28; // < 28% cai pro Anexo V
const VERDE_MIN = 0.30;
const AMARELO_MIN = 0.28;

/** Categorias de financial_expenses que compõem a "folha de salários" do Fator R
 * (massa salarial: salários/folha CLT + pró-labore + encargos FGTS/13º). Casa por
 * NOME (ignora caixa/acento), então funciona mesmo antes de criar Pró-labore/FGTS. */
const NUMERADOR_REGEX = /folha|sal[aá]rio|pr[oó].?labore|fgts|encargo|13/i;

// ---- Anexo III 2026 (LC 123/2006): faixa, teto RBT12, alíquota nominal, PD ----
export interface FaixaAnexoIII {
  faixa: number;
  ate: number;
  nominal: number; // decimal
  pd: number; // parcela a deduzir (R$)
}
export const ANEXO_III_2026: FaixaAnexoIII[] = [
  { faixa: 1, ate: 180_000, nominal: 0.06, pd: 0 },
  { faixa: 2, ate: 360_000, nominal: 0.112, pd: 9_360 },
  { faixa: 3, ate: 720_000, nominal: 0.135, pd: 17_640 },
  { faixa: 4, ate: 1_800_000, nominal: 0.16, pd: 35_640 },
  { faixa: 5, ate: 3_600_000, nominal: 0.21, pd: 125_640 },
  { faixa: 6, ate: 4_800_000, nominal: 0.33, pd: 648_000 },
];

export interface FaixaResolvidaAnexoIII {
  faixa: number | null;
  nominal: number | null;
  pd: number | null;
  /** (RBT12 × nominal − PD) ÷ RBT12. null se acima do teto ou RBT12=0. */
  aliquotaEfetiva: number | null;
  acimaSimples: boolean;
}

export function resolverAnexoIII(rbt12: number): FaixaResolvidaAnexoIII {
  const v = Number(rbt12) || 0;
  if (v > TETO_SIMPLES) {
    return { faixa: null, nominal: null, pd: null, aliquotaEfetiva: null, acimaSimples: true };
  }
  const f = ANEXO_III_2026.find((x) => v <= x.ate) ?? ANEXO_III_2026[ANEXO_III_2026.length - 1];
  const aliquotaEfetiva = v > 0 ? (v * f.nominal - f.pd) / v : null;
  return { faixa: f.faixa, nominal: f.nominal, pd: f.pd, aliquotaEfetiva, acimaSimples: false };
}

export type SemaforoFatorR = "verde" | "amarelo" | "vermelho" | "parcial" | "sem_dados";

export function semaforoFatorR(fatorR: number | null): SemaforoFatorR {
  if (fatorR == null) return "sem_dados";
  if (fatorR >= VERDE_MIN) return "verde";
  if (fatorR >= AMARELO_MIN) return "amarelo";
  return "vermelho";
}

export interface FatorREmpresa {
  company_id: string;
  cnpj: string;
  nome: string;
  rbt12: number;
  faixa: number | null;
  acimaSimples: boolean;
  aliquotaNominal: number | null;
  aliquotaEfetiva: number | null;
  /** Σ folha+FGTS+pró-labore na janela (R$). 0 se não há lançamentos. */
  folha12m: number;
  /** Há ao menos 1 lançamento de folha na janela? (senão fatorR=null). */
  temDadosFolha: boolean;
  /** Nº de meses distintos com folha lançada na janela (0..12). */
  mesesFolha: number;
  /** 1..11 meses lançados: Fator R provisório, NÃO conclusivo (não dispara Anexo V). */
  folhaIncompleta: boolean;
  /** Fator R = folha12m ÷ rbt12. Provisório se folhaIncompleta; null se sem folha. */
  fatorR: number | null;
  semaforo: SemaforoFatorR;
  /** "III"/"V" só CONCLUSIVO com 12 meses; null se incompleta/sem dados/acima. */
  anexoVigente: "III" | "V" | null;
  /** R$ que falta pro teto de 4,8 MM (0 se acima). */
  margemAteTeto: number;
  pctTetoUsado: number; // rbt12 / 4,8MM
  alertaTeto: boolean; // pctTetoUsado > 80%
  /** Janela parcial do RBT12 (menos de 12 meses com dado). */
  janelaParcial: boolean;
}

export interface FatorRResultado {
  referencia: { ano: number; mes: number; key: string };
  janela: { de: string; ate: string; meses: number };
  tetoSimples: number;
  empresas: FatorREmpresa[];
  /** algum CNPJ > 80% do teto. */
  algumAlertaTeto: boolean;
  /** algum CNPJ com Fator R vermelho (<28%). */
  algumFatorRVermelho: boolean;
  /** nº de CNPJs ainda sem dados de folha. */
  semDadosFolha: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Calcula o Fator R / faixa / alíquota efetiva por CNPJ. Reusa calcularRbt12 e
 * soma o numerador (folha+FGTS+pró-labore) de financial_expenses na MESMA janela
 * de 12 meses. Tolerante: financial_expenses vazia → fatorR null por CNPJ.
 */
export async function calcularFatorR(
  supabase: SupabaseClient,
  opts: { ano?: number; mes?: number; janelaMeses?: number } = {},
): Promise<FatorRResultado> {
  const ano = opts.ano ?? 2026;
  const mes = opts.mes ?? 6;
  const nMeses = opts.janelaMeses ?? 12;

  const rbt = await calcularRbt12(supabase, { ano, mes, janelaMeses: nMeses });

  // folha por competência casa com a janela de PRODUÇÃO do RBT12 (fiscal − 1),
  // pra numerador e denominador cobrirem o mesmo período econômico
  const janela = janelaMeses(rbt.referenciaProducao.ano, rbt.referenciaProducao.mes, nMeses);
  const janelaKeys = new Set(janela.map((j) => j.key));

  // categorias do numerador (por nome, robusto a acento/caixa).
  const catRes = await supabase.from("expense_categories").select("id, name");
  const numeradorCatIds = new Set(
    ((catRes.data as Array<{ id: string; name: string }> | null) ?? [])
      .filter((c) => NUMERADOR_REGEX.test(String(c.name ?? "")))
      .map((c) => c.id),
  );

  // financial_expenses do numerador, somado por company_id na janela.
  // Tolerante: tabela vazia / ausente → mapa vazio.
  const folhaByCompany = new Map<string, { soma: number; meses: Set<string> }>();
  if (numeradorCatIds.size > 0) {
    const expRes = await supabase
      .from("financial_expenses")
      .select("company_id, category_id, year, month, amount")
      .in("category_id", Array.from(numeradorCatIds));
    if (!expRes.error) {
      for (const e of (expRes.data as Array<{
        company_id: string | null;
        category_id: string | null;
        year: number;
        month: number;
        amount: number | string | null;
      }> | null) ?? []) {
        if (!e.company_id) continue;
        const key = `${e.year}-${String(e.month).padStart(2, "0")}`;
        if (!janelaKeys.has(key)) continue;
        const acc = folhaByCompany.get(e.company_id) ?? { soma: 0, meses: new Set<string>() };
        acc.soma += Number(e.amount) || 0;
        acc.meses.add(key);
        folhaByCompany.set(e.company_id, acc);
      }
    }
  }

  const empresas: FatorREmpresa[] = rbt.empresas.map((e) => {
    const anexo = resolverAnexoIII(e.rbt12);
    const folha = folhaByCompany.get(e.company_id);
    const folha12m = round2(folha?.soma ?? 0);
    const mesesFolha = folha?.meses.size ?? 0;
    const temDadosFolha = mesesFolha > 0 && (folha?.soma ?? 0) > 0;
    // Fator R só é CONCLUSIVO com a janela cheia de folha. Com 1..11 meses, o
    // ratio fica falsamente baixo (folha parcial ÷ RBT12 de 12m) — NÃO conclui
    // Anexo V. fatorR continua calculado (provisório, para exibir esmaecido).
    const folhaIncompleta = mesesFolha > 0 && mesesFolha < nMeses;
    const fatorR = temDadosFolha && e.rbt12 > 0 ? folha12m / e.rbt12 : null;
    const semaforo: SemaforoFatorR = folhaIncompleta ? "parcial" : semaforoFatorR(fatorR);
    const anexoVigente: "III" | "V" | null =
      anexo.acimaSimples || fatorR == null || folhaIncompleta
        ? null
        : fatorR >= FATOR_R_MIN_ANEXO_III
          ? "III"
          : "V";
    const pctTetoUsado = TETO_SIMPLES > 0 ? e.rbt12 / TETO_SIMPLES : 0;
    return {
      company_id: e.company_id,
      cnpj: e.cnpj,
      nome: e.name,
      rbt12: round2(e.rbt12),
      faixa: anexo.faixa,
      acimaSimples: anexo.acimaSimples,
      aliquotaNominal: anexo.nominal,
      aliquotaEfetiva: anexo.aliquotaEfetiva,
      folha12m,
      temDadosFolha,
      mesesFolha,
      folhaIncompleta,
      fatorR,
      semaforo,
      anexoVigente,
      margemAteTeto: Math.max(0, TETO_SIMPLES - e.rbt12),
      pctTetoUsado,
      alertaTeto: pctTetoUsado > ALERTA_TETO_PCT,
      janelaParcial: e.janelaParcial,
    };
  });

  return {
    referencia: { ano, mes, key: `${ano}-${String(mes).padStart(2, "0")}` },
    // exibe a janela FISCAL do RBT12 (regime de caixa, jul→jun), coerente com o
    // monitor de faixa; a folha é casada internamente pela janela de produção.
    janela: rbt.janela,
    tetoSimples: TETO_SIMPLES,
    empresas,
    algumAlertaTeto: empresas.some((e) => e.alertaTeto),
    algumFatorRVermelho: empresas.some((e) => e.semaforo === "vermelho"),
    semDadosFolha: empresas.filter((e) => !e.temDadosFolha).length,
  };
}
