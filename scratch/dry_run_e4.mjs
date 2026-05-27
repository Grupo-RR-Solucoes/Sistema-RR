// FIX-1.E.4 DRY RUN — READ-ONLY. NAO executa UPDATE.
// Le XLSX + faz SELECTs no Supabase para mapear:
//   nome_promotor_real (cms) -> promoter.id (uuid)
//   proposal_number (cms) -> daily_production_records.id (uuid)
// Imprime tabela final + SQL idempotente agrupado.
//
// Uso: node scratch/dry_run_e4.mjs

import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Mini-parser .env (evita dependencia externa)
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[ERRO] .env precisa de NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Mapa fixo CNPJ -> chave master (do prompt do Diego).
const KEY_TO_CNPJ = {
  JH157945: "51457289000103",       // PE
  JJ089376: "55867409000100",       // AL_3
  JG626476: "48357275000103",       // AL_1
  JI303965: "56140658000153",       // AL_2
};

// Normaliza CNPJ: tira pontuacao.
const cleanCnpj = (s) => String(s ?? "").replace(/\D/g, "");

// Normaliza nome para match: NFD + uppercase + colapsa whitespace.
function normName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

// 1) Carrega XLSX.
const buf = fs.readFileSync(path.resolve("scratch/migracao_copy.xlsx"));
const wb = XLSX.read(buf, { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

// 2) Resolve company_id de cada CNPJ.
const cnpjs = Object.values(KEY_TO_CNPJ);
const { data: companies, error: cErr } = await supabase
  .from("companies")
  .select("id, name, cnpj")
  .in("cnpj", cnpjs);
if (cErr) { console.error("companies err:", cErr); process.exit(1); }

// Tenta tambem variacoes formatadas.
const { data: companiesFmt, error: cErrFmt } = await supabase
  .from("companies")
  .select("id, name, cnpj");
if (cErrFmt) { console.error("companies fmt err:", cErrFmt); process.exit(1); }

const cnpjToCompany = new Map();
for (const c of companiesFmt ?? []) {
  cnpjToCompany.set(cleanCnpj(c.cnpj), c);
}
const keyToCompany = {};
for (const [key, cnpj] of Object.entries(KEY_TO_CNPJ)) {
  const c = cnpjToCompany.get(cleanCnpj(cnpj));
  if (!c) console.error(`[WARN] CNPJ nao encontrado: ${cnpj} (chave ${key})`);
  keyToCompany[key] = c || null;
}

// 3) Identifica o promotor MASTER atual para cada chave J (assigned_promoter_id
//    nas propostas master) via uma proposta de amostra abr/2026 de cada chave.
const sampleByKey = {};
for (const key of Object.keys(KEY_TO_CNPJ)) {
  const company = keyToCompany[key];
  if (!company) continue;
  const { data, error } = await supabase
    .from("daily_production_records")
    .select("assigned_promoter_id")
    .eq("company_id", company.id)
    .eq("j_key", key)
    .gte("movement_date", "2026-04-01")
    .lt("movement_date", "2026-05-01")
    .limit(1);
  if (error) { console.error(`sample ${key}:`, error); continue; }
  if (data && data.length > 0) sampleByKey[key] = data[0].assigned_promoter_id;
}

// Resolve nome dos masters.
const masterIds = [...new Set(Object.values(sampleByKey).filter(Boolean))];
const { data: masterPromoters, error: mErr } = await supabase
  .from("promoters")
  .select("id, name, company_id")
  .in("id", masterIds);
if (mErr) { console.error("master promoters err:", mErr); process.exit(1); }
const masterById = new Map((masterPromoters ?? []).map((p) => [p.id, p]));

console.log("\n=== MASTERS DETECTADOS (assigned_promoter_id em propostas master abr/2026) ===");
for (const [key, mid] of Object.entries(sampleByKey)) {
  const m = masterById.get(mid);
  console.log(`  ${key} -> ${mid} (${m?.name ?? "?"}) @ ${keyToCompany[key]?.name}`);
}

// 4) Para cada linha OK, resolver promoter_id (real) + record_id.
const okRows = rows.filter((r) => r.STATUS === "OK");
const ambigRows = rows.filter((r) => r.STATUS === "AMBIGUO");
const naoEncRows = rows.filter((r) => r.STATUS === "NAO ENCONTRADO no cms");

// FIX: busca promoters EM TODOS os companies + filtra is_master=false.
// Justificativa: o promotor real pode estar cadastrado em outro company
// (ex: Maria de Fatima em PE atende propostas que cairam em AL_1 via master).
// is_master=false exclui as 4 chaves master para evitar self-match
// (ex: cms "Juliana dos Santos" colidindo com "JULIANA DOS SANTOS OLIVEIRA - CHAVE MASTER").
const { data: allPromoters, error: pErr } = await supabase
  .from("promoters")
  .select("id, name, company_id, is_master, active")
  .eq("is_master", false);
if (pErr) { console.error("promoters err:", pErr); process.exit(1); }

const promotersAll = (allPromoters ?? [])
  .filter((p) => p.active !== false)
  .map((p) => ({ ...p, _norm: normName(p.name) }));

const companyById = new Map((companiesFmt ?? []).map((c) => [c.id, c]));

function findPromoterByName(_companyIdIgnored, cmsName) {
  const target = normName(cmsName);
  if (!target) return { matches: [], status: "EMPTY_NAME" };
  // 1) exato.
  const exact = promotersAll.filter((p) => p._norm === target);
  if (exact.length === 1) return { matches: exact, status: "EXACT" };
  if (exact.length > 1) return { matches: exact, status: `EXACT_AMBIG_${exact.length}` };
  // 2) starts-with (nome banco comeca com nome cms).
  const starts = promotersAll.filter((p) => p._norm.startsWith(target + " ") || p._norm === target);
  if (starts.length === 1) return { matches: starts, status: "STARTSWITH" };
  if (starts.length > 1) return { matches: starts, status: `STARTSWITH_AMBIG_${starts.length}` };
  // 3) contem (cms aparece como substring no nome banco).
  const contains = promotersAll.filter((p) => p._norm.includes(target));
  if (contains.length === 1) return { matches: contains, status: "CONTAINS" };
  if (contains.length > 1) return { matches: contains, status: `CONTAINS_AMBIG_${contains.length}` };
  return { matches: [], status: "NO_MATCH" };
}

// 5) Resolve daily_production_records.id batch via proposal_number.
const contratos = okRows
  .map((r) => String(r["CONTRATO (cms)"] ?? "").trim())
  .filter(Boolean);
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

// 6) Build resultado por linha.
const plan = [];
const review = [];
const jaMigrado = [];
let prontoVl = 0;
let reviewVl = 0;
let jaMigradoVl = 0;

for (const row of okRows) {
  const key = row["CHAVE J Master"];
  const cnpj = KEY_TO_CNPJ[key];
  const company = keyToCompany[key];
  const cmsName = row["PROMOTOR REAL (cms)"];
  const contrato = String(row["CONTRATO (cms)"] ?? "").trim();
  const vl = Number(row["VL"] ?? 0);

  const result = {
    chave_j: key,
    cnpj,
    company_name: company?.name ?? "?",
    cms_name: cmsName,
    proposal_number: contrato,
    vl,
    issues: [],
  };

  if (!company) {
    result.issues.push("company_nao_encontrado");
    review.push(result); reviewVl += vl; continue;
  }
  // Promoter real
  const pr = findPromoterByName(company.id, cmsName);
  if (pr.status !== "EXACT" && pr.status !== "STARTSWITH" && pr.status !== "CONTAINS") {
    result.issues.push(`promoter_${pr.status}`);
    if (pr.matches.length > 0) {
      result.candidatos = pr.matches.map((m) => ({ id: m.id, name: m.name }));
    }
    // Diagnostico extra: se NO_MATCH, lista promoters com PRIMEIRO NOME igual.
    if (pr.status === "NO_MATCH") {
      const firstWord = normName(cmsName).split(" ")[0];
      const sameFirst = promotersAll.filter((p) => p._norm.startsWith(firstWord + " "));
      if (sameFirst.length > 0) {
        result.proximos = sameFirst.map((m) => m.name).slice(0, 4);
      }
    }
    review.push(result); reviewVl += vl; continue;
  }
  result.to_promoter_id = pr.matches[0].id;
  result.to_promoter_name = pr.matches[0].name;
  result.to_promoter_company = companyById.get(pr.matches[0].company_id)?.name ?? "?";
  result.match_kind = pr.status;
  if (pr.matches[0].company_id !== company.id) {
    result.cross_company = true; // info: promoter cadastrado em outro CNPJ
  }
  // Record
  const recList = recsByProposal.get(contrato) ?? [];
  if (recList.length === 0) {
    result.issues.push("record_nao_encontrado_abr2026");
    review.push(result); reviewVl += vl; continue;
  }
  if (recList.length > 1) {
    result.issues.push(`record_${recList.length}_matches`);
    review.push(result); reviewVl += vl; continue;
  }
  const rec = recList[0];
  // Confirma que esta atribuida ao master atual e mesmo company + chave.
  if (rec.company_id !== company.id) {
    result.issues.push(`record_company_mismatch:${rec.company_id}`);
    review.push(result); reviewVl += vl; continue;
  }
  const masterIdAtual = sampleByKey[key];
  if (rec.assigned_promoter_id !== masterIdAtual) {
    // Idempotencia: se ja esta atribuido ao promotor real CERTO, conta
    // como JA_MIGRADO (sem-op). Se atribuido a OUTRO promotor, REVIEW.
    if (rec.assigned_promoter_id === result.to_promoter_id) {
      result.status_final = "JA_MIGRADO";
      result.assigned_atual_id = rec.assigned_promoter_id;
      jaMigrado.push(result); jaMigradoVl += vl; continue;
    }
    result.issues.push(`record_ja_nao_master_mas_outro:${rec.assigned_promoter_id}`);
    result.assigned_atual_id = rec.assigned_promoter_id;
    result.assigned_atual_name =
      promotersAll.find((p) => p.id === rec.assigned_promoter_id)?.name ??
      masterById.get(rec.assigned_promoter_id)?.name ??
      "?";
    review.push(result); reviewVl += vl; continue;
  }
  if (rec.j_key !== key) {
    // Atribuido ao master mas j_key diferente — alerta mas nao bloqueia.
    result.issues.push(`record_jkey_mismatch:${rec.j_key}`);
    review.push(result); reviewVl += vl; continue;
  }
  // Status do record deve ser Producao para garantir consistencia.
  if (rec.status !== "Produção") {
    result.issues.push(`record_status:${rec.status}`);
    // Cancelado/Em Aberto: ainda assim e valido migrar (operador da Promotiva
    // resolveu depois). Apenas alerta no review.
  }
  result.record_id = rec.id;
  result.record_net_value = rec.net_value;
  result.record_status = rec.status;
  result.from_promoter_id = masterIdAtual;
  result.from_promoter_name = masterById.get(masterIdAtual)?.name ?? "?";
  plan.push(result);
  prontoVl += vl;
}

// 7) Imprime tabela final.
console.log("\n=== PLANO (PRONTO PARA MIGRAR) ===");
console.log(
  `chave_j | proposal_number | vl       | de (master)              -> para (real)              | match_kind | status_rec`
);
for (const p of plan) {
  const cx = p.cross_company ? "*" : " ";
  console.log(
    `${p.chave_j} | ${p.proposal_number.padEnd(15)} | ${String(p.vl).padStart(8)} | ${p.to_promoter_name.padEnd(35).slice(0, 35)}${cx} | ${p.match_kind.padEnd(20)} | ${p.record_status} | ${p.to_promoter_company}`
  );
}
console.log("(* = promoter cadastrado em outro CNPJ — fix esperado)");
console.log(`\nTotal PRONTO: ${plan.length} propostas, VL R$ ${prontoVl.toFixed(2)}`);

console.log("\n=== JA MIGRADO (idempotencia — sem-op) ===");
for (const j of jaMigrado) {
  console.log(
    `${j.chave_j} | ${j.proposal_number.padEnd(15)} | ${String(j.vl).padStart(8)} | -> ${j.to_promoter_name}`
  );
}
console.log(`Total JA_MIGRADO: ${jaMigrado.length} propostas, VL R$ ${jaMigradoVl.toFixed(2)}`);

console.log("\n=== REQUER REVISAO MANUAL ===");
for (const r of review) {
  console.log(
    `${r.chave_j} | ${(r.proposal_number || "(sem contrato)").padEnd(15)} | ${String(r.vl).padStart(8)} | cms=${(r.cms_name||"-").padEnd(20)} | issues=${r.issues.join(",")}${r.assigned_atual_name ? " | atual=" + r.assigned_atual_name : ""}${r.candidatos ? " | candidatos=" + r.candidatos.map((c) => c.name).join("/") : ""}${r.proximos ? " | proximos_no_banco=" + r.proximos.join("/") : ""}`
  );
}
console.log("\n=== AMBIGUOS XLSX (resolver via CPF cms_*.xlsx aba GERAL) ===");
for (const r of ambigRows) {
  console.log(`${r["CHAVE J Master"]} | CPF=${r["CPF Banco"]} | VL=${r.VL} | candidatos: ${r["PROMOTOR REAL (cms)"]}`);
}
console.log("\n=== NAO ENCONTRADO XLSX ===");
for (const r of naoEncRows) {
  console.log(`${r["CHAVE J Master"]} | CPF=${r["CPF Banco"]} | VL=${r.VL}`);
}
console.log(`\nTotal REVIEW (OK do XLSX mas com issue): ${review.length} propostas, VL R$ ${reviewVl.toFixed(2)}`);
console.log(`Total AMBIGUO XLSX: ${ambigRows.length}`);
console.log(`Total NAO ENCONTRADO XLSX: ${naoEncRows.length}`);

// 8) SQL idempotente.
console.log("\n=== SQL IDEMPOTENTE (NAO EXECUTADO) ===");
console.log("BEGIN;");
for (const p of plan) {
  console.log(
    `UPDATE daily_production_records SET assigned_promoter_id = '${p.to_promoter_id}', promoter_source = 'MANUAL_REASSIGNMENT', updated_at = now() WHERE id = '${p.record_id}' AND assigned_promoter_id = '${p.from_promoter_id}';  -- ${p.chave_j} ${p.proposal_number} ${p.to_promoter_name}`
  );
  console.log(
    `INSERT INTO proposal_reassignments (daily_production_record_id, from_promoter_id, to_promoter_id, reason, changed_by) VALUES ('${p.record_id}', '${p.from_promoter_id}', '${p.to_promoter_id}', 'FIX-1.E.4 migracao programatica abr/2026', NULL);`
  );
}
console.log("-- COMMIT desabilitado: Diego executa manual apos revisar.\nROLLBACK;");
