/*
 * FRENTE 1: cadastra CARLA ADRIANA (AL3), BRUNA ALVES (AL2), FABIANA BEZERRA
 * (AL3) como promotoras (active=true; 58,33% novato por DEFAULT_SHARE, sem
 * profile) e MIGRA toda a producao das abas delas (552710 + propria) das chaves
 * MASTER/coletiva para elas, em TODOS os meses do cms. Reatribuicao por aba no
 * cms (ground truth, valores nao recalculam -> total do mes preservado).
 * Idempotente. Backup das entries afetadas antes. NAO cria j_keys (as 3 nao tem
 * chave individual; producao vem via master/coletiva — ver relatorio).
 */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fmt = x => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MES = { 1: "JAN", 2: "FEV", 3: "MAR", 5: "MAI" };
const NOVATAS = [
  { aba: "CARLA ADRIANA", cnpj: "55.867.409/0001-00" },
  { aba: "BRUNA ALVES", cnpj: "56.140.658/0001-53" },
  { aba: "FABIANA BEZERRA", cnpj: "55.867.409/0001-00" },
];

(async () => {
  const companies = (await sb.from("companies").select("id, cnpj, name")).data;
  const byCnpj = Object.fromEntries(companies.map(c => [c.cnpj, c]));
  const pn = new Map((await sb.from("promoters").select("id, name")).data.map(p => [p.id, p.name]));

  // backup das entries afetadas
  const affected = [];
  for (const n of NOVATAS) {
    const co = byCnpj[n.cnpj];
    const { data } = await sb.from("cms_promoter_entries").select("*").eq("company_id", co.id).eq("source_sheet", n.aba);
    affected.push(...data);
  }
  fs.writeFileSync(path.join(__dirname, "..", "scratch", "migrate_novatas_backup.json"), JSON.stringify(affected, null, 2));
  console.log(`BACKUP: ${affected.length} entries das 3 abas -> scratch/migrate_novatas_backup.json\n`);

  console.log("===== FRENTE 1 — cadastro + migração =====");
  for (const n of NOVATAS) {
    const co = byCnpj[n.cnpj];
    // cadastra (idempotente)
    let { data: prom } = await sb.from("promoters").select("id, name").eq("company_id", co.id).ilike("name", n.aba).maybeSingle();
    if (!prom) {
      const ins = await sb.from("promoters").insert({
        company_id: co.id, name: n.aba, status: "ACTIVE", active: true, is_master: false,
        notes: "Novata maio/2026. Cadastrada p/ migrar producao da aba (552710 + propria) das chaves master/coletiva. 58,33% novato (DEFAULT_SHARE).",
      }).select("id, name").single();
      if (ins.error) throw new Error("insert promoter " + n.aba + ": " + ins.error.message);
      prom = ins.data;
      console.log(`PROMOTER criado: ${prom.name} (${co.name}) id=${prom.id} active=true`);
    } else {
      console.log(`PROMOTER ja existe: ${prom.name} id=${prom.id} (idempotente)`);
    }
    pn.set(prom.id, prom.name);

    // de qual master/origem sai, por mes
    const { data: rows } = await sb.from("cms_promoter_entries").select("id, prod_month, promoter_id, j_key, promoter_credit, promoter_insurance").eq("company_id", co.id).eq("source_sheet", n.aba);
    const byOrigem = {};
    for (const r of rows) {
      if (r.promoter_id === prom.id) continue; // ja migrado
      const k = `${MES[r.prod_month]} | ${r.promoter_id ? pn.get(r.promoter_id) : "(órfã 552710)"}`;
      const v = byOrigem[k] || { n: 0, c: 0, s: 0 }; v.n++; v.c += Number(r.promoter_credit); v.s += Number(r.promoter_insurance); byOrigem[k] = v;
    }
    // migra
    const toMove = rows.filter(r => r.promoter_id !== prom.id).map(r => r.id);
    if (toMove.length) {
      for (let i = 0; i < toMove.length; i += 200) {
        const slice = toMove.slice(i, i + 200);
        const { error } = await sb.from("cms_promoter_entries").update({ promoter_id: prom.id }).in("id", slice);
        if (error) throw new Error("update " + n.aba + ": " + error.message);
      }
    }
    console.log(`  aba "${n.aba}": migradas ${toMove.length} linhas -> ${prom.name}`);
    for (const [k, v] of Object.entries(byOrigem)) console.log(`     saiu de  ${k}: ${v.n} linha(s) crédito ${fmt(v.c)} seguro ${fmt(v.s)}`);
  }
  console.log("\nFRENTE 1 — migração concluída. Rode run_pmr_cms.cjs 1 2 3 5 para reprocessar o PMR.");
})().catch(e => { console.error(e); process.exit(1); });
