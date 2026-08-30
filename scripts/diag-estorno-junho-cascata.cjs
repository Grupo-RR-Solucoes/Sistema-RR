/* Cascata do estorno de junho — READ-ONLY, nada e escrito.
 *
 * Percorre, para CADA operacao da fila, os mesmos degraus que
 * resolveAdsCancelDebits (lib/debitInsuranceResolver.ts:810-835) percorre, na
 * MESMA ordem, e diz onde ela para:
 *   1. fila manual com status ASSIGNED
 *   2. daily_production_records.assigned_promoter_id
 *   3. cms_promoter_entries.promoter_id
 *   4. chave J, e SO se key_type = INDIVIDUAL (MASTER nao resolve)
 *   -> senao: fila
 *
 * E acrescenta o degrau da REGRA DE 30/08 que o codigo ainda NAO tem:
 *   4b. se a chave e MASTER, para quem a producao daquela chave MIGROU na
 *       competencia. Usa o helper que ja existe (herancaMaster.buildDonoDoDiarioMap),
 *       nao reimplementa.
 * E o criterio de corte de 28/08: o estado do promotor na data em que o DEBITO
 * CHEGA, nao na data do cancelamento.
 */
require("./_ts_register.cjs");
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const f = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ADS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const L = (c) => c.repeat(94);

(async () => {
  const { buildDonoDoDiarioMap } = require("../lib/herancaMaster.ts");

  const { data: fila } = await sb
    .from("promoter_debit_assignments")
    .select("year, month, operation, estorno_amount, source_kind, status, promoter_id, chave_j, created_at")
    .eq("debit_type", "CANCELAMENTO_SEGURO")
    .order("year").order("month");
  const ads = (fila || []).filter((a) => a.source_kind === "DAILY_CANCEL");
  const ops = ads.map((a) => String(a.operation));

  const { data: proms } = await sb.from("promoters").select("id, name, active, dismissed_at");
  const promById = new Map((proms || []).map((p) => [p.id, p]));
  const { data: jkeys } = await sb.from("j_keys").select("j_key, promoter_id, key_type");
  const jkMap = new Map((jkeys || []).map((k) => [String(k.j_key).toUpperCase(), k]));

  const { data: daily } = await sb
    .from("daily_production_records")
    .select("id, proposal_number, company_id, j_key, assigned_promoter_id, movement_date, gross_value")
    .in("proposal_number", ops);
  const dailyByOp = new Map();
  for (const d of daily || []) if (!dailyByOp.has(String(d.proposal_number))) dailyByOp.set(String(d.proposal_number), d);

  const { data: cms } = await sb
    .from("cms_promoter_entries")
    .select("contract_number, j_key, promoter_id")
    .in("contract_number", ops);
  const cmsByOp = new Map();
  for (const c of cms || []) if (!cmsByOp.has(String(c.contract_number))) cmsByOp.set(String(c.contract_number), c);

  console.log(L("="));
  console.log("CASCATA, operacao a operacao — onde cada uma PARA");
  console.log(L("="));

  const degraus = new Map();
  for (const a of ads) {
    const op = String(a.operation);
    const comp = `${a.year}-${String(a.month).padStart(2, "0")}`;
    console.log(`\n--- op ${op}  ${f(a.estorno_amount)}  competencia ${comp}  (na fila desde ${String(a.created_at).slice(0, 10)}) ---`);

    // degrau 1
    console.log(`  1. fila manual ASSIGNED? .......... ${a.status === "ASSIGNED" && a.promoter_id ? "SIM -> " + (promById.get(a.promoter_id) || {}).name : `nao (status=${a.status}, promoter_id=${a.promoter_id || "null"})`}`);
    // degrau 2
    const d = dailyByOp.get(op);
    console.log(`  2. linha em daily_production_records? ${d ? "SIM" : "NAO"}`);
    if (d) {
      console.log(`       company=${d.company_id === ADS ? "ADS" : d.company_id}  movement=${String(d.movement_date || "-").slice(0, 10)}  gross=${f(d.gross_value)}`);
      console.log(`       assigned_promoter_id: ${d.assigned_promoter_id ? (promById.get(d.assigned_promoter_id) || {}).name : "NULL"}`);
    }
    // degrau 3
    const c = cmsByOp.get(op);
    console.log(`  3. linha em cms_promoter_entries? .. ${c ? "SIM" : "NAO"}`);
    if (c) console.log(`       promoter_id: ${c.promoter_id ? (promById.get(c.promoter_id) || {}).name : "NULL"}   j_key=${c.j_key || "-"}`);
    // degrau 4
    const cj = (d && d.j_key) || (c && c.j_key) || a.chave_j || null;
    const info = cj ? jkMap.get(String(cj).toUpperCase()) : undefined;
    console.log(`  4. chave J: ${cj || "(nenhuma)"} ${info ? `-> key_type=${info.key_type}  dono=${(promById.get(info.promoter_id) || {}).name || "(sem promotor)"}` : "-> (chave nao cadastrada)"}`);

    let dono = null, via = null;
    if (a.status === "ASSIGNED" && a.promoter_id) { dono = a.promoter_id; via = "fila-atribuida"; }
    else if (d && d.assigned_promoter_id) { dono = d.assigned_promoter_id; via = "daily"; }
    else if (c && c.promoter_id) { dono = c.promoter_id; via = "cms"; }
    else if (info && info.key_type === "INDIVIDUAL" && info.promoter_id) { dono = info.promoter_id; via = "chave-J-individual"; }

    // degrau 4b — a REGRA DE 30/08, que o codigo AINDA NAO TEM
    let heranca = null;
    if (!dono && info && info.key_type === "MASTER") {
      const mapa = await buildDonoDoDiarioMap(sb, [{ contrato: op, companyId: ADS }], a.year, a.month);
      heranca = mapa.get(`${ADS}|${op}`) || null;
      console.log(`  4b. MASTER -> heranca por contrato (buildDonoDoDiarioMap): ${heranca ? (promById.get(heranca) || {}).name : "NAO RESOLVE (sem linha de diario na competencia)"}`);
      if (heranca) { dono = heranca; via = "heranca-master"; }
    } else if (info && info.key_type === "MASTER") {
      console.log("  4b. MASTER, mas ja resolvido num degrau anterior");
    }

    const p = dono ? promById.get(dono) : null;
    console.log(`  => PARA EM: ${via || "FILA (nenhum degrau resolveu)"}`);
    if (p) console.log(`     promotor: ${p.name}  active=${p.active}  dismissed_at=${p.dismissed_at || "null"}`);

    let classe;
    if (!dono) classe = info && info.key_type === "MASTER" ? "DADO FALTANDO (master sem heranca)" : "DADO FALTANDO";
    else if (p && (p.active === false || p.dismissed_at)) classe = "EMPRESA (promotor inativo/desligado)";
    else classe = "RESOLVIVEL POR CODIGO";
    console.log(`  CLASSE: ${classe}`);

    const k = via || (info && info.key_type === "MASTER" ? "para-em-MASTER" : "para-em-SEM-DADO");
    degraus.set(k, (degraus.get(k) || 0) + 1);
  }

  console.log("\n" + L("="));
  console.log("ALCANCE — em que degrau as operacoes da fila param");
  console.log(L("="));
  for (const [k, v] of [...degraus].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(28)} ${v} operacao(oes)`);
  console.log(`\n  total de operacoes DAILY_CANCEL na fila (todas as competencias): ${ads.length}`);

  // o degrau MASTER existe no codigo?
  const fs = require("fs");
  const src = fs.readFileSync("lib/debitInsuranceResolver.ts", "utf8");
  const temMaster = /key_type === "MASTER"|buildDonoDoDiarioMap|heranca/i.test(src);
  console.log(`\n  o resolvedor implementa o degrau MASTER? ${temMaster ? "SIM" : "NAO"}`);
  console.log(`  (grep buildDonoDoDiarioMap em debitInsuranceResolver.ts: ${(src.match(/buildDonoDoDiarioMap/g) || []).length} ocorrencia(s))`);
  console.log(`  (o codigo so tem: ${/info.key_type === "INDIVIDUAL"/.test(src) ? "'INDIVIDUAL resolve, MASTER nao'" : "?"})`);
})().catch((e) => { console.error("ERRO:", e.message || e); process.exit(1); });
