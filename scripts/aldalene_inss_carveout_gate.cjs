/*
 * GATE — o carve-out INSS da Aldalene dispara pela TAXA, e so nela.
 *
 * SELF-CONTAINED e OFFLINE: Supabase FALSO em memoria + a funcao REAL
 * consolidateMonthlyFromClosing.
 *
 * O QUE ELE IMPEDE DE VOLTAR
 * --------------------------
 * Ate 25/08/2026 closingMonthly testava:
 *     normText(nameById.get(pid)).includes("ALDALENE") &&
 *     normText(c.produto).includes("INSS")
 * e `c.produto` e o CODIGO do produto ("2882", "3100", "2992"), nunca uma
 * descricao. O segundo termo era sempre falso: o carve-out NUNCA disparou, em
 * competencia nenhuma. Em jul/2026 os 45 contratos dela resolveram todos
 * 58,33% via PROFILE_VARIAVEL_FALLBACK.
 *
 * O CRITERIO CERTO, medido sobre os 44 contratos dela com PF em jul/2026:
 *     convenio 1640 .......... 42/44
 *     categoria TRP INSS ..... 42/44
 *     % a vista == 3,34% ..... 44/44   <-- este
 * Os dois contratos que derrubam as outras duas hipoteses estao reproduzidos
 * aqui pelo formato REAL deles:
 *     214235822  convenio 1078 (SIAPE), a-vista 3,34% -> planilha pagou 65,86%
 *     220180918  convenio 1640 (INSS),  a-vista 2,03% -> planilha pagou 58,33%
 *
 * E POR QUE O NOME FICA NO TESTE: o carve-out e INDIVIDUAL, medido. Em
 * jul/2026 ha 278 contratos a 3,34% em 37 promotores; so os 15 da Aldalene
 * recebem 65,86%. Tirar o nome daria 65,86% a 37 pessoas — o gate prova isso
 * com a promotora de controle.
 *
 * AS PROVAS
 *   A) ANTI-VACUIDADE: o cenario tem contrato a 3,34% da Aldalene, contrato a
 *      3,34% de OUTRA pessoa, e contrato da Aldalene FORA de 3,34%. Sem os tres
 *      o gate nao distingue "taxa", "individual" e "so nessa taxa".
 *   B) O criterio antigo NAO poderia disparar: nenhum `produto` do cenario
 *      contem "INSS" (sao codigos), como no dado real.
 *   C) Aldalene a 3,34% -> 65,86% fixo.
 *   D) OUTRA pessoa a 3,34% -> o acordo dela, NUNCA 65,86%.
 *   E) Aldalene a 2,03% -> o acordo normal, NUNCA 65,86% (o caso 220180918).
 *   F) Aldalene a 6,00% -> a escala da Frente C, nao o carve-out (a ordem da
 *      cascata: INSS vence a escala, mas so na taxa dele).
 *   G) Unidade de isAldaleneInssCarveOut: nome, taxa, borda e guardas.
 *
 * exit 0 = todas as provas passam; exit 2 = alguma falhou.
 */
require("./_ts_register.cjs");

process.env.PISO_ALLOW_RR_PURE = "1";

const { consolidateMonthlyFromClosing } = require("../lib/closingMonthly.ts");
const {
  ALDALENE_INSS_FIXED_SHARE,
  ALDALENE_INSS_AVISTA_PERCENT,
  isAldaleneInssCarveOut,
} = require("../lib/proposalDetailing.ts");
const { baseRepasseAvistaRR } = require("../lib/tetoAvistaRR.ts");

const YEAR = 2026;
const MONTH = 7;
const COMP = { year: YEAR, month: MONTH };
const CO = "company-1";
const P_ALD = "promotor-aldalene";
const P_OUTRA = "promotor-controle";
const J_ALD = "J0000001";
const J_OUTRA = "J0000002";
const ESCALA_BASE = 0.612; // pct_base real da Aldalene em promoter_goal_repasse

// ---------------------------------------------------------------------------
function fakeSupabase(tabelas) {
  const db = JSON.parse(JSON.stringify(tabelas));
  const upserts = [];
  function builder(nome) {
    const filtros = [];
    const casa = (r) =>
      filtros.every((f) => {
        const v = r[f.col];
        if (f.op === "eq") return v === f.val;
        if (f.op === "neq") return v !== f.val;
        if (f.op === "in") return f.val.includes(v);
        if (f.op === "is") return v === null || v === undefined;
        if (f.op === "lte") return v <= f.val;
        if (f.op === "gte") return v >= f.val;
        if (f.op === "lt") return v < f.val;
        if (f.op === "gt") return v > f.val;
        return true;
      });
    const linhas = () => (db[nome] || []).filter(casa);
    const api = {
      select: () => api,
      eq(col, val) { filtros.push({ op: "eq", col, val }); return api; },
      neq(col, val) { filtros.push({ op: "neq", col, val }); return api; },
      in(col, val) { filtros.push({ op: "in", col, val }); return api; },
      is(col) { filtros.push({ op: "is", col }); return api; },
      not() { return api; },
      lte(col, val) { filtros.push({ op: "lte", col, val }); return api; },
      gte(col, val) { filtros.push({ op: "gte", col, val }); return api; },
      lt(col, val) { filtros.push({ op: "lt", col, val }); return api; },
      gt(col, val) { filtros.push({ op: "gt", col, val }); return api; },
      or() { return api; },
      order: () => api,
      limit: () => api,
      maybeSingle() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: linhas()[0] ?? null, error: null }); },
      range(from, to) { return Promise.resolve({ data: linhas().slice(from, to + 1), error: null }); },
      upsert(rows) { upserts.push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve({ data: null, error: null }); },
      insert() { return Promise.resolve({ data: null, error: null }); },
      delete() { return { in: () => Promise.resolve({ data: null, error: null }) }; },
      then(resolve, reject) { return Promise.resolve({ data: linhas(), error: null }).then(resolve, reject); },
    };
    return api;
  }
  return { from: (nome) => builder(nome), __upserts: upserts };
}

// ---------------------------------------------------------------------------
// CENARIO — os quatro casos reais, com `produto` no formato do banco (CODIGO).
// ---------------------------------------------------------------------------
const PCT_INSS = ALDALENE_INSS_AVISTA_PERCENT; // 0,0334
const PCT_BAIXO = 0.0203; // o caso 220180918
const PCT_FAIXA = 0.06; // faixa 5,80 (acima do teto, ver B1)
const LIQ = 10000;

const cash = (contrato, jkey, pct, produto) => ({
  id: `cash-${contrato}`,
  company_id: CO,
  year: YEAR,
  month: MONTH,
  entry_type: "CASH",
  sheet_name: "A Vista ",
  contract_number: contrato,
  j_key: jkey,
  product_name: produto,
  net_value: LIQ,
  insurance_value: 0,
  commission_value: LIQ * pct,
  metadata: {
    CONTRATO: contrato,
    "CHAVE J": jkey,
    "% A VISTA": pct,
    "COMISSÃO PF": LIQ * pct,
    "VALOR LÍQUIDO": LIQ,
    "COMISSÃO SEGURO": 0,
    "VALOR SEGURO": 0,
    "% PENETRAÇÃO": 0,
    "RESTRIÇÃO SRCC": "Não",
    "PROD. SEGURADA": "Não",
    // No banco este campo e o CODIGO do produto, nunca a descricao.
    "DESCRIÇÃO DO PRODUTO": produto,
  },
});

// Os numeros de contrato sao os REAIS dos dois casos que definiram o criterio.
const ALD_INSS = cash("214235822", J_ALD, PCT_INSS, "2882"); // conv 1078, 3,34%
const ALD_BAIXO = cash("220180918", J_ALD, PCT_BAIXO, "2882"); // conv 1640, 2,03%
const ALD_FAIXA = cash("219232495", J_ALD, PCT_FAIXA, "2882"); // 6,00% -> escala
const OUTRA_INSS = cash("220992572", J_OUTRA, PCT_INSS, "2882"); // 3,34%, outra pessoa

const baseDB = (entries, { comEscala = true } = {}) => ({
  monthly_closing_entries: entries,
  companies: [{ id: CO, name: "RR TESTE", group_name: "Grupo RR" }],
  promoters: [
    { id: P_ALD, name: "ALDALENE DE FREITAS ABRAÃO" },
    { id: P_OUTRA, name: "PROMOTORA DE CONTROLE" },
  ],
  j_keys: [
    { j_key: J_ALD, promoter_id: P_ALD, key_type: "INDIVIDUAL" },
    { j_key: J_OUTRA, promoter_id: P_OUTRA, key_type: "INDIVIDUAL" },
  ],
  daily_production_records: [],
  monthly_targets: [],
  promoter_goal_repasse: comEscala
    ? [
        {
          promoter_id: P_ALD,
          competencia: "2026-07-01",
          pct_base: ESCALA_BASE,
          pct_meta1: 0.6224,
          pct_meta2: 0.6327,
        },
      ]
    : [],
  promoter_share_profile: [],
  share_scale: [],
  share_scale_tier: [],
  promoter_monthly_results: [],
  promoter_agreements: [],
  insurance_slip_rules: [],
});

// ---------------------------------------------------------------------------
const falhas = [];
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perto = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const normText = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

function checa(nome, ok, detalhe) {
  console.log(`${ok ? "  OK  " : "  X   "} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!ok) falhas.push(nome);
}

async function rodar(entries, opts) {
  const sb = fakeSupabase(baseDB(entries, opts));
  const res = await consolidateMonthlyFromClosing(sb, { year: YEAR, month: MONTH, dryRun: true });
  const de = (pid) => (res?.table ?? []).find((t) => t.promoter_id === pid);
  return { ald: de(P_ALD), outra: de(P_OUTRA), upserts: sb.__upserts.length };
}

(async () => {
  console.log(`== carve-out: ${(ALDALENE_INSS_FIXED_SHARE * 100).toFixed(2)}% na taxa de ${(PCT_INSS * 100).toFixed(2)}%`);

  // -- A) ANTI-VACUIDADE ------------------------------------------------------
  console.log("\n== A) ANTI-VACUIDADE — o cenario cobre os tres eixos?");
  const cenario = [ALD_INSS, ALD_BAIXO, ALD_FAIXA, OUTRA_INSS];
  checa("ha contrato da Aldalene NA taxa do carve-out", cenario.some((c) => c.j_key === J_ALD && perto(c.metadata["% A VISTA"], PCT_INSS)));
  checa("ha contrato da Aldalene FORA da taxa", cenario.some((c) => c.j_key === J_ALD && !perto(c.metadata["% A VISTA"], PCT_INSS)));
  checa("ha contrato de OUTRA pessoa NA mesma taxa (prova a individualidade)", cenario.some((c) => c.j_key === J_OUTRA && perto(c.metadata["% A VISTA"], PCT_INSS)));

  // -- B) o criterio ANTIGO nao poderia disparar -----------------------------
  console.log("\n== B) o criterio ANTIGO (produto.includes('INSS')) e letra morta");
  const produtos = [...new Set(cenario.map((c) => String(c.metadata["DESCRIÇÃO DO PRODUTO"])))];
  const algumComInss = produtos.some((p) => normText(p).includes("INSS"));
  checa("nenhum `produto` do cenario contem 'INSS' (sao codigos, como no banco)", !algumComInss, produtos.join(", "));
  checa("logo o teste antigo daria FALSE ate no contrato que E do carve-out", !normText(ALD_INSS.metadata["DESCRIÇÃO DO PRODUTO"]).includes("INSS"));

  // -- CONTROLE: o share default, medido -------------------------------------
  console.log("\n== CONTROLE — a promotora sem carve-out revela o share default");
  const ctrl = await rodar([OUTRA_INSS], { comEscala: false });
  const s = Number(ctrl.outra?.production_commission_value ?? 0) / (LIQ * PCT_INSS);
  checa("share default util (0 < s <= 1)", s > 0 && s <= 1, `s = ${s}`);
  checa("e o share default NAO e o do carve-out (senao nada se distingue)", !perto(s, ALDALENE_INSS_FIXED_SHARE), `${s} vs ${ALDALENE_INSS_FIXED_SHARE}`);
  if (!(s > 0 && s <= 1) || perto(s, ALDALENE_INSS_FIXED_SHARE)) {
    console.log("\nGATE SEM REFERENCIA. REPROVADO.");
    process.exit(2);
  }

  // -- C..F) o motor REAL no cenario completo --------------------------------
  console.log("\n== C..F) O MOTOR REAL — cenario com os quatro contratos");
  const full = await rodar(cenario);
  const pfInss = LIQ * PCT_INSS;
  const pfBaixo = LIQ * PCT_BAIXO;
  const baseFaixa = baseRepasseAvistaRR(LIQ * PCT_FAIXA, PCT_FAIXA, COMP); // teto (B1)
  const espAld = pfInss * ALDALENE_INSS_FIXED_SHARE + pfBaixo * s + baseFaixa * ESCALA_BASE;
  const espAldSemCarveOut = pfInss * s + pfBaixo * s + baseFaixa * ESCALA_BASE;
  console.log(`     esperado COM carve-out ${brl(espAld)} | SEM carve-out ${brl(espAldSemCarveOut)}`);
  checa("os dois lados sao DIFERENTES", !perto(espAld, espAldSemCarveOut), `delta ${brl(espAld - espAldSemCarveOut)}`);
  checa("(C+E+F) Aldalene == 3,34%x65,86% + 2,03%xdefault + 6,00%xescala", perto(full.ald?.production_commission_value, espAld), `${brl(full.ald?.production_commission_value)} vs ${brl(espAld)}`);
  checa("e NAO o valor sem carve-out (o bug antigo)", !perto(full.ald?.production_commission_value, espAldSemCarveOut), `sem carve-out daria ${brl(espAldSemCarveOut)}`);

  // D) individualidade — a outra pessoa na MESMA taxa
  const espOutra = pfInss * s;
  checa("(D) OUTRA pessoa a 3,34% recebe o acordo dela", perto(full.outra?.production_commission_value, espOutra), `${brl(full.outra?.production_commission_value)} vs ${brl(espOutra)}`);
  checa("(D) e NAO os 65,86% do carve-out", !perto(full.outra?.production_commission_value, pfInss * ALDALENE_INSS_FIXED_SHARE), `65,86% daria ${brl(pfInss * ALDALENE_INSS_FIXED_SHARE)}`);

  // E) isolado: Aldalene so com o contrato a 2,03%
  const soBaixo = await rodar([ALD_BAIXO], { comEscala: false });
  checa("(E) Aldalene a 2,03% (o 220180918) NAO pega o carve-out", perto(soBaixo.ald?.production_commission_value, pfBaixo * s) && !perto(soBaixo.ald?.production_commission_value, pfBaixo * ALDALENE_INSS_FIXED_SHARE), `${brl(soBaixo.ald?.production_commission_value)} vs default ${brl(pfBaixo * s)}`);

  // F) isolado: Aldalene so com o contrato de faixa
  const soFaixa = await rodar([ALD_FAIXA]);
  checa("(F) Aldalene a 6,00% pega a ESCALA, nao o carve-out", perto(soFaixa.ald?.production_commission_value, baseFaixa * ESCALA_BASE) && !perto(soFaixa.ald?.production_commission_value, baseFaixa * ALDALENE_INSS_FIXED_SHARE), `${brl(soFaixa.ald?.production_commission_value)} vs escala ${brl(baseFaixa * ESCALA_BASE)}`);

  // -- G) unidade -------------------------------------------------------------
  console.log("\n== G) isAldaleneInssCarveOut — nome, taxa, borda e guardas");
  checa("Aldalene + 3,34% -> true", isAldaleneInssCarveOut({ promoterName: "ALDALENE DE FREITAS ABRAÃO", aVistaPercentDecimal: 0.0334 }));
  checa("nome com acento/caixa diferente ainda casa", isAldaleneInssCarveOut({ promoterName: "aldalene de freitas abraão", aVistaPercentDecimal: 0.0334 }));
  checa("OUTRA pessoa + 3,34% -> false (individual)", !isAldaleneInssCarveOut({ promoterName: "MONALISA MARIA DA SILVA", aVistaPercentDecimal: 0.0334 }));
  checa("Aldalene + 2,03% -> false", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: 0.0203 }));
  checa("Aldalene + 3,35% -> false (nao arredonda para a vizinha)", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: 0.0335 }));
  checa("Aldalene + 3,33% -> false", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: 0.0333 }));
  checa("nome nulo -> false", !isAldaleneInssCarveOut({ promoterName: null, aVistaPercentDecimal: 0.0334 }));
  checa("taxa nula -> false", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: null }));
  checa("taxa NaN -> false", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: Number.NaN }));
  checa("3,34% em PERCENTUAL (3.34) NAO casa — a funcao quer DECIMAL", !isAldaleneInssCarveOut({ promoterName: "ALDALENE", aVistaPercentDecimal: 3.34 }));

  checa("dryRun nao gravou nada", full.upserts === 0, `${full.upserts} upserts`);

  console.log("");
  if (falhas.length) {
    console.log(`REPROVADO — ${falhas.length} prova(s) falharam:`);
    for (const f of falhas) console.log(`  - ${f}`);
    process.exit(2);
  }
  console.log("APROVADO — o carve-out dispara pela TAXA, so na Aldalene, e so na taxa dele.");
})().catch((e) => {
  console.error("ERRO no gate:", e?.stack || e?.message || e);
  process.exit(2);
});
