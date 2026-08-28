/* READ-ONLY. VARREDURA DAS 100 competencias-empresa.
   Para cada uma, onde houver arquivo em disco: compara a coluna COMISSAO SEGURO
   da aba "A Vista" e a coluna COMISSAO da aba "Seguro" contra as linhas
   entry_type='INSURANCE' do banco, SEPARADAS POR sheet_name de origem.
   E o unico teste que pode revelar "o arquivo tem a coluna e o banco nao tem a linha". */
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
const pick = (row, alvo) => { const e = Object.entries(row).find(([k]) => norm(k) === norm(alvo)); return e ? e[1] : null; };
const EPS = 0.011;

// mapeia arquivo -> (cnpjDigitos, ano, mes). Dois padroes de nome.
const CNPJ_POR_CODIGO = { "98250": "48357275000103", "14692": "51457289000103" };
function identificar(base) {
  let m = base.match(/^C\d+_(\d{14})_.+_(\d{1,2})_(\d{4})\.xlsx$/i);
  if (m) return { cnpj: m[1], mes: Number(m[2]), ano: Number(m[3]) };
  m = base.match(/^(\d{5})\s*-\s*RR SOLUCOES.*?(\d{2})[.\-](\d{4})\.xlsx$/i);
  if (m && CNPJ_POR_CODIGO[m[1]]) return { cnpj: CNPJ_POR_CODIGO[m[1]], mes: Number(m[2]), ano: Number(m[3]) };
  return null;
}

const RAIZES = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED", "C:/Users/diego/Documents"];
function varrer(d, p) { const o = []; if (p > 4) return o; let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const x of e) { const q = path.join(d, x.name); if (x.isDirectory()) o.push(...varrer(q, p + 1)); else if (/\.xlsx$/i.test(x.name) && !/^~\$/.test(x.name)) o.push(q); } return o; }

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const porDig = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c]));
  const { data: fech, error } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro, valor_estorno");
  if (error) throw error;

  // arquivos, DEDUPLICADOS POR NOME (o mesmo arquivo existe em varias arvores)
  const porNome = new Map();
  for (const p of RAIZES.flatMap((r) => varrer(r, 0))) {
    const b = path.basename(p);
    if (!identificar(b)) continue;
    if (!porNome.has(b)) porNome.set(b, p);
  }
  const arquivosPorComp = new Map();
  for (const [b, p] of porNome) {
    const id = identificar(b);
    const k = `${id.cnpj}|${id.ano}|${id.mes}`;
    const arr = arquivosPorComp.get(k) ?? []; arr.push({ b, p }); arquivosPorComp.set(k, arr);
  }
  console.log(`arquivos identificaveis em disco (unicos por nome): ${porNome.size}`);
  console.log(`competencias-empresa no banco: ${fech.length}\n`);

  const batem = [], divergem = [], semArquivo = [];
  for (const r of fech.sort((a, b) => a.ano - b.ano || a.mes - b.mes)) {
    const dig = String(r.empresa_cnpj).replace(/\D/g, "");
    const emp = porDig.get(dig);
    const k = `${dig}|${r.ano}|${r.mes}`;
    const arqs = arquivosPorComp.get(k);
    const rot = `${r.ano}-${String(r.mes).padStart(2, "0")} ${emp ? emp.name : dig}`;
    if (!arqs || !arqs.length) { semArquivo.push(rot); continue; }

    // ARQUIVO
    let avFile = 0, segFile = 0, temColAv = false, temAbaSeg = false;
    for (const { p } of arqs) {
      let wb; try { wb = XLSX.readFile(p); } catch { continue; }
      const nAv = wb.SheetNames.find((n) => norm(n).includes("A VISTA") || norm(n).includes("AVISTA"));
      const nSe = wb.SheetNames.find((n) => norm(n) === "SEGURO");
      if (nAv) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[nAv], { defval: "" });
        if (rows.length && Object.keys(rows[0]).some((c) => norm(c) === "COMISSAO SEGURO")) temColAv = true;
        for (const x of rows) { const v = parseNumber(pick(x, "COMISSAO SEGURO")); if (v > 0) avFile += v; } }
      if (nSe) { temAbaSeg = true; for (const x of XLSX.utils.sheet_to_json(wb.Sheets[nSe], { defval: "" })) { const v = parseNumber(pick(x, "COMISSAO")); if (v > 0) segFile += v; } }
    }

    // BANCO, separado por aba de origem
    const { data: ins, error: e2 } = await sb.from("monthly_closing_entries")
      .select("sheet_name, commission_value").eq("company_id", emp.id).eq("year", r.ano).eq("month", r.mes).eq("entry_type", "INSURANCE");
    if (e2) throw e2;
    let avDb = 0, segDb = 0, outroDb = 0;
    for (const x of ins) { const v = Number(x.commission_value) || 0; if (v <= 0) continue;
      const s = norm(x.sheet_name);
      if (s.includes("A VISTA") || s.includes("AVISTA")) avDb += v; else if (s === "SEGURO") segDb += v; else outroDb += v; }

    const dAv = avFile - avDb, dSeg = segFile - segDb;
    const linha = { rot, avFile, avDb, dAv, segFile, segDb, dSeg, banco: Number(r.valor_seguro) || 0, temColAv, temAbaSeg, outroDb, arqs: arqs.map((a) => a.b) };
    if (Math.abs(dAv) <= EPS && Math.abs(dSeg) <= EPS) batem.push(linha); else divergem.push(linha);
  }

  console.log("=".repeat(112));
  console.log(`1) BATEM AO CENTAVO (A Vista e Seguro, os dois): ${batem.length}`);
  console.log("comp     empresa          A Vista arq   A Vista bd | Seguro arq   Seguro bd | banco valor_seguro");
  for (const l of batem) console.log(`${l.rot.padEnd(25)} ${f(l.avFile).padStart(11)} ${f(l.avDb).padStart(11)} | ${f(l.segFile).padStart(11)} ${f(l.segDb).padStart(10)} | ${f(l.banco).padStart(14)}`);

  console.log("\n" + "=".repeat(112));
  console.log(`2) DIVERGEM: ${divergem.length}`);
  if (divergem.length) {
    console.log("comp     empresa          A Vista arq   A Vista bd    delta | Seguro arq   Seguro bd    delta | arquivos");
    for (const l of divergem) console.log(`${l.rot.padEnd(25)} ${f(l.avFile).padStart(11)} ${f(l.avDb).padStart(11)} ${f(l.dAv).padStart(9)} | ${f(l.segFile).padStart(11)} ${f(l.segDb).padStart(10)} ${f(l.dSeg).padStart(9)} | ${l.arqs.join(", ")}`);
    console.log(`\n   Sigma delta A Vista: ${f(divergem.reduce((a, l) => a + l.dAv, 0))}`);
    console.log(`   Sigma delta Seguro : ${f(divergem.reduce((a, l) => a + l.dSeg, 0))}`);
  } else console.log("   (nenhuma)");

  console.log("\n" + "=".repeat(112));
  console.log(`3) SEM ARQUIVO EM DISCO PARA COMPARAR: ${semArquivo.length}`);
  console.log("   " + semArquivo.join("\n   "));
  console.log(`\nTOTAL: ${batem.length} batem + ${divergem.length} divergem + ${semArquivo.length} sem arquivo = ${batem.length + divergem.length + semArquivo.length}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
