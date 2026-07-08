// ============================================================================
// scripts/dumpComissaoFechamento.ts — SUB-PR 1, passo 4. READ-ONLY.
//
// Roda o fetcher (loadClosingPromoterBase) do FECHAMENTO, aplica a régua do
// promotor SEM gravar nada:
//   à vista : Σ COMISSÃO PF(empresa, já pós-teto) × acordo(promotor)
//             base = comissaoEmpresaAvista da lib = valor FINAL pago pela empresa
//             por contrato. NÃO recalcula de líquido × %, NÃO reaplica min(%,5,80%).
//             acordo = resolvePromoterShareSync (cascata, fonte única) clamp ≤1
//             (validado na Severina JH302454: Σ COMISSÃO PF 2.072,83 × 58,33% = 1.209,08).
//   seguro  : Σ COMISSÃO SEGURO(empresa) × escala SEGURO_SLIP(penetração)
// Agrega POR PROMOTOR e imprime:
//   promotor | comissao_avista | comissao_seguro | bruto | qtd_contratos | qtd_restritas
//
// Rodar (offline, usa a LIB real via _ts_register):
//   node -e "require('./scripts/_ts_register.cjs');require('./scripts/dumpComissaoFechamento.ts')"
//   (opcional args de competência: DUMP_YEAR / DUMP_MONTH no env; default 2026/6)
//
// ESCOPO SUB-PR 1: só o VALOR + restritas. NÃO grava, NÃO cria
// consolidateMonthlyFromClosing, NÃO toca API/UI/daily/cms/auditoria viva.
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadClosingPromoterBase } from "@/lib/closingPromoterBase.ts";

// _ts_register carrega .env ANTES de .env.local (first-wins) e a chave de .env
// está desabilitada ("Legacy API keys"). Força .env.local a vencer p/ as creds.
(function preferEnvLocal() {
  const p = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
})();
import {
  fetchPromoterShareData,
  resolvePromoterShareSync,
} from "@/lib/proposalDetailing.ts";
import {
  fetchInsuranceSlipTiers,
  lookupInsuranceShareFromPenetration,
} from "@/lib/insuranceCalculator.ts";

const YEAR = Number(process.env.DUMP_YEAR || 2026);
const MONTH = Number(process.env.DUMP_MONTH || 6);

function brl(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad(s: string, n: number): string {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  s = String(s);
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log(`############ DUMP comissão por FECHAMENTO — ${YEAR}/${String(MONTH).padStart(2, "0")} (READ-ONLY) ############\n`);

  // 1. Base do fechamento (à vista + seguro embutido), SRCC separado.
  const base = await loadClosingPromoterBase(supabase, { year: YEAR, month: MONTH });
  console.log(
    `Fetcher: ${base.totalCashRows} linhas CASH | ${base.contratos.length} pagáveis | ${base.restritas.length} restritas (SRCC=Sim)`
  );

  // 2. Acordos (cascata fonte única). profilesMap + scalesMap do cadastro;
  //    volume mensal para ENTRANTE_* derivado do PRÓPRIO fechamento (Σ líquido),
  //    para manter o cálculo closing-only (não lê daily).
  const promoterIds = [...new Set(base.contratos.map((c) => c.promoterId).filter(Boolean))] as string[];
  const shareData = await fetchPromoterShareData(supabase, promoterIds, YEAR, MONTH);
  const closingVolume = new Map<string, number>();
  for (const c of base.contratos) {
    if (!c.promoterId) continue;
    closingVolume.set(c.promoterId, (closingVolume.get(c.promoterId) || 0) + c.valorLiquido);
  }

  // 3. Escala de seguro (SEGURO_SLIP_MAIO_2026).
  const insuranceTiers = await fetchInsuranceSlipTiers(supabase as any);

  // acordo por promotor (frenteC OFF nesta onda — escalonamento por meta é SUB-PR 2).
  const acordoCache = new Map<string, number>();
  function acordoDe(promoterId: string): number {
    if (acordoCache.has(promoterId)) return acordoCache.get(promoterId)!;
    const res = resolvePromoterShareSync({
      record: { assigned_promoter_id: promoterId, share_percent_override: null },
      profilesMap: shareData.profilesMap,
      scalesMap: shareData.scalesMap,
      monthlyVolumesMap: closingVolume, // volume do fechamento
      frenteC: null,
    });
    const a = Math.min(Math.max(Number(res.sharePercent) || 0, 0), 1); // clamp 0..1
    acordoCache.set(promoterId, a);
    return a;
  }

  // 4. Agrega por promotor.
  const SEM = "__SEM_PROMOTOR__";
  type Agg = {
    promoterId: string;
    nome: string;
    avista: number;
    seguroEmpresa: number;
    penetracao: number | null;
    qtdContratos: number;
    qtdRestritas: number;
    acordo: number;
  };
  const agg = new Map<string, Agg>();
  function get(pid: string | null, nome: string | null): Agg {
    const key = pid || SEM;
    if (!agg.has(key)) {
      agg.set(key, {
        promoterId: key,
        nome: pid ? nome || "(sem nome)" : "(SEM PROMOTOR / chave master/não cadastrada)",
        avista: 0,
        seguroEmpresa: 0,
        penetracao: null,
        qtdContratos: 0,
        qtdRestritas: 0,
        acordo: pid ? acordoDe(pid) : 0,
      });
    }
    return agg.get(key)!;
  }

  for (const c of base.contratos) {
    const a = get(c.promoterId, c.promoterName);
    // Base à vista = COMISSÃO PF (empresa, já pós-teto) × acordo. Sem recálculo de líquido × %.
    a.avista += c.comissaoEmpresaAvista * a.acordo;
    a.seguroEmpresa += c.comissaoSeguro;
    if (c.penetracao != null && (a.penetracao == null || c.penetracao > a.penetracao)) {
      a.penetracao = c.penetracao; // penetração representativa do promotor no fechamento
    }
    a.qtdContratos += 1;
  }
  for (const c of base.restritas) {
    const a = get(c.promoterId, c.promoterName);
    a.qtdRestritas += 1;
  }

  // 5. Fecha seguro com a escala e imprime.
  const rows = [...agg.values()].map((a) => {
    const segShare = lookupInsuranceShareFromPenetration(insuranceTiers, a.penetracao ?? 0);
    const seguro = a.seguroEmpresa * segShare;
    return { ...a, segShare, seguro, bruto: a.avista + seguro };
  });
  rows.sort((x, y) => y.bruto - x.bruto);

  const W = { nome: 34, val: 15, qtd: 6 };
  const header =
    pad("PROMOTOR", W.nome) +
    padL("COM_AVISTA", W.val) +
    padL("COM_SEGURO", W.val) +
    padL("BRUTO", W.val) +
    padL("#CTR", W.qtd) +
    padL("#RESTR", W.qtd) +
    padL("acordo%", 9) +
    padL("penetr%", 9) +
    padL("segShr%", 9);
  console.log("\n" + header);
  console.log("-".repeat(header.length));

  let tAvista = 0, tSeguro = 0, tBruto = 0, tCtr = 0, tRestr = 0;
  for (const r of rows) {
    tAvista += r.avista; tSeguro += r.seguro; tBruto += r.bruto;
    tCtr += r.qtdContratos; tRestr += r.qtdRestritas;
    console.log(
      pad(r.nome.slice(0, W.nome - 1), W.nome) +
        padL(brl(r.avista), W.val) +
        padL(brl(r.seguro), W.val) +
        padL(brl(r.bruto), W.val) +
        padL(String(r.qtdContratos), W.qtd) +
        padL(String(r.qtdRestritas), W.qtd) +
        padL((r.acordo * 100).toFixed(2), 9) +
        padL(r.penetracao == null ? "-" : (r.penetracao * 100).toFixed(2), 9) +
        padL((r.segShare * 100).toFixed(2), 9)
    );
  }
  console.log("-".repeat(header.length));
  console.log(
    pad(`TOTAL (${rows.length} promotores)`, W.nome) +
      padL(brl(tAvista), W.val) +
      padL(brl(tSeguro), W.val) +
      padL(brl(tBruto), W.val) +
      padL(String(tCtr), W.qtd) +
      padL(String(tRestr), W.qtd)
  );

  console.log(
    `\nNotas:\n` +
      `  - À vista: base = Σ COMISSÃO PF (empresa, valor final já pós-teto 5,80%) × acordo. NÃO recalcula de líquido × %.\n` +
      `  - Acordo: cascata resolvePromoterShareSync SEM Frente C (escalonamento por meta fica p/ SUB-PR 2); volume ENTRANTE = Σ líquido do fechamento.\n` +
      `  - Seguro: Σ COMISSÃO SEGURO (empresa) × escala SEGURO_SLIP(penetração). Penetração = maior "% PENETRAÇÃO" do promotor no fechamento (${insuranceTiers.length} tiers na escala).\n` +
      `  - Fonte: só aba "A Vista" (entry_type=CASH); a aba "Seguro" avulsa NÃO entra nesta onda.\n` +
      `  - READ-ONLY: nada foi gravado.`
  );
})().catch((e) => {
  console.error("ERRO:", e && e.message ? e.message : e);
  process.exit(1);
});
