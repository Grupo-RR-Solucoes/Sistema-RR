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
  montarFarolPromotor,
  semaforoPisoAlvo,
  META_DIARIA_GRUPO,
  diasRestantesDe,
} from "@/lib/ritmoNecessario.ts";
import { rankingDaRegional, regionalDoEstado, REGIONAL_LABEL } from "@/lib/regionais.ts";
import { nowInFortaleza } from "@/lib/dateFortaleza.ts";

const linha = () => console.log("-".repeat(78));
const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

/**
 * Chaves de topo do `Response.json({...})` do ramo `role === "promotor"` da
 * app/api/projecao/route.ts, lidas do CODIGO-FONTE.
 *
 * Le a fonte, e nao um payload reconstruido, de proposito: reconstruir so
 * prova o que o gate ja sabe montar. O risco real e alguem ACRESCENTAR uma
 * chave na rota — e isso so se ve olhando a rota.
 *
 * Ancora no literal `scope: "promotor"`, que identifica o ramo sem ambiguidade
 * (a rota tem outros Response.json). Depois anda ate a chave que fecha,
 * contando profundidade, e coleta os identificadores de nivel 0.
 */
function chavesDoPayloadPromotor(fonte: string): string[] {
  const iScope = fonte.indexOf('scope: "promotor"');
  if (iScope < 0) throw new Error("nao achei `scope: \"promotor\"` em app/api/projecao/route.ts");
  const marca = "Response.json({";
  const iOpen = fonte.lastIndexOf(marca, iScope);
  if (iOpen < 0) throw new Error("nao achei o Response.json que abre o ramo do promotor");

  let profundidade = 0;
  let fim = -1;
  for (let i = iOpen + marca.length; i < fonte.length; i++) {
    const c = fonte[i];
    if (c === "{" || c === "[" || c === "(") profundidade += 1;
    else if (c === "]" || c === ")") profundidade -= 1;
    else if (c === "}") {
      if (profundidade === 0) {
        fim = i;
        break;
      }
      profundidade -= 1;
    }
  }
  if (fim < 0) throw new Error("nao achei o fechamento do Response.json do promotor");

  const bloco = fonte.slice(iOpen + marca.length, fim);
  const chaves: string[] = [];
  let nivel = 0;
  for (const bruta of bloco.split(/\r?\n/)) {
    const l = bruta.replace(/\/\/.*$/, "").trim();
    if (nivel === 0 && l) {
      // `chave: valor,` ou `chave,` (shorthand)
      const m = l.match(/^([A-Za-z_$][\w$]*)\s*(:|,\s*$)/);
      if (m) chaves.push(m[1]);
    }
    for (const c of l) {
      if (c === "{" || c === "[" || c === "(") nivel += 1;
      else if (c === "}" || c === "]" || c === ")") nivel -= 1;
    }
  }
  return chaves;
}

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

// ------------------------------------------------------- 7. TRES FAIXAS
console.log("\n[7] as tres faixas: abaixo do piso, entre piso e alvo, acima do alvo\n");
{
  const piso = metaPropriaDoGrupo(janela);
  const alvo = cons.meta > 0 ? cons.meta : piso * 1.2; // sem alvo, sintetiza p/ o teste
  assert(
    semaforoPisoAlvo({ projecao: piso * 0.5, piso, alvo }) === "vermelho",
    "abaixo do piso -> vermelho",
    `projecao=${brl(piso * 0.5)} piso=${brl(piso)}`,
  );
  assert(
    semaforoPisoAlvo({ projecao: (piso + alvo) / 2, piso, alvo }) === "amarelo",
    "entre piso e alvo -> amarelo (a faixa do meio)",
    `projecao=${brl((piso + alvo) / 2)} entre ${brl(piso)} e ${brl(alvo)}`,
  );
  assert(
    semaforoPisoAlvo({ projecao: alvo, piso, alvo }) === "verde",
    "no alvo -> verde",
    `projecao=${brl(alvo)} alvo=${brl(alvo)}`,
  );
  assert(
    semaforoPisoAlvo({ projecao: alvo * 2, piso, alvo }) === "verde",
    "acima do alvo -> verde",
    "",
  );
  // O piso PRECISA ficar abaixo do alvo, senao a faixa do meio some.
  assert(
    piso < alvo,
    "o piso fica ABAIXO do alvo (senao nao ha faixa do meio)",
    `piso=${brl(piso)} alvo=${brl(alvo)} | piso/alvo=${((piso / alvo) * 100).toFixed(1)}%`,
  );
}

// -------------------------------------- 8. PAYLOAD DO PROMOTOR SEM TERCEIRO
//
// DUAS CAMADAS, e a segunda existe porque a primeira sozinha nao protege.
//
// A camada de VALOR reconstroi o payload pelo mesmo caminho da rota e varre o
// JSON atras de nome e producao de cada terceiro. Ela pega o vazamento que
// entra por dentro de uma chave que JA existe (o dia em que `promotor` ou
// `historico` passar a carregar lista).
//
// Mas reconstruir tem a MESMA fraqueza um nivel acima: se alguem acrescentar
// `res.promotores` ao Response.json amanha, a copia daqui nao teria a chave e
// o gate passaria verde enquanto a lista vaza para o navegador. Por isso a
// camada ESTATICA le o Response.json DA PROPRIA ROTA e falha em qualquer
// chave nova que nao esteja na lista aprovada. Chave nova exige decisao
// consciente — que e exatamente o ponto da C.3.
console.log("\n[8] o payload INTEIRO do promotor nao carrega terceiro\n");
{
  const promotores = res.promotores as any[];
  const eu = promotores.find((p) => Number(p.producao_acumulada) > 0) ?? promotores[0];
  const outros = promotores.filter((p) => p.promoter_id !== eu.promoter_id);

  // ---------- CAMADA ESTATICA: as chaves da rota ----------
  const CHAVES_APROVADAS = [
    "scope", "year", "month", "referenceDate", "fechado",
    "janela", "promotor", "ritmo", "farol", "ranking", "historico",
  ];
  const fonteRota = fs.readFileSync(path.join(ROOT, "app/api/projecao/route.ts"), "utf8");
  const chavesDaRota = chavesDoPayloadPromotor(fonteRota);
  const novas = chavesDaRota.filter((k) => !CHAVES_APROVADAS.includes(k));
  const sumidas = CHAVES_APROVADAS.filter((k) => !chavesDaRota.includes(k));
  assert(
    novas.length === 0,
    "nenhuma chave NOVA no Response.json do ramo do promotor",
    novas.length > 0
      ? `CHAVE(S) NAO APROVADA(S): ${novas.join(", ")} — se a chave carrega dado de ` +
        `terceiro, ela viola a C.3; se e legitima, acrescente em CHAVES_APROVADAS ` +
        `neste gate e explique no commit`
      : `${chavesDaRota.length} chaves, todas aprovadas: ${chavesDaRota.join(", ")}`,
  );
  assert(
    sumidas.length === 0,
    "nenhuma chave aprovada desapareceu (a lista nao esta apodrecida)",
    sumidas.length > 0 ? `sumiram: ${sumidas.join(", ")}` : "as 11 continuam la",
  );
  assert(
    !chavesDaRota.includes("promotores"),
    "a rota NAO devolve `promotores` (a lista com nome e producao de todo mundo)",
    "res.promotores alimenta o ranking e morre no servidor",
  );

  // ---------- CAMADA DE VALOR: o payload reconstruido ----------
  const rkEu = rankingDaRegional({ promotores, promoterId: eu.promoter_id });
  const janelaEu = janela;
  const ritmoEu = calcularRitmoNecessario({
    meta: eu.meta,
    acumulado: eu.producao_acumulada,
    projecao: eu.projecao,
    janela: janelaEu,
    mesFechado: res.fechado,
  });
  const realizadoEu =
    eu.dias_uteis_ritmo > 0 ? eu.producao_acumulada / eu.dias_uteis_ritmo : null;

  // Historico do PROPRIO promotor, igual a rota monta.
  const priors = [3, 2, 1].map((k) => {
    const dt = new Date(Date.UTC(COMP.year, COMP.month - 1 - k, 1));
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
  });
  const { data: pmrEu } = await sb
    .from("promoter_monthly_results")
    .select("year, month, production_value")
    .eq("promoter_id", eu.promoter_id);
  const mapaEu = new Map(
    (pmrEu || []).map((r: any) => [`${r.year}-${r.month}`, Number(r.production_value || 0)]),
  );
  const historicoEu = priors.map((pp) => ({
    key: `${String(pp.month).padStart(2, "0")}/${String(pp.year).slice(-2)}`,
    production: mapaEu.get(`${pp.year}-${pp.month}`) || 0,
  }));

  const payload: Record<string, unknown> = {
    scope: "promotor",
    year: COMP.year,
    month: COMP.month,
    referenceDate: res.referenceDate,
    fechado: res.fechado,
    janela: res.janela,
    promotor: eu,
    ritmo: ritmoEu,
    farol: montarFarolPromotor({
      ritmo: ritmoEu,
      ritmoRealizado: realizadoEu,
      producaoMesAnterior: historicoEu[historicoEu.length - 1]?.production ?? 0,
      acumulado: eu.producao_acumulada,
      diasRestantes: ritmoEu.diasRestantes,
    }),
    ranking: rkEu
      ? { regional: rkEu.regional, label: REGIONAL_LABEL[rkEu.regional], posicao: rkEu.posicao, total: rkEu.total }
      : null,
    historico: historicoEu,
  };

  // Numeros do PROPRIO promotor: se a producao de um terceiro coincidir com um
  // deles, a busca daria falso positivo. Excluidos da varredura de valor.
  const meusNumeros = new Set(
    Object.values(eu)
      .filter((v): v is number => typeof v === "number")
      .map((v) => String(Math.round(v))),
  );

  const achados: Array<{ chave: string; oque: string; dono: string }> = [];
  for (const [chave, valor] of Object.entries(payload)) {
    const json = JSON.stringify(valor ?? null) ?? "";
    for (const o of outros) {
      const nome = String(o.promoter_name || "").trim();
      // nomes curtos demais gerariam falso positivo por substring
      if (nome.length >= 5 && json.includes(nome)) {
        achados.push({ chave, oque: "NOME", dono: nome });
      }
      const prod = Number(o.producao_acumulada);
      const prodTxt = String(Math.round(prod));
      if (prod > 0 && prodTxt.length >= 5 && !meusNumeros.has(prodTxt) && json.includes(prodTxt)) {
        achados.push({ chave, oque: "PRODUCAO", dono: nome || o.promoter_id });
      }
    }
  }
  assert(
    achados.length === 0,
    "nenhum NOME nem PRODUCAO de terceiro em NENHUMA chave do payload",
    achados.length > 0
      ? `VAZOU em ${achados.map((a) => `chave "${a.chave}" -> ${a.oque} de ${a.dono}`).join(" | ")}`
      : `${Object.keys(payload).length} chaves varridas contra ${outros.length} terceiros`,
  );

  // Chave que carrega LISTA de promotores, mesmo que anonimizada: um array de
  // objetos com promoter_id ja permite cruzar com qualquer outra fonte.
  const listas: string[] = [];
  for (const [chave, valor] of Object.entries(payload)) {
    if (!Array.isArray(valor)) continue;
    const pareceLista = valor.some(
      (el) => el && typeof el === "object" && ("promoter_id" in el || "promoter_name" in el),
    );
    if (pareceLista) listas.push(chave);
  }
  assert(
    listas.length === 0,
    "nenhuma chave carrega LISTA de promotores",
    listas.length > 0
      ? `LISTA em: ${listas.join(", ")} — um array com promoter_id cruza com qualquer outra fonte`
      : "0 listas",
  );

  // O antivalor explicito: distancia para a proxima posicao NAO pode existir.
  const rankingKeys = Object.keys((payload.ranking as object) ?? {});
  assert(
    rankingKeys.length === 4 &&
      rankingKeys.every((k) => ["regional", "label", "posicao", "total"].includes(k)),
    "o objeto de ranking segue com SO regional/label/posicao/total",
    `chaves=[${rankingKeys.join(", ")}]`,
  );
}

// ------------------------------------------------- 9. COBERTURA DAS REGIONAIS
console.log("\n[9] as duas regionais cobrem todos os promotores ativos nao-master\n");
{
  const promotores = res.promotores as any[];
  const porRegional = new Map<string, number>();
  let semRegional = 0;
  for (const p of promotores) {
    const r = regionalDoEstado(p.estado);
    if (!r) {
      semRegional += 1;
      continue;
    }
    porRegional.set(r, (porRegional.get(r) || 0) + 1);
  }
  const somaRegionais = [...porRegional.values()].reduce((a, b) => a + b, 0);

  const { data: proms, error } = await sb
    .from("promoters")
    .select("id, active, is_master");
  if (error) throw new Error(`promoters: ${error.message}`);
  const ativosNaoMaster = (proms || []).filter((p: any) => p.active && !p.is_master).length;

  console.log(
    `        ${[...porRegional.entries()].map(([r, n]) => `${r}=${n}`).join("  ")}` +
      `  | sem regional=${semRegional}  | ativos nao-master no banco=${ativosNaoMaster}`,
  );
  assert(
    somaRegionais + semRegional === promotores.length,
    "toda a lista cai numa regional ou em 'sem regional' (sem sumico)",
    `${somaRegionais} + ${semRegional} == ${promotores.length}`,
  );
  assert(
    somaRegionais === ativosNaoMaster,
    "a soma das duas regionais == total de ativos nao-master",
    `${somaRegionais} == ${ativosNaoMaster}`,
  );
  assert(semRegional === 0, "nenhum promotor ficou fora de regional", `sem regional=${semRegional}`);
}

// ------------------------------------------------- 10. POSICAO NO INTERVALO
console.log("\n[10] a posicao esta sempre entre 1 e o total da regional\n");
{
  const promotores = res.promotores as any[];
  let comPosicao = 0;
  let semPosicao = 0;
  let forasteira: string | null = null;
  for (const p of promotores) {
    const rk = rankingDaRegional({ promotores, promoterId: p.promoter_id });
    if (!rk) continue;
    if (rk.posicao == null) {
      semPosicao += 1;
      continue;
    }
    comPosicao += 1;
    if (!(rk.posicao >= 1 && rk.posicao <= rk.total)) {
      forasteira = `${p.promoter_id}: ${rk.posicao} de ${rk.total}`;
    }
  }
  assert(
    forasteira === null,
    "toda posicao cai em [1, total da regional]",
    `${comPosicao} com posicao, ${semPosicao} sem producao (posicao null)` +
      (forasteira ? ` | FORA: ${forasteira}` : ""),
  );
  // Posicoes tem de ser UNICAS dentro da regional (o desempate por
  // promoter_id garante isso; sem ele dois promotores empatados dividiriam o
  // mesmo lugar e "12o de 39" perderia o sentido).
  for (const reg of ["ALAGOAS", "PERNAMBUCO"] as const) {
    const daReg = promotores.filter((p) => regionalDoEstado(p.estado) === reg);
    const pos = daReg
      .map((p) => rankingDaRegional({ promotores, promoterId: p.promoter_id })?.posicao)
      .filter((n): n is number => n != null);
    assert(
      new Set(pos).size === pos.length,
      `${reg}: nenhuma posicao repetida (desempate estavel)`,
      `${pos.length} posicoes, ${new Set(pos).size} distintas`,
    );
  }
}

linha();
console.log(`RESULTADO: ${passes} OK, ${falhas} FALHA(S)`);
linha();
process.exit(falhas > 0 ? 1 : 0);
