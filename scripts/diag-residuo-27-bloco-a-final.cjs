/* READ-ONLY. BLOCO A, medicao final. O seguro do arquivo esta em DOIS lugares:
     aba "A Vista"  -> coluna "COMISSAO SEGURO"   (seguro atrelado ao credito)
     aba "Seguro"   -> coluna " COMISSAO "        (estoque/PRT de seguro, com cancelados)
   O importador le os DOIS (monthlyClosingImport.ts:1085-1098 para o primeiro,
   inferSheetType->INSURANCE para o segundo). No banco, os POSITIVOS viram
   valor_seguro e os NEGATIVOS viram valor_estorno (linha 1521-1527).
   Deduplica por NOME DE ARQUIVO (o mesmo arquivo existe em 2 diretorios). */
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
const RAIZES = ["C:/Users/diego/Downloads", "C:/Users/diego/Downloads/RRCRED", "C:/Users/diego/Documents"];
function varrer(d, p) { const o = []; if (p > 3) return o; let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return o; }
  for (const x of e) { const q = path.join(d, x.name); if (x.isDirectory()) o.push(...varrer(q, p + 1)); else if (/\.xlsx$/i.test(x.name) && !/^~\$/.test(x.name)) o.push(q); } return o; }

(async () => {
  const { data: comps } = await sb.from("companies").select("id, cnpj, name");
  const porDig = new Map((comps || []).map((c) => [String(c.cnpj).replace(/\D/g, ""), c]));
  const { data: fech } = await sb.from("fechamento_mensal_empresa").select("empresa_cnpj, ano, mes, valor_seguro, valor_estorno");
  const fechPor = new Map((fech || []).map((r) => [`${String(r.empresa_cnpj).replace(/\D/g, "")}|${r.ano}|${r.mes}`, r]));

  // DEDUPLICA POR NOME (o mesmo arquivo existe em 2 arvores de diretorio)
  const porNome = new Map();
  for (const p of RAIZES.flatMap((r) => varrer(r, 0))) {
    const b = path.basename(p);
    if (!/^C\d+_\d{14}_.+_([1-9]|1[0-2])_2026\.xlsx$/i.test(b)) continue;
    if (!porNome.has(b)) porNome.set(b, p);
  }
  console.log(`arquivos de fechamento de 2026 em disco (unicos por nome): ${porNome.size}\n`);

  const acc = new Map();
  for (const [b, p] of porNome) {
    const m = b.match(/^C\d+_(\d{14})_.+_(\d{1,2})_(\d{4})\.xlsx$/i);
    const [, cnpj, mes, ano] = m;
    const emp = porDig.get(cnpj); if (!emp) continue;
    let wb; try { wb = XLSX.readFile(p); } catch { continue; }
    const k = `${ano}-${String(mes).padStart(2, "0")}|${emp.name}|${cnpj}|${ano}|${mes}`;
    let a = acc.get(k);
    if (!a) { a = { avistaPos: 0, avistaNeg: 0, segPos: 0, segNeg: 0, nAvista: 0, nSeg: 0, arquivos: [] }; acc.set(k, a); }
    a.arquivos.push(b);

    const abaAv = wb.SheetNames.find((n) => norm(n).includes("A VISTA") || norm(n).includes("AVISTA"));
    if (abaAv) for (const r of XLSX.utils.sheet_to_json(wb.Sheets[abaAv], { defval: "" })) {
      const v = parseNumber(pick(r, "COMISSAO SEGURO"));
      if (v > 0) { a.avistaPos += v; a.nAvista++; } else if (v < 0) a.avistaNeg += v;
    }
    const abaSeg = wb.SheetNames.find((n) => norm(n) === "SEGURO");
    if (abaSeg) for (const r of XLSX.utils.sheet_to_json(wb.Sheets[abaSeg], { defval: "" })) {
      const v = parseNumber(pick(r, "COMISSAO"));
      if (v > 0) { a.segPos += v; a.nSeg++; } else if (v < 0) a.segNeg += v;
    }
  }

  console.log("comp     empresa         A Vista(+)   Seguro(+)   TOTAL(+)  | banco valor_seguro   delta  | negativos  banco estorno");
  let deltaTotal = 0;
  for (const [k, a] of [...acc].sort()) {
    const [comp, nome, cnpj, ano, mes] = k.split("|");
    const fr = fechPor.get(`${cnpj}|${Number(ano)}|${Number(mes)}`);
    const pos = a.avistaPos + a.segPos;
    const banco = fr ? Number(fr.valor_seguro) || 0 : 0;
    const d = pos - banco; deltaTotal += d;
    const neg = Math.abs(a.avistaNeg + a.segNeg);
    console.log(`${comp} ${nome.padEnd(15)} ${f(a.avistaPos).padStart(11)} ${f(a.segPos).padStart(11)} ${f(pos).padStart(11)} | ${f(banco).padStart(14)} ${f(d).padStart(9)} | ${f(neg).padStart(10)} ${fr ? f(fr.valor_estorno).padStart(13) : ""}${Math.abs(d) > 0.01 ? "   <<< DIVERGE" : ""}`);
  }
  console.log(`\nSigma delta (arquivo positivo - banco valor_seguro): ${f(deltaTotal)}`);
  console.log(`competencias-empresa medidas: ${acc.size}`);
})().catch((e) => { console.error("ERRO:", (e && e.stack) || e); process.exit(1); });
