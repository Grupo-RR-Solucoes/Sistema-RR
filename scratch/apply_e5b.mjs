// FIX-1.E.5.B APPLY — INSERT 6 promoters + 6 promoter_share_profile.
// UUIDs determinísticos via sha256("FIX-1.E.5.B|cnpj|name") — iguais aos
// do dry-run (scratch/dry_run_e5_e4.mjs), pra E.4 referenciar.
//
// Estrategia (Supabase JS nao tem transacao multi-statement):
//   1) Verifica duplicata por (name, company_id) — pula se existir.
//   2) INSERT promoters (com id explicito) — coleta IDs ok.
//   3) INSERT promoter_share_profile (1 por id ok). Se falhar, log + segue.
//      Diego pode rodar UPDATE perfil via UI se necessario.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

const CNPJ_UUID = {
  PE:   "ecff243c-df9b-4360-9e47-ff5aa4b1c93b",
  AL_1: "b037ecdf-20db-4ab0-81a2-b267f876c626",
  AL_2: "f071840c-7454-4f63-bef4-d1e156115534",
  AL_3: "77f3992e-2417-4da9-8371-eaf5b6116b78",
};
const PADRAO_ENTRANTE_SCALE_ID = "a2ef0d2c-8f16-49dd-9aa6-c1a7a476cdbf";

const NEW_PROMOTERS = [
  { name: "ANA PRISCILA",    cnpj: "PE" },
  { name: "MONICA PEREIRA",  cnpj: "PE" },
  { name: "ANA CLARA",       cnpj: "AL_1" },
  { name: "MARIA LETICIA",   cnpj: "AL_1" },
  { name: "CLEVITON ARAUJO", cnpj: "AL_3" },
  { name: "JOSE CARLOS",     cnpj: "AL_3" },
];
for (const p of NEW_PROMOTERS) {
  const h = crypto.createHash("sha256").update(`FIX-1.E.5.B|${p.cnpj}|${p.name}`).digest("hex");
  p.uuid = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
  p.company_id = CNPJ_UUID[p.cnpj];
}

let promotersInserted = 0;
let profilesInserted = 0;
let skipped = 0;
let errors = 0;
const insertedIds = [];

console.log("=== FIX-1.E.5.B APPLY ===\n");

// Etapa 1: dup check.
for (const p of NEW_PROMOTERS) {
  const { data: dup, error: dupErr } = await supabase
    .from("promoters")
    .select("id, name, company_id")
    .eq("company_id", p.company_id)
    .ilike("name", p.name);
  if (dupErr) { console.log(`[ERRO] dup check ${p.name}:`, dupErr.message); errors++; continue; }
  if ((dup ?? []).length > 0) {
    console.log(`[SKIP] ${p.name} @ ${p.cnpj} ja existe: id=${dup[0].id}`);
    p.skip = true; skipped++;
    continue;
  }
}

// Etapa 2: INSERT promoters.
console.log("\n--- INSERT promoters ---");
for (const p of NEW_PROMOTERS) {
  if (p.skip) continue;
  const { data, error } = await supabase
    .from("promoters")
    .insert({
      id: p.uuid,
      name: p.name,
      company_id: p.company_id,
      status: "ACTIVE",
      active: true,
      is_master: false,
    })
    .select("id, name, company_id");
  if (error) {
    console.log(`[ERRO] promoter ${p.name}:`, error.message);
    errors++; p.insert_failed = true;
    continue;
  }
  console.log(`  OK ${p.name} -> ${data[0].id}`);
  promotersInserted++;
  insertedIds.push(p);
}

// Etapa 3: INSERT promoter_share_profile.
console.log("\n--- INSERT promoter_share_profile ---");
for (const p of insertedIds) {
  const { error } = await supabase
    .from("promoter_share_profile")
    .insert({
      promoter_id: p.uuid,
      profile_type: "ENTRANTE_PADRAO",
      scale_id: PADRAO_ENTRANTE_SCALE_ID,
    });
  if (error) {
    console.log(`[ERRO] profile ${p.name}:`, error.message);
    errors++; continue;
  }
  console.log(`  OK ${p.name} -> ENTRANTE_PADRAO (${PADRAO_ENTRANTE_SCALE_ID})`);
  profilesInserted++;
}

console.log(`\n=== RESUMO FIX-1.E.5.B ===`);
console.log(`promoters inseridos: ${promotersInserted} (esperado ${NEW_PROMOTERS.length - skipped})`);
console.log(`profiles inseridos:  ${profilesInserted} (esperado ${promotersInserted})`);
console.log(`skipped (ja existem): ${skipped}`);
console.log(`erros: ${errors}`);

console.log(`\n=== UUIDs (para usar no FIX-1.E.4) ===`);
for (const p of NEW_PROMOTERS) {
  console.log(`  ${p.name.padEnd(20)} | ${p.cnpj} | ${p.uuid}${p.skip ? " (ja existia)" : ""}${p.insert_failed ? " (FALHOU)" : ""}`);
}

process.exit(errors > 0 ? 1 : 0);
