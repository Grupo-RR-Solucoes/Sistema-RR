#!/usr/bin/env node
/**
 * scripts/debitos_regra_conferencia.cjs — READ-ONLY. Mostra a regra vigente de
 * CANCELAMENTO_SEGURO por competência e simula o efeito do threshold nos estornos.
 * Não escreve nada. Uso: node scripts/debitos_regra_conferencia.cjs
 */
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

(async () => {
  const { data, error } = await sb
    .from("debit_rule_versions")
    .select("id, debit_type, vigencia_inicio, rule")
    .eq("debit_type", "CANCELAMENTO_SEGURO")
    .order("vigencia_inicio", { ascending: true });
  if (error) throw new Error(error.message);

  console.log("\n=== debit_rule_versions / CANCELAMENTO_SEGURO (estado ATUAL em prod) ===");
  for (const r of data) {
    console.log(`  vigencia_inicio=${r.vigencia_inicio}  rule=${JSON.stringify(r.rule)}`);
  }
  const jul = data.find((r) => String(r.vigencia_inicio).startsWith("2026-07"));
  console.log(`\n  regra de julho HOJE: threshold=${jul?.rule?.threshold} above=${jul?.rule?.above_pct} below=${jul?.rule?.below_pct}`);
  console.log(`  regra de julho DEPOIS do UPDATE: threshold=150 above=0.8 below=1.0`);

  // Efeito prático da mudança de threshold: quem está na faixa 100 < estorno <= 150
  // passa de 80% para 100%.
  console.log("\n  Quem muda: estornos na faixa (100, 150] passam de 80% para 100%.");
  console.log("     estorno 90,00  -> antes 90,00 (100%)   | depois 90,00 (100%)   [igual]");
  console.log("     estorno 120,00 -> antes 96,00 (80%)    | depois 120,00 (100%)  [MUDA]");
  console.log("     estorno 150,00 -> antes 120,00 (80%)   | depois 150,00 (100%)  [MUDA]");
  console.log("     estorno 200,00 -> antes 160,00 (80%)   | depois 160,00 (80%)   [igual]\n");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
