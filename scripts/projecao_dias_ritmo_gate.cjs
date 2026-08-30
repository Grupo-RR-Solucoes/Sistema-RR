/*
 * GATE — /projecao: separa "dias decorridos EXIBIDOS" do "divisor do ritmo".
 * READ-ONLY (le prod). A competencia e a JANELA ABERTA do momento, resolvida no
 * proprio run (era jul/2026 cravada; ver o bloco de comentario no corpo).
 *
 * Regra (Diego):
 *   - dias_uteis_decorridos = dias uteis vencidos com HOJE INCLUIDO (o "23/23").
 *   - dias_uteis_ritmo      = divisor = decorridos MENOS o dia corrente, quando a
 *                             competencia esta ABERTA e hoje e dia util.
 *   - periodoCompleto so quando refDate PASSA de end (em refDate == end extrapola).
 *
 * Esperado, por POSICAO na janela (nunca por data cravada):
 *   penultimo dia util -> decorridos = total-1, divisor = total-2, completo false
 *   ultimo dia util    -> decorridos = total,   divisor = total-1, completo false
 *   depois da janela   -> decorridos = total,   divisor = total,   completo true
 */
require("./_ts_register.cjs");
const { resolverCompetenciaAberta } = require("./_competenciaAberta.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe, productionBusinessWindow } = require("../lib/projecaoMetas.ts");
const { countBusinessDays } = require("../lib/trp/vigencia.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let falhas = 0;
const ok = (c, m) => {
  console.log(`  ${c ? "OK " : "XX "} ${m}`);
  if (!c) falhas++;
};
const brl = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (s) => new Date(`${s}T00:00:00Z`);

(async () => {
  console.log(`TRP_SOURCE=${process.env.TRP_SOURCE ?? "(nao setado)"}`);
  // ---- A COMPETENCIA E AS DATAS SAEM DO RUN, nao de literal ----
  //
  // Este bloco cravava jul/2026: janela de 23 dias uteis e as datas 29, 30 e 31/07
  // com os divisores 21/22/23 escritos a mao. Julho estava ABERTO quando o portao
  // foi escrito. Julho FECHOU, e com `res.fechado === true` o periodo passa a ser
  // COMPLETO em qualquer referenceDate — as 9 assercoes caiam de uma vez, medindo
  // o calendario em vez do divisor.
  //
  // O que o portao prova e PERMANENTE e nao tem nada com julho:
  //   dias_uteis_decorridos EXIBE o dia corrente; dias_uteis_ritmo (o DIVISOR) o
  //   exclui enquanto a competencia esta aberta, porque a producao de hoje so
  //   entra amanha — estaria no denominador sem estar no numerador.
  //
  // Agora os tres casos sao DERIVADOS da janela do mes ABERTO, por POSICAO:
  //   penultimo dia util -> decorridos = total-1, divisor = total-2, incompleto
  //   ultimo dia util    -> decorridos = total,   divisor = total-1, incompleto
  //   depois da janela   -> decorridos = total,   divisor = total,   COMPLETO
  // Nenhum numero cravado: `total` sai de productionBusinessWindow e as datas de
  // countBusinessDays — a MESMA aritmetica que a lib usa, nao uma copia.
  // Ver scripts/_competenciaAberta.cjs: seis portoes caiam por esta mesma causa.
  const ab = await resolverCompetenciaAberta(sb);
  const w = productionBusinessWindow(ab.year, ab.month);
  console.log(
    `\n=== JANELA ${ab.comp} (mes ABERTO, resolvido no run): ${w.start.toISOString().slice(0, 10)} -> ${w.end.toISOString().slice(0, 10)} | total=${w.total} ===`
  );
  // Sem ao menos 2 dias uteis nao existe "penultimo" e o caso A seria inventado.
  ok(w.total >= 2, `a janela tem ao menos 2 dias uteis para haver penultimo (total=${w.total})`);

  const diaAntes = (dt) => new Date(dt.getTime() - 86400000);
  const diaDepois = (dt) => new Date(dt.getTime() + 86400000);
  // penultimo dia UTIL: anda para tras a partir do fim ate o contador cair 1.
  let penultimo = diaAntes(w.end);
  for (let i = 0; i < 10 && countBusinessDays(w.start, penultimo, w.holidays) !== w.total - 1; i++) {
    penultimo = diaAntes(penultimo);
  }
  const iso = (dt) => dt.toISOString().slice(0, 10);

  const casos = [
    { ref: iso(penultimo), decorridos: w.total - 1, ritmo: w.total - 2, completo: false },
    { ref: iso(w.end), decorridos: w.total, ritmo: w.total - 1, completo: false },
    { ref: iso(diaDepois(w.end)), decorridos: w.total, ritmo: w.total, completo: true },
  ];
  console.log(`  casos derivados: ${casos.map((c) => `${c.ref}(exibe=${c.decorridos} divisor=${c.ritmo})`).join("  ")}`);

  for (const c of casos) {
    const res = await buildProjecaoMetas(sb, { year: ab.year, month: ab.month, referenceDate: d(c.ref) });
    const cons = consolidarGrupoEquipe(res);
    const jan = res.janela;
    const completo = res.fechado || d(c.ref) > w.end;

    console.log(`\n=== referenceDate ${c.ref} ===`);
    console.log(`  janela            : ${JSON.stringify(jan)}`);
    console.log(`  fechado(regime)   : ${res.fechado}`);
    console.log(`  periodoCompleto   : ${completo}`);
    console.log(`  promotores        : ${res.promotores.length}`);
    console.log(`  acumulado (grupo) : ${brl(cons.producao_acumulada)}`);
    console.log(`  projecao  (grupo) : ${brl(cons.projecao)}`);
    console.log(`  master acum/proj  : ${brl(res.naoAtribuido.total.acumulada)} / ${brl(res.naoAtribuido.total.projecao)}`);
    console.log(`  seguro emp a/p    : ${brl(cons.seguro_comissao_acumulada)} / ${brl(cons.seguro_comissao_projecao)}`);
    const p0 = res.promotores[0];
    if (p0) {
      console.log(
        `  1o promotor       : ${p0.promoter_name} | decorridos=${p0.dias_uteis_decorridos} ritmo=${p0.dias_uteis_ritmo} totais=${p0.dias_uteis_totais} | acum=${brl(p0.producao_acumulada)} proj=${brl(p0.projecao)}`
      );
    }

    ok(jan.dias_uteis_decorridos === c.decorridos, `${c.ref}: EXIBE decorridos ${c.decorridos} (veio ${jan.dias_uteis_decorridos})`);
    ok(jan.dias_uteis_ritmo === c.ritmo, `${c.ref}: DIVISOR do ritmo ${c.ritmo} (veio ${jan.dias_uteis_ritmo})`);
    ok(completo === c.completo, `${c.ref}: periodoCompleto ${c.completo} (veio ${completo})`);
    ok(
      p0 ? p0.dias_uteis_decorridos === c.decorridos && p0.dias_uteis_ritmo === c.ritmo : true,
      `${c.ref}: promotor carrega os MESMOS dois campos`
    );

    if (c.completo) {
      const dif = Math.abs(cons.projecao - cons.producao_acumulada);
      console.log(`  |projecao - acumulada| = ${brl(dif)}`);
      ok(dif < 0.005, `${c.ref}: periodo completo -> projecao == acumulada (dif ${brl(dif)})`);
    } else {
      // ritmo linear conferido na mao com o DIVISOR novo
      const esperado = c.ritmo > 0 ? (cons.producao_acumulada / c.ritmo) * w.total : 0;
      console.log(`  ritmo na mao (acum/${c.ritmo})*${w.total} = ${brl(esperado)}`);
      ok(Math.abs(cons.projecao - esperado) < 0.5, `${c.ref}: projecao usa o divisor ${c.ritmo}, nao ${c.decorridos}`);
      const errado = (cons.producao_acumulada / c.decorridos) * w.total;
      ok(
        Math.abs(cons.projecao - errado) > 0.5 || cons.producao_acumulada === 0,
        `${c.ref}: projecao NAO usa o divisor antigo ${c.decorridos} (daria ${brl(errado)})`
      );
    }
  }

  console.log(`\n${falhas === 0 ? "GATE OK" : `GATE FALHOU (${falhas})`}`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
