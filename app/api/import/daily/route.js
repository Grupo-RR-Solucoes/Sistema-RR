import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

function parseNumber(value) {
  if (!value) return 0;
  return Number(String(value).replace(",", ".")) || 0;
}

function parseDate(value) {
  if (!value) return null;

  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (!date) return null;
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }

  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
}

function getField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return null;
}

export async function POST(req) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { file } = await req.json();

    if (!file) {
      return Response.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    // =========================
    // CRIAR REGISTRO DE IMPORTAÇÃO
    // =========================
    const { data: importLog } = await supabase
      .from("daily_imports")
      .insert({ file_name: "upload.xlsx", status: "PROCESSING" })
      .select()
      .single();

    const workbook = XLSX.read(Buffer.from(file, "base64"), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const { data: companies } = await supabase
      .from("company_identifiers")
      .select("*");

    const { data: jKeys } = await supabase
      .from("j_keys")
      .select("*");

    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let errors = [];

    for (const row of rows) {
      try {
        const proposal = String(
          getField(row, ["Número Proposta", "Proposta", "Nr Proposta"])
        ).trim();

        if (!proposal) continue;

        const mci = String(getField(row, ["MCI"])).trim();
        const coban = String(getField(row, ["Cód. Coban", "Coban"])).trim();
        const jKey = String(getField(row, ["Chave J", "Login", "Usuário"])).trim();

        const company = companies.find(
          (c) => c.mci === mci || c.coban_code === coban
        );

        if (!company) continue;

        const jData = jKeys.find((j) => j.j_key === jKey);

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

        const data = {
          daily_import_id: importLog.id,
          company_id: company.company_id,
          j_key: jKey,

          promoter_id: promoterId,
          assigned_promoter_id: promoterId,
          promoter_source: source,

          proposal_number: proposal,
          contract_number: getField(row, ["Contrato"]),

          customer_name: getField(row, ["Cliente"]),

          product_code: getField(row, ["Código Produto"]),
          product_description: getField(row, ["Produto"]),

          gross_value: parseNumber(getField(row, ["Valor Financiado"])),
          net_value: parseNumber(getField(row, ["Valor Líquido"])),

          insurance_value: parseNumber(getField(row, ["Valor Seguro"])),
          has_insurance: parseNumber(getField(row, ["Valor Seguro"])) > 0,

          status: getField(row, ["Status"]),

          proposal_date: parseDate(getField(row, ["Data Proposta"])),
          movement_date: parseDate(getField(row, ["Data Movimento"])),
          cancellation_date: parseDate(getField(row, ["Data Cancelamento"])),

          raw_payload: row,
        };

        const { data: existing } = await supabase
          .from("daily_production_records")
          .select("id")
          .eq("company_id", company.company_id)
          .eq("proposal_number", proposal)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("daily_production_records")
            .update(data)
            .eq("id", existing.id);
          updated++;
        } else {
          await supabase
            .from("daily_production_records")
            .insert(data);
          inserted++;
        }

        processed++;
      } catch (err) {
        errors.push({
          error: err.message,
          row,
        });
      }
    }

    await supabase
      .from("daily_imports")
      .update({
        status: "COMPLETED",
        rows_count: processed,
        processing_notes: errors.length
          ? JSON.stringify(errors.slice(0, 10))
          : null,
      })
      .eq("id", importLog.id);

    return Response.json({
      success: true,
      processed,
      inserted,
      updated,
      errors_count: errors.length,
    });
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
