/* READ-ONLY. BLOCO A: onde esta o seguro nos arquivos de 2026 em disco.
   Varre TODAS as abas, acha TODA coluna com "SEGURO" no titulo, soma, e lista
   TODAS as linhas do Resumo com valor. Compara com o banco. */
require("./_ts_register.cjs");
const fs = require("fs"); const path = require("path"); const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
const parseNumber = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let r = String(v).trim().replace(/\s/g, "").replace("R$", "");
  if (r.includes(",") && r.includes(".")) r = r.lastIndexOf(",") > r.lastIndexOf(".") ? r.replace(/\./g, "").replace(",", ".") : r.replace(/,/g, "");
  else if (r.includes(",")) r = r.replace(/\./g, "").replace(",", ".");
  const n = Number(r); return Number.isFinite(n) ? n : 0;
};
const RAIZES = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED", "C:/Users/diego/Documents"];
function varrer(d, p) { const o = []; if (p > 3) return o; let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const x of e) { const q = path.join(d, x.name); if (x.isDirectory()) o.push(...varrer(q, p + 1)); else if (/\.xlsx$/i.test(x.name) && !/^~\$/.test(x.name)) o.push(q); } return o; }

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const porDig = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c]));
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro, valor_estorno, valor_avista");
  const fechPor = new Map((fech || []).map((r) => [`${String(r.empresa_cnpj).replace(/\D/g, "")}|${r.ano}|${r.mes}`, r]));

  const arquivos = [...new Set(RAIZES.flatMap((r) => varrer(r, 0)))]
    .filter((p) => /^C\d+_\d{14}_.+_([1-7])_2026\.xlsx$/i.test(path.basename(p)));
  console.log(`arquivos de fechamento de 2026 (meses 1-7) em disco: ${arquivos.length}\n`);

  const porComp = new Map();
  for (const p of arquivos) {
    const b = path.basename(p);
    const m = b.match(/^C\d+_(\d{14})_.+_(\d{1,2})_(\d{4})\.xlsx$/i);
    const [, cnpj, mes, ano] = m;
    const emp = porDig.get(cnpj);
    let wb; try { wb = XLSX.readFile(p); } catch { continue; }
    console.log("=".repeat(100));
    console.log(`### ${ano}-${String(mes).padStart(2, "0")}  ${emp ? emp.name : cnpj}   ${b}`);

    // (1) toda coluna com SEGURO no titulo, em TODA aba
    let somaArquivo = 0;
    for (const aba of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: "" });
      if (!rows.length) { if (norm(aba).includes("SEGURO")) console.log(`  aba ${JSON.stringify(aba)}: 0 linhas`); continue; }
      const colsSeg = Object.keys(rows[0]).filter((k) => norm(k).includes("SEGURO"));
      if (!colsSeg.length && !norm(aba).includes("SEGURO")) continue;
      const somas = {};
      for (const c of colsSeg) { let s = 0; for (const r of rows) s += parseNumber(r[c]); somas[c] = s; }
      // na aba Seguro, a coluna de comissao pode nao ter "seguro" no titulo
      const extras = {};
      if (norm(aba).includes("SEGURO")) for (const c of Object.keys(rows[0])) { if (colsSeg.includes(c)) continue; let s = 0, num = 0; for (const r of rows) { const v = parseNumber(r[c]); s += v; if (v) num++; } if (num) extras[c] = s; }
      console.log(`  aba ${JSON.stringify(aba)}: ${rows.length} linhas`);
      for (const [c, s] of Object.entries(somas)) console.log(`      col ${JSON.stringify(c).padEnd(34)} Sigma = ${f(s).padStart(14)}`);
      for (const [c, s] of Object.entries(extras)) console.log(`      col ${JSON.stringify(c).padEnd(34)} Sigma = ${f(s).padStart(14)}   (aba de seguro)`);
      for (const [c, s] of Object.entries(somas)) if (/COMISSAO SEGURO|VALOR COMISSAO SEGURO/.test(norm(c))) somaArquivo += s;
    }

    // (2) TODAS as linhas do Resumo com valor
    const rn = wb.SheetNames.find((n) => norm(n) === "RESUMO");
    if (rn) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[rn], { header: 1, defval: "" });
      const comValor = [];
      for (const row of rows) {
        const txt = row.map((c) => String(c ?? "").trim());
        const rot = txt.find((t) => t && isNaN(Number(t)));
        const nums = row.map(parseNumber).filter((v) => Math.abs(v) > 0.0000001);
        if (rot && nums.length) comValor.push(`${rot} -> ${nums.map((v) => f(v)).join(" | ")}`);
      }
      console.log(`  RESUMO — linhas COM valor (${comValor.length}):`);
      for (const l of comValor) console.log(`      ${l}`);
    }

    const fr = fechPor.get(`${cnpj}|${Number(ano)}|${Number(mes)}`);
    let nIns = null;
    if (emp && fr) { const { count } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("company_id", emp.id).eq("year", Number(ano)).eq("month", Number(mes)).eq("entry_type", "INSURANCE"); nIns = count ?? 0; }
    console.log(`  >>> Sigma colunas 'Comissao Seguro' do ARQUIVO: ${f(somaArquivo)}`);
    console.log(`  >>> BANCO valor_seguro=${fr ? f(fr.valor_seguro) : "(sem fechamento)"}  estorno=${fr ? f(fr.valor_estorno) : "-"}  linhas INSURANCE=${nIns}`);
    const k = `${ano}-${String(mes).padStart(2, "0")} ${emp ? emp.name : cnpj}`;
    porComp.set(k, { arquivo: (porComp.get(k)?.arquivo || 0) + somaArquivo, banco: fr ? Number(fr.valor_seguro) || 0 : 0, nIns });
    console.log("");
  }

  console.log("=".repeat(100));
  console.log("RESUMO FINAL — Sigma das colunas de comissao de seguro no ARQUIVO x valor_seguro no BANCO");
  console.log("comp     empresa            arquivo        banco         delta");
  let dTot = 0;
  for (const [k, v] of [...porComp].sort()) {
    const d = v.arquivo - v.banco; dTot += d;
    console.log(`${k.padEnd(28)} ${f(v.arquivo).padStart(12)} ${f(v.banco).padStart(12)} ${f(d).padStart(12)}${Math.abs(d) > 0.01 ? "   <<<" : ""}`);
  }
  console.log(`\nSigma delta (arquivo - banco): ${f(dTot)}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
