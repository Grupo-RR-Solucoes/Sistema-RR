/*
 * GATE — a matriz do Financeiro FECHA com os cards, ao centavo, nos dois lados.
 *
 * POR QUE ESTE GATE EXISTE. A matriz existe para o Diego parar de confiar no total
 * e ver de onde veio cada real. Matriz que nao fecha e PIOR que matriz nenhuma: da
 * a impressao de explicar sem explicar, e o numero que nao bate ele nao usa. O
 * modo de falhar e insidioso — alguem acrescenta um componente ao "Recebido"
 * (foi o que aconteceu com a ADS em 26/08/2026, +R$ 18.859,44) e esquece da
 * matriz. O card sobe, a matriz nao, e ninguem percebe porque as duas telas
 * continuam "funcionando".
 *
 * O QUE ELE ASSERE, com os dois lados computados no MESMO run:
 *   1. matriz.total == card, ao centavo, nas TRES matrizes (entrada, saida,
 *      despesa), em 4 competencias.
 *   2. a soma das CELULAS EXIBIDAS == o total EXIBIDO de cada linha (o Diego
 *      confere somando a coluna; se a celula nao soma, a matriz mente na cara).
 *   3. a soma dos totais de LINHA == a soma dos totais de COLUNA.
 *   4. a expansao de "Outros" soma exatamente a celula "Outros".
 *   5. nenhuma linha "sem empresa" com valor (hoje tudo e atribuivel).
 *   6. entrada - saida - despesa == card "Saldo" (o Saldo vira RASTREAVEL).
 *   7. a linha de GRUPO, se houver, e rotulada "Grupo (sem empresa)" e nunca
 *      "nao atribuido".
 *
 * VACUIDADE DECLARADA: a (7) NAO EXERCITA hoje. Nao existe despesa de escopo
 * GRUPO no banco (medido 26/08/2026: 5 linhas, todas scope=COMPANY com
 * company_id). Ela e uma trava POSICIONADA para quando a primeira aparecer — nao
 * uma prova de que o rotulo funciona. O que sustenta o rotulo hoje e o comentario
 * em lib/financialAnalytics.ts, junto da construcao da linha.
 *
 * NAO ha constante congelada de valor esperado: o lado direito e sempre o card
 * do MESMO payload.
 *
 * needs-db: createClient, dado de PRODUCAO.
 */
require("./_ts_register.cjs");
const assert = require("node:assert/strict");
const { createClient } = require("@supabase/supabase-js");
const { buildFinancialAnalytics } = require("../lib/financialAnalytics.ts");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// maio/2026 e OBRIGATORIO nesta lista: e a UNICA competencia com despesa lancada
// (5 linhas, R$ 34.132,28, medido 26/08/2026). Sem ela o lado da despesa passaria
// por VACUIDADE — matriz vazia contra card zerado fecha trivialmente e nao prova
// nada. Gate que so exercita o caso vazio nao e gate.
const COMPETENCIAS = [
  [2026, 5],
  [2026, 6],
  [2026, 7],
  [2026, 8],
];

const f = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

let falhas = 0;
const ok = (nome, fn) => {
  try {
    fn();
    console.log("  OK   " + nome);
  } catch (e) {
    falhas++;
    console.log("  FALHA " + nome + "\n         " + e.message);
  }
};

async function main() {
  console.log("GATE: a matriz do Financeiro fecha com os cards\n");

  for (const [year, month] of COMPETENCIAS) {
    const comp = `${year}-${String(month).padStart(2, "0")}`;
    const payload = await buildFinancialAnalytics(sb, { year, month });
    const det = payload.detalhamento;

    assert.ok(det, `payload sem 'detalhamento' em ${comp}`);

    for (const lado of ["entrada", "saida", "despesa"]) {
      const m = det[lado];
      const tag = `${comp} ${lado}`;

      // (1) o total da matriz E o card
      ok(`${tag}: matriz == card (${f(m.total)})`, () => {
        assert.equal(
          r2(m.total),
          r2(m.cardTotal),
          `matriz ${f(m.total)} != card ${f(m.cardTotal)} (delta ${f(m.delta)})`
        );
        assert.equal(r2(m.delta), 0, `delta exposto = ${f(m.delta)}`);
      });

      // (2) as celulas EXIBIDAS somam o total EXIBIDO, linha a linha
      ok(`${tag}: celulas somam o total de cada linha`, () => {
        for (const l of m.linhas) {
          const soma = r2(m.colunas.reduce((a, c) => a + (Number(l.celulas[c.chave]) || 0), 0));
          assert.equal(soma, r2(l.total), `linha "${l.rotulo}": celulas ${f(soma)} != total ${f(l.total)}`);
        }
      });

      // (3) Sigma linhas == Sigma colunas
      ok(`${tag}: total por linha == total por coluna`, () => {
        const porLinha = r2(m.linhas.reduce((a, l) => a + l.total, 0));
        const porColuna = r2(m.colunas.reduce((a, c) => a + (Number(m.totaisColuna[c.chave]) || 0), 0));
        assert.equal(porLinha, porColuna, `linhas ${f(porLinha)} != colunas ${f(porColuna)}`);
        assert.equal(porLinha, r2(m.total), `soma das linhas ${f(porLinha)} != total ${f(m.total)}`);
      });

      // (4) a expansao de "Outros" soma a celula "Outros"
      ok(`${tag}: expansao de 'Outros' soma a celula`, () => {
        const temOutros = m.colunas.some((c) => c.chave === "outros");
        if (!temOutros) return;
        for (const l of m.linhas) {
          if (l.avulso) continue; // avulso desdobra por CATEGORIA, nao por produto
          const soma = r2((l.outrosDetalhe || []).reduce((a, o) => a + (Number(o.valor) || 0), 0));
          assert.equal(
            soma,
            r2(l.celulas.outros),
            `linha "${l.rotulo}": detalhe ${f(soma)} != celula ${f(l.celulas.outros)}`
          );
        }
      });

      // (5) nada em "sem empresa"
      ok(`${tag}: nenhuma linha 'sem empresa' com valor`, () => {
        const orfas = m.linhas.filter((l) => l.chave === "__sem_empresa" && r2(l.total) !== 0);
        assert.equal(
          orfas.length,
          0,
          `${orfas.length} linha(s) sem empresa: ${orfas.map((l) => f(l.total)).join(", ")}`
        );
      });
    }

    // (6) A CONTA DAS TRES: recebido - comissoes - despesas == card "Saldo".
    // E o que torna o Saldo RASTREAVEL: cada parcela tem uma tabela por tras, e
    // nenhuma delas pode andar sozinha sem o total denunciar.
    ok(`${comp}: as TRES matrizes reconstroem o card Saldo`, () => {
      const calc = r2(det.entrada.total - det.saida.total - det.despesa.total);
      assert.equal(
        calc,
        r2(payload.summary.operatingResult),
        `entrada ${f(det.entrada.total)} - saida ${f(det.saida.total)} - despesa ${f(det.despesa.total)} = ${f(calc)}, mas o card Saldo diz ${f(payload.summary.operatingResult)}`
      );
    });

    // (7) A LINHA DE GRUPO, quando existir, e rotulada como tal — NUNCA "nao
    // atribuido". Uma diz "esta despesa nao pertence a uma empresa" (verdade); a
    // outra diria "faltou o dado" (falso). O gate trava a distincao porque ela e
    // facil de perder num refactor de rotulo.
    ok(`${comp}: linha de grupo (se houver) tem o rotulo certo`, () => {
      const g = det.despesa.linhas.find((l) => l.chave === "__grupo");
      if (!g) return;
      assert.ok(
        /Grupo \(sem empresa\)/.test(g.rotulo),
        `rotulo da linha de grupo: "${g.rotulo}"`
      );
      assert.ok(
        !/nao atribu|n\u00e3o atribu/i.test(g.rotulo),
        "a linha de grupo nao pode dizer 'nao atribuido'"
      );
    });
  }

  console.log("\n" + (falhas === 0 ? "GATE VERDE" : "GATE VERMELHO — " + falhas + " falha(s)"));
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exit(1);
});
