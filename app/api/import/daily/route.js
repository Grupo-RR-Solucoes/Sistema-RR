import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const normalized = String(value)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim().replace("%", "");
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function getField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

export async function POST(req) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { file, fileName } = await req.json();

    if (!file) {
      return Response.json({ error: "Arquivo não enviado" }, { status: 400 });
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

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    const errors = [];

    for (const row of rows) {
      try {
        const proposal = String(
          getField(row, ["Número Proposta", "Proposta", "Nr Proposta", "Numero Proposta"]) || ""
        ).trim();

        if (!proposal) continue;

        const mci = String(getField(row, ["MCI"]) || "").trim();
        const coban = String(getField(row, ["Cód. Coban", "Cod. Coban", "Coban"]) || "").trim();
        const jKey = String(getField(row, ["Chave J", "Login", "Usuário", "Usuario"]) || "").trim();

        const company = companies.find(
          (c) =>
            (c.mci && String(c.mci).trim() === mci) ||
            (c.coban_code && String(c.coban_code).trim() === coban)
        );

        if (!company) {
          errors.push({
            proposal,
            error: "Empresa não identificada por MCI/Coban.",
          });
          continue;
        }

        const jData = jKeys.find((j) => String(j.j_key).trim() === jKey);

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
          getField(row, ["% A VISTA", "% À VISTA", "% AVISTA", "% A_VISTA", "Percentual A Vista"])
        );

        const data = {
          daily_import_id: importLog.id,
          company_id: company.company_id,
          j_key: jKey,

          promoter_id: promoterId,
          original_promoter_id: promoterId,
          assigned_promoter_id: promoterId,
          promoter_source: source,

          proposal_number: proposal,
          contract_number: getField(row, ["Contrato", "Número Contrato", "Numero Contrato"]),
          customer_name: getField(row, ["Cliente", "Nome Cliente"]),

          product_code: getField(row, ["Código Produto", "Codigo Produto"]),
          product_description: getField(row, ["Produto", "Descrição do Produto", "Descricao do Produto"]),

          gross_value: parseNumber(getField(row, ["Valor Financiado", "Valor Bruto", "Valor Operação"])),
          net_value: parseNumber(getField(row, ["Valor Líquido", "Valor Liquido"])),
          insurance_value: parseNumber(getField(row, ["Valor Seguro", "Seguro"])),
          has_insurance: parseNumber(getField(row, ["Valor Seguro", "Seguro"])) > 0,

          company_received_percent: companyReceivedPercent,

          status: getField(row, ["Status"]),

          proposal_date: parseDate(getField(row, ["Data Proposta"])),
          movement_date: parseDate(getField(row, ["Data Movimento"])),
          cancellation_date: parseDate(getField(row, ["Data Cancelamento"])),

          raw_payload: row,
        };

        const { data: existing, error: existingError } = await supabase
          .from("daily_production_records")
          .select("id")
          .eq("company_id", company.company_id)
          .eq("proposal_number", proposal)
          .maybeSingle();

        if (existingError) throw existingError;

        if (existing) {
          const { error: updateError } = await supabase
            .from("daily_production_records")
            .update(data)
            .eq("id", existing.id);

          if (updateError) throw updateError;
          updated += 1;
        } else {
          const { error: insertError } = await supabase
            .from("daily_production_records")
            .insert(data);

          if (insertError) throw insertError;
          inserted += 1;
        }

        processed += 1;
      } catch (err) {
        errors.push({
          row,
          error: err.message || "Erro ao processar linha.",
        });
      }
    }

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
      errors_count: errors.length,
    });
  } catch (err) {
    return Response.json(
      { error: err.message || "Erro interno na importação diária." },
      { status: 500 }
    );
  }
}
