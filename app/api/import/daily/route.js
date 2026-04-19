import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const body = await req.json();
    const { file } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    if (!file) {
      return Response.json({ error: "Arquivo não enviado" }, { status: 400 });
    }

    const workbook = XLSX.read(Buffer.from(file, "base64"), {
      type: "buffer",
    });

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

    for (const row of rows) {
      const proposal = String(row["Número Proposta"] || "").trim();
      if (!proposal) continue;

      const mci = String(row["MCI"] || "").trim();
      const coban = String(row["Cód. Coban"] || "").trim();
      const jKey = String(row["Chave J"] || "").trim();

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
        company_id: company.company_id,
        j_key: jKey,
        assigned_promoter_id: promoterId,
        promoter_source: source,
        proposal_number: proposal,
        gross_value: parseFloat(row["Valor Financiado"] || 0),
        net_value: parseFloat(row["Valor Líquido"] || 0),
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
    }

    return Response.json({ processed, inserted, updated });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
