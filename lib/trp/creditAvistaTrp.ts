// FRENTE 2 (TRP por PDF) — Etapa 3.4. Camada que resolve o % a vista do credito
// pela TRP plugada no loader (getMatrizTRPParaContrato -> getRegra -> JSON),
// ISOLADA por competencia: por ora SO junho/2026.
//
// Fonte da regra: o JSON ja carregado no loader (regras_promotiva/json +
// MAPA_MES_REGRA), via getMatrizTRPParaContrato. Escolha deliberada (ver Etapa
// 3.4): e a mesma maquinaria que a AUDITORIA usa, entao o que o motor passa a
// pagar em junho = o que a auditoria considera devido (sem segunda fonte/segundo
// caminho). A tabela trp_credit_rules + creditLookup.ts continuam como espelho
// SQL/validacao, nao como fonte do calculo.
//
// Seguranca: fora da vigencia de junho OU sem match, retorna null e o chamador
// MANTEM o comportamento atual (le o % do import diario). Nao mexe em mes
// fechado (cms) nem em meses anteriores.

import { getMatrizTRPParaContrato } from "@/lib/regrasLoader";
import { getPrazoTrp } from "@/lib/prazoTrp";
import { readRawPayloadValue } from "@/lib/proposalDetailing";

// Vigencia de junho/2026 (regra RR holiday-aware): ultimo dia util de maio ->
// penultimo dia util de junho. Cravada nas Etapas 2/3.
export const VIGENCIA_JUNHO_2026 = {
  competencia: "2026-06",
  validFrom: "2026-05-29",
  validUntil: "2026-06-29",
} as const;

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

/** True se a data do contrato cai na janela de vigencia de junho/2026. */
export function dentroVigenciaJunho2026(contractDateISO?: string | null): boolean {
  if (!contractDateISO) return false;
  const d = String(contractDateISO).slice(0, 10);
  return d >= VIGENCIA_JUNHO_2026.validFrom && d <= VIGENCIA_JUNHO_2026.validUntil;
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
}

/**
 * Resolve o % a vista (empresa) pela TRP plugada — SO para contratos de
 * junho/2026. Retorna null fora da vigencia OU quando nao ha match na TRP
 * (nesse caso o chamador mantem o % do import diario).
 */
export function resolveAvistaTrpJunho2026(
  record: TrpAvistaRecord,
): TrpAvistaResultado | null {
  if (!dentroVigenciaJunho2026(record.contract_date)) return null;

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

  const m = getMatrizTRPParaContrato(
    {
      mes: VIGENCIA_JUNHO_2026.competencia,
      produto,
      tipo,
      convenio,
      txJuros,
      prazo,
    },
    "VOLUME_5_FAIXAS",
    FAIXA_GRUPO_RR,
  );
  if (m.pct == null) return null;

  const pctEmpresa = Math.min(m.pct, TETO_EMPRESA_AVISTA);
  return {
    pctEmpresa,
    pctTabela: m.pct,
    capped: m.pct > TETO_EMPRESA_AVISTA,
    categoria: m.categoriaProduto,
    tabLabel: m.tabLabelUsado,
  };
}
