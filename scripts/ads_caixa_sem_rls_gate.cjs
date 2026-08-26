/*
 * GATE — o Caixa NUNCA le bbts_prt_parcelas pelo cliente da PAGINA.
 *
 * O DEFEITO QUE ISTO TRAVA (producao, 26/08/2026): buildFinancialAnalytics passou a
 * ler a ADS e usou o cliente do guard (anon+cookie => papel `authenticated`) para
 * `bbts_prt_parcelas`. Essa tabela e RLS default-deny com ZERO politicas, de
 * PROPOSITO (migration 20260712_000004:40, "so service_role"). Resultado: 42501
 * "permission denied" e /financeiro INTEIRA fora do ar. As 4 rotas que chamam a
 * funcao usam guard anon, entao o erro alcancava todas.
 *
 * COMO PROVA: passa um cliente ESPIAO que ESTOURA se `.from()` for chamado com uma
 * tabela de acesso restrito. Se buildFinancialAnalytics terminar, a leitura da ADS
 * nao passou pelo cliente da pagina. Os dois lados no mesmo run — nenhuma constante.
 *
 * needs-db: usa service_role real por baixo (o espiao so intercepta o .from()).
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");

const RESTRITAS = ["bbts_prt_parcelas"];

(async()=>{
  const real = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const tocadas = [];
  const espiao = new Proxy(real, {
    get(alvo, prop, recv) {
      if (prop === "from") {
        return (tabela) => {
          tocadas.push(tabela);
          if (RESTRITAS.includes(tabela)) {
            throw new Error(
              `REGRESSAO: buildFinancialAnalytics leu "${tabela}" pelo cliente da PAGINA. ` +
              `Essa tabela e RLS default-deny (so service_role) e isso derruba /financeiro com 42501.`
            );
          }
          return alvo.from(tabela);
        };
      }
      return Reflect.get(alvo, prop, recv);
    },
  });

  let falhou = null;
  let payload = null;
  try { payload = await buildFinancialAnalytics(espiao, { year: 2026, month: 8 }); }
  catch (e) { falhou = e; }

  console.log("GATE: o Caixa nao le tabela restrita pelo cliente da pagina\n");
  console.log("  tabelas tocadas pelo cliente da pagina: " + [...new Set(tocadas)].sort().join(", "));

  let erros = 0;
  const ok = (nome, fn) => { try { fn(); console.log("  OK   " + nome); } catch (e) { erros++; console.log("  FALHA " + nome + "\n         " + e.message); } };

  ok("buildFinancialAnalytics completou sem tocar tabela restrita", () => {
    if (falhou) throw falhou;
    assert.ok(payload, "sem payload");
  });
  for (const t of RESTRITAS) {
    ok(`"${t}" NAO foi lida pelo cliente da pagina`, () => assert.ok(!tocadas.includes(t)));
  }
  // e a ADS TEM de estar no numero — senao "nao ler" seria trivialmente verdade
  ok("a ADS continua entrando no Recebido (o conserto nao virou remocao)", () => {
    assert.ok(payload.summary.receivedNet > 300000,
      `receivedNet=${payload.summary.receivedNet} — abaixo do esperado com a ADS dentro`);
  });

  console.log("\n" + (erros === 0 ? "GATE VERDE" : "GATE VERMELHO — " + erros + " falha(s)"));
  process.exit(erros === 0 ? 0 : 1);
})().catch(e=>{console.error("ERRO:", e && e.stack || e); process.exit(1);});
