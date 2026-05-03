import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getImportedInsuranceBands,
  parsePromoterRemunerationWorkbook,
} from "@/lib/promoterRemuneration";

export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await req.json();
    const file = String(body?.file || "");
    const fileName = String(body?.fileName || "tabela-remuneracao-promotores.xlsx");
    const year = Number(body?.year);
    const month = Number(body?.month);

    if (!file || !year || !month) {
      return Response.json(
        { error: "Informe arquivo, ano e mes da tabela de remuneracao." },
        { status: 400 }
      );
    }

    const imported = parsePromoterRemunerationWorkbook({
      buffer: Buffer.from(file, "base64"),
      year,
      month,
      fileName,
    });

    const insuranceBands = getImportedInsuranceBands(imported);

    const { data: companies, error: companiesError } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("active", true);

    if (companiesError) {
      throw companiesError;
    }

    const { data: existingTables, error: tablesError } = await supabaseAdmin
      .from("commission_tables")
      .select("id, company_id, version")
      .eq("year", year)
      .eq("month", month)
      .eq("active", true);

    if (tablesError) {
      throw tablesError;
    }

    const tableByCompany = new Map<string, { id: string; company_id: string; version: number }>();
    for (const row of existingTables || []) {
      const current = tableByCompany.get(row.company_id);
      if (!current || Number(row.version || 1) > Number(current.version || 1)) {
        tableByCompany.set(row.company_id, row);
      }
    }

    for (const company of companies || []) {
      if (tableByCompany.has(company.id)) {
        continue;
      }

      const { data: createdTable, error: createTableError } = await supabaseAdmin
        .from("commission_tables")
        .insert({
          company_id: company.id,
          year,
          month,
          source_name: fileName,
          version: 1,
          active: true,
        })
        .select("id, company_id, version")
        .single();

      if (createTableError) {
        throw createTableError;
      }

      tableByCompany.set(company.id, createdTable);
    }

    const tableIds = Array.from(tableByCompany.values()).map((row) => row.id);

    if (tableIds.length > 0) {
      const { error: deleteInsuranceRowsError } = await supabaseAdmin
        .from("commission_table_rows")
        .delete()
        .in("commission_table_id", tableIds)
        .eq("rule_type", "INSURANCE")
        .eq("notes", "PROMOTER_INSURANCE_IMPORT");

      if (deleteInsuranceRowsError) {
        throw deleteInsuranceRowsError;
      }
    }

    const insuranceRows = Array.from(tableByCompany.values()).flatMap((table) =>
      insuranceBands.map((band: any) => ({
        commission_table_id: table.id,
        rule_type: "INSURANCE",
        metric_type: "PENETRATION",
        range_from: band.penetration_from,
        range_to: band.penetration_to,
        commission_value: band.promoter_share_percent,
        notes: "PROMOTER_INSURANCE_IMPORT",
      }))
    );

    if (insuranceRows.length > 0) {
      const { error: insertInsuranceRowsError } = await supabaseAdmin
        .from("commission_table_rows")
        .insert(insuranceRows);

      if (insertInsuranceRowsError) {
        throw insertInsuranceRowsError;
      }
    }

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      entity_name: "promoter_remuneration_table",
      action: "IMPORT",
      description: "Importacao da tabela mensal de remuneracao dos promotores.",
      created_by: "sistema",
      payload: imported,
    });

    if (auditError) {
      throw auditError;
    }

    return Response.json({
      success: true,
      year,
      month,
      summary: {
        productionRules: imported.summary.productionRules,
        insuranceBands: imported.summary.insuranceBands,
        companiesUpdated: tableByCompany.size,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error.message || "Erro ao importar tabela de remuneracao dos promotores.",
      },
      { status: 500 }
    );
  }
}
