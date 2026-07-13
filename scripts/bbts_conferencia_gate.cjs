#!/usr/bin/env node
/**
 * scripts/bbts_conferencia_gate.cjs — GATE DE SENSIBILIDADE da conferência ADS/BBTS.
 * READ-ONLY: lê o banco e os PDFs; NÃO escreve nada, em lugar nenhum.
 *
 * A pergunta que este gate responde: o motor PEGA o erro conhecido?
 * Junho/2026 foi pago na FAIXA 1 quando o acordo do Grupo RR/ADS é FAIXA 4. Se a
 * conferência não acusar isso, ela não serve.
 *
 * DE ONDE VEM CADA COISA (e por que):
 *   - o PAGO: do BANCO (coluna bbts_pag_avista, já backfillada — Σ 7.707,03).
 *   - o PRODUTO e o PRAZO DA OPERAÇÃO: do PDF do fechamento. O banco ainda tem
 *     product_description NULL porque o fechamento NÃO foi reimportado depois do
 *     fix 1B — quando for, esses campos passam a vir do banco e este enriquecimento
 *     some. O gate deixa isso EXPLÍCITO em vez de fingir que o banco já tem.
 *   - as PARCELAS PRT: do PDF (bbts_prt_parcelas ainda está vazia, mesmo motivo).
 *   - a RÉGUA: do PDF da tabela, injetada num client STUB de bbts_rule_versions
 *     como a versão ativa de 2026-07. Assim o FALLBACK junho->julho é exercitado
 *     pelo resolver DE VERDADE (resolveBbtsRegraDb), não simulado.
 *
 * Uso: node scripts/bbts_conferencia_gate.cjs <pdf-tabela-bbts> <pdf-fechamento>
 */

require("./_ts_register.cjs");

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const { buildBbtsDraft } = require(path.join(ROOT, "lib", "bbts", "buildBbtsDraft.ts"));
const { extractBbtsCreditoPdf } = require(path.join(ROOT, "lib", "bbtsPdfExtract.ts"));
const { resolveBbtsRegraDb } = require(path.join(ROOT, "lib", "bbts", "resolveBbtsRegra.ts"));
const { carregarUniversoBbtsDb, conferirBbts } = require(path.join(ROOT, "lib", "bbts", "conferenciaBbts.ts"));

const YM = "2026-06";
const brl = (n) => (n == null ? "—" : (n < 0 ? "-" : "") + "R$ " + Math.abs(n).toFixed(2).replace(".", ","));
const pctf = (d) => (d == null ? "—" : (d * 100).toFixed(2).replace(".", ",") + "%");

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/** Client STUB só para bbts_rule_versions (a régua ainda não foi subida pela tela). */
function stubRegua(rows) {
  return {
    from() {
      const filtros = [];
      let ord = null;
      const aplica = () => {
        let out = rows.filter((r) => filtros.every((f) => f(r)));
        if (ord) out = out.sort((a, b) => (ord.asc ? 1 : -1) * String(a[ord.col]).localeCompare(String(b[ord.col])));
        return out;
      };
      const q = {
        select: () => q,
        eq: (c, v) => (filtros.push((r) => String(r[c]) === String(v)), q),
        lt: (c, v) => (filtros.push((r) => String(r[c]) < String(v)), q),
        gt: (c, v) => (filtros.push((r) => String(r[c]) > String(v)), q),
        order: (c, o) => ((ord = { col: c, asc: !!(o && o.ascending) }), q),
        limit: (n) => Promise.resolve({ data: aplica().slice(0, n), error: null }),
        maybeSingle: () => Promise.resolve({ data: aplica()[0] ?? null, error: null }),
      };
      return q;
    },
  };
}

async function main() {
  const PDF_TABELA = process.argv[2];
  const PDF_FECH = process.argv[3];
  if (!PDF_TABELA || !PDF_FECH || !fs.existsSync(PDF_TABELA) || !fs.existsSync(PDF_FECH)) {
    console.error("Uso: node scripts/bbts_conferencia_gate.cjs <pdf-tabela-bbts> <pdf-fechamento>");
    process.exitCode = 1;
    return;
  }
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let fail = 0;

  // ---- 1. universo do PAGO: do BANCO ----
  const { contratos, prt: prtDb } = await carregarUniversoBbtsDb(sb, YM);
  console.log(`=== UNIVERSO (banco) — competencia ${YM} ===`);
  console.log(`  ${contratos.length} contratos ADS na janela de vigencia | Sigma pago a vista = ${brl(contratos.reduce((a, c) => a + c.pagoAvista, 0))}`);
  console.log(`  bbts_prt_parcelas no banco: ${prtDb.length} (vazio = fechamento ainda nao reimportado)`);

  // ---- 2. enriquecimento a partir do PDF do fechamento (produto/prazo/PRT) ----
  const fech = await extractBbtsCreditoPdf(new Uint8Array(fs.readFileSync(PDF_FECH)));
  const porContrato = new Map(fech.rows.map((r) => [String(r.contrato), r]));
  let semProduto = 0;
  for (const c of contratos) {
    const r = porContrato.get(c.contrato);
    if (!r) {
      semProduto++;
      continue;
    }
    if (!c.produto) c.produto = r.categoria ?? r.produto ?? null;
    if (c.prazoOperacao == null) c.prazoOperacao = r.prazo_operacao ?? null;
  }
  const prt = fech.prt.map((p) => ({ contrato: String(p.contrato), valor: p.valor_parcela, n_parcela: p.n_parcela }));
  console.log(`  produto/prazo enriquecidos do PDF do fechamento (banco ainda com product_description NULL): ${contratos.length - semProduto}/${contratos.length}`);
  console.log(`  parcelas PRT do PDF: ${prt.length} (Sigma ${brl(prt.reduce((a, p) => a + p.valor, 0))})\n`);

  // ---- 3. régua: PDF -> stub de bbts_rule_versions (2026-07) -> resolver REAL ----
  const draft = await buildBbtsDraft(new Uint8Array(fs.readFileSync(PDF_TABELA)), { sourceFilename: path.basename(PDF_TABELA) });
  const stub = stubRegua([
    { id: "v-jul", competencia: "2026-07-01", version_no: 1, is_active: true, regra_json: draft.regraDraft },
  ]);
  const resolvida = await resolveBbtsRegraDb({ competencia: YM }, stub);
  const okFb = resolvida && resolvida.isFallback && resolvida.direcao === "posterior" && resolvida.competenciaFornecedora === "2026-07";
  if (!okFb) fail++;
  console.log("=== REGUA (fallback) ===");
  console.log(
    `  ${okFb ? "OK  " : "FAIL"} ${YM} sem regua propria -> usou a de ${resolvida && resolvida.competenciaFornecedora} ` +
      `(isFallback=${resolvida && resolvida.isFallback}, direcao=${resolvida && resolvida.direcao})`,
  );

  // ---- 4. CONFERÊNCIA ----
  const res = conferirBbts(YM, contratos, resolvida, prt);
  console.log(`  aviso p/ a tela: "${res.regua.aviso}"\n`);

  const sub = res.linhas.filter((l) => l.status === "SUBPAGAMENTO");
  const fora = res.linhas.filter((l) => l.status === "FORA_DA_TABELA");
  const ok = res.linhas.filter((l) => l.status === "OK");

  console.log("=== SUBPAGAMENTO (a BBTS pagou MENOS que o acordo Faixa 4) ===");
  console.log(
    "  " + "contrato".padEnd(11) + "grupo".padEnd(19) + "prz".padEnd(5) + "financiado".padStart(12) +
      "  pago".padStart(12) + "  devido F4".padStart(13) + "  diferenca".padStart(13) + "   (pago% -> devido%)",
  );
  for (const l of sub) {
    console.log(
      "  " + l.contrato.padEnd(11) + String(l.grupo).padEnd(19) + String(l.prazoUsado).padEnd(5) +
        brl(l.valorFinanciado).padStart(12) + brl(l.pagoAvista).padStart(12) + brl(l.devidoAvista).padStart(13) +
        brl(l.diferenca).padStart(13) + `   (${pctf(l.pctRealizado)} -> ${pctf(l.pctAvista)})`,
    );
  }
  console.log(`  ${sub.length} contratos | ROMBO = ${brl(res.resumo.somaSubpagamento)}`);

  console.log("\n=== FORA DA TABELA (estrutural — NAO e subpagamento) ===");
  for (const l of fora) {
    console.log(`  ${l.contrato.padEnd(11)} ${String(l.grupo).padEnd(19)} pago=${brl(l.pagoAvista).padStart(10)}  motivo: ${l.motivo}`);
  }

  console.log("\n=== OK (pagou o que a tabela manda) ===");
  for (const l of ok) {
    console.log(
      `  ${l.contrato.padEnd(11)} ${String(l.grupo).padEnd(19)} pago=${brl(l.pagoAvista).padStart(10)} devido=${brl(l.devidoAvista).padStart(10)}` +
        `  | tabela cheia ${pctf(l.pctTabela)} = AVT ${pctf(l.pctAvista)} + PRT ${pctf(l.pctDiferido)} (${brl(l.devidoPrtTotal)} a receber, ${brl(l.devidoPrtMensal)}/mes)`,
    );
  }

  console.log("\n=== PRT pago no mes (contratos de competencias ANTIGAS) ===");
  console.log(
    `  ${res.prtSemContratoNoUniverso.length} parcelas sem contrato no universo de ${YM} — lane separada, nunca vira subpagamento.`,
  );
  console.log(`  Sigma PRT pago no mes: ${brl(res.resumo.somaPrtPagoNoMes)}`);

  console.log("\n=== RESUMO ===");
  const r = res.resumo;
  console.log(`  auditados=${r.auditados}  OK=${r.ok}  SUBPAGAMENTO=${r.subpagamentos}  SOBREPAGAMENTO=${r.sobrepagamentos}  FORA_DA_TABELA=${r.foraDaTabela}  SRCC=${r.srcc}  CANCELADO=${r.cancelados}`);
  console.log(`  Sigma pago a vista   = ${brl(r.somaPagoAvista)}`);
  console.log(`  Sigma devido a vista = ${brl(r.somaDevidoAvista)}`);
  console.log(`  ROMBO (subpagamento) = ${brl(r.somaSubpagamento)}`);
  console.log(`  PRT gerado no mes (direito a receber dos contratos de junho) = ${brl(r.somaDevidoPrtGerado)}`);

  // ---- 5. ASSERÇÕES DE SENSIBILIDADE ----
  console.log("\n=== SENSIBILIDADE (o motor pega o erro conhecido?) ===");
  const casos = [
    ["212539496 (INSS 108p, pago 2,87%/F1) e SUBPAGAMENTO", () => {
      const l = res.linhas.find((x) => x.contrato === "212539496");
      return l && l.status === "SUBPAGAMENTO" && Math.abs(l.devidoAvista - 174) < 0.01 && Math.abs(l.diferenca + 30.5) < 0.01;
    }],
    ["212850402 (INSS prazo 36, R$ 0) e FORA_DA_TABELA (nao subpagamento)", () => {
      const l = res.linhas.find((x) => x.contrato === "212850402");
      return l && l.status === "FORA_DA_TABELA";
    }],
    ["212682356 (Publico 2,4%, pagou o teto de 6%) e OK, com PRT a receber", () => {
      const l = res.linhas.find((x) => x.contrato === "212682356");
      return l && l.status === "OK" && l.pctTabela > 0.06 && l.devidoPrtTotal > 0;
    }],
    ["INSS Renovacao (juros 1,81% < piso do INSS Novo) NAO cai fora da tabela", () => {
      const l = res.linhas.find((x) => x.contrato === "212971501");
      return l && l.grupo === "INSS_RENOV" && l.status === "SUBPAGAMENTO";
    }],
    ["o rombo e > R$ 1.000 (a Faixa 1 no lugar da Faixa 4 custa caro)", () => r.somaSubpagamento < -1000],
    ["nenhum contrato virou subpagamento por falta de celula", () => sub.every((l) => l.devidoAvista != null)],
  ];
  for (const [rot, f] of casos) {
    let bom = false;
    try {
      bom = !!f();
    } catch {
      bom = false;
    }
    if (!bom) fail++;
    console.log(`  ${bom ? "OK  " : "FAIL"} ${rot}`);
  }

  console.log(`\nRESULTADO: ${fail === 0 ? "OK — 0 falhas" : `${fail} FALHAS`}`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
