#!/usr/bin/env node
/**
 * scripts/diag-materializar-fk-orfa.cjs — a hipotese da FK orfa. READ-ONLY.
 *
 * fn_materializar_producao_contrato() insere `monthly_closing_import_id` copiado
 * de monthly_closing_entries, e producao_contrato declara
 *     monthly_closing_import_id uuid references monthly_closing_imports(id)
 * (migration 20260704_000003).
 *
 * DOIS FATOS que tornam isto uma hipotese de primeira linha:
 *   1. a funcao NAO filtra competencia — ela varre monthly_closing_entries
 *      INTEIRA (2023+). Um unico entry apontando para um import que nao existe
 *      mais derruba a chamada TODA, para sempre, em qualquer mes;
 *   2. o INSERT e uma unica instrucao: FK violada (23503) aborta tudo, nada e
 *      gravado, e o catch best-effort do route.ts engole a mensagem.
 *
 * Isso explicaria o padrao observado sem nenhum ajuste: o populate AD-HOC de
 * 2026-07-05 rodou ANTES da migration das funcoes e pode ter rodado quando ainda
 * nao havia orfao; desde entao NENHUMA chamada da funcao pegou.
 *
 * NOTA sobre linhas ja gravadas: producao_contrato tem 249.740 linhas com FK
 * valida. Se hoje ha entry orfao, ele e POSTERIOR ao populate — ou o import dono
 * foi apagado depois.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

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

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const imports = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from("monthly_closing_imports").select("id,year,month,status,company_id,created_at").range(from, from + 999);
    if (error) { console.log("ERRO imports: " + error.message); return; }
    imports.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  const ids = imports.map((i) => i.id);
  console.log("\nmonthly_closing_imports: " + ids.length + " linhas");

  const { count: totalPrt } = await sb.from("monthly_closing_entries")
    .select("*", { count: "exact", head: true }).eq("entry_type", "PRT");
  const { count: nulos } = await sb.from("monthly_closing_entries")
    .select("*", { count: "exact", head: true }).eq("entry_type", "PRT").is("monthly_closing_import_id", null);
  console.log("entries PRT no total          : " + totalPrt);
  console.log("entries PRT com import_id NULL: " + nulos + "  (FK aceita NULL — nao viola)");

  // NAO da para usar .not(...,"in",lista): 534 UUIDs estouram o tamanho da URL
  // (o fetch falha com "fetch failed", sem erro do PostgREST). Entao pagina-se a
  // coluna e faz-se a diferenca em memoria.
  const vivos = new Set(ids);

  async function orfaosDe(tabela, filtroPrt) {
    const porComp = new Map();
    const idsOrf = new Set();
    let lidas = 0, f2 = 0;
    for (;;) {
      let q = sb.from(tabela).select(tabela === "monthly_closing_entries"
        ? "year,month,monthly_closing_import_id"
        : "competencia,monthly_closing_import_id");
      if (filtroPrt) q = q.eq("entry_type", "PRT");
      const { data, error } = await q.range(f2, f2 + 999);
      if (error) { console.log("  ERRO paginando " + tabela + ": " + error.message); break; }
      for (const r of data || []) {
        lidas++;
        const iid = r.monthly_closing_import_id;
        if (!iid || vivos.has(iid)) continue;
        idsOrf.add(iid);
        const k = r.competencia || (r.year + "-" + String(r.month).padStart(2, "0"));
        porComp.set(k, (porComp.get(k) || 0) + 1);
      }
      if (!data || data.length < 1000) break;
      f2 += 1000;
    }
    return { lidas, porComp, idsOrf };
  }

  console.log("\n--- varrendo monthly_closing_entries (PRT) por FK orfa ---");
  const e = await orfaosDe("monthly_closing_entries", true);
  const totalOrf = [...e.porComp.values()].reduce((a, b) => a + b, 0);
  console.log("  linhas lidas: " + e.lidas + "   ORFAS: " + totalOrf + "   import_ids orfaos distintos: " + e.idsOrf.size);
  if (totalOrf) {
    console.log("  por competencia:");
    for (const kv of [...e.porComp].sort()) console.log("    " + kv[0] + ": " + kv[1]);
    console.log("  >>> UMA linha orfa ja basta: o INSERT da funcao e uma instrucao so,");
    console.log("      a FK viola (23503) e a chamada INTEIRA aborta sem gravar nada.");
  } else {
    console.log("  >>> nenhuma orfa. A hipotese da FK esta DESCARTADA.");
  }

  console.log("\n--- contraste: producao_contrato ja gravada aponta para imports vivos? ---");
  const p = await orfaosDe("producao_contrato", false);
  const pOrf = [...p.porComp.values()].reduce((a, b) => a + b, 0);
  console.log("  linhas lidas: " + p.lidas + "   apontando para import inexistente: " + pOrf);
  if (pOrf) console.log("  >>> se > 0, a FK NAO esta ativa na tabela (o banco nao teria aceitado).");

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
