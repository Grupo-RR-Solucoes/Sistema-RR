// FIX-1.E.5.A + FIX-1.E.5.B + FIX-1.E.4 — DRY RUN (read-only).
// Le XLSX v5, verifica estado atual no Supabase, gera SQL completo para
// as 3 subtarefas. NAO executa nenhum INSERT/UPDATE.
//
// Uso: node scratch/dry_run_e5_e4.mjs

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Mini parser .env.
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// Constantes fornecidas pelo Diego.
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
const PADRAO_ENTRANTE_SCALE_ID = "a2ef0d2c-8f16-49dd-9aa6-c1a7a476cdbf";
const JENIFFER_ID = "cb4a0e39-6f82-4071-809f-c381d6439db9";

// Promoters JA CADASTRADOS (do prompt do Diego).
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
  "JENIFFER MILENA":       JENIFFER_ID,
  "JOSE BUARQUE":          "a4503f8b-3758-49bf-879b-eb98ca8d0b6e",
  "JUSSARA DA SILVA":      "7bb51bf7-8ba0-4c75-9474-e3b1849021a0",
  "MATHEUS AVELINO":       "c14b7550-80eb-4660-893c-f069801cea50",
  "WILIANA DA COSTA":      "74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9",
  // Variacao grafica Promotiva ("Williana" 2 L's) -> mesmo UUID.
  "WILLIANA DA COSTA":     "74a42b7e-7dc1-44b8-b1ec-b0d89fbf04b9",
};

// Promoters A CADASTRAR — UUIDs determinísticos via crypto.randomUUID().
// Uma vez gerados aqui ficam fixos: o INSERT (E.5.B) usa esses e a
// migracao (E.4) referencia os mesmos.
const NEW_PROMOTERS = [
  { name: "ANA PRISCILA",    cnpj: "PE",   key: "ANA PRISCILA" },
  { name: "MONICA PEREIRA",  cnpj: "PE",   key: "MONICA PEREIRA" },
  { name: "ANA CLARA",       cnpj: "AL_1", key: "ANA CLARA" },
  { name: "MARIA LETICIA",   cnpj: "AL_1", key: "MARIA LETICIA" },
  { name: "CLEVITON ARAUJO", cnpj: "AL_3", key: "CLEVITON ARAUJO" },
  { name: "JOSE CARLOS",     cnpj: "AL_3", key: "JOSE CARLOS" },
];
// UUID determinístico baseado em hash (sha256 -> formata como UUID v4-ish).
// Reproduzivel: rodar de novo gera o mesmo UUID. Evita drift entre dry-run
// e apply caso a janela mude.
for (const p of NEW_PROMOTERS) {
  const h = crypto.createHash("sha256").update(`FIX-1.E.5.B|${p.cnpj}|${p.name}`).digest("hex");
  const u = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
  p.uuid = u;
}
const NEW_UUID_BY_KEY = Object.fromEntries(NEW_PROMOTERS.map((p) => [p.key, p.uuid]));

function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ============================================================
// FIX-1.E.5.A — verifica estado da Jeniffer
// ============================================================
console.log("\n========== FIX-1.E.5.A — JENIFFER MILENA company_id ==========");
const { data: jen, error: jErr } = await supabase
  .from("promoters")
  .select("id, name, company_id, active, is_master, updated_at")
  .eq("id", JENIFFER_ID)
  .maybeSingle();
if (jErr) { console.error(jErr); process.exit(1); }
if (!jen) {
  console.log(`[ERRO] Jeniffer UUID ${JENIFFER_ID} nao encontrada.`);
} else {
  console.log("Estado atual:", jen);
  if (jen.company_id !== null) {
    console.log(`[WARN] company_id ja esta setado (${jen.company_id}). UPDATE seria sem-op pelo filtro defensivo.`);
  } else {
    console.log("[OK] company_id IS NULL — UPDATE elegivel.");
  }
}
console.log("\nSQL FIX-1.E.5.A:");
console.log(`UPDATE promoters
SET company_id = '${CNPJ_UUID.AL_3}',  -- AL_3
    updated_at = now()
WHERE id = '${JENIFFER_ID}'
  AND company_id IS NULL;  -- defensivo`);

// ============================================================
// FIX-1.E.5.B — duplicatas + INSERTs
// ============================================================
console.log("\n========== FIX-1.E.5.B — 6 cadastros + perfis ==========");
const dupChecks = await Promise.all(NEW_PROMOTERS.map(async (p) => {
  const { data, error } = await supabase
    .from("promoters")
    .select("id, name, company_id")
    .ilike("name", p.name)
    .eq("company_id", CNPJ_UUID[p.cnpj]);
  return { p, existing: data ?? [], error };
}));
const insertablePromoters = [];
for (const { p, existing, error } of dupChecks) {
  if (error) { console.error(`dup check ${p.name}:`, error); continue; }
  if (existing.length > 0) {
    console.log(`[SKIP] ${p.name} @ ${p.cnpj} ja existe: ${existing.map((e) => e.id).join(",")}`);
    p.skip_reason = "ja_existe";
    p.existing_id = existing[0].id;
  } else {
    insertablePromoters.push(p);
  }
}

console.log("\nSQL FIX-1.E.5.B (INSERT promoters + INSERT promoter_share_profile):\n");
console.log("BEGIN;");
for (const p of insertablePromoters) {
  console.log(`-- ${p.name} -> ${p.cnpj}`);
  console.log(`INSERT INTO promoters (id, name, company_id, status, active, is_master)
VALUES ('${p.uuid}', '${p.name}', '${CNPJ_UUID[p.cnpj]}', 'ACTIVE', true, false);`);
  console.log(`INSERT INTO promoter_share_profile (promoter_id, profile_type, scale_id)
VALUES ('${p.uuid}', 'ENTRANTE_PADRAO', '${PADRAO_ENTRANTE_SCALE_ID}');`);
  console.log("");
}
console.log("-- COMMIT desabilitado (autorizar antes)\nROLLBACK;");

// ============================================================
// FIX-1.E.4 — leitura XLSX v5 + resolucao
// ============================================================
console.log("\n========== FIX-1.E.4 — Migracao 38 propostas ==========");
const buf = fs.readFileSync(path.resolve("scratch/fix_1_e_4_v5_copy.xlsx"));
const wb = XLSX.read(buf, { type: "buffer" });
console.log("Sheets:", wb.SheetNames);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
console.log(`Linhas no XLSX: ${rows.length}`);
console.log("Cols:", Object.keys(rows[0] || {}));

// Detecta nomes de coluna esperados (flexivel).
function pickCol(obj, candidates) {
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(obj, c)) return c;
  }
  return null;
}
if (rows.length === 0) { console.log("XLSX vazio."); process.exit(1); }
const sample = rows[0];
const colProposal = pickCol(sample, ["proposal_number", "Proposal", "PROPOSAL_NUMBER", "Proposta", "Numero Proposta", "Numero da Proposta", "Numero contrato (cms)", "CONTRATO (cms)", "Contrato (cms)"]);
const colKey = pickCol(sample, ["chave_master", "Chave Master", "CHAVE J Master", "Chave J Master"]);
const colVl = pickCol(sample, ["vl_banco", "VL Banco", "VL", "Valor"]);
const colCnpj = pickCol(sample, ["cnpj_arq", "CNPJ_arq", "CNPJ", "cnpj"]);
const colReal = pickCol(sample, ["promotor_real_cms", "Promotor Real", "PROMOTOR REAL (cms)", "Promotor real (cms)"]);
console.log("Colunas detectadas:", { colProposal, colKey, colVl, colCnpj, colReal });
if (!colProposal || !colKey || !colReal) {
  console.error("[ERRO] colunas obrigatorias nao detectadas no XLSX.");
  process.exit(1);
}

// Helper: resolver UUID destino a partir do nome cms.
function resolveDestUuid(cmsName) {
  if (!cmsName) return null;
  const target = normName(cmsName);
  // 1) lista A CADASTRAR (chave normalizada bate com a forma upper).
  for (const [k, uuid] of Object.entries(NEW_UUID_BY_KEY)) {
    if (target === k || target.startsWith(k + " ") || k.startsWith(target.split(" ")[0])) {
      // Match conservador: primeiro nome bate.
      if (target.startsWith(k) || k.startsWith(target.split(" ").slice(0,2).join(" "))) {
        return { uuid, source: "NEW", matched_key: k };
      }
    }
  }
  // 2) lista KNOWN — match por starts/contains.
  for (const [k, uuid] of Object.entries(KNOWN_UUID)) {
    if (target === k || target.startsWith(k + " ") || k.startsWith(target)) {
      return { uuid, source: "KNOWN", matched_key: k };
    }
    // Caso o nome cms tenha sobrenome adicional ou seja substring.
    if (target.includes(k) || k.includes(target.split(" ").slice(0,2).join(" "))) {
      return { uuid, source: "KNOWN_FUZZY", matched_key: k };
    }
  }
  return null;
}

// Carrega records do banco pra abr/2026 nos contratos do XLSX.
const contratos = [...new Set(rows.map((r) => String(r[colProposal] ?? "").trim()).filter(Boolean))];
console.log(`Contratos distintos no XLSX: ${contratos.length}`);
const { data: recs, error: rErr } = await supabase
  .from("daily_production_records")
  .select("id, proposal_number, assigned_promoter_id, company_id, j_key, movement_date, net_value, status")
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

// Para cada linha do XLSX, gerar plano.
const plan = [];
const issues = [];
for (const row of rows) {
  const proposal = String(row[colProposal] ?? "").trim();
  const chaveMaster = String(row[colKey] ?? "").trim();
  const vl = Number(row[colVl] ?? 0);
  const cmsName = row[colReal];
  const master = KEY_MASTER[chaveMaster];
  if (!master) {
    issues.push({ row, reason: `master_desconhecida:${chaveMaster}` });
    continue;
  }
  const dest = resolveDestUuid(cmsName);
  if (!dest) {
    issues.push({ row, reason: `nome_cms_nao_resolvido:${cmsName}` });
    continue;
  }
  const recList = recsByProposal.get(proposal) ?? [];
  if (recList.length !== 1) {
    issues.push({ row, reason: `records_${recList.length}_para_${proposal}` });
    continue;
  }
  const rec = recList[0];
  // Defensivo: confirmar master atual.
  if (rec.assigned_promoter_id !== master.master_id) {
    if (rec.assigned_promoter_id === dest.uuid) {
      plan.push({ ...row, _proposal: proposal, _vl: vl, _dest: dest, _master: master, _rec: rec, _status: "JA_MIGRADO" });
    } else {
      issues.push({ row, reason: `record_atribuido_a_outro:${rec.assigned_promoter_id}` });
    }
    continue;
  }
  plan.push({ ...row, _proposal: proposal, _vl: vl, _dest: dest, _master: master, _rec: rec, _status: "PRONTO" });
}

// Resumo.
const pronto = plan.filter((p) => p._status === "PRONTO");
const jaMig = plan.filter((p) => p._status === "JA_MIGRADO");
console.log(`\nResumo:`);
console.log(`  PRONTO: ${pronto.length} propostas, VL R$ ${pronto.reduce((s, p) => s + p._vl, 0).toFixed(2)}`);
console.log(`  JA_MIGRADO: ${jaMig.length}`);
console.log(`  ISSUES: ${issues.length}`);

console.log("\nPLANO PRONTO:");
console.log("chave | proposta   | vl       | -> destino                          | source");
for (const p of pronto) {
  const destName = Object.entries({ ...KNOWN_UUID, ...NEW_UUID_BY_KEY }).find(([, v]) => v === p._dest.uuid)?.[0] ?? p._dest.matched_key;
  console.log(`${p[colKey].padEnd(8)} | ${p._proposal.padEnd(10)} | ${String(p._vl).padStart(8)} | ${destName.padEnd(30)} | ${p._dest.source}`);
}

if (jaMig.length > 0) {
  console.log("\nJA_MIGRADO (sem-op):");
  for (const p of jaMig) {
    console.log(`${p[colKey]} | ${p._proposal} | ${p._vl}`);
  }
}

if (issues.length > 0) {
  console.log("\nISSUES:");
  for (const i of issues) {
    console.log(`  ${JSON.stringify({ proposta: i.row[colProposal], chave: i.row[colKey], cms: i.row[colReal] })} -> ${i.reason}`);
  }
}

console.log("\nSQL FIX-1.E.4 (idempotente):\n");
console.log("BEGIN;");
for (const p of pronto) {
  const destName = Object.entries({ ...KNOWN_UUID, ...NEW_UUID_BY_KEY }).find(([, v]) => v === p._dest.uuid)?.[0] ?? p._dest.matched_key;
  console.log(`-- ${p[colKey]} ${p._proposal} -> ${destName} (${p._dest.source})`);
  console.log(`UPDATE daily_production_records SET assigned_promoter_id = '${p._dest.uuid}', promoter_source = 'MANUAL_REASSIGNMENT', updated_at = now() WHERE id = '${p._rec.id}' AND assigned_promoter_id = '${p._master.master_id}' AND movement_date >= '2026-04-01' AND movement_date < '2026-05-01';`);
  console.log(`INSERT INTO proposal_reassignments (daily_production_record_id, from_promoter_id, to_promoter_id, reason, changed_by) VALUES ('${p._rec.id}', '${p._master.master_id}', '${p._dest.uuid}', 'FIX-1.E.4 migracao programatica abr/2026', NULL);`);
}
console.log("-- COMMIT desabilitado: aguardar AUTORIZADO FIX-1.E.4\nROLLBACK;");
