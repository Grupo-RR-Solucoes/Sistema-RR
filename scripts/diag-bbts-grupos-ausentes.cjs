/* DOCUMENTO ou PARSER? Procura os rotulos dos 4 grupos ausentes no TEXTO CRU dos
 * PDFs de agosto, e compara com o de 30/06 que passa. READ-ONLY. */
require("./_ts_register.cjs");
const fs = require("fs");
const DL = "C:/Users/diego/Downloads";
const ALVOS = [
  ["GRUPAMENTO_MG_SP_REDUZIDOS", /reduzidos/i, /Grupamento Gov\. MG.*\(Reduzidos\)\*?/i],
  ["PUBLICO_DEMAIS_BONIFICADO", /bonificad/i, /Demais Conv[eê]nios P[uú]blicos.*\(Bonificado\)\*?/i],
  ["PUBLICO_DEMAIS_REDUZIDOS", /reduzidos/i, /Demais Conv[eê]nios P[uú]blicos.*\(Reduzidos\)\*?/i],
  ["BB_ENERGIA", /energia/i, /Financiamento . BB Energia Renovavel/i],
];
const deacc = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
(async () => {
  const { extractLinesFromPdf } = require("@/lib/trp/parseTrpPdf.ts");
  const arquivos = [
    ["30/06 (PASSA)", "Tabela_de_Pagamento_CréditoPF_Prestamista_30__anonymous.pdf"],
    ["31/07 (a)", "Tabela_de_Pagamento_CréditoPF_Prestamista_31_07_2026.pdf"],
    ["31/07 (b)", "Tabela_de_Pagamento_CréditoPF_Prestamista_31__anonymous 2.pdf"],
  ];
  const porArquivo = {};
  for (const [rot, arq] of arquivos) {
    const lines = await extractLinesFromPdf(new Uint8Array(fs.readFileSync(DL + "/" + arq)));
    porArquivo[rot] = lines;
    console.log("\n" + "=".repeat(76));
    console.log(`${rot} — ${arq}  (${lines.length} linhas)`);
    console.log("=".repeat(76));
    for (const [nome, solto, exato] of ALVOS) {
      const casaExato = lines.filter(l => exato.test(deacc(l)));
      const casaSolto = lines.filter(l => solto.test(deacc(l)));
      console.log(`\n  ${nome}`);
      console.log(`    regex do parser casa : ${casaExato.length} linha(s)`);
      for (const l of casaExato.slice(0, 2)) console.log(`        >> ${JSON.stringify(l).slice(0, 130)}`);
      console.log(`    palavra solta (${String(solto).slice(1, -2)}) : ${casaSolto.length} ocorrencia(s)`);
      for (const l of casaSolto.slice(0, 6)) console.log(`        ~~ ${JSON.stringify(l).slice(0, 130)}`);
    }
    // todos os rotulos de grupo plausiveis (linhas curtas que parecem titulo de secao)
    console.log("\n  --- linhas que PARECEM rotulo de grupo (sem % e sem R$) ---");
    const rot2 = lines.filter(l => /[A-Za-z]{4}/.test(l) && !/%|R\$|\d{2}\/\d{2}\/\d{4}/.test(l) && l.length < 75 && /Conv|Grupamento|Consignado|Portab|Financ|SIAPE|INSS|Privado|Publico|Energia|FGTS|CDC|Salario/i.test(deacc(l)));
    for (const l of [...new Set(rot2)].slice(0, 26)) console.log(`      ${JSON.stringify(l).slice(0, 120)}`);
  }
})().catch(e => { console.error("EXCECAO:", e.message); process.exit(1); });

/* ALCANCE — quantos contratos da ADS caem nos grupos ausentes? */
(async () => {
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { conferirBbtsMes } = require("@/lib/bbts/conferenciaBbts.ts");
  const AUSENTES = new Set(["GRUPAMENTO_MG_SP_REDUZIDOS", "PUBLICO_DEMAIS_BONIFICADO", "PUBLICO_DEMAIS_REDUZIDOS", "BB_ENERGIA"]);
  console.log("\n\n" + "#".repeat(76));
  console.log("# ALCANCE: contratos da ADS por GRUPO");
  console.log("#".repeat(76));
  for (const ym of ["2026-06", "2026-07"]) {
    const b = await conferirBbtsMes(sb, ym);
    const porGrupo = {};
    for (const l of b.linhas || []) porGrupo[l.grupo || "(sem grupo)"] = (porGrupo[l.grupo || "(sem grupo)"] || 0) + 1;
    console.log(`\n${ym} — ${(b.linhas || []).length} contratos`);
    for (const g of Object.keys(porGrupo).sort()) console.log(`  ${AUSENTES.has(g) ? ">>> " : "    "}${g.padEnd(34)} ${porGrupo[g]}`);
    const nosAusentes = Object.entries(porGrupo).filter(([g]) => AUSENTES.has(g)).reduce((a, [, n]) => a + n, 0);
    console.log(`  => contratos nos 4 grupos ausentes: ${nosAusentes}`);
  }
})().catch(e => { console.error("EXCECAO ALCANCE:", e.message); });
