/* READ-ONLY. Quais arquivos de fechamento registrados existem EM DISCO. */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const DIRS = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED", "C:/Users/diego/Documents", "."];
  const emDisco = new Set();
  for (const d of DIRS) {
    let ents = []; try { ents = fs.readdirSync(d); } catch { continue; }
    for (const e of ents) emDisco.add(e.toLowerCase());
  }
  console.log(`arquivos varridos em disco: ${emDisco.size}`);

  const { data, error } = await sb.from("monthly_closing_imports").select("company_id, year, month, file_name, status");
  if (error) throw error;
  const { data: comps } = await sb.from("companies").select("id, name");
  const nome = new Map((comps || []).map((c) => [c.id, c.name]));

  const porComp = new Map();
  for (const r of data) {
    const k = `${r.year}-${String(r.month).padStart(2, "0")} ${nome.get(r.company_id) || r.company_id}`;
    let b = porComp.get(k);
    if (!b) { b = new Set(); porComp.set(k, b); }
    b.add(String(r.file_name));
  }
  let comArquivo = 0, semArquivo = 0;
  const listaSem = [];
  for (const [k, arquivos] of [...porComp].sort()) {
    const achados = [...arquivos].filter((a) => emDisco.has(String(a).toLowerCase()));
    if (achados.length) { comArquivo++; console.log(`  EM DISCO  ${k}  ${achados.join(", ")}`); }
    else { semArquivo++; listaSem.push(k); }
  }
  console.log(`\ncompetencias-empresa com ALGUM arquivo em disco: ${comArquivo}`);
  console.log(`competencias-empresa SEM nenhum arquivo em disco:  ${semArquivo}`);
  if (semArquivo <= 120) console.log("\nsem arquivo:\n  " + listaSem.join("\n  "));
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
