// Camada que resolve o % a vista do credito pela TRP, GENERICA por competencia
// (F5: o hardcode de junho foi removido). Dois caminhos simetricos:
//   - resolveAvistaTrpJson (TRP_SOURCE=json): regra do JSON canonico (getRegra /
//     MAPA_MES_REGRA), com fallback em cascata para a competencia anterior.
//   - resolveAvistaTrpDb  (TRP_SOURCE=db):   regra do banco (trp_rule_versions),
//     mesmo fallback. Ativo em producao desde F4.
// Ambos usam a MESMA maquinaria (getMatrizTRPParaContrato -> lookupPctInRegra +
// teto 6%) e a MESMA vigencia holiday-aware (competenciaDaData). Vigencia/fallback
// identicos entre as fontes — provado nos gates F3 (db x json) e F5 (json x hardcode).
//
// Fonte da regra: a mesma maquinaria que a AUDITORIA usa (RegraMes -> matriz ->
// lookupPctInRegra). A fonte VIVA e trp_rule_versions (db); o JSON e o fallback
// historico/rollback. A tabela trp_credit_rules (matriz achatada) esta MORTA:
// nenhum codigo le dela hoje — nao usar como referencia.
//
// Seguranca: sem match / competencia sem regra, retorna null e o chamador MANTEM
// o comportamento atual (le o % do import diario). Nao mexe em mes fechado (cms).

import { getMatrizTRPParaContrato, getRegime, getRegra } from "@/lib/regrasLoader";
import type { ContratoAvistaInput } from "@/lib/regrasLoader";
import type { RegraMes } from "@/lib/regrasData";
import { getPrazoTrp } from "@/lib/prazoTrp";
import { readRawPayloadValue } from "@/lib/proposalDetailing";
import { competenciaDaData, parseCompetencia, competenciaKey } from "@/lib/trp/vigencia";

// Grupo RR opera no tier contratual Faixa 3 (confirmado nas TRPs / referencia).
// A faixa por volume so seria usada se Diego decidir variar; aqui fixamos o
// tier confirmado, igual ao que a auditoria assume para o grupo.
const FAIXA_GRUPO_RR = "FAIXA 3";

// Teto a vista que a EMPRESA recebe da Promotiva (TRP doc 201 = 6%). O excedente
// vira diferido/PRT. (O teto do PROMOTOR, 5,80%, e aplicado depois, fora daqui.)
const TETO_EMPRESA_AVISTA = 0.06;

/** Record minimo necessario para resolver a TRP (subset de daily_production_records). */
export interface TrpAvistaRecord {
  product_description?: string | null;
  interest_rate?: number | null;
  term_months?: number | null;
  installments?: number | null;
  contract_date?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

export interface TrpAvistaResultado {
  /** % a vista da empresa, ja com teto de 6% aplicado. Em DECIMAL (0.0448). */
  pctEmpresa: number;
  /** % bruto da tabela TRP, antes do teto (pode passar de 6% -> diferido). */
  pctTabela: number;
  /** true se a tabela estourou o teto e foi limitada a 6%. */
  capped: boolean;
  categoria: string | null;
  tabLabel: string | null;
  /** Competência-alvo resolvida (YYYY-MM). Só o caminho DB preenche. */
  competencia?: string;
  /** Competência que forneceu a regra (== alvo, salvo fallback). Só DB. */
  competenciaFornecedora?: string;
  /** true se a regra veio de competência anterior (fallback). Só DB. */
  isFallback?: boolean;
}

/**
 * Extrai o contrato (produto/tipo/txJuros/prazo/convenio) de um record para
 * lookup na matriz. Retorna null se a taxa ou o prazo forem inválidos. É a
 * MESMA extração usada pelos dois caminhos (JSON e DB, ambos genéricos) — fonte
 * única, para o cálculo ser idêntico entre as fontes (provado nos gates F3/F5).
 */
function extrairContratoAvista(
  record: TrpAvistaRecord,
  competencia: string,
): ContratoAvistaInput | null {
  const produto = record.product_description ?? null;
  const tipo = produto && /RENOV/i.test(produto) ? "RENOVACAO" : "NOVO";
  const txJuros =
    typeof record.interest_rate === "number" ? record.interest_rate : NaN;
  if (!Number.isFinite(txJuros)) return null;

  const prazo = getPrazoTrp(record);
  if (prazo == null || !Number.isFinite(prazo) || prazo <= 0) return null;

  const convenioRaw = readRawPayloadValue(record.raw_payload, [
    "Codigo Convenio", // casa com "Código Convênio" (readRawPayloadValue ignora acento/caixa)
    "Cod Convenio",
    "Convenio",
  ]);
  // O raw_payload traz o convenio com zeros a esquerda ("000001640"); o motor
  // compara cv === "1640" (sem zeros). Normalizamos p/ numero, igual ao que a
  // auditoria recebe — senao INSS (1640)/SIAPE (1078) caem como CONSIG_PUBLICO.
  let convenio: number | string | null = null;
  if (convenioRaw != null && String(convenioRaw).trim() !== "") {
    const n = Number(String(convenioRaw).trim());
    convenio = Number.isFinite(n) && n > 0 ? n : String(convenioRaw).trim();
  }

  return { mes: competencia, produto, tipo, convenio, txJuros, prazo };
}

/**
 * Provedor SÍNCRONO da regra do banco por competência (o preloader da F2:
 * createTrpRegraDbPreloader().getResolvedSync). Injetado pelo orquestrador que
 * já fez o preload async 1x — mantém este resolver síncrono, igual ao JSON.
 */
export type TrpRegraDbProvider = (
  competencia: string,
  /**
   * VIGENCIA INTRA-MES (31/08/2026): data do contrato, para escolher a FATIA
   * quando a competencia tem 2+ reguas ativas. Opcional — provider de 1
   * parametro continua atribuivel a este tipo.
   */
  contractDate?: string | null,
) => {
  regra: RegraMes;
  isFallback: boolean;
  competenciaFornecedora: string;
} | null;

/**
 * Caminho DB (F4, atrás da flag TRP_SOURCE=db) — GENÉRICO por competência, com
 * fallback em cascata. Mesma máquina do caminho JSON (extrairContratoAvista +
 * getMatrizTRPParaContrato + teto 6%); a ÚNICA diferença é a fonte da RegraMes:
 * a regra_json do banco (via provider), injetada como regraOverride.
 *
 * Vigência: a competência-alvo sai de competenciaDaData(contract_date) (janela
 * holiday-aware). Sem TRP própria da competência, o provider devolve a regra da
 * anterior (isFallback=true) — os percentuais do mês anterior aplicados à
 * produção da janela atual (ex.: julho pelos números de junho).
 *
 * Retorna null (chamador mantém comportamento atual) quando: sem contract_date,
 * competência sem regra no provider, extração inválida ou sem match na matriz.
 */
export function resolveAvistaTrpDb(
  record: TrpAvistaRecord,
  provider: TrpRegraDbProvider,
): TrpAvistaResultado | null {
  const cd = record.contract_date ? String(record.contract_date).slice(0, 10) : null;
  if (!cd) return null;

  const competencia = competenciaDaData(cd);
  // A data vai JUNTO: numa competencia PARTIDA, o a-vista tem de cair na mesma
  // fatia que o credito caiu (motor.ts:605/682). Com uma regua so, no-op.
  const resolved = provider(competencia, cd);
  if (!resolved) return null;

  const contrato = extrairContratoAvista(record, competencia);
  if (!contrato) return null;

  const m = getMatrizTRPParaContrato(
    contrato,
    getRegime(competencia),
    FAIXA_GRUPO_RR,
    { regra: resolved.regra, jsonRegra: "db:trp_rule_versions", regraInferida: resolved.isFallback },
  );
  if (m.pct == null) return null;

  const pctEmpresa = Math.min(m.pct, TETO_EMPRESA_AVISTA);
  return {
    pctEmpresa,
    pctTabela: m.pct,
    capped: m.pct > TETO_EMPRESA_AVISTA,
    categoria: m.categoriaProduto,
    tabLabel: m.tabLabelUsado,
    competencia,
    competenciaFornecedora: resolved.competenciaFornecedora,
    isFallback: resolved.isFallback,
  };
}

// ---------------------------------------------------------------------------
// Caminho JSON GENÉRICO (F5) — substitui o hardcode de junho no modo json.
// ---------------------------------------------------------------------------

/** Competência (YYYY-MM) imediatamente anterior. */
function competenciaAnterior(competencia: string): string {
  const { year, month } = parseCompetencia(competencia);
  return competenciaKey(month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
}

/**
 * Resolve a RegraMes do JSON canônico (getRegra/MAPA_MES_REGRA) para a
 * competência-alvo, com FALLBACK em cascata simétrico ao caminho DB: se a
 * competência não tem JSON, cai na competência anterior mais recente que tenha,
 * marcando isFallback. Retorna null se nenhuma competência (até 120 meses atrás)
 * tiver JSON.
 */
function resolveRegraJsonComFallback(competenciaAlvo: string): {
  regra: RegraMes;
  jsonRegra: string;
  competenciaFornecedora: string;
  isFallback: boolean;
} | null {
  let comp = competenciaAlvo;
  for (let i = 0; i < 120; i++) {
    const r = getRegra(comp);
    if (r) {
      return {
        regra: r.regra,
        jsonRegra: r.jsonRegra,
        competenciaFornecedora: comp,
        isFallback: comp !== competenciaAlvo,
      };
    }
    comp = competenciaAnterior(comp);
  }
  return null;
}

/**
 * Caminho JSON GENÉRICO (F5) — modo TRP_SOURCE=json. Mesma máquina do caminho DB
 * (extrairContratoAvista + getMatrizTRPParaContrato + teto 6%), com a MESMA
 * semântica de vigência (competenciaDaData) e de fallback (competência anterior),
 * mas a fonte da RegraMes é o JSON canônico (getRegra), não o banco.
 *
 * Resolução genérica por competência (vigenciaDaCompetencia + getRegra); substituiu
 * o antigo caminho hardcoded de junho: onde antes só junho resolvia, agora QUALQUER
 * competência com JSON resolve — rollback json vira rede de segurança real. Para
 * contratos de junho, produz resultado IDÊNTICO ao caminho anterior (mesmo JSON
 * TRP37, mesma janela 2026-05-29/2026-06-29) — provado no gate F5.
 *
 * Retorna null quando: sem contract_date, nenhuma competência com JSON, extração
 * inválida ou sem match na matriz.
 */
export function resolveAvistaTrpJson(record: TrpAvistaRecord): TrpAvistaResultado | null {
  const cd = record.contract_date ? String(record.contract_date).slice(0, 10) : null;
  if (!cd) return null;

  const competencia = competenciaDaData(cd);
  const resolved = resolveRegraJsonComFallback(competencia);
  if (!resolved) return null;

  const contrato = extrairContratoAvista(record, competencia);
  if (!contrato) return null;

  const m = getMatrizTRPParaContrato(
    contrato,
    getRegime(competencia),
    FAIXA_GRUPO_RR,
    { regra: resolved.regra, jsonRegra: resolved.jsonRegra, regraInferida: resolved.isFallback },
  );
  if (m.pct == null) return null;

  const pctEmpresa = Math.min(m.pct, TETO_EMPRESA_AVISTA);
  return {
    pctEmpresa,
    pctTabela: m.pct,
    capped: m.pct > TETO_EMPRESA_AVISTA,
    categoria: m.categoriaProduto,
    tabLabel: m.tabLabelUsado,
    competencia,
    competenciaFornecedora: resolved.competenciaFornecedora,
    isFallback: resolved.isFallback,
  };
}
