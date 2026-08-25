/**
 * lib/proposalDetailing.ts
 *
 * Helpers compartilhados para extrair detalhamento de propostas
 * (daily_production_records) e derivar campos exibidos na UI.
 *
 * Extraidos de lib/promoterAnalytics.ts na Etapa 4.4-fix-1.B para que
 * /api/commissions/proposals e qualquer outra rota possam consumir
 * os mesmos derivados sem duplicacao.
 *
 * Subset minimo de ProductionRow definido localmente — qualquer caller
 * pode usar `ProposalRecord` ou um tipo proprio compativel.
 */

import {
  capAvistaRRPercent,
  isFaixaTetoAvistaRRPercent,
  type CompetenciaTeto,
} from "./tetoAvistaRR.ts";
// JANELA DE PRODUCAO (regra RR) — helper canonico, a MESMA primitiva sobre a qual
// getProductionPeriodFromValue classifica cada linha. Ver o bloco "3. Volume
// mensal por promotor" para o porque de nao ser mais mes de calendario.
import {
  getProductionPeriodFromValue,
  getProductionWindow,
} from "./productionPeriod.ts";
// Util canonico do convenio ("000001640" -> "1640"). Ver isInssRecord.
import { normConvenio } from "./convenioSegmento.ts";

export type ProposalRecord = {
  raw_payload?: Record<string, unknown> | null;
  is_srcc_restricted?: boolean | null;
  /**
   * CONCLUSAO derivada do fechamento: "SIM" | "NAO" | "NAO_SE_APLICA".
   * null/ausente = nao resolvido. Ver a ordem de precedencia em
   * getSrccRestrictionLabel.
   */
  srcc_resolucao?: string | null;
  installments?: number | null;
  term_months?: number | null;
  gross_value?: number | null;
  company_received_percent?: number | null;
};

// ============================================================
// Dia 4.5 Etapa B — Cascata de % repasse do promotor
// ============================================================
//
// Tipos compartilhados para a resolucao do % repasse a partir do
// perfil cadastrado + escalas + volume mensal + override por
// proposta. Convencao de escala: share_percent_* em DECIMAL (0..1).
// 0.5833 = 58,33% (padrao da casa); 1.0 = 100% (Juliana socia).

export type SharePromoterProfile = {
  promoter_id: string;
  profile_type:
    | "DEFAULT"
    | "CLT_FIXO"
    | "ACORDO_FIXO"
    | "ENTRANTE_PADRAO"
    | "ENTRANTE_CUSTOM"
    | "ACORDO_VARIAVEL";
  fixed_percent: number | null;
  scale_id: string | null;
};

export type ShareScaleTier = {
  volume_min: number;
  volume_max: number | null;
  share_percent: number;
};

export type ShareScaleWithTiers = {
  id: string;
  scale_code: string;
  scale_kind: "CREDIT" | "INSURANCE";
  tiers: ShareScaleTier[];
};

export type ShareResolution = {
  sharePercent: number; // 0..1 decimal
  source: string;
};

// Default operacional RR (58,33% sobre % A VISTA) — replica
// DEFAULT_PROMOTER_SHARE_PERCENT da cascata legada em
// /api/calculate/monthly. Usado como fallback em todos os nos da
// arvore que nao encontram outra regra.
const DEFAULT_SHARE = 0.5833;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Le valor de raw_payload (jsonb da daily_production_records) tentando
 * varios aliases. Returns null se nenhum bate ou se o valor for vazio.
 *
 * Match e case/acento-insensitive — "Prefixo Ag. Responsavel" bate com
 * "PREFIXO AG. RESPONSÁVEL", "prefixo ag. responsavel", etc.
 */
export function readRawPayloadValue(
  payload: Record<string, unknown> | null | undefined,
  aliases: string[]
): unknown {
  if (!payload || typeof payload !== "object") return null;

  const normalizedAliases = aliases.map((alias) => normalizeText(alias));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (normalizedAliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

/**
 * Retorna o codigo/prefixo da agencia bancaria responsavel pela proposta.
 * Tenta varios aliases que aparecem no raw_payload conforme a fonte
 * (Promotiva exporta com encoding/acento variavel).
 */
export function getAgencyCode(record: ProposalRecord): string {
  const raw = readRawPayloadValue(record.raw_payload, [
    "Prefixo Ag. Responsavel",
    "Prefixo Ag. Responsável",
    "Agencia",
    "Agência",
    "Agencia Responsavel",
    "Agência Responsável",
  ]);

  return raw === null || raw === undefined || raw === "" ? "-" : String(raw);
}

/**
 * Retorna label de Restricao SRCC. Preferencia ao valor textual do
 * raw_payload (que pode ter detalhes); fallback para "Sim"/"Nao"
 * derivado do boolean is_srcc_restricted.
 */
/** Mapa da CONCLUSAO gravada -> rotulo exibido. Ver srcc_resolucao. */
const SRCC_RESOLUCAO_LABEL: Record<string, string> = {
  SIM: "Sim",
  NAO: "Não",
  NAO_SE_APLICA: "Não se aplica",
};

/**
 * ORDEM DE PRECEDENCIA — tres fontes, da mais recente para a mais antiga:
 *
 *   1. srcc_resolucao   a CONCLUSAO do fechamento. Vence porque e a resposta
 *                       MAIS NOVA: a diaria disse "consulta nao realizada" no
 *                       dia da venda, e o fechamento, semanas depois, disse o
 *                       que a consulta deu. Preferir o raw_payload aqui seria
 *                       preferir a duvida a resposta.
 *   2. raw_payload      o que a GESTORA mandou na diaria. Copia fiel, intocada.
 *   3. is_srcc_restricted  o booleano, so quando nao ha coluna nenhuma (ADS).
 *
 * QUEM NAO TEM RESOLUCAO NAO MUDA NADA. srcc_resolucao nasce NULL em 100% da
 * tabela e so e preenchida pelo passo do import de fechamento; enquanto for
 * null, esta funcao se comporta exatamente como antes desta mudanca.
 */
export function getSrccRestrictionLabel(record: ProposalRecord): string {
  const resolvido = String(record.srcc_resolucao ?? "").trim().toUpperCase();
  if (resolvido && SRCC_RESOLUCAO_LABEL[resolvido]) {
    return SRCC_RESOLUCAO_LABEL[resolvido];
  }

  const raw =
    readRawPayloadValue(record.raw_payload, [
      // Promotiva (RR) — texto por extenso.
      "Indicador Restricao SRCC",
      "Indicador Restrição SRCC",
      "Restricao SRCC",
      "Restrição SRCC",
      // BBTS (ADS) — CODIGO cru. Sem estes aliases a resposta da gestora existia
      // no banco e nao chegava na tela: 19 linhas de junho/2026 mostravam "Sem
      // informacao" com srcc_cd=2/4 gravado ao lado (medido 28/07/2026). O
      // tradutor de codigos ja existia (SRCC_POR_CODIGO); faltava a CHAVE.
      // `srcc_cd` e o que o fechamento grava; os outros dois sao os nomes que o
      // bbtsDailyImport procura, para o dia em que a BBTS mandar a coluna na
      // diaria (hoje o arquivo dela nao tem NENHUMA coluna de SRCC).
      "srcc_cd",
      "cd_restricao_srcc",
      "Cd. Restrição SRCC",
    ]) || null;

  if (raw !== null && raw !== undefined && raw !== "") {
    return traduzirSrcc(String(raw));
  }

  // SEM COLUNA DE SRCC no registro. Antes isto devolvia "Não" quando o boolean
  // era falso — fabricava uma NEGATIVA a partir de ausencia de dado. Sao 30
  // linhas da ADS (medido 26/07/2026): a gestora BBTS simplesmente nao manda a
  // coluna. "Nao sei" nao e "nao ha restricao".
  if (record.is_srcc_restricted === true) return "Sim";
  return SRCC_SEM_INFORMACAO;
}

/** Rotulo do 4o estado: registro que nao traz a coluna de SRCC. */
export const SRCC_SEM_INFORMACAO = "Sem informação";

/**
 * CODIGOS OFICIAIS DA RESTRICAO SRCC — tabela BBTS (TRP38, secao 5.3).
 *
 * A regra e do Banco do Brasil e vale para as DUAS gestoras, mas cada uma
 * grava num formato: a Promotiva (RR) manda o texto por extenso, a BBTS (ADS)
 * manda o codigo cru. Sem esta traducao a mesma situacao aparece como "Não"
 * numa tela e "2" na outra.
 */
export const SRCC_POR_CODIGO: Record<number, string> = {
  1: "Sim",
  2: "Não",
  3: "Consulta não realizada",
  4: "Não se aplica",
};

function traduzirSrcc(valor: string): string {
  const cru = valor.trim();
  const codigo = Number(cru);
  if (Number.isInteger(codigo) && SRCC_POR_CODIGO[codigo]) {
    return SRCC_POR_CODIGO[codigo];
  }
  return cru;
}

/**
 * ESTADO da restricao SRCC — decide a COR da etiqueta, em qualquer tela.
 *
 *   "restrito"   restricao CONFIRMADA (codigo 1 / "Sim"). Nao paga.
 *   "indefinido" codigo 3 / "Consulta nao realizada". TRANSITORIO: pode virar
 *                "Sim" ou "Nao" quando a consulta for resolvida.
 *   "sem-info"   o registro nao traz a coluna (as 30 linhas da ADS). Tambem e
 *                ausencia de informacao, mas por motivo diferente do 3: ali a
 *                consulta foi tentada e falhou; aqui a gestora nunca mandou.
 *   "neutro"     negativa CONHECIDA (codigos 2 e 4 e seus textos). Paga.
 *
 * Decide sobre o texto JA traduzido, entao codigo e texto caem no mesmo ramo e
 * o proximo formato so precisa entrar em SRCC_POR_CODIGO.
 */
export type EstadoSrcc = "restrito" | "indefinido" | "sem-info" | "neutro";

/**
 * TINGIMENTO DA LINHA INTEIRA — decisao do Diego (26/07): o destaque nao pode
 * ser so a etiqueta; a linha toda da proposta muda de cor.
 *
 *   "risco"  vermelho suave — restricao CONFIRMADA. A proposta nao e paga.
 *   "alerta" ambar suave    — INDEFINIDO. Pode virar paga ou nao paga.
 *   null     sem tingimento — negativas conhecidas E "sem informacao".
 *
 * "sem-info" NAO tinge de proposito: a etiqueta tracejada ja diz que falta o
 * dado, e tingir 30 linhas da ADS por ausencia de coluna da gestora poluiria a
 * tela sem informar nada sobre a proposta em si.
 *
 * Devolve o CONCEITO, nao a cor: cada tela traduz para a sua classe. Assim a
 * decisao de QUANDO tingir vive num lugar so, e o COMO fica com quem desenha.
 */
export type TingimentoSrcc = "risco" | "alerta" | null;

export function getSrccRowTint(record: ProposalRecord): TingimentoSrcc {
  const estado = getSrccEstado(record);
  if (estado === "restrito") return "risco";
  if (estado === "indefinido") return "alerta";
  return null;
}

export function getSrccEstado(record: ProposalRecord): EstadoSrcc {
  const texto = getSrccRestrictionLabel(record);
  if (texto === SRCC_SEM_INFORMACAO) return "sem-info";
  const normal = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  if (normal === "SIM") return "restrito";
  if (normal.startsWith("CONSULTA NAO REALIZADA")) return "indefinido";
  return "neutro";
}

/**
 * Retorna numero de parcelas. Prioriza `installments`; fallback para
 * `term_months` (alguns produtos so trazem termo em meses). null se
 * nenhum dos dois esta presente.
 */
export function getInstallmentCount(
  record: ProposalRecord
): number | null {
  const installments = record.installments;
  if (installments !== null && installments !== undefined && Number.isFinite(Number(installments))) {
    return Number(installments);
  }
  const term = record.term_months;
  if (term !== null && term !== undefined && Number.isFinite(Number(term))) {
    return Number(term);
  }
  return null;
}

/**
 * Retorna a comissao da empresa (valor em R$) calculada como
 * gross_value * company_received_percent / 100. null se algum dos 2
 * estiver ausente.
 *
 * Atencao: company_received_percent eh armazenado como percentual
 * inteiro (ex: 12.5 para 12,5%) — dividir por 100 antes de multiplicar.
 */
export function getCompanyCommissionAmount(
  record: ProposalRecord
): number | null {
  const gross = record.gross_value;
  const percent = record.company_received_percent;
  if (
    gross === null ||
    gross === undefined ||
    percent === null ||
    percent === undefined
  ) {
    return null;
  }
  const grossNum = Number(gross);
  const percentNum = Number(percent);
  if (!Number.isFinite(grossNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (grossNum * percentNum) / 100;
}

/**
 * Comissao do promotor em R$ apos aplicacao do % de penetracao
 * (override OU default). 4.4-fix-1.C: col 18 da planilha LUCIANA.
 *
 * Formula: COMISSAO PF (base) * % penetracao efetiva / 100.
 * Retorna null quando algum dos 2 esta ausente.
 */
export function computePromoterShareAmount(
  commissionPfAmount: number | null | undefined,
  penetrationPercentEffective: number | null | undefined
): number | null {
  if (
    commissionPfAmount === null ||
    commissionPfAmount === undefined ||
    penetrationPercentEffective === null ||
    penetrationPercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(commissionPfAmount);
  const percentNum = Number(penetrationPercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}

/**
 * Le a "% A VISTA pura" Promotiva direto do raw_payload da
 * daily_production_record. 4.4-fix-1.E (D1): essa eh a regra TRP/OPP
 * original da Promotiva (ex: 5,80% para Consignado Publico tx 2,18%),
 * NAO o valor pos-cascata que esta em promoter_commission_percent.
 *
 * 4.4-fix-1.F: ALIASES expandidos para 12 variacoes; fallback dev-only
 * dumpa as chaves do raw_payload no console quando nenhum bate, para
 * o Diego conseguir descobrir o nome real e me reportar.
 *
 * Normalizacao: planilha Promotiva grava como decimal (0.058) ou
 * percentual (5.8) dependendo da fonte. Heuristica: valores <= 1
 * sao considerados decimal e multiplicados por 100 para unificar
 * a escala 0-100 usada na UI. Match e case/acento-insensitive via
 * readRawPayloadValue → normalizeText.
 */
const A_VISTA_ALIASES = [
  "% A VISTA",
  "%A_VISTA",
  "%A VISTA",
  "% A_VISTA",
  "PCT_A_VISTA",
  "PERCENT_A_VISTA",
  "%AVISTA",
  "% AVISTA",
  "PCTAVISTA",
  "%_A_VISTA",
  "% VISTA",
  "VISTA",
];

export function getAVistaPercent(record: ProposalRecord): number | null {
  // 1) Fluxo legado/Promotiva direto: tenta raw_payload via 12 aliases.
  //    Mantido como fonte PRIMARIA por back-compat com importacoes
  //    antigas que vinham com a chave dentro do JSON original.
  if (record?.raw_payload) {
    const raw = readRawPayloadValue(record.raw_payload, A_VISTA_ALIASES);

    if (raw !== null && raw !== undefined && raw !== "") {
      const num = Number(raw);
      if (Number.isFinite(num)) {
        // Heuristica de escala: decimais entram em 0..1, percentuais ja em 0..100.
        return num <= 1 ? num * 100 : num;
      }
    } else if (
      // Fallback dev: lista as chaves do payload (1a vez por sessao
      // bastaria; aqui logamos sempre que falhar — barato e ajuda).
      typeof record.raw_payload === "object" &&
      record.raw_payload !== null &&
      typeof process !== "undefined" &&
      process.env?.NODE_ENV === "development"
    ) {
      const keys = Object.keys(record.raw_payload);
      if (keys.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          "[getAVistaPercent] Nenhum alias bateu. Chaves do raw_payload:",
          keys.slice(0, 50)
        );
      }
    }
  }

  // 2) FIX-1.D: fluxo importador real — coluna estruturada
  //    company_received_percent. Sem isso, recalculateSingleProposal e
  //    o GET /api/commissions/proposals retornavam null aqui, levando
  //    computeComissaoPromotor a 0 e a coluna COMISSAO PROMOTOR em
  //    /comissoes/editar exibir R$ 0,00 em todas as linhas.
  if (record?.company_received_percent != null) {
    const num = Number(record.company_received_percent);
    if (Number.isFinite(num)) {
      return num <= 1 ? num * 100 : num;
    }
  }

  return null;
}

/**
 * Comissao do promotor sobre seguro em R$. 4.4-fix-1.C: col 19 da
 * planilha LUCIANA. Formula: COMISSAO SEGURO (total) * % seguro
 * promotor efetivo / 100. Retorna null quando algum esta ausente.
 *
 * Dia 4.5 (futuro) tornara o % editavel.
 */
export function computePromoterInsuranceAmount(
  insuranceCommissionAmount: number | null | undefined,
  insurancePercentEffective: number | null | undefined
): number | null {
  if (
    insuranceCommissionAmount === null ||
    insuranceCommissionAmount === undefined ||
    insurancePercentEffective === null ||
    insurancePercentEffective === undefined
  ) {
    return null;
  }
  const baseNum = Number(insuranceCommissionAmount);
  const percentNum = Number(insurancePercentEffective);
  if (!Number.isFinite(baseNum) || !Number.isFinite(percentNum)) {
    return null;
  }
  return (baseNum * percentNum) / 100;
}

// ============================================================
// Dia 4.5 Etapa B — Helpers da cascata de share_percent
// ============================================================

/**
 * Encontra o tier que cobre o valor passado dentro de uma escala
 * ja pre-carregada. Sync. Retorna null se valor cai fora do range
 * de todos os tiers (incluindo o caso de estar abaixo do volume_min
 * do primeiro tier).
 *
 * Para escalas CREDIT, `value` eh volume em R$ (ex: 87000).
 * Para escalas INSURANCE, `value` eh % penetracao em decimal
 * (ex: 0.27 = 27%).
 */
export function findScaleTier(
  scale: ShareScaleWithTiers | undefined,
  value: number
): ShareScaleTier | null {
  if (!scale) return null;
  for (const tier of scale.tiers) {
    const min = Number(tier.volume_min);
    const max = tier.volume_max == null ? Infinity : Number(tier.volume_max);
    if (value >= min && value <= max) return tier;
  }
  return null;
}

/**
 * Resolve o % de repasse para um record especifico aplicando a
 * cascata da Etapa B sobre maps pre-carregados. Sincrono — todas
 * as dependencias (profilesMap, scalesMap, monthlyVolumesMap) devem
 * estar ja em memoria. Use fetchPromoterShareData() para popular
 * as 3 maps de uma so vez.
 *
 * Cascata (em ordem):
 *   1. share_percent_override (proposal_commissions) — vence tudo
 *   2. profile CLT_FIXO | ACORDO_FIXO -> fixed_percent
 *   3. profile ENTRANTE_* -> tier da escala por volume mensal
 *   4. profile ACORDO_VARIAVEL sem override -> DEFAULT 58,33%
 *   5. profile DEFAULT (catch-all, inclui chaves master) -> 58,33%
 *
 * Retorna sempre {sharePercent: number, source: string}; source
 * descreve qual no da cascata definiu o valor (alimenta badge na UI).
 */
// ============================================================
// FRENTE C — escala de repasse: FONTE ÚNICA da verdade. Extraída verbatim do
// motor (calculate/monthly:1138-1163) pra que a tela de edição
// (resolvePromoterShareSync) e o motor apliquem EXATAMENTE a mesma regra. Antes
// divergiam: o motor lia promoter_goal_repasse (ex.: 66,66%) e a tela caía no
// DEFAULT 58,33% — o que fazia o Salvar REBAIXAR o acordo.
// ============================================================

// INSS da Aldalene: repasse fixo 65,86% (fora da escala por meta).
export const ALDALENE_INSS_FIXED_SHARE = 0.6586;

/**
 * O percentual de a-vista que identifica o INSS no carve-out da Aldalene.
 *
 * E a taxa de INSS Novo da TRP na janela medida. NAO e um numero arbitrario, e
 * TAMBEM NAO e derivado: esta congelado aqui. Se a Promotiva mexer na taxa de
 * INSS Novo, ESTE numero tem de mexer junto — senao o carve-out para de casar
 * em silencio. Marcador greppavel de proposito.
 */
export const ALDALENE_INSS_AVISTA_PERCENT = 0.0334;

/** Tolerancia de float ao comparar o percentual (o dado vem da planilha). */
const ALDALENE_INSS_EPS = 1e-6;

/**
 * CARVE-OUT INDIVIDUAL da ALDALENE: proposta de INSS dela repassa 65,86% fixo,
 * fora da escala por meta.
 *
 * POR QUE O NOME DA PESSOA ESTA NO TESTE. Regra por nome e bomba-relogio e
 * normalmente se tira. Aqui ela FICA porque o carve-out e mesmo individual, e
 * isso foi medido, nao suposto: em jul/2026 ha 278 contratos a 3,34% em 37
 * promotores; a planilha do financeiro paga 65,86% em 15 deles, TODOS da
 * Aldalene. Todo o resto segue o acordo normal de cada um (58,33%, 62,50%,
 * 16,66%, 100,00%...). Tirar o nome daria 65,86% a 37 pessoas.
 * Quando o acordo dela mudar, isto morre — e o jeito de matar e apagar esta
 * funcao, nao generalizar.
 *
 * POR QUE O CRITERIO E A TAXA, E NAO O CONVENIO. Ate 25/08/2026 o consolidador
 * testava `produto.includes("INSS")` — e `produto` e o CODIGO do produto
 * ("2882", "3100"), nunca uma descricao: o carve-out nunca disparou, em
 * nenhuma competencia. Ao reconstruir o criterio a partir da planilha, medidas
 * as tres hipoteses sobre os 44 contratos dela em jul/2026:
 *     convenio 1640 .......... 42/44
 *     categoria TRP INSS ..... 42/44
 *     % a vista == 3,34% ..... 44/44   <-- esta
 * Os dois que derrubam as outras duas: 214235822 (convenio 1078/SIAPE,
 * remunerado a 3,34%, planilha pagou 65,86%) e 220180918 (convenio 1640/INSS,
 * remunerado a 2,03%, planilha pagou 58,33%). Com este criterio a Aldalene
 * fecha em 4.429,88 contra 4.429,88 da planilha — diferenca 0,00.
 */
export function isAldaleneInssCarveOut(args: {
  promoterName: string | null | undefined;
  /** % a vista em DECIMAL (0,0334). O consolidador tem `percentualEmpresa`. */
  aVistaPercentDecimal: number | null | undefined;
}): boolean {
  if (!normalizeText(args.promoterName).includes("ALDALENE")) return false;
  const pct = Number(args.aVistaPercentDecimal ?? 0);
  if (!Number.isFinite(pct)) return false;
  return Math.abs(pct - ALDALENE_INSS_AVISTA_PERCENT) < ALDALENE_INSS_EPS;
}

/**
 * Detecta proposta INSS (mesmo criterio do motor): convenio 1640 OU descricao
 * do produto contem 'INSS'.
 *
 * O CONVENIO E NORMALIZADO. Ate 25/08/2026 esta funcao fazia
 * `String(convenio_code).trim() === "1640"` — e o dado do banco vem
 * ZERO-PADDED: `"000001640"`. Medido em jul/2026: 711 de 711 contratos com o
 * convenio padded (100%), dos quais 358 sao 1640. A funcao devolvia FALSE nos
 * 358, e o fallback pela descricao nao salvava nenhum: as descricoes reais sao
 * "CONSIGNADO CORRENTISTA REFIN", "CREDITO BENEFICIO CORRENTISTA", "CREDITO
 * ANTECIPACAO 13o SALARIO" — nenhuma diz INSS.
 *
 * `normConvenio` e o util canonico (lib/convenioSegmento.ts): so digitos, sem
 * zeros a esquerda. Varridos os sitios que comparam convenio com literal, esta
 * era a UNICA que nao normalizava; motor.ts, regrasLoader.ts (x2),
 * convenioSegmento.ts e promoterRemuneration.js ja normalizavam.
 */
export function isInssRecord(record: {
  convenio_code?: string | null;
  product_description?: string | null;
}): boolean {
  if (normConvenio(record?.convenio_code) === "1640") return true;
  return normalizeText(record?.product_description).includes("INSS");
}

export type GoalRepasseRow = {
  pct_base: number;
  pct_meta1: number | null;
  pct_meta2: number | null;
} | null;

export type FrenteCInput = {
  goalRepasse: GoalRepasseRow;
  productionValue: number; // produção VÁLIDA do mês (== validRecords do motor)
  target1Value: number;
  target2Value: number;
  isAldaleneInss: boolean;
  isFaixa580: boolean; // % à vista atingiu o teto 5,80
};

// Resolve o SHARE (0..1) da Frente C, ou null se nao se aplica (cai na cascata
// de profile). Espelha calculate/monthly verbatim (Aldalene INSS fixo + escala
// por meta base/meta1/meta2). NAO multiplica pelo % a vista — quem chama aplica.
export function resolveFrenteCShare(
  input: FrenteCInput
): { share: number; faixaMeta: string; source: string } | null {
  const { goalRepasse, productionValue, target1Value, target2Value, isAldaleneInss, isFaixa580 } = input;
  if (isAldaleneInss) {
    return { share: ALDALENE_INSS_FIXED_SHARE, faixaMeta: "INSS", source: "FRENTE_C_INSS_ALDALENE_FIXO" };
  }
  if (isFaixa580 && goalRepasse) {
    let escalaShare = Number(goalRepasse.pct_base);
    let faixaMeta = "BASE";
    if (target2Value > 0 && productionValue >= target2Value && goalRepasse.pct_meta2 != null) {
      escalaShare = Number(goalRepasse.pct_meta2);
      faixaMeta = "META2";
    } else if (target1Value > 0 && productionValue >= target1Value && goalRepasse.pct_meta1 != null) {
      escalaShare = Number(goalRepasse.pct_meta1);
      faixaMeta = "META1";
    }
    return { share: escalaShare, faixaMeta, source: `FRENTE_C_ESCALA_${faixaMeta}` };
  }
  return null;
}

export function resolvePromoterShareSync(args: {
  record: {
    assigned_promoter_id: string | null;
    share_percent_override?: number | null;
  };
  profilesMap: Map<string, SharePromoterProfile>;
  scalesMap: Map<string, ShareScaleWithTiers>;
  monthlyVolumesMap: Map<string, number>;
  // FRENTE C — quando fornecido, aplica a escala ANTES do override/profile
  // (igual ao motor, onde a escala faixa-5,80% vence). O motor NAO passa isto
  // (resolve a Frente C no proprio fluxo); a tela de edição passa.
  frenteC?: FrenteCInput | null;
}): ShareResolution {
  const { record, profilesMap, scalesMap, monthlyVolumesMap } = args;
  const promoterId = record.assigned_promoter_id;

  if (!promoterId) {
    return { sharePercent: DEFAULT_SHARE, source: "DEFAULT_FALLBACK" };
  }

  // Nivel 0 (FRENTE C): escala da fonte única. Vence ATÉ o override, igual ao
  // motor (la a escala faixa-5,80% e aplicada antes de resolvePromoterShareSync).
  if (args.frenteC) {
    const fc = resolveFrenteCShare(args.frenteC);
    if (fc) return { sharePercent: fc.share, source: fc.source };
  }

  // Nivel 1: override por proposta vence tudo.
  if (
    record.share_percent_override !== null &&
    record.share_percent_override !== undefined
  ) {
    const ov = Number(record.share_percent_override);
    if (Number.isFinite(ov)) {
      return { sharePercent: ov, source: "OVERRIDE_PROPOSTA" };
    }
  }

  const profile = profilesMap.get(promoterId);
  if (!profile) {
    return { sharePercent: DEFAULT_SHARE, source: "DEFAULT_NO_PROFILE" };
  }

  // Nivel 2: % fixo (CLT ou ACORDO_FIXO).
  if (
    profile.profile_type === "CLT_FIXO" ||
    profile.profile_type === "ACORDO_FIXO"
  ) {
    const fixed = Number(profile.fixed_percent);
    if (Number.isFinite(fixed)) {
      return { sharePercent: fixed, source: `PROFILE_${profile.profile_type}` };
    }
    return { sharePercent: DEFAULT_SHARE, source: "PROFILE_FIXED_INVALID" };
  }

  // Nivel 3: escala por volume mensal (ENTRANTE_*).
  if (
    profile.profile_type === "ENTRANTE_PADRAO" ||
    profile.profile_type === "ENTRANTE_CUSTOM"
  ) {
    if (!profile.scale_id) {
      return {
        sharePercent: 0,
        source: `PROFILE_${profile.profile_type}_NO_SCALE`,
      };
    }
    const scale = scalesMap.get(profile.scale_id);
    const volume = monthlyVolumesMap.get(promoterId) ?? 0;
    const tier = findScaleTier(scale, volume);
    if (tier) {
      const volumeK = Math.floor(volume / 1000);
      return {
        sharePercent: Number(tier.share_percent),
        source: `PROFILE_${profile.profile_type}_VOL_${volumeK}K`,
      };
    }
    return {
      sharePercent: 0,
      source: `PROFILE_${profile.profile_type}_BELOW_MIN`,
    };
  }

  // Nivel 4: ACORDO_VARIAVEL sem override -> DEFAULT.
  if (profile.profile_type === "ACORDO_VARIAVEL") {
    return { sharePercent: DEFAULT_SHARE, source: "PROFILE_VARIAVEL_FALLBACK" };
  }

  // Nivel 5: DEFAULT (catch-all, inclui as 4 chaves master).
  return { sharePercent: DEFAULT_SHARE, source: "PROFILE_DEFAULT" };
}

/**
 * Busca o volume mensal total (sum de net_value) de um promotor
 * em (year, month). Usado por recalculateSingleProposal quando nao
 * temos o batch carregado.
 *
 * MESMO recorte do batch (fetchPromoterShareData): JANELA DE PRODUCAO, nao mes
 * de calendario. As duas fontes tem que concordar — se divergirem, o mesmo
 * promotor cai em degraus diferentes conforme o caminho de calculo. Ver a TRAVA
 * no bloco "3. Volume mensal por promotor" antes de reprocessar mes fechado.
 */
export async function getPromoterMonthlyVolume(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  promoterId: string,
  year: number,
  month: number
): Promise<number> {
  const { start: startDate, endExclusive: endDate } = getProductionWindow(year, month);

  const { data, error } = await supabase
    .from("daily_production_records")
    .select("net_value")
    .eq("assigned_promoter_id", promoterId)
    .gte("movement_date", startDate)
    .lt("movement_date", endDate);

  if (error || !data) return 0;
  let total = 0;
  for (const row of data) {
    total += Number((row as { net_value?: number | null }).net_value ?? 0);
  }
  return total;
}

/**
 * Lookup async de um tier especifico (1 escala + 1 valor). Wrapper
 * de findScaleTier que faz a query do banco antes. Util para
 * recalculateSingleProposal sem ter que carregar tudo em batch.
 */
export async function lookupScaleTier(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  scaleId: string,
  value: number
): Promise<number | null> {
  const { data } = await supabase
    .from("share_scale_tier")
    .select("share_percent, volume_min, volume_max")
    .eq("scale_id", scaleId)
    .lte("volume_min", value)
    .order("volume_min", { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  const tier = data[0] as {
    share_percent: number;
    volume_min: number;
    volume_max: number | null;
  };
  if (tier.volume_max !== null && value > Number(tier.volume_max)) {
    return null;
  }
  return Number(tier.share_percent);
}

/**
 * Carrega em BATCH (3 queries) todos os dados necessarios para
 * resolver share_percent de um conjunto de promotores num (year,
 * month). Retorna 3 maps prontos para consumo por
 * resolvePromoterShareSync.
 */
export async function fetchPromoterShareData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  promoterIds: string[],
  year: number,
  month: number,
  // ESCOPO DE EMPRESA — company_ids que entram na produção/volume que alimenta
  // monthlyVolumesMap e frenteCProductionMap (escala ENTRANTE + Frente C). O
  // consolidador RR passa os company_ids do Grupo RR; o de ADS passa a ADS. Sem
  // escopo => soma TODAS as empresas (comportamento antigo) + AVISO — evita que
  // produção de outra empresa (ex: ADS) vaze na escala do promotor. A meta
  // CONSOLIDADA RR+ADS é aplicada explicitamente pelo orquestrador (BBTS-2d).
  scopeCompanyIds?: string[]
): Promise<{
  profilesMap: Map<string, SharePromoterProfile>;
  scalesMap: Map<string, ShareScaleWithTiers>;
  monthlyVolumesMap: Map<string, number>;
  // FRENTE C: escala (goal_repasse) + metas + produção VÁLIDA do mês.
  goalRepasseMap: Map<string, GoalRepasseRow>;
  targetsMap: Map<string, { meta1: number; meta2: number }>;
  // produção VÁLIDA (PRODUÇÃO && !cancelado && !srcc) — == productionValue do motor.
  // MOV 3: o monthlyVolumesMap (escala ENTRANTE) passou a usar o MESMO filtro — antes
  // somava TODOS os records, inflando a faixa com cancelada/SRCC.
  frenteCProductionMap: Map<string, number>;
}> {
  const profilesMap = new Map<string, SharePromoterProfile>();
  const scalesMap = new Map<string, ShareScaleWithTiers>();
  const monthlyVolumesMap = new Map<string, number>();
  const goalRepasseMap = new Map<string, GoalRepasseRow>();
  const targetsMap = new Map<string, { meta1: number; meta2: number }>();
  const frenteCProductionMap = new Map<string, number>();

  if (promoterIds.length === 0) {
    return { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap };
  }

  // 1. Profiles dos promoters relevantes.
  const { data: profiles } = await supabase
    .from("promoter_share_profile")
    .select("promoter_id, profile_type, fixed_percent, scale_id")
    .in("promoter_id", promoterIds);

  const profileRows = (profiles ?? []) as SharePromoterProfile[];
  const scaleIdsNeeded = new Set<string>();
  for (const p of profileRows) {
    profilesMap.set(p.promoter_id, p);
    if (p.scale_id) scaleIdsNeeded.add(p.scale_id);
  }

  // 2. Escalas + tiers (apenas as referenciadas por algum perfil).
  if (scaleIdsNeeded.size > 0) {
    const scaleIds = Array.from(scaleIdsNeeded);
    const [scalesRes, tiersRes] = await Promise.all([
      supabase
        .from("share_scale")
        .select("id, scale_code, scale_kind")
        .in("id", scaleIds),
      supabase
        .from("share_scale_tier")
        .select("scale_id, volume_min, volume_max, share_percent")
        .in("scale_id", scaleIds)
        .order("volume_min", { ascending: true }),
    ]);

    const scalesById = new Map<
      string,
      { id: string; scale_code: string; scale_kind: "CREDIT" | "INSURANCE" }
    >();
    for (const s of scalesRes.data ?? []) {
      scalesById.set(
        (s as { id: string }).id,
        s as { id: string; scale_code: string; scale_kind: "CREDIT" | "INSURANCE" }
      );
    }

    const tiersByScale = new Map<string, ShareScaleTier[]>();
    for (const t of tiersRes.data ?? []) {
      const row = t as {
        scale_id: string;
        volume_min: number;
        volume_max: number | null;
        share_percent: number;
      };
      if (!tiersByScale.has(row.scale_id)) tiersByScale.set(row.scale_id, []);
      tiersByScale.get(row.scale_id)!.push({
        volume_min: Number(row.volume_min),
        volume_max: row.volume_max == null ? null : Number(row.volume_max),
        share_percent: Number(row.share_percent),
      });
    }

    for (const [id, scale] of scalesById) {
      scalesMap.set(id, {
        id: scale.id,
        scale_code: scale.scale_code,
        scale_kind: scale.scale_kind,
        tiers: tiersByScale.get(id) ?? [],
      });
    }
  }

  // 3. Volume mensal por promotor (1 aggregation query).
  //
  // ============================ TRAVA — LEIA ============================
  // O recorte e a JANELA DE PRODUCAO (regra RR: ultimo dia util do mes anterior
  // ate o penultimo dia util do mes vigente), confirmada por Diego em
  // 31/07/2026. ANTES era MES DE CALENDARIO (`${year}-${mm}-01` ate o dia 1 do
  // mes seguinte) — o que colocava o ULTIMO DIA UTIL do mes no balde errado.
  //
  // REPROCESSAR COMPETENCIA FECHADA COM ESTE CODIGO PODE MUDAR VALOR JA PAGO.
  // Caso conhecido e medido: ERIKA LILIAM, jun/2026. A proposta 214159027
  // (R$ 9.290,00, movement_date 2026-06-30) pertence a janela de JULHO, mas o
  // calendario a contava em junho. Com ela, producao 225.634,94 >= meta_1
  // (220.000,00) -> META_1 -> pct 0,6355. Sem ela, 216.344,94 -> META -> pct
  // 0,6250. Reconsolidar jun/2026 muda o repasse dela em -82,29.
  // Nada recalcula sozinho (nenhum cron, nenhuma trigger — medido); o risco so
  // se materializa se alguem reprocessar o mes fechado de proposito.
  // Ver a memoria do projeto "trava-competencia-janela-volume".
  // =====================================================================
  //
  // Os DOIS mapas abaixo nascem desta query e por isso compartilham o recorte:
  //   monthlyVolumesMap    -> degrau da escala ENTRANTE (resolvePromoterShareSync)
  //   frenteCProductionMap -> producao da Frente C (resolveFrenteCShare) e, via
  //                           bbtsOrchestrator, o target_status gravado no PMR.
  const { start: startDate, endExclusive: endDate } = getProductionWindow(year, month);

  let volumeQuery = supabase
    .from("daily_production_records")
    .select("assigned_promoter_id, net_value, status, cancellation_date, is_srcc_restricted")
    .in("assigned_promoter_id", promoterIds)
    .gte("movement_date", startDate)
    .lt("movement_date", endDate);
  // ESCOPO: só as empresas do consolidador chamador — impede que produção de
  // outra empresa (ex: ADS) infle o volume/produção da escala do promotor.
  if (scopeCompanyIds && scopeCompanyIds.length > 0) {
    volumeQuery = volumeQuery.in("company_id", scopeCompanyIds);
  } else {
    console.warn(
      "[fetchPromoterShareData] SEM escopo de empresa — monthlyVolumesMap/frenteCProductionMap somam TODAS as empresas (RR+ADS podem se misturar). Passe scopeCompanyIds."
    );
  }
  const { data: volumeRows } = await volumeQuery;

  for (const row of volumeRows ?? []) {
    const r = row as {
      assigned_promoter_id: string | null;
      net_value: number | null;
      status: string | null;
      cancellation_date: string | null;
      is_srcc_restricted: boolean | null;
    };
    if (!r.assigned_promoter_id) continue;
    const net = Number(r.net_value ?? 0);

    // ELEGIBILIDADE — a MESMA para os dois mapas (espelha validRecords do motor:
    // isProductionStatus && !cancellation_date && !is_srcc_restricted).
    //
    // MOV 3 (faxina): o monthlyVolumesMap somava TODOS os records — inclusive
    // CANCELADA e SRCC — e esse volume é o que decide a faixa da escala ENTRANTE
    // (nível 3 da cascata de resolvePromoterShareSync). Volume inflado = faixa mais
    // alta = repasse maior. Hoje o impacto é ZERO porque todos os promotores resolvem
    // nos níveis 1-2 (PROFILE_ACORDO_FIXO) e a escala ENTRANTE nunca é alcançada —
    // mas era uma mina: bastava um promotor cair no nível 3 para ser pago pela faixa
    // errada. Fechar a fonte é barato; o gate prova que ninguém muda de faixa.
    const st = normalizeText(r.status);
    const isProd = st === "PRODUCAO" || st === "PRODUCTION";
    const valido = isProd && !r.cancellation_date && !r.is_srcc_restricted;
    if (!valido) continue;

    // monthlyVolumesMap = volume da escala ENTRANTE (por faixa).
    monthlyVolumesMap.set(
      r.assigned_promoter_id,
      (monthlyVolumesMap.get(r.assigned_promoter_id) ?? 0) + net
    );
    // frenteCProductionMap = produção válida da Frente C.
    frenteCProductionMap.set(
      r.assigned_promoter_id,
      (frenteCProductionMap.get(r.assigned_promoter_id) ?? 0) + net
    );
  }

  // 4. FRENTE C — escala de repasse da competência + metas (meta_1/meta_2).
  const competencia = `${year}-${String(month).padStart(2, "0")}-01`;
  const [goalRes, targetsRes] = await Promise.all([
    supabase
      .from("promoter_goal_repasse")
      .select("promoter_id, pct_base, pct_meta1, pct_meta2")
      .eq("competencia", competencia)
      .in("promoter_id", promoterIds),
    supabase
      .from("monthly_targets")
      .select("promoter_id, meta_1, meta_2")
      .eq("year", year)
      .eq("month", month)
      .in("promoter_id", promoterIds),
  ]);
  for (const g of goalRes.data ?? []) {
    const r = g as { promoter_id: string; pct_base: number; pct_meta1: number | null; pct_meta2: number | null };
    goalRepasseMap.set(r.promoter_id, { pct_base: Number(r.pct_base), pct_meta1: r.pct_meta1, pct_meta2: r.pct_meta2 });
  }
  for (const t of targetsRes.data ?? []) {
    const r = t as { promoter_id: string; meta_1: number | null; meta_2: number | null };
    targetsMap.set(r.promoter_id, { meta1: Number(r.meta_1 ?? 0), meta2: Number(r.meta_2 ?? 0) });
  }

  return { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap };
}

/**
 * Calcula COMISSAO PROMOTOR (BRL) a partir de net_value, a_vista_percent
 * (Promotiva pura, 0..100) e sharePercent (0..1). Aplica teto 5,80% sobre
 * a_vista_percent ANTES de multiplicar (limite operacional RR: Promotiva
 * paga ate 6%, RR limita visao do promotor a 5,80%, spread fica empresa).
 *
 * Formula: net_value × min(a_vista, 5.8) / 100 × sharePercent
 *
 * Retorna 0 se algum input for invalido.
 */
export function computeComissaoPromotor(
  netValue: number | null | undefined,
  aVistaPercent: number | null | undefined,
  sharePercent: number | null | undefined,
  comp: CompetenciaTeto = "CORRENTE"
): number {
  const nv = Number(netValue ?? 0);
  const av = Number(aVistaPercent ?? 0);
  const sp = Number(sharePercent ?? 0);
  if (!Number.isFinite(nv) || !Number.isFinite(av) || !Number.isFinite(sp)) {
    return 0;
  }
  const aVistaClamped = capAvistaRRPercent(av, comp);
  const comissaoPF = (nv * aVistaClamped) / 100;
  return comissaoPF * sp;
}

/**
 * Dia 4.5 Etapa B — Recalculo localizado de uma proposta.
 *
 * Apos mutacao em proposal_commissions (POST upsert / DELETE / bulk),
 * recalcula promoter_commission_amount + promoter_commission_percent
 * em daily_production_records usando a cascata nova de share_percent.
 *
 * Atualiza:
 *   promoter_commission_amount  = computeComissaoPromotor(...)
 *   promoter_commission_percent = aVistaClamped × sharePercent
 *                                 (% efetivo final, escala 0..100)
 *   commission_rule_source       = `DIA45_${source}`
 *
 * Fail-safe: erros sao retornados (nao throw), permitindo o caller
 * decidir se aborta ou apenas loga (idem padrao audit_logs).
 *
 * TODO Disc.29: quando endpoint de reatribuicao (PATCH
 * daily_production_records.assigned_promoter_id) for criado, chamar
 * esta funcao automaticamente apos cada UPDATE de assigned_promoter_id,
 * para que a cascata pegue o profile do novo promotor (ex: master ->
 * Luciana -> 66,66%).
 */
/**
 * Resolve a taxa a vista EFETIVA de um registro, em percentual (0..100).
 *
 * OBRIGATORIO, e de proposito. Esta funcao GRAVA promoter_commission_amount na
 * daily_production_records; ate 27/07/2026 ela resolvia a taxa com
 * getAVistaPercent, que tem so DOIS degraus (raw_payload -> coluna) e ignora o
 * derive da TRP. Nas linhas que dependem do derive isso gravava ZERO — e o mes
 * aberto de /promotores soma justamente esta coluna quando ainda nao ha PMR.
 *
 * Nao ha default: quem chama TEM de passar a cascata completa. Se fosse
 * opcional, esquecer o parametro devolveria silenciosamente o comportamento
 * antigo, que e o defeito. Use carregarContextoTaxaAvista (promoterAnalytics) e
 * passe ctx.percentDe — o contexto e carregado UMA vez por competencia, nao por
 * registro.
 *
 * O parametro e uma FUNCAO, e nao o modulo, porque promoterAnalytics ja importa
 * este arquivo; importar de volta fecharia um ciclo.
 */
export type ResolvedorTaxaAvista = (record: {
  id: string;
  raw_payload?: Record<string, unknown> | null;
  company_received_percent?: number | null;
  net_value?: number | null;
  gross_value?: number | null;
  insurance_value?: number | null;
  has_insurance?: boolean | null;
  interest_rate?: number | null;
  term_months?: number | null;
  installments?: number | null;
  product_description?: string | null;
  contract_date?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}) => number;

export async function recalculateSingleProposal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  recordId: string,
  resolverTaxaAvista: ResolvedorTaxaAvista
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: record, error: fetchErr } = await supabase
      .from("daily_production_records")
      .select(
        // Alargado com o que o DERIVE consome (bruto, seguro, juros, prazo).
        // Sem estes campos a cascata completa cairia no derive e ele
        // devolveria zero por falta de dado — o mesmo zero, por outra porta.
        "id, assigned_promoter_id, net_value, raw_payload, company_received_percent, movement_date, company_id, convenio_code, product_description, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, contract_date, proposal_date, status, is_srcc_restricted"
      )
      .eq("id", recordId)
      .maybeSingle();

    if (fetchErr || !record) {
      return { ok: false, error: fetchErr?.message ?? "record nao encontrado" };
    }

    const promoterId = (record as { assigned_promoter_id: string | null })
      .assigned_promoter_id;
    if (!promoterId) {
      return { ok: false, error: "record sem assigned_promoter_id" };
    }

    // A COMPETENCIA E A JANELA, NAO O PREFIXO DA DATA. Ate 18/08/2026 esta
    // linha era `movementDate.match(/^(\d{4})-(\d{2})-/)`, isto e, o mes do
    // CALENDARIO — e este (year, month) e o que decide TUDO o que se grava
    // logo abaixo: o monthlyVolumesMap e o frenteCProductionMap de
    // fetchPromoterShareData (o sharePercent), o teto de capAvistaRRPercent e o
    // regime de computeComissaoPromotor.
    //
    // A decisao e TOMADA AQUI e nao herdada do chamador de proposito: as tres
    // rotas que chamam esta funcao passam apenas o recordId, e cada uma delas
    // ja resolveu a competencia por conta propria para montar o
    // ResolvedorTaxaAvista. Se este ponto lesse o calendario enquanto elas leem
    // a janela, a taxa a vista viria de uma competencia e o sharePercent de
    // outra — as duas metades do mesmo produto, de meses diferentes.
    const movementDate = String(
      (record as { movement_date: string | null }).movement_date ?? ""
    );
    const periodo = getProductionPeriodFromValue(movementDate);
    if (!periodo) {
      return { ok: false, error: "movement_date invalido" };
    }
    const year = periodo.year;
    const month = periodo.month;

    // Override atual em proposal_commissions (se houver).
    const { data: manual } = await supabase
      .from("promoter_proposal_commissions")
      .select("share_percent_override, active")
      .eq("daily_production_record_id", recordId)
      .maybeSingle();

    const overrideValue =
      manual?.active !== false ? manual?.share_percent_override ?? null : null;

    // Pre-carrega dados de cascata para 1 promoter no mes (inclui Frente C).
    const { profilesMap, scalesMap, monthlyVolumesMap, goalRepasseMap, targetsMap, frenteCProductionMap } =
      await fetchPromoterShareData(supabase, [promoterId], year, month);
    // Nome do promotor (carve-out Aldalene INSS).
    const { data: promRow } = await supabase
      .from("promoters")
      .select("name")
      .eq("id", promoterId)
      .maybeSingle();

    // CASCATA COMPLETA (tres degraus). getAVistaPercent, que vinha aqui, para
    // no segundo — ver o comentario de ResolvedorTaxaAvista.
    const aVista = resolverTaxaAvista(record);
    const aVistaClamped = capAvistaRRPercent(Number(aVista ?? 0), { year, month });

    // FRENTE C — mesma fonte única do motor e da tela de edição.
    const tgt = targetsMap.get(promoterId);
    const resolution = resolvePromoterShareSync({
      record: {
        assigned_promoter_id: promoterId,
        share_percent_override: overrideValue,
      },
      profilesMap,
      scalesMap,
      monthlyVolumesMap,
      frenteC: {
        goalRepasse: goalRepasseMap.get(promoterId) ?? null,
        productionValue: frenteCProductionMap.get(promoterId) ?? 0,
        target1Value: tgt?.meta1 ?? 0,
        target2Value: tgt?.meta2 ?? 0,
        // MESMO criterio do consolidador (isAldaleneInssCarveOut): a TAXA, nao
        // o convenio. `aVista` esta em unidade PERCENTUAL aqui; a funcao quer
        // DECIMAL. Usa o valor CRU, nao o clampado — igual ao consolidador,
        // que passa `c.percentualEmpresa` sem cap (e 3,34% nem chega no teto).
        isAldaleneInss: isAldaleneInssCarveOut({
          promoterName: (promRow as { name?: string } | null)?.name ?? null,
          aVistaPercentDecimal: Number(aVista ?? 0) / 100,
        }),
        isFaixa580: isFaixaTetoAvistaRRPercent(aVistaClamped, { year, month }),
      },
    });
    const netValue = Number(
      (record as { net_value: number | null }).net_value ?? 0
    );
    const comissaoPromotor = computeComissaoPromotor(
      netValue,
      aVista,
      resolution.sharePercent,
      { year, month }
    );
    const effectiveFinalPercent = aVistaClamped * resolution.sharePercent;

    const { error: updErr } = await supabase
      .from("daily_production_records")
      .update({
        promoter_commission_amount: comissaoPromotor,
        promoter_commission_percent: effectiveFinalPercent,
        commission_rule_source: `DIA45_${resolution.source}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", recordId);

    if (updErr) {
      return { ok: false, error: updErr.message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "erro inesperado",
    };
  }
}
