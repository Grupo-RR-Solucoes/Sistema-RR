#!/usr/bin/env node
// ============================================================================
// run_all_gates.cjs — RUNNER dos gates de regressao.
//
// Por padrao roda SO os gates SELF-CONTAINED (sem banco, sem arquivo fora do
// repo). E o modo que o CI usa: qualquer maquina com o repo clonado reproduz.
// Os demais sao PULADOS com motivo nominal e NAO influenciam o exit code -
// pular nao pode reprovar, senao o CI fica vermelho por algo que ele nunca
// teve como rodar.
//
//   node scripts/run_all_gates.cjs          -> so os self-contained (CI)
//   node scripts/run_all_gates.cjs --full   -> TODOS (local, exige .env.local
//                                              e os PDFs da TRP em disco)
//
// Exit: 0 = todos os gates EXECUTADOS passaram. 1 = algum falhou.
//       Pulados nunca reprovam.
//
// ---------------------------------------------------------------------------
// REGISTRO EXPLICITO, NAO GLOB
// ---------------------------------------------------------------------------
// Varrer scripts/*_gate.cjs pegaria os 29 gates do repo, e a maioria le o banco
// de PRODUCAO. Um glob transformaria o CI num cliente do banco vivo. Cada gate
// entra aqui a mao, com o motivo da classificacao escrito.
//
// COMO CLASSIFICAR UM GATE NOVO:
//   self-contained  -> as TRES coisas, nao uma:
//                        (a) nao chama createClient;
//                        (b) nao le .env / .env.local por conta propria;
//                        (c) nao le caminho absoluto nem nada fora do repo.
//                      Entra no CI de graca. NAO basta (a): em 02/08/2026 o CI
//                      do PR #164 reprovou porque dois gates classificados so
//                      por (a) violavam (b) e (c). O passo VERIFICACAO DO
//                      CRITERIO, mais abaixo, agora cobra os tres por varredura
//                      — a regra deixou de depender de alguem lembrar dela.
//   needs-db        -> chama createClient. NUNCA vai pro CI: exigiria a service
//                      role de producao num runner publico.
//   needs-local     -> le arquivo que nao esta versionado (ex.: PDF no
//                      Downloads). So vira CI-avel quando a entrada entrar no
//                      repo (ou virar fixture).
// ============================================================================

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FULL = process.argv.includes("--full");
const DB_ONLY = process.argv.includes("--db");

const GATES = [
  {
    arquivo: "scripts/tiquete_min_regua_gate.cjs",
    nome: "tiquete_min (regua x hardcode)",
    modo: "self-contained",
    motivo:
      "le regras_promotiva/json + lib/motor.ts; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/venda_propria_gestao_gate.cjs",
    nome: "venda propria de gestao (no-op + isolamento do PMR)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + funcoes reais do repo",
  },
  {
    arquivo: "scripts/piso_producao_regua_gate.cjs",
    nome: "piso de producao (leitor da regua + fiacao ligada)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + lib/pisoProducao.ts real; o bloco L le os fontes do repo",
  },
  {
    arquivo: "scripts/piso_producao_motor_gate.cjs",
    nome: "piso de producao no motor (zera repasse, nao toca a empresa)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + consolidateMonthlyFromClosing real, rodado 2x (sem piso x com piso)",
  },
  {
    arquivo: "scripts/gate_schema_colunas.mts",
    nome: "schema: toda coluna que o codigo pede existe no banco",
    modo: "needs-db",
    motivo:
      "createClient/.env: compara o codigo com o BANCO REAL, nao com supabase/migrations — " +
      "e essa e a razao de existir. No incidente de 21/08 (PR #174) o DDL de piso_zerou " +
      "estava em scripts/sql/, fora de migrations, entao um gate que lesse migrations teria " +
      "passado verde enquanto 6 telas caiam com 42703. Medido em 21/08: 3,3s (1 requisicao " +
      "OpenAPI de 0,9s + varredura de app/lib). NAO e self-contained e por isso NAO entra no " +
      "npm run gates do CI — ver o bloco FAIXA no fim do proprio gate, que registra o que " +
      "falta para ele ser CI-avel (so a chave ANON basta; a service_role nao e necessaria).",
  },
  {
    arquivo: "scripts/no_brand_hardcoded_gate.cjs",
    nome: "marca institucional so na barra",
    modo: "self-contained",
    motivo:
      "le .ts/.tsx/.js do proprio repo",
  },
  {
    arquivo: "scripts/detector_regua_camada2_gate.cjs",
    nome: "detector de regua - camada 2",
    modo: "self-contained",
    motivo:
      "puro sobre codigo do repo",
  },
  {
    arquivo: "scripts/check_regrasLoader.cjs",
    nome: "regrasLoader (resolucao de vigencia)",
    modo: "self-contained",
    motivo:
      "le os JSONs versionados",
  },
  {
    arquivo: "scripts/check_tx_juros_min.cjs",
    nome: "tx_juros_min derivado da matriz",
    modo: "self-contained",
    motivo:
      "le os JSONs versionados",
  },
  {
    arquivo: "scripts/verifica_data_l.cjs",
    nome: "data-l nas tabelas (kit mobile)",
    modo: "self-contained",
    motivo:
      "le os .tsx do repo",
  },
  {
    arquivo: "scripts/bbts_seguro_regua_gate.cjs",
    nome: "regua de seguro BBTS",
    modo: "self-contained",
    motivo:
      "le fixture versionada; sem banco",
  },
  {
    arquivo: "scripts/test_item4_pdf_extract.cjs",
    nome: "extrator de PDF do fechamento ADS",
    modo: "needs-local",
    motivo:
      "le C:/Users/diego/Downloads (:9). Estava como self-contained e REPROVOU o CI do PR #164: no ubuntu o caminho nao existe e da ENOENT",
  },
  {
    arquivo: "scripts/test_debitos_edicao.cjs",
    nome: "edicao de debitos (regras puras)",
    modo: "self-contained",
    motivo:
      "funcoes puras de lib/debitRules",
  },
  {
    arquivo: "scripts/gate-import-percentual.mts",
    nome: "percentual no import (invariante)",
    modo: "self-contained",
    motivo:
      "puro sobre o parser",
  },
  {
    arquivo: "scripts/gate_teto_avista_rr.ts",
    nome: "teto a-vista RR versionado por competencia",
    modo: "self-contained",
    motivo:
      "puro sobre lib/tetoAvistaRR",
  },
  {
    arquivo: "scripts/golden_carteira_vs_metadata.ts",
    nome: "golden carteira x metadata",
    modo: "needs-db",
    motivo:
      "le o service_role de .env.local (:23-33). Estava como self-contained e REPROVOU o CI do PR #164: sem secrets ele morre em 'Legacy API keys are disabled'",
  },
  {
    arquivo: "scripts/test_equipe_dashboard.ts",
    nome: "montagem do payload do /equipe",
    modo: "self-contained",
    motivo:
      "assembleTeamProduction com entrada em memoria",
  },
  {
    arquivo: "scripts/test_equipes_socio_gestor.ts",
    nome: "escopo de equipes socio x gestor",
    modo: "self-contained",
    motivo:
      "puro sobre as funcoes de escopo",
  },
  {
    arquivo: "scripts/test_gestor_meta.ts",
    nome: "meta do gestor (override x derivada)",
    modo: "self-contained",
    motivo:
      "puro sobre resolveGestorMeta",
  },
  {
    arquivo: "scripts/test_inadimplencia_solucionado.ts",
    nome: "inadimplencia SOLUCIONADO sai dos agregados",
    modo: "self-contained",
    motivo:
      "puro sobre inadimplenciaAgregados",
  },
  {
    arquivo: "scripts/bbts_conservacao_celula_gate.cjs",
    nome: "celula do PDF BBTS: piso + conservacao + anti-contaminacao",
    modo: "needs-local",
    motivo:
      "le o PDF do fechamento da BBTS, que e dado de cliente e NAO e versionado " +
      "(passe o caminho por argumento ou em BBTS_FECHAMENTO_PDF). UM arquivo com " +
      "as DUAS invariantes: nenhum fragmento de celula se perde, e o total por " +
      "pagina e conservado — separar em dois gates duplicaria a extracao inteira " +
      "do PDF para medir o mesmo universo. " +
      "DUAS AUSENCIAS DIFERENTES, e elas NAO tem o mesmo desfecho: " +
      "SEM PDF ele se declara PULADO e sai 0 — e a regra do runner (pular nao " +
      "pode reprovar), entao no --full aparece como PASSOU sem ter medido nada, " +
      "e isso continua sendo verdade. " +
      "COM PDF ERRADO ele REPROVA: desde a Fase D existe um piso (secao 0) que " +
      "exige tabela resolvida, ancora, fragmentos >= ancoras e ao menos uma " +
      "celula multifragmento. Antes disso um PDF sem a tabela dava " +
      "'0 fragmentos, 0 perdidos, PASSOU' — verde por vacuidade",
  },
  {
    arquivo: "scripts/check_condicoes_seed.cjs",
    nome: "condicoes do seed (JSON curado)",
    modo: "needs-local",
    motivo:
      "le auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx (3,69 MB), que esta no .gitignore:20 e NAO existe no CI. Reprovou o PR #164 com ENOENT",
  },
  {
    arquivo: "scripts/check_lookup_vs_v9.cjs",
    nome: "lookup x v9 (JSON curado)",
    modo: "needs-local",
    motivo:
      "mesmo XLSX ignorado do check_condicoes_seed. regras_promotiva/json esta versionado (49/49); o XLSX nao",
  },
  {
    arquivo: "scripts/gate-competencia-janela.cjs",
    nome: "competencia por janela de producao",
    modo: "needs-db",
    motivo:
      "createClient; le daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/paridade_avista_trp_gate.cjs",
    nome: "paridade a-vista TRP (previsto x motor)",
    modo: "needs-db",
    motivo:
      "createClient; daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_escala_seguro_tabela.cjs",
    nome: "escala de seguro nasce da tabela",
    modo: "needs-db",
    motivo:
      "createClient; share_scale de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_daily_nao_toca_ads.cjs",
    nome: "import diario RR nao toca a ADS",
    modo: "needs-db",
    motivo:
      "createClient; daily_production_records de PRODUCAO",
  },
  {
    arquivo: "scripts/heranca_master_janela_gate.cjs",
    nome: "heranca master decide competencia pela janela",
    modo: "needs-db",
    motivo:
      "2,4s; createClient; daily_production_records de PRODUCAO. Blocos 1 e 2 sao " +
      "puros (o 2 prova que o criterio de CALENDARIO violava a invariante, para o " +
      "gate nao passar por vacuidade); o 3 roda o helper de producao contra as 6 " +
      "propostas medidas de 2026-06-30; o 4 impede a copia duplicada voltar",
  },
  {
    arquivo: "scripts/competencia_janela_comissoes_gate.cjs",
    nome: "competencia por janela em /commissions/proposals, bulk e closingProposalRows",
    modo: "needs-db",
    motivo:
      "4,7-5,3s (2 execucoes); createClient; daily_production_records de PRODUCAO. " +
      "A faixa --db estava em 47,0s de 90s ANTES deste gate. Os blocos 1 e 2 sao " +
      "PUROS: o 2 reimplementa os QUATRO criterios de calendario que sairam do " +
      "codigo (range por Date.UTC, slice(0,7), getUTCMonth, startsWith de prefixo) " +
      "e prova que cada um violava a invariante — sem ele o gate nao distingue " +
      "'esta certo' de 'nao ha o que testar'. O 3 varre os 7 sitios no fonte. O 4 " +
      "e vivo-x-vivo e assere a guarda que importa: o conserto NAO abre para " +
      "edicao nenhuma linha de competencia FECHADA. O 5 e o mais importante e o " +
      "menos obvio — ele NAO assere um delta em R$. O delta da chave errada foi " +
      "medido em R$ 17,20 em 18/08/2026 e seria uma CONSTANTE CONGELADA da " +
      "coincidencia daquele dia: agosto cruzou o piso de FAIXA_3 em 17/08, e so " +
      "por isso as 68 linhas de 30/06 e 31/07 deram zero. O bloco varre a janela " +
      "dia a dia com os DOIS lados computados no mesmo run e exige que exista ao " +
      "menos um dia em que as duas chaves dao faixas diferentes (medido: 11 de 12)",
  },
  {
    arquivo: "scripts/recorte_familia_janela_gate.cjs",
    nome: "corte do delta e da MESMA familia da competencia",
    modo: "needs-db",
    motivo:
      "3,6s; createClient; daily_production_records de PRODUCAO. Os blocos 1 a 3 " +
      "sao puros (o 3 prova que a regra VELHA violava a invariante, para o gate " +
      "nao passar por vacuidade)",
  },
  {
    arquivo: "scripts/serie_eixo_daily_gate.cjs",
    nome: "mes com daily elegivel aparece no eixo da serie",
    modo: "needs-db",
    motivo:
      "2,4s; createClient; daily_production_records de PRODUCAO. Barato porque " +
      "so le 8 colunas sem valor; os blocos 1 e 2 sao puros (stub em memoria)",
  },
  {
    arquivo: "scripts/test_caixa_recebido_empresa.cjs",
    nome: "caixa - recebido empresa",
    modo: "needs-db",
    motivo:
      "createClient; fechamento de PRODUCAO",
  },
  {
    arquivo: "scripts/test_caixa_comissoes_m1.cjs",
    nome: "caixa - comissoes M1 liquido",
    modo: "needs-db",
    motivo:
      "createClient; PMR de PRODUCAO",
  },
  {
    arquivo: "scripts/test_item3_ads_seguro.cjs",
    nome: "seguro ADS por proposta",
    modo: "needs-db",
    motivo:
      "createClient; daily da ADS de PRODUCAO",
  },
  {
    arquivo: "scripts/trp_tx_juros_min_gate.cjs",
    nome: "TRP - tx_juros_min derivado",
    modo: "needs-db",
    motivo:
      "createClient; trp_rule_versions de PRODUCAO",
  },
  {
    arquivo: "scripts/gate_regua_bbts_independe_do_client.ts",
    nome: "regua BBTS independe do client",
    modo: "needs-db-lento",
    motivo:
      "13,7s; createClient; bbts_rule_versions de PRODUCAO. PROMOVIDO em " +
      "03/08/2026 por TETO: a faixa --db estava em 113,0s de 90s ANTES desta " +
      "frente (medido com o gate novo fora, por git stash) e foi para 116,3s " +
      "com ele. Promovidos os DOIS mais lentos que estavam VERDES — este e o " +
      "mov3_equipe — em vez do mais lento de todos (ADS julho, 18,2s), que " +
      "esta VERMELHO: tirar um gate que falha da faixa que se roda antes do PR " +
      "e esconder a falha, nao pagar a divida. Faixa depois, MEDIDA: 78,0s",
  },
  {
    arquivo: "scripts/gate_ads_julho_dois_bugs.ts",
    nome: "ADS julho - os dois bugs fechados",
    modo: "needs-db",
    motivo:
      "createClient; daily da ADS de PRODUCAO",
  },
  {
    arquivo: "scripts/detector_regua_camada1_gate.cjs",
    nome: "detector de regua - camada 1",
    modo: "needs-db",
    motivo:
      "createClient (smoke live); consolidadores gravam versao TRP",
  },
  {
    arquivo: "scripts/janela_ritmo_paridade_gate.cjs",
    nome: "janela de ritmo - paridade /projecao x /equipe",
    modo: "needs-db-lento",
    motivo:
      "17,7s; createClient; daily de PRODUCAO",
  },
  {
    arquivo: "scripts/test_debitos_junho_congelado.cjs",
    nome: "debitos de junho congelados",
    modo: "needs-db-lento",
    motivo:
      "19,0s; createClient; debitos de PRODUCAO",
  },
  {
    arquivo: "scripts/fix_truncamento_gate.cjs",
    nome: "truncamento na projecao/metas/caixa",
    modo: "needs-db-lento",
    motivo:
      "21,3s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/guardas_regime_gate.cjs",
    nome: "guardas de regime (bulk/cancel)",
    modo: "needs-db-lento",
    motivo:
      "21,1s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/projecao_dias_ritmo_gate.cjs",
    nome: "projecao - dias uteis do ritmo",
    modo: "needs-db-lento",
    motivo:
      "24,3s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/projecao_rank_sem_master_gate.cjs",
    nome: "projecao - master fora do rank",
    modo: "needs-db-lento",
    motivo:
      "44,9s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/pmr_aberto_sem_daily_gate.cjs",
    nome: "PMR nao existe em competencia aberta",
    modo: "needs-db-lento",
    motivo:
      "10,5s; createClient; PMR de PRODUCAO. NASCEU lento por MEDICAO, nao por " +
      "escolha: entrou como needs-db em 03/08/2026 e a faixa deu 90,3s de 90s. " +
      "O peso vem de buildLedgerHealth, que e o vigia INTEIRO (Camadas 1 e 2 + " +
      "auditoria cms). Pagar esse preco e proposital: a alternativa era " +
      "reimplementar a regra aqui e ter duas respostas para 'o PMR esta limpo?'. " +
      "Os blocos 1 e 2 (stub, sem banco) provam que a guarda acende — sao eles " +
      "que a impedem de passar por vacuidade quando o banco estiver limpo",
  },
  {
    arquivo: "scripts/mov1_ledger_gate.cjs",
    nome: "ledger MOV1 - PMR por rota",
    modo: "needs-db-lento",
    motivo:
      "52s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/mov2_grupoA_gate.cjs",
    nome: "ledger MOV2 - grupo A",
    modo: "needs-db-lento",
    motivo:
      "57s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/mov2_dashboard_gate.cjs",
    nome: "ledger MOV2 - dashboard",
    modo: "needs-db-lento",
    motivo:
      "60s; createClient; PRODUCAO",
  },
  {
    arquivo: "scripts/gate_remuneracao_lideranca.mts",
    nome: "remuneracao de lideranca (regua versionada, 2 regimes)",
    modo: "needs-db-lento",
    motivo:
      "59s; createClient; monthly_closing_entries/leadership_rule_versions de PRODUCAO",
  },
  {
    arquivo: "scripts/check_enquadramento.cjs",
    nome: "enquadramento por faixa (audit_v9)",
    modo: "needs-db-lento",
    motivo:
      "10,7s; createClient; audit_v9_avista de PRODUCAO. PROMOVIDO em 03/08/2026 " +
      "por TETO, junto do gate-medida-c-rota — ver o motivo de la",
  },
  {
    arquivo: "scripts/gate-medida-c-rota.mts",
    nome: "MEDIDA C: a janela da rota nao decapita a competencia M-1",
    modo: "needs-db-lento",
    motivo:
      "19,5s; createClient; daily de PRODUCAO. VIVO x VIVO: LADO A e a query da " +
      "rota (com janela), LADO B e query PROPRIA sem janela — os dois deste run. " +
      "PROMOVIDO em 03/08/2026 por TETO, junto do check_enquadramento: a faixa " +
      "deu 111,7s de 90s com o gate novo (que custa 2,1s). Escolhidos os dois " +
      "mais lentos que estavam VERDES — o mais lento de todos (ADS julho, 18,5s) " +
      "esta VERMELHO e tirar gate vermelho da faixa e esconder falha. ATENCAO: as " +
      "medicoes desta faixa variam bastante entre execucoes (78s, 93,6s e 111,7s " +
      "no mesmo dia, mesmo conjunto) — a variacao e de latencia do banco, nao de " +
      "codigo; os numeros aqui sao de UMA execucao, nao media",
  },
  {
    arquivo: "scripts/gate-srcc-ads.mts",
    nome: "SRCC ADS: resposta conhecida nunca exibe 'Sem informacao'",
    modo: "needs-db",
    motivo:
      "createClient; daily da ADS de PRODUCAO. INVARIANTE (nao contagem) desde 01/08; auto-declara a nao-vacuidade",
  },
  {
    arquivo: "scripts/mov3_equipe_gate.cjs",
    nome: "/equipe converge para o PMR em mes fechado (MOV 3)",
    modo: "needs-db-lento",
    motivo:
      "14,9s; createClient; daily + PMR de PRODUCAO. 4 secoes vivo-x-vivo; a 5a " +
      "(delta da SRCC 213615547) foi aposentada em 01/08. PROMOVIDO em " +
      "03/08/2026 por TETO, junto do gate_regua_bbts — ver o motivo de la para " +
      "a medicao e o criterio de escolha",
  },
  {
    arquivo: "scripts/check_audit_v9_tables.cjs",
    nome: "audit_v9: nenhuma das 4 tabelas esvaziou",
    modo: "needs-db",
    motivo:
      "createClient; count nas 4 audit_v9_* de PRODUCAO. Assercao INVERTIDA em 01/08: vigiava 'ainda nao semeei', agora vigia 'nao pode esvaziar'",
  },
  {
    arquivo: "scripts/trp_prazo_min_gate.cjs",
    nome: "prazo_min: TRP vigente tem o campo e ninguem paga abaixo do piso",
    modo: "needs-db",
    motivo:
      "createClient; trp_rule_versions + daily de PRODUCAO. INVERTIDO em 01/08: media o delta do conserto, agora assere a invariante + a causa raiz (campo ausente desliga a guarda)",
  },
  {
    arquivo: "scripts/gate_projecao_gestor.mts",
    nome: "/projecao do gestor (montagem + mascaramento)",
    modo: "needs-db-lento",
    motivo:
      "15,7s; createClient; daily/PMR de PRODUCAO. PROMOVIDO a lento em 01/08 para caber os dois de vivo-x-vivo na --db sem estourar o teto de 90s",
  },
  {
    arquivo: "scripts/trp_parser_escalares_gate.cjs",
    nome: "parser TRP - escalares de categoria",
    modo: "needs-local",
    motivo:
      "le 3 PDFs de C:/Users/diego/Downloads; o repo tem 0 PDFs versionados",
  },
  {
    arquivo: "scripts/gate_ritmo_diario.mts",
    nome: "ritmo diario necessario (6 invariantes + dedup da meta)",
    modo: "needs-db-lento",
    motivo:
      "24s; createClient; roda buildProjecaoMetas 2x (competencia medida + mes corrente). Assercoes por IDENTIDADE, nunca por valor absoluto. A (6) e a que pega o erro de R$ 1,16 milhao de somar monthly_targets na mao. Fora da --db pelo teto de 90s",
  },
  {
    arquivo: "scripts/gate_competencia.mts",
    nome: "competencia canonica (7 telas: lista, abertura, pedida, sem dado, rotulo)",
    modo: "needs-db-lento",
    motivo:
      "33,1s; createClient; exercita 5 resolvedores de competencia (promoterAnalytics, closingAnalytics, financialAnalytics, projecaoMetas, getClosingPeriods) em 3 competencias cada. LENTO por isso, nao por ineficiencia: cortar competencia ou resolvedor e cortar cobertura. Fora da --db para nao estourar o teto de 90s, mesmo motivo do gate_projecao_gestor",
  },
];

// ---------------------------------------------------------------------------
// TRES FAIXAS, SEPARADAS POR CUSTO (nao por dominio)
// ---------------------------------------------------------------------------
// Dominio nao e o que faz alguem deixar de rodar; TEMPO e. Medido em
// 01/08/2026: rodar tudo passa de 10 minutos, e um comando de 10 minutos vira
// coisa que ninguem executa — trocariamos gate MORTO por gate IGNORADO, que da
// no mesmo.
//
//   npm run gates       self-contained            ~55s    CI
//   npm run gates:db    needs-db rapido           ~90s    antes do PR
//   npm run gates:full  tudo, inclusive os lentos ~11min  antes do merge
const SELF = GATES.filter((g) => g.modo === "self-contained");
const DB_RAPIDO = GATES.filter((g) => g.modo === "needs-db");
const aRodar = FULL ? GATES : DB_ONLY ? DB_RAPIDO : SELF;
const aPular = FULL ? [] : GATES.filter((g) => !aRodar.includes(g));

// TETO DA FAIXA --db. Sem teto ela cresce sozinha ate virar o --full, e ai o
// problema volta inteiro. Se estourar, FALHA: alguem tem de tirar um gate da
// faixa ou promove-lo a needs-db-lento.
const TETO_DB_MS = Number(process.env.GATES_DB_TETO_MS || 90000);

const linha = (c) => c.repeat(74);
console.log(linha("="));
console.log("RUNNER DE GATES" + (FULL ? "  [--full: tudo, inclusive os lentos]" : DB_ONLY ? "  [--db: needs-db rapido, teto " + (TETO_DB_MS / 1000) + "s]" : "  [self-contained]"));
console.log(linha("="));

// ---------------------------------------------------------------------------
// COBERTURA DA TIPAGEM — gate rastreado que ficou de fora do tsconfig.gates
// ---------------------------------------------------------------------------
// O tsconfig.gates.json usa include EXPLICITO de proposito: um glob varreria o
// SISTEMA DE ARQUIVOS e pegaria os ~72 scratch untracked, reintroduzindo o
// problema de 27/06/2026 que pos scripts/ no exclude do build.
//
// O preco disso e que a lista NAO se atualiza sozinha: um gate novo fica sem
// tipagem ate alguem lembrar de acrescenta-lo. E exatamente esse esquecimento
// que deixou o gate_projecao_gestor MORTO por TypeError sem ninguem notar.
// Este bloco cobra o esquecimento em vez de confiar na memoria.
//
// FONTE DA VERDADE = git ls-files (nao o filesystem): so arquivo RASTREADO
// entra na conta, entao scratch untracked nunca reprova ninguem.
//
// SO .ts/.mts: .cjs nao e tipado pelo tsc aqui (checkJs esta desligado), entao
// exigir um .cjs no include seria pedir uma entrada que nao verifica nada.
// PREFIXOS que marcam "arquivo que ASSERE". Renomes de 01/08/2026 tiraram do
// alcance deste criterio, DE PROPOSITO:
//   MUTA_merge_dono_coluna.manual.cjs  — ESCREVE em producao; o antigo prefixo
//     `test_` o incluia aqui, e um runner por prefixo o executaria contra o
//     banco vivo. Nunca pode voltar a casar.
//   diag_auditoria_avista.cjs, dump_candidate_list_motor.cjs,
//   dump_pmr_fechado_hash.cjs — exigem flag/argumento por natureza; nao sao
//     gates e nao devem cobrar tipagem nem execucao.
const PREFIXOS_QUE_ASSEREM = ["gate", "golden", "test_"];
// Guarda explicita: nenhum arquivo que muta pode entrar no criterio, mesmo que
// alguem o renomeie de volta por engano.
const NUNCA_AUTOMATIZAR = /^MUTA_|\.manual\./;
let coberturaFalhou = false;
{
  const r = spawnSync("git", ["ls-files", "scripts/"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    console.log("\n>>> COBERTURA DA TIPAGEM DOS GATES");
    console.log("    PULADO: `git ls-files` indisponivel (" + String(r.stderr || "").trim() + ")");
    console.log("    Sem git nao da para distinguir rastreado de scratch — nao reprovo por isso.");
  } else {
    const rastreados = r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => /\.(ts|mts)$/.test(f));

    const querTipagem = rastreados.filter((f) => {
      const base = path.basename(f);
      if (NUNCA_AUTOMATIZAR.test(base)) return false;
      return PREFIXOS_QUE_ASSEREM.some((p) => base.startsWith(p));
    });

    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.gates.json"), "utf8"));
    const noInclude = new Set((cfg.include || []).map((s) => s.replace(/\\/g, "/")));
    const foraDoInclude = querTipagem.filter((f) => !noInclude.has(f.replace(/\\/g, "/")));
    // O inverso tambem e defeito: include apontando para arquivo que sumiu faz
    // o tsc silenciar sem avisar que perdeu cobertura.
    const inexistentes = [...noInclude].filter((f) => !fs.existsSync(path.join(ROOT, f)));

    console.log("\n>>> COBERTURA DA TIPAGEM DOS GATES  (tsconfig.gates.json)");
    console.log(
      "    rastreados .ts/.mts em scripts/: " + rastreados.length +
      " | com prefixo que assere (" + PREFIXOS_QUE_ASSEREM.join(", ") + "): " + querTipagem.length +
      " | no include: " + noInclude.size
    );

    if (foraDoInclude.length > 0) {
      coberturaFalhou = true;
      console.log("    FALHOU — gate RASTREADO fora do include (fica sem tipagem):");
      for (const f of foraDoInclude) console.log("      - " + f);
      console.log("    Conserto: acrescente o caminho em tsconfig.gates.json > include.");
    }
    if (inexistentes.length > 0) {
      coberturaFalhou = true;
      console.log("    FALHOU — include aponta para arquivo que NAO existe:");
      for (const f of inexistentes) console.log("      - " + f);
      console.log("    Conserto: remova a entrada morta de tsconfig.gates.json > include.");
    }
    if (!coberturaFalhou) {
      console.log("    OK — todo gate rastreado esta no include, e todo include existe.");
    }
  }
}

// ---------------------------------------------------------------------------
// COMO INVOCAR — .cjs roda direto, .ts/.mts precisa de tsx
// ---------------------------------------------------------------------------
// O runner fazia `spawnSync(process.execPath, [abs])`, ou seja `node arquivo`.
// Isso NAO executa TypeScript, entao nenhum gate .ts/.mts jamais poderia ter
// entrado no registro. Nao era esquecimento — era incapacidade. Consequencia
// medida em 01/08/2026: dos 68 gates rastreados, 6 registrados e 3 executados
// no modo padrao; os 16 .ts/.mts eram TODOS orfaos, incluindo os dois que
// provam a regua de lideranca que entra em vigor em agosto.
//
// POR QUE tsx E NAO O _ts_register.cjs QUE OS GATES JA USAM. Medido, 7
// execucoes de um arquivo trivial:
//     node arquivo.cjs            (baseline CJS)          227ms
//     node arquivo.mts            (strip nativo do Node)  307ms
//     node -r _ts_register a.ts                           756ms
//     tsx arquivo.mts                                     639ms
// tsx e mais RAPIDO que o _ts_register (639 x 756) e, decisivo, e o unico que
// resolve o alias "@/..." em import ESM: o _ts_register faz isso por
// Module._resolveFilename, que so vale para CommonJS, e devolve
// ERR_MODULE_NOT_FOUND num .mts com `import ... from "@/lib/..."` — que e
// exatamente como os gates .mts importam. O strip nativo do Node 24, apesar de
// ser o mais barato, tambem nao resolve o alias.
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
function comoInvocar(abs) {
  if (!/\.(ts|mts|cts)$/.test(abs)) return { args: [abs] };
  if (!fs.existsSync(TSX_CLI)) return { erro: "tsx nao encontrado em node_modules/tsx/dist/cli.mjs" };
  return { args: [TSX_CLI, abs] };
}

// ---------------------------------------------------------------------------
// VERIFICACAO DO CRITERIO — self-contained e as TRES coisas, nao uma
// ---------------------------------------------------------------------------
// Em 02/08/2026 o CI do PR #164 reprovou porque dois gates foram classificados
// como self-contained aplicando so metade do criterio ("nao chama
// createClient"):
//   golden_carteira_vs_metadata.ts  le o service_role de .env.local -> no CI,
//                                   que roda SEM secrets por desenho, morre em
//                                   "Legacy API keys are disabled";
//   test_item4_pdf_extract.cjs      le C:/Users/diego/Downloads -> no ubuntu o
//                                   caminho nao existe e da ENOENT.
// Nenhum dos dois chama createClient, entao o criterio pela metade os aprovou.
// Local os dois passam: o Windows tem a pasta e o .env.local esta em disco.
//
// A regra passa a ser COBRADA aqui, nao lembrada. Mesma ideia do passo de
// cobertura da tipagem logo acima.
//
// A 3a REGRA MUDOU em 02/08/2026: de "caminho absoluto" para "le arquivo NAO
// RASTREADO no git". O caminho absoluto era o SINTOMA; o arquivo nao versionado
// e a CAUSA, e a regra nova cobre a classe inteira:
//   test_item4_pdf_extract.cjs   caminho ABSOLUTO (C:/Users/diego/Downloads)
//   check_condicoes_seed.cjs     caminho RELATIVO ao repo, arquivo IGNORADO
//   check_lookup_vs_v9.cjs       (auditorias/ esta no .gitignore:20)
// So a segunda forma escapava da regra antiga — e foi ela que reprovou o CI do
// PR #164 depois que a primeira ja tinha sido consertada.
//
// A deteccao de caminho absoluto CONTINUA, porque sai de graca e caminho
// absoluto e defeito por si: mesmo que o arquivo exista na maquina de quem
// rodou, ele nao existe na de mais ninguem.
//
// POR QUE NAO VARRO A ARVORE DE IMPORTS. Medido: dos 17 self-contained, dois
// ALCANCAM createClient por import —
//   test_equipes_socio_gestor.ts -> lib/equipes/model.ts -> lib/supabaseAdmin.ts
//   test_gestor_meta.ts          -> lib/equipes/model.ts -> lib/supabaseAdmin.ts
// e os DOIS passam no CI, porque lib/supabaseAdmin.ts:10-20 instancia o cliente
// LAZY, dentro de getSupabaseAdmin(). Varrer a arvore daria 2 falsos positivos
// e 0 verdadeiros. Lazy e o padrao que se quer INCENTIVAR; puni-lo empurraria
// todo mundo de volta para o cliente no topo do modulo.
const RASTREADOS = (() => {
  const r = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
})();

/** Caminhos que o arquivo tenta ler, extraidos dos literais. Sem recursao. */
function caminhosCitados(src) {
  const out = new Set();
  // path.join(...) / path.resolve(...): junta os argumentos ENTRE ASPAS e
  // ignora os identificadores (ROOT, __dirname), resolvendo depois nas duas
  // bases possiveis.
  for (const m of src.matchAll(/path\.(?:join|resolve)\(([^)]*)\)/g)) {
    const partes = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    if (partes.length) out.add(partes.join("/"));
  }
  // literais soltos com extensao de dado
  for (const m of src.matchAll(/["'`]([^"'`\n]*\.(?:xlsx|xls|pdf|csv|json))["'`]/g)) out.add(m[1]);
  return [...out];
}

const REGRAS_SELF = [
  { nome: "chama createClient", re: /\bcreateClient\s*\(/ },
  { nome: "le arquivo .env/.env.local", re: /["'`]\.env(\.local)?["'`]/ },
  { nome: "caminho absoluto", re: /["'`](?:[A-Za-z]:[\/]|\/Users\/|\/home\/|~\/)/ },
];
let criterioFalhou = false;
{
  const violacoes = [];
  const selfs = GATES.filter((x) => x.modo === "self-contained");
  for (const g of selfs) {
    const abs = path.join(ROOT, g.arquivo);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const r of REGRAS_SELF) {
      const m = src.match(r.re);
      if (m) violacoes.push({ arquivo: g.arquivo, regra: r.nome, detalhe: m[0] });
    }
    // 3a regra: arquivo que EXISTE aqui e NAO esta no git -> no CI nao existe.
    if (RASTREADOS) {
      for (const cit of caminhosCitados(src)) {
        if (/^[A-Za-z]:[\/]|^\/|^~/.test(cit)) continue; // absoluto: ja coberto acima
        for (const base of [ROOT, path.join(ROOT, "scripts")]) {
          const alvo = path.resolve(base, cit);
          // So ARQUIVO: `git ls-files` nao lista diretorios, entao um literal
          // como ".." resolveria para a raiz e viraria falso positivo.
          if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) continue;
          const rel = path.relative(ROOT, alvo).split(path.sep).join("/");
          if (!RASTREADOS.has(rel)) {
            violacoes.push({ arquivo: g.arquivo, regra: "le arquivo NAO rastreado no git", detalhe: rel });
          }
        }
      }
    }
  }
  console.log("\n>>> VERIFICACAO DO CRITERIO self-contained");
  console.log(
    `    ${selfs.length} gate(s) x ${REGRAS_SELF.length + 1} regras` +
    (RASTREADOS ? `   (git ls-files: ${RASTREADOS.size} arquivos rastreados)` : "   [git indisponivel: regra do untracked PULADA]")
  );
  if (violacoes.length) {
    criterioFalhou = true;
    console.log("    FALHOU — gate self-contained que NAO pode rodar no CI:");
    for (const v of violacoes) console.log(`      - ${v.arquivo}: ${v.regra}  (${v.detalhe})`);
    console.log("    Conserto: mova para needs-db (createClient/.env) ou needs-local (arquivo fora do git).");
  } else {
    console.log("    OK — nenhum chama createClient, le .env, usa caminho absoluto ou le arquivo fora do git.");
  }
}
const resultados = [];
for (const g of aRodar) {
  const abs = path.join(ROOT, g.arquivo);
  if (!fs.existsSync(abs)) {
    console.log("\n>>> " + g.nome + "\n    ARQUIVO AUSENTE: " + g.arquivo);
    resultados.push({ ...g, status: "AUSENTE", code: null });
    continue;
  }
  const inv = comoInvocar(abs);
  if (inv.erro) {
    // FALHA, nao pulo: gate que nao consegue rodar tem de ficar VERMELHO. Pular
    // aqui reproduziria o defeito que esta frente existe para matar.
    console.log("\n>>> " + g.nome + "\n    NAO EXECUTAVEL: " + inv.erro);
    resultados.push({ ...g, status: "FALHOU", code: null });
    continue;
  }
  console.log("\n>>> " + g.nome + "  (" + g.arquivo + ")");
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, inv.args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const code = r.status;
  resultados.push({
    ...g,
    status: code === 0 ? "PASSOU" : "FALHOU",
    code,
    ms,
  });
}

console.log("\n" + linha("="));
console.log("RESUMO");
console.log(linha("="));

for (const r of resultados) {
  const tag = r.status === "PASSOU" ? "PASSOU " : r.status === "FALHOU" ? "FALHOU " : "AUSENTE";
  const extra =
    r.status === "FALHOU" ? "  (exit " + r.code + ")" : r.ms != null ? "  (" + r.ms + "ms)" : "";
  console.log("  " + tag + " | " + r.nome + extra);
}
for (const g of aPular) {
  console.log("  PULADO  | " + g.nome);
  console.log("          | motivo: " + g.motivo);
}

console.log(
  "  " + (coberturaFalhou ? "FALHOU " : "PASSOU ") +
  " | cobertura da tipagem dos gates (tsconfig.gates.json)"
);
console.log(
  "  " + (criterioFalhou ? "FALHOU " : "PASSOU ") +
  " | criterio self-contained (createClient / .env / caminho absoluto / arquivo fora do git)"
);

// TETO DA FAIXA --db: verificado pelo PROPRIO runner, sobre o tempo MEDIDO.
// Sem isso o teto seria so um numero num comentario, e a faixa cresceria ate
// virar o --full — que e exatamente o que esta separacao existe para impedir.
let tetoEstourou = false;
if (DB_ONLY) {
  const somaMs = resultados.reduce((s, r) => s + (r.ms || 0), 0);
  const ok = somaMs <= TETO_DB_MS;
  if (!ok) tetoEstourou = true;
  console.log(
    "  " + (ok ? "PASSOU " : "FALHOU ") + " | teto da faixa --db: " +
    (somaMs / 1000).toFixed(1) + "s de " + (TETO_DB_MS / 1000) + "s"
  );
  if (!ok) {
    const ordenados = [...resultados].sort((a, b) => (b.ms || 0) - (a.ms || 0));
    console.log("          A faixa --db estourou o teto. Tire um gate dela ou");
    console.log("          promova-o a needs-db-lento (so no --full). Mais lentos:");
    for (const r of ordenados.slice(0, 3)) {
      console.log("            " + ((r.ms || 0) / 1000).toFixed(1) + "s  " + r.nome);
    }
  }
}

const falhas = resultados.filter((r) => r.status !== "PASSOU");
console.log(linha("-"));
console.log(
  "  executados: " + resultados.length +
  " | passaram: " + resultados.filter((r) => r.status === "PASSOU").length +
  " | falharam: " + falhas.length +
  " | pulados: " + aPular.length
);

if (aPular.length > 0) {
  console.log(
    "\n  " + aPular.length + " gate(s) PULADO(S) — nao rodam em CI e NAO reprovam aqui."
  );
  console.log("  Para roda-los nesta maquina: npm run gates:full");
  console.log("  (exige .env.local com a service role e os PDFs da TRP em disco)");
}

if (falhas.length > 0 || coberturaFalhou || tetoEstourou || criterioFalhou) {
  const motivos = falhas.map((f) => f.nome);
  if (coberturaFalhou) motivos.push("cobertura da tipagem dos gates");
  if (tetoEstourou) motivos.push("teto de tempo da faixa --db");
  if (criterioFalhou) motivos.push("criterio self-contained violado");
  console.log("\n  RESULTADO: FALHOU — " + motivos.join(", "));
  process.exit(1);
}
console.log("\n  RESULTADO: OK — todos os gates executados passaram.");
process.exit(0);
