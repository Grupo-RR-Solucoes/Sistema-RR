import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { clearMemoryCache } from "@/lib/memoryCache";
import {
  getProductionPeriodFromValue,
  getProductionPeriodKey,
} from "@/lib/productionPeriod";

const EXISTING_LOOKUP_CHUNK_SIZE = 200;
const UPSERT_CHUNK_SIZE = 500;

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim().replace("%", "");
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function parseRate(value) {
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim().replace("%", "");
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSrccRestricted(value) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (normalized === "SIM") return true;
  if (normalized.includes("RESTRI")) return true;
  return false;
}

function firstPositiveNumber(values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (parsed > 0) return parsed;
  }

  return 0;
}

function parseDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }

  const text = String(value).trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split("/");
    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
}

function getField(lookup, keys) {
  const aliases = keys.map((key) => normalizeText(key));

  if (lookup instanceof Map) {
    for (const alias of aliases) {
      const value = lookup.get(alias);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return null;
  }

  for (const [key, value] of Object.entries(lookup || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (aliases.includes(normalizeText(key))) {
      return value;
    }
  }

  return null;
}

function buildRowLookup(row) {
  const lookup = new Map();

  for (const [key, value] of Object.entries(row)) {
    if (value === undefined || value === null || value === "") continue;
    lookup.set(normalizeText(key), value);
  }

  return lookup;
}

function chunkArray(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function makeRecordKey(companyId, proposalNumber) {
  return `${companyId}::${proposalNumber}`;
}

function extractYearMonthFromPayload(payload) {
  const sourceDate =
    payload.movement_date ||
    payload.contract_date ||
    payload.proposal_date;

  return getProductionPeriodFromValue(sourceDate);
}

function groupAffectedPeriods(records) {
  const grouped = new Map();

  for (const record of records) {
    const period = extractYearMonthFromPayload(record);
    if (!period || !record.company_id) continue;

    const key = getProductionPeriodKey(period.year, period.month);
    const current = grouped.get(key) || {
      year: period.year,
      month: period.month,
      companyIds: new Set(),
    };

    current.companyIds.add(record.company_id);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).map((item) => ({
    year: item.year,
    month: item.month,
    companyIds: Array.from(item.companyIds),
  }));
}

async function fetchExistingRecords(supabase, companyIds, proposalNumbers) {
  const existingByKey = new Map();

  if (companyIds.length === 0 || proposalNumbers.length === 0) {
    return existingByKey;
  }

  for (const proposalChunk of chunkArray(proposalNumbers, EXISTING_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("daily_production_records")
      .select("id, company_id, proposal_number, assigned_promoter_id, original_promoter_id, promoter_source")
      .in("company_id", companyIds)
      .in("proposal_number", proposalChunk);

    if (error) throw error;

    for (const record of data || []) {
      existingByKey.set(makeRecordKey(record.company_id, record.proposal_number), record);
    }
  }

  return existingByKey;
}

async function invalidateMonthlySnapshots(supabase, affectedPeriods) {
  for (const period of affectedPeriods) {
    for (const companyChunk of chunkArray(period.companyIds, 100)) {
      const { error: expectedError } = await supabase
        .from("monthly_expected_closings")
        .delete()
        .eq("year", period.year)
        .eq("month", period.month)
        .in("company_id", companyChunk);

      if (expectedError) throw expectedError;

      const { error: promoterError } = await supabase
        .from("promoter_monthly_results")
        .delete()
        .eq("year", period.year)
        .eq("month", period.month)
        .in("company_id", companyChunk);

      if (promoterError) throw promoterError;
    }
  }
}

export async function POST(req) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { file, fileName } = await req.json();

    if (!file) {
      return Response.json({ error: "Arquivo nao enviado" }, { status: 400 });
    }

    const { data: importLog, error: importLogError } = await supabase
      .from("daily_imports")
      .insert({
        file_name: fileName || "upload.xlsx",
        status: "PROCESSING",
      })
      .select()
      .single();

    if (importLogError) {
      throw importLogError;
    }

    const workbook = XLSX.read(Buffer.from(file, "base64"), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const { data: companies, error: companiesError } = await supabase
      .from("company_identifiers")
      .select("*");

    if (companiesError) throw companiesError;

    const { data: jKeys, error: jKeysError } = await supabase
      .from("j_keys")
      .select("*")
      .eq("active", true);

    if (jKeysError) throw jKeysError;

    const companyByMci = new Map();
    const companyByCoban = new Map();
    for (const company of companies || []) {
      const mci = company.mci ? String(company.mci).trim() : "";
      const coban = company.coban_code ? String(company.coban_code).trim() : "";

      if (mci) companyByMci.set(mci, company);
      if (coban) companyByCoban.set(coban, company);
    }

    const jKeyByValue = new Map();
    for (const item of jKeys || []) {
      const key = String(item.j_key || "").trim().toUpperCase();
      if (key) jKeyByValue.set(key, item);
    }

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let duplicatesInFile = 0;
    const errors = [];
    const recordsByKey = new Map();

    for (const row of rows) {
      try {
        const lookup = buildRowLookup(row);
        const proposal = String(
          getField(lookup, [
            "Numero Proposta",
            "Número Proposta",
            "Numero da Proposta",
            "Número da Proposta",
            "Proposta",
            "Nr Proposta",
          ]) || ""
        ).trim();

        if (!proposal) continue;

        const mci = String(getField(lookup, ["MCI"]) || "").trim();
        const coban = String(
          getField(lookup, ["Cód. Coban", "Cod. Coban", "Codigo Coban", "Código Coban", "Coban"]) || ""
        ).trim();
        const jKey = String(
          getField(lookup, [
            "ChaveJ",
            "Chave J",
            "Login",
            "Usuario",
            "Usuário",
            "Usuario Digitador",
            "Usuário Digitador",
          ]) || ""
        ).trim();

        const company = companyByMci.get(mci) || companyByCoban.get(coban);

        if (!company) {
          errors.push({
            proposal,
            error: "Empresa nao identificada por MCI/Coban.",
          });
          continue;
        }

        const jData = jKeyByValue.get(jKey.toUpperCase());

        let promoterId = null;
        let source = "UNIDENTIFIED";

        if (jData) {
          if (jData.key_type === "INDIVIDUAL") {
            promoterId = jData.promoter_id;
            source = "AUTO_J_KEY";
          } else {
            source = "MASTER_REASSIGNED";
          }
        }

        const companyReceivedPercent = parsePercent(
          getField(lookup, [
            "% A VISTA",
            "% À VISTA",
            "% A VISTA EMPRESA",
            "% AVISTA",
            "Percentual A Vista",
          ])
        );

        const insuranceValue = parseNumber(
          getField(lookup, ["Valor Seguro", "Valor Seguro Crédito", "Seguro"])
        );
        const effectiveInsuranceValue =
          firstPositiveNumber([
            getField(lookup, ["Valor Seguro Crédito", "Valor Seguro Credito"]),
            getField(lookup, ["Valor Líquido Seguro", "Valor Liquido Seguro"]),
            getField(lookup, ["Valor Seguro", "Seguro"]),
          ]) || insuranceValue;
        const insuranceType = getField(lookup, ["Tipo Seguro", "Modalidade Seguro"]);
        const insuranceNumber = getField(lookup, ["Número Seguro", "Numero Seguro"]);
        const term = parseNumber(getField(lookup, ["Prazo", "Parcelas", "Prazo Total", "Termo"]));
        const interestRate = parseRate(
          getField(lookup, [
            "Taxa",
            "Taxa Mensal de Juros",
            "Taxa Juros",
            "Taxa de Juros",
            "Taxa Contratada",
          ])
        );
        const insuranceCommissionAmount = parseNumber(
          getField(lookup, [
            "Comissao Seguro",
            "Comissão Seguro",
            "Valor Comissao Seguro",
            "Valor Comissão Seguro",
          ])
        );

        const payload = {
          daily_import_id: importLog.id,
          company_id: company.company_id,
          j_key: jKey,
          promoter_id: promoterId,
          original_promoter_id: promoterId,
          assigned_promoter_id: promoterId,
          promoter_source: source,
          proposal_number: proposal,
          contract_number: getField(lookup, ["Contrato", "Numero Contrato", "Número Contrato"]),
          customer_name: getField(lookup, ["Cliente", "Nome Cliente"]),
          product_code: getField(lookup, ["Codigo Produto", "Código Produto", "Cod Produto"]),
          product_description: getField(lookup, [
            "Produto",
            "Descricao do Produto",
            "Descrição do Produto",
            "Descricao Produto",
            "Descrição Produto",
          ]),
          convenio_code: getField(lookup, [
            "Codigo Convenio",
            "Código Convênio",
            "Codigo Convênio",
            "Cod Convenio",
          ]),
          convenio_type: getField(lookup, [
            "Convenio",
            "Convênio",
            "Tipo Convenio",
            "Tipo Convênio",
          ]),
          convenio_segment: getField(lookup, [
            "Segmento Convenio",
            "Segmento Convênio",
            "Grupo Convenio",
            "Grupo Convênio",
          ]),
          gross_value: parseNumber(
            getField(lookup, ["Valor Financiado", "Valor Bruto", "Valor Operacao", "Valor Operação"])
          ),
          net_value: parseNumber(
            getField(lookup, [
              "Valor Liquido",
              "Valor Líquido",
              "Valor Financiado Liquido",
              "Valor Financiado Líquido",
            ])
          ),
          insurance_value: effectiveInsuranceValue,
          insurance_net_value: parseNumber(
            getField(lookup, ["Valor Líquido Seguro", "Valor Liquido Seguro"])
          ),
          insurance_type: insuranceType,
          has_insurance:
            effectiveInsuranceValue > 0 || Boolean(insuranceNumber) || Boolean(insuranceType),
          interest_rate: interestRate,
          term_months: term || null,
          installments: term || null,
          company_received_percent: companyReceivedPercent,
          insurance_commission_amount: insuranceCommissionAmount,
          status: getField(lookup, ["Status"]),
          proposal_date: parseDate(getField(lookup, ["Data Proposta"])),
          movement_date: parseDate(getField(lookup, ["Data Movimento"])),
          contract_date: parseDate(
            getField(lookup, [
              "Data Contratacao",
              "Data Contratação",
              "Data Contracao",
              "Data Contrato",
            ])
          ),
          cancellation_date: parseDate(getField(lookup, ["Data Cancelamento"])),
          is_srcc_restricted: parseSrccRestricted(
            getField(lookup, [
              "Indicador Restricao SRCC",
              "Indicador Restrição SRCC",
            ])
          ),
          raw_payload: row,
        };

        const recordKey = makeRecordKey(company.company_id, proposal);
        if (recordsByKey.has(recordKey)) {
          duplicatesInFile += 1;
        }

        recordsByKey.set(recordKey, payload);
        processed += 1;
      } catch (error) {
        errors.push({
          row,
          error: error.message || "Erro ao processar linha.",
        });
      }
    }

    const recordsToSave = Array.from(recordsByKey.values());
    const affectedPeriods = groupAffectedPeriods(recordsToSave);
    const companyIds = Array.from(new Set(recordsToSave.map((record) => record.company_id)));
    const proposalNumbers = Array.from(
      new Set(recordsToSave.map((record) => record.proposal_number))
    );
    const existingByKey = await fetchExistingRecords(supabase, companyIds, proposalNumbers);
    const now = new Date().toISOString();

    for (const payload of recordsToSave) {
      const key = makeRecordKey(payload.company_id, payload.proposal_number);
      const existing = existingByKey.get(key);

      if (existing) {
        updated += 1;

        if (existing.original_promoter_id) {
          payload.original_promoter_id = existing.original_promoter_id;
        }

        if (existing.promoter_source === "MANUAL_REASSIGNMENT") {
          payload.assigned_promoter_id = existing.assigned_promoter_id;
          payload.promoter_source = existing.promoter_source;
        }
      } else {
        inserted += 1;
      }

      payload.updated_at = now;
    }

    for (const chunk of chunkArray(recordsToSave, UPSERT_CHUNK_SIZE)) {
      const { error: upsertError } = await supabase
        .from("daily_production_records")
        .upsert(chunk, {
          onConflict: "company_id,proposal_number",
        });

      if (upsertError) throw upsertError;
    }

    await invalidateMonthlySnapshots(supabase, affectedPeriods);

    clearMemoryCache("closing:");
    clearMemoryCache("financial:");
    clearMemoryCache("promoters:");
    clearMemoryCache("dashboard:");
    clearMemoryCache("route:importacoes");

    const { error: finishError } = await supabase
      .from("daily_imports")
      .update({
        status: "COMPLETED",
        rows_count: processed,
        processing_notes: errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null,
      })
      .eq("id", importLog.id);

    if (finishError) throw finishError;

    return Response.json({
      success: true,
      processed,
      inserted,
      updated,
      duplicates_in_file: duplicatesInFile,
      affected_periods: affectedPeriods.map((period) => ({
        year: period.year,
        month: period.month,
        companies_count: period.companyIds.length,
      })),
      errors_count: errors.length,
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro interno na importacao diaria." },
      { status: 500 }
    );
  }
}
