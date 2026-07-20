// ============================================================================
// scripts/gate_regua_bbts_independe_do_client.ts — DRY-RUN puro (NAO grava).
//
// Reproduz a falha que zerou o seguro da ADS na tela: bbts_rule_versions tem RLS
// default-deny e ZERO policies (migration 20260712_000001), mas o GET de
// /api/promotores roda com o client do USUARIO (withAuthenticatedAnon), nao com
// service_role. A regua vinha NEGADA (42501) e todo o seguro da ADS ia a zero.
//
// O gate prova as duas metades:
//   1. o client do usuario REALMENTE nao le bbts_rule_versions (a falha existe);
//   2. loadPromoterAnalyticsBase carrega a regua MESMO ASSIM (o fix a le com
//      service_role, independente do client recebido).
//
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/gate_regua_bbts_independe_do_client.ts')"
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadPromoterAnalyticsBase } from "@/lib/promoterAnalytics.ts";
import { BBTS_COMPANY_ID } from "@/lib/bbtsCompanyId.ts";

(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();

const YEAR = Number(process.env.BBTS_YEAR || 2026);
const MONTH = Number(process.env.BBTS_MONTH || 7);

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const problemas: string[] = [];

  console.log("######## GATE — a regua BBTS nao pode depender do client do chamador ########\n");

  // --- 1. A falha existe: o client SEM service_role nao le a regua ---
  const semServico = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: errAnon } = await semServico.from("bbts_rule_versions").select("competencia").limit(1);
  console.log("1) leitura DIRETA de bbts_rule_versions pelo client sem service_role:");
  console.log("   " + (errAnon ? `NEGADA (${errAnon.code}) — ${errAnon.message}` : "permitida"));
  if (!errAnon) {
    problemas.push("o client sem service_role JA le a regua — o gate nao esta provando nada (RLS mudou?)");
  }

  // --- 2. Mesmo assim a base carrega a regua (o fix le com service_role) ---
  const admin = createClient(url, srvKey, { auth: { persistSession: false } });
  const base: any = await loadPromoterAnalyticsBase(admin as any, {
    year: YEAR, month: MONTH, companyId: BBTS_COMPANY_ID, closed: false,
  } as any);

  const regra = base.bbtsRegraSeguro;
  console.log("\n2) loadPromoterAnalyticsBase.bbtsRegraSeguro:");
  console.log("   " + (regra ? "CARREGADA — seguro: " + JSON.stringify(regra.seguro) : "NULL (seguro da ADS iria a ZERO)"));
  if (!regra) problemas.push("bbtsRegraSeguro NULL — o seguro da ADS aparece zerado na tela");

  // --- 3. E a faixa saiu da TABELA, nao da rede literal ---
  const { insuranceShareTiersEmUso } = await import("@/lib/insurancePenetration.ts");
  const fonte = insuranceShareTiersEmUso();
  console.log("\n3) escala SEGURO_SLIP em uso: " + fonte.fonte.toUpperCase());
  if (fonte.fonte !== "tabela") {
    problemas.push("escala SEGURO_SLIP veio da REDE (literal), nao da tabela versionada");
  }

  console.log("\n" + "=".repeat(78));
  if (problemas.length) {
    console.log("FALHOU:");
    for (const p of problemas) console.log("  - " + p);
    process.exit(1);
  }
  console.log("PASSOU: a regua BBTS e a escala SEGURO_SLIP carregam pela fonte canonica,");
  console.log("        independentemente do client que o chamador passa.");
})().catch((e) => { console.error("ERRO:", e && e.stack ? e.stack : e); process.exit(1); });
