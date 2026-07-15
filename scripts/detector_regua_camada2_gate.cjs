/*
 * GATE do detector de regua obsoleta — CAMADA 2 (hash de conteudo). NAO toca prod.
 *
 * Ao contrario da Camada 1 (que exercita a funcao classify em JS), a Camada 2 vive
 * no BANCO (compute_rules_fingerprint / detect_rules_stale). Este gate sobe um
 * Postgres EFEMERO (embedded-postgres), aplica a MIGRATION REAL verbatim, semeia
 * dados sinteticos e prova:
 *   G1  serializacao canonica: 3.20 == 3.2 ; \N (null) != '' (texto vazio) != 0.
 *   G2  determinismo: compute_rules_fingerprint 2x na mesma competencia = identico.
 *   G3  discriminacao: competencias diferentes => hashes diferentes.
 *   G4  estados: sem baseline => DESCONHECIDO (nunca verde); apos reconsolidar => OK;
 *       editar uma regua SEM reconsolidar => STALE.
 *   G5  falso positivo: editar a regua de um promotor que NAO esta no PMR daquela
 *       competencia NAO muda o hash (escopo por promotor-no-PMR funcionando).
 *   NO-OP: gravar o fingerprint nao altera o PMR (so escreve pmr_rules_fingerprint).
 *
 * FIX 000002 (cast de enum): o schema efemero agora usa o ENUM REAL
 * share_profile_type em promoter_share_profile.profile_type (igual prod). Prova:
 *   G0  a 000001 SOZINHA reproduz o bug de prod (42883: pmr_fp_txt(enum) nao existe)
 *       ao CHAMAR a RPC — criar a funcao "deu Success", so quebra na execucao.
 *   Depois aplica a 000002 (profile_type::text) e todos os gates passam.
 *
 * Dependencia SO de desenvolvimento (nao vai para producao):
 *   npm i -D embedded-postgres pg
 * Sem ela o gate imprime como instalar e sai com codigo 0 (nao quebra CI que nao a tenha).
 */

let EmbeddedPostgres, PgClient;
try {
  EmbeddedPostgres = require("embedded-postgres").default || require("embedded-postgres");
  PgClient = require("pg").Client;
} catch {
  console.log(
    "[gate camada2] embedded-postgres/pg nao instalados (dev-only).\n" +
      "  Para rodar o gate: npm i -D embedded-postgres pg && node scripts/detector_regua_camada2_gate.cjs"
  );
  process.exit(0);
}

const fs = require("fs");
const os = require("os");
const path = require("path");

const MIG = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260715_000001_pmr_rules_fingerprint_camada2.sql"),
  "utf8"
);
const MIG2 = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260715_000002_fix_rpc_enum_cast.sql"),
  "utf8"
);

const BBTS = "375aea6d-3b9c-4490-87f0-e739e312c8ef";
const RR = "33333333-3333-3333-3333-333333333333";
const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const PX = "99999999-9999-9999-9999-999999999999"; // NAO esta em nenhum PMR

let fails = 0;
function ok(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  ->  " + extra : ""}`);
  if (!cond) fails++;
}

const SCHEMA = `
create role service_role;
-- ENUM REAL de producao (20260518230000_dia45_share_profiles.sql). Sem ele o gate
-- mente: com profile_type TEXT o bug 42883 nao aparece. profile_type e o unico
-- enum entre TODAS as colunas lidas pela RPC (key_type/entry_type/sheet_name = text).
create type share_profile_type as enum ('DEFAULT','CLT_FIXO','ACORDO_FIXO','ENTRANTE_PADRAO','ENTRANTE_CUSTOM','ACORDO_VARIAVEL');
create table promoter_monthly_results(promoter_id uuid, year int, month int, source text, company_id uuid);
create table promoter_share_profile(promoter_id uuid, profile_type share_profile_type, fixed_percent numeric, scale_id uuid, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table promoter_goal_repasse(id uuid default gen_random_uuid(), promoter_id uuid, competencia date, pct_base numeric, pct_meta1 numeric, pct_meta2 numeric, created_at timestamptz default now(), updated_at timestamptz default now());
create table monthly_targets(id uuid default gen_random_uuid(), company_id uuid, promoter_id uuid, year int, month int, meta numeric, meta_1 numeric, meta_2 numeric, created_at timestamptz default now());
create table j_keys(id uuid default gen_random_uuid(), company_id uuid, promoter_id uuid, j_key text, key_type text, active boolean, display_name text, created_at timestamptz default now(), updated_at timestamptz default now());
create table companies(id uuid, name text, group_name text, created_at timestamptz default now());
create table monthly_closing_entries(id uuid default gen_random_uuid(), company_id uuid, year int, month int, sheet_name text, entry_type text, net_value numeric, commission_value numeric, insurance_value numeric, created_at timestamptz default now());
create table daily_production_records(id uuid default gen_random_uuid(), company_id uuid, gross_value numeric, net_value numeric, insurance_value numeric, movement_date date, contract_date date, proposal_date date, created_at timestamptz default now());
`;

const SEED = `
insert into companies(id,name,group_name) values ('${RR}','RR','Grupo RR'), ('${BBTS}','ADS','ADS');
insert into promoter_monthly_results(promoter_id,year,month,source,company_id) values
 ('${P1}',2026,6,'fechamento','${RR}'),('${P2}',2026,6,'bbts','${BBTS}'),('${P1}',2026,4,'fechamento','${RR}');
insert into promoter_share_profile(promoter_id,profile_type,fixed_percent) values
 ('${P1}','ACORDO_FIXO',0.1666),('${P2}','ACORDO_FIXO',0.25),('${PX}','ACORDO_FIXO',0.5);
insert into promoter_goal_repasse(promoter_id,competencia,pct_base,pct_meta1,pct_meta2) values
 ('${P1}','2026-06-01',0.625,0.6355,0.6465),('${P2}','2026-06-01',0.75,0.7627,0.7758),
 ('${P1}','2026-04-01',0.60,0.61,0.62),('${PX}','2026-06-01',0.99,0.99,0.99);
insert into monthly_targets(company_id,promoter_id,year,month,meta,meta_1,meta_2) values
 ('${RR}','${P1}',2026,6,200000,220000,240000),('${BBTS}','${P2}',2026,6,150000,165000,180000),
 ('${RR}','${P1}',2026,4,100000,110000,120000);
insert into j_keys(company_id,promoter_id,j_key,key_type,active) values
 ('${RR}','${P1}','J001','INDIVIDUAL',true),('${BBTS}','${P2}','J002','INDIVIDUAL',true);
insert into monthly_closing_entries(company_id,year,month,sheet_name,entry_type,net_value,commission_value,insurance_value) values
 ('${RR}',2026,6,'A Vista ','CASH',7000,9.02,0),('${RR}',2026,6,'A Vista ','INSURANCE',0,1.08,120),
 ('${RR}',2026,4,'A Vista ','CASH',5000,7.10,0);
insert into daily_production_records(company_id,gross_value,net_value,insurance_value,movement_date,contract_date,proposal_date) values
 ('${BBTS}',9970.1,9970.1,1470.1,'2026-06-02','2026-06-02','2026-06-01'),
 ('${BBTS}',20600,20600,0,'2026-04-10','2026-04-10','2026-04-02');
`;

async function persist(client, y, m) {
  const { rows } = await client.query("select compute_rules_fingerprint($1,$2,'fechado') as fp", [y, m]);
  await client.query(
    `insert into pmr_rules_fingerprint(year,month,source_group,fingerprint,algo)
       values($1,$2,'fechado',$3,'md5-canon-v1')
     on conflict (year,month,source_group) do update set fingerprint=excluded.fingerprint, computed_at=now()`,
    [y, m, rows[0].fp]
  );
  return rows[0].fp;
}
async function detect(client) {
  const { rows } = await client.query("select year,month,state from detect_rules_stale()");
  const map = {};
  for (const r of rows) map[`${r.year}-${r.month}`] = r.state;
  return map;
}

(async () => {
  const port = 5400 + (process.pid % 150);
  const dir = path.join(os.tmpdir(), `cam2gate_${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false });
  await pg.initialise();
  await pg.start();
  const admin = pg.getPgClient();
  await admin.connect();
  // Base em UTF8 (initdb no Windows cria WIN1252; prod Supabase e UTF8).
  await admin.query("create database gate with encoding 'UTF8' template template0");
  await admin.end();
  const client = new PgClient({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "gate" });
  await client.connect();
  try {
    await client.query(SCHEMA);
    await client.query(MIG); // a MIGRATION 000001 REAL, verbatim (cria a funcao com o bug)
    await client.query(SEED);

    console.log("\n--- G0 REPRODUZ O BUG DE PROD (42883) com a 000001 sozinha ---");
    let repro = null;
    try {
      await client.query("select compute_rules_fingerprint(2026,6,'fechado')");
    } catch (e) {
      repro = e; // esperado: 42883 function pmr_fp_txt(share_profile_type) does not exist
    }
    ok("000001 sozinha: chamar a RPC quebra com 42883 (enum sem cast)",
      repro && repro.code === "42883" && /pmr_fp_txt\(share_profile_type\)/.test(repro.message),
      repro ? `${repro.code}: ${repro.message.split("\n")[0]}` : "NAO quebrou (schema mentiu de novo?)");
    // Aplica o FIX. A partir daqui a RPC executa. Reproduz o caminho de prod:
    // rodar 000001, ver quebrar na execucao, rodar 000002.
    await client.query(MIG2); // 000002: profile_type::text

    console.log("\n--- G1 SERIALIZACAO CANONICA (3.20==3.2 ; \\N vs '' vs 0) ---");
    const g1 = (await client.query(`select (3.20::numeric(20,6))::text a,(3.2::numeric(20,6))::text b,
        pmr_fp_num(null) num_null, pmr_fp_num(0) num_zero, pmr_fp_txt(null) txt_null, pmr_fp_txt('') txt_vazio`)).rows[0];
    ok("3.20 == 3.2 (mesma forma canonica)", g1.a === g1.b, `${g1.a} == ${g1.b}`);
    ok("NULL num -> \\N ; 0 -> 0.000000 ; '' -> '' (tres DISTINTAS)",
      g1.num_null === "\\N" && g1.num_zero === "0.000000" && g1.txt_vazio === "" &&
      new Set([g1.num_null, g1.txt_vazio, g1.num_zero]).size === 3);

    console.log("\n--- G2 DETERMINISMO / G3 DISCRIMINACAO ---");
    const jun1 = (await client.query("select compute_rules_fingerprint(2026,6,'fechado') fp")).rows[0].fp;
    const jun2 = (await client.query("select compute_rules_fingerprint(2026,6,'fechado') fp")).rows[0].fp;
    const abr = (await client.query("select compute_rules_fingerprint(2026,4,'fechado') fp")).rows[0].fp;
    ok("compute jun 2x identico", jun1 === jun2, jun1);
    ok("jun != abr", jun1 !== abr, `${jun1.slice(0, 8)} != ${abr.slice(0, 8)}`);

    console.log("\n--- G4 ESTADOS (DESCONHECIDO -> OK -> STALE) ---");
    let st = await detect(client);
    ok("pre-baseline: jun+abr DESCONHECIDO, zero OK",
      st["2026-6"] === "DESCONHECIDO" && st["2026-4"] === "DESCONHECIDO" && !Object.values(st).includes("OK"));
    await persist(client, 2026, 6);
    st = await detect(client);
    ok("apos reconsolidar jun: jun OK, abr segue DESCONHECIDO", st["2026-6"] === "OK" && st["2026-4"] === "DESCONHECIDO");
    await client.query("update promoter_goal_repasse set pct_base=0.777 where promoter_id=$1 and competencia='2026-06-01'", [P1]);
    st = await detect(client);
    ok("editar regua de jun SEM reconsolidar -> STALE", st["2026-6"] === "STALE", st["2026-6"]);

    console.log("\n--- G5 FALSO POSITIVO (escopo por promotor-no-PMR) ---");
    await client.query("update promoter_goal_repasse set pct_base=0.625 where promoter_id=$1 and competencia='2026-06-01'", [P1]);
    const junBase = await persist(client, 2026, 6);
    await client.query("update promoter_goal_repasse set pct_base=0.111 where promoter_id=$1 and competencia='2026-06-01'", [PX]);
    const junAfterPX = (await client.query("select compute_rules_fingerprint(2026,6,'fechado') fp")).rows[0].fp;
    st = await detect(client);
    ok("editar regua de promotor FORA do PMR nao muda o hash de jun (segue OK)",
      junBase === junAfterPX && st["2026-6"] === "OK", `${junBase.slice(0, 8)} == ${junAfterPX.slice(0, 8)}`);

    console.log("\n--- NO-OP (gravar fingerprint nao muda o PMR) + guarda de grupo ---");
    const before = (await client.query("select md5(string_agg(promoter_id::text||year||month||source,'|' order by promoter_id,year,month)) h,count(*) n from promoter_monthly_results")).rows[0];
    await persist(client, 2026, 6);
    await persist(client, 2026, 4);
    const after = (await client.query("select md5(string_agg(promoter_id::text||year||month||source,'|' order by promoter_id,year,month)) h,count(*) n from promoter_monthly_results")).rows[0];
    ok("PMR intacto apos persist (contagem + hash das linhas)", before.n === after.n && before.h === after.h, `${before.n}==${after.n}`);
    let raised = false;
    try { await client.query("select compute_rules_fingerprint(2026,6,'cms')"); } catch (e) { raised = /nao implementado/.test(e.message); }
    ok("grupo != 'fechado' levanta excecao clara", raised);
  } finally {
    await client.end();
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n==== ${fails === 0 ? "TODOS OS GATES PASSARAM" : fails + " GATE(S) FALHARAM"} ====`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error("ERRO NO GATE:", e); process.exit(2); });
