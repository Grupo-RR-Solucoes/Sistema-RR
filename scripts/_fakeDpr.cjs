/*
 * BANCO ESPELHO de daily_production_records, para exercitar o CAMINHO REAL do
 * import sem escrever uma linha em producao.
 *
 * POR QUE ISTO EXISTE. Provar que o import so-credito APAGA o seguro exige rodar
 * importBbtsClosing com dryRun=false — e dryRun=false grava. A alternativa
 * honesta e trocar SO o destino da escrita: as linhas de daily_production_records
 * sao SEMEADAS com os valores REAIS de producao (SELECT), o import roda inteiro
 * (mesmo extrator, mesmo merge, mesmo owner FULL), e o "depois" e lido do
 * espelho. Nada de producao e tocado.
 *
 * O QUE E FIEL AO POSTGREST: o merge grava por `.upsert(payload_parcial,
 * {onConflict:"company_id,proposal_number"})`, que vira ON CONFLICT DO UPDATE SET
 * so das colunas PRESENTES no payload. O espelho faz exatamente isso
 * (Object.assign da carga sobre a linha existente) — e por isso omitir uma chave
 * e literalmente "nao tocar".
 *
 * O QUE NAO E ESPELHADO: qualquer outra tabela. Leitura (select) e DELEGADA ao
 * cliente real (j_keys, bbts_rule_versions, o corpus de vocabulario); escrita e
 * capturada e devolvida como sucesso, sem ir ao banco.
 */
const WRITE_OPS = new Set(["insert", "upsert", "update", "delete"]);

function keyOf(row) {
  return `${row.company_id}::${row.proposal_number}`;
}

function makeBuilder(real, store, table, writes, ops) {
  const push = (name) => (...args) => makeBuilder(real, store, table, writes, [...ops, { name, args }]);
  const handler = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve, reject) => run(real, store, table, writes, ops).then(resolve, reject);
      }
      if (typeof prop === "symbol") return undefined;
      return push(String(prop));
    },
  };
  return new Proxy({}, handler);
}

async function replayOnReal(real, table, ops) {
  let q = real.from(table);
  for (const op of ops) q = q[op.name](...op.args);
  return await q;
}

function serveFromStore(store, ops) {
  const eqs = ops.filter((o) => o.name === "eq");
  const ins = ops.filter((o) => o.name === "in");
  let rows = [...store.values()];
  for (const o of eqs) rows = rows.filter((r) => String(r[o.args[0]]) === String(o.args[1]));
  for (const o of ins) {
    const set = new Set((o.args[1] || []).map(String));
    rows = rows.filter((r) => set.has(String(r[o.args[0]])));
  }
  return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
}

function applyWrite(store, writes, table, op) {
  const payload = Array.isArray(op.args[0]) ? op.args[0] : [op.args[0]];
  const res = {
    table,
    op: op.name,
    inserted: 0,
    updated: 0,
    rows: payload.length,
    // as CHAVES da carga sao, literalmente, as colunas que o UPDATE escreve
    keys: payload.length ? Object.keys(payload[0]) : [],
  };
  if (table === "daily_production_records" && (op.name === "upsert" || op.name === "insert")) {
    for (const row of payload) {
      const k = keyOf(row);
      if (store.has(k)) {
        Object.assign(store.get(k), row); // ON CONFLICT DO UPDATE SET das colunas presentes
        res.updated += 1;
      } else {
        store.set(k, { ...row });
        res.inserted += 1;
      }
    }
  }
  writes.push(res);
  return res;
}

async function run(real, store, table, writes, ops) {
  const write = ops.find((o) => WRITE_OPS.has(o.name));
  if (write) {
    applyWrite(store, writes, table, write);
    // .insert(...).select("id").single() do daily_imports
    const single = ops.some((o) => o.name === "single");
    return { data: single ? { id: "00000000-0000-0000-0000-000000000001" } : null, error: null };
  }
  if (table === "daily_production_records" && ops.some((o) => o.name === "in")) {
    return serveFromStore(store, ops);
  }
  return await replayOnReal(real, table, ops);
}

/**
 * @param real cliente supabase REAL (usado so para SELECT das tabelas nao espelhadas)
 * @param seedRows linhas ja lidas de producao que povoam o espelho
 */
function createFakeSupabase(real, seedRows) {
  const store = new Map();
  for (const r of seedRows) store.set(keyOf(r), { ...r });
  const writes = [];
  const client = {
    from: (table) => makeBuilder(real, store, table, writes, []),
    _store: store,
    _writes: writes,
    _get: (company_id, proposal_number) => store.get(`${company_id}::${proposal_number}`),
  };
  return client;
}

module.exports = { createFakeSupabase };
