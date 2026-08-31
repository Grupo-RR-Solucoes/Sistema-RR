/* DIFF completo da regua de AGOSTO contra a de JULHO, celula a celula, mais o
 * alcance em contratos e R$. READ-ONLY — nao grava nada. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const DL = "C:/Users/diego/Downloads";
const PDF_A = "Tabela_de_Pagamento_CréditoPF_Prestamista_31_07_2026.pdf";      // 03/08
const PDF_B = "Tabela_de_Pagamento_CréditoPF_Prestamista_31__anonymous 2.pdf"; // 30/08
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p4 = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");
/* comparacao INSENSIVEL A ORDEM DE CHAVE — o regra_json volta do JSONB
 * reordenado e o PDF produz na ordem de leitura. Sem isto todo round-trip
 * pelo banco vira "mudou". */
const estavel = (v) => JSON.stringify(v, (k, x) =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x);
/** assinatura da CELULA pela banda (juros+prazo) — indice pode deslocar. */
const chaveCel = (c) => `${c.tx_min}|${c.tx_max}|${c.prazo_min}|${c.prazo_max}`;

(async () => {
  const { buildBbtsDraft } = require("@/lib/bbts/buildBbtsDraft.ts");
  const { resolveBbtsRegraDb, lookupPctBbts } = require("@/lib/bbts/resolveBbtsRegra.ts");
  const { conferirBbtsMes } = require("@/lib/bbts/conferenciaBbts.ts");

  const draftA = await buildBbtsDraft(new Uint8Array(fs.readFileSync(DL + "/" + PDF_A)), { sourceFilename: PDF_A, sha256: "a" });
  const draftB = await buildBbtsDraft(new Uint8Array(fs.readFileSync(DL + "/" + PDF_B)), { sourceFilename: PDF_B, sha256: "b" });
  const rgJul = await resolveBbtsRegraDb({ competencia: "2026-07" }, sb);
  const jul = rgJul.regra;

  // ---------- (4) os dois PDFs de agosto produzem a MESMA regua?
  console.log("=== (4) os DOIS PDFs de agosto produzem a mesma regua? ===");
  const semMeta = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c._meta.fonte_pdf; delete c._meta.sha256; return c; };
  const igual = estavel(semMeta(draftA.regraDraft)) === estavel(semMeta(draftB.regraDraft));
  console.log(`  regua(${PDF_A.slice(-20)}) == regua(${PDF_B.slice(-20)}) ? ${igual ? "SIM — identicas" : "NAO"}`);
  if (!igual) {
    for (const g of new Set([...Object.keys(draftA.regraDraft.grupos), ...Object.keys(draftB.regraDraft.grupos)])) {
      const a = draftA.regraDraft.grupos[g], b = draftB.regraDraft.grupos[g];
      if (estavel(a) !== estavel(b)) console.log(`    DIFERE no grupo ${g}: A=${a ? a.celulas.length : "ausente"} celulas, B=${b ? b.celulas.length : "ausente"}`);
    }
    console.log(`    seguro igual? ${estavel(draftA.regraDraft.seguro) === estavel(draftB.regraDraft.seguro)}`);
    console.log(`    ausentes A=${JSON.stringify(draftA.regraDraft.grupos_ausentes)} B=${JSON.stringify(draftB.regraDraft.grupos_ausentes)}`);
  }
  const ago = draftA.regraDraft; // usa o A como referencia do diff

  // ---------- (1) e (2) DIFF celula a celula
  console.log("\n=== (1)(2) DIFF agosto x julho, celula a celula ===");
  let subiram = 0, baixaram = 0, iguais = 0, novas = 0, sumiram = 0;
  const mudancas = [];
  const todosGrupos = [...new Set([...Object.keys(jul.grupos), ...Object.keys(ago.grupos)])].sort();
  for (const g of todosGrupos) {
    const gj = jul.grupos[g], ga = ago.grupos[g];
    if (!ga) { console.log(`  ${g.padEnd(30)} SUMIU em agosto (${gj.celulas.length} celulas)`); sumiram += gj ? gj.celulas.length : 0; continue; }
    if (!gj) { console.log(`  ${g.padEnd(30)} NOVO em agosto (${ga.celulas.length} celulas)`); novas += ga.celulas.length; continue; }
    const mapJ = new Map(gj.celulas.map((c) => [chaveCel(c), c]));
    for (const ca of ga.celulas) {
      const cj = mapJ.get(chaveCel(ca));
      if (!cj) { novas++; mudancas.push({ g, ca, cj: null }); continue; }
      if (estavel(cj.faixas) === estavel(ca.faixas)) { iguais++; continue; }
      mudancas.push({ g, ca, cj });
    }
  }
  const gruposComMudanca = new Set();
  for (const m of mudancas) {
    gruposComMudanca.add(m.g);
    const banda = `juros ${p4(m.ca.tx_min)}–${p4(m.ca.tx_max)} · prazo ${m.ca.prazo_min}–${m.ca.prazo_max == null ? "∞" : m.ca.prazo_max}`;
    console.log(`\n  ${m.g} | ${banda}`);
    if (!m.cj) { console.log("    CELULA NOVA em agosto (nao existia em julho)"); continue; }
    for (const fx of Object.keys(m.ca.faixas)) {
      const a = m.ca.faixas[fx], j = m.cj.faixas[fx];
      const va = a ? (a.base + (a.adicional ?? 0)) : null;
      const vj = j ? (j.base + (j.adicional ?? 0)) : null;
      if (va === vj) continue;
      const dir = va > vj ? "SUBIU " : "BAIXOU";
      if (va > vj) subiram++; else baixaram++;
      console.log(`      ${fx.padEnd(8)} ${p4(vj)} -> ${p4(va)}   ${dir} (${((va - vj) * 100).toFixed(4)} p.p.)`);
    }
  }
  console.log(`\n  RESUMO: ${gruposComMudanca.size} grupo(s) com mudanca -> ${[...gruposComMudanca].join(", ")}`);
  console.log(`  celulas identicas: ${iguais} | celulas com mudanca: ${mudancas.length} | novas: ${novas} | sumiram: ${sumiram}`);
  console.log(`  valores de faixa que SUBIRAM: ${subiram} | que BAIXARAM: ${baixaram}`);

  // ---------- (5) convenios enumerados
  console.log("\n=== (5) codigos de convenio enumerados no PDF ===");
  console.log(`  julho  (banco) : ${Object.keys(jul.convenios || {}).length} codigo(s)`);
  console.log(`  agosto (PDF A) : ${Object.keys(ago.convenios || {}).length} codigo(s)`);
  const porGrupoJul = {};
  for (const [, v] of Object.entries(jul.convenios || {})) porGrupoJul[v.grupo] = (porGrupoJul[v.grupo] || 0) + 1;
  console.log(`  julho, por grupo: ${JSON.stringify(porGrupoJul)}`);
  console.log(`  os 3 grupos removidos sao EXATAMENTE os grupos de excecao que a lista alimentava? ${Object.keys(porGrupoJul).sort().join(", ")}`);

  // ---------- (3) ALCANCE em contratos e R$
  console.log("\n=== (3) ALCANCE: contratos da ADS em agosto nas celulas que mudaram ===");
  const b = await conferirBbtsMes(sb, "2026-08");
  // A CELULA DIRETO PELO GRUPO JA RESOLVIDO. A 1a versao remontava a operacao a
  // partir da linha da conferencia e chamava lookupPctBbts — mas LinhaConferenciaBbts
  // NAO carrega convenio_code nem product_description, entao o roteador mandava
  // TODOS para PUBLICO_DEMAIS (que nao mudou) e o alcance dava 0 atingidos com
  // as taxas do NAO_CONSIGNADO claramente diferentes. Aqui o grupo ja vem
  // resolvido na linha; so falta achar a celula pela banda de juros/prazo.
  const acharCel = (regra, grupo, juros, prazo) => {
    const g = regra.grupos?.[grupo];
    if (!g) return null;
    return g.celulas.find((c) =>
      (c.tx_min == null || juros >= c.tx_min) && (c.tx_max == null || juros <= c.tx_max) &&
      (c.prazo_min == null || prazo >= c.prazo_min) && (c.prazo_max == null || prazo <= c.prazo_max)
    ) || null;
  };
  const valorFaixa = (cel, faixa) => {
    if (!cel) return null;
    const v = cel.faixas[faixa] ?? Object.values(cel.faixas)[0];
    return v ? v.base + (v.adicional ?? 0) : null;
  };
  let atingidos = 0, deltaTotal = 0, semCelula = 0;
  const porGrupoAt = {};
  for (const l of b.linhas || []) {
    if (!l.grupo) continue;
    const juros = Number(l.juros), prazo = Number(l.prazoUsado ?? l.parcelas);
    const pj = valorFaixa(acharCel(jul, l.grupo, juros, prazo), l.faixa);
    const pa = valorFaixa(acharCel(ago, l.grupo, juros, prazo), l.faixa);
    if (pj == null || pa == null) { semCelula++; continue; }
    if (pj === pa) continue;
    atingidos++;
    porGrupoAt[l.grupo] = (porGrupoAt[l.grupo] || 0) + 1;
    const vfin = Number(l.valorFinanciado) || 0;
    deltaTotal += vfin * (pa - pj);
  }
  console.log(`  sem celula em uma das duas reguas: ${semCelula}`);
  console.log(`  contratos de agosto: ${(b.linhas || []).length}`);
  console.log(`  atingidos por celula que mudou: ${atingidos} ${JSON.stringify(porGrupoAt)}`);
  console.log(`  efeito em R$ (devido pela regua NOVA - pela de julho): ${f(deltaTotal)}  ${deltaTotal < 0 ? "<- a ADS receberia MENOS" : deltaTotal > 0 ? "<- a ADS receberia MAIS" : ""}`);
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 400)); process.exit(1); });
