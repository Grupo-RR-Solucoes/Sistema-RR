/*
 * GATE — /projecao: separa "dias decorridos EXIBIDOS" do "divisor do ritmo".
 * READ-ONLY (le prod). Janela jul/2026 = 30/06 -> 30/07, total 23 dias uteis.
 *
 * Regra (Diego):
 *   - dias_uteis_decorridos = dias uteis vencidos com HOJE INCLUIDO (o "23/23").
 *   - dias_uteis_ritmo      = divisor = decorridos MENOS o dia corrente, quando a
 *                             competencia esta ABERTA e hoje e dia util.
 *   - periodoCompleto so quando refDate PASSA de end (em refDate == end extrapola).
 *
 * Esperado:
 *   2026-07-29 -> decorridos 22, ritmo 21, completo false
 *   2026-07-30 -> decorridos 23, ritmo 22, completo false
 *   2026-07-31 -> decorridos 23, completo true, projecao == acumulada
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const { buildProjecaoMetas, consolidarGrupoEquipe, productionBusinessWindow } = require("../lib/projecaoMetas.ts");

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
  const w = productionBusinessWindow(2026, 7);
  console.log(
    `\n=== JANELA jul/2026: ${w.start.toISOString().slice(0, 10)} -> ${w.end.toISOString().slice(0, 10)} | total=${w.total} ===`
  );
  ok(w.total === 23, `total de dias uteis da janela = 23 (veio ${w.total})`);

  const casos = [
    { ref: "2026-07-29", decorridos: 22, ritmo: 21, completo: false },
    { ref: "2026-07-30", decorridos: 23, ritmo: 22, completo: false },
    { ref: "2026-07-31", decorridos: 23, ritmo: 23, completo: true },
  ];

  for (const c of casos) {
    const res = await buildProjecaoMetas(sb, { year: 2026, month: 7, referenceDate: d(c.ref) });
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
