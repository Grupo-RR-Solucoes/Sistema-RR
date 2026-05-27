// Verifica estado de Gleice e Edivania antes do UPDATE.
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

const ids = [
  { id: "cb4a0e39-6f82-4071-809f-c381d6439db9", who: "JENIFFER MILENA", target_cnpj_uuid: "77f3992e-2417-4da9-8371-eaf5b6116b78", target_label: "AL_3" },
  { id: "8a4a8c04-3d84-4df4-8d8d-e43b57f5f8cb", who: "GLEICE KAMILA",   target_cnpj_uuid: "77f3992e-2417-4da9-8371-eaf5b6116b78", target_label: "AL_3" },
  { id: "4c9f92ca-f482-4978-aa20-e269496a69b4", who: "EDIVANIA",        target_cnpj_uuid: "b037ecdf-20db-4ab0-81a2-b267f876c626", target_label: "AL_1" },
];

for (const e of ids) {
  const { data, error } = await supabase
    .from("promoters")
    .select("id, name, company_id, active, is_master, updated_at")
    .eq("id", e.id)
    .maybeSingle();
  if (error) { console.log(`[ERRO] ${e.who}:`, error.message); continue; }
  if (!data) { console.log(`[ERRO] ${e.who}: UUID ${e.id} nao encontrado.`); continue; }
  const eligible = data.company_id === null;
  console.log(`\n${e.who} (${e.id})`);
  console.log(`  name=${data.name}`);
  console.log(`  company_id=${data.company_id}`);
  console.log(`  active=${data.active}  is_master=${data.is_master}`);
  console.log(`  -> target: ${e.target_label} (${e.target_cnpj_uuid})`);
  console.log(`  -> UPDATE elegivel: ${eligible ? "SIM" : "NAO (company_id ja setado)"}`);
}
