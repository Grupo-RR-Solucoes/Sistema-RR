/* As duas operacoes de junho existem em ALGUM lugar do banco? READ-ONLY.
 * Antes de dizer "dado faltando" e preciso ter procurado em todo lugar
 * plausivel, e por contrato E por proposta. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OPS = ["209867885", "209621970"];
const REF = ["212146378", "212205929", "211689509"]; // as 3 de julho, que RESOLVERAM

const buscas = [
  ["daily_production_records", "proposal_number"],
  ["daily_production_records", "contract_number"],
  ["cms_promoter_entries", "contract_number"],
  ["monthly_closing_entries", "contract_number"],
  ["monthly_closing_entries", "operation_number"],
  ["promoter_debit_sources", "operation"],
  ["promoter_debit_assignments", "operation"],
  ["bbts_prt_parcelas", "contrato"],
];

(async () => {
  for (const [tabela, coluna] of buscas) {
    for (const [rotulo, lista] of [["JUNHO", OPS], ["julho(ref)", REF]]) {
      try {
        const { data, error } = await sb.from(tabela).select("*").in(coluna, lista);
        if (error) { console.log(`  ${tabela}.${coluna.padEnd(17)} [${rotulo}] ERRO: ${error.message.slice(0, 60)}`); continue; }
        console.log(`  ${tabela.padEnd(28)}.${coluna.padEnd(17)} [${rotulo.padEnd(10)}] ${data.length} linha(s)`);
        if (rotulo === "JUNHO" && data.length) for (const d of data) console.log("      ", JSON.stringify(d).slice(0, 220));
      } catch (e) {
        console.log(`  ${tabela}.${coluna} [${rotulo}] EXCECAO: ${String(e.message).slice(0, 60)}`);
      }
    }
  }
  // busca por PREFIXO, caso o numero esteja com sufixo/zero a esquerda
  console.log("\nbusca por PREFIXO em daily (caso o numero tenha sufixo):");
  for (const op of OPS) {
    const { data } = await sb.from("daily_production_records").select("proposal_number, contract_number, company_id, movement_date").like("proposal_number", `%${op}%`);
    console.log(`  ${op}: ${(data || []).length} linha(s)`);
    for (const d of data || []) console.log("      ", JSON.stringify(d));
  }
  // a competencia 2026-06 da ADS tem quantas linhas no diario, para saber se o
  // universo de junho existe (senao "nao achei" seria falta de import, nao de dado)
  const { data: jun } = await sb.from("daily_production_records")
    .select("proposal_number, movement_date")
    .eq("company_id", "375aea6d-3b9c-4490-87f0-e739e312c8ef")
    .gte("movement_date", "2026-06-01").lte("movement_date", "2026-06-30");
  console.log(`\nlinhas da ADS com movement_date em junho/2026: ${(jun || []).length}`);
  const nums = (jun || []).map((r) => String(r.proposal_number)).sort();
  console.log(`  faixa de numeros: ${nums[0]} .. ${nums[nums.length - 1]}`);
  console.log(`  as duas procuradas (209867885, 209621970) caem DENTRO dessa faixa? ${nums[0] <= "209621970" && "209867885" <= nums[nums.length - 1]}`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
