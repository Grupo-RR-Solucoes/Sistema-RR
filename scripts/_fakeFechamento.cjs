/*
 * BANCO ESPELHO de monthly_closing_entries + fechamento_mensal_empresa +
 * monthly_closing_imports, para exercitar o CAMINHO REAL da rota de cancelamento
 * sem escrever uma linha em producao.
 *
 * POR QUE NAO REUSEI scripts/_fakeDpr.cjs. Quatro razoes estruturais, nao de
 * gosto — todas verificaveis no arquivo:
 *   1. `applyWrite` (_fakeDpr.cjs:71) so materializa escrita quando
 *      `table === "daily_production_records"`. Qualquer outra tabela cai no
 *      `writes.push(res)` e volta `{data:null,error:null}`: a escrita e
 *      DESCARTADA. Sem estado, nao ha "depois" para medir.
 *   2. A chave e `company_id::proposal_number` (_fakeDpr.cjs:25-27).
 *      monthly_closing_entries NAO tem `proposal_number` (as colunas sao
 *      contract_number / operation_number, e a identidade e o `id`): todas as
 *      linhas colidiriam em "undefined::undefined".
 *   3. DELETE nao e implementado. "delete" esta em WRITE_OPS (:23) mas
 *      `applyWrite` so trata upsert/insert — o delete e contabilizado e
 *      IGNORADO. O mecanismo do BLOCO 2 E um delete; um espelho que ignora
 *      delete nao pode prova-lo.
 *   4. `serveFromStore` so e usada quando a query tem `.in(...)`
 *      (_fakeDpr.cjs:96); as leituras aqui sao `.eq(...).maybeSingle()`.
 *
 * A PROPRIEDADE DE SEGURANCA: operacao NAO MODELADA joga (throw), nunca devolve
 * sucesso silencioso. Um espelho que engole o que nao entende mente — e mentiria
 * exatamente na direcao de "passou". Toda operacao servida daqui esta na lista
 * branca abaixo.
 *
 * Tabelas NAO espelhadas: SELECT e delegado ao cliente REAL; escrita e recusada
 * com throw (nada de producao e tocado).
 */
const ESPELHADAS = new Set([
  "monthly_closing_entries",
  "fechamento_mensal_empresa",
  "monthly_closing_imports",
  // audit_logs entrou em 29/08/2026: e onde nasce a MEMORIA da troca de dono de
  // debito (registrarTrocaDeDono). Sem espelha-la, a escrita cairia no ramo
  // "nao espelhada" e seria descartada — e o gate nao teria o que medir.
  "audit_logs",
]);
const WRITE_OPS = new Set(["insert", "upsert", "update", "delete"]);
// Operacoes de forma/terminadoras que o espelho sabe interpretar.
const CONHECIDAS = new Set([
  "select", "eq", "neq", "in", "or", "order", "range", "limit", "maybeSingle", "single",
  "gte", "gt", "lte", "lt", "is", "not",
  "insert", "upsert", "update", "delete",
]);

let SEQ = 0;
const novoId = () => `fake-${String(++SEQ).padStart(8, "0")}`;

/*
 * TRACE — a contagem de monthly_closing_entries DEPOIS de cada escrita nela.
 * E o observador que prova a invariante do B1: em nenhum instante o import pode
 * deixar a competencia com ZERO detalhe legado tendo comecado com detalhe.
 */
function trace(store, table, op, antes, depois) {
  if (table !== "monthly_closing_entries") return;
  const t = store.get("__trace") || [];
  t.push({ op, antes, depois });
  store.set("__trace", t);
}

function casa(row, ops) {
  for (const o of ops) {
    if (o.name === "eq") {
      if (String(row[o.args[0]]) !== String(o.args[1])) return false;
    } else if (o.name === "neq") {
      if (String(row[o.args[0]]) === String(o.args[1])) return false;
    } else if (o.name === "gte") {
      if (!(row[o.args[0]] >= o.args[1])) return false;
    } else if (o.name === "gt") {
      if (!(row[o.args[0]] > o.args[1])) return false;
    } else if (o.name === "lte") {
      if (!(row[o.args[0]] <= o.args[1])) return false;
    } else if (o.name === "lt") {
      if (!(row[o.args[0]] < o.args[1])) return false;
    } else if (o.name === "is") {
      const alvo = o.args[1];
      if (alvo === null) { if (row[o.args[0]] != null) return false; }
      else if (String(row[o.args[0]]) !== String(alvo)) return false;
    } else if (o.name === "not") {
      // .not(coluna, "is", null) e .not(coluna, "in", "(A,B)")
      const [col, op2, val] = o.args;
      if (op2 === "is" && val === null) { if (row[col] == null) return false; }
      else if (op2 === "in") {
        const set = new Set(String(val).replace(/^\(|\)$/g, "").split(",").map((x) => x.trim()));
        if (set.has(String(row[col]))) return false;
      } else throw new Error(`[espelho] .not(${col}, ${op2}, ...) NAO MODELADO`);
    } else if (o.name === "in") {
      const set = new Set((o.args[1] || []).map(String));
      if (!set.has(String(row[o.args[0]]))) return false;
    } else if (o.name === "or") {
      if (!casaOr(row, String(o.args[0]))) return false;
    }
  }
  return true;
}

/*
 * O UNICO `.or()` do caminho e o de monthlyClosingImport.ts:1578:
 *   "entry_type.is.null,entry_type.not.in.(BBCAP,CONTA_CORRENTE,CONSORCIO)"
 * Interpretado literalmente (OR dos dois termos). Forma diferente => throw.
 */
function casaOr(row, expr) {
  const termos = expr.split(",").reduce((acc, pedaco) => {
    // "not.in.(A,B,C)" quebra na virgula: recola enquanto os parenteses estao abertos.
    const ult = acc[acc.length - 1];
    if (ult && (ult.match(/\(/g) || []).length > (ult.match(/\)/g) || []).length) {
      acc[acc.length - 1] = `${ult},${pedaco}`;
    } else acc.push(pedaco);
    return acc;
  }, []);
  let algum = false;
  for (const t of termos) {
    let m;
    if ((m = t.match(/^([a-z_]+)\.is\.null$/))) {
      if (row[m[1]] == null) algum = true;
    } else if ((m = t.match(/^([a-z_]+)\.not\.in\.\((.+)\)$/))) {
      const set = new Set(m[2].split(",").map((s) => s.trim()));
      if (!set.has(String(row[m[1]]))) algum = true;
    } else {
      throw new Error(`[espelho] termo .or() NAO MODELADO: ${t}`);
    }
  }
  return algum;
}

function chaveFme(row) {
  return `${row.empresa_cnpj}|${row.ano}|${row.mes}`;
}

async function run(real, store, table, ops) {
  for (const o of ops) {
    if (!CONHECIDAS.has(o.name)) {
      throw new Error(`[espelho] operacao NAO MODELADA '${o.name}' em ${table}`);
    }
  }
  const escrita = ops.find((o) => WRITE_OPS.has(o.name));

  if (!ESPELHADAS.has(table)) {
    if (escrita) {
      // Nao espelhada + escrita: nunca vai ao banco real, e nao finge sucesso mudo.
      return { data: null, error: null, __ignorada: true };
    }
    let q = real.from(table);
    for (const o of ops) q = q[o.name](...o.args);
    return await q;
  }

  const linhas = store.get(table);

  if (!escrita) {
    let rows = linhas.filter((r) => casa(r, ops));
    const rng = ops.find((o) => o.name === "range");
    if (rng) rows = rows.slice(rng.args[0], rng.args[1] + 1);
    const lim = ops.find((o) => o.name === "limit");
    if (lim) rows = rows.slice(0, lim.args[0]);
    const um = ops.some((o) => o.name === "maybeSingle" || o.name === "single");
    return {
      data: um ? (rows.length ? { ...rows[0] } : null) : rows.map((r) => ({ ...r })),
      error: null,
      count: rows.length,
    };
  }

  if (escrita.name === "delete") {
    const antes = linhas.length;
    const restam = linhas.filter((r) => !casa(r, ops));
    store.set(table, restam);
    trace(store, table, "delete", antes, restam.length);
    return { data: null, error: null, count: antes - restam.length };
  }

  if (escrita.name === "update") {
    const patch = escrita.args[0];
    let n = 0;
    for (const r of linhas) {
      if (!casa(r, ops)) continue;
      Object.assign(r, patch);
      n += 1;
    }
    return { data: null, error: null, count: n };
  }

  const carga = Array.isArray(escrita.args[0]) ? escrita.args[0] : [escrita.args[0]];
  if (escrita.name === "insert") {
    const antesN = linhas.length;
    for (const row of carga) linhas.push({ id: row.id ?? novoId(), ...row });
    trace(store, table, "insert", antesN, linhas.length);
    const um = ops.some((o) => o.name === "single" || o.name === "maybeSingle");
    return { data: um ? { ...linhas[linhas.length - 1] } : null, error: null };
  }
  // upsert — o unico do caminho e o de fechamento_mensal_empresa
  // (onConflict "empresa_cnpj,ano,mes"): ON CONFLICT DO UPDATE das colunas da carga.
  const conf = escrita.args[1] && escrita.args[1].onConflict;
  if (table !== "fechamento_mensal_empresa" || conf !== "empresa_cnpj,ano,mes") {
    throw new Error(`[espelho] upsert NAO MODELADO em ${table} (onConflict=${conf})`);
  }
  for (const row of carga) {
    const k = chaveFme(row);
    const ja = linhas.find((r) => chaveFme(r) === k);
    if (ja) Object.assign(ja, row);
    else linhas.push({ id: novoId(), ...row });
  }
  return { data: null, error: null };
}

function builder(real, store, table, ops) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve, reject) => run(real, store, table, ops).then(resolve, reject);
        }
        if (typeof prop === "symbol") return undefined;
        return (...args) => builder(real, store, table, [...ops, { name: String(prop), args }]);
      },
    }
  );
}

/**
 * @param real     cliente supabase REAL (so para SELECT das tabelas nao espelhadas)
 * @param semente  { monthly_closing_entries: [...], fechamento_mensal_empresa: [...],
 *                   monthly_closing_imports: [...] } — linhas lidas de producao
 */
function createFakeFechamento(real, semente) {
  const store = new Map();
  for (const t of ESPELHADAS) store.set(t, (semente[t] || []).map((r) => ({ ...r })));
  return {
    from: (table) => builder(real, store, table, []),
    rpc: async () => ({ data: null, error: null }),
    _rows: (t) => store.get(t),
    _store: store,
  };
}

module.exports = { createFakeFechamento };
