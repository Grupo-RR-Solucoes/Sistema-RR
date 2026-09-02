#!/usr/bin/env node
/**
 * scripts/diag-materializar-insumo-vs-funcao.cjs — POR QUE
 * fn_materializar_producao_contrato nao alimenta 2026-07/08. READ-ONLY.
 *
 * ESTADO DA INVESTIGACAO (02/09/2026)
 * -----------------------------------
 * Ja medido e DESCARTADO:
 *   - o `if fileType === "TODOS"` (a planilha vai inteira; produto e sempre TODOS);
 *   - "a migration nao foi aplicada": o catalogo OpenAPI do PostgREST mostra as
 *     DUAS funcoes expostas ao service_role (scripts/diag-rpc-existe-openapi.cjs).
 *
 * Sobra: a funcao existe, e chamada, e o efeito nao aparece. Duas formas disso:
 *   (a) ela LEVANTA ERRO e o catch best-effort do route.ts engole;
 *   (b) ela roda "com sucesso" e insere ZERO linhas, porque o WHERE dela filtra
 *       tudo:  btrim(coalesce(metadata->>'NRO OPERACAO','')) <> ''
 *       — se a chave do metadata mudou de nome nos arquivos novos, nenhuma linha
 *       casa e nao ha erro nenhum para engolir.
 *
 * (b) tem uma consequencia que o dado ja NEGA em parte: se producao_contrato
 * rodasse sem erro, a segunda RPC (TRUNCATE+INSERT em carteira_contrato) seria
 * chamada e o created_at da carteira seria de HOJE. Ele e de 2026-07-07. Entao
 * ou a primeira levanta erro (e a segunda nunca e chamada), ou as duas levantam.
 *
 * O que este script mede, sem executar as funcoes de escrita:
 *   1. as CHAVES do metadata dos entries PRT em 2026-06 (competencia que
 *      funcionou) contra 2026-07 e 2026-08 — a diferenca de nome de coluna e a
 *      hipotese (b);
 *   2. os VALORES dos 6 campos que a funcao le, procurando o que quebraria os
 *      casts: to_num_br(...) e ::int (lixo tipo '#N/D', vazio, texto);
 *   3. to_num_br E uma RPC exposta e e PURA (so converte texto em numero), entao
 *      da para submeter os valores suspeitos a ELA MESMA em vez de adivinhar o
 *      que ela faz;
 *   4. duplicatas de (numero_operacao, competencia, entry_type) ja gravadas —
 *      se existirem, o indice unico que o ON CONFLICT exige NAO existe, e o
 *      erro seria 42P10.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { createClient } = require(path.join(ROOT, "node_modules/@supabase/supabase-js"));

const CAMPOS = ["NRO OPERAÇÃO", "CHAVE J", "MCI", "VALOR FINANCIADO",
                "QTD PARCELAS TOTAL", "QTD PARCELAS PGS", "COMISSÃO", "COD EST"];
const AMOSTRA = 1200;

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

async function amostraPrt(sb, y, m, n) {
  const { data, error } = await sb.from("monthly_closing_entries")
    .select("metadata").eq("year", y).eq("month", m).eq("entry_type", "PRT").limit(n);
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.metadata || {});
}

function classifica(v) {
  if (v === undefined) return "AUSENTE";
  if (v === null) return "null";
  const s = String(v).trim();
  if (s === "") return "vazio";
  if (/^-?[\d.]*,?\d*$/.test(s) || /^-?\d+(\.\d+)?$/.test(s)) return "numerico";
  return "TEXTO:" + s.slice(0, 14);
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const comps = [[2026, 6], [2026, 7], [2026, 8]];
  const porComp = {};
  for (const [y, m] of comps) porComp[y + "-" + String(m).padStart(2, "0")] = await amostraPrt(sb, y, m, AMOSTRA);

  console.log("\n### 1. CHAVES do metadata dos entries PRT (amostra de ate " + AMOSTRA + ") ###");
  const chavesPorComp = {};
  for (const c of Object.keys(porComp)) {
    const s = new Set();
    for (const md of porComp[c]) for (const k of Object.keys(md)) s.add(k);
    chavesPorComp[c] = s;
    console.log("  " + c + ": " + porComp[c].length + " linhas, " + s.size + " chaves distintas");
  }
  const base = chavesPorComp["2026-06"];
  for (const c of ["2026-07", "2026-08"]) {
    const so6 = [...base].filter((k) => !chavesPorComp[c].has(k));
    const soC = [...chavesPorComp[c]].filter((k) => !base.has(k));
    console.log("\n  " + c + " vs 2026-06:");
    console.log("    chaves que SO 2026-06 tem : " + (so6.length ? so6.join(" | ") : "(nenhuma)"));
    console.log("    chaves que SO " + c + " tem : " + (soC.length ? soC.join(" | ") : "(nenhuma)"));
  }
  console.log("\n  --- os 8 campos que a funcao le, presentes em cada competencia? ---");
  console.log("  campo                    " + Object.keys(porComp).join("   "));
  for (const campo of CAMPOS) {
    const l = Object.keys(porComp).map((c) => (chavesPorComp[c].has(campo) ? "  SIM  " : "  NAO  "));
    console.log("  " + campo.padEnd(24) + l.join("   "));
  }

  console.log("\n### 2. VALORES dos campos numericos — o que quebraria to_num_br/::int ###");
  const suspeitos = new Map();
  for (const c of Object.keys(porComp)) {
    console.log("\n  --- " + c + " ---");
    for (const campo of CAMPOS) {
      const cont = new Map();
      for (const md of porComp[c]) {
        const cl = classifica(md[campo]);
        cont.set(cl, (cont.get(cl) || 0) + 1);
        if (cl.startsWith("TEXTO:") || cl === "vazio" || cl === "AUSENTE") {
          const bruto = md[campo] === undefined ? "(AUSENTE)" : String(md[campo]);
          suspeitos.set(campo + " => " + bruto, (suspeitos.get(campo + " => " + bruto) || 0) + 1);
        }
      }
      const resumo = [...cont].sort((a, b) => b[1] - a[1]).map((kv) => kv[0] + "=" + kv[1]).join("  ");
      console.log("    " + campo.padEnd(22) + resumo);
    }
  }

  console.log("\n### 3. to_num_br submetida aos valores suspeitos (RPC pura, so leitura) ###");
  const lista = [...suspeitos.keys()].slice(0, 25);
  if (!lista.length) console.log("  (nenhum valor suspeito na amostra)");
  for (const s of lista) {
    const bruto = s.split(" => ").slice(1).join(" => ");
    if (bruto === "(AUSENTE)") { console.log("    " + s.padEnd(46) + " -> chave ausente, vira NULL (nao quebra)"); continue; }
    const { data, error } = await sb.rpc("to_num_br", { txt: bruto });
    if (error) {
      const { data: d2, error: e2 } = await sb.rpc("to_num_br", { p_txt: bruto });
      if (e2) { console.log("    " + s.padEnd(46) + " -> RPC recusou (" + error.code + "): " + error.message.slice(0, 90)); continue; }
      console.log("    " + s.padEnd(46) + " -> " + JSON.stringify(d2));
      continue;
    }
    console.log("    " + s.padEnd(46) + " -> " + JSON.stringify(data) + " (ocorrencias na amostra: " + suspeitos.get(s) + ")");
  }

  console.log("\n### 4. duplicatas ja gravadas em producao_contrato (o indice unico existe?) ###");
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from("producao_contrato")
      .select("numero_operacao,competencia,entry_type").range(from, from + 999);
    if (error) { console.log("  ERRO: " + error.message); break; }
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
    if (from > 260000) break;
  }
  const vistos = new Set();
  let dups = 0;
  const exemplos = [];
  for (const r of all) {
    const k = r.numero_operacao + "|" + r.competencia + "|" + r.entry_type;
    if (vistos.has(k)) { dups++; if (exemplos.length < 5) exemplos.push(k); }
    vistos.add(k);
  }
  console.log("  linhas lidas: " + all.length + "  chaves distintas: " + vistos.size + "  DUPLICATAS: " + dups);
  if (dups) {
    console.log("  exemplos: " + exemplos.join(", "));
    console.log("  >>> duplicata PROVA que o indice unico (numero_operacao,competencia,entry_type)");
    console.log("      NAO existe — e sem ele o ON CONFLICT da funcao levanta 42P10 a cada chamada.");
  } else {
    console.log("  >>> sem duplicata. Isto e COMPATIVEL com o indice existir, mas NAO prova que existe");
    console.log("      (dado limpo tambem nao duplica). Fica indeterminado por esta via.");
  }

  console.log("\n=== fim (nada foi gravado; nenhuma funcao de escrita foi executada) ===");
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
