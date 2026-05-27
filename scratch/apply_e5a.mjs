// FIX-1.E.5.A APPLY — executa 3 UPDATEs com defensivo company_id IS NULL.
// .select() apos cada UPDATE confirma rowcount = 1 e o novo estado.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.resolve(process.cwd(), ".env");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let val = m[2];
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[m[1]] = val;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PLAN = [
  {
    who:    "JENIFFER MILENA SANTOS CAMILO",
    id:     "cb4a0e39-6f82-4071-809f-c381d6439db9",
    target: "77f3992e-2417-4da9-8371-eaf5b6116b78",
    label:  "AL_3",
  },
  {
    who:    "GLEICE KAMILA DA SILVA SANTOS",
    id:     "8a4a8c04-3d84-4df4-8d8d-e43b57f5f8cb",
    target: "77f3992e-2417-4da9-8371-eaf5b6116b78",
    label:  "AL_3",
  },
  {
    who:    "EDIVANIA DE OLIVEIRA SILVA",
    id:     "4c9f92ca-f482-4978-aa20-e269496a69b4",
    target: "b037ecdf-20db-4ab0-81a2-b267f876c626",
    label:  "AL_1",
  },
];

let totalRowcount = 0;
let errors = 0;

for (const p of PLAN) {
  console.log(`\n--- UPDATE ${p.who} (${p.id}) -> ${p.label} ---`);
  const { data, error } = await supabase
    .from("promoters")
    .update({
      company_id: p.target,
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.id)
    .is("company_id", null)
    .select("id, name, company_id, updated_at");
  if (error) {
    console.log(`  [ERRO]`, error.message);
    errors += 1;
    continue;
  }
  const n = (data ?? []).length;
  totalRowcount += n;
  console.log(`  rowcount: ${n}`);
  if (n === 1) {
    console.log(`  novo estado: company_id=${data[0].company_id} updated_at=${data[0].updated_at}`);
  } else if (n === 0) {
    console.log(`  [WARN] 0 rows afetadas — possivelmente company_id ja nao era NULL`);
  } else {
    console.log(`  [WARN] ${n} rows afetadas (esperado 1)`);
  }
}

console.log(`\n=== RESUMO FIX-1.E.5.A ===`);
console.log(`Total rowcount: ${totalRowcount} (esperado 3)`);
console.log(`Erros: ${errors}`);
process.exit(errors > 0 || totalRowcount !== 3 ? 1 : 0);
