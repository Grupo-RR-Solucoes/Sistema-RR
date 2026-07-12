#!/usr/bin/env node
/**
 * scripts/test_debitos_edicao.cjs — testa updateDebit (edição transversal) contra um
 * Supabase FALSO em memória. Não toca o banco de produção.
 *
 * Prova:
 *   1. Um débito AUTOMÁTICO pode ser PARCELADO depois (1 parcela -> N) — eixo 2.
 *   2. Parcelas já APLICADAS (mês pago) NÃO são alteradas; só as PENDENTES são reescritas.
 *   3. Editar o valor total redistribui só o SALDO nas parcelas pendentes.
 *   4. Centavos fecham exatamente no total (última parcela absorve a sobra).
 *   5. Guardas: total menor que o já pago e nº de parcelas insuficiente são recusados.
 *
 * Uso: node scripts/test_debitos_edicao.cjs
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Module = require("module");

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------- fake supabase
function makeFakeSupabase(state) {
  function table(name) {
    if (!state[name]) state[name] = [];
    return state[name];
  }
  let seq = 100;

  return {
    from(name) {
      const ctx = { name, op: "select", filters: [], patch: null, rows: null };
      const matches = (row) =>
        ctx.filters.every(([col, val, kind]) =>
          kind === "in" ? val.includes(row[col]) : row[col] === val
        );
      const run = () => {
        const t = table(ctx.name);
        if (ctx.op === "select") return { data: t.filter(matches), error: null };
        if (ctx.op === "delete") {
          const keep = t.filter((r) => !matches(r));
          state[ctx.name] = keep;
          return { data: null, error: null };
        }
        if (ctx.op === "update") {
          for (const r of t) if (matches(r)) Object.assign(r, ctx.patch);
          return { data: null, error: null };
        }
        if (ctx.op === "insert") {
          for (const r of ctx.rows) t.push({ id: `id-${seq++}`, ...r });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const api = {
        select() { if (ctx.op === "select") ctx.op = "select"; return api; },
        eq(col, val) { ctx.filters.push([col, val]); return api; },
        in(col, vals) { ctx.filters.push([col, vals, "in"]); return api; },
        order() { return api; },
        limit() { return api; },
        delete() { ctx.op = "delete"; return api; },
        update(patch) { ctx.op = "update"; ctx.patch = patch; return api; },
        insert(rows) { ctx.op = "insert"; ctx.rows = Array.isArray(rows) ? rows : [rows]; return api; },
        single() {
          const out = run();
          return Promise.resolve({ data: (out.data || [])[0] ?? null, error: null });
        },
        then(resolve, reject) {
          try {
            return Promise.resolve(run()).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).catch(reject);
          }
        },
      };
      return api;
    },
  };
}

// ------------------------------------------------------------------ compila lib
function loadLib() {
  const OUT = fs.mkdtempSync(path.join(ROOT, ".debitos-edit-out-"));
  process.on("exit", () => {
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch (_e) {}
  });
  const tsconfig = {
    compilerOptions: {
      target: "ES2020", module: "commonjs", moduleResolution: "node",
      esModuleInterop: true, resolveJsonModule: true,
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true,
      skipLibCheck: true, strict: false, noEmit: false, noEmitOnError: false,
      typeRoots: [path.join(ROOT, "node_modules/@types")], types: ["node"],
      baseUrl: ROOT, paths: { "@/*": ["./*"] }, outDir: OUT, rootDir: ROOT,
    },
    include: [path.join(ROOT, "lib/debitsData.ts"), path.join(ROOT, "lib/debitRules.ts")],
  };
  const cfg = path.join(OUT, "tsconfig.edit.json");
  fs.writeFileSync(cfg, JSON.stringify(tsconfig));
  try { execSync(`npx tsc -p "${cfg}"`, { cwd: ROOT, stdio: "pipe" }); } catch (_e) {}
  const alvo = path.join(OUT, "lib/debitsData.js");
  if (!fs.existsSync(alvo)) throw new Error("tsc nao emitiu debitsData.js");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@/")) request = path.join(OUT, request.slice(2));
    return origResolve.call(this, request, ...rest);
  };
  return require(alvo);
}

// ------------------------------------------------------------------------ testes
let falhas = 0;
function ok(cond, msg) {
  console.log(`  ${cond ? "OK  " : "FALHOU  "}${msg}`);
  if (!cond) falhas++;
}
const soma = (rows) => Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;

function cenarioBase({ kind, total, parcelas, aplicadas = 0 }) {
  const state = { promoter_debits: [], promoter_discounts: [] };
  state.promoter_debits.push({
    id: "D1", promoter_id: "P1", company_id: "C1", kind, debit_type: "CANCELAMENTO_SEGURO",
    total_amount: total, installments_total: parcelas, start_year: 2026, start_month: 6, status: "ACTIVE",
  });
  const valor = Math.round((total / parcelas) * 100) / 100;
  for (let i = 0; i < parcelas; i++) {
    state.promoter_discounts.push({
      id: `P${i + 1}`, debit_id: "D1", promoter_id: "P1", company_id: "C1",
      year: 2026, month: 6 + i, discount_type: "CANCELAMENTO_SEGURO",
      amount: i === parcelas - 1 ? Math.round((total - valor * (parcelas - 1)) * 100) / 100 : valor,
      installments: parcelas, installment_number: i + 1,
      status: i < aplicadas ? "APPLIED" : "PENDING",
    });
  }
  return state;
}

(async () => {
  const lib = loadLib();
  console.log("\n=== EDICAO DE DEBITO (updateDebit) — supabase falso, prod intocado ===\n");

  // 1. Debito AUTOMATICO de 1 parcela -> parcelado em 3 (eixo 2: parcelamento manual
  //    sobreposto a um debito automatico).
  {
    const state = cenarioBase({ kind: "AUTO", total: 300, parcelas: 1 });
    const sb = makeFakeSupabase(state);
    const res = await lib.updateDebit(sb, { debitId: "D1", installmentsTotal: 3 });
    const ps = state.promoter_discounts;
    console.log("  [1] AUTO 300,00 em 1 parcela -> parcelar em 3:");
    for (const p of ps) console.log(`      ${p.year}-${String(p.month).padStart(2, "0")} parcela ${p.installment_number}/${p.installments} = ${p.amount} (${p.status})`);
    ok(ps.length === 3, "gerou 3 parcelas a partir de um debito AUTO");
    ok(soma(ps) === 300, `soma das parcelas = 300,00 (deu ${soma(ps)})`);
    ok(ps.map((p) => p.month).join(",") === "6,7,8", "parcelas em meses consecutivos (6,7,8)");
    ok(state.promoter_debits[0].installments_total === 3, "installments_total do plano virou 3");
    ok(res.parcelasPreservadas === 0, "nada aplicado ainda -> 0 preservadas");
  }

  // 2. Parcela ja APLICADA nao muda; editar o total redistribui so o SALDO.
  {
    const state = cenarioBase({ kind: "MANUAL", total: 300, parcelas: 3, aplicadas: 1 });
    const aplicadaAntes = { ...state.promoter_discounts[0] };
    const sb = makeFakeSupabase(state);
    const res = await lib.updateDebit(sb, { debitId: "D1", totalAmount: 240 });
    const ps = state.promoter_discounts;
    const aplicada = ps.find((p) => p.status === "APPLIED");
    const pendentes = ps.filter((p) => p.status === "PENDING");
    console.log("\n  [2] MANUAL 300,00 (1a parcela de 100,00 JA PAGA) -> total editado p/ 240,00:");
    for (const p of ps) console.log(`      ${p.year}-${String(p.month).padStart(2, "0")} = ${p.amount} (${p.status})`);
    ok(aplicada && aplicada.amount === aplicadaAntes.amount, `parcela APLICADA intacta (${aplicadaAntes.amount})`);
    ok(res.desceu === 100, `ja descontado reconhecido = 100,00 (deu ${res.desceu})`);
    ok(res.restante === 140, `saldo a redistribuir = 140,00 (deu ${res.restante})`);
    ok(pendentes.length === 2 && soma(pendentes) === 140, `2 pendentes somando 140,00 (deu ${soma(pendentes)})`);
    ok(soma(ps) === 240, `total do plano fecha em 240,00 (deu ${soma(ps)})`);
    ok(res.parcelasPreservadas === 1, "1 parcela preservada");
  }

  // 3. Centavos fecham no total.
  {
    const state = cenarioBase({ kind: "AUTO", total: 100, parcelas: 1 });
    const sb = makeFakeSupabase(state);
    await lib.updateDebit(sb, { debitId: "D1", installmentsTotal: 3 });
    const ps = state.promoter_discounts;
    console.log("\n  [3] 100,00 em 3 parcelas (centavos):", ps.map((p) => p.amount).join(" + "));
    ok(soma(ps) === 100, `soma exata = 100,00 (deu ${soma(ps)})`);
  }

  // 4. GUARDA: total menor que o ja pago.
  {
    const state = cenarioBase({ kind: "MANUAL", total: 300, parcelas: 3, aplicadas: 2 });
    const sb = makeFakeSupabase(state);
    let erro = null;
    try { await lib.updateDebit(sb, { debitId: "D1", totalAmount: 50 }); } catch (e) { erro = e.message; }
    console.log("\n  [4] total 50,00 com 200,00 ja pago ->", erro ? `recusado: "${erro.slice(0, 60)}..."` : "NAO recusou");
    ok(!!erro, "recusa total menor que o ja descontado (nao mexe em mes pago)");
  }

  // 5. GUARDA: nº de parcelas nao comporta as ja aplicadas + saldo.
  {
    const state = cenarioBase({ kind: "MANUAL", total: 300, parcelas: 3, aplicadas: 2 });
    const sb = makeFakeSupabase(state);
    let erro = null;
    try { await lib.updateDebit(sb, { debitId: "D1", installmentsTotal: 1 }); } catch (e) { erro = e.message; }
    console.log("  [5] reparcelar em 1 com 2 ja aplicadas ->", erro ? `recusado: "${erro.slice(0, 60)}..."` : "NAO recusou");
    ok(!!erro, "recusa nº de parcelas que nao comporta as aplicadas + saldo");
  }

  console.log(`\n=== ${falhas === 0 ? "PASSOU" : "FALHOU"} — ${falhas} falha(s) ===\n`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
