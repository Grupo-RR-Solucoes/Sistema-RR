#!/usr/bin/env node
/**
 * scripts/bbts_parser_gate.cjs — GATE do parser da tabela BBTS (1A). READ-ONLY.
 *
 * Roda lib/bbts/buildBbtsDraft.ts sobre o PDF da tabela e prova que o parser leu
 * a tabela CERTA, de duas formas independentes:
 *
 *   (a) CÉLULAS CONHECIDAS: confere valores lidos a olho no PDF (INSS Novo,
 *       SIAPE, Demais Públicos, Bonificado base+adicional, BB Energia, seguro).
 *       Qualquer divergência -> exit 1.
 *
 *   (b) CORROBORAÇÃO EXTERNA: os pagamentos que a BBTS fez em junho/2026
 *       (daily_production_records, __bbts_meta.taxa_relatorio) têm que cair em
 *       ALGUMA célula da matriz lida. Não é a auditoria (isso é a 1C) — é prova
 *       de que a matriz do parser é a mesma tabela que a BBTS usou para pagar.
 *       Opcional: só roda com .env.local (service-role).
 *
 * Uso: node scripts/bbts_parser_gate.cjs [caminho-do-pdf]
 */

require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { buildBbtsDraft } = require(path.join(ROOT, "lib", "bbts", "buildBbtsDraft.ts"));

const PDF = process.argv[2] || path.join(ROOT, "Tabela_de_Pagamento_BBTS.pdf");

const pct = (d) => (d === undefined || d === null ? "—" : (d * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "%");

/** Célula do grupo que casa com (juros, prazo). Limite null = aberto. */
function acharCelula(grupo, juros, prazo) {
  return (
    grupo.celulas.find((c) => {
      const txOk =
        (c.tx_min == null || juros >= c.tx_min - 1e-9) && (c.tx_max == null || juros <= c.tx_max + 1e-9);
      const przOk =
        (c.prazo_min == null || prazo >= c.prazo_min) && (c.prazo_max == null || prazo <= c.prazo_max);
      return txOk && przOk;
    }) || null
  );
}

async function main() {
  if (!fs.existsSync(PDF)) {
    console.error(`PDF nao encontrado: ${PDF}`);
    console.error("Uso: node scripts/bbts_parser_gate.cjs <caminho-do-pdf>");
    process.exit(1);
  }
  const bytes = new Uint8Array(fs.readFileSync(PDF));
  const draft = await buildBbtsDraft(bytes, { sourceFilename: path.basename(PDF) });
  const r = draft.regraDraft;

  console.log("=== META ===");
  console.log(`  competencia        ${r._meta.competencia} (vigencia PDF: ${r._meta.vigencia_pdf})`);
  console.log(`  vigencia (janela RR) ${r._meta.vigencia_inicio} .. ${r._meta.vigencia_fim}`);
  console.log(`  teto a vista       ${pct(r._meta.modelo_pagamento.avt_teto)}`);
  console.log(`  PRT                ${r._meta.modelo_pagamento.prt}`);
  console.log(`  faixas enquadr.    ${r._meta.faixas_enquadramento.map((f) => `${f.faixa}: ${f.prod_min}..${f.prod_max ?? "+inf"}`).join(" | ")}`);
  console.log(`  celulas            ${draft.meta.total_celulas} em ${Object.keys(r.grupos).length} grupos`);
  console.log("");
  console.log("=== CELULAS POR GRUPO ===");
  for (const [k, n] of Object.entries(draft.meta.celulas_por_grupo)) console.log(`  ${k.padEnd(28)} ${n}`);
  console.log("");

  // ---------------- (a) células conhecidas (conferidas a olho no PDF) ----------------
  const casos = [
    // [grupo, indice, faixa, esperado base, esperado adicional]
    ["INSS_NOVO", 0, "Faixa 4", 0.0212, undefined, "48 a 60 -> 2,12%"],
    ["INSS_NOVO", 2, "Faixa 4", 0.0348, undefined, "Acima de 84 -> 3,48%"],
    ["INSS_NOVO", 2, "Faixa 1", 0.0287, undefined, "Acima de 84 -> 2,87% (F1)"],
    ["INSS_RENOV", 1, "Faixa 4", 0.0255, undefined, "61 a 84 -> 2,55%"],
    ["SIAPE", 0, "Faixa 4", 0.0102, undefined, "1,64-1,67% -> 1,02%"],
    ["SIAPE", 2, "Faixa 5", 0.0369, undefined, "1,80% acima de 48 -> 3,69%"],
    ["GRUPAMENTO_MG_SP", 8, "Faixa 5", 0.1035, undefined, "a partir de 2,50% -> 10,35%"],
    ["PUBLICO_DEMAIS", 4, "Faixa 4", 0.051, undefined, "2,08-2,17% -> 5,10%"],
    ["PUBLICO_DEMAIS_BONIFICADO", 0, "Faixa 4", 0.0076, 0.0042, "1,70-1,77% -> 0,76% +0,42%"],
    ["PUBLICO_DEMAIS_BONIFICADO", 8, "Faixa 5", 0.1026, 0.0045, "a partir de 2,48% -> 10,26% +0,45%"],
    ["PUBLICO_DEMAIS_REDUZIDOS", 2, "Faixa 2", 0.02925, undefined, "1,88-1,97% -> 2,925%"],
    ["PRIVADO", 0, "Faixa 4", 0.0085, undefined, "18 a 35 -> 0,85%"],
    ["PORTAB_PUBLICO", 1, "Faixa 4", 0.0212, undefined, "a partir de 1,90% -> 2,12%"],
    ["NAO_CONSIGNADO", 5, "Faixa 4", 0.0892, undefined, "a partir de 5,39% -> 8,92%"],
    ["NAO_CONSIGNADO_13", 0, "Faixa 1", 0.021, undefined, "a partir de 3,25% -> 2,10%"],
    ["CDC_FGTS", 0, "Faixa 4", 0.0399, undefined, "36 a 84 -> 3,99%"],
    ["BB_ENERGIA", 0, "Faixa Unica", 0.02, undefined, "faixa unica -> 2,00%"],
  ];

  let ok = 0;
  let fail = 0;
  console.log("=== (a) CELULAS CONHECIDAS (parser x PDF) ===");
  for (const [grupo, idx, faixa, espBase, espAdic, rotulo] of casos) {
    const cel = r.grupos[grupo] && r.grupos[grupo].celulas[idx];
    const lido = cel && cel.faixas[faixa];
    const base = lido ? lido.base : undefined;
    const adic = lido ? lido.adicional : undefined;
    const okBase = base !== undefined && Math.abs(base - espBase) < 1e-9;
    const okAdic = espAdic === undefined ? adic === undefined : adic !== undefined && Math.abs(adic - espAdic) < 1e-9;
    const bom = okBase && okAdic;
    if (bom) ok++;
    else fail++;
    const faixaTxt = cel
      ? `juros ${cel.tx_min == null ? "—" : pct(cel.tx_min)}..${cel.tx_max == null ? "aberto" : pct(cel.tx_max)}, prazo ${cel.prazo_min ?? "—"}..${cel.prazo_max ?? "aberto"}`
      : "celula inexistente";
    console.log(
      `  ${bom ? "OK  " : "FAIL"} ${grupo}[${idx}].${faixa} = ${pct(base)}${adic !== undefined ? ` +${pct(adic)}` : ""}` +
        `  (esperado ${pct(espBase)}${espAdic !== undefined ? ` +${pct(espAdic)}` : ""}) — ${rotulo}  [${faixaTxt}]`,
    );
  }
  if (r.seguro) {
    const slip85 = r.seguro.slip.find((s) => s.prazo_max === null);
    const okSeg = slip85 && Math.abs(slip85.pct - 0.0035) < 1e-9 && Math.abs(r.seguro.estoque.pct - 0.001) < 1e-9;
    if (okSeg) ok++;
    else fail++;
    console.log(
      `  ${okSeg ? "OK  " : "FAIL"} SEGURO slip=[${r.seguro.slip.map((s) => `${s.prazo_min}-${s.prazo_max ?? "+"}:${pct(s.pct)}`).join(" ")}] estoque=${pct(r.seguro.estoque.pct)}`,
    );
  }
  console.log(`\n  (a) ${ok} OK / ${fail} FAIL de ${ok + fail}`);

  // ---------------- (b) corroboração: pagamentos de junho caem na matriz ----------------
  console.log("\n=== (b) CORROBORACAO — pagamentos de junho/26 x matriz lida ===");
  let sb = null;
  try {
    const { createClient } = require("@supabase/supabase-js");
    for (const f of [".env.local", ".env"]) {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) continue;
      for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });
    }
  } catch {
    /* sem supabase: pula (b) */
  }
  if (!sb) {
    console.log("  (pulado: sem service-role no .env.local)");
  } else {
    const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
    const { data, error } = await sb
      .from("daily_production_records")
      .select("proposal_number, gross_value, term_months, interest_rate, convenio_code, raw_payload")
      .eq("company_id", ADS)
      .gte("contract_date", "2026-06-01")
      .lte("contract_date", "2026-06-30");
    if (error) {
      console.log(`  ERRO ao ler junho: ${error.message}`);
    } else {
      // O grupo de cada convênio NÃO vem do PDF (ver relatório). Aqui inferimos o
      // grupo só para o TESTE, pelo padrão do dado de junho — NÃO é a régua.
      const grupoDeTeste = (conv, juros) => {
        if (conv === "1640") return "INSS_NOVO";
        if (juros >= 0.0325) return "NAO_CONSIGNADO_13";
        return "PUBLICO_DEMAIS";
      };
      let casaram = 0;
      let naoCasaram = 0;
      for (const rec of data || []) {
        const meta = (rec.raw_payload || {}).__bbts_meta || {};
        const taxaPaga = Number(meta.taxa_relatorio || 0) / 100;
        const juros = Number(rec.interest_rate || 0) / 100;
        const prazo = Number(rec.term_months || 0);
        const gkey = grupoDeTeste(String(rec.convenio_code), juros);
        const grupo = r.grupos[gkey];
        const cel = grupo ? acharCelula(grupo, juros, prazo) : null;
        if (!cel) {
          console.log(
            `  SEM CELULA  ${rec.proposal_number} conv=${rec.convenio_code} juros=${pct(juros)} prazo=${prazo} pago=${pct(taxaPaga)} (grupo ${gkey})`,
          );
          naoCasaram++;
          continue;
        }
        const achouFaixa = Object.entries(cel.faixas).find(
          ([, v]) => Math.abs(v.base - taxaPaga) < 1e-6,
        );
        const teto = Math.abs(taxaPaga - r._meta.modelo_pagamento.avt_teto) < 1e-9;
        if (achouFaixa) {
          casaram++;
          console.log(
            `  CASOU       ${rec.proposal_number} conv=${rec.convenio_code} juros=${pct(juros)} prazo=${prazo} pago=${pct(taxaPaga)} == ${gkey}[${grupo.celulas.indexOf(cel)}].${achouFaixa[0]}  (Faixa 4 da tabela = ${pct(cel.faixas["Faixa 4"] && cel.faixas["Faixa 4"].base)})`,
          );
        } else if (teto) {
          casaram++;
          console.log(
            `  CASOU-TETO  ${rec.proposal_number} conv=${rec.convenio_code} juros=${pct(juros)} prazo=${prazo} pago=${pct(taxaPaga)} = teto AVT (tabela F1=${pct(cel.faixas["Faixa 1"].base)}, F4=${pct(cel.faixas["Faixa 4"] && cel.faixas["Faixa 4"].base)})`,
          );
        } else {
          naoCasaram++;
          console.log(
            `  NAO CASOU   ${rec.proposal_number} conv=${rec.convenio_code} juros=${pct(juros)} prazo=${prazo} pago=${pct(taxaPaga)} | celula ${gkey}[${grupo.celulas.indexOf(cel)}]: ${Object.entries(cel.faixas).map(([k, v]) => `${k}=${pct(v.base)}`).join(" ")}`,
          );
        }
      }
      console.log(`\n  (b) ${casaram} casaram / ${naoCasaram} nao casaram de ${(data || []).length} contratos de junho`);
    }
  }

  console.log("\n=== CONFIANCA ===");
  console.log("  provado:");
  for (const p of draft.confianca.provado) console.log(`    - ${p}`);
  console.log("  conferir (o socio bate na tela):");
  for (const c of draft.confianca.conferir) {
    console.log(`    - [${c.grupo}${c.celula !== undefined ? `#${c.celula}` : ""}] ${c.motivo}`);
  }

  // exitCode (e não process.exit) — o worker do unpdf ainda está fechando; um
  // process.exit() aqui estoura assertion do libuv no Windows.
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
