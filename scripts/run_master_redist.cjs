/*
 * ETAPA 2 — redistribuicao master->promotor em massa. Esvazia as 4 chaves master
 * (Renata AL/AL3, Maria Jose AL2, Juliana PE) mandando cada linha pro promotor
 * DONO DA ABA. Resolver robusto (acento + cross-empresa + nome completo). Total
 * por mes/empresa preservado (reatribuicao no cms, ground truth). Idempotente.
 * Backup das entries das masters antes.
 *
 * Casos especiais: DIEGO RODRIGUES = titular/socio -> nao e promotor, sua linha
 * FICA COM A EMPRESA (promoter_id=null). MAGNOLIA LEITE / IZABELA PACHECO = 0,00
 * -> SKIP (ficam onde estao). VINICIUS (2 grafias) e CAMILA CAVALCANTE (3
 * empresas) = 1 pessoa cada -> cadastro unico recebe as abas.
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const fmt = x => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PE = "51.457.289/0001-03", AL1 = "48.357.275/0001-03", AL2 = "56.140.658/0001-53", AL3 = "55.867.409/0001-00";

const NEW = [
  { name: "SUZANA DO NASCIMENTO", cnpj: PE, abas: ["SUZANA DO NASCIMENTO"] },
  { name: "DAYANE ABRAÃO", cnpj: AL3, abas: ["DAYANE ABRAAO"] },
  { name: "MARIA ROSIMERE", cnpj: PE, abas: ["MARIA ROSIMERE"] },
  { name: "JAMILLY KÉTILLY", cnpj: PE, abas: ["JAMILLY KETILLY"] },
  { name: "MARIA KELINE", cnpj: PE, abas: ["MARIA KELINE"] },
  { name: "EMILY RAMOS", cnpj: PE, abas: ["EMILY RAMOS"] },
  { name: "DEYVISON GABRIEL", cnpj: AL3, abas: ["DEYVISON GABRIEL"] },
  { name: "RENATO PORTO", cnpj: AL1, abas: ["RENATO PORTO"] },
  { name: "CYNTHIA ELVIRA", cnpj: AL1, abas: ["CYNTHIA ELVIRA"] },
  { name: "VINÍCIUS BERNARDO", cnpj: AL3, abas: ["VINICIUS BERNARDO", "VINICIUS BERNADO"] }, // 1 pessoa, 2 grafias
  { name: "CAMILA CAVALCANTE", cnpj: AL1, abas: ["CAMILA CAVALCANTE"] }, // 1 pessoa, 3 empresas
];
const SPECIAL = { "DIEGO RODRIGUES": "COMPANY", "MAGNOLIA LEITE": "SKIP", "IZABELA PACHECO": "SKIP" };

(async () => {
  const companies = (await sb.from("companies").select("id, cnpj, name")).data;
  const idByCnpj = Object.fromEntries(companies.map(c => [c.cnpj, c.id]));
  let proms = (await sb.from("promoters").select("id, name, company_id")).data;
  const masters = proms.filter(p => norm(p.name).includes("CHAVE MASTER"));
  const masterIds = new Set(masters.map(m => m.id));

  // ---- backup ----
  const backup = [];
  for (const m of masters) { let f = 0; for (;;) { const { data } = await sb.from("cms_promoter_entries").select("*").eq("promoter_id", m.id).range(f, f + 999); backup.push(...data); if (data.length < 1000) break; f += 1000; } }
  fs.writeFileSync(path.join(__dirname, "..", "scratch", "master_redist_backup.json"), JSON.stringify(backup, null, 2));
  console.log(`BACKUP: ${backup.length} entries das 4 masters -> scratch/master_redist_backup.json\n`);

  // ---- cadastra novos (idempotente) ----
  console.log("=== cadastro de novos promotores ===");
  const explicitAba = new Map(); // abaNorm -> promoter_id
  for (const np of NEW) {
    const cid = idByCnpj[np.cnpj];
    let pr = proms.find(p => p.company_id === cid && norm(p.name) === norm(np.name));
    if (!pr) {
      const ins = await sb.from("promoters").insert({ company_id: cid, name: np.name, status: "ACTIVE", active: true, is_master: false, notes: "Redistribuicao master->promotor 04/06. Novato 58,33% (DEFAULT_SHARE)." }).select("id, name, company_id").single();
      if (ins.error) throw new Error("insert " + np.name + ": " + ins.error.message);
      pr = ins.data; proms.push(pr);
      console.log(`  criado: ${np.name}`);
    } else console.log(`  ja existe: ${np.name}`);
    for (const a of np.abas) explicitAba.set(norm(a), pr.id);
  }

  // ---- resolver robusto ----
  const candidates = proms.filter(p => !masterIds.has(p.id));
  // alias de grafia p/ promotor JA existente (Diego: nao cadastrar):
  // "WILLIANA DA COSTA" (2 L na aba) = "WILIANA DA COSTA SILVA" (1 L no cadastro).
  const wiliana = candidates.find(p => /WIL+IANA/.test(norm(p.name)) && norm(p.name).includes("COSTA"));
  if (wiliana) { explicitAba.set("WILLIANA DA COSTA", wiliana.id); explicitAba.set("WILIANA DA COSTA", wiliana.id); console.log(`  alias grafia: WILLIANA DA COSTA -> ${wiliana.name}`); }
  function resolve(sheet) {
    const s = norm(sheet);
    if (SPECIAL[s] === "COMPANY") return { kind: "COMPANY" };
    if (SPECIAL[s] === "SKIP") return { kind: "SKIP" };
    if (explicitAba.has(s)) return { kind: "PROMOTER", id: explicitAba.get(s) };
    if (s.includes("MASTER")) return { kind: "SKIP" };
    const exact = candidates.filter(p => norm(p.name) === s);
    if (exact.length === 1) return { kind: "PROMOTER", id: exact[0].id };
    const pre = candidates.filter(p => { const n = norm(p.name); return n.startsWith(s + " ") || s.startsWith(n + " "); });
    if ([...new Set(pre.map(p => p.id))].length === 1) return { kind: "PROMOTER", id: pre[0].id };
    const toks = s.split(/\s+/).filter(Boolean);
    if (toks.length >= 2) { const fl = candidates.filter(p => { const n = norm(p.name); return n.includes(toks[0]) && n.includes(toks[toks.length - 1]); }); if ([...new Set(fl.map(p => p.id))].length === 1) return { kind: "PROMOTER", id: fl[0].id }; }
    return { kind: "UNRESOLVED" };
  }

  // ---- reatribui ----
  console.log("\n=== redistribuição ===");
  const pnAll = new Map(proms.map(p => [p.id, p.name]));
  const updates = { toPromoter: new Map(), toCompany: [], unresolved: new Map() };
  for (const e of backup) {
    const r = resolve(e.source_sheet);
    if (r.kind === "PROMOTER") { (updates.toPromoter.get(r.id) || updates.toPromoter.set(r.id, []).get(r.id)).push(e.id); }
    else if (r.kind === "COMPANY") updates.toCompany.push(e.id);
    else if (r.kind === "UNRESOLVED") { const k = e.source_sheet; const v = updates.unresolved.get(k) || { n: 0, c: 0 }; v.n++; v.c += Number(e.promoter_credit); updates.unresolved.set(k, v); }
  }
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  let movedP = 0;
  for (const [pid, ids] of updates.toPromoter) { for (const c of chunk(ids, 200)) { const { error } = await sb.from("cms_promoter_entries").update({ promoter_id: pid }).in("id", c); if (error) throw new Error(error.message); } movedP += ids.length; }
  for (const c of chunk(updates.toCompany, 200)) { const { error } = await sb.from("cms_promoter_entries").update({ promoter_id: null }).in("id", c); if (error) throw new Error(error.message); }
  console.log(`  ${movedP} linhas -> promotores | ${updates.toCompany.length} linhas -> EMPRESA (Diego Rodrigues, promoter_id=null)`);
  if (updates.unresolved.size) { console.log("  ⚠ NÃO RESOLVIDAS (ficam na master):"); for (const [k, v] of updates.unresolved) console.log(`     "${k}": ${v.n} linha(s) ${fmt(v.c)}`); }

  // ---- residual nas masters ----
  console.log("\n=== residual nas masters (deve ~0) ===");
  for (const m of masters) { const { data } = await sb.from("cms_promoter_entries").select("promoter_credit, promoter_insurance").eq("promoter_id", m.id); const c = data.reduce((s, r) => s + Number(r.promoter_credit), 0), seg = data.reduce((s, r) => s + Number(r.promoter_insurance), 0); console.log(`  ${m.name.slice(0, 40)}: ${data.length} linhas | crédito ${fmt(c)} seguro ${fmt(seg)}`); }
  console.log("\nETAPA 2 — redistribuição gravada. Rode run_pmr_cms.cjs 1 2 3 5.");
})().catch(e => { console.error(e); process.exit(1); });
