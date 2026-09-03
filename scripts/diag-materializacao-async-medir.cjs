/* READ-ONLY. A medicao da frente da materializacao assincrona.
 *
 * QUANDO RODAR: antes de aplicar a migration 20260903_000002 (para ter a foto do
 * "antes") e depois (as secoes 4 e 5 passam a responder).
 *
 * O QUE ELE MEDE
 * --------------
 *  1. o catalogo de RPCs expostas ao service_role (OpenAPI do PostgREST);
 *  2. QUAIS SCHEMAS o PostgREST expoe — com CONTROLE NEGATIVO. Esta secao existe
 *     porque a pergunta "pg_cron existe?" NAO se responde daqui: o schema `cron`
 *     nao e exposto, e a mensagem de erro e IDENTICA a de um schema inventado.
 *     Sem o controle, "nao achei" viraria "nao existe" — o mesmo falso negativo
 *     do probe de RPC por assinatura. Medir pg_cron exigiu o Studio
 *     (`select extname from pg_extension`: vazio; pg_available_extensions:
 *     pg_cron 1.6.4 disponivel) e, depois da migration, a secao 5.
 *  3. o censo do estado (producao_contrato / carteira_contrato / previsao_snapshot);
 *  4. a FILA (depois da migration);
 *  5. o AGENDADOR, pela unica janela que existe de fora: fn_diag_materializacao_cron.
 *
 * Nao escreve nada.
 */
require("./_ts_register.cjs");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path, extraHeaders = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: { ...H, ...extraHeaders } });
  const txt = await res.text();
  let body;
  try {
    body = JSON.parse(txt);
  } catch {
    body = txt;
  }
  return { status: res.status, body };
}

async function count(table, qs = "") {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*${qs}`, {
    headers: { ...H, Prefer: "count=exact", Range: "0-0" },
  });
  const cr = res.headers.get("content-range");
  return {
    status: res.status,
    total: cr ? cr.split("/")[1] : null,
    txt: res.ok ? null : await res.text(),
  };
}

async function main() {
  console.log("=".repeat(70));
  console.log("1) RPCs expostas (OpenAPI)");
  console.log("=".repeat(70));
  const spec = await rest("", { Accept: "application/openapi+json" });
  if (spec.status !== 200) {
    console.log("HTTP", spec.status, spec.body);
  } else {
    const rpcs = Object.keys(spec.body.paths || {})
      .filter((p) => p.startsWith("/rpc/"))
      .sort();
    console.log(`total=${rpcs.length}`);
    for (const r of rpcs) console.log("  " + r.replace("/rpc/", ""));
  }

  console.log("\n" + "=".repeat(70));
  console.log("2) schemas expostos pelo PostgREST — COM CONTROLE NEGATIVO");
  console.log("=".repeat(70));
  const prof = await rest("job?select=jobid,jobname,schedule,active&limit=5", {
    "Accept-Profile": "cron",
  });
  console.log("schema cron        HTTP", prof.status, JSON.stringify(prof.body).slice(0, 400));
  const prof2 = await rest("job?select=*&limit=1", { "Accept-Profile": "__schema_inexistente__" });
  console.log("schema inventado   HTTP", prof2.status, JSON.stringify(prof2.body).slice(0, 400));
  console.log(
    "LEITURA: respostas iguais => este probe NAO distingue 'pg_cron ausente' de " +
      "'schema nao exposto'. Quem responde e a secao 5."
  );

  console.log("\n" + "=".repeat(70));
  console.log("3) censo do estado");
  console.log("=".repeat(70));
  for (const t of [
    "producao_contrato",
    "carteira_contrato",
    "previsao_snapshot",
    "import_pos_diag",
  ]) {
    const c = await count(t);
    console.log(`${t}: HTTP ${c.status} total=${c.total} ${c.txt || ""}`);
  }
  for (const t of ["producao_contrato", "carteira_contrato"]) {
    const r = await rest(`${t}?select=competencia,created_at&order=competencia.desc&limit=1`);
    const r2 = await rest(`${t}?select=created_at&order=created_at.desc&limit=1`);
    const r3 = await rest(`${t}?select=created_at&order=created_at.asc&limit=1`);
    console.log(
      `${t}: max competencia = ${JSON.stringify(r.body)} | created_at max/min = ` +
        `${JSON.stringify(r2.body)} ${JSON.stringify(r3.body)}`
    );
  }

  // Vintages. A coluna e competencia_snapshot (NAO competencia_vintage — errei o
  // nome na 1a versao deste script, e foi o 42703 que me corrigiu).
  const vint = await rest(
    "previsao_snapshot?select=competencia_snapshot,competencia_alvo,previsto_diferido" +
      "&order=competencia_alvo.asc"
  );
  if (Array.isArray(vint.body)) {
    const porVintage = {};
    for (const r of vint.body) {
      const k = r.competencia_snapshot;
      porVintage[k] = porVintage[k] || { n: 0, difNull: 0, alvos: [] };
      porVintage[k].n += 1;
      if (r.previsto_diferido === null) porVintage[k].difNull += 1;
      porVintage[k].alvos.push(r.competencia_alvo);
    }
    const chaves = Object.keys(porVintage);
    if (chaves.length === 0) console.log("previsao_snapshot: VAZIA");
    for (const k of chaves) {
      const v = porVintage[k];
      console.log(
        `vintage ${k}: ${v.n} linhas | alvos ${v.alvos[0]}..${v.alvos[v.alvos.length - 1]} ` +
          `| previsto_diferido NULL = ${v.difNull}`
      );
    }
  } else {
    console.log("previsao_snapshot:", JSON.stringify(vint.body).slice(0, 300));
  }

  for (const par of [
    [2026, 6],
    [2026, 7],
    [2026, 8],
  ]) {
    const y = par[0];
    const m = par[1];
    const c = await count(
      "monthly_closing_entries",
      `&entry_type=eq.PRT&year=eq.${y}&month=eq.${m}`
    );
    const p = await count(
      "producao_contrato",
      `&competencia=eq.${y}-${String(m).padStart(2, "0")}&entry_type=eq.PRT`
    );
    console.log(
      `  ${y}-${String(m).padStart(2, "0")}: entries PRT=${c.total} | producao_contrato=${p.total}`
    );
  }

  const diag = await rest(
    "import_pos_diag?select=criado_em,origem,year,month,houve_falha,falharam,ms_total" +
      "&order=criado_em.desc&limit=6"
  );
  console.log("\nimport_pos_diag (ultimos):", JSON.stringify(diag.body).slice(0, 1200));

  console.log("\n" + "=".repeat(70));
  console.log("4) a FILA (depois da migration 20260903_000002)");
  console.log("=".repeat(70));
  const fila = await rest(
    "materializacao_fila?select=criado_em,origem,year,month,status,ms,congelamento_pendente," +
      "linhas_producao,linhas_carteira,carteira_competencia_max,erro&order=criado_em.desc&limit=15"
  );
  if (fila.status >= 400) {
    console.log("materializacao_fila: HTTP", fila.status, JSON.stringify(fila.body).slice(0, 300));
    console.log("  -> migration 20260903_000002 ainda NAO aplicada no Studio.");
  } else {
    console.log(JSON.stringify(fila.body, null, 1).slice(0, 2500));
  }

  console.log("\n" + "=".repeat(70));
  console.log("5) o AGENDADOR — a unica janela sobre `cron` que existe de fora");
  console.log("=".repeat(70));
  const cron = await fetch(`${URL}/rest/v1/rpc/fn_diag_materializacao_cron`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: "{}",
  });
  const cronTxt = await cron.text();
  console.log("fn_diag_materializacao_cron: HTTP", cron.status);
  try {
    console.log(JSON.stringify(JSON.parse(cronTxt), null, 1).slice(0, 3000));
  } catch {
    console.log(cronTxt.slice(0, 600));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
