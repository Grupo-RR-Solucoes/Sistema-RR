/* READ-ONLY. O TESTE DA DUPLICIDADE. Uma empresa, uma competencia: as propostas
   da aba "Seguro" (com comissao) INTERSECTAM as da aba "A Vista" (com
   COMISSAO SEGURO > 0)? Chave: CONTRATO (A Vista) x OPERACAO (Seguro). */
require("./_ts_register.cjs");
const XLSX = require("xlsx");
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
const chave = (v) => String(v ?? "").replace(/\D/g, "");

const ARQ = [
  ["2026-06 RR ALAGOAS 3", "C:/Users/diego/Downloads/C102665_55867409000100_Todos_6_2026.xlsx"],
  ["2026-01 RR ALAGOAS 3", "C:/Users/diego/Downloads/RRCRED/Relatório de Produção/Nova pasta/C72059_55867409000100_Todos_1_2026.xlsx"],
];

for (const [rot, p] of ARQ) {
  let wb; try { wb = XLSX.readFile(p); } catch (e) { console.log(`### ${rot} — ERRO: ${e.message}`); continue; }
  const nAv = wb.SheetNames.find((n) => norm(n).includes("A VISTA"));
  const nSe = wb.SheetNames.find((n) => norm(n) === "SEGURO");
  const av = XLSX.utils.sheet_to_json(wb.Sheets[nAv], { defval: "" });
  const se = nSe ? XLSX.utils.sheet_to_json(wb.Sheets[nSe], { defval: "" }) : [];

  const avCom = av.map((r) => ({ k: chave(pick(r, "CONTRATO")), v: parseNumber(pick(r, "COMISSAO SEGURO")) })).filter((r) => r.v > 0);
  const seCom = se.map((r) => ({ k: chave(pick(r, "OPERACAO")), kr: chave(pick(r, "OPERACAO RENOVADA")), v: parseNumber(pick(r, "COMISSAO")) }));
  const seComPos = seCom.filter((r) => r.v > 0);
  const seComNeg = seCom.filter((r) => r.v < 0);

  console.log("=".repeat(96));
  console.log(`### ${rot}`);
  console.log(`  aba "${nAv}": ${av.length} linhas | com COMISSAO SEGURO > 0: ${avCom.length}  Sigma = ${f(avCom.reduce((a, r) => a + r.v, 0))}`);
  console.log(`  aba "${nSe}": ${se.length} linhas | com COMISSAO > 0: ${seComPos.length}  Sigma = ${f(seComPos.reduce((a, r) => a + r.v, 0))}` +
              ` | com COMISSAO < 0: ${seComNeg.length}  Sigma = ${f(seComNeg.reduce((a, r) => a + r.v, 0))}`);

  const setAv = new Map(avCom.map((r) => [r.k, r.v]));
  console.log(`\n  --- TODA linha da aba "Seguro" (${se.length}) ---`);
  console.log(`  OPERACAO        COMISSAO   esta na A Vista com COMISSAO SEGURO>0?   valor la`);
  for (const r of seCom) {
    const hit = setAv.has(r.k);
    const hitR = r.kr && setAv.has(r.kr);
    console.log(`  ${String(r.k).padEnd(14)} ${f(r.v).padStart(10)}   ${hit ? "SIM (mesma OPERACAO)" : hitR ? "SIM (via OPERACAO RENOVADA)" : "NAO"}${hit ? "                 " + f(setAv.get(r.k)) : hitR ? "        " + f(setAv.get(r.kr)) : ""}`);
  }
  const inter = seCom.filter((r) => setAv.has(r.k));
  console.log(`\n  >>> INTERSECCAO por OPERACAO/CONTRATO: ${inter.length} de ${seCom.length} linhas da aba Seguro`);
  if (inter.length) {
    const mesmos = inter.filter((r) => Math.abs(r.v - setAv.get(r.k)) < 0.005);
    console.log(`  >>> desses, com o MESMO valor nas duas abas: ${mesmos.length}`);
  }

  // RESUMO
  const rn = wb.SheetNames.find((n) => norm(n) === "RESUMO");
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[rn], { header: 1, defval: "" });
  console.log(`\n  --- RESUMO, linhas com rotulo conhecido ---`);
  for (const row of rows) {
    const txt = row.map((c) => String(c ?? "").trim());
    const rot2 = txt.find((t) => t && isNaN(Number(t)));
    if (rot2 && /Comiss|Cancelamento|PRT Estoque|Penetra|Valor Nota|Tipo/i.test(rot2)) {
      console.log("      " + JSON.stringify(row));
    }
  }
  console.log("");
}
