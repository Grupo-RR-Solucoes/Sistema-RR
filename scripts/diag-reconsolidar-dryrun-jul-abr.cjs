/* DRY-RUN da RECONSOLIDACAO de competencia FECHADA — NAO GRAVA NADA.
 *
 * Roda `reconsolidarCompetenciaFechada(..., { dryRun: true })` — a MESMA funcao
 * que a rota de import chama (lib/monthlyClosingImport.ts:1762) — e faz o diff
 * linha a linha do payload contra o que esta HOJE em promoter_monthly_results.
 *
 * Os dois lados sao computados/lidos NESTE run: nada de numero congelado.
 *
 * PERGUNTAS QUE ELE RESPONDE
 *   2026-07: o que muda em R$, por promotor?
 *   2026-04: muda algo ALEM das 2 linhas master (R$ 164,04)?
 *
 * DUAS ARMADILHAS MEDIDAS AQUI, as duas capazes de fazer o numero mentir:
 *
 *  1. TRP_SOURCE. Sem `TRP_SOURCE=db` o script local resolve a TRP pelo JSON
 *     enquanto a producao usa o banco (a flag NAO esta no .env.local). Em
 *     2026-07 e 2026-04 medi os dois lados e o PMR sai IDENTICO — o fechamento
 *     nao usa a TRP como insumo do PMR —, mas o run sem a flag cospe dezenas de
 *     "[motor] DRIFT ... usando fallback", que sao da AUDITORIA e nao do PMR.
 *     RODE COM `TRP_SOURCE=db`: e o que faz o silencio dos DRIFT ser informacao
 *     ("0 drifts") em vez de ruido que se aprende a ignorar.
 *
 *  2. O DIFF COBRE SO `grupo.payload` — a consolidacao BASE (credito+seguro).
 *     A reconsolidacao tem MAIS etapas (applyProdutoRepasseAoPmr, venda propria
 *     de gestao, gestor de consorcio) que em dryRun nao gravam e cujas linhas
 *     NAO estao no payload. Consequencia: uma linha de PRODUTO PURO (producao 0,
 *     0 propostas, final vindo do repasse de produto) aparece aqui como
 *     "SO NO BANCO", como se fosse apagada — e NAO e. Quem prova que nao e o
 *     proprio run: `reconciliacao.apagadas_daily` e `apagadas_orfaos` saem 0,
 *     porque as chaves de produto entram no novoSet. LEIA "SO NO BANCO" como
 *     "esta linha nao vem da base", NUNCA como "esta linha vai sumir".
 *     Medido em 2026-07: 2 linhas assim (MAGNOLIA LEITE 475,19 e MARCOS
 *     VINICIUS 433,85, ambas company b037ecdf, producao 0 e 0 propostas) =
 *     R$ 909,04 de delta que e ARTEFATO deste recorte, nao efeito.
 *
 * Uso:
 *   TRP_SOURCE=db node -e "require('./scripts/_ts_register.cjs');require('./scripts/diag-reconsolidar-dryrun-jul-abr.cjs')"
 *   COMPETENCIAS=2026-07,2026-04 TRP_SOURCE=db node ...   (default: essas duas)
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");

// .env.local vence (mesmo padrao de rodarClosingMonthly.ts).
(function carregarEnv() {
  for (const arquivo of [".env", ".env.local"]) {
    const p = path.join(ROOT, arquivo);
    if (!fs.existsSync(p)) continue;
    for (const linha of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2].trim();
    }
  }
})();

const { reconsolidarCompetenciaFechada } = require("../lib/reconsolidarCompetencia.ts");

const COMPETENCIAS = String(process.env.COMPETENCIAS || "2026-07,2026-04")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Os campos de DINHEIRO do PMR. O diff olha estes; os demais (contagens,
// percentuais, metas) entram numa contagem separada de "mudou algo nao-monetario".
const CAMPOS_R$ = [
  "production_commission_value",
  "insurance_commission_value",
  "agreement_adjustment_value",
  "discount_value",
  "final_commission_value",
];
const CAMPOS_OUTROS = [
  "production_value",
  "proposal_count",
  "insured_proposal_count",
  "insured_production_value",
  "insurance_penetration_percent",
  "target_value",
  "target_1_value",
  "target_2_value",
  "target_status",
  "piso_zerou",
];

const n = (v) => (v == null || v === "" ? 0 : Number(v));
const brl = (v) =>
  (v < 0 ? "-" : "") +
  Math.abs(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    .replace(/\.(\d{2})$/, ",$1");
const chave = (r) => `${r.promoter_id}||${r.company_id ?? "NULL"}`;

async function nomes(supabase, ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("promoters")
      .select("id, name")
      .in("id", ids.slice(i, i + 200));
    for (const p of data || []) mapa.set(p.id, p.name);
  }
  return mapa;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("credencial do Supabase ausente (.env.local)");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  for (const comp of COMPETENCIAS) {
    const [ys, ms] = comp.split("-");
    const year = Number(ys);
    const month = Number(ms);

    console.log("\n" + "=".repeat(78));
    console.log(`COMPETENCIA ${comp} — DRY-RUN da reconsolidacao (nada gravado)`);
    console.log("=".repeat(78));

    // ---- lado A: o que esta HOJE no banco
    const atuais = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("promoter_monthly_results")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      atuais.push(...(data || []));
      if ((data || []).length < 1000) break;
    }
    const porSource = {};
    for (const r of atuais) porSource[r.source || "(null)"] = (porSource[r.source || "(null)"] || 0) + 1;
    console.log(`PMR hoje: ${atuais.length} linhas | por source: ${JSON.stringify(porSource)}`);

    // ---- lado B: o que a reconsolidacao produziria
    const t0 = Date.now();
    let res;
    try {
      res = await reconsolidarCompetenciaFechada(supabase, { year, month, dryRun: true });
    } catch (e) {
      console.log(`RECONSOLIDACAO LANCOU: ${e.message}`);
      continue;
    }
    console.log(
      `regime='${res.regime}' | ran=${res.ran} | ${Date.now() - t0}ms` +
        (res.motivo ? `\nmotivo: ${res.motivo}` : "")
    );
    if (!res.ran) continue;

    const novas = (res.grupo && res.grupo.payload) || [];
    console.log(`payload da reconsolidacao: ${novas.length} linhas`);

    const A = new Map(atuais.map((r) => [chave(r), r]));
    const B = new Map(novas.map((r) => [chave(r), r]));

    const todasChaves = new Set([...A.keys(), ...B.keys()]);
    const mudancas = [];
    let somaAtual = 0;
    let somaNova = 0;

    for (const k of todasChaves) {
      const a = A.get(k);
      const b = B.get(k);
      const finalA = a ? n(a.final_commission_value) : 0;
      const finalB = b ? n(b.final_commission_value) : 0;
      somaAtual += finalA;
      somaNova += finalB;

      const difR$ = {};
      for (const c of CAMPOS_R$) {
        const va = a ? n(a[c]) : 0;
        const vb = b ? n(b[c]) : 0;
        if (Math.abs(va - vb) >= 0.005) difR$[c] = [va, vb];
      }
      const difOutros = {};
      for (const c of CAMPOS_OUTROS) {
        const va = a ? a[c] : null;
        const vb = b ? b[c] : null;
        const num = typeof va === "number" || typeof vb === "number";
        const mudou = num ? Math.abs(n(va) - n(vb)) >= 0.005 : String(va ?? "") !== String(vb ?? "");
        if (mudou) difOutros[c] = [va, vb];
      }
      const so_no_banco = !!a && !b;
      const so_no_payload = !a && !!b;
      if (Object.keys(difR$).length || Object.keys(difOutros).length || so_no_banco || so_no_payload) {
        mudancas.push({
          k,
          promoter_id: (a || b).promoter_id,
          company_id: (a || b).company_id,
          source_atual: a ? a.source : null,
          delta_final: finalB - finalA,
          difR$,
          difOutros,
          so_no_banco,
          so_no_payload,
        });
      }
    }

    const ids = [...new Set(mudancas.map((m) => m.promoter_id))];
    const nome = await nomes(supabase, ids);

    console.log(
      `\nSigma final_commission_value:  hoje ${brl(somaAtual)}  ->  reconsolidado ${brl(somaNova)}  ` +
        `(delta ${brl(somaNova - somaAtual)})`
    );
    const comDinheiro = mudancas.filter((m) => Math.abs(m.delta_final) >= 0.005);
    console.log(
      `linhas que mudam: ${mudancas.length} de ${todasChaves.size} | ` +
        `com delta no final: ${comDinheiro.length} | ` +
        `so no banco (seriam APAGADAS/zeradas): ${mudancas.filter((m) => m.so_no_banco).length} | ` +
        `so no payload (NOVAS): ${mudancas.filter((m) => m.so_no_payload).length}`
    );

    mudancas.sort((x, y) => Math.abs(y.delta_final) - Math.abs(x.delta_final));
    for (const m of mudancas) {
      const partes = [];
      for (const [c, [va, vb]] of Object.entries(m.difR$)) {
        partes.push(`${c}: ${brl(va)} -> ${brl(vb)}`);
      }
      for (const [c, [va, vb]] of Object.entries(m.difOutros)) {
        partes.push(`${c}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
      }
      console.log(
        `\n  ${nome.get(m.promoter_id) || m.promoter_id}  [company ${m.company_id ?? "NULL"}]` +
          `  source=${m.source_atual ?? "-"}` +
          (m.so_no_banco ? "  *** SO NO BANCO (o payload nao tem esta linha) ***" : "") +
          (m.so_no_payload ? "  *** LINHA NOVA ***" : "") +
          `\n     delta final: ${brl(m.delta_final)}`
      );
      for (const p of partes) console.log(`     ${p}`);
    }

    // Os outros efeitos que a reconsolidacao carrega (produto, gestao, piso,
    // reconciliacao) — em dryRun nenhum grava, mas o resultado diz o que fariam.
    // `payload` e `rows` sao AS LINHAS, nao efeitos — sem cortar as duas o dump
    // enterra os contadores debaixo de 56 objetos de PMR.
    const extras = JSON.parse(JSON.stringify(res));
    for (const k of ["ran", "regime", "competencia", "dry_run", "motivo", "payload", "promotores"]) {
      delete extras[k];
    }
    if (extras.grupo) {
      delete extras.grupo.payload;
      delete extras.grupo.rows;
    }
    if (Object.keys(extras).length) {
      console.log("\n  outros efeitos do dry-run:", JSON.stringify(extras, null, 1).slice(0, 2000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
