// ============================================================================
// GATE — company_received_percent x "% A VISTA" carimbado pelo FECHAMENTO.
//
// A PROPOSTA (Bloco 2). Esta e a conferencia que teria pego o bug da faixa do
// CNPJ: o fechamento da Promotiva traz, no metadata de cada linha CASH, o
// percentual que ELA aplicou. A nossa coluna nunca foi confrontada com ele.
//
// SOMENTE LEITURA. Nao grava, nao conserta — acusa.
// Saida: exit 0 quando nao ha divergencia, exit 1 quando ha (serve de gate).
//
//   npx tsx scripts/gate-avista-vs-fechamento.mts
//   npx tsx scripts/gate-avista-vs-fechamento.mts --ano 2026
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

for (const a of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), a);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
process.env.TRP_SOURCE = "db";

const argAno = process.argv.indexOf("--ano");
const ANO = argAno >= 0 ? Number(process.argv[argAno + 1]) : 2026;

// ===========================================================================
// PISO DE COMPETENCIA — 2026-07.
//
// POR QUE O PISO EXISTE. Antes dele o portao nascia VERMELHO com 35 linhas de
// 04 e 06/2026 que NINGUEM VAI CORRIGIR: sao competencias FECHADAS, o cms e a
// fonte de verdade do mes fechado, e a empresa recebeu certo (a Promotiva pagou
// pela faixa do grupo — 35 de 35 conclusivas, ver HANDOFF_FAIXA_CNPJ.md §5.5).
// Portao que nasce vermelho por divida que ninguem vai pagar e portao que se
// aprende a ignorar. Decisao do Diego, 30/07/2026.
//
// O PISO NAO APAGA AS 35. Elas estao listadas em ESTADO_CONHECIDO abaixo, com
// competencia e motivo. Quem baixar o piso um dia reencontra a EXPLICACAO, nao
// o susto — que e a razao de este bloco existir.
//
// Baixar o piso: `--desde 2026-04`. As 35 voltam a aparecer, classificadas.
// ===========================================================================
const PISO_PADRAO = "2026-07";
const argDesde = process.argv.indexOf("--desde");
const PISO = argDesde >= 0 ? String(process.argv[argDesde + 1]) : PISO_PADRAO;

/**
 * ESTADO CONHECIDO — divergencias de FAIXA anteriores ao piso, medidas em
 * 30/07/2026 e deliberadamente nao corrigidas.
 *
 * Causa: o derive da company_received_percent apurava a faixa na producao do
 * CNPJ isolado em vez da do GRUPO (corrigido em 30/07/2026,
 * app/api/calculate/monthly/route.ts — a faixa passou a sair de
 * groupNetValidProduction). O conserto NAO alcanca estas linhas por duas
 * razoes somadas, ambas deliberadas:
 *   1. route.ts:715-716 desvia antes do derive quando regime !== "open";
 *   2. getPersistedCompanyReceivedPercent:118-121 devolve a coluna ja gravada.
 *
 * Consequencia financeira: NENHUMA para a empresa. A Promotiva pagou pela faixa
 * do grupo (o metadata do fechamento carimba TABELA="FAIXA 3"). O unico efeito
 * era o repasse ao promotor, que a regua de escopo do Diego deixa de fora.
 */
const ESTADO_CONHECIDO = {
  medidoEm: "2026-07-30",
  faixa: { "2026-04": 27, "2026-06": 8 },
  totalFaixa: 35,
  deltaFaixa: 427.43,
  teto: { "2026-04": 18, "2026-06": 77 },
  totalTeto: 95,
  inversa: { "2026-04": 4 },
  totalInversa: 4,
} as const;

/** Injeta divergencia artificial numa COPIA em memoria — prova que o gate reprova. */
const PROVAR_FALHA = process.argv.includes("--provar-falha");

const { detectMonthRegime } = await import("../lib/cmsMonthly.ts");
const { getProductionPeriodFromValue } = await import("../lib/productionPeriod.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const chaveNum = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
const p2 = (n: number) => String(n).padStart(2, "0");
const D = "=".repeat(112);
const L = "-".repeat(112);

/** Tolerancia: meio centesimo de ponto percentual. */
const EPS_PCT = 0.005;

async function paginar<T>(f: () => any): Promise<T[]> {
  let de = 0;
  const out: T[] = [];
  for (;;) {
    const { data, error } = await f().order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
    de += 1000;
  }
  return out;
}

const t0 = Date.now();
const { data: emps } = await sb.from("companies").select("id, name, active").eq("active", true);
const nome = new Map((emps || []).map((e: any) => [e.id, e.name]));
const rrIds = (emps || [])
  .filter((e: any) => !String(e.name).toUpperCase().includes("ADS"))
  .map((e: any) => e.id);

console.log(D);
console.log(`GATE — company_received_percent x "% A VISTA" do fechamento   [${ANO}]`);
console.log(D);

type Div = {
  comp: string;
  empresa: string;
  proposta: string;
  nossa: number;
  promotiva: number;
  net: number;
  delta: number;
};
const divergencias: Div[] = [];
let injetada: string | null = null;
let totalConferidas = 0;
let totalSemPar = 0;
let totalSemCampo = 0;

console.log("\ncomp     regime        conferidas  divergem  sem par no fechamento  sem % no metadata");
console.log(L);

let puladasPeloPiso = 0;
for (let mes = 1; mes <= 12; mes++) {
  const comp = `${ANO}-${p2(mes)}`;
  // PISO: competencia anterior ao piso nao entra. Ver ESTADO_CONHECIDO no topo.
  if (comp < PISO) {
    puladasPeloPiso += 1;
    continue;
  }
  const regime = await detectMonthRegime(sb as any, ANO, mes);
  // SO COMPETENCIA FECHADA: em mes aberto o fechamento ainda nao existe, e
  // "ausente" nao e divergencia — e dado que ainda nao chegou.
  if (regime === "open") continue;

  // O fechamento da competencia, indexado por proposta.
  const porChave = new Map<string, any>();
  let temFechamento = false;
  for (const id of rrIds) {
    const linhas = await paginar<any>(() =>
      sb
        .from("monthly_closing_entries")
        .select("operation_number, contract_number, metadata")
        .eq("company_id", id)
        .eq("year", ANO)
        .eq("month", mes)
        .eq("entry_type", "CASH")
    );
    if (linhas.length) temFechamento = true;
    for (const f of linhas)
      for (const k of [chaveNum(f.operation_number), chaveNum(f.contract_number)])
        if (k && !porChave.has(k)) porChave.set(k, f);
  }
  if (!temFechamento) continue;

  // A diaria da competencia (janela folgada + filtro por competencia real).
  const aY = mes === 1 ? ANO - 1 : ANO;
  const aM = mes === 1 ? 12 : mes - 1;
  const sY = mes === 12 ? ANO + 1 : ANO;
  const sM = mes === 12 ? 1 : mes + 1;
  const diaria: any[] = [];
  for (const id of rrIds) {
    const linhas = await paginar<any>(() =>
      sb
        .from("daily_production_records")
        .select(
          "company_id, proposal_number, contract_number, net_value, status," +
            " is_srcc_restricted, company_received_percent, movement_date," +
            " contract_date, proposal_date"
        )
        .eq("company_id", id)
        .gte("movement_date", `${aY}-${p2(aM)}-15`)
        .lt("movement_date", `${sY}-${p2(sM)}-15`)
    );
    diaria.push(...linhas);
  }
  const daComp = diaria.filter((r) => {
    const p =
      getProductionPeriodFromValue(r.movement_date) ||
      getProductionPeriodFromValue(r.contract_date) ||
      getProductionPeriodFromValue(r.proposal_date);
    return p && p.year === ANO && p.month === mes;
  });

  let conferidas = 0;
  let divergem = 0;
  let semPar = 0;
  let semCampo = 0;

  for (const r of daComp) {
    // So linha em PRODUCAO, nao restrita, com a coluna preenchida.
    const st = norm(r.status);
    if (st !== "PRODUCAO" && st !== "PRODUCTION") continue;
    if (r.is_srcc_restricted === true) continue;
    const nossa = num(r.company_received_percent);
    if (!(nossa > 0)) continue;

    const f = porChave.get(chaveNum(r.proposal_number)) ?? porChave.get(chaveNum(r.contract_number));
    if (!f) {
      semPar += 1;
      continue;
    }
    const bruto = f.metadata?.["% A VISTA"] ?? f.metadata?.["% A VISTA "] ?? null;
    if (bruto == null || String(bruto).trim() === "") {
      semCampo += 1;
      continue;
    }
    const raw = num(bruto);
    if (!(raw > 0)) {
      semCampo += 1;
      continue;
    }
    // A Promotiva grava ora fracao (0,0334), ora percentual (3,34).
    const prom = Math.abs(raw) > 1 ? raw : raw * 100;

    conferidas += 1;

    // PROVA DE QUE REPROVA (--provar-falha): estraga UMA linha que hoje BATE,
    // so na COPIA em memoria. O banco nao e tocado, entao nao ha o que restaurar.
    let nossaEfetiva = nossa;
    if (PROVAR_FALHA && !injetada && Math.abs(prom - nossa) < EPS_PCT) {
      nossaEfetiva = Math.round((prom - 1.0) * 100) / 100;
      injetada =
        `proposta ${r.proposal_number} (${ANO}-${p2(mes)}, ${nome.get(r.company_id)}): ` +
        `coluna ${nossa} -> ${nossaEfetiva} SO EM MEMORIA (Promotiva ${prom})`;
    }

    if (Math.abs(prom - nossaEfetiva) >= EPS_PCT) {
      divergem += 1;
      divergencias.push({
        comp: `${ANO}-${p2(mes)}`,
        empresa: String(nome.get(r.company_id)),
        proposta: String(r.proposal_number),
        nossa: nossaEfetiva,
        promotiva: prom,
        net: num(r.net_value),
        delta: (num(r.net_value) * (prom - nossaEfetiva)) / 100,
      });
    }
  }

  totalConferidas += conferidas;
  totalSemPar += semPar;
  totalSemCampo += semCampo;
  console.log(
    `${ANO}-${p2(mes)}  ${String(regime).padEnd(12)}  ${String(conferidas).padStart(10)}  ${String(divergem).padStart(8)}  ` +
      `${String(semPar).padStart(21)}  ${String(semCampo).padStart(17)}`
  );
}

console.log(L);
console.log(`TOTAL conferidas: ${totalConferidas}   divergem: ${divergencias.length}   sem par: ${totalSemPar}   sem % no metadata: ${totalSemCampo}`);

// ---------------------------------------------------------------------------
// CLASSIFICACAO — sem isto o gate acusa o TETO como se fosse erro de faixa.
//   TETO      a Promotiva declara 6,00 (o teto do a-vista) e a nossa coluna
//             traz a celula da TRP, menor. Nao e divergencia de faixa.
//   FAIXA     a nossa e MENOR e nao e o teto -> o defeito de faixa
//   INVERSA   a nossa e MAIOR que a da Promotiva -> outra coisa, investigar
// ---------------------------------------------------------------------------
const TETO_AVISTA = 6.0;
const clas = (d: Div) =>
  d.promotiva >= TETO_AVISTA - EPS_PCT
    ? "TETO"
    : d.promotiva > d.nossa
      ? "FAIXA"
      : "INVERSA";

if (divergencias.length) {
  console.log("\n" + L);
  console.log("CLASSIFICACAO DAS DIVERGENCIAS");
  console.log(L);
  for (const tipo of ["TETO", "FAIXA", "INVERSA"]) {
    const arr = divergencias.filter((d) => clas(d) === tipo);
    if (!arr.length) continue;
    console.log(
      `  ${tipo.padEnd(8)} ${String(arr.length).padStart(4)} linhas   delta R$ ${brl(arr.reduce((s, d) => s + d.delta, 0)).padStart(10)}` +
        `   producao R$ ${brl(arr.reduce((s, d) => s + d.net, 0))}`
    );
    const porComp = new Map<string, number>();
    for (const d of arr) porComp.set(d.comp, (porComp.get(d.comp) || 0) + 1);
    console.log(`           por competencia: ${[...porComp.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`);
  }

  console.log("\n" + L);
  console.log("AS DIVERGENCIAS DE FAIXA (as que importam)");
  console.log(L);
  console.log("proposta      comp     empresa          nossa   Promotiva      net          delta comissao-empresa");
  for (const d of divergencias.filter((x) => clas(x) === "FAIXA").sort((a, b) => b.delta - a.delta))
    console.log(
      `${d.proposta.padEnd(13)} ${d.comp}  ${d.empresa.slice(0, 15).padEnd(15)} ${String(d.nossa).padStart(6)}  ` +
        `${d.promotiva.toFixed(4).padStart(9)}  R$ ${brl(d.net).padStart(12)}   R$ ${brl(d.delta).padStart(10)}`
    );

}

// ---------------------------------------------------------------------------
// O QUE REPROVA. O TETO e TOLERADO: a Promotiva declara 6,00 (o teto do
// a-vista) e a nossa coluna traz a celula da TRP, menor. Nao e erro de faixa —
// e o teto fazendo o que deve. Reprovam FAIXA e INVERSA.
// ---------------------------------------------------------------------------
const reprovam = divergencias.filter((d) => clas(d) !== "TETO");
const tolerados = divergencias.filter((d) => clas(d) === "TETO");

const ms = Date.now() - t0;
console.log("\n" + D);
console.log(`CUSTO: ${(ms / 1000).toFixed(1)}s de parede`);
console.log(`PISO: ${PISO}   (competencias puladas: ${puladasPeloPiso})`);
if (injetada) console.log(`INJECAO ARTIFICIAL ATIVA: ${injetada}`);
if (tolerados.length)
  console.log(`TOLERADAS (teto 6,00 da Promotiva x celula da TRP): ${tolerados.length} linhas — nao reprovam`);

if (PISO === PISO_PADRAO) {
  console.log("\nESTADO CONHECIDO ANTES DO PISO (medido em " + ESTADO_CONHECIDO.medidoEm + ", NAO sera corrigido):");
  console.log(
    `   FAIXA   ${ESTADO_CONHECIDO.totalFaixa} linhas  delta R$ ${brl(ESTADO_CONHECIDO.deltaFaixa)}   ` +
      Object.entries(ESTADO_CONHECIDO.faixa).map(([k, v]) => `${k}:${v}`).join("  ")
  );
  console.log(
    `   TETO    ${ESTADO_CONHECIDO.totalTeto} linhas   ` +
      Object.entries(ESTADO_CONHECIDO.teto).map(([k, v]) => `${k}:${v}`).join("  ")
  );
  console.log(
    `   INVERSA ${ESTADO_CONHECIDO.totalInversa} linhas   ` +
      Object.entries(ESTADO_CONHECIDO.inversa).map(([k, v]) => `${k}:${v}`).join("  ")
  );
  console.log("   motivo: competencia FECHADA (cms e a verdade) e a empresa recebeu certo —");
  console.log("           a Promotiva pagou pela faixa do GRUPO. Ver HANDOFF_FAIXA_CNPJ.md §5.5 e §5.8.");
  console.log("   para reencontrar: npx tsx scripts/gate-avista-vs-fechamento.mts --desde 2026-04");
}

if (reprovam.length === 0) {
  console.log("\nGATE OK — nenhuma divergencia de faixa entre a nossa coluna e o % da Promotiva.");
  console.log(D);
} else {
  console.log(`\nGATE REPROVADO — ${reprovam.length} linhas divergem da faixa que a Promotiva aplicou.`);
  console.log(D);
  process.exitCode = 1;
}
