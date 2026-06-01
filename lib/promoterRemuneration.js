import * as XLSX from "xlsx";

import { getPrazoTrp } from "./prazoTrp.ts";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  // BUG A (fix-7): celulas numericas do XLSX (raw:true) ja chegam como Number
  // (ex: 0.042 = 4,20%). NAO devem passar pelo strip de separador de milhar:
  // String(0.042) = "0.042" casava /\.(?=\d{3}(\D|$))/ (ponto + 3 digitos +
  // fim) e virava "0042" = 42 (deslocamento decimal x10). O strip de milhar
  // so faz sentido para texto pt-BR ("1.234,56"); numero ja e numero.
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentToUnits(value) {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  if (Math.abs(parsed) <= 1) {
    // 0,0185 × 100 dá 1.8499999999999999 em float — arredonda para 4
    // casas pra evitar que matchesRange rejeite valor literal igual
    // (taxa 1,85 do raw_payload > 1,8499999999999999 da regra).
    return Math.round(parsed * 100 * 1e4) / 1e4;
  }
  return parsed;
}

function parseRateRange(value) {
  if (value === null || value === undefined || value === "") {
    return { from: null, to: null };
  }

  if (typeof value === "number") {
    const units = percentToUnits(value);
    return { from: units, to: units };
  }

  const text = normalizeText(value).replace(/\s+/g, " ");
  const numbers = String(value)
    .replace(/%/g, "")
    .match(/\d+(?:[.,]\d+)?/g);

  if (!numbers || numbers.length === 0) {
    return { from: null, to: null };
  }

  const parsed = numbers
    .map((item) => percentToUnits(item))
    .filter((item) => item !== null);

  if (parsed.length === 0) {
    return { from: null, to: null };
  }

  if (text.includes("A PARTIR") || text.includes("APARTIR")) {
    return { from: parsed[0], to: null };
  }

  if (text.includes("ACIMA")) {
    return { from: parsed[0] + 0.01, to: null };
  }

  if (parsed.length === 1) {
    return { from: parsed[0], to: parsed[0] };
  }

  return { from: parsed[0], to: parsed[1] };
}

function parseTermRange(value) {
  if (value === null || value === undefined || value === "") {
    return { from: null, to: null };
  }

  const text = normalizeText(value).replace(/\s+/g, " ");
  const numbers = String(value).match(/\d+/g);

  if (!numbers || numbers.length === 0) {
    return { from: null, to: null };
  }

  const parsed = numbers.map((item) => Number(item));

  if (text.includes("A PARTIR") || text.includes("APARTIR")) {
    return { from: parsed[0], to: null };
  }

  if (text.includes("ACIMA")) {
    return { from: parsed[0] + 1, to: null };
  }

  if (parsed.length === 1) {
    return { from: parsed[0], to: parsed[0] };
  }

  return { from: parsed[0], to: parsed[1] };
}

function parseTicketMinimum(value) {
  if (value === null || value === undefined || value === "") return null;

  const text = normalizeText(value);
  const numbers = String(value).match(/\d+(?:[.,]\d+)?/g);
  if (!numbers || numbers.length === 0) return null;

  const parsed = toNumber(numbers[0]);
  if (parsed === null) return null;

  if (text.includes("MIL")) {
    return parsed * 1000;
  }

  return parsed;
}

function getSheetRows(workbook, index) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[index]], {
    header: 1,
    raw: true,
    defval: null,
  });
}

function makeRule(base) {
  return {
    scope: "PROMOTER_MONTHLY_TABLE",
    priority: 50,
    product_keywords: [],
    product_excludes: [],
    convenio_type: null,
    convenio_codes: [],
    // FIX-5: convênios/UFs que a regra explicitamente NÃO cobre (mesmo
    // que convenio_type/keywords casem). Usado em "Publico geral" pra
    // excluir INSS (1640), SIAPE (1078) e SP/MG — TRP35 trata em
    // seções próprias (1.2/1.3, 1.5, 1.6) e o 1.4 é residual.
    convenio_codes_exclude: [],
    uf_in: [],
    uf_in_exclude: [],
    rate_from: null,
    rate_to: null,
    term_from: null,
    term_to: null,
    ticket_min: null,
    received_percent: null,
    promoter_percent: null,
    label: "",
    ...base,
  };
}

function addRulesFromRange(target, rows, rowIndexes, builder) {
  for (const index of rowIndexes) {
    const row = rows[index] || [];
    const rule = builder(row, index);
    if (rule) {
      target.push(rule);
    }
  }
}

export function parsePromoterRemunerationWorkbook({ buffer, year, month, fileName }) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const productionRules = [];

  const inssRows = getSheetRows(workbook, 0);
  addRulesFromRange(productionRules, inssRows, [4, 5, 6], (row) =>
    makeRule({
      label: "INSS novo",
      priority: 120,
      product_keywords: ["CONSIGNADO CORRENTISTA", "CONSIGNADO NAO CORRENTISTA"],
      product_excludes: ["REFIN"],
      convenio_type: "PUBLICO",
      convenio_codes: [1640],
      rate_from: percentToUnits(0.0185),
      rate_to: percentToUnits(0.0185),
      term_from: parseTermRange(row[1]).from,
      term_to: parseTermRange(row[1]).to,
      received_percent: percentToUnits(row[2]),
      promoter_percent: percentToUnits(row[3]),
    })
  );
  addRulesFromRange(productionRules, inssRows, [12, 13, 14], (row) =>
    makeRule({
      label: "INSS refin",
      priority: 120,
      product_keywords: [
        "CONSIGNADO CORRENTISTA REFIN",
        "CONSIGNADO NAO CORRENTISTA REFIN",
      ],
      convenio_type: "PUBLICO",
      convenio_codes: [1640],
      rate_from: 1,
      rate_to: null,
      term_from: parseTermRange(row[1]).from,
      term_to: parseTermRange(row[1]).to,
      received_percent: percentToUnits(row[2]),
      promoter_percent: percentToUnits(row[3]),
    })
  );

  const publicRows = getSheetRows(workbook, 1);
  addRulesFromRange(productionRules, publicRows, [4, 5, 6, 7, 8, 9, 10, 11, 12], (row) => {
    const rateRange = parseRateRange(row[0]);
    return makeRule({
      label: "Publico geral",
      priority: 60,
      product_keywords: [
        "CONSIGNADO CORRENTISTA",
        "CONSIGNADO NAO CORRENTISTA",
        "CONSIGNADO CORRENTISTA REFIN",
        "CONSIGNADO NAO CORRENTISTA REFIN",
      ],
      convenio_type: "PUBLICO",
      // FIX-5: TRP35 1.4 "Geral Público" é residual — INSS (1.2/1.3),
      // SIAPE (1.5) e SP/MG (1.6) têm tabelas próprias e não devem
      // fazer fallback aqui. Antes do exclude, INSS conv 1640 parc
      // 36-47 caía indevidamente em "Geral Público" 2,44%.
      convenio_codes_exclude: [1640, 1078],
      uf_in_exclude: ["SP", "MG"],
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: 36,
      term_to: 120,
      received_percent: percentToUnits(row[2]),
      promoter_percent: percentToUnits(row[3]),
    });
  });

  const privateRows = getSheetRows(workbook, 2);
  addRulesFromRange(productionRules, privateRows, [4, 5, 6, 7], (row) => {
    const rateRange = parseRateRange(row[0]);
    const termRange = parseTermRange(row[2]);
    return makeRule({
      label: "Privado CLT",
      priority: 70,
      product_keywords: [
        "CONSIGNADO CORRENTISTA",
        "CONSIGNADO NAO CORRENTISTA",
        "CONSIGNADO CORRENTISTA REFIN",
        "CONSIGNADO NAO CORRENTISTA REFIN",
      ],
      convenio_type: "PRIVADO",
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: termRange.from,
      term_to: termRange.to,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[3]),
      promoter_percent: percentToUnits(row[4]),
    });
  });

  const siapeRows = getSheetRows(workbook, 3);
  addRulesFromRange(productionRules, siapeRows, [4, 5, 6], (row) => {
    const rateRange = parseRateRange(row[0]);
    return makeRule({
      label: "SIAPE",
      priority: 110,
      product_keywords: [
        "CONSIGNADO CORRENTISTA",
        "CONSIGNADO NAO CORRENTISTA",
        "CONSIGNADO CORRENTISTA REFIN",
        "CONSIGNADO NAO CORRENTISTA REFIN",
      ],
      convenio_type: "PUBLICO",
      convenio_codes: [1078],
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: 48,
      term_to: 96,
      received_percent: percentToUnits(row[2]),
      promoter_percent: percentToUnits(row[3]),
    });
  });

  const spMgRows = getSheetRows(workbook, 4);
  addRulesFromRange(productionRules, spMgRows, [4, 5, 6, 7, 8, 9, 10, 11, 12], (row) => {
    const rateRange = parseRateRange(row[0]);
    return makeRule({
      label: "SP e MG",
      priority: 100,
      product_keywords: [
        "CONSIGNADO CORRENTISTA",
        "CONSIGNADO NAO CORRENTISTA",
        "CONSIGNADO CORRENTISTA REFIN",
        "CONSIGNADO NAO CORRENTISTA REFIN",
      ],
      convenio_type: "PUBLICO",
      uf_in: ["SP", "MG"],
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: 36,
      term_to: 120,
      received_percent: percentToUnits(row[2]),
      promoter_percent: percentToUnits(row[3]),
    });
  });

  const naoConsignadoRows = getSheetRows(workbook, 6);
  addRulesFromRange(productionRules, naoConsignadoRows, [4, 5, 6, 7, 8, 9], (row) => {
    const rateRange = parseRateRange(row[0]);
    return makeRule({
      label: "Credito nao consignado",
      priority: 80,
      product_keywords: [
        "CREDITO AUTOMATICO",
        "CREDITO BENEFICIO",
        "CREDITO SALARIO",
        "CREDITO SALARIO REFIN",
      ],
      convenio_type: null,
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: 13,
      term_to: 96,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[4]),
      promoter_percent: percentToUnits(row[5]),
    });
  });
  addRulesFromRange(productionRules, naoConsignadoRows, [10], (row) => {
    const rateRange = parseRateRange(row[0]);
    const termRange = parseTermRange(row[3]);
    return makeRule({
      label: "13 salario",
      priority: 85,
      product_keywords: ["ANTECIPACAO 13"],
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: termRange.from,
      term_to: termRange.to,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[4]),
      promoter_percent: percentToUnits(row[5]),
    });
  });
  addRulesFromRange(productionRules, naoConsignadoRows, [16], (row) => {
    const rateRange = parseRateRange(row[0]);
    const termRange = parseTermRange(row[3]);
    return makeRule({
      label: "FGTS",
      priority: 80,
      product_keywords: ["FGTS"],
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: termRange.from,
      term_to: termRange.to,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[4]),
      promoter_percent: percentToUnits(row[5]),
    });
  });

  const portRows = getSheetRows(workbook, 5);
  addRulesFromRange(productionRules, portRows, [7, 8], (row) => {
    const rateRange = parseRateRange(row[0]);
    const termRange = parseTermRange(row[2]);
    return makeRule({
      label: "Portabilidade publico",
      priority: 90,
      product_keywords: ["PORTABILIDADE"],
      convenio_type: "PUBLICO",
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: termRange.from,
      term_to: termRange.to,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[3]),
      promoter_percent: percentToUnits(row[4]),
    });
  });
  addRulesFromRange(productionRules, portRows, [12, 13], (row) => {
    const rateRange = parseRateRange(row[0]);
    const termRange = parseTermRange(row[2]);
    return makeRule({
      label: "Portabilidade privado",
      priority: 90,
      product_keywords: ["PORTABILIDADE"],
      convenio_type: "PRIVADO",
      rate_from: rateRange.from,
      rate_to: rateRange.to,
      term_from: termRange.from,
      term_to: termRange.to,
      ticket_min: parseTicketMinimum(row[1]),
      received_percent: percentToUnits(row[3]),
      promoter_percent: percentToUnits(row[4]),
    });
  });

  const insuranceBands = [
    {
      label: "Seguro 0 a 10",
      penetration_from: 0,
      penetration_to: 10,
      promoter_share_percent: 10,
    },
    {
      label: "Seguro 11 a 20",
      penetration_from: 11,
      penetration_to: 20,
      promoter_share_percent: 25,
    },
    {
      label: "Seguro 21 a 29.99",
      penetration_from: 21,
      penetration_to: 29.99,
      promoter_share_percent: 35,
    },
    {
      label: "Seguro acima de 30",
      penetration_from: 30,
      penetration_to: null,
      promoter_share_percent: 50,
    },
  ];

  return {
    sourceFileName: fileName || "tabela-remuneracao.xlsx",
    year,
    month,
    productionRules,
    insuranceBands,
    summary: {
      productionRules: productionRules.length,
      insuranceBands: insuranceBands.length,
    },
  };
}

function readRawPayloadValue(record, candidates) {
  const payload = record.raw_payload || {};
  const aliases = candidates.map((item) => normalizeText(item));

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") continue;
    if (aliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

function getRecordContext(record) {
  const product = normalizeText(record.product_description);
  const convenioType = normalizeText(
    record.convenio_type || readRawPayloadValue(record, ["Tipo Convenio", "Tipo de Convenio"])
  );
  const convenioCode = Number(
    record.convenio_code ||
      readRawPayloadValue(record, ["Codigo Convenio", "Codigo do Convenio", "Cod Convenio"]) ||
      0
  );
  const uf = normalizeText(readRawPayloadValue(record, ["UF"]));
  const interestRate = toNumber(record.interest_rate);
  // FIX-PRAZO-TRP: regra Promotiva (J/K) — 3100→Prazo, resto→Parcelas.
  // Fallback legacy preserva comportamento se helper retornar null.
  const term =
    getPrazoTrp(record) ??
    Number(
      record.term_months ||
        readRawPayloadValue(record, ["Prazo", "Parcelas"]) ||
        0
    );
  const grossValue = toNumber(record.gross_value) || 0;

  return {
    product,
    convenioType,
    convenioCode,
    uf,
    interestRate,
    term,
    grossValue,
  };
}

function matchesRange(value, from, to) {
  if (value === null || value === undefined || value === "") return false;
  // epsilon 1e-9 absorve erro de float em rate_from/rate_to gravados em
  // audit_logs antes do fix de percentToUnits (não exige reimport). null
  // continua significando "aberto" — bordas só validam quando não-null.
  if (from !== null && value < from - 1e-9) return false;
  if (to !== null && value > to + 1e-9) return false;
  return true;
}

function computeRuleScore(rule) {
  let score = Number(rule.priority || 0);
  score += (rule.convenio_codes || []).length > 0 ? 40 : 0;
  score += (rule.uf_in || []).length > 0 ? 25 : 0;
  score += rule.rate_from !== null ? 12 : 0;
  score += rule.term_from !== null ? 8 : 0;
  score += rule.ticket_min !== null ? 4 : 0;
  score += (rule.product_excludes || []).length > 0 ? 4 : 0;
  return score;
}

export function findImportedProductionRule(rules, record) {
  if (!Array.isArray(rules) || rules.length === 0) return null;

  const context = getRecordContext(record);
  const matches = rules.filter((rule) => {
    const keywords = (rule.product_keywords || []).map((item) => normalizeText(item));
    const excludes = (rule.product_excludes || []).map((item) => normalizeText(item));

    if (keywords.length > 0 && !keywords.some((item) => context.product.includes(item))) {
      return false;
    }

    if (excludes.some((item) => context.product.includes(item))) {
      return false;
    }

    if (rule.convenio_type && context.convenioType !== normalizeText(rule.convenio_type)) {
      return false;
    }

    if ((rule.convenio_codes || []).length > 0 && !rule.convenio_codes.includes(context.convenioCode)) {
      return false;
    }

    // FIX-5: convênios/UFs declaradamente excluídos pela regra (TRP35
    // 1.4 não cobre conv 1640, 1078, UF SP/MG — esses têm tabelas
    // próprias 1.2/1.3, 1.5, 1.6).
    if ((rule.convenio_codes_exclude || []).includes(context.convenioCode)) {
      return false;
    }

    if ((rule.uf_in || []).length > 0 && !rule.uf_in.includes(context.uf)) {
      return false;
    }

    if (
      (rule.uf_in_exclude || [])
        .map((item) => normalizeText(item))
        .includes(context.uf)
    ) {
      return false;
    }

    if (!matchesRange(context.interestRate, rule.rate_from, rule.rate_to)) {
      return false;
    }

    if (!matchesRange(context.term, rule.term_from, rule.term_to)) {
      return false;
    }

    if (rule.ticket_min !== null && context.grossValue < Number(rule.ticket_min || 0)) {
      return false;
    }

    return true;
  });

  if (matches.length === 0) {
    return null;
  }

  // FIX-5: TRP35 — convênio com tabela específica não faz fallback ao
  // genérico. Se o record é coberto por ALGUMA regra específica (por
  // convenio_codes ou uf_in), DESCARTAR matches "fallback" (sem
  // convenio_codes nem uf_in) — mesmo que o cadastro da fallback não
  // declare exclude (defesa retroativa para audit_logs antigos).
  //
  // "Cobertura específica" = regra que combina convênio/UF + product_keywords
  // + product_excludes do record. Apenas prazo/taxa/ticket podem não casar
  // (essa é a razão de descartar fallback — TRP define que a operação só
  // pode comissionar pela tabela específica, e abaixo do mínimo = 0%).
  //
  // Refinamento (após bug "CRÉDITO SALÁRIO REFIN conv 1640"): a regra INSS
  // refin tem convenio_codes=[1640] mas product_keywords cobre só CONSIGNADO
  // (não CRÉDITO SALÁRIO). Sem keyword match, INSS refin não cobre a linha
  // de produto — fallback ao "Credito nao consignado" (TRP 3.2) segue
  // legítimo. O conv 1640 ali é só código do tomador, não define a linha.
  const recordHasSpecificCoverage = rules.some((rule) => {
    const coversByConv = (rule.convenio_codes || []).includes(context.convenioCode);
    const coversByUf = (rule.uf_in || [])
      .map((item) => normalizeText(item))
      .includes(context.uf);
    if (!coversByConv && !coversByUf) return false;

    // A regra específica também precisa cobrir a linha de produto.
    const kws = (rule.product_keywords || []).map((item) => normalizeText(item));
    const exc = (rule.product_excludes || []).map((item) => normalizeText(item));
    if (kws.length > 0 && !kws.some((k) => context.product.includes(k))) return false;
    if (exc.some((k) => context.product.includes(k))) return false;
    return true;
  });

  const finalMatches = recordHasSpecificCoverage
    ? matches.filter(
        (rule) =>
          (rule.convenio_codes || []).length > 0 ||
          (rule.uf_in || []).length > 0
      )
    : matches;

  if (finalMatches.length === 0) {
    return null;
  }

  finalMatches.sort((a, b) => {
    const scoreDiff = computeRuleScore(b) - computeRuleScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const aRateSpan =
      a.rate_from !== null && a.rate_to !== null ? Math.abs(a.rate_to - a.rate_from) : 999;
    const bRateSpan =
      b.rate_from !== null && b.rate_to !== null ? Math.abs(b.rate_to - b.rate_from) : 999;

    return aRateSpan - bRateSpan;
  });

  return finalMatches[0];
}

export function getImportedInsuranceBands(importedPayload) {
  return Array.isArray(importedPayload?.insuranceBands) ? importedPayload.insuranceBands : [];
}

// Exportados para testes unitários (lib/__tests__/promoterRemuneration.test.ts).
// Utilitários sem efeito colateral; expor não muda contrato público.
export { percentToUnits, matchesRange };
