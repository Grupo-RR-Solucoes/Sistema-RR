/* READ-ONLY. Exposicao equivalente no RR: quais ARQUIVOS o sistema registrou por
   (empresa, competencia) — e onde falta o "TODOS" ou onde a lista encolhe. */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  const { data: comps } = await sb.from("companies").select("id, name");
  const nome = new Map((comps || []).map((c) => [c.id, c.name]));

  const { data, error } = await sb
    .from("monthly_closing_imports")
    .select("*")
    .order("year", { ascending: true });
  if (error) throw error;
  console.log(`monthly_closing_imports: ${data.length} linhas`);
  if (data[0]) console.log("colunas:", Object.keys(data[0]).join(", "));

  const m = new Map();
  for (const r of data) {
    const k = `${String(r.year)}-${String(r.month).padStart(2, "0")} | ${nome.get(r.company_id) || r.company_id}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ produto: r.produto, arquivo: r.file_name || r.arquivo || r.codigo_arquivo, status: r.status });
  }
  console.log("\ncompetencia | empresa                  | arquivos registrados (produto)");
  for (const [k, v] of [...m].sort()) {
    const temTodos = v.some((x) => x.produto === "TODOS");
    console.log(`${k.padEnd(42)} ${temTodos ? "   " : "!! "}${v.map((x) => x.produto).join(" + ")}`);
  }
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
