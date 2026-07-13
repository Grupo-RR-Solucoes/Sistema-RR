#!/usr/bin/env node
/**
 * scripts/bbts_resolver_gate.cjs — GATE do roteador + resolver da régua BBTS (1A).
 * READ-ONLY: não toca no banco (usa um client STUB) e não grava nada.
 *
 * Prova três coisas:
 *   (A) ROTEADOR: os convênios do fechamento de junho (1640, 113877, 137478) são
 *       roteados para o grupo da tabela BBTS pelo MESMO roteador do RR
 *       (inferCreditTable), sem cadastro novo. Mostra o efeito de ter (ou não) o
 *       produto no registro.
 *   (B) OVERRIDE: um convênio da lista de exceções do PDF (Bonificado/Reduzidos)
 *       recebe o MODIFICADOR sobre o grupo-base do roteador.
 *   (C) FALLBACK: junho/2026 (sem régua própria) resolve puxando a régua ATIVA de
 *       julho/2026 — fallback "posterior". E, com uma régua de maio no ar, junho
 *       passa a puxar a de maio ("anterior") — a precedência não muda.
 *   (D) FAIXA 4: o lookup devolve o devido pela Faixa 4 (acordo) e o split
 *       AVT (teto 6%) x PRT (excedente/prazo).
 *
 * Uso: node scripts/bbts_resolver_gate.cjs <caminho-do-pdf-da-tabela>
 */

require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { buildBbtsDraft } = require(path.join(ROOT, "lib", "bbts", "buildBbtsDraft.ts"));
const { resolverGrupoBbts } = require(path.join(ROOT, "lib", "bbts", "grupoBbts.ts"));
const { resolveBbtsRegraDb, lookupPctBbts } = require(path.join(ROOT, "lib", "bbts", "resolveBbtsRegra.ts"));

const pct = (d) => (d === null || d === undefined ? "—" : (d * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "%");

/** Client STUB do Supabase: responde bbts_rule_versions a partir de linhas em memória. */
function stubClient(rows) {
  return {
    from() {
      const filtros = [];
      let ord = null;
      const q = {
        select: () => q,
        eq: (col, val) => (filtros.push((r) => String(r[col]) === String(val)), q),
        lt: (col, val) => (filtros.push((r) => String(r[col]) < String(val)), q),
        gt: (col, val) => (filtros.push((r) => String(r[col]) > String(val)), q),
        order: (col, o) => ((ord = { col, asc: !!(o && o.ascending) }), q),
        limit: (n) => {
          const res = aplica().slice(0, n);
          return Promise.resolve({ data: res, error: null });
        },
        maybeSingle: () => {
          const res = aplica();
          return Promise.resolve({ data: res[0] ?? null, error: null });
        },
      };
      const aplica = () => {
        let out = rows.filter((r) => filtros.every((f) => f(r)));
        if (ord) out = out.sort((a, b) => (ord.asc ? 1 : -1) * String(a[ord.col]).localeCompare(String(b[ord.col])));
        return out;
      };
      return q;
    },
  };
}

async function main() {
  const PDF = process.argv[2];
  if (!PDF || !fs.existsSync(PDF)) {
    console.error("Uso: node scripts/bbts_resolver_gate.cjs <caminho-do-pdf-da-tabela>");
    process.exitCode = 1;
    return;
  }
  const draft = await buildBbtsDraft(new Uint8Array(fs.readFileSync(PDF)), { sourceFilename: path.basename(PDF) });
  const regra = draft.regraDraft;
  let fail = 0;

  // ---------------- (A) roteador nos 3 convênios de junho ----------------
  console.log("=== (A) ROTEADOR (inferCreditTable, o MESMO do RR) — convenios do fechamento de junho ===");
  const casos = [
    // como o dado ESTÁ hoje no banco (o parser do fechamento nao extrai o produto)
    { conv: "1640", juros: 0.0185, prazo: 108, desc: null, rot: "como esta hoje (sem produto)" },
    { conv: "113877", juros: 0.024, prazo: 96, desc: null, rot: "como esta hoje (sem produto)" },
    { conv: "137478", juros: 0.0411, prazo: 1, desc: null, rot: "como esta hoje (sem produto)" },
    // com o produto que o PDF do FECHAMENTO ja traz na linha (hoje descartado)
    { conv: "1640", juros: 0.0185, prazo: 108, desc: "INSS Novo", rot: "com o produto do PDF do fechamento" },
    { conv: "1640", juros: 0.0185, prazo: 108, desc: "INSS Renovacao", rot: "com o produto do PDF do fechamento" },
    { conv: "137478", juros: 0.0411, prazo: 1, desc: "Credito 13o Salario", rot: "com o produto do PDF do fechamento" },
    { conv: "000001640", juros: 0.0185, prazo: 108, desc: null, rot: "zero-padding (normConvenio)" },
  ];
  for (const c of casos) {
    const r = resolverGrupoBbts(
      { convenio_code: c.conv, product_description: c.desc, taxa_juros: c.juros, prazo: c.prazo },
      regra,
    );
    console.log(
      `  conv=${String(c.conv).padEnd(9)} produto=${String(c.desc ?? "(null)").padEnd(20)} -> tableKey=${String(r.tableKey).padEnd(22)} grupo=${r.grupo}   [${c.rot}]`,
    );
  }

  // ---------------- (B) override das exceções do PDF ----------------
  console.log("\n=== (B) OVERRIDE (exececoes listadas no PDF: Bonificado / Reduzidos) ===");
  console.log(`  a regua traz ${Object.keys(regra.convenios).length} convenios de excecao:`);
  for (const [code, v] of Object.entries(regra.convenios)) {
    console.log(`    ${code.padEnd(8)} ${v.grupo.padEnd(28)} ${v.nome}`);
  }
  const overrideCasos = [
    { conv: "139417", desc: null, esperado: "PUBLICO_DEMAIS_BONIFICADO", rot: "Pref Porto Alegre (bonificado) sobre PUBLICO_DEMAIS" },
    { conv: "215415", desc: null, esperado: "GRUPAMENTO_MG_SP_REDUZIDOS", rot: "UNESP (reduzido) sobre SP_MG -> variante do MG/SP" },
    { conv: "140274", desc: null, esperado: "PUBLICO_DEMAIS_REDUZIDOS", rot: "TJSC (reduzido) sobre PUBLICO_DEMAIS" },
  ];
  for (const c of overrideCasos) {
    const r = resolverGrupoBbts(
      { convenio_code: c.conv, product_description: c.desc, taxa_juros: 0.019, prazo: 84 },
      regra,
    );
    const ok = r.grupo === c.esperado;
    if (!ok) fail++;
    console.log(`  ${ok ? "OK  " : "FAIL"} conv=${c.conv} -> ${r.grupo} (mod=${r.modificador}) — ${c.rot}`);
  }

  // ---------------- (C) fallback ----------------
  console.log("\n=== (C) FALLBACK do resolver (client stub, sem banco) ===");
  const linhaJulho = { id: "v-jul", competencia: "2026-07-01", version_no: 1, is_active: true, regra_json: regra };
  const linhaMaio = { id: "v-mai", competencia: "2026-05-01", version_no: 1, is_active: true, regra_json: regra };

  const soJulho = stubClient([linhaJulho]);
  const jun = await resolveBbtsRegraDb({ competencia: "2026-06" }, soJulho);
  const okJun = jun && jun.competenciaFornecedora === "2026-07" && jun.direcao === "posterior" && jun.isFallback;
  if (!okJun) fail++;
  console.log(
    `  ${okJun ? "OK  " : "FAIL"} junho/2026 (sem regua propria) -> fornecedora=${jun && jun.competenciaFornecedora} direcao=${jun && jun.direcao} fallback=${jun && jun.isFallback}`,
  );
  console.log(`       vigencia devolvida = a do ALVO (junho): ${jun && jun.validFrom} .. ${jun && jun.validUntil}`);

  const jul = await resolveBbtsRegraDb({ competencia: "2026-07" }, soJulho);
  const okJul = jul && !jul.isFallback && jul.direcao === null;
  if (!okJul) fail++;
  console.log(`  ${okJul ? "OK  " : "FAIL"} julho/2026 (regua propria) -> exata, fallback=${jul && jul.isFallback}`);

  const maiEJul = stubClient([linhaMaio, linhaJulho]);
  const jun2 = await resolveBbtsRegraDb({ competencia: "2026-06" }, maiEJul);
  const okJun2 = jun2 && jun2.competenciaFornecedora === "2026-05" && jun2.direcao === "anterior";
  if (!okJun2) fail++;
  console.log(
    `  ${okJun2 ? "OK  " : "FAIL"} junho com regua de MAIO no ar -> fornecedora=${jun2 && jun2.competenciaFornecedora} direcao=${jun2 && jun2.direcao} (anterior GANHA de posterior)`,
  );

  const vazio = await resolveBbtsRegraDb({ competencia: "2026-06" }, stubClient([]));
  const okVazio = vazio === null;
  if (!okVazio) fail++;
  console.log(`  ${okVazio ? "OK  " : "FAIL"} banco sem nenhuma regua -> null (o chamador decide; nao inventa regra)`);

  const porData = await resolveBbtsRegraDb({ contractDate: "2026-06-15" }, soJulho);
  const okData = porData && porData.competenciaAlvo === "2026-06";
  if (!okData) fail++;
  console.log(`  ${okData ? "OK  " : "FAIL"} por contract_date 2026-06-15 -> competencia alvo ${porData && porData.competenciaAlvo} (janela holiday-aware reusada da TRP)`);

  // ---------------- (D) lookup na Faixa 4 + split AVT/PRT ----------------
  console.log("\n=== (D) LOOKUP na FAIXA 4 (acordo) + split AVT (teto 6%) x PRT ===");
  const ops = [
    { rot: "INSS 108p (pago 2,87% = Faixa 1)", op: { convenio_code: "1640", taxa_juros: 0.0185, prazo: 108, product_description: null } },
    { rot: "INSS 48p  (pago 1,75% = Faixa 1)", op: { convenio_code: "1640", taxa_juros: 0.0185, prazo: 48, product_description: null } },
    { rot: "Publico juros 2,40% 96p (pago 6% = teto)", op: { convenio_code: "113877", taxa_juros: 0.024, prazo: 96, product_description: null } },
    { rot: "fora da tabela: INSS prazo 36 (pago 0%)", op: { convenio_code: "1640", taxa_juros: 0.0185, prazo: 36, product_description: null } },
  ];
  for (const { rot, op } of ops) {
    const res = lookupPctBbts(regra, op); // faixa default = FAIXA_ADS
    if (!res.ok) {
      console.log(`  ${rot}\n      SEM CELULA -> ${res.motivo}`);
      continue;
    }
    const f1 = lookupPctBbts(regra, op, { faixa: "Faixa 1" });
    console.log(
      `  ${rot}\n      grupo=${res.ok.grupo} celula=${res.ok.celulaIndex} | devido F4=${pct(res.ok.pctTabela)} ` +
        `(avista ${pct(res.ok.pctAvista)} + PRT ${pct(res.ok.pctDiferido)} => ${pct(res.ok.pctDiferidoMensal)}/mes x ${op.prazo}) ` +
        `| F1 seria ${f1.ok ? pct(f1.ok.pctTabela) : "—"}`,
    );
  }

  console.log(`\nRESULTADO: ${fail === 0 ? "OK — 0 falhas" : `${fail} FALHAS`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
