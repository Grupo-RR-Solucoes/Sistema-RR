#!/usr/bin/env node
/**
 * scripts/bbts_fechamento_gate.cjs — GATE do parser do FECHAMENTO da ADS/BBTS (1B).
 * READ-ONLY: lê os PDFs, NÃO toca no banco, NÃO importa nada.
 *
 * Prova:
 *   (A) PRODUTO: as 3 colunas quebradas do PDF (Linha do Produto / Linha do Crédito
 *       / Nome do Convênio) agora são lidas por geometria — antes vinham null.
 *   (B) ROTEAMENTO: com o produto preenchido, inferCreditTable (o roteador do RR)
 *       manda o 137478 para NAO_CONSIGNADO_13 (13o salário) em vez de Público Geral.
 *   (C) PRT: a seção "Propostas do PAGAMENTO PRT" é capturada e fecha com a âncora
 *       "Pagamento PRT" do próprio PDF.
 *   (D) AVT: Σ pag à vista fecha com a âncora "Pagamento AVT".
 *
 * Uso: node scripts/bbts_fechamento_gate.cjs <pdf-credito> [pdf-tabela-bbts]
 */

require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { extractBbtsCreditoPdf } = require(path.join(ROOT, "lib", "bbtsPdfExtract.ts"));
const { resolverGrupoBbts } = require(path.join(ROOT, "lib", "bbts", "grupoBbts.ts"));
const { buildBbtsDraft } = require(path.join(ROOT, "lib", "bbts", "buildBbtsDraft.ts"));
const { mergeRawPayload } = require(path.join(ROOT, "lib", "dailyRecordMerge.ts"));

const brl = (n) => "R$ " + Number(n).toFixed(2).replace(".", ",");

async function main() {
  const PDF = process.argv[2];
  const PDF_TABELA = process.argv[3];
  if (!PDF || !fs.existsSync(PDF)) {
    console.error("Uso: node scripts/bbts_fechamento_gate.cjs <pdf-credito> [pdf-tabela-bbts]");
    process.exitCode = 1;
    return;
  }
  let fail = 0;

  const cred = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(PDF)));
  console.log(`=== FECHAMENTO ${String(cred.month).padStart(2, "0")}/${cred.year} — ${path.basename(PDF)} ===`);
  console.log(`  ancora Pagamento AVT: ${brl(cred.pagAvistaAnchor)} | ancora Pagamento PRT: ${brl(cred.pagPrtAnchor)}`);
  console.log(`  propostas AVT lidas: ${cred.rows.length} | parcelas PRT lidas: ${cred.prt.length}`);

  // (D) âncora AVT (o extrator já lança se não fechar — aqui só reportamos)
  const somaAvt = cred.rows.reduce((a, r) => a + (r.pag_avista || 0), 0);
  const okAvt = Math.abs(somaAvt - cred.pagAvistaAnchor) < 0.01;
  if (!okAvt) fail++;
  console.log(`  ${okAvt ? "OK  " : "FAIL"} (D) AVT: Sigma extraida ${brl(somaAvt)} == ancora do PDF`);

  // (A) produto por geometria
  const semProduto = cred.rows.filter((r) => !r.produto && !r.categoria);
  const okProd = semProduto.length === 0;
  if (!okProd) fail++;
  console.log(`  ${okProd ? "OK  " : "FAIL"} (A) produto lido em ${cred.rows.length - semProduto.length}/${cred.rows.length} propostas\n`);

  console.log("=== (A) COLUNAS LIDAS POR GEOMETRIA (antes: null) ===");
  console.log(
    "  " +
      "proposta".padEnd(11) +
      "conv".padEnd(8) +
      "linha do produto".padEnd(32) +
      "linha credito".padEnd(20) +
      "nome do convenio",
  );
  for (const r of cred.rows) {
    console.log(
      "  " +
        String(r.contrato).padEnd(11) +
        String(r.nr_convenio ?? "-").padEnd(8) +
        String(r.produto ?? "(null)").padEnd(32) +
        String(r.linha_credito ?? "(null)").padEnd(20) +
        String(r.categoria ?? "(null)"),
    );
  }

  // (B) roteamento — precisa da régua (só para os overrides); sem o PDF da tabela,
  //     usa uma régua mínima sem convênios de exceção (o roteador da TRP não depende dela).
  let regra = { convenios: {}, grupos: {}, _meta: {} };
  if (PDF_TABELA && fs.existsSync(PDF_TABELA)) {
    const draft = await buildBbtsDraft(new Uint8Array(fs.readFileSync(PDF_TABELA)), {});
    regra = draft.regraDraft;
  }
  console.log("\n=== (B) ROTEAMENTO (inferCreditTable com o produto agora preenchido) ===");
  const antes = new Map();
  for (const r of cred.rows) {
    const op = {
      convenio_code: r.nr_convenio,
      convenio_segment: r.segmento,
      convenio_type: r.linha_credito,
      taxa_juros: (r.juros_mensal ?? 0) / 100,
      prazo: r.parcelas ?? 0,
    };
    const semProd = resolverGrupoBbts({ ...op, product_description: null }, regra);
    const comProd = resolverGrupoBbts({ ...op, product_description: r.categoria ?? r.produto }, regra);
    const mudou = semProd.grupo !== comProd.grupo;
    const key = `${r.nr_convenio}|${r.categoria}`;
    if (!antes.has(key)) {
      antes.set(key, true);
      console.log(
        `  conv=${String(r.nr_convenio).padEnd(8)} produto="${String(r.categoria ?? "-").padEnd(34)}" ` +
          `ANTES=${semProd.grupo.padEnd(18)} AGORA=${comProd.grupo.padEnd(18)}${mudou ? "   <<< CORRIGIDO" : ""}`,
      );
    }
  }
  const r13 = cred.rows.find((r) => String(r.nr_convenio) === "137478");
  if (r13) {
    const g = resolverGrupoBbts(
      {
        convenio_code: r13.nr_convenio,
        convenio_segment: r13.segmento,
        product_description: r13.categoria ?? r13.produto,
        taxa_juros: (r13.juros_mensal ?? 0) / 100,
        prazo: r13.parcelas ?? 0,
      },
      regra,
    );
    const ok13 = g.grupo === "NAO_CONSIGNADO_13";
    if (!ok13) fail++;
    console.log(`  ${ok13 ? "OK  " : "FAIL"} (B) 137478 (13o salario) -> ${g.grupo} (tableKey=${g.tableKey})`);
  } else {
    console.log("  (137478 nao esta neste PDF)");
  }

  // (C) PRT
  console.log("\n=== (C) PRT — secao 'Propostas do PAGAMENTO PRT' (antes: descartada) ===");
  for (const p of cred.prt) {
    console.log(
      `  contrato=${String(p.contrato).padEnd(11)} data=${p.data}  parcela ${p.n_parcela}  ${brl(p.valor_parcela).padStart(10)}  qt=${p.qt_parcela ?? "#N/D"}`,
    );
  }
  const somaPrt = cred.prt.reduce((a, p) => a + (p.valor_parcela || 0), 0);
  const okPrt = Math.abs(somaPrt - cred.pagPrtAnchor) < 0.01 && cred.prt.length > 0;
  if (!okPrt) fail++;
  console.log(`  ${okPrt ? "OK  " : "FAIL"} (C) ${cred.prt.length} parcelas, Sigma ${brl(somaPrt)} == ancora 'Pagamento PRT' ${brl(cred.pagPrtAnchor)}`);

  // (E) merge: o __bbts_meta do fechamento sobrevive a um reimport da diaria
  console.log("\n=== (E) MERGE — reimportar a diaria NAO apaga mais o que a BBTS pagou ===");
  const doFechamento = { __bbts_meta: { fonte: "fechamento_pdf", pag_avista_relatorio: 143.5, taxa_relatorio: 2.87 } };
  const daDiaria = { __bbts_meta: { fonte: "diaria", transacao: "X", situacao: "OK" } };
  const merged = mergeRawPayload(doFechamento, daDiaria, true);
  const preservou = merged.__bbts_meta.pag_avista_relatorio === 143.5 && merged.__bbts_meta.taxa_relatorio === 2.87;
  if (!preservou) fail++;
  console.log(`  ${preservou ? "OK  " : "FAIL"} apos merge: ${JSON.stringify(merged.__bbts_meta)}`);

  console.log(`\nRESULTADO: ${fail === 0 ? "OK — 0 falhas" : `${fail} FALHAS`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
