/*
 * GATE — NINGUEM, alem do resolvedor, le os estornos da aba "Seguro".
 *
 * POR QUE ESTE GATE EXISTE.
 *
 * Em 27/08/2026 a rotina de cancelamento lancou 36 debitos automaticos (R$ 1.319,51)
 * e a frente parou meio dia na suspeita de que isso DUPLICAVA o desconto — a tese
 * era que o arquivo do CMS ja trazia o estorno embutido. A medicao derrubou a tese:
 *
 *   - cms_promoter_entries tem 3.045 linhas e ZERO com promoter_credit < 0 ou
 *     promoter_insurance < 0. O menor valor das duas colunas e 0,00.
 *   - O CMS cobre 2026-01/02/03/05. NAO existe CMS de junho nem de julho, que sao
 *     justamente as competencias dos 36 debitos.
 *   - Caso concreto (JARLES MARLON, jun/2026): PMR final 4.396,63 =
 *     prod 4.105,38 + seguro 1,77 + consorcio 289,48, residuo 0,00. O estorno dele
 *     no fechamento e 320,04 e NAO esta subtraido em lugar nenhum.
 *
 * MAS a medicao revelou o mecanismo REAL, e ele e fragil. Os estornos EXISTEM no
 * banco como linhas negativas: em jun/2026 sao 30 linhas somando -R$ 901,24, todas
 * com entry_type='INSURANCE' e sheet_name='Seguro'. O que impede a dupla contagem
 * hoje e UMA linha:
 *
 *     lib/closingPromoterBase.ts:160    .eq("entry_type", "CASH")
 *
 * O consolidador que produz o PMR 'fechamento' le so CASH, entao as 224 linhas
 * INSURANCE de junho nunca chegam ao promotor. Se alguem trocar esse filtro, ou
 * escrever um consumidor novo que leia INSURANCE sem excluir a aba "Seguro", a
 * duplicidade nasce EM SILENCIO — o promotor passa a ser descontado duas vezes e
 * nada quebra.
 *
 * O QUE ELE ASSERE (os dois lados computados no MESMO run):
 *
 *   1. FONTE UNICA. O unico arquivo que le entry_type='INSURANCE' da aba "Seguro"
 *      e lib/debitInsuranceResolver.ts. Qualquer outro leitor reprova, a menos que
 *      prove que exclui a aba (como remuneracaoLideranca.ts, que so aceita
 *      INSURANCE quando a aba e "A Vista").
 *
 *   2. O FILTRO DO CONSOLIDADOR CONTINUA LA. closingPromoterBase le CASH. Se esse
 *      .eq sumir, o gate reprova — e essa e a regressao mais barata de cometer.
 *
 *   3. NAO E VACUO. Confere no BANCO que a aba "Seguro" tem linhas negativas na
 *      competencia medida. Se um dia ela esvaziar, o gate DECLARA vacuidade em vez
 *      de passar calado (assercao que nao mede nada e gate verde mentiroso — a
 *      varredura de 18/08/2026 achou 8 desses).
 *
 * PROVADO POR MUTACAO em 27/08/2026: criar um arquivo que consulta
 * monthly_closing_entries com entry_type='INSURANCE' sem excluir a aba faz a
 * assercao (1) REPROVAR.
 *
 * LIMITE DECLARADO: o gate le TEXTO. Um consumidor que monte o filtro por variavel
 * (`.eq("entry_type", tipo)`) escapa da varredura. Ele pega a regressao provavel
 * (copiar-colar de uma query existente), nao um leitor deliberadamente ofuscado.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const ALVO = "monthly_closing_entries";

// O leitor LEGITIMO: e a razao de a aba existir no sistema.
const LISTA_BRANCA = new Set(["lib/debitInsuranceResolver.ts"]);

let falhas = 0;
function ok(nome, fn) {
  try {
    fn();
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`  FALHA ${nome}\n        ${e.message}`);
  }
}

function arquivosFonte(dir, acc = []) {
  for (const nome of fs.readdirSync(dir)) {
    if (nome === "node_modules" || nome === ".next" || nome === ".git") continue;
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) arquivosFonte(p, acc);
    else if (/\.(ts|tsx|js|jsx|mts|cjs)$/.test(nome)) acc.push(p);
  }
  return acc;
}

/**
 * Um arquivo LE o estorno se consulta a tabela alvo e amarra INSURANCE ao
 * ENTRY_TYPE, sem excluir a aba.
 *
 * A amarra com entry_type e obrigatoria: "INSURANCE" tambem e valor de
 * `agreement_type` em promoter_agreements. Sem ela, app/api/promotores/route.ts
 * (que grava acordo de seguro e por acaso cita monthly_closing_entries noutro
 * ponto) reprovava o gate — falso positivo medido na 1a execucao, 27/08/2026.
 */
function leEstorno(txt) {
  if (!txt.includes(ALVO)) return false;
  const amarradoAoEntryType =
    // .eq("entry_type", "INSURANCE")
    /entry_type["']\s*,\s*["']INSURANCE["']/.test(txt) ||
    // .in("entry_type", [... "INSURANCE" ...])
    /entry_type["']\s*,\s*\[[^\]]*["']INSURANCE["']/.test(txt) ||
    // comparacao solta na mesma linha: t === "INSURANCE" logo apos ler entry_type
    txt.split("\n").some((l) => /entry_type/.test(l) && /["']INSURANCE["']/.test(l));
  if (!amarradoAoEntryType) return false;
  // Prova de exclusao: o arquivo restringe a aba a algo que NAO e "Seguro".
  const excluiPelaAba =
    /ABA_A_VISTA/.test(txt) ||
    /["']A Vista["']/.test(txt) ||
    /normalizarAba\(/.test(txt);
  return !excluiPelaAba;
}

(async () => {
  console.log('GATE: os estornos da aba "Seguro" tem UM leitor so\n');

  const fontes = [
    ...arquivosFonte(path.join(RAIZ, "lib")),
    ...arquivosFonte(path.join(RAIZ, "app")),
  ];
  const leitores = [];
  for (const p of fontes) {
    const rel = path.relative(RAIZ, p).split(path.sep).join("/");
    if (leEstorno(fs.readFileSync(p, "utf8"))) leitores.push(rel);
  }
  const intrusos = leitores.filter((r) => !LISTA_BRANCA.has(r));

  ok("(1) so o resolvedor le entry_type='INSURANCE' da aba Seguro", () => {
    assert.deepEqual(
      intrusos,
      [],
      `leitor(es) de estorno fora da lista branca: ${intrusos.join(", ")}. ` +
        `Cada um desses DUPLICA o desconto do promotor, porque a rotina de ` +
        `cancelamento ja lanca esses valores em promoter_discounts.`
    );
  });

  ok("(1b) o resolvedor continua sendo um leitor (a lista branca nao esta morta)", () => {
    assert.ok(
      leitores.includes("lib/debitInsuranceResolver.ts"),
      "lib/debitInsuranceResolver.ts nao le mais a aba Seguro — ou a rotina mudou " +
        "de fonte, ou a varredura deste gate parou de funcionar. Nos dois casos a " +
        "assercao (1) virou vacua."
    );
  });

  ok('(2) closingPromoterBase continua lendo SO entry_type=CASH', () => {
    const p = path.join(RAIZ, "lib", "closingPromoterBase.ts");
    const txt = fs.readFileSync(p, "utf8");
    assert.match(
      txt,
      /\.eq\(\s*["']entry_type["']\s*,\s*["']CASH["']\s*\)/,
      "closingPromoterBase.ts perdeu o filtro por CASH. E ESSA linha que impede o " +
        "PMR de subtrair o estorno que a rotina ja debitou."
    );
  });

  // ---- (3) o dado existe? (evita gate verde por vacuidade) ----
  let sb = null;
  try {
    require("./_ts_register.cjs");
    const { createClient } = require("@supabase/supabase-js");
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      );
    }
  } catch (_) {
    /* sem banco: declarado abaixo */
  }

  if (!sb) {
    console.log(
      "  PULADO (3) — sem credencial de banco. A assercao de NAO-VACUIDADE nao " +
        "rodou; as (1),(1b),(2) sao estaticas e valem."
    );
  } else {
    const { data, error } = await sb
      .from("monthly_closing_entries")
      .select("operation_number, commission_value")
      .eq("year", 2026)
      .eq("month", 6)
      .eq("entry_type", "INSURANCE")
      .eq("sheet_name", "Seguro")
      .lt("commission_value", 0);
    if (error) {
      console.log(`  PULADO (3) — o banco recusou a consulta: ${error.message}`);
    } else {
      const soma = (data || []).reduce((a, r) => a + Number(r.commission_value || 0), 0);
      ok("(3) a aba Seguro TEM estornos — o gate nao passa por vacuidade", () => {
        assert.ok(
          (data || []).length > 0,
          "0 linhas de estorno em 2026-06. O gate viraria verde sem medir nada: " +
            "declare a mudanca de competencia de referencia em vez de deixar assim."
        );
      });
      console.log(
        `       (medido agora: ${data.length} estornos em 2026-06, soma ${soma.toFixed(2)})`
      );
    }
  }

  console.log(falhas === 0 ? "\nGATE OK" : `\nGATE REPROVOU (${falhas} falha(s))`);
  // exitCode, NAO process.exit(): com o cliente do Supabase ainda com handle
  // aberto, sair na marra estoura o libuv no Windows
  // ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") e o runner recebe
  // exit 3221226505 — gate VERMELHO com todas as assercoes verdes. Medido em
  // 27/08/2026: o gate imprimia "GATE OK" e o run_all_gates marcava FALHOU.
  process.exitCode = falhas === 0 ? 0 : 1;
})().catch((e) => {
  console.error("ERRO:", (e && e.stack) || e);
  process.exitCode = 1;
});
