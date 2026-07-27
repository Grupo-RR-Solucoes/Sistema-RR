// Diagnostico: por que 4 linhas DESCEM quando a tela troca getAVistaPercent
// pela cascata do motor? Somente leitura.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const { carregarContextoTaxaAvista, resolverTaxaAvistaEfetiva } = await import(
  "../lib/promoterAnalytics.ts"
);
const { getAVistaPercent, computeComissaoPromotor, readRawPayloadValue } = await import(
  "../lib/proposalDetailing.ts"
);
const { nowInFortaleza } = await import("../lib/dateFortaleza.ts");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const agora = nowInFortaleza();
const { year, month } = { year: agora.year, month: agora.month };
const p2 = (n: number) => String(n).padStart(2, "0");
const inicio = `${year}-${p2(month)}-01`;
const fim = month === 12 ? `${year + 1}-01-01` : `${year}-${p2(month + 1)}-01`;

const { data } = await supabase
  .from("daily_production_records")
  .select(
    "id, proposal_number, product_description, net_value, gross_value, insurance_value, has_insurance, interest_rate, term_months, installments, company_received_percent, raw_payload, movement_date, contract_date, proposal_date, status, is_srcc_restricted, company_id"
  )
  .gte("movement_date", inicio)
  .lt("movement_date", fim)
  .eq("status", "Produção")
  .not("assigned_promoter_id", "is", null);

const ctx = await carregarContextoTaxaAvista(supabase, { year, month });
const SHARE = 0.5833;

const ALIASES_MOTOR = [
  "% A VISTA",
  "% À VISTA",
  "% A VISTA EMPRESA",
  "% AVISTA",
  "Percentual A Vista",
];

console.log("=".repeat(100));
console.log("LINHAS QUE DESCEM — o que muda entre as duas cascatas");
console.log("=".repeat(100));

let n = 0;
for (const r of data || []) {
  const antiga = computeComissaoPromotor(num(r.net_value), getAVistaPercent(r), SHARE);
  const nova = computeComissaoPromotor(num(r.net_value), ctx.percentDe(r), SHARE);
  if (nova >= antiga - 0.005) continue;
  n += 1;
  const efet = resolverTaxaAvistaEfetiva({
    record: r,
    producaoMensalDoGrupo: ctx.producaoMensalDoGrupo,
    trpProvider: ctx.trpProvider,
  });
  console.log(`\n--- ${n}. proposta ${r.proposal_number} · ${r.product_description}`);
  console.log(`    net R$ ${brl(num(r.net_value))} · juros ${r.interest_rate} · prazo ${r.term_months ?? r.installments}`);
  console.log(`    company_received_percent (coluna) = ${r.company_received_percent}`);
  console.log(
    `    raw_payload nos aliases DO MOTOR (5)  = ${JSON.stringify(readRawPayloadValue(r.raw_payload, ALIASES_MOTOR))}`
  );
  console.log(`    getAVistaPercent (12 aliases, sem teto) = ${getAVistaPercent(r)}`);
  console.log(`    cascata do motor .................... ${(efet.taxa * 100).toFixed(4)}%  (degrau: ${efet.degrau})`);
  console.log(`    comissao promotor: antes R$ ${brl(antiga)}  ->  agora R$ ${brl(nova)}`);
}
console.log(`\n${n} linhas descem.`);
