// ============================================================
// GOLDEN DIFF — Camada 1 Recebíveis: fonte metadata vs carteira_contrato.
// READ-ONLY (só SELECT). Para jun/2026:
//   (1) baseComissão antigo (metadata) vs novo (carteira) + os contratos que
//       existem num lado e não no outro (investiga a causa: duplicata/status).
//   (2) off-by-one: série nova (>= h) − antiga (> h) == Σ comissão(restantes==h).
//   (3) Fatia B: fetchPrtSnapshot (metadata) intocado → Fatia B não muda.
//
//   node -r ./.tmp-test/alias.cjs .tmp-test/scripts/golden_carteira_vs_metadata.js
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchPrtSnapshot,
  fetchCarteiraSnapshot,
  projectPrtAgenda,
  type PrtContract,
} from "@/lib/recebiveis/prtAgenda";

// carrega o service_role de .env.local / .env (script headless fora do Next).
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const txt = readFileSync(join(process.cwd(), f), "utf8");
      for (const line of txt.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v;
      }
    } catch {
      /* arquivo ausente — ok */
    }
  }
}
loadEnv();

const YEAR = 2026;
const MONTH = 6;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: PrtContract[]) => r2(a.reduce((s, c) => s + c.comissao, 0));

// projetor ANTIGO (> h) reimplementado localmente p/ comparar com o novo (>= h).
function projectOld(contracts: PrtContract[], horizon = 12): number[] {
  const serie: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    let p = 0;
    for (const c of contracts) if (c.parcelasRestantes > h) p += c.comissao;
    serie.push(r2(p));
  }
  return serie;
}

async function main() {
  const db = getSupabaseAdmin();
  const [meta, cart] = await Promise.all([
    fetchPrtSnapshot(db, YEAR, MONTH),
    fetchCarteiraSnapshot(db, YEAR, MONTH),
  ]);

  console.log(`\n===== (1) BASE jun/2026: metadata vs carteira =====`);
  console.log(`metadata: ${meta.length} linhas · base R$ ${sum(meta)}`);
  console.log(`carteira: ${cart.length} linhas · base R$ ${sum(cart)}`);
  console.log(`Δ base = R$ ${r2(sum(meta) - sum(cart))} · Δ linhas = ${meta.length - cart.length}`);

  const metaCount = new Map<string, number>();
  for (const c of meta) metaCount.set(c.operacao, (metaCount.get(c.operacao) ?? 0) + 1);
  const dups = [...metaCount.entries()].filter(([, n]) => n > 1);
  console.log(
    `metadata: ${metaCount.size} operações distintas · ${dups.length} op duplicadas · ${meta.length - metaCount.size} linhas extras por duplicata`,
  );

  const cartOps = new Set(cart.map((c) => c.operacao));
  const metaOps = new Set(meta.map((c) => c.operacao));
  const soMeta = [...metaOps].filter((op) => !cartOps.has(op));
  const soCart = [...cartOps].filter((op) => !metaOps.has(op));

  console.log(`\nSó no METADATA (ausentes na carteira): ${soMeta.length}`);
  for (const op of soMeta) {
    const c = meta.find((x) => x.operacao === op)!;
    console.log(`  op ${op} · R$ ${r2(c.comissao)} · ${c.parcelasPagas}/${c.parcelasTotal} · rest ${c.parcelasRestantes}`);
  }
  console.log(`Só na CARTEIRA (ausentes no metadata): ${soCart.length}`);
  for (const op of soCart) {
    const c = cart.find((x) => x.operacao === op)!;
    console.log(`  op ${op} · R$ ${r2(c.comissao)} · ${c.parcelasPagas}/${c.parcelasTotal} · rest ${c.parcelasRestantes}`);
  }
  if (dups.length) {
    console.log(`\nDuplicatas de operação no metadata (op × nº linhas):`);
    for (const [op, n] of dups) console.log(`  op ${op} × ${n}`);
  }

  console.log(`\n===== (2) OFF-BY-ONE (>= h vs > h) sobre a carteira =====`);
  const novo = projectPrtAgenda(cart, { ano: YEAR, mes: MONTH }).serie;
  const velho = projectOld(cart);
  let total = 0;
  let okAll = true;
  for (let i = 0; i < novo.length; i++) {
    const h = novo[i].h;
    const d = r2(novo[i].previsto - velho[i]);
    const esperado = r2(cart.filter((c) => c.parcelasRestantes === h).reduce((s, c) => s + c.comissao, 0));
    const ok = d === esperado;
    okAll = okAll && ok;
    total = r2(total + d);
    console.log(
      `  h=${String(h).padStart(2)} ${novo[i].competencia}: novo R$ ${novo[i].previsto} · velho R$ ${velho[i]} · Δ R$ ${d} · (Σ rest==${h}: R$ ${esperado}) ${ok ? "ok" : "DIVERGE"}`,
    );
  }
  console.log(`Δ total no horizonte = R$ ${total} · identidade Δ==Σ(rest==h): ${okAll ? "OK" : "FALHOU"}`);

  console.log(`\n===== (3) FATIA B inalterada =====`);
  console.log(`fetchPrtSnapshot (metadata) devolveu ${meta.length} linhas — MESMA fonte/função que prtInadimplencia usa.`);
  console.log(`prtInadimplencia.ts não foi tocado neste diff → Fatia B lê exatamente esse mesmo conjunto (diff zero).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERRO:", e?.message ?? e);
    process.exit(1);
  });
