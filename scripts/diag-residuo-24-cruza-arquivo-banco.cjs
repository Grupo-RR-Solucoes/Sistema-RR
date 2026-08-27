/* READ-ONLY. A tabela decisiva: para cada ARQUIVO de fechamento Promotiva em
   disco -> tem aba de seguro? quantas linhas nela? o Resumo declara valor? -> e
   o que o BANCO tem para aquela (empresa, competencia). */
require("./_ts_register.cjs");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
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
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
};
// COPIA EXATA de readResumoAmount (monthlyClosingImport.ts:210-216)
const readResumoAmount = (row, i) => parseNumber(row[i + 2]) || parseNumber(row[i + 1]) || parseNumber(row[i + 3]);

const RAIZES = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED", "C:/Users/diego/Documents"];
function varrer(dir, prof) {
  const out = [];
  if (prof > 3) return out;
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...varrer(p, prof + 1));
    else if (/\.xlsx$/i.test(e.name) && !/^~\$/.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const porDigitos = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c]));
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro, valor_avista, valor_liquido");
  const fechPor = new Map((fech || []).map((r) => [`${String(r.empresa_cnpj).replace(/\D/g, "")}|${r.ano}|${r.mes}`, r]));

  const arquivos = [...new Set(RAIZES.flatMap((r) => varrer(r, 0)))];
  const linhas = [];
  for (const p of arquivos) {
    const base = path.basename(p);
    // padrao Promotiva: C#####_CNPJ_<nota>_MM_AAAA.xlsx
    const m = base.match(/^C\d+_(\d{14})_.+_(\d{1,2})_(\d{4})\.xlsx$/i);
    if (!m) continue;
    const [, cnpj, mes, ano] = m;
    let wb; try { wb = XLSX.readFile(p); } catch { continue; }
    if (!wb.SheetNames.some((n) => norm(n) === "RESUMO")) continue;

    const abaSeg = wb.SheetNames.find((n) => norm(n).includes("SEGURO"));
    let linhasSeg = 0;
    if (abaSeg) linhasSeg = Math.max(0, XLSX.utils.sheet_to_json(wb.Sheets[abaSeg], { defval: "" }).length);

    // Resumo, com a MESMA leitura do importador
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find((n) => norm(n) === "RESUMO")], { header: 1, defval: "" });
    const vals = new Map();
    for (const row of rows) row.forEach((cell, i) => {
      const lab = norm(cell);
      if (["COMISSAO A VISTA", "COMISSAO SEGUROS", "COMISSAO PRT", "CANCELAMENTO SEGURO", "PRT ESTOQUE SEGURO", "CREDITO", "DEBITO"].includes(lab)) vals.set(lab, readResumoAmount(row, i));
    });
    const resumoSeguro = (vals.get("COMISSAO SEGUROS") || 0) + (vals.get("PRT ESTOQUE SEGURO") || 0);
    const resumoAvista = (vals.get("COMISSAO A VISTA") || 0) + (vals.get("CREDITO") || 0);
    const resumoTemValor = [...vals.values()].some((v) => Math.abs(v) > 0.005);

    const emp = porDigitos.get(cnpj);
    const k = `${cnpj}|${Number(ano)}|${Number(mes)}`;
    const fr = fechPor.get(k);
    let nIns = null;
    if (emp && fr) {
      const { count } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("company_id", emp.id).eq("year", Number(ano)).eq("month", Number(mes)).eq("entry_type", "INSURANCE");
      nIns = count ?? 0;
    }
    linhas.push({ base, emp: emp ? emp.name : `CNPJ ${cnpj}`, ano: Number(ano), mes: Number(mes), abaSeg: abaSeg || null, linhasSeg, resumoSeguro, resumoAvista, resumoTemValor, nIns, fr });
  }

  linhas.sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.emp.localeCompare(b.emp));
  console.log(`arquivos de fechamento Promotiva casados pelo nome: ${linhas.length}\n`);
  console.log("comp     empresa          aba_seguro     linhas  Resumo:ComSeg  Resumo tem valor  | BANCO: INSURANCE  valor_seguro");
  for (const l of linhas) {
    console.log(`${l.ano}-${String(l.mes).padStart(2, "0")} ${String(l.emp).padEnd(16)} ${String(l.abaSeg ?? "(NAO TEM)").padEnd(12)} ${String(l.linhasSeg).padStart(6)} ${f(l.resumoSeguro).padStart(13)}  ${String(l.resumoTemValor).padEnd(16)} | ${l.nIns === null ? "  (sem fechamento)" : String(l.nIns).padStart(9)}  ${l.fr ? f(l.fr.valor_seguro).padStart(12) : ""}`);
  }

  const semAba = linhas.filter((l) => !l.abaSeg);
  const semAbaComResumo = semAba.filter((l) => Math.abs(l.resumoSeguro) > 0.005);
  console.log(`\n>>> arquivos SEM aba de seguro: ${semAba.length}`);
  console.log(`>>> desses, com "Comissao Seguros" DECLARADO no Resumo > 0: ${semAbaComResumo.length}`);
  console.log(`>>> Sigma da Comissao Seguros declarada nesses: ${f(semAbaComResumo.reduce((a, l) => a + l.resumoSeguro, 0))}`);
  const comAbaSemLinha = linhas.filter((l) => l.abaSeg && l.nIns === 0);
  console.log(`>>> arquivos COM aba de seguro e ZERO linha INSURANCE no banco: ${comAbaSemLinha.length}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
