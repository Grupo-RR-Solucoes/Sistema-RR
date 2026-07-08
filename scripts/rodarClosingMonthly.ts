// ============================================================================
// scripts/rodarClosingMonthly.ts — SUB-PR 2, teste manual. GRAVA o PMR.
//
// Chama consolidateMonthlyFromClosing para a competência (default 2026/6),
// grava em promoter_monthly_results com source='fechamento' e IMPRIME o que
// gravou (promotor | production_commission | insurance_commission | final |
// source) para conferência contra o protótipo ANTES de qualquer virada de tela.
//
// Rodar (offline, LIB real via _ts_register):
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/rodarClosingMonthly.ts')"
//   (competência opcional via env CLOSING_YEAR / CLOSING_MONTH)
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { consolidateMonthlyFromClosing } from "@/lib/closingMonthly.ts";

// .env.local vence (a chave de .env é legacy/desabilitada) — mesmo padrão do dump.
(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const YEAR = Number(process.env.CLOSING_YEAR || 2026);
const MONTH = Number(process.env.CLOSING_MONTH || 6);

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad(s: string, n: number): string {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string | number, n: number): string {
  s = String(s);
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`############ consolidateMonthlyFromClosing — ${YEAR}/${String(MONTH).padStart(2, "0")} (GRAVA PMR source='fechamento') ############\n`);

  const res = await consolidateMonthlyFromClosing(supabase as any, { year: YEAR, month: MONTH });

  console.log(
    `Diagnóstico: ${res.contratos_processados} contratos processados | ${res.contratos_herdados} herdados do diário | ${res.orfaos_sem_dono} órfãos sem dono | ${res.bbts_excluidos} BBTS excluídos | ${res.restritas.length} restritas SRCC | ${res.promoters_calculated} promotores gravados\n`
  );

  const W = { nome: 36, val: 16 };
  const header =
    pad("PROMOTOR", W.nome) +
    padL("PRODUCTION", W.val) +
    padL("INSURANCE", W.val) +
    padL("FINAL", W.val) +
    "  source";
  console.log(header);
  console.log("-".repeat(header.length));

  let tP = 0, tI = 0, tF = 0;
  for (const r of res.table) {
    tP += r.production_commission_value;
    tI += r.insurance_commission_value;
    tF += r.final_commission_value;
    console.log(
      pad(r.promoter_name.slice(0, W.nome - 1), W.nome) +
        padL(brl(r.production_commission_value), W.val) +
        padL(brl(r.insurance_commission_value), W.val) +
        padL(brl(r.final_commission_value), W.val) +
        "  " + r.source
    );
  }
  console.log("-".repeat(header.length));
  console.log(
    pad(`TOTAL (${res.table.length} promotores)`, W.nome) +
      padL(brl(tP), W.val) +
      padL(brl(tI), W.val) +
      padL(brl(tF), W.val)
  );
  console.log(`\nGRAVADO em promoter_monthly_results (source='fechamento', onConflict promoter_id,year,month).`);
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
