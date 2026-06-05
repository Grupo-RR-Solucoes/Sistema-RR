import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// ETAPA 6 — Monitor de FAIXA do Simples Nacional (Anexo III) por RBT12.
// LEITURA PURA: nao grava nada, nao precisa de migration.
//
// RBT12 (por CNPJ) = soma da RECEITA RECEBIDA dos ultimos 12 meses.
// Receita recebida no mes = total da aba RESUMO do fechamento (comissao
// recebida da Promotiva, com bonus e descontos). Hoje isso esta consolidado
// em fechamento_mensal_empresa (por empresa_cnpj/ano/mes).
//
// IMPORTANTE — historico sob placeholders TEMP: os 4 CNPJs reais so tem
// abr/mai-2026 sob o CNPJ real; o historico (ate 2022) esta em
// fechamento_mensal_empresa sob empresa_cnpj = 'TEMP-{mci}-{coban}'. Aqui
// unimos real + TEMP em tempo de consulta (via company_identifiers), SEM
// mexer nos TEMP (o motor de auditoria historica depende deles).
// ============================================================

// ---- Faixas do Anexo III (RBT12 -> aliquota nominal) ----
export type Faixa = {
  faixa: number;
  // limites inferior (exclusivo) e superior (inclusivo) da faixa
  de: number;
  ate: number;
  aliquota: number; // decimal (0.06 = 6%)
};

export const ANEXO_III_FAIXAS: Faixa[] = [
  { faixa: 1, de: 0, ate: 180000, aliquota: 0.06 },
  { faixa: 2, de: 180000, ate: 360000, aliquota: 0.112 },
  { faixa: 3, de: 360000, ate: 720000, aliquota: 0.135 },
  { faixa: 4, de: 720000, ate: 1800000, aliquota: 0.16 },
  { faixa: 5, de: 1800000, ate: 3600000, aliquota: 0.21 },
  { faixa: 6, de: 3600000, ate: 4800000, aliquota: 0.33 },
];

const TETO_SIMPLES = 4800000;

// Limite GLOBAL de permanencia no Simples Nacional (receita bruta anual).
// O Simples e apurado POR CNPJ (cada um na faixa dele); NAO existe "faixa do
// grupo". Este limite serve so p/ monitorar se a receita SOMADA do grupo
// economico se aproxima do teto que exclui do regime — nao e base de DAS.
export const LIMITE_SIMPLES_GRUPO = 4800000;

export type FaixaResolvida =
  | { faixa: number; de: number; ate: number; aliquota: number; acimaSimples: false }
  | { faixa: null; de: number; ate: null; aliquota: null; acimaSimples: true };

export function faixaDoRbt12(rbt12: number): FaixaResolvida {
  const v = Number(rbt12) || 0;
  if (v > TETO_SIMPLES) {
    return { faixa: null, de: TETO_SIMPLES, ate: null, aliquota: null, acimaSimples: true };
  }
  const f = ANEXO_III_FAIXAS.find((x) => v <= x.ate) || ANEXO_III_FAIXAS[ANEXO_III_FAIXAS.length - 1];
  return { faixa: f.faixa, de: f.de, ate: f.ate, aliquota: f.aliquota, acimaSimples: false };
}

// ---- Recorte da RECEITA do mes (PONTO 1 — pendente confirmacao de Diego) ----
// Provisoriamente: valor_liquido = avista(+CREDITO) + diferido + seguro
//   - estorno(CANCELAMENTO SEGURO) - renovacao(DEBITO).
// Bonus = CREDITO (entra somando no avista); desconto = DEBITO (entra
// subtraindo via renovacao) — ja embutidos em valor_liquido.
// Se o "total" da aba Resumo for outro recorte (ex.: nao subtrair
// estorno/renovacao), trocar SO esta funcao.
export type FechamentoRow = {
  empresa_cnpj: string;
  ano: number;
  mes: number;
  valor_liquido: number | string | null;
  valor_nota_fiscal?: number | string | null;
  valor_avista?: number | string | null;
  valor_diferido?: number | string | null;
  valor_seguro?: number | string | null;
  valor_estorno?: number | string | null;
  valor_renovacao?: number | string | null;
};

// Receita do FECHAMENTO no mes (parte vinda da Promotiva).
// Prefere o "Valor Nota Fiscal" da aba Resumo (total exato, soma TODAS as
// linhas de comissao), gravado a partir de jun/2026 pelo importador corrigido
// (coluna valor_nota_fiscal). Historico sem esse campo cai no valor_liquido
// (+ bridge via receita_lancamento_manual p/ as linhas que faltam: Conta
// Corrente/BrasilCap/Dental/Consorcio/LOB Vem/Portabilidade INSS).
export function receitaFechamentoDoMes(row: FechamentoRow): number {
  const vnf = Number(row.valor_nota_fiscal);
  if (Number.isFinite(vnf) && vnf > 0) return vnf;
  return Number(row.valor_liquido) || 0;
}

// ---- Janela movel de 12 meses terminando em (ano, mes) ----
export type Competencia = { ano: number; mes: number; key: string };

function compKey(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export function janelaMeses(ano: number, mes: number, n = 12): Competencia[] {
  const out: Competencia[] = [];
  let y = ano;
  let m = mes;
  for (let i = 0; i < n; i++) {
    out.push({ ano: y, mes: m, key: compKey(y, m) });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}

// ---- Resultado por empresa + grupo ----
export type Rbt12Empresa = {
  company_id: string;
  cnpj: string;
  name: string;
  group_code: string | null;
  rbt12: number;
  faixa: number | null;
  aliquota: number | null; // decimal ou null (acima do Simples)
  acimaSimples: boolean;
  tetoFaixaAtual: number | null;
  faltaProxima: number; // R$ que falta p/ estourar a faixa atual (0 se acima)
  pctFaltaTeto: number; // faltaProxima / teto (1 se acima)
  sinal: "verde" | "amarelo" | "acima";
  mesesEsperados: number;
  mesesPresentes: number;
  janelaParcial: boolean;
  mesesFaltando: string[];
  // serie mensal usada (auditoria/exibicao): receita = fechamento + manual
  serie: Array<{
    competencia: string;
    fechamento: number;
    manual: number;
    total: number;
    fonteFechamento: "real" | "temp" | null;
  }>;
  // totais por fonte (p/ o card mostrar o detalhamento)
  totalFechamento: number;
  totalManual: number;
};

// Grupo: NAO tem faixa tributaria. Monitora a proximidade do LIMITE de
// permanencia no Simples (R$ 4,8 MM/ano da receita somada do grupo).
export type Rbt12Grupo = {
  rbt12: number;
  limiteSimples: number; // 4_800_000
  pctLimite: number; // rbt12 / limiteSimples
  faltaLimite: number; // max(0, limite - rbt12)
  sinal: "verde" | "amarelo" | "vermelho";
};

export type Rbt12Resultado = {
  // competencia FISCAL (mes do RECEBIMENTO). Simples e regime de caixa.
  referencia: Competencia;
  // mes de PRODUCAO correspondente (= fiscal - 1), so p/ exibir e nao
  // confundir com o dashboard (que e por producao).
  referenciaProducao: Competencia;
  competenciaTipo: "FISCAL";
  janela: { de: string; ate: string; meses: number };
  amareloThreshold: number;
  empresas: Rbt12Empresa[];
  grupo: Rbt12Grupo;
};

function parseTempMciCoban(cnpj: string): { mci: string; coban: string } | null {
  const m = String(cnpj || "").match(/TEMP-(\d+)-(\d+)/i);
  return m ? { mci: m[1], coban: m[2] } : null;
}

// Desloca (ano, mes) por delta meses. Usado p/ o shift fiscal (+1) do
// fechamento: producao do mes M e RECEBIDA (competencia fiscal) no mes M+1.
function shiftMonth(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  const idx = ano * 12 + (mes - 1) + delta;
  return { ano: Math.floor(idx / 12), mes: (idx % 12) + 1 };
}

/**
 * Calcula o RBT12 por CNPJ (e do grupo) na competencia de referencia.
 * Leitura pura: le companies, company_identifiers e fechamento_mensal_empresa.
 *
 * opts:
 *   ano/mes          -> competencia FISCAL de referencia (recebimento).
 *                       default junho/2026 (= producao de maio/2026, ultimo arquivo)
 *   janelaMeses      -> tamanho da janela (default 12)
 *   amareloThreshold -> sinaliza AMARELO quando faltaProxima < threshold*teto (default 0.10)
 *
 * SHIFT FISCAL: o fechamento e datado por PRODUCAO (mes do arquivo). O Simples
 * conta o mes do RECEBIMENTO, entao cada linha de fechamento entra na
 * competencia fiscal = producao + 1. Lancamentos manuais ja sao informados em
 * competencia fiscal (sem shift). Apenas o RBT12 aplica esse shift; o dado
 * armazenado e as demais telas (dashboard/fechamento/financeiro) continuam por
 * producao, inalterados.
 */
export async function calcularRbt12(
  supabase: SupabaseClient,
  opts: { ano?: number; mes?: number; janelaMeses?: number; amareloThreshold?: number } = {}
): Promise<Rbt12Resultado> {
  const ano = opts.ano ?? 2026;
  const mes = opts.mes ?? 6;
  const nMeses = opts.janelaMeses ?? 12;
  const amareloThreshold = opts.amareloThreshold ?? 0.1;

  const [companiesRes, identsRes] = await Promise.all([
    supabase.from("companies").select("id, cnpj, name, group_code"),
    supabase.from("company_identifiers").select("company_id, mci, coban_code"),
  ]);
  if (companiesRes.error) throw companiesRes.error;
  if (identsRes.error) throw identsRes.error;

  // Fechamento: tolerante a valor_nota_fiscal ainda nao existir (pre-migration).
  const FME_BASE =
    "empresa_cnpj, ano, mes, valor_liquido, valor_avista, valor_diferido, valor_seguro, valor_estorno, valor_renovacao";
  let fmeRes = await supabase
    .from("fechamento_mensal_empresa")
    .select(`${FME_BASE}, valor_nota_fiscal`);
  if (fmeRes.error) {
    fmeRes = await supabase.from("fechamento_mensal_empresa").select(FME_BASE);
  }
  if (fmeRes.error) throw fmeRes.error;

  // Lancamentos manuais de receita (ADITIVO). Tolerante: se a tabela ainda
  // nao foi criada (migration nao aplicada), trata como vazio.
  // Sao informados ja em competencia FISCAL (recebimento) -> SEM shift.
  const manual = new Map<string, Map<string, number>>(); // company_id -> key -> soma
  try {
    const manualRes = await supabase
      .from("receita_lancamento_manual")
      .select("company_id, ano, mes, valor");
    if (!manualRes.error) {
      for (const m of (manualRes.data || []) as Array<{
        company_id: string;
        ano: number;
        mes: number;
        valor: number | string;
      }>) {
        const key = compKey(m.ano, m.mes);
        const mm = manual.get(m.company_id) ?? new Map();
        mm.set(key, (mm.get(key) ?? 0) + (Number(m.valor) || 0));
        manual.set(m.company_id, mm);
      }
    }
  } catch {
    /* tabela ausente — segue so com o fechamento */
  }

  const companies = (companiesRes.data || []) as Array<{
    id: string;
    cnpj: string;
    name: string;
    group_code: string | null;
  }>;
  const byCnpj = new Map(companies.map((c) => [c.cnpj, c]));
  const byId = new Map(companies.map((c) => [c.id, c]));
  // TEMP-{mci}-{coban} -> company_id
  const tempToCompany = new Map(
    (identsRes.data || []).map((r: any) => [`${r.mci}-${r.coban_code}`, r.company_id as string])
  );

  function resolveCompanyId(empresaCnpj: string): string | null {
    const real = byCnpj.get(empresaCnpj);
    if (real) return real.id;
    const t = parseTempMciCoban(empresaCnpj);
    if (t) return tempToCompany.get(`${t.mci}-${t.coban}`) ?? null;
    return null;
  }

  // company_id -> Map(YYYY-MM fiscal -> {valor, fonte}); real sobrescreve temp.
  // SHIFT FISCAL: produção (row.ano/mes) -> competência fiscal = +1 mês.
  const receita = new Map<string, Map<string, { valor: number; fonte: "real" | "temp" }>>();
  for (const row of (fmeRes.data || []) as FechamentoRow[]) {
    const companyId = resolveCompanyId(row.empresa_cnpj);
    if (!companyId) continue;
    const fiscal = shiftMonth(row.ano, row.mes, 1);
    const key = compKey(fiscal.ano, fiscal.mes);
    const isReal = byCnpj.has(row.empresa_cnpj);
    const mm = receita.get(companyId) ?? new Map();
    const prev = mm.get(key);
    if (!prev || (isReal && prev.fonte !== "real")) {
      mm.set(key, { valor: receitaFechamentoDoMes(row), fonte: isReal ? "real" : "temp" });
    }
    receita.set(companyId, mm);
  }

  const janela = janelaMeses(ano, mes, nMeses);

  // Empresas reais (exclui placeholders TEMP da listagem).
  const reais = companies
    .filter((c) => !String(c.cnpj).startsWith("TEMP-"))
    .sort(
      (a, b) =>
        String(a.group_code || "").localeCompare(String(b.group_code || "")) ||
        a.name.localeCompare(b.name, "pt-BR")
    );

  const empresas: Rbt12Empresa[] = reais.map((c) => {
    const fm = receita.get(c.id) ?? new Map();
    const mm = manual.get(c.id) ?? new Map();
    // Mes "presente" = tem fechamento OU lancamento manual (assim o contador
    // pode completar meses sem fechamento, ex.: AL3 jun-ago/2025).
    const serie = janela
      .filter((j) => fm.has(j.key) || mm.has(j.key))
      .map((j) => {
        const fech = fm.get(j.key)?.valor ?? 0;
        const man = mm.get(j.key) ?? 0;
        return {
          competencia: j.key,
          fechamento: fech,
          manual: man,
          total: fech + man,
          fonteFechamento: (fm.get(j.key)?.fonte ?? null) as "real" | "temp" | null,
        };
      });
    const rbt12 = serie.reduce((s, x) => s + x.total, 0);
    const totalFechamento = serie.reduce((s, x) => s + x.fechamento, 0);
    const totalManual = serie.reduce((s, x) => s + x.manual, 0);
    const f = faixaDoRbt12(rbt12);
    const teto = f.acimaSimples ? null : f.ate;
    const falta = teto == null ? 0 : Math.max(0, teto - rbt12);
    const pctFaltaTeto = teto == null || teto === 0 ? 1 : falta / teto;
    const sinal: "verde" | "amarelo" | "acima" = f.acimaSimples
      ? "acima"
      : pctFaltaTeto < amareloThreshold
      ? "amarelo"
      : "verde";
    const mesesFaltando = janela
      .filter((j) => !fm.has(j.key) && !mm.has(j.key))
      .map((j) => j.key);
    return {
      company_id: c.id,
      cnpj: c.cnpj,
      name: c.name,
      group_code: c.group_code,
      rbt12,
      faixa: f.faixa,
      aliquota: f.aliquota,
      acimaSimples: f.acimaSimples,
      tetoFaixaAtual: teto,
      faltaProxima: falta,
      pctFaltaTeto,
      sinal,
      mesesEsperados: nMeses,
      mesesPresentes: serie.length,
      janelaParcial: serie.length < nMeses,
      mesesFaltando,
      serie,
      totalFechamento,
      totalManual,
    };
  });

  // Grupo economico: o Simples e apurado POR CNPJ (cada um na faixa dele);
  // NAO ha "faixa do grupo". Aqui so monitoramos a proximidade do LIMITE
  // GLOBAL de permanencia (R$ 4,8 MM/ano da receita somada do grupo).
  // Estourar exclui o grupo do regime; nao e base de calculo do DAS.
  const grupoRbt = empresas.reduce((s, e) => s + e.rbt12, 0);
  const pctLimite = LIMITE_SIMPLES_GRUPO > 0 ? grupoRbt / LIMITE_SIMPLES_GRUPO : 0;
  const grupoSinal: "verde" | "amarelo" | "vermelho" =
    pctLimite >= 1 ? "vermelho" : pctLimite >= 0.9 ? "amarelo" : "verde";
  const grupo: Rbt12Grupo = {
    rbt12: grupoRbt,
    limiteSimples: LIMITE_SIMPLES_GRUPO,
    pctLimite,
    faltaLimite: Math.max(0, LIMITE_SIMPLES_GRUPO - grupoRbt),
    sinal: grupoSinal,
  };

  const prod = shiftMonth(ano, mes, -1); // producao correspondente a ref fiscal
  return {
    referencia: { ano, mes, key: compKey(ano, mes) },
    referenciaProducao: { ano: prod.ano, mes: prod.mes, key: compKey(prod.ano, prod.mes) },
    competenciaTipo: "FISCAL",
    janela: { de: janela[0].key, ate: janela[janela.length - 1].key, meses: nMeses },
    amareloThreshold,
    empresas,
    grupo,
  };
}
