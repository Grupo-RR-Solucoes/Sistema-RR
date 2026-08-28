/* READ-ONLY. Arquivos do layout ANTIGO (sem aba "Seguro"): o seguro vem como
   COLUNA "Comissao Seguro" dentro da aba A Vista (monthlyClosingImport.ts:1085-1098,
   toda linha CASH gera tambem uma entry INSURANCE). Soma essa coluna e compara
   com o valor_seguro do banco. */
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
  const n = Number(r); return Number.isFinite(n) ? n : 0;
};
const pick = (row, nomes) => {
  const ents = Object.entries(row);
  for (const alvo of nomes.map(norm)) {
    const hit = ents.find(([k]) => norm(k) === alvo);
    if (hit && hit[1] !== undefined && hit[1] !== null && hit[1] !== "") return hit[1];
  }
  return null;
};

const DIR = "C:/Users/diego/Downloads/RRCRED/Relatório de Produção";
const CNPJ = { ALAGOAS: "48357275000103", PERNAMBUCO: "51457289000103" };

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const porDig = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c]));
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro, valor_avista");
  const fechPor = new Map((fech || []).map((r) => [`${String(r.empresa_cnpj).replace(/\D/g, "")}|${r.ano}|${r.mes}`, r]));

  const alvos = [];
  for (const uf of ["ALAGOAS", "PERNAMBUCO"]) {
    let ents = []; try { ents = fs.readdirSync(path.join(DIR, uf)); } catch { continue; }
    for (const e of ents) {
      if (!/\.xlsx$/i.test(e) || /^~\$/.test(e)) continue;
      const m = e.match(/(\d{2})[.\-](\d{4})/);
      if (!m) continue;
      alvos.push({ p: path.join(DIR, uf, e), nome: e, cnpj: CNPJ[uf], mes: Number(m[1]), ano: Number(m[2]) });
    }
  }
  alvos.sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.cnpj.localeCompare(b.cnpj));

  console.log("comp     empresa   abas_A_Vista  linhas  col 'Comissao Seguro'?  Sigma coluna    | BANCO valor_seguro  INSURANCE");
  let totalDeclarado = 0, totalNoBanco = 0, semColuna = 0, buracos = [];
  for (const a of alvos) {
    let wb; try { wb = XLSX.readFile(a.p); } catch { continue; }
    const abaAv = wb.SheetNames.find((n) => norm(n).includes("A VISTA") || norm(n).includes("AVISTA"));
    if (!abaAv) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[abaAv], { defval: "" });
    const temCol = rows.length > 0 && Object.keys(rows[0]).some((k) => norm(k) === "COMISSAO SEGURO");
    let soma = 0;
    for (const r of rows) soma += parseNumber(pick(r, ["Comissao Seguro", "COMISSAO SEGURO"]));
    const emp = porDig.get(a.cnpj);
    const fr = fechPor.get(`${a.cnpj}|${a.ano}|${a.mes}`);
    let nIns = null;
    if (emp && fr) {
      const { count } = await sb.from("monthly_closing_entries").select("*", { count: "exact", head: true }).eq("company_id", emp.id).eq("year", a.ano).eq("month", a.mes).eq("entry_type", "INSURANCE");
      nIns = count ?? 0;
    }
    if (!temCol) semColuna++;
    totalDeclarado += soma;
    totalNoBanco += fr ? Number(fr.valor_seguro) || 0 : 0;
    const d = soma - (fr ? Number(fr.valor_seguro) || 0 : 0);
    if (fr && Math.abs(d) > 0.01) buracos.push({ ...a, soma, banco: Number(fr.valor_seguro) || 0, nIns, d });
    console.log(`${a.ano}-${String(a.mes).padStart(2, "0")} ${(emp ? emp.name : a.cnpj).padEnd(15)} ${String(abaAv).padEnd(9)} ${String(rows.length).padStart(6)}  ${String(temCol).padEnd(20)} ${f(soma).padStart(12)}  | ${fr ? f(fr.valor_seguro).padStart(14) : "  (sem fechamento)"} ${nIns === null ? "" : String(nIns).padStart(10)}`);
  }
  console.log(`\narquivos do layout antigo SEM a coluna 'Comissao Seguro' na A Vista: ${semColuna}`);
  console.log(`Sigma 'Comissao Seguro' declarada nos arquivos : ${f(totalDeclarado)}`);
  console.log(`Sigma valor_seguro no banco (mesmas comps)     : ${f(totalNoBanco)}`);
  console.log(`\ndivergencias arquivo x banco (> 0,01): ${buracos.length}`);
  for (const b of buracos) console.log(`  ${b.ano}-${String(b.mes).padStart(2, "0")} arquivo=${f(b.soma).padStart(12)} banco=${f(b.banco).padStart(12)} delta=${f(b.d).padStart(12)} INSURANCE=${b.nIns}  ${b.nome}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
