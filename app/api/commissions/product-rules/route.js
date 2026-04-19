import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { year, month, rows } = await req.json();

  for (const row of rows) {
    await supabase.from("promoter_product_rate_rules").insert({
      year,
      month,
      product_description: row.product_description,
      received_percent: row.received_percent,
      promoter_percent: row.promoter_percent,
      insurance_percent: row.insurance_percent,
    });
  }

  return Response.json({ success: true });
}
