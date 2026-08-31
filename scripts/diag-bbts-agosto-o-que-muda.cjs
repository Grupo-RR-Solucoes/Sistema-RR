/* O que MUDA com a regua de agosto gravada. READ-ONLY, nao grava nada. */
require("./_ts_register.cjs");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const REMOVIDOS = ["GRUPAMENTO_MG_SP_REDUZIDOS", "PUBLICO_DEMAIS_BONIFICADO", "PUBLICO_DEMAIS_REDUZIDOS"];
const f = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => (v == null ? "—" : (Number(v) * 100).toFixed(4) + "%");
/* COMPARACAO INSENSIVEL A ORDEM DE CHAVE. O JSON.stringify direto acusou "MUDOU"
 * em 4 de 4 faixas do seguro com os valores IDENTICOS na tela: o regra_json volta
 * do JSONB com as chaves reordenadas (pct, prazo_max, prazo_min) e o PDF as
 * produz na ordem de leitura (prazo_min, prazo_max, pct). Comparar JSON de coisa
 * que passou por banco exige ordenar as chaves — senao todo round-trip vira
 * "mudou". */
const estavel = (v) => JSON.stringify(v, (k, x) =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]]))
    : x);

(async () => {
  const { conferirBbtsMes } = require("@/lib/bbts/conferenciaBbts.ts");
  const { buildBbtsDraft } = require("@/lib/bbts/buildBbtsDraft.ts");
  const { resolveBbtsRegraDb } = require("@/lib/bbts/resolveBbtsRegra.ts");

  console.log("=== (1) a conferencia de 2026-08 HOJE: qual regua, e com que aviso ===");
  const b = await conferirBbtsMes(sb, "2026-08");
  console.log(`  regua usada     : ${b.regua ? b.regua.competenciaUsada + " v" + b.regua.versionNo : "NENHUMA"}`);
  console.log(`  e fallback?     : ${b.regua ? b.regua.isFallback : "-"} (direcao ${b.regua ? b.regua.direcao : "-"})`);
  console.log(`  aviso da tela   : ${b.regua && b.regua.aviso ? b.regua.aviso : "(nenhum)"}`);
  console.log(`  linhas          : ${(b.linhas || []).length}`);
  const st = {}; for (const l of b.linhas || []) st[l.status] = (st[l.status] || 0) + 1;
  console.log(`  por status      : ${JSON.stringify(st)}`);
  console.log(`  subpagamentos   : ${b.resumo.subpagamentos} soma ${f(b.resumo.somaSubpagamento)}`);
  console.log(`  pago ${f(b.resumo.somaPagoAvista)} x devido ${f(b.resumo.somaDevidoAvista)}`);

  console.log("\n=== (2) contratos da ADS em AGOSTO ===");
  const { count: totalAgo } = await sb.from("daily_production_records").select("id", { count: "exact", head: true })
    .eq("company_id", ADS).gte("movement_date", "2026-08-01").lte("movement_date", "2026-08-31");
  const { count: comCarimbo } = await sb.from("daily_production_records").select("id", { count: "exact", head: true })
    .eq("company_id", ADS).eq("bbts_competencia_fechamento", "2026-08-01");
  console.log(`  linhas no diario com movement_date em agosto : ${totalAgo}`);
  console.log(`  linhas com CARIMBO 2026-08-01                : ${comCarimbo}`);
  console.log(`  linhas que a conferencia de 2026-08 monta    : ${(b.linhas || []).length}`);
  console.log(`  -> passariam de FALLBACK (regua de 07) para a regua PROPRIA de 08: ${(b.linhas || []).length}`);

  console.log("\n=== (3) algum contrato de agosto cai nos 3 grupos REMOVIDOS? ===");
  const porGrupo = {};
  for (const l of b.linhas || []) porGrupo[l.grupo || "(sem grupo)"] = (porGrupo[l.grupo || "(sem grupo)"] || 0) + 1;
  for (const g of Object.keys(porGrupo).sort()) console.log(`  ${REMOVIDOS.includes(g) ? ">>> " : "    "}${g.padEnd(32)} ${porGrupo[g]}`);
  const nosRemovidos = REMOVIDOS.reduce((a, g) => a + (porGrupo[g] || 0), 0);
  console.log(`  => nos 3 grupos removidos: ${nosRemovidos}`);

  console.log("\n=== (4) o SEGURO da regua de agosto x a de julho ===");
  const buf = fs.readFileSync("C:/Users/diego/Downloads/Tabela_de_Pagamento_CréditoPF_Prestamista_31_07_2026.pdf");
  const d = await buildBbtsDraft(new Uint8Array(buf), { sourceFilename: "agosto.pdf", sha256: "diag" });
  const segAgo = d.regraDraft.seguro;
  const rgJul = await resolveBbtsRegraDb({ competencia: "2026-07" }, sb);
  const segJul = rgJul && rgJul.regra ? rgJul.regra.seguro : null;
  console.log(`  agosto (do PDF)  : ${segAgo ? "TEM secao seguro" : "SEM secao seguro"}`);
  console.log(`  julho  (do banco): ${segJul ? "TEM secao seguro" : "SEM secao seguro"}`);
  if (segAgo && segJul) {
    console.log(`\n  ESTOQUE  julho ${pct(segJul.estoque && segJul.estoque.pct)}   agosto ${pct(segAgo.estoque && segAgo.estoque.pct)}   ${estavel(segJul.estoque) === estavel(segAgo.estoque) ? "IGUAL" : "MUDOU"}`);
    console.log("  SLIP por prazo:");
    const n = Math.max((segJul.slip || []).length, (segAgo.slip || []).length);
    for (let i = 0; i < n; i++) {
      const j = (segJul.slip || [])[i], a = (segAgo.slip || [])[i];
      const rot = (x) => (x ? `${x.prazo_min}-${x.prazo_max == null ? "∞" : x.prazo_max} ${pct(x.pct)}` : "—");
      console.log(`    faixa ${i + 1}: julho ${rot(j).padEnd(22)} agosto ${rot(a).padEnd(22)} ${estavel(j) === estavel(a) ? "IGUAL" : "MUDOU"}`);
    }
    console.log(`\n  seguro identico entre as duas? ${estavel(segJul) === estavel(segAgo) ? "SIM — nada muda no seguro" : "NAO — ha diferenca"}`);
  }
  console.log(`\n  grupos_ausentes que a regua de agosto declararia: ${JSON.stringify(d.regraDraft.grupos_ausentes || [])}`);
  console.log("\nNADA GRAVADO.");
})().catch(e => { console.error("EXCECAO:", e.message, (e.stack || "").slice(0, 300)); process.exit(1); });
