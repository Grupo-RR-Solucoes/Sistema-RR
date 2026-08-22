#!/usr/bin/env node
/**
 * scripts/check_audit_v9_tables.cjs — validação pós-migration Fase 4.1.
 *
 * Verifica:
 *   1. 4 tabelas audit_v9_* existem (via SELECT em cada uma)
 *   2. 7+ indexes não-PK criados (via RPC se disponível, ou skip com aviso)
 *   3. Nenhuma das 4 tabelas ESVAZIOU (count > 0)
 *
 * ASSERCAO INVERTIDA EM 01/08/2026. Ela nasceu como validacao pos-migration —
 * "as tabelas existem e ainda estao vazias, o seed nao rodou". Depois do seed
 * ela passou a acusar SUCESSO como se fosse falha: `4 tabelas vazias: FAIL (ja
 * populadas)`.
 *
 * O que envelheceu foi o SINAL, nao o gate. A premissa NAO e irreversivel:
 * tabela populada pode ser esvaziada por reimportacao, por truncate manual ou
 * por migration futura — e ai a auditoria v9 inteira fica sem base, em
 * silencio. Entao ele passa a vigiar o outro lado: NENHUMA pode esvaziar.
 *
 * Se um dia se quiser de novo checar o estado pre-seed, isso e outra
 * ferramenta, nao esta.
 *
 * Conecta via SUPABASE_SERVICE_ROLE_KEY do .env.local (bypass RLS).
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Carrega .env.local manualmente (sem dotenv)
const envPath = path.resolve(__dirname, "..", ".env.local");
const envText = fs.readFileSync(envPath, "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY em .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const TABELAS = [
  "audit_v9_avista",
  "audit_v9_enquadramento",
  "audit_v9_prt",
  "audit_v9_reconciliacao",
];

async function checkTabela(t) {
  const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
  if (error) return { tabela: t, existe: false, vazia: null, count: null, erro: error.message };
  return { tabela: t, existe: true, vazia: count === 0, count };
}

async function main() {
  console.log(`Conectando: ${url}`);

  // 1. Verificar existência + count
  console.log("\n=== 1. Tabelas e contagens ===");
  const resultados = [];
  for (const t of TABELAS) resultados.push(await checkTabela(t));
  for (const r of resultados) {
    if (r.existe) console.log(`  PASS — ${r.tabela}: count=${r.count} ${r.vazia ? "(vazia)" : "(POPULADA)"}`);
    else console.log(`  FAIL — ${r.tabela}: ${r.erro}`);
  }
  const todasExistem = resultados.every((r) => r.existe);
  // INVERTIDO: o defeito e ESVAZIAR, nao estar populada.
  const vazias = resultados.filter((r) => r.vazia === true);
  const nenhumaVazia = vazias.length === 0;

  // 2. Indexes (via RPC supabase-js — se RPC não existir, fallback aviso)
  console.log("\n=== 2. Indexes ===");
  let indexesOk = null;
  let indexesFalha = null;
  try {
    // Tenta uma RPC genérica que lista indexes (não existe por padrão; vai falhar)
    const { data, error } = await supabase.rpc("pg_indexes_audit_v9");
    if (error) throw error;
    console.log(`  ${data.length} indexes audit_v9_*:`);
    for (const i of data) console.log(`    - ${i.tablename}.${i.indexname}`);
    indexesOk = data.length >= 7;
  } catch (e) {
    // AUSENCIA DE MEDICAO NAO E APROVACAO (mesma regra do scripts/_diffContraRef.ts).
    //
    // Ate 21/08/2026 este catch imprimia a alternativa manual, deixava
    // `indexesOk` em null — que NINGUEM lia — e o gate seguia para o exit 0. O
    // cabecalho deste arquivo promete "2. 7+ indexes nao-PK criados"; a promessa
    // estava desligada em silencio desde sempre. Um index derrubado por migration
    // futura passaria batido com o gate VERDE.
    indexesFalha =
      "RPC pg_indexes_audit_v9 indisponivel: " + String((e && e.message) || e).split("\n")[0];
    console.log("  RPC pg_indexes_audit_v9 não disponível — PostgREST não expõe pg_indexes por padrão.");
    console.log("  ESTE BLOCO NAO MEDIU NADA. Ver o Resumo: o gate REPROVA por isso.");
    console.log("  Verificação alternativa: rodar via SQL Editor do Supabase Studio:");
    console.log("");
    console.log("    select tablename, indexname from pg_indexes");
    console.log("    where schemaname='public' and tablename like 'audit_v9_%'");
    console.log("    order by tablename, indexname;");
    console.log("");
    console.log("  Esperado (12 entradas: 4 PKs + 7 não-PK + 1 unique):");
    console.log("    audit_v9_avista          | audit_v9_avista_pkey");
    console.log("    audit_v9_avista          | audit_v9_avista_mes_status_idx");
    console.log("    audit_v9_avista          | audit_v9_avista_bloco_idx");
    console.log("    audit_v9_avista          | audit_v9_avista_convenio_idx");
    console.log("    audit_v9_enquadramento   | audit_v9_enquadramento_pkey");
    console.log("    audit_v9_enquadramento   | audit_v9_enquadramento_regime_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_pkey");
    console.log("    audit_v9_prt             | audit_v9_prt_mes_status_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_bloco_idx");
    console.log("    audit_v9_prt             | audit_v9_prt_convenio_idx");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_pkey");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_mes_idx");
    console.log("    audit_v9_reconciliacao   | audit_v9_reconciliacao_mes_cnpj_key (unique)");
  }

  // 3. Resumo
  console.log("\n=== 3. Resumo ===");
  console.log(`  4 tabelas existem: ${todasExistem ? "PASS" : "FAIL"}`);
  console.log(
    `  nenhuma tabela ESVAZIOU: ${nenhumaVazia ? "PASS" : "FAIL — " + vazias.map((r) => r.tabela).join(", ") + " sem linhas; a auditoria v9 fica sem base"}`
  );
  console.log(
    `  7+ indexes nao-PK: ${
      indexesFalha ? "FAIL — NAO MEDIDO (" + indexesFalha + ")" : indexesOk ? "PASS" : "FAIL — menos de 7"
    }`
  );

  if (!todasExistem) process.exit(1);
  if (!nenhumaVazia) process.exit(2);
  if (indexesFalha || indexesOk !== true) {
    console.log(`
  REPROVADO PORQUE NAO MEDIU, nao porque mediu e achou defeito.

  Este gate afirma no cabecalho que confere "7+ indexes nao-PK criados". Sem a
  RPC ele nao confere NADA disso — e verde sem medicao e pior que vermelho,
  porque desliga a desconfianca de quem le. Enquanto isto estiver assim, a
  ausencia de um index de audit_v9_* passa batida.

  DUAS SAIDAS, as duas deliberadas — escolha uma, nao afrouxe este bloco:

  (a) CRIAR A RPC (o gate passa a medir de verdade). No SQL Editor:

        create or replace function public.pg_indexes_audit_v9()
        returns table (tablename text, indexname text)
        language sql stable security definer set search_path = public as $$
          select tablename::text, indexname::text
            from pg_indexes
           where schemaname = 'public'
             and tablename like 'audit_v9_%'
             and indexname not like '%_pkey'
           order by tablename, indexname;
        $$;
        revoke all on function public.pg_indexes_audit_v9() from public, anon, authenticated;

      A RPC devolve SO os nao-PK, que e o que o contador >= 7 espera.
      security definer porque pg_indexes filtra por dono; revoke porque so o
      service_role (este gate) precisa dela.

  (b) APOSENTAR A ASSERCAO de propósito, se decidirem que index nao e trabalho
      deste gate — apagando o bloco 2 E a linha do cabecalho que o promete, no
      mesmo commit. Aposentar so a verificacao e deixar a promessa no comentario
      recria exatamente este defeito.
`);
    process.exit(4);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(99);
});
