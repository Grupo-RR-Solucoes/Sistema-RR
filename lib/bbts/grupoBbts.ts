// ============================================================================
// Auditoria ADS/BBTS — 1A: roteador CONVÊNIO/OPERAÇÃO -> GRUPO da tabela BBTS.
//
// DECISÃO (simetria com o RR): os códigos de convênio são os MESMOS da Promotiva.
// Então NÃO existe cadastro novo nem de-para inventado: reusamos o roteador que a
// auditoria do RR já usa — inferCreditTable (lib/motor.ts), o mesmo que passou pelo
// fix de zero-padding (normConvenio). Um roteador só serve os dois grupos; aqui
// apenas TRADUZIMOS o tableKey da TRP para o grupo equivalente da tabela BBTS.
//
// PRECEDÊNCIA (nesta ordem):
//   1. BB ENERGIA — produto que só existe na BBTS (a TRP não tem equivalente, logo
//      o roteador da TRP não pode produzi-lo). Reconhecido pela descrição.
//   2. OVERRIDE da régua (regra.convenios) — os convênios que o PDF da BBTS lista
//      como EXCEÇÃO (Bonificado / Reduzidos). Vem da régua VERSIONADA da
//      competência, não de constante no código: se a BBTS mudar a lista, a régua
//      nova muda o roteamento. O override é um MODIFICADOR, não um destino: ele
//      não diz "é Demais Públicos", diz "este convênio é bonificado/reduzido".
//   3. ROTEADOR DA TRP (inferCreditTable) — o caso comum (INSS, SIAPE, SP/MG,
//      Demais Públicos, Privados, Portabilidade, Não Consignado, 13o, FGTS).
//
// O modificador é aplicado SOBRE o grupo-base do roteador: um convênio de SP que
// esteja na lista de Reduzidos vai para GRUPAMENTO_MG_SP_REDUZIDOS, não para
// PUBLICO_DEMAIS_REDUZIDOS. É por isso que o override não pode ser um destino fixo.
// ============================================================================

import { inferCreditTable } from "@/lib/motor";
import { normConvenio } from "@/lib/convenioSegmento";
import type { RegraBbts } from "@/lib/bbts/regraBbts";

/** O que o PDF da BBTS marca como exceção. */
export type ModificadorBbts = "BONIFICADO" | "REDUZIDO";

/** Operação mínima para rotear (subset do que a diária/fechamento da ADS já tem). */
export interface OperacaoBbts {
  convenio_code?: string | number | null;
  convenio_type?: string | null;
  convenio_segment?: string | number | null;
  product_code?: string | number | null;
  product_description?: string | null;
  taxa_juros: number; // decimal (0.0185)
  prazo: number;
}

export interface GrupoResolvido {
  grupo: string;
  /** tableKey da TRP que o roteador reusado devolveu (null quando BB Energia). */
  tableKey: string | null;
  /** modificador aplicado a partir do override da régua (null = caso comum). */
  modificador: ModificadorBbts | null;
  /** avisos (ex.: override sem variante correspondente no grupo-base). */
  motivos: string[];
}

/** tableKey (roteador da TRP) -> grupo BASE da tabela BBTS. */
const TABLEKEY_TO_GRUPO: Record<string, string> = {
  INSS_NOVO: "INSS_NOVO",
  INSS_RENOVACAO: "INSS_RENOV",
  SIAPE: "SIAPE",
  SP_MG: "GRUPAMENTO_MG_SP",
  PUBLICO_GERAL: "PUBLICO_DEMAIS",
  PRIVADO: "PRIVADO",
  PORTABILIDADE_PUBLICO: "PORTAB_PUBLICO",
  PORTABILIDADE_PRIVADO: "PORTAB_PRIVADO",
  AUTOMATICO_SALARIO_BENEFICIO: "NAO_CONSIGNADO",
  ADIANTAMENTO_13: "NAO_CONSIGNADO_13",
  FGTS: "CDC_FGTS",
};

/** grupo-base -> variante, por modificador. Ausente = o grupo não tem variante. */
const VARIANTES: Record<ModificadorBbts, Record<string, string>> = {
  BONIFICADO: {
    PUBLICO_DEMAIS: "PUBLICO_DEMAIS_BONIFICADO",
  },
  REDUZIDO: {
    PUBLICO_DEMAIS: "PUBLICO_DEMAIS_REDUZIDOS",
    GRUPAMENTO_MG_SP: "GRUPAMENTO_MG_SP_REDUZIDOS",
  },
};

/** Deriva o modificador a partir do grupo que o parser leu na lista do PDF. */
function modificadorDoOverride(grupoDoPdf: string): ModificadorBbts | null {
  if (grupoDoPdf.endsWith("_BONIFICADO")) return "BONIFICADO";
  if (grupoDoPdf.endsWith("_REDUZIDOS")) return "REDUZIDO";
  return null;
}

/**
 * Roteia uma operação da ADS para o grupo da tabela BBTS da competência.
 *
 * @param regra régua BBTS ativa (traz os overrides do PDF em regra.convenios).
 */
export function resolverGrupoBbts(op: OperacaoBbts, regra: RegraBbts): GrupoResolvido {
  const motivos: string[] = [];
  const desc = String(op.product_description ?? "").toUpperCase();

  // 1) BB Energia: produto exclusivo da BBTS — a TRP não tem tableKey para ele.
  if (desc.includes("ENERGIA")) {
    return { grupo: "BB_ENERGIA", tableKey: null, modificador: null, motivos };
  }

  // 3) roteador da TRP (o mesmo da auditoria do RR). Os campos de valor não
  //    influenciam o roteamento — só produto/convênio/segmento.
  const tableKey = inferCreditTable({
    valor_liquido: 0,
    valor_bruto: 0,
    valor_seguro: 0,
    tem_seguro: false,
    taxa_juros: op.taxa_juros,
    prazo: op.prazo,
    product_code: op.product_code ?? null,
    product_description: op.product_description ?? null,
    convenio_code: op.convenio_code ?? null,
    convenio_type: op.convenio_type ?? null,
    convenio_segment: op.convenio_segment ?? null,
  });

  const base = TABLEKEY_TO_GRUPO[tableKey];
  if (!base) {
    motivos.push(`tableKey '${tableKey}' sem grupo correspondente na tabela BBTS`);
    return { grupo: "", tableKey, modificador: null, motivos };
  }

  // 2) override da régua (exceções listadas no PDF da competência).
  const code = normConvenio(op.convenio_code);
  const override = code ? regra.convenios?.[code] : undefined;
  const modificador = override ? modificadorDoOverride(override.grupo) : null;

  if (!modificador) {
    return { grupo: base, tableKey, modificador: null, motivos };
  }

  const variante = VARIANTES[modificador][base];
  if (!variante) {
    // O PDF marca o convênio como exceção, mas o grupo-base não tem essa variante
    // (ex.: um Privado listado como bonificado). NÃO inventa: fica no base e avisa.
    motivos.push(
      `convenio ${code} listado como ${modificador} no PDF, mas o grupo ${base} nao tem essa variante — usando ${base}`,
    );
    return { grupo: base, tableKey, modificador, motivos };
  }

  return { grupo: variante, tableKey, modificador, motivos };
}
