// FIX-1.E.4 APPLY — migracao 38 propostas abr/2026.
// 38 UPDATEs em daily_production_records + 38 INSERTs em proposal_reassignments.
// Defensivo: UPDATE so se assigned_promoter_id ainda = master_atual.
// .select() para confirmar rowcount apos cada UPDATE.

import XLSX from "xlsx";
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
const KEY_MASTER = {
  JH157945: { cnpj: "PE",   master_id: "f01f5101-2cda-4d54-95b4-b3a74acedfd3" },
  JJ089376: { cnpj: "AL_3", master_id: "4cfd506e-3505-4f25-8075-bb6f66acf8fa" },
  JG626476: { cnpj: "AL_1", master_id: "ac7bb664-26c7-4df9-93d4-2ba3e8b642d9" },
  JI303965: { cnpj: "AL_2", master_id: "96b82ee8-edf4-46d0-9e00-7afc4c66fbbe" },
};

const KNOWN_UUID = {
  "THAYNARA TAVARES":      "357d85d6-84e9-46d0-a5c1-31cdb893d355",
  "LETICIA JAYENE":        "68295066-d724-4b58-a3ff-cf37fb7a8a37",
  "ROSANGELA MARIA":       "ed7c1658-6173-45be-b38d-40b6dcd7b12a",
  "ERIKA LILIAM":          "9286ee24-e1fd-4b4b-b650-5ca322af9279",
  "JULIANA DOS SANTOS":    "c62df896-79f3-41dd-8f70-7f5d4753c55c",
  "MARIA DE FATIMA":       "bf872c4a-7288-40f8-b53f-43b79218d643",
  "MAYANNE SHYRLEY":       "fc2a1884-aa1f-4997-8a78-1a8e020aadd7",
  "ALDALENE DE FREITAS":   "eb965d66-0f88-4145-8f53-3b16128e7f4f",
  "CAMILA GOMES XAVIER":   "aa1b6b4f-cd54-4da8-97b6-83ab4bf9390a",
  "CASSIA VIRGINIA":       "1bb968ca-ae60-4220-8bfa-7289d7498e0d",
  "ISAC NICHOLAS":         "bbca7d0f-21ad-4249-9681-7bd28fc67e1c",
  "JENIFFER MILENA":       "cb4a0e39-6f82-4071-809f-c381d6439db9",
  "JOSE BUARQUE":          "a4503f8b-3758-49bf-879b-eb98ca8d0b6e",
  "JUSSARA DA SILVA":      "7bb51bf7-8ba0-4c75-9474-e3b1849021a0",
  "MATHEUS AVELINO":       "c14b7550-80eb-4660-893c-f069801cea50",
  "WILIANA DA COSTA":      "74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9",
  "WILLIANA DA COSTA":     "74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9",
};

const NEW_PROMOTERS = [
  { name: "ANA PRISCILA",    cnpj: "PE" },
  { name: "MONICA PEREIRA",  cnpj: "PE" },
  { name: "ANA CLARA",       cnpj: "AL_1" },
  { name: "MARIA LETICIA",   cnpj: "AL_1" },
  { name: "CLEVITON ARAUJO", cnpj: "AL_3" },
  { name: "JOSE CARLOS",     cnpj: "AL_3" },
];
const NEW_UUID_BY_KEY = {};
for (const p of NEW_PROMOTERS) {
  const h = crypto.createHash("sha256").update(`FIX-1.E.5.B|${p.cnpj}|${p.name}`).digest("hex");
  NEW_UUID_BY_KEY[p.name] = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}

function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

function resolveDestUuid(cmsName) {
  if (!cmsName) return null;
  const target = normName(cmsName);
  for (const [k, uuid] of Object.entries(NEW_UUID_BY_KEY)) {
    if (target === k || target.startsWith(k + " ") || k.startsWith(target.split(" ")[0])) {
      if (target.startsWith(k) || k.startsWith(target.split(" ").slice(0,2).join(" "))) {
        return { uuid, source: "NEW" };
      }
    }
  }
  for (const [k, uuid] of Object.entries(KNOWN_UUID)) {
    if (target === k || target.startsWith(k + " ") || k.startsWith(target)) return { uuid, source: "KNOWN" };
    if (target.includes(k) || k.includes(target.split(" ").slice(0,2).join(" "))) return { uuid, source: "KNOWN_FUZZY" };
  }
  return null;
}

// 1) Le XLSX.
const buf = fs.readFileSync(path.resolve("scratch/fix_1_e_4_v5_copy.xlsx"));
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log(`XLSX: ${rows.length} linhas`);

// 2) Carrega records.
const contratos = [...new Set(rows.map((r) => String(r.proposal_number ?? "").trim()).filter(Boolean))];
const { data: recs, error: rErr } = await supabase
  .from("daily_production_records")
  .select("id, proposal_number, assigned_promoter_id, j_key")
  .in("proposal_number", contratos)
  .gte("movement_date", "2026-04-01")
  .lt("movement_date", "2026-05-01");
if (rErr) { console.error("records err:", rErr); process.exit(1); }
const recsByProposal = new Map();
for (const r of recs ?? []) {
  if (!recsByProposal.has(r.proposal_number)) recsByProposal.set(r.proposal_number, []);
  recsByProposal.get(r.proposal_number).push(r);
}
console.log(`Records carregados: ${recs?.length ?? 0}`);

// 3) Build plan.
const plan = [];
const skipped = [];
for (const row of rows) {
  const proposal = String(row.proposal_number ?? "").trim();
  const chaveMaster = String(row.chave_master ?? "").trim();
  const cmsName = row.promotor_real_cms;
  const master = KEY_MASTER[chaveMaster];
  if (!master) { skipped.push({ proposal, reason: `master_desconhecida:${chaveMaster}` }); continue; }
  const dest = resolveDestUuid(cmsName);
  if (!dest) { skipped.push({ proposal, reason: `nome_nao_resolvido:${cmsName}` }); continue; }
  const recList = recsByProposal.get(proposal) ?? [];
  if (recList.length !== 1) { skipped.push({ proposal, reason: `records_${recList.length}` }); continue; }
  plan.push({ proposal, master_id: master.master_id, dest_uuid: dest.uuid, dest_name: cmsName, source: dest.source, record_id: recList[0].id, current_assigned: recList[0].assigned_promoter_id });
}
console.log(`Plan size: ${plan.length} (esperado 38)`);

if (skipped.length > 0) {
  console.log("SKIPPED:");
  for (const s of skipped) console.log(`  ${JSON.stringify(s)}`);
}

// 4) APPLY: para cada item, UPDATE + INSERT. Defensivo via .eq("assigned_promoter_id", master_id).
console.log("\n=== APPLY ===");
let updateRows = 0;
let insertRows = 0;
let errors = 0;
const failures = [];

for (const p of plan) {
  // UPDATE
  const { data: upd, error: uErr } = await supabase
    .from("daily_production_records")
    .update({
      assigned_promoter_id: p.dest_uuid,
      promoter_source: "MANUAL_REASSIGNMENT",
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.record_id)
    .eq("assigned_promoter_id", p.master_id)
    .gte("movement_date", "2026-04-01")
    .lt("movement_date", "2026-05-01")
    .select("id, assigned_promoter_id");
  if (uErr) {
    console.log(`[ERRO UPD] proposta=${p.proposal} -> ${p.dest_name}: ${uErr.message}`);
    errors++; failures.push({ proposal: p.proposal, step: "update", err: uErr.message }); continue;
  }
  const n = (upd ?? []).length;
  updateRows += n;
  if (n !== 1) {
    console.log(`[WARN UPD] proposta=${p.proposal} rowcount=${n} (esperado 1) — possivel race, defensivo bateu, ou ja migrado`);
    failures.push({ proposal: p.proposal, step: "update", n });
    continue;
  }
  // INSERT proposal_reassignments
  const { error: iErr } = await supabase
    .from("proposal_reassignments")
    .insert({
      daily_production_record_id: p.record_id,
      from_promoter_id: p.master_id,
      to_promoter_id: p.dest_uuid,
      reason: "FIX-1.E.4 migracao programatica abr/2026",
      changed_by: null,
    });
  if (iErr) {
    console.log(`[ERRO INS] proposta=${p.proposal}: ${iErr.message}`);
    errors++; failures.push({ proposal: p.proposal, step: "insert", err: iErr.message }); continue;
  }
  insertRows++;
  console.log(`  OK ${p.proposal} -> ${p.dest_name} (${p.source})`);
}

console.log(`\n=== RESUMO FIX-1.E.4 ===`);
console.log(`UPDATE daily_production_records: ${updateRows} (esperado 38)`);
console.log(`INSERT proposal_reassignments:    ${insertRows} (esperado 38)`);
console.log(`Erros: ${errors}`);
console.log(`Skipped: ${skipped.length}`);
if (failures.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ${JSON.stringify(f)}`);
}

process.exit((errors > 0 || updateRows !== 38 || insertRows !== 38) ? 1 : 0);
