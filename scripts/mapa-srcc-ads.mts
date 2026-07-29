// ============================================================================
// MAPA — o colapso 2/3/4 -> false no lado ADS. LEITURA, nao conserta nada.
//
// Pergunta central: a DUVIDA (codigo 3) chega a existir no dado da BBTS?
//   - na DIARIA (bbtsDailyImport)
//   - no FECHAMENTO (bbtsClosingImport, via PDF)
//
// npx tsx scripts/mapa-srcc-ads.mts
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

const { getSrccEstado, getSrccRestrictionLabel } = await import(
  "../lib/proposalDetailing.ts"
);
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const L = "-".repeat(92);
const D = "=".repeat(92);

async function pagina(tabela: string, colunas: string, aplicar: (q: any) => any) {
  const passo = 1000;
  let de = 0;
  const out: any[] = [];
  for (;;) {
    const { data, error } = await aplicar(
      sb.from(tabela).select(colunas).order("id")
    ).range(de, de + passo - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < passo) break;
    de += passo;
  }
  return out;
}

const comp = (r: any) => {
  const p =
    getProductionPeriodFromValue(r.movement_date) ||
    getProductionPeriodFromValue(r.contract_date) ||
    getProductionPeriodFromValue(r.proposal_date);
  return p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "(sem comp)";
};

// TODAS as linhas ADS, sem janela de data — o universo e pequeno.
const linhas = await pagina(
  "daily_production_records",
  "id, company_id, proposal_number, status, is_srcc_restricted, srcc_resolucao," +
    " net_value, movement_date, contract_date, proposal_date, raw_payload",
  (q) => q.eq("company_id", BBTS)
);

console.log(D);
console.log(`ADS (BBTS) — ${linhas.length} linhas em daily_production_records`);
console.log(D);

// ------------------------------------------------- 1. srcc_cd por fonte ----
// A fonte fica em raw_payload.__bbts_meta.fonte:
//   "fechamento_pdf"             -> bbtsClosingImport (credito)
//   "fechamento_pdf_seguro_only" -> bbtsClosingImport (linha so-seguro)
//   ausente                      -> bbtsDailyImport (a diaria nao carimba fonte)
//   adsSeguroDailyImport          -> ver marcacao propria
const fonteDe = (r: any) => {
  const meta = r?.raw_payload?.__bbts_meta;
  if (meta && typeof meta === "object") return String(meta.fonte ?? "diaria_bbts");
  if (r?.raw_payload?.__ads_seguro_meta) return "ads_seguro";
  return "(sem __bbts_meta)";
};
const cdDe = (r: any) => {
  const meta = r?.raw_payload?.__bbts_meta;
  if (!meta || typeof meta !== "object") return "(sem meta)";
  const v = (meta as any).srcc_cd;
  return v === null || v === undefined ? "null" : String(v);
};

const porFonteCd = new Map<string, Map<string, number>>();
for (const r of linhas) {
  const f = fonteDe(r);
  if (!porFonteCd.has(f)) porFonteCd.set(f, new Map());
  const m = porFonteCd.get(f)!;
  const c = cdDe(r);
  m.set(c, (m.get(c) || 0) + 1);
}
console.log("\n1. srcc_cd (raw_payload.__bbts_meta.srcc_cd) POR FONTE\n" + L);
for (const [f, m] of [...porFonteCd].sort()) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const det = [...m].sort().map(([c, n]) => `cd=${c}: ${n}`).join("  ·  ");
  console.log(`${f.padEnd(30)} ${String(total).padStart(5)}   ${det}`);
}

// ---------------------------------------- 2. srcc_cd por competencia -------
console.log("\n2. srcc_cd POR COMPETENCIA x FONTE\n" + L);
const porCompFonte = new Map<string, Map<string, number>>();
for (const r of linhas) {
  const k = `${comp(r)} | ${fonteDe(r)}`;
  if (!porCompFonte.has(k)) porCompFonte.set(k, new Map());
  const m = porCompFonte.get(k)!;
  const c = cdDe(r);
  m.set(c, (m.get(c) || 0) + 1);
}
for (const [k, m] of [...porCompFonte].sort()) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const det = [...m].sort().map(([c, n]) => `cd=${c}: ${n}`).join("  ·  ");
  console.log(`${k.padEnd(48)} ${String(total).padStart(5)}   ${det}`);
}

// -------------------------------- 3. qualquer chave RESTRIC no raw_payload --
console.log("\n3. CHAVES do raw_payload que contem 'RESTRIC' (ou 'SRCC')\n" + L);
const chaves = new Map<string, number>();
for (const r of linhas) {
  const rp = r?.raw_payload;
  if (!rp || typeof rp !== "object") continue;
  for (const k of Object.keys(rp)) {
    const n = k
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase();
    if (n.includes("RESTRIC") || n.includes("SRCC")) {
      chaves.set(k, (chaves.get(k) || 0) + 1);
    }
  }
}
if (chaves.size === 0) console.log("  NENHUMA. (o rotulo procura 'Indicador Restricao SRCC' / 'Restricao SRCC')");
for (const [k, n] of [...chaves].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(46)} ${n} linhas`);
}
// amostra de valores dessas chaves
for (const [k] of [...chaves].slice(0, 4)) {
  const vals = new Map<string, number>();
  for (const r of linhas) {
    const v = r?.raw_payload?.[k];
    if (v === undefined) continue;
    const s = v === null ? "null" : String(v);
    vals.set(s, (vals.get(s) || 0) + 1);
  }
  console.log(
    `    valores de "${k}": ` +
      [...vals].sort().slice(0, 10).map(([v, n]) => `${v}=${n}`).join("  ·  ")
  );
}

// ------------------------------ 4. estado/rotulo exibido hoje na ADS -------
console.log("\n4. O QUE A TELA MOSTRA HOJE (getSrccRestrictionLabel/getSrccEstado)\n" + L);
const porEstado = new Map<string, Map<string, number>>();
for (const r of linhas) {
  const e = getSrccEstado(r as any);
  const lab = getSrccRestrictionLabel(r as any);
  if (!porEstado.has(e)) porEstado.set(e, new Map());
  const m = porEstado.get(e)!;
  m.set(lab, (m.get(lab) || 0) + 1);
}
for (const [e, m] of [...porEstado].sort()) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  console.log(
    `${e.padEnd(12)} ${String(total).padStart(5)}   ` +
      [...m].sort().map(([l, n]) => `"${l}": ${n}`).join("  ·  ")
  );
}

// cruzamento cd x estado — onde o 2/3/4 vai parar
console.log("\n   cruzamento srcc_cd x estado exibido");
const cruz = new Map<string, number>();
for (const r of linhas) {
  const k = `cd=${cdDe(r)} -> ${getSrccEstado(r as any)} (bool=${r.is_srcc_restricted})`;
  cruz.set(k, (cruz.get(k) || 0) + 1);
}
for (const [k, n] of [...cruz].sort()) console.log(`   ${k.padEnd(60)} ${n}`);

// ------------------------------------ 5. o fechamento PDF x a diaria -------
// Uma linha pode ter sido escrita pela diaria e DEPOIS sobrescrita pelo
// fechamento (merge por dono de coluna). Verifica quantas linhas ADS existem
// por competencia e quantas trazem srcc_cd de fato.
console.log("\n5. COBERTURA — linhas com srcc_cd conhecido vs sem\n" + L);
const cob = new Map<string, { total: number; comCd: number; cd3: number; cd1: number; cd2: number; cd4: number }>();
for (const r of linhas) {
  const k = comp(r);
  if (!cob.has(k)) cob.set(k, { total: 0, comCd: 0, cd3: 0, cd1: 0, cd2: 0, cd4: 0 });
  const o = cob.get(k)!;
  o.total += 1;
  const c = cdDe(r);
  if (c !== "null" && c !== "(sem meta)") o.comCd += 1;
  if (c === "1") o.cd1 += 1;
  if (c === "2") o.cd2 += 1;
  if (c === "3") o.cd3 += 1;
  if (c === "4") o.cd4 += 1;
}
console.log("comp        total   com_cd   cd1   cd2   cd3   cd4");
for (const [k, o] of [...cob].sort()) {
  console.log(
    `${k.padEnd(10)} ${String(o.total).padStart(6)} ${String(o.comCd).padStart(8)} ` +
      `${String(o.cd1).padStart(5)} ${String(o.cd2).padStart(5)} ${String(o.cd3).padStart(5)} ${String(o.cd4).padStart(5)}`
  );
}

// -------------------------------------- 6. srcc_resolucao no lado ADS ------
const comResolucao = linhas.filter((r) => r.srcc_resolucao != null);
console.log(`\n6. srcc_resolucao preenchida na ADS: ${comResolucao.length} de ${linhas.length}`);

console.log("\n" + D);
