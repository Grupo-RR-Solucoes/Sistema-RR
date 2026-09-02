#!/usr/bin/env node
/**
 * scripts/diag-efeitos-colaterais-agosto.cjs — POR QUE os efeitos colaterais
 * best-effort do import de fechamento nao apareceram. READ-ONLY.
 *
 * HIPOTESE DESCARTADA — nao gastar tempo nela de novo (correcao do Diego,
 * 02/09/2026): a planilha do fechamento vai INTEIRA, com os campos VAZIOS para os
 * produtos que ainda nao chegaram (consorcio, BBCAP). Logo `produto` = "TODOS"
 * SEMPRE, e a condicao do bloco (1) (route.ts:57 `fileType === "TODOS"`) esta
 * sempre satisfeita. O `if` NAO e a causa dos dois meses de carteira parada. A
 * medicao do item A abaixo continua util como registro, mas ela NAO discrimina
 * nada: nao existe import de fechamento que caia no outro lado desse `if`.
 *
 * Mede, sem chamar nenhuma RPC de escrita:
 *   A. o `produto`/signature gravado nos imports do ALVO (ver acima: e sempre
 *      "TODOS" — serve de registro, nao de discriminante);
 *   B. se ha entries PRT do ALVO em monthly_closing_entries (materia-prima que a
 *      materializacao teria consumido);
 *   C. ate onde producao_contrato / carteira_contrato foram alimentados
 *      (max competencia) — a carteira e TRUNCATE+INSERT, entao o carimbo de
 *      tempo dela e a prova de quando rodou pela ultima vez;
 *   D. o vintage que o congelamento TERIA usado: agenda.snapshot.competencia sai
 *      de carteira_contrato, entao (2) so anda se (1) andar;
 *   E. o monitor de inadimplencia por competencia, com carimbo de tempo real.
 *
 * Uso: node scripts/diag-efeitos-colaterais-agosto.cjs [alvo]   (default 2026-08)
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const ALVO = process.argv[2] || "2026-08";
const yA = Number(ALVO.slice(0, 4));
const mA = Number(ALVO.slice(5, 7));
const brl = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const { data: comps } = await sb.from("companies").select("id,name");
  const nome = (id) => ((comps || []).find((c) => c.id === id) || {}).name || String(id).slice(0, 8);

  console.log("\n### A. os imports do ALVO e o `produto` (signature => fileType) ###");
  const { data: imps } = await sb.from("monthly_closing_imports").select("*").eq("year", yA).eq("month", mA).order("created_at");
  for (const i of imps || []) {
    console.log("  " + String(i.created_at).slice(0, 19) + "  " + nome(i.company_id).padEnd(24) +
      " status=" + i.status + "  codigo=" + (i.codigo_arquivo || "-") +
      "\n      produto/signature: " + JSON.stringify(i.produto));
    if (i.error_message) console.log("      error_message: " + i.error_message);
  }
  console.log("\n  --- comparacao: os imports de 2026-07 (mesma pergunta) ---");
  const { data: imps7 } = await sb.from("monthly_closing_imports").select("created_at,company_id,status,produto").eq("year", 2026).eq("month", 7).order("created_at");
  for (const i of imps7 || []) {
    console.log("  " + String(i.created_at).slice(0, 19) + "  " + nome(i.company_id).padEnd(24) + " status=" + i.status + "  produto=" + JSON.stringify(i.produto));
  }

  console.log("\n### B. entries PRT por competencia em monthly_closing_entries ###");
  for (const [y, m] of [[2026, 6], [2026, 7], [2026, 8]]) {
    const { count, error } = await sb.from("monthly_closing_entries")
      .select("*", { count: "exact", head: true })
      .eq("year", y).eq("month", m).eq("entry_type", "PRT");
    console.log("  " + y + "-" + String(m).padStart(2, "0") + "  entries PRT = " + (error ? "ERRO " + error.message : count));
  }
  const { count: totEntries } = await sb.from("monthly_closing_entries")
    .select("*", { count: "exact", head: true }).eq("year", yA).eq("month", mA);
  console.log("  " + ALVO + "  entries de QUALQUER tipo = " + totEntries);
  // quais tipos entraram no alvo
  const { data: amostraTipos } = await sb.from("monthly_closing_entries")
    .select("entry_type").eq("year", yA).eq("month", mA).limit(5000);
  const tipos = new Map();
  for (const r of amostraTipos || []) tipos.set(r.entry_type, (tipos.get(r.entry_type) || 0) + 1);
  console.log("  tipos presentes em " + ALVO + " (amostra ate 5000): " + [...tipos].sort().map((kv) => kv[0] + "=" + kv[1]).join("  "));

  console.log("\n### C. ate onde producao_contrato / carteira_contrato foram alimentados ###");
  for (const t of ["producao_contrato", "carteira_contrato"]) {
    const { data: mx } = await sb.from(t).select("competencia").order("competencia", { ascending: false }).limit(1);
    const { data: mn } = await sb.from(t).select("competencia").order("competencia", { ascending: true }).limit(1);
    const { count } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log("  " + t.padEnd(20) + " linhas=" + String(count).padStart(7) +
      "  competencia: " + (mn && mn[0] ? mn[0].competencia : "?") + " -> " + (mx && mx[0] ? mx[0].competencia : "?"));
    for (const c of ["2026-06", "2026-07", "2026-08"]) {
      const { count: n } = await sb.from(t).select("*", { count: "exact", head: true }).eq("competencia", c);
      console.log("      " + c + ": " + n);
    }
  }

  console.log("\n### D. o vintage que o congelamento usaria (= max competencia da carteira) ###");
  const { data: cmax } = await sb.from("carteira_contrato").select("competencia").order("competencia", { ascending: false }).limit(1);
  const vintageEsperado = cmax && cmax[0] ? cmax[0].competencia : "(carteira vazia)";
  console.log("  agenda.snapshot.competencia seria: " + vintageEsperado);
  const { data: vs } = await sb.from("previsao_snapshot").select("competencia_snapshot,data_congelamento");
  const vint = new Map();
  for (const r of vs || []) {
    const a = vint.get(r.competencia_snapshot) || { n: 0, ult: "" };
    a.n++;
    if (String(r.data_congelamento) > a.ult) a.ult = r.data_congelamento;
    vint.set(r.competencia_snapshot, a);
  }
  for (const kv of [...vint].sort()) console.log("  vintage gravado " + kv[0] + ": " + kv[1].n + " linhas, ultimo data_congelamento " + String(kv[1].ult).slice(0, 19));
  console.log("  >>> ha vintage para " + ALVO + "? " + (vint.has(ALVO) ? "SIM" : "NAO"));

  console.log("\n### E. monitor de inadimplencia — colunas reais e carimbo ###");
  const { data: um } = await sb.from("prt_inadimplencia_monitor").select("*").limit(1);
  const cols = um && um[0] ? Object.keys(um[0]) : [];
  console.log("  colunas: " + cols.join(", "));
  const tcol = ["atualizado_em", "criado_em", "created_at", "updated_at"].find((c) => cols.indexOf(c) >= 0);
  if (tcol) {
    const { data: recentes } = await sb.from("prt_inadimplencia_monitor")
      .select("competencia," + tcol).order(tcol, { ascending: false }).limit(5);
    console.log("  5 linhas mais recentes por " + tcol + ":");
    for (const r of recentes || []) console.log("    " + r.competencia + "  " + r[tcol]);
    const { data: doAlvo } = await sb.from("prt_inadimplencia_monitor")
      .select(tcol).eq("competencia", ALVO).order(tcol, { ascending: false }).limit(1);
    const { data: doAlvoMin } = await sb.from("prt_inadimplencia_monitor")
      .select(tcol).eq("competencia", ALVO).order(tcol, { ascending: true }).limit(1);
    console.log("  " + ALVO + ": " + tcol + " de " + (doAlvoMin && doAlvoMin[0] ? doAlvoMin[0][tcol] : "?") +
      " ate " + (doAlvo && doAlvo[0] ? doAlvo[0][tcol] : "?"));
  } else {
    console.log("  (nenhuma coluna de tempo — nao da para datar a execucao)");
  }
  const { count: nAlvo } = await sb.from("prt_inadimplencia_monitor").select("*", { count: "exact", head: true }).eq("competencia", ALVO);
  console.log("  itens em " + ALVO + ": " + nAlvo);

  console.log("\n### F. quem escreveu as linhas source='bbts' do ALVO ###");
  const { data: bbts } = await sb.from("promoter_monthly_results")
    .select("promoter_id,created_at,updated_at,final_commission_value,production_value")
    .eq("year", yA).eq("month", mA).eq("source", "bbts");
  console.log("  " + (bbts || []).length + " linhas; created_at distintos: " +
    [...new Set((bbts || []).map((r) => String(r.created_at).slice(0, 19)))].join(", "));
  const { data: imports_diarios } = await sb.from("daily_imports").select("*").order("created_at", { ascending: false }).limit(6);
  if (imports_diarios) {
    console.log("  ultimos 6 daily_imports:");
    for (const d of imports_diarios) {
      console.log("    " + String(d.created_at).slice(0, 19) + "  " + JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => ["file_name", "company_id", "status", "source", "reference_date", "kind"].indexOf(k) >= 0))));
    }
  }

  console.log("\n=== fim (nada foi gravado) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
