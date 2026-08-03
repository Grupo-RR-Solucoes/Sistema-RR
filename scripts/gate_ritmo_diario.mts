/* ============================================================================
 * gate_ritmo_diario — RITMO DIARIO NECESSARIO. SOMENTE LEITURA. NAO grava.
 *
 * Rodar:  npx tsx scripts/gate_ritmo_diario.mts
 *
 * Extensao .mts (nao .ts) porque o arquivo usa await no topo: com .ts o
 * compilador emite CommonJS e o top-level await falha. Mesmo motivo de
 * gate_projecao_gestor.mts e gate_competencia.mts.
 *
 * ASSERCOES POR DELTA / IDENTIDADE, nunca por valor absoluto: producao muda
 * todo dia e um gate ancorado em numero absoluto vira alarme falso em 24h.
 * O que se assere aqui sao INVARIANTES:
 *
 *   1. meta propria == 250000 x dias uteis TOTAIS na competencia medida
 *   2. identidade: ritmo x dias restantes + acumulado == meta
 *   3. acumulado >= meta produz META_BATIDA, nunca ritmo negativo
 *   4. total - diasParaRitmo == 0 produz SEM_DIAS/META_BATIDA, nunca /0
 *   5. promotor sem meta produz SEM_META, nao card vazio
 *   6. a meta consolidada BATE com consolidarGrupoEquipe e DIFERE da soma
 *      bruta de monthly_targets — prova que a deduplicacao esta viva
 *
 * A (6) e a que pega o erro de R$ 1,16 milhao: somar monthly_targets na mao
 * inclui promotor inativo e chave master.
 * ========================================================================== */
process.env.TRP_SOURCE = process.env.TRP_SOURCE || "db";

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(import.meta.dirname, "..");
for (const arquivo of [".env.local", ".env"]) {
  const p = path.join(ROOT, arquivo);
  if (!fs.existsSync(p)) continue;
  for (const linhaEnv of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = linhaEnv.match(/^([A-Z0-9_]+)=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

import { buildProjecaoMetas, consolidarGrupoEquipe } from "@/lib/projecaoMetas.ts";
import { resolverJanelaRitmo, projetarPorRitmo } from "@/lib/janelaRitmo.ts";
import {
  calcularRitmoNecessario,
  metaPropriaDoGrupo,
  META_DIARIA_GRUPO,
  diasRestantesDe,
} from "@/lib/ritmoNecessario.ts";
import { nowInFortaleza } from "@/lib/dateFortaleza.ts";

const linha = () => console.log("-".repeat(78));
const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

let falhas = 0;
let passes = 0;
function assert(ok: boolean, titulo: string, detalhe: string) {
  if (ok) {
    passes += 1;
    console.log(`  OK    ${titulo}`);
  } else {
    falhas += 1;
    console.log(`  FALHA ${titulo}`);
  }
  if (detalhe) console.log(`        ${detalhe}`);
}

console.log("");
linha();
console.log("GATE RITMO DIARIO NECESSARIO");
linha();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("\nPULADO — faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(0);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// --------------------------------------------------------------------------
// COMPETENCIA DE MEDICAO — descoberta, nunca fixada. Um gate ancorado em
// "2026-07" apodrece na virada do mes.
// --------------------------------------------------------------------------
const hoje = nowInFortaleza();
const { data: pmrRows, error: pmrErr } = await sb
  .from("promoter_monthly_results")
  .select("year, month")
  .order("year", { ascending: false })
  .order("month", { ascending: false })
  .limit(1);
if (pmrErr) throw new Error(`PMR: ${pmrErr.message}`);

// GUARDA DE VACUIDADE: sem competencia com producao, TODAS as assercoes de
// valor passariam por vacuidade (tudo zero compara igual a tudo zero) e o
// gate aprovaria um sistema quebrado. Aborta.
if (!pmrRows || pmrRows.length === 0) {
  console.log("\nABORTADO — nao ha NENHUMA competencia com linha no PMR.");
  console.log("Sem producao, a identidade do ritmo e a deduplicacao da meta");
  console.log("passariam por vacuidade em vez de provar coisa alguma.");
  linha();
  process.exit(1);
}
const COMP = { year: pmrRows[0].year, month: pmrRows[0].month };

const res = await buildProjecaoMetas(sb as any, COMP);
const cons = consolidarGrupoEquipe(res);
const janela = resolverJanelaRitmo(COMP.year, COMP.month, { closed: res.fechado });

console.log(`\ncompetencia medida: ${COMP.year}-${String(COMP.month).padStart(2, "0")}`);
console.log(`hoje (Fortaleza)  : ${hoje.year}-${String(hoje.month).padStart(2, "0")}-${String(hoje.day).padStart(2, "0")}`);
console.log(`janela            : total=${janela.total} diasParaRitmo=${janela.diasParaRitmo} completo=${janela.periodoCompleto} fechado=${res.fechado}`);
console.log(`acumulado do grupo: ${brl(cons.producao_acumulada)}`);
console.log(`meta consolidada  : ${brl(cons.meta)}`);

// GUARDA DE VACUIDADE (2): a competencia descoberta tem de ter producao.
if (!(cons.producao_acumulada > 0)) {
  console.log("\nABORTADO — a competencia medida nao tem producao acumulada.");
  linha();
  process.exit(1);
}

// --------------------------------------------------------- 1. META PROPRIA
console.log("\n[1] meta propria = constante x dias uteis totais\n");
{
  const propria = metaPropriaDoGrupo(janela);
  assert(
    propria === META_DIARIA_GRUPO * janela.total,
    "meta propria == META_DIARIA_GRUPO x dias uteis totais",
    `${brl(propria)} == ${brl(META_DIARIA_GRUPO)} x ${janela.total} dias`,
  );
  assert(
    META_DIARIA_GRUPO === 250_000,
    "a constante e 250.000 (mudar exige deploy, por decisao)",
    `META_DIARIA_GRUPO=${META_DIARIA_GRUPO}`,
  );
  // Os dias vem da JANELA, nunca de contagem nova.
  assert(
    janela.total > 0 && janela.total <= 23,
    "dias uteis totais saem da janela canonica e sao plausiveis",
    `total=${janela.total} (um mes tem entre 19 e 23 dias uteis)`,
  );
}

// ------------------------------------------------------ 2. IDENTIDADE
console.log("\n[2] identidade: ritmo x dias restantes + acumulado == meta\n");
{
  // Cenario SINTETICO com dias restantes garantidos: a competencia medida
  // pode estar com a janela encerrada (e ai nao ha ritmo para conferir).
  const janelaViva = { ...janela, diasParaRitmo: Math.max(0, janela.total - 5), periodoCompleto: false };
  const meta = 5_000_000;
  const acumulado = 1_000_000;
  const r = calcularRitmoNecessario({
    meta,
    acumulado,
    projecao: projetarPorRitmo(janelaViva, acumulado),
    janela: janelaViva,
    mesFechado: false,
  });
  assert(r.ritmoDiario != null, "cenario com dias restantes produz ritmo", `estado=${r.estado} dias=${r.diasRestantes}`);
  if (r.ritmoDiario != null) {
    const reconstruida = r.ritmoDiario * r.diasRestantes + r.acumulado;
    assert(
      Math.abs(reconstruida - meta) <= 0.005 * r.diasRestantes + 0.01,
      "ritmo x dias + acumulado reconstroi a meta",
      `${brl(reconstruida)} vs meta ${brl(meta)} (erro <= meio centavo por dia)`,
    );
  }
}

// --------------------------------------------- 3. META BATIDA / SEM NEGATIVO
console.log("\n[3] acumulado >= meta produz META_BATIDA, nunca ritmo negativo\n");
{
  const janelaViva = { ...janela, diasParaRitmo: Math.max(0, janela.total - 5), periodoCompleto: false };
  const r = calcularRitmoNecessario({
    meta: 1_000_000,
    acumulado: 1_400_000,
    projecao: projetarPorRitmo(janelaViva, 1_400_000),
    janela: janelaViva,
    mesFechado: false,
  });
  assert(r.estado === "META_BATIDA", "estado e META_BATIDA", `estado=${r.estado}`);
  assert(r.ritmoDiario === null, "nao ha ritmo a exibir", `ritmoDiario=${r.ritmoDiario}`);
  assert(r.falta === 0, "falta pisada em zero (nunca negativa)", `falta=${r.falta}`);
  assert(r.excedente === 400_000, "excedente exibido no lugar do ritmo", `excedente=${brl(r.excedente)}`);
}

// ------------------------------------------------------- 4. ZERO DIAS
console.log("\n[4] zero dia restante nao divide por zero\n");
{
  const janelaMorta = { ...janela, diasParaRitmo: janela.total, periodoCompleto: true };
  assert(
    diasRestantesDe(janelaMorta) === 0,
    "total - diasParaRitmo == 0",
    `total=${janelaMorta.total} diasParaRitmo=${janelaMorta.diasParaRitmo}`,
  );
  const r = calcularRitmoNecessario({
    meta: 9_999_999_999,
    acumulado: 1,
    projecao: projetarPorRitmo(janelaMorta, 1),
    janela: janelaMorta,
    mesFechado: false,
  });
  assert(r.estado === "SEM_DIAS", "estado e SEM_DIAS (janela encerrada, regime aberto)", `estado=${r.estado}`);
  assert(r.ritmoDiario === null, "ritmoDiario e null, nao Infinity nem NaN", `ritmoDiario=${r.ritmoDiario}`);
  assert(
    Number.isFinite(r.falta) && r.falta > 0,
    "falta continua finita e positiva",
    `falta=${brl(r.falta)}`,
  );
}

// -------------------------------------------------------- 5. SEM META
console.log("\n[5] sem meta produz SEM_META, nao card vazio nem R$ 0/dia\n");
{
  const r = calcularRitmoNecessario({
    meta: 0,
    acumulado: cons.producao_acumulada,
    projecao: cons.projecao,
    janela,
    mesFechado: res.fechado,
  });
  assert(r.estado === "SEM_META", "estado e SEM_META", `estado=${r.estado}`);
  assert(r.ritmoDiario === null, "nao inventa ritmo sobre meta inexistente", `ritmoDiario=${r.ritmoDiario}`);
  assert(r.percent === null, "percent null -> semaforo se auto-declara", `percent=${r.percent}`);
  assert(r.semaforo === "sem_meta", "semaforo e sem_meta", `semaforo=${r.semaforo}`);

  // E o caso REAL do mes corrente quando nao ha meta lancada.
  const resCorrente = await buildProjecaoMetas(sb as any, { year: hoje.year, month: hoje.month });
  const consCorrente = consolidarGrupoEquipe(resCorrente);
  console.log(
    `        mes corrente ${hoje.year}-${String(hoje.month).padStart(2, "0")}: meta consolidada = ${brl(consCorrente.meta)}` +
      (consCorrente.meta > 0 ? "" : "  <- SEM_META na tela, por cadastro ausente"),
  );
}

// ---------------------------------------- 6. DEDUP DA META (o R$ 1,16 milhao)
console.log("\n[6] a meta consolidada difere da soma BRUTA de monthly_targets\n");
{
  const { data: metas, error } = await sb
    .from("monthly_targets")
    .select("promoter_id, meta, year, month")
    .eq("year", COMP.year)
    .eq("month", COMP.month);
  if (error) throw new Error(`monthly_targets: ${error.message}`);

  const somaBruta = (metas || []).reduce((s: number, t: any) => s + Number(t.meta || 0), 0);
  const linhas = (metas || []).filter((t: any) => Number(t.meta || 0) > 0).length;

  assert(
    Math.abs(cons.meta - somaBruta) > 0.01,
    "consolidado NAO e a soma bruta (a dedup/filtro esta viva)",
    `consolidado=${brl(cons.meta)} vs soma bruta=${brl(somaBruta)} em ${linhas} linhas` +
      ` | diferenca=${brl(Math.abs(somaBruta - cons.meta))}`,
  );
  assert(
    cons.meta <= somaBruta + 0.01,
    "o consolidado nunca EXCEDE a soma bruta (so filtra, nao inventa)",
    `${brl(cons.meta)} <= ${brl(somaBruta)}`,
  );
  // Nenhum promotor pode ter DUAS linhas contadas: se tivesse, o consolidado
  // (que faz .find() de UMA linha) e a soma bruta divergiriam pelo dobro dela.
  const porPromotor = new Map<string, number>();
  for (const t of metas || []) {
    porPromotor.set(t.promoter_id, (porPromotor.get(t.promoter_id) || 0) + 1);
  }
  const duplicados = [...porPromotor.values()].filter((n) => n > 1).length;
  console.log(
    `        promotores com MAIS DE UMA linha de meta nesta competencia: ${duplicados}` +
      (duplicados > 0
        ? "  <- ATENCAO: o .find() do analytics pega UMA e descarta as outras"
        : "  (nenhum — sem risco de meta descartada)"),
  );
}

linha();
console.log(`RESULTADO: ${passes} OK, ${falhas} FALHA(S)`);
linha();
process.exit(falhas > 0 ? 1 : 0);
