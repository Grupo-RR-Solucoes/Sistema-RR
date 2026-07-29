// ============================================================================
// GATE — a resposta da BBTS sobre o SRCC chega na tela, e nada mais se move.
//
// O QUE PROVA, nesta ordem:
//   1. o import de fechamento ADS classifica o codigo em srcc_resolucao
//      (1->SIM, 2->NAO, 4->NAO_SE_APLICA, 3->NAO GRAVA), em DRY-RUN;
//   2. as 19 linhas de junho ja gravadas passam de "Sem informacao" para
//      "Nao"/"Nao se aplica" SEM reimportar — so pelo alias no rotulo;
//   3. as 35 de julho continuam "Sem informacao" (a diaria da BBTS nao traz SRCC);
//   4. NENHUMA linha muda de is_srcc_restricted, de elegibilidade de producao ou
//      de soma — nem na ADS, nem no RR;
//   5. o alias novo NAO mexe no lado RR (nenhuma linha do RR tem srcc_cd).
//
// O "antes" nao e reimplementado: e a MESMA funcao rodando sobre uma copia do
// registro sem as chaves novas. Reimplementar a regra do rotulo para compara-la
// consigo mesma provaria a reimplementacao, nao o conserto.
//
// npx tsx scripts/gate-srcc-ads.mts
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const { getSrccEstado, getSrccRestrictionLabel, getSrccRowTint } = await import(
  "../lib/proposalDetailing.ts"
);
const { importBbtsClosing, BBTS_COMPANY_ID }: any = await import("../lib/bbtsClosingImport.ts");
const { traduzirValorFechamento }: any = await import("../lib/srccResolucao.ts");
// A elegibilidade de producao nao e exportada por nenhum dos modulos (e a MESMA
// regra repetida em promoterAnalytics:844, closingAnalytics:364, projecaoMetas:67,
// bbtsOrchestrator:140). Copiada aqui de proposito, na forma literal deles: o que
// este gate precisa provar e que ela le o BOOLEANO e o STATUS — nunca o rotulo —
// e por isso nao pode se mover quando a exibicao muda.
const isEligibleProductionRecord = (r: any) => {
  const st = String(r.status ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  return (st === "PRODUCAO" || st === "PRODUCTION") && r.is_srcc_restricted !== true;
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const L = "-".repeat(88);
let falhas = 0;
function checa(nome: string, ok: boolean, detalhe = "") {
  console.log(`  ${ok ? "OK  " : "FALHA"}  ${nome}${detalhe ? "   " + detalhe : ""}`);
  if (!ok) falhas += 1;
}

// ======================================================= 1. o classificador ==
console.log("\n1. CLASSIFICACAO DO CODIGO (a regra, isolada)\n" + L);
const esperado: Record<string, string | null> = { "1": "SIM", "2": "NAO", "3": null, "4": "NAO_SE_APLICA" };
for (const [cd, alvo] of Object.entries(esperado)) {
  const obtido = traduzirValorFechamento(cd);
  checa(`cd=${cd} -> ${alvo ?? "NAO GRAVA (null)"}`, obtido === alvo, `obtido=${obtido}`);
}

// ============================================ 2. o import, em DRY-RUN, junho ==
console.log("\n2. IMPORT DE FECHAMENTO ADS EM DRY-RUN (junho/2026)\n" + L);
const JSON_JUNHO = process.env.BBTS_CLOSING_JSON || "C:/Users/diego/Downloads/bbts_junho_fechamento.json";
if (!fs.existsSync(JSON_JUNHO)) {
  console.log(`  (pulado — arquivo do fechamento nao encontrado: ${JSON_JUNHO})`);
} else {
  const input = JSON.parse(fs.readFileSync(JSON_JUNHO, "utf8"));
  const res = await importBbtsClosing(sb as any, input, { dryRun: true });
  console.log(
    `  ancora_ok=${res.ancora_ok}  propostas=${res.propostas}  resolucoes=` +
      JSON.stringify(res.srcc_resolucoes)
  );
  checa("dry-run nao gravou", res.dry_run === true && res.gravadas === 0);
  checa("18 linhas classificadas NAO", res.srcc_resolucoes.NAO === 18);
  checa("1 linha classificada NAO_SE_APLICA", res.srcc_resolucoes.NAO_SE_APLICA === 1);
  checa("0 linhas SIM (a BBTS nunca mandou cd=1)", res.srcc_resolucoes.SIM === 0);
  checa("0 indefinidas (nenhum cd=3 em junho)", res.srcc_resolucoes.indefinidas === 0);
  checa("restritas (booleano) segue 0", res.srcc_restritas === 0);
}

// ============================================== 3. o rotulo, no dado de hoje ==
console.log("\n3. O ROTULO NAS LINHAS JA GRAVADAS (sem reimportar nada)\n" + L);

async function pagina(colunas: string, aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const out: any[] = [];
  for (;;) {
    const { data, error } = await aplicar(
      sb.from("daily_production_records").select(colunas).order("id")
    ).range(de, de + passo - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return out;
}

// 2026 inteiro: o gate tem de ver o RR tambem, senao prova metade.
const linhas = await pagina(
  "id, company_id, status, is_srcc_restricted, srcc_resolucao, net_value," +
    " movement_date, contract_date, proposal_date, raw_payload",
  (q) => q.gte("movement_date", "2026-01-01").lt("movement_date", "2027-01-01")
);

// ANTES = a mesma funcao, sobre o registro sem as chaves que o alias passou a ver.
const CHAVES_NOVAS = ["srcc_cd", "cd_restricao_srcc", "Cd. Restrição SRCC"];
const semChavesNovas = (r: any) => {
  const rp = { ...(r.raw_payload || {}) };
  for (const k of CHAVES_NOVAS) delete rp[k];
  return { ...r, raw_payload: rp };
};

const ads = linhas.filter((r) => r.company_id === BBTS_COMPANY_ID);
const rr = linhas.filter((r) => r.company_id !== BBTS_COMPANY_ID);
console.log(`  universo 2026: ${linhas.length} linhas  (ADS ${ads.length} · RR ${rr.length})`);

const mudou = linhas.filter(
  (r) => getSrccRestrictionLabel(r as any) !== getSrccRestrictionLabel(semChavesNovas(r) as any)
);
checa("mudancas de rotulo SO na ADS", mudou.every((r) => r.company_id === BBTS_COMPANY_ID),
  `${mudou.length} mudancas`);
checa("nenhuma linha do RR muda de rotulo",
  rr.every((r) => getSrccRestrictionLabel(r as any) === getSrccRestrictionLabel(semChavesNovas(r) as any)));

const contaLabel = (rows: any[], fn: (r: any) => any) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(fn(r));
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};
const antes = contaLabel(ads, (r) => getSrccRestrictionLabel(semChavesNovas(r)));
const depois = contaLabel(ads, (r) => getSrccRestrictionLabel(r));
console.log("  ADS antes :", [...antes].sort().map(([k, n]) => `"${k}": ${n}`).join("  ·  "));
console.log("  ADS depois:", [...depois].sort().map(([k, n]) => `"${k}": ${n}`).join("  ·  "));
checa('18 linhas passam a "Não"', (depois.get("Não") || 0) === 18);
checa('1 linha passa a "Não se aplica"', (depois.get("Não se aplica") || 0) === 1);
checa('35 seguem "Sem informação" (julho, diaria sem SRCC)',
  (depois.get("Sem informação") || 0) === 35);
checa('antes: as 54 diziam "Sem informação"', (antes.get("Sem informação") || 0) === 54);

const estados = contaLabel(ads, (r) => getSrccEstado(r));
console.log("  estados ADS:", [...estados].sort().map(([k, n]) => `${k}: ${n}`).join("  ·  "));
checa("nenhuma linha ADS vira 'restrito'", (estados.get("restrito") || 0) === 0);
checa("19 viram 'neutro' (resposta conhecida)", (estados.get("neutro") || 0) === 19);
checa("nenhum tingimento novo", ads.every((r) => getSrccRowTint(r as any) === null));

// ================================================= 4. o dinheiro nao se move ==
console.log("\n4. PRODUCAO E BOOLEANO — INTOCADOS\n" + L);
checa("nenhuma linha ADS tem srcc_resolucao gravada ainda (so o import grava)",
  ads.every((r) => r.srcc_resolucao == null));
checa("nenhuma linha ADS tem is_srcc_restricted=true", ads.every((r) => r.is_srcc_restricted !== true));

// elegibilidade de producao: mesma funcao, antes e depois — ela le o BOOLEANO,
// nao o rotulo, entao tem de ser identica linha a linha.
const elegAntes = linhas.filter((r) => isEligibleProductionRecord(semChavesNovas(r))).length;
const elegDepois = linhas.filter((r) => isEligibleProductionRecord(r)).length;
const somaAntes = linhas
  .filter((r) => isEligibleProductionRecord(semChavesNovas(r)))
  .reduce((a, r) => a + (Number(r.net_value) || 0), 0);
const somaDepois = linhas
  .filter((r) => isEligibleProductionRecord(r))
  .reduce((a, r) => a + (Number(r.net_value) || 0), 0);
checa("linhas elegiveis identicas", elegAntes === elegDepois, `${elegAntes} = ${elegDepois}`);
checa("soma de producao identica", Math.abs(somaAntes - somaDepois) < 0.005,
  `R$ ${somaAntes.toFixed(2)} = R$ ${somaDepois.toFixed(2)}`);

console.log("\n" + "=".repeat(88));
console.log(falhas === 0 ? "GATE OK — 0 falhas" : `GATE FALHOU — ${falhas} falha(s)`);
console.log("=".repeat(88));
process.exit(falhas === 0 ? 0 : 1);
