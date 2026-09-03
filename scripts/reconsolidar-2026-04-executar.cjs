/*
 * RECONSOLIDACAO DE 2026-04 — ESCREVE EM PRODUCAO. Autorizada pelo Diego em
 * 03/09/2026, depois do dry-run.
 *
 * O QUE ELA CONSERTA: `cmsMonthly` ja zerava a comissao da chave master na
 * origem; `closingMonthly` NAO — dai 2 linhas vivas em 2026-04,
 * source='fechamento', somando R$ 164,04 que a chave master (um BALDE, nao uma
 * pessoa) nunca deveria ter recebido. O conserto entrou em `c7f8643`; esta
 * competencia e fechada e nao se reconsolida sozinha.
 *
 * O QUE ELA NAO E: reconsolidacao de 2026-07 esta EXPLICITAMENTE FORA. La a
 * comissao BRUTA nao se move (132.671,58 -> 132.671,63) e o que muda e so o
 * REPASSE: -5.225,75 em 20 promotores JA PAGOS, todos perdendo. Isso e aplicar
 * regua nova a mes pago, nao corrigir erro. Decisao do Diego: nao fazer, e
 * nomear a divida no handoff.
 *
 * GUARDA: por padrao roda em DRY-RUN. Para escrever de verdade:
 *   EXECUTAR=1 TRP_SOURCE=db node -e "require('./scripts/_ts_register.cjs');require('./scripts/reconsolidar-2026-04-executar.cjs')"
 *
 * TRP_SOURCE=db NAO E OPCIONAL: sem a flag o script local resolve a TRP pelo
 * JSON enquanto a producao usa o banco. Medi os dois lados em 2026-04 e o PMR
 * sai IDENTICO — mas "medi e da no mesmo" nao e razao para rodar diferente da
 * producao numa escrita.
 *
 * O ANTES vai para disco ANTES de qualquer escrita. Sem isso o "antes/depois"
 * seria reconstruido de memoria, que e como um numero errado vira verdade.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");

(function carregarEnv() {
  for (const arquivo of [".env", ".env.local"]) {
    const p = path.join(ROOT, arquivo);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
})();

const { reconsolidarCompetenciaFechada } = require("../lib/reconsolidarCompetencia.ts");

const YEAR = Number(process.env.ANO || 2026);
const MONTH = Number(process.env.MES || 4);
const EXECUTAR = process.env.EXECUTAR === "1";

const CAMPOS = [
  "production_value",
  "proposal_count",
  "production_commission_value",
  "insurance_commission_value",
  "agreement_adjustment_value",
  "discount_value",
  "final_commission_value",
  "target_status",
  "piso_zerou",
  "source",
];

const n = (v) => (v == null || v === "" ? 0 : Number(v));
const brl = (v) =>
  (v < 0 ? "-" : "") +
  Math.abs(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    .replace(/\.(\d{2})$/, ",$1");
const chave = (r) => `${r.promoter_id}||${r.company_id ?? "NULL"}`;

async function lerPmr(sb) {
  const linhas = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("promoter_monthly_results")
      .select("*")
      .eq("year", YEAR)
      .eq("month", MONTH)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return linhas;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("credencial do Supabase ausente (.env.local)");
  if (!process.env.TRP_SOURCE) {
    throw new Error(
      "TRP_SOURCE ausente. Rode com TRP_SOURCE=db — a producao usa o banco e uma " +
        "escrita nao se faz com a fonte de regra diferente da dela."
    );
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const comp = `${YEAR}-${String(MONTH).padStart(2, "0")}`;

  console.log(`\n=== RECONSOLIDACAO ${comp} — modo ${EXECUTAR ? "*** ESCRITA ***" : "dry-run"}`);
  console.log(`TRP_SOURCE=${process.env.TRP_SOURCE}`);

  const antes = await lerPmr(sb);
  const arquivoAntes = path.join(
    ROOT,
    `.pmr-${comp}-antes-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(arquivoAntes, JSON.stringify(antes, null, 1), "utf8");
  console.log(`ANTES: ${antes.length} linhas -> ${path.basename(arquivoAntes)}`);

  const res = await reconsolidarCompetenciaFechada(sb, {
    year: YEAR,
    month: MONTH,
    dryRun: !EXECUTAR,
  });
  console.log(
    `regime='${res.regime}' ran=${res.ran} dry_run=${res.dry_run} gravadas=${res.gravadas}` +
      (res.motivo ? `\nmotivo: ${res.motivo}` : "")
  );
  if (res.reconciliacao) {
    console.log(`reconciliacao: ${JSON.stringify(res.reconciliacao)}`);
  }
  if (!res.ran) return;

  const depois = EXECUTAR ? await lerPmr(sb) : [];
  if (!EXECUTAR) {
    console.log("\n(dry-run: nada gravado, nao ha 'depois' para ler. Use EXECUTAR=1.)");
    return;
  }

  const A = new Map(antes.map((r) => [chave(r), r]));
  const B = new Map(depois.map((r) => [chave(r), r]));
  const ids = [...new Set([...antes, ...depois].map((r) => r.promoter_id))];
  const nome = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("promoters").select("id, name").in("id", ids.slice(i, i + 200));
    for (const p of data || []) nome.set(p.id, p.name);
  }

  let somaA = 0;
  let somaB = 0;
  for (const r of antes) somaA += n(r.final_commission_value);
  for (const r of depois) somaB += n(r.final_commission_value);

  console.log(`\nDEPOIS: ${depois.length} linhas`);
  console.log(
    `Sigma final_commission_value: ${brl(somaA)} -> ${brl(somaB)} (delta ${brl(somaB - somaA)})`
  );

  const mudou = [];
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(k);
    const b = B.get(k);
    const difs = [];
    for (const c of CAMPOS) {
      const va = a ? a[c] : null;
      const vb = b ? b[c] : null;
      const num = typeof va === "number" || typeof vb === "number";
      const igual = num
        ? Math.abs(n(va) - n(vb)) < 0.005
        : String(va ?? "") === String(vb ?? "");
      if (!igual) difs.push(`${c}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
    }
    if (difs.length || !a || !b) {
      mudou.push({
        k,
        pid: (a || b).promoter_id,
        cid: (a || b).company_id,
        delta: n(b && b.final_commission_value) - n(a && a.final_commission_value),
        difs,
        sumiu: !!a && !b,
        nova: !a && !!b,
      });
    }
  }
  mudou.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  console.log(`\nlinhas alteradas: ${mudou.length} de ${antes.length}`);
  for (const m of mudou) {
    console.log(
      `\n  ${nome.get(m.pid) || m.pid}  [company ${m.cid ?? "NULL"}]` +
        (m.sumiu ? "  *** SUMIU ***" : "") +
        (m.nova ? "  *** NOVA ***" : "") +
        `\n     delta final: ${brl(m.delta)}`
    );
    for (const d of m.difs) console.log(`     ${d}`);
  }
  if (mudou.length === 0) console.log("  (nenhuma — a competencia ja estava reconsolidada)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
