#!/usr/bin/env node
/**
 * scripts/check_audit_v9_tables.cjs — validação pós-migration Fase 4.1.
 *
 * Verifica:
 *   1. as 6 tabelas audit_v9_* existem (via SELECT em cada uma)
 *   2. 7+ indexes não-PK criados (via RPC pg_indexes_audit_v9; hoje são 13)
 *   3. Nenhuma das 4 tabelas BASE ESVAZIOU (count > 0)
 *
 * DE 4 PARA 6 TABELAS (03/09/2026). O bloco 1 só conhecia 4, e a RPC de indexes
 * — assim que passou a medir de verdade — mostrou índices de SEIS tabelas
 * audit_v9_*. `audit_v9_duplicates_quarantine` e `audit_v9_padrao_d_exclusoes`
 * existiam, tinham índice próprio e NINGUÉM checava se sumiam.
 *
 * MAS ELAS NÃO ENTRAM NA REGRA DO "NÃO PODE ESVAZIAR", e isso é decisão, não
 * esquecimento: quarentena de duplicatas e lista de exclusões VAZIAS são
 * resultado legítimo (zero duplicatas é boa notícia). Um gate que fica vermelho
 * quando a auditoria não achou nada é exatamente a doença que esta suíte acabou
 * de curar — 4 portões cronicamente vermelhos, nenhum deles apontando defeito.
 * Para as duas, o que se cobra é EXISTÊNCIA (sumir é sempre defeito) e o count
 * vai impresso, para quem lê ver o número mudar.
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

// BASE da auditoria v9: esvaziar QUALQUER uma delas deixa /auditoria sem chão,
// e em silêncio. São estas que respondem pela regra do "não pode esvaziar".
const TABELAS_BASE = [
  "audit_v9_avista",
  "audit_v9_enquadramento",
  "audit_v9_prt",
  "audit_v9_reconciliacao",
];

// DERIVADAS: quarentena de duplicatas e exclusões do padrão D. Vazias são
// resultado legítimo — ver o cabeçalho. Cobra-se existência, não conteúdo.
const TABELAS_DERIVADAS = [
  "audit_v9_duplicates_quarantine",
  "audit_v9_padrao_d_exclusoes",
];

const TABELAS = [...TABELAS_BASE, ...TABELAS_DERIVADAS];

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
  console.log("  -- BASE (nao podem esvaziar):");
  for (const r of resultados.filter((x) => TABELAS_BASE.includes(x.tabela))) {
    if (r.existe) console.log(`  PASS — ${r.tabela}: count=${r.count} ${r.vazia ? "(vazia)" : "(POPULADA)"}`);
    else console.log(`  FAIL — ${r.tabela}: ${r.erro}`);
  }
  console.log("  -- DERIVADAS (vazio e resultado legitimo; cobra-se so existencia):");
  for (const r of resultados.filter((x) => TABELAS_DERIVADAS.includes(x.tabela))) {
    if (r.existe) console.log(`  PASS — ${r.tabela}: count=${r.count}`);
    else console.log(`  FAIL — ${r.tabela}: ${r.erro}`);
  }
  const todasExistem = resultados.every((r) => r.existe);
  // INVERTIDO: o defeito e ESVAZIAR, nao estar populada. E vale SO para as BASE
  // — ver o cabecalho: reprovar porque a quarentena de duplicatas esta vazia
  // seria ficar vermelho por boa noticia.
  const vazias = resultados.filter((r) => r.vazia === true && TABELAS_BASE.includes(r.tabela));
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
    // Lista ATUALIZADA em 03/09/2026 pelo que a RPC devolveu de verdade. A
    // anterior prometia "12 entradas" e listava so as 4 tabelas que o bloco 1
    // conhecia; sao 13 NAO-PK, em SEIS tabelas — as duas ultimas nao estavam
    // aqui nem la. Lista escrita a mao envelhece calada: se divergir de novo,
    // e a RPC que manda.
    console.log("  Esperado (13 nao-PK, medido em 03/09/2026 pela propria RPC):");
    console.log("    audit_v9_avista                 | audit_v9_avista_bloco_idx");
    console.log("    audit_v9_avista                 | audit_v9_avista_convenio_idx");
    console.log("    audit_v9_avista                 | audit_v9_avista_mes_status_idx");
    console.log("    audit_v9_duplicates_quarantine  | audit_v9_duplicates_quarantine_contract_idx");
    console.log("    audit_v9_duplicates_quarantine  | audit_v9_duplicates_quarantine_reason_idx");
    console.log("    audit_v9_enquadramento          | audit_v9_enquadramento_regime_idx");
    console.log("    audit_v9_padrao_d_exclusoes     | audit_v9_padrao_d_exclusoes_mes_idx");
    console.log("    audit_v9_padrao_d_exclusoes     | audit_v9_padrao_d_exclusoes_motivo_idx");
    console.log("    audit_v9_prt                    | audit_v9_prt_bloco_idx");
    console.log("    audit_v9_prt                    | audit_v9_prt_convenio_idx");
    console.log("    audit_v9_prt                    | audit_v9_prt_mes_status_idx");
    console.log("    audit_v9_reconciliacao          | audit_v9_reconciliacao_mes_cnpj_key (unique)");
    console.log("    audit_v9_reconciliacao          | audit_v9_reconciliacao_mes_idx");
  }

  // 3. Resumo
  console.log("\n=== 3. Resumo ===");
  console.log(`  ${TABELAS.length} tabelas existem: ${todasExistem ? "PASS" : "FAIL"}`);
  console.log(
    `  nenhuma tabela BASE ESVAZIOU: ${nenhumaVazia ? "PASS" : "FAIL — " + vazias.map((r) => r.tabela).join(", ") + " sem linhas; a auditoria v9 fica sem base"}`
  );
  console.log(
    `  7+ indexes nao-PK: ${
      indexesFalha ? "FAIL — NAO MEDIDO (" + indexesFalha + ")" : indexesOk ? "PASS" : "FAIL — menos de 7"
    }`
  );

  if (!todasExistem) process.exit(1);
  if (!nenhumaVazia) process.exit(2);

  // MEDIU E ACHOU POUCO != NAO MEDIU. Ate 03/09/2026 os dois casos caiam no
  // MESMO ramo e saiam com exit 4 imprimindo "REPROVADO PORQUE NAO MEDIU" — de
  // modo que, no dia em que a RPC existisse e um index estivesse REALMENTE
  // faltando, o gate acusaria a propria cegueira em vez do defeito, e o achado
  // de verdade ficaria escondido atras da mensagem errada. Sao exits diferentes
  // de proposito: 3 = mediu e achou; 4 = nao mediu.
  if (!indexesFalha && indexesOk !== true) {
    console.log(`
  REPROVADO PORQUE MEDIU E ACHOU MENOS DE 7 indexes nao-PK.

  A RPC pg_indexes_audit_v9 respondeu — a cegueira do bloco 2 acabou. O que
  sobrou e um achado REAL: as tabelas audit_v9_* estao com menos indexes do que
  a migration que as criou prometeu. Sem eles, /auditoria varre as tabelas
  inteiras a cada abertura.

  Confira no Studio o que existe e o que falta:

    select tablename, indexname from pg_indexes
     where schemaname='public' and tablename like 'audit_v9_%'
     order by tablename, indexname;
`);
    process.exit(3);
  }

  if (indexesFalha) {
    console.log(`
  REPROVADO PORQUE NAO MEDIU, nao porque mediu e achou defeito.

  Este gate afirma no cabecalho que confere "7+ indexes nao-PK criados". Sem a
  RPC ele nao confere NADA disso — e verde sem medicao e pior que vermelho,
  porque desliga a desconfianca de quem le. Enquanto isto estiver assim, a
  ausencia de um index de audit_v9_* passa batida.

  DUAS SAIDAS, as duas deliberadas — escolha uma, nao afrouxe este bloco:

  (a) CRIAR A RPC (o gate passa a medir de verdade). O SQL ja esta versionado em
      supabase/migrations/20260903_000003_pg_indexes_audit_v9.sql — aplique-o no
      Studio. E o mesmo corpo abaixo:

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
