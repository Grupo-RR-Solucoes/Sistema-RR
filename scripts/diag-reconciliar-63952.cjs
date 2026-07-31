/*
 * =====================================================================
 * DIAG 31/07/2026 — METODO QUE FALHOU. GUARDADO COMO AVISO, NAO COMO
 * FERRAMENTA. NAO reconcilie por soma de subconjunto em universo grande.
 * =====================================================================
 *
 * O QUE MEDE: tenta identificar QUAIS 4 linhas formavam os R$ 63.952,12 em 4
 * "nao atribuidas" que a /projecao exibia em 30/07/2026 11h19, procurando uma
 * combinacao de 4 valores que some o alvo. READ-ONLY.
 *
 * POR QUE FALHOU (resultado real de 31/07/2026):
 *   - universo de busca = 680 candidatos elegiveis;
 *   - C(680,4) ~ 8,9 BILHOES de combinacoes, entao qualquer alvo naquela faixa
 *     tem muitos subconjuntos que o somam;
 *   - a busca achou 691 combinacoes dentro da tolerancia de 0,02, sendo 9
 *     exatas ao centavo;
 *   - NENHUMA delas era a correta.
 *   O metodo nao identifica nada: a quantidade de solucoes e ruido aritmetico.
 *
 * DE ONDE VEIO A RESPOSTA: da TRILHA DE AUDITORIA, nao da aritmetica —
 * proposal_reassignments com from_promoter_id NULL (= "estava nao atribuida").
 * Ver scripts/diag-hist-atribuicao.cjs e diag-hist-atribuicao2.cjs. As 4 sairam
 * de NULL em 30/07/2026 17h47-17h49, na mesma tarde do print.
 *
 * LICAO: com universo grande, procure a trilha de auditoria PRIMEIRO. Um numero
 * nao reconciliado registrado como nao reconciliado vale mais que uma teoria
 * sustentada por uma entre 691 coincidencias.
 *
 * ---- contexto original da execucao (hipotese que estava sendo testada) ----
 * Hipotese (Diego): as 4 foram absorvidas pelo lote de atribuicao automatica de
 * 2026-07-31 12:01:39. FALSA — as 4 saidas de NULL daquele dia somam 40.521,15 e
 * tem movement_date 2026-07-30, producao que nem existia na hora do print.
 *
 * Universo de busca (fechado, sem ampliar):
 *   updated_at em [2026-07-31T12:00:00, 2026-07-31T12:05:00]
 *   movement_date <= 2026-07-29   (o que ja existia no banco ontem)
 *   elegivel: status Producao/Production E is_srcc_restricted != true
 * Alvo: combinacao de 4 linhas somando 63.952,12 (tolerancia 0,02).
 *
 * Busca exaustiva por meet-in-the-middle (todas as somas de PARES em hash, depois
 * par x par disjunto) — cobre C(n,4) inteiro sem o custo do laco quadruplo.
 * Reporta TODAS as solucoes: se houver muitas, a "reconciliacao" e coincidencia
 * aritmetica e nao vale como prova.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const brl = (n) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DE = "2026-07-31T12:00:00";
const ATE = "2026-07-31T12:05:00";
const MOV_MAX = "2026-07-29";
const ALVO_CENTS = 6395212;
const TOL_CENTS = 2;

const elegivel = (r) => {
  const s = String(r.status ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  return (s === "PRODUCAO" || s === "PRODUCTION") && r.is_srcc_restricted !== true;
};

async function todas(tabela, colunas) {
  const out = [];
  for (let p = 0; ; p++) {
    const { data, error } = await sb.from(tabela).select(colunas).range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  const rows = await todas(
    "daily_production_records",
    "id, proposal_number, assigned_promoter_id, promoter_source, status, is_srcc_restricted, net_value, movement_date, updated_at"
  );

  const naJanela = rows.filter((r) => {
    const u = String(r.updated_at ?? "");
    return u >= DE && u <= ATE;
  });
  const candidatos = naJanela
    .filter((r) => String(r.movement_date ?? "") <= MOV_MAX && String(r.movement_date ?? "") !== "")
    .filter(elegivel)
    .map((r) => ({ ...r, cents: Math.round(Number(r.net_value ?? 0) * 100) }))
    .filter((r) => r.cents > 0);

  console.log(`janela ${DE} .. ${ATE}`);
  console.log(`  linhas na janela de horario      : ${naJanela.length}`);
  console.log(`  + movement_date <= ${MOV_MAX}    : ${naJanela.filter((r) => String(r.movement_date ?? "") <= MOV_MAX && r.movement_date).length}`);
  console.log(`  + elegivel (Producao, nao SRCC)  : ${candidatos.length}  <- universo da busca`);
  const porSource = new Map();
  for (const r of candidatos) porSource.set(r.promoter_source ?? "-", (porSource.get(r.promoter_source ?? "-") ?? 0) + 1);
  console.log(`  promoter_source dos candidatos   : ${[...porSource].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  alvo                             : ${brl(ALVO_CENTS / 100)} em 4 linhas (tolerancia 0,02)\n`);

  // meet-in-the-middle: soma de todos os pares -> depois par complementar disjunto
  const n = candidatos.length;
  const paresPorSoma = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = candidatos[i].cents + candidatos[j].cents;
      let arr = paresPorSoma.get(s);
      if (!arr) paresPorSoma.set(s, (arr = []));
      arr.push([i, j]);
    }
  }

  const solucoes = new Set();
  for (const [soma, pares] of paresPorSoma) {
    for (let d = -TOL_CENTS; d <= TOL_CENTS; d++) {
      const comp = ALVO_CENTS - soma + d;
      const outros = paresPorSoma.get(comp);
      if (!outros) continue;
      for (const [a, b] of pares) {
        for (const [c, e] of outros) {
          if (a === c || a === e || b === c || b === e) continue; // disjuntos
          const idx = [a, b, c, e].sort((x, y) => x - y);
          solucoes.add(idx.join(","));
        }
      }
    }
  }

  console.log(`combinacoes de 4 que somam ${brl(ALVO_CENTS / 100)}: ${solucoes.size}\n`);
  if (solucoes.size === 0) {
    console.log("NAO ENCONTRADO");
    return;
  }
  let k = 0;
  for (const s of solucoes) {
    const idx = s.split(",").map(Number);
    const linhas = idx.map((i) => candidatos[i]);
    const soma = linhas.reduce((a, r) => a + r.cents, 0);
    console.log(`--- solucao ${++k} (soma ${brl(soma / 100)}) ---`);
    for (const r of linhas) {
      console.log(
        `    prop ${String(r.proposal_number ?? "-").padEnd(12)} | ${brl(r.net_value).padStart(12)} | mov ${r.movement_date} | src=${r.promoter_source ?? "-"} | upd ${String(r.updated_at).slice(11, 19)}`
      );
    }
    if (k >= 20) {
      console.log(`  ... (${solucoes.size - k} solucao(oes) restante(s) nao exibida(s))`);
      break;
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
