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

// ---------------------------------------------------------------------------
// O ESTADO DO PROPRIO SISTEMA DE PORTOES — varredura de 29/08/2026
// ---------------------------------------------------------------------------
// Registrado aqui, e nao num handoff, porque e sobre ESTE arquivo. Nada disto e
// hipotese: cada numero saiu de uma execucao.
//
// O UNIVERSO: 102 arquivos de portao versionados — 83 registrados aqui e 19
// ORFAOS (existem em scripts/, rastreados no git, e NINGUEM roda).
//
// (1) QUEM RODA DE VERDADE. O CI (.github/workflows/gates.yml) executa
//     `npm run gates` = os self-contained. Os demais so rodam quando alguem
//     lembra. E o proprio CI e MODO AVISO: sem required status check e sem
//     branch protection, ele NAO bloqueia merge. Mesmo a faixa que roda sempre e
//     aviso, nao guarda.
//
// (2) A FAIXA --db NAO E RODADA, e o teto ja diz isso. Medida em 29/08/2026:
//     358,4s de teto 90s — 4x estourado; o registro anterior dizia 216,9s.
//     REMEDIDA no mesmo dia, mais tarde: 193,3s. Ver (3c) para a decomposicao —
//     o numero oscila com a latencia do banco, mas o teto e estourado nas tres
//     medicoes, e o custo esta CONCENTRADO em tres portoes, nao espalhado.
//     Varri TODAS as mensagens de commit do repo: dezenas afirmam "npm run gates
//     29/29", "17/17", "20/20"; NENHUMA jamais afirmou a faixa --db verde. Nao e
//     "faz tempo que nao roda": nao ha registro de ela ter rodado verde alguma
//     vez. Comando de 6 minutos nao e rodado — a licao do bloco TRES FAIXAS, uma
//     linha acima, aplicada a si mesma.
//
// (3) OS 17 VERMELHOS de 29/08/2026 (rodada limpa: 83 executados, 66 passaram).
//     Nenhum e self-contained. Caracterizados:
//       FALSO VERMELHO        gate_schema_colunas.mts — sozinho da exit 0 ("as
//                             2844 colunas existem"); pelo runner, exit
//                             3221226505 (crash). Defeito do RUNNER, nao do gate.
//       RECUSA DELIBERADA     check_audit_v9_tables.cjs (exit 4) — ele mesmo diz
//                             "verde sem medicao e pior que vermelho".
//       ANTI-VACUIDADE OK     produto_pmr_empresa_dona_gate.cjs — reprova na
//                             PROPRIA guarda ("22 buckets -> 22 linhas"): recusa
//                             passar sem caso real. E o comportamento desejado.
//       DEFEITO VIVO          gate-srcc-ads.mts — "19 viram neutro" e "nenhuma
//                             linha ADS tem srcc_resolucao gravada". O gate esta
//                             certo; o defeito e que nao foi consertado.
//       CONSTANTE CONGELADA   test_debitos_junho_congelado.cjs — congelou junho em
//                             12/07/2026 (22 debitos, 25 parcelas, AUTO 872,71);
//                             hoje sao 24, 27 e 899,21. Ver a secao 6c do
//                             HANDOFF_RESIDUO_FINANCEIRO: foi ele que guardou o
//                             rastro da rodada de 27/08, e ninguem o rodou.
//       OS OUTROS 11 (needs-db-lento) — CARACTERIZADOS em 29/08/2026. Os 11 estao
//                             VERDES e NENHUM era defeito de producao. Diagnostico
//                             completo no bloco (3b), logo abaixo.
//
// (3b) OS 11 VERMELHOS needs-db-lento — TRIAGEM DE 29/08/2026
//     Os 11 estao VERDES. NENHUM era defeito de producao: nenhum centavo errado,
//     nenhuma producao escondida. Duas causas respondem por 10 deles.
//
//     CAUSA A — JULHO FECHOU (6 portoes, 24 assercoes, UMA causa so).
//       guardas_regime_gate (5), projecao_dias_ritmo_gate (9),
//       janela_ritmo_paridade_gate (4), mov1_ledger_gate (3),
//       mov2_grupoA_gate (2), mov3_equipe_gate (1).
//       Todos cravavam 2026-07 como "o mes ABERTO" porque julho estava aberto
//       quando foram escritos. O que eles provam — "em mes ABERTO nao barra, nao
//       reconsolida, o divisor do ritmo desconta o dia corrente" — e PERMANENTE;
//       o que venceu foi a ESCOLHA de julho como representante do regime. Alguns
//       chegavam a reprovar o comportamento CERTO (o mov2_grupoA cobrava que o
//       lancamento caisse em julho quando a resposta correta ja era agosto).
//       Conserto unico, em scripts/_competenciaAberta.cjs: a competencia aberta
//       passa a ser resolvida NO RUN por detectMonthRegime, e o helper LANCA se
//       nao houver mes aberto — nunca devolve um fechado disfarcado. As datas e
//       os contadores de dias uteis do projecao_dias_ritmo e do
//       janela_ritmo_paridade saem agora de productionBusinessWindow por POSICAO
//       (penultimo dia util / ultimo / depois da janela), sem numero cravado.
//
//     CAUSA B — DOIS UNIVERSOS COMPARADOS COMO SE FOSSEM UM (2 portoes).
//       gate_ritmo_diario (1) cobrava `somaRegionais === ativosNaoMaster`: a
//       lista da ROTA (escopada pela competencia) contra um COUNT da tabela
//       promoters (sem competencia). projecao_rank_sem_master (6) cobrava "o rank
//       cai exatamente o nº de masters": base escopada pela empresa da PRODUCAO
//       contra rank escopado pela empresa DA PESSOA.
//       Medido: 48 na lista contra 53 na tabela, e os MESMOS 5 nomes nos dois
//       portoes — KEYLLA, JOYCE, KELIANE, SAMUEL e SUZANA, todos com producao
//       R$ 0,00, quatro deles cadastrados em agosto. Ou seja: CONTRATAR alguem
//       reprovava os dois portoes no dia seguinte. Varrido o grupo inteiro: dos
//       53 nao-masters ativos com linha na base, 48 aparecem em algum rank e os 5
//       ausentes tem producao ZERO — nenhum centavo fora do rank.
//       A contagem fragil saiu; entrou a invariante que ela tentava expressar,
//       computada nos dois lados: "nenhum nao-master COM PRODUCAO fica fora de
//       TODOS os ranks", com guarda de nao-vacuidade.
//
//     OS OUTROS 3, um a um:
//       test_debitos_junho_congelado  O TRIPWIRE FUNCIONOU. 22/25/872,71 ->
//           24/27/899,21. O evento esta apurado no HANDOFF_RESIDUO_FINANCEIRO 6c:
//           ADICAO de +2 AUTO e +R$ 26,50 por operacoes orfas da fila ganhando
//           dono (degrau +cms do PR #195), NAO troca de dono, ninguem perdeu nada.
//           RECRAVADO com data e procedencia, nunca removido: e a unica coisa no
//           repo que percebe junho — competencia congelada — sendo reescrito, e a
//           causa segue viva (canc-run-fila.cjs contorna a trava do import).
//       fix_truncamento_gate          A ancora buscava a promotora num mapa
//           filtrado por `active`. KETLEY foi DESATIVADA; a linha dela sumiu do
//           mapa e o `find` deu undefined. O numero nunca esteve errado: o PMR de
//           jun ainda traz fechamento 4.862,44 + bbts 18.050,00 = 22.912,44,
//           exatamente a ancora. A soma de um mes FECHADO nao deixa de valer
//           porque a pessoa saiu da empresa — a busca deixou de filtrar por active.
//       pmr_aberto_sem_daily_gate     NAO estava vermelho: estava MORTO. Saia em
//           "admin.from(...).select(...).eq(...).not is not a function" antes da
//           primeira assercao — zero medicao, inclusive do bloco de PRODUCAO. O
//           commit b30c6a2 deu ao chamador um `.not(...)` que o stub em memoria
//           nao tinha (e, atras dele, um `.gte`). Stub alinhado, e agora ele
//           RECLAMA O NOME do metodo que lhe falta em vez de morrer anonimo. Com
//           o portao vivo, os 3 blocos passam — o fossil nao voltou.
//
// (3c) DE ONDE VEM O TEMPO — medido em 29/08/2026, cronometro do proprio runner
//     FAIXA --db: 193,3s de teto 90s (2,1x). O registro anterior dizia 358,4s; a
//     medicao de hoje deu 193,3s com os mesmos gates, entao aquele numero carrega
//     variacao de latencia do banco, nao so custo de codigo. Estourado nos dois casos.
//     E CONCENTRADO — TRES portoes fazem 65% da faixa:
//        91,3s  produtos_detalhamento_escopo_gate   <- sozinho passa do teto inteiro
//        21,4s  reatribuicao_precedencia_gate
//        13,2s  gate_ads_julho_dois_bugs
//        ------
//       125,9s  de 193,3s. Os outros 27 dividem ~67s.
//     Ou seja: a faixa nao esta "gorda", ela tem UM portao de 91s dentro. Tirar so
//     o produtos_detalhamento_escopo poe a faixa em ~102s — perto do teto, ainda
//     acima. Nao consertado nesta frente de proposito (e problema separado).
//
// (3d) O PORTAO DE 91,3s, MEDIDO E CONSERTADO em 30/08/2026 — nao era consulta
//     lenta, era N+1. Perfil do produtos_detalhamento_escopo (fetch interceptado,
//     o run inteiro): 628 requisicoes, 140,5s de rede em 143,3s de wall. A media
//     por requisicao e 0,22s — NENHUMA e lenta, sao muitas:
//        product_line_assignments  313 req  68,3s
//        monthly_closing_entries   156 req  37,0s
//        carteira_consorcio        158 req  35,0s
//     Causa: os blocos 4, 5 e 6 chamavam buildProdutoProposalRows com argumentos
//     IDENTICOS 148 vezes. O bloco 4 sozinho era quadratico — para cada um de 5
//     promotores refazia as linhas dos outros 23 a partir do banco, ou seja
//     buscava cada promotor 5 vezes.
//     Conserto: memo do builder (leitura pura, mes fechado, mesmo run) e o
//     cruzamento feito EM MEMORIA. 148 chamadas viraram 24 buscas reais.
//     A COBERTURA SUBIU, nao caiu: com o cruzamento em memoria deu para trocar
//     `pids.slice(0, 5)` pela matriz 24x24 COMPLETA — 552 pares conferidos,
//     contra 115 antes.
//     Medido no mesmo dia, mesma maquina:
//        o portao sozinho:  150,5s -> 28,4s
//        a faixa --db:      290,7s -> 185,4s / 193,2s / 193,2s (3 execucoes)
//     ATENCAO ao comparar com (3c): a faixa ANTES do conserto deu 290,7s HOJE,
//     contra os 193,3s registrados em 29/08 com os mesmos gates. A latencia do
//     banco domina a comparacao entre DIAS; so vale o par medido no MESMO dia.
//     O TETO CONTINUA ESTOURADO: mesmo zerando este portao a faixa ficaria em
//     ~165s de 90s. Baixa-lo nao resolve a faixa — e um portao a menos.
//
//     FAIXA needs-db-lento: 510,6s nos 20 portoes. Tambem concentrada:
//        78,3s mov2_proposals_get | 71,4s mov1_ledger | 61,5s gate_remuneracao_lideranca
//        55,9s mov2_dashboard     | 39,7s mov2_grupoA
//        = 306,8s (60%) em cinco.
//
// (4) OS ORFAOS — TRIADOS em 29/08/2026. Eram 19; a triagem os separou por CAUSA,
//     e a lista abaixo e o estado depois dela. O universo foi RE-DERIVADO, nao herdado:
//     103 arquivos com "gate"/"test" no nome, rastreados, menos MUTA_/.manual. — o 103o
//     e este runner. Os 19 do registro anterior reproduzem exatamente.
//
//     SAIRAM DA CONTA — nao eram portoes (renomeados, sem outra mudanca):
//       motor_credito_trp_db_gate_lib.cjs -> _motor_credito_trp_db_lib.cjs
//           biblioteca do gate vizinho; rc=0 em 361ms porque nao assere nada sozinho.
//           Prefixo `_`, a convencao ja usada por _fakeFechamento/_diffContraRef.
//       diag-residuo-09-gate-silencio.cjs -> diag-residuo-09-silencio.cjs
//           diagnostico: imprime linhas e nao tem ok() nem veredito. So casava a
//           varredura por ter "gate" no meio do nome.
//
//     NAO-EXECUTAVEIS por ARGUMENTO (4) — nao sao vermelhos: saem com mensagem de uso,
//     sem rodar assercao nenhuma. Mesmo caso dos renomeados de 01/08 (`dump_*`).
//       bbts_parser_gate.cjs      <pdf-da-tabela>
//       bbts_resolver_gate.cjs    <pdf-da-tabela>
//       bbts_fechamento_gate.cjs  <pdf-credito> [pdf-tabela]
//       bbts_conferencia_gate.cjs <pdf-tabela> <pdf-fechamento>
//     Os dois primeiros SERIAM recuperaveis por fixture SE a tabela de pagamento da
//     BBTS pudesse ser versionada — o parser dela so extrai regua (MatrizCrua: grupos,
//     convenios, percentuais, teto, vigencia), zero dado de cliente. Mas o PDF e
//     documento comercial de um PARCEIRO e o repositorio e PUBLICO, entao isso e
//     DECISAO DE NEGOCIO PENDENTE com o Diego, nao criterio tecnico, e esta atada a
//     divida do repo publico (logo abaixo). Os dois ultimos dependem do PDF de
//     FECHAMENTO, que e linha a linha por contrato: nao ha caminho por fixture.
//     `Tabela_de_Pagamento_BBTS.pdf` nunca esteve no git e nao esta em disco.
//
//     PROMOVIDOS A REGISTRADO (3) — ver as entradas no GATES[] acima:
//       gate-avista-vs-fechamento.mts   10/10 estaveis, needs-db-lento
//       mov2_proposals_get_gate.cjs     unica prova de promoterReportData, needs-db-lento
//       companyscope_grupo_gate.cjs     NOVO, separado de test_ads_status_e_grupo
//
//     APOSENTADO (1):
//       gate-medida-b-conserto.mts -> dump-medida-b-conserto.mts
//           4 constantes de TRANSICAO de 01/08 (27/20/4/4) contra 30/461/0/0 hoje.
//
//     SEPARADOS (2) — a metade congelada morreu, a permanente virou portao proprio:
//       test_ads_status_e_grupo.cjs     contagem do PR #84 aposentada; resolveCompanyScope
//                                       saiu para companyscope_grupo_gate.cjs. Segue orfao
//                                       (xlsx de cliente), agora 8 OK / 0 falhas.
//       test_ads_credito_competencia.cjs contagem "18 linhas" aposentada; as assercoes de
//                                       COMPETENCIA seguem. Segue orfao (mesmo xlsx).
//                                       ATENCAO: e uma das 2 unicas provas de
//                                       lib/bbtsDailyImport.ts (390 linhas, 8 consumidores).
//                                       A "1 falha nao diagnosticada" FOI DIAGNOSTICADA em
//                                       29/08/2026 e o portao esta 6 OK / 0 falhas. Era a
//                                       mesma familia da contagem ja aposentada: a assercao
//                                       (c) congelava TRES NUMEROS DE CONTRATO
//                                       (219509685/219421812/219351243) como se fossem
//                                       status permanente. Medido no xlsx de hoje, 2 dos 3
//                                       viraram "Contratação CDC" no mundo real — grava-los
//                                       e o comportamento CERTO. Reancorada no STATUS, com
//                                       os dois lados computados: nenhuma "Proposta CDC"
//                                       gravada (8 no arquivo) e TODA "Contratação CDC"
//                                       gravada (35), ambas com guarda de nao-vacuidade.
//                                       Provado por mutacao em lib/bbtsDailyImport.ts:243
//                                       nos DOIS sentidos — aceitar Proposta CDC derruba
//                                       (c) com 8 numeros, e nenhum deles estava na lista
//                                       congelada antiga, que teria deixado passar; recusar
//                                       Contratação derruba o controle positivo (c+).
//
//     DEIXADO ORFAO POR DECISAO (1):
//       trp_paridade_gate_f3.cjs  passa (rc=0), mas uma das tres competencias sai com
//           `matches: 0` — vacuidade naquela fatia. So registra com guarda de nao-vacuidade.
//
//     TRATADO NO CODIGO, nao no registro (1):
//       trp_parse_route_test.cjs  era 8 OK / 2 FAIL, hoje 10 OK / 0 FAIL. Achou um DEFEITO
//           VIVO: `7ad20fc` (17/07) removeu por colateral as 2 linhas que preenchiam
//           `confianca.provado`, e a tela de revisao de TRP dizia "0 provados" com 195
//           provados por 43 dias. Restaurado. A outra falha era assercao VENCIDA por
//           conserto correto (`b47ade6` preencheu o prazo do CONSIG_PRIVADO): aposentada.
//           Segue orfao: le um PDF de TRP que nao esta versionado.
//
//     INDETERMINADOS (5) — DIAGNOSTICADOS em 29/08/2026. Os 5 estao VERDES, e
//     NENHUM era defeito de producao: nao havia dinheiro errado atras de nenhum
//     deles. Cada falha foi isolada e classificada; o resultado, com o numero que
//     derrubou cada nota:
//
//       motor_credito_trp_db_gate.cjs   169 divergencias -> 0. Decompostas uma a
//           uma (a impressao truncava em 8 por secao e escondia a composicao):
//           132 eram `calculated_at`, o RELOGIO — o portao roda o mesmo codigo
//           duas vezes com segundos de intervalo e comparava os dois carimbos;
//           30 eram `trp_version_id`/`trp_fallback`, campos de PROCEDENCIA que
//           EXISTEM para diferir entre json e db; 6 eram a janela do `trend`, que
//           andou para 2026-08 enquanto a tolerancia estava presa a `month === 7`;
//           1 era a ancora de credito do RR. ZERO eram diferenca de calculo entre
//           as fontes. Os 3 primeiros viraram exclusao COM MOTIVO ESCRITO mais um
//           CONTROLE POSITIVO de procedencia (a exclusao nao pode virar cegueira),
//           e a tolerancia do trend passou a sair do DRIFT medido no proprio run.
//       mov3_dre_inclui_tudo_gate.cjs   ANCORA VENCIDA. 145.019,91 -> 143.942,13,
//           reancorada com data e procedencia. Todas as assercoes de ESTRUTURA ja
//           passavam, inclusive a identidade Sigma final - Sigma descontos ==
//           comissao do DRE, exata ao centavo.
//       mov2_dre_gate.cjs               O rc=127 NAO ERA CRASH DE AMBIENTE — era
//           FLAKE, e a nota anterior foi enganada por ele. Rodado a mao, o portao
//           termina em ~223s com rc=1 e UMA falha de assercao real. (O 127 se
//           reproduziu uma vez nesta frente, noutro portao, morrendo em 6s sem
//           imprimir erro; e intermitente e nao tem relacao com o veredito.)
//           A falha era ANCORA VENCIDA por PREMISSA MORTA: o portao exigia que a
//           ADS ficasse FORA do DRE, e o commit 24625ef ("DRE inclui ADS e
//           inativos") reverteu essa regra DE PROPOSITO. Em 2026-06 a ADS entra
//           com receita 9.321,02 e resultado POSITIVO de 4.126,33 — o prejuizo
//           fabricado que a assercao impedia nao tem como acontecer. Aposentada;
//           o lado permanente ja e asserido por mov3_dre_inclui_tudo_gate.
//       mov2_relatorios_gate.cjs        2 CONSTANTES CONGELADAS (118.227,41 de jun
//           e 96.143,14 de abr), descritas como "o PMR fechado" — mas o PMR e
//           TABELA VIVA e foi reescrito ate 27/08 pelas reguas de agosto. Os dois
//           lados passaram a ser computados no MESMO run (soma do PMR, com guarda
//           de nao-vacuidade). Junto, uma assercao de TRANSICAO aposentada: abril
//           exigia que AINDA HOUVESSE vazamento para a chave master, e reprovava
//           PORQUE o vazamento foi consertado (hoje delta R$ 0,00). Ficou o
//           invariante permanente: se houver vazamento, todo ele e de master.
//       test_ads_credito_trp_sempre.cjs Mesma ancora do motor_credito_trp_db_gate
//           (109.538,42), cravada em 12/07/2026. As duas foram reancoradas juntas.
//
//     A ANCORA DE CREDITO DO RR, atribuida centavo a centavo (era o unico numero
//     desta frente que podia ser dinheiro, entao foi bisseccionada em worktree,
//     commit a commit, contra o banco de hoje):
//         109.587,23   codigo de 3363ba5 (12/07) rodado hoje
//          -   23,17   competencia do volume virou JANELA
//          -  960,93   d7d556e 25/08  teto 5,80% (repasse sai da base NO TETO)
//          +  578,15   d6febc5 25/08  carve-out INSS da Aldalene (criterio = TAXA)
//         ----------
//         109.181,28   HEAD, identico nas DUAS fontes de TRP
//     Nenhum residuo inexplicado. E note o primeiro numero: com o CODIGO CONGELADO
//     a base moveu +48,81 em 48 dias (reatribuicoes, imports tardios). Constante
//     absoluta sobre tabela viva VENCE SOZINHA, sem ninguem tocar em codigo — e a
//     razao de as duas do mov2_relatorios terem virado comparacao no mesmo run.
//
//     SEGUEM ORFAOS, DE PROPOSITO: os 5 continuam fora do GATES[] abaixo. Juntos
//     passam de 600s e a faixa --db ja esta 4x estourada (ver item 2); registra-los
//     agora seria agravar um problema conhecido para resolver outro. E DIVIDA
//     NOMEADA: verdes hoje, sem ninguem os rodando amanha.
//
// (4b) DIVIDA NOMEADA, fora do alcance desta frente — O REPOSITORIO E PUBLICO.
//     Medido em 29/08/2026: a API do GitHub devolve `private: false, visibility: public`
//     para Grupo-RR-Solucoes/Sistema-RR. E o repositorio de um sistema que processa
//     producao contrato a contrato, e os handoffs versionados ja citam numero de
//     contrato, nome de promotor e valor. Consequencia direta para a triagem acima:
//     "versionar fixture" significa "PUBLICAR". Nenhuma fixture proposta por esta
//     frente carrega dado de cliente. A decisao sobre a visibilidade e do Diego e e
//     separada desta frente; fica registrada aqui para nao se perder.
//
// (5) QUANTOS PROVAM ALGO CONTINUAMENTE: os self-contained, e so eles. Os demais
//     provam quando alguem roda.
// ---------------------------------------------------------------------------

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const FULL = process.argv.includes("--full");
const DB_ONLY = process.argv.includes("--db");

const GATES = [
  {
    arquivo: "scripts/estorno_sem_leitor_gate.cjs",
    nome: "os estornos da aba Seguro tem UM leitor so (nao duplicam)",
    modo: "needs-db",
    motivo:
      "a nao-duplicidade do desconto de cancelamento depende de UMA linha de " +
      "filtro (closingPromoterBase.ts:160, .eq entry_type CASH). O gate varre lib/ " +
      "e app/ atras de qualquer consumidor novo que leia entry_type INSURANCE da " +
      "aba Seguro, e confere no banco que a aba nao esta vazia (senao passaria por " +
      "vacuidade). Provado por mutacao em 27/08/2026. " +
      "CONSERTADO em 29/08/2026: a assercao de nao-vacuidade estava atras de DOIS " +
      "escapes (sem credencial, e banco recusando a consulta) que a puliam e " +
      "deixavam o gate VERDE — a promessa desta linha de motivo ficava sem lastro. " +
      "Medido: dos 30 needs-db rodados com credencial FALSA, 27 reprovaram e 2 " +
      "passaram; este era um deles. Agora needs-db que nao alcanca o banco REPROVA. " +
      "Quem quiser so as estaticas usa GATE_ESTATICO=1, e o gate DIZ que esta em " +
      "modo reduzido",
  },
  {
    arquivo: "scripts/ads_cancelamento_dono_gate.cjs",
    nome: "cancelamento da ADS: casa o dono, nao duplica, nao invade o RR",
    modo: "needs-db",
    motivo:
      "roda resolveAdsCancelDebits real em dryRun sobre 3 casos de PRODUCAO: o que " +
      "tem dono no cms, os 2 que nao existem em fonte nenhuma, e a idempotencia. " +
      "Nenhuma constante congelada. createClient, sem caminho absoluto",
  },
  {
    arquivo: "scripts/financeiro_matriz_fecha_gate.cjs",
    nome: "a matriz do Financeiro fecha com os cards, nos dois lados",
    modo: "needs-db",
    motivo:
      "roda buildFinancialAnalytics real em 3 competencias e confere matriz == card " +
      "ao centavo (entrada e saida), celulas == total de linha, linhas == colunas, " +
      "expansao de Outros == a celula, e zero orfao. Lado direito e sempre o card do " +
      "MESMO payload — nenhuma constante congelada. createClient, sem caminho absoluto",
  },
  {
    arquivo: "scripts/ads_caixa_sem_rls_gate.cjs",
    nome: "o Caixa nao le bbts_prt_parcelas pelo cliente da PAGINA (42501)",
    modo: "needs-db",
    motivo:
      "cliente ESPIAO (Proxy sobre service_role) que estoura se .from() tocar tabela " +
      "RLS default-deny; roda buildFinancialAnalytics real e ainda exige que a ADS " +
      "continue no numero, para 'nao ler' nao virar 'remover'. createClient, sem " +
      "caminho absoluto",
  },
  {
    arquivo: "scripts/ads_no_regime_fechado_gate.cjs",
    nome: "a ADS ('bbts') entra em todo leitor do regime FECHADO",
    modo: "self-contained",
    motivo:
      "le os arquivos REAIS do repo: (A) os 6 sitios mapeados + a forma permissiva " +
      "do Caixa, (B) VARRE lib/ e app/ (256 arquivos) e reprova qualquer lista de " +
      "source que cite 'fechamento' sem 'bbts' — inclusive sitio que ainda nao " +
      "existe; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/ads_import_so_credito_gate.cjs",
    nome: "import so-credito da ADS nao apaga o seguro ja gravado (e a rota recusa)",
    modo: "self-contained",
    motivo:
      "roda importBbtsClosing + mergeDailyProductionRecords REAIS e a funcao POST " +
      "REAL da rota contra um banco ESPELHO em memoria (scripts/_fakeDpr.cjs), que " +
      "reproduz o upsert parcial do PostgREST — o mecanismo exato do defeito. Pega " +
      "as duas causas: a ancora que sai do proprio arquivo (0 == 0 PASSA) e o dono " +
      "FULL escrevendo chave de seguro zerada. Tem controle positivo (com o PDF de " +
      "seguro as 5 colunas VOLTAM a ser escritas), senao 'nao tocar' viraria 'nunca " +
      "gravar'. Provado por mutacao em 27/08/2026: reverter a omissao das chaves " +
      "derruba 3 asserçoes; tirar a empresa/os numeros da recusa derruba 2. Sem " +
      "banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/financeiro_matriz_detalhe_gate.cjs",
    nome: "matriz de entrada: o detalhe de 'Outros' explica a propria celula",
    modo: "self-contained",
    motivo:
      "roda buildFinancialAnalytics REAL contra um cliente de leitura semeado a " +
      "mao e cobra DUAS identidades em TODA linha: Sigma(outrosDetalhe) == " +
      "celulas.outros e Sigma(celulas) == total. A primeira e a que faltava: " +
      "'Outros' e coluna AGREGADA e expansivel, e a tela TROCA a coluna pelas " +
      "linhas do detalhe — valor sem entrada nomeada some da tela expandida " +
      "enquanto a coluna Total continua com ele. Foi o que a Abertura de Conta da " +
      "ADS fez em 28/08 (celula 100,00, detalhe 0,00). Tres controles positivos " +
      "impedem vacuidade: RR ALAGOAS 2 com Outros 488,75 em duas entradas, a linha " +
      "de avulsos (que usa Outros CORRETAMENTE, com detalhe por categoria) e a ADS " +
      "com a coluna nova != 0. Provado por mutacao em 28/08: devolver a Abertura " +
      "para 'outros' derruba 4 asserçoes. Sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/bbts_carimbo_posterior_gate.cjs",
    nome: "fechamento antigo nao sobrescreve carimbo POSTERIOR",
    modo: "self-contained",
    motivo:
      "NASCEU em 30/08/2026. A BBTS pode pagar as DUAS PERNAS da mesma proposta " +
      "em competencias diferentes (credito em junho, seguro em maio), e a tabela " +
      "guarda UMA linha por (empresa, proposta) e UM carimbo. Sem guarda, " +
      "importar a competencia antiga MESCLA por (company_id, proposal_number) e " +
      "o dono FULL sobrescreve movement_date/gross_value/bbts_pag_avista: 255,26 " +
      "de avista e 4.254,32 de producao sairiam de junho e a ancora daquele " +
      "fechamento deixaria de fechar. Supabase falso em memoria + " +
      "importBbtsClosing REAL com dryRun:false, capturando os upserts — e a " +
      "unica forma de responder 'esta linha chegou ao banco?'. Prova nos dois " +
      "sentidos: a guarda EXCLUI e o dano sem ela e real (as 3 colunas SAO do " +
      "dono FULL, medido por ownedColumnsFor); 3 mutantes que NAO podem acionar " +
      "(carimbo igual, anterior e NULL); 5 formas de opcao que NAO liberam a " +
      "gravacao; e controle positivo com competencia limpa. ARMADILHA que este " +
      "gate ja pagou: importBbtsClosing e DRY-RUN POR PADRAO, entao a 1a versao " +
      "passava por VACUIDADE — ha assercao de anti-vacuidade exigindo que algo " +
      "TENHA sido gravado. Fixtures sinteticas (repo publico). Sem banco, sem " +
      "rede, sem caminho absoluto",
  },
  {
    arquivo: "scripts/bbts_grupos_ausentes_gate.cjs",
    nome: "rotulo fragmentado + AUSENCIA DECLARADA de grupo (regua BBTS)",
    modo: "self-contained",
    motivo:
      "NASCEU em 30/08/2026 de DOIS defeitos que se disfarcavam um do outro. " +
      "(1) LEITURA: o gerador de PDF da BBTS parte a palavra com espaco " +
      "('Ren ovavel', 'B eneficio') e com rx.test puro a ancora nao casa — o " +
      "grupo some da regua SEM ERRO e a recusa aparece depois, culpando o " +
      "DOCUMENTO por defeito de LEITURA. (2) DOCUMENTO: a BBTS REMOVEU 3 grupos " +
      "na tabela de 31/07 (as palavras 'reduzidos' e 'bonificad' tem ZERO " +
      "ocorrencia no PDF), e isso recusava a regua inteira — agosto ficava fora " +
      "por grupos que a ADS nao usa (0 contratos em jun e jul). O gate prova que " +
      "os dois seguem SEPARADOS: se a fragmentacao voltar, o grupo cai na lista " +
      "de ausentes e a regua passa mesmo assim, que e o pior dos mundos. " +
      "Mutacao nos dois sentidos: casaExpressao sozinha (o estado anterior) TEM " +
      "de falhar no rotulo fragmentado; e a trava de ausencia mudou de lugar sem " +
      "sumir — nao declarar, declarar de menos ou declarar grupo que existe, os " +
      "tres LANCAM. Recusa POR CONTRATO com motivo nomeado, com anti-vacuidade " +
      "exigindo contrato calculado com sucesso no mesmo run. ARMADILHAS que ele " +
      "ja pagou: o teto da fixture e o da BBTS (6%), nao o teto interno da RR; e " +
      "o roteamento vai pelo convenio (nao existe campo 'grupo' na operacao), " +
      "entao GRUPAMENTO_MG_SP_REDUZIDOS so e alcancado com um convenio SP/MG " +
      "real. Fixtures sinteticas (repo publico). Sem banco, sem rede, sem PDF",
  },
  {
    arquivo: "scripts/bbts_layouts_pdf_gate.cjs",
    nome: "os TRES layouts do PDF de seguro da BBTS + '#N/D' no PRT",
    modo: "self-contained",
    motivo:
      "NASCEU em 30/08/2026, do dia em que o extrator recusou 3 dos 4 PDFs de " +
      "abril e maio/2026 da ADS — duas competencias que nunca entraram no " +
      "sistema. A BBTS emite o relatorio de seguro em TRES arranjos de coluna " +
      "que variam em 3 eixos independentes (prefixo 'R$ ', coluna de data, " +
      "posicao da chave J), e escreve o cabecalho do TOTAL de dois jeitos; a " +
      "'N. da parcela' do PRT pode vir '#N/D'. Nada disso tinha vigia. Importa " +
      "SEGURO_RE/PRT_RE/parseSeguroLines/parsePrtSection REAIS e exercita os " +
      "dois lados: 4 mutantes (um afrouxamento desfeito por vez) que TEM de " +
      "derrubar fixture, e 6 documentos mal formados que TEM de abortar — " +
      "inclusive a fronteira da tolerancia (1 centavo passa, 2 abortam), que a " +
      "1a versao da fixture errou. FIXTURES SINTETICAS: o repo e PUBLICO e " +
      "nenhuma linha de PDF de cliente entra aqui; preserva-se a FORMA, nao o " +
      "dado. Sem banco, sem rede, sem caminho absoluto, sem PDF em disco",
  },
  {
    arquivo: "scripts/bbts_sinal_negativo_gate.cjs",
    nome: "sinal negativo sobrevive ao parser da BBTS (linha CANCELADA do seguro)",
    modo: "self-contained",
    motivo:
      "importa money/SEGURO_RE/CREDITO_RE REAIS e roda sobre linhas copiadas dos " +
      "PDFs de jun e jul/2026; pega Math.abs em money() e a perda do '-?' no " +
      "regex (que faria a linha cancelada sumir em silencio); sem banco, sem " +
      "caminho absoluto",
  },
  {
    arquivo: "scripts/teto_avista_repasse_gate.cjs",
    nome: "teto 5,80%: o repasse sai da comissao-empresa TRAZIDA AO TETO",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + consolidateMonthlyFromClosing real em dryRun; " +
      "o share sai de um run de CONTROLE no proprio gate (nenhuma constante de " +
      "acordo congelada); sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/regua_repasse_vigencia_gate.cjs",
    nome: "regua da Frente C por VIGENCIA (propria > anterior > nenhuma)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + fetchPromoterShareData e " +
      "consolidateMonthlyFromClosing reais; roda as duas ordens de linha para " +
      "provar que a ordem do banco nao decide; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/convenio_zero_padded_gate.cjs",
    nome: "convenio zero-padded: os 6 sitios que comparam com literal normalizam",
    modo: "self-contained",
    motivo:
      "chama as funcoes reais com '000001640' e '1640' e exige a mesma resposta; " +
      "sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/aldalene_inss_carveout_gate.cjs",
    nome: "carve-out INSS da Aldalene: dispara pela TAXA, so nela, so nessa taxa",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + consolidateMonthlyFromClosing real em dryRun; " +
      "o share default sai de um run de CONTROLE (promotora sem carve-out) no " +
      "proprio gate; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/tiquete_min_regua_gate.cjs",
    nome: "tiquete_min (regua x hardcode)",
    modo: "self-contained",
    motivo:
      "le regras_promotiva/json + lib/motor.ts; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/produto_pmr_uma_linha_por_chave_gate.cjs",
    nome: "produto no PMR: uma linha por chave, nunca N (upsert nao repete chave)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria (com a trava de chave repetida do Postgres) + " +
      "applyProdutoRepasseAoPmr real; sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/seguro_sem_duplicata_gate.cjs",
    nome: "seguro do fechamento sai do CASH (a gemea INSURANCE nao soma)",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + consolidateMonthlyFromClosing real em dryRun; " +
      "sem banco, sem caminho absoluto",
  },
  {
    arquivo: "scripts/closing_proposal_rows_pmr_soma_gate.cjs",
    nome: "closingProposalRows: PMR e a SOMA das linhas, nao a primeira",
    modo: "self-contained",
    motivo:
      "Supabase falso em memoria + buildClosingProposalRows/loadClosingPromoterBase reais; " +
      "sem banco, sem caminho absoluto",
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
      "passado verde enquanto 6 telas caiam com 42703. Medido em 21/08, 3 execucoes: " +
      "2,3s / 2,6s / 2,3s — 1 requisicao OpenAPI (0,8s) mais a varredura de app+lib. A " +
      "faixa --db foi de 53,6s para 55,2s de 90s. NAO e self-contained e por isso NAO entra no " +
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
    arquivo: "scripts/carteira_consorcio_dono_ancora_gate.cjs",
    nome: "carteira do promotor: dono pela ancora, nao pela coluna defasada",
    modo: "needs-db",
    motivo:
      "createClient no bloco 3; blocos 1 e 2 sao PUROS. O 2 e a contraprova — o filtro " +
      "ANTIGO (.eq promoter_id) devolve VAZIO no mesmo conjunto, senao o gate nao " +
      "distingue conserto de ausencia de defeito. O 3 mede contra producao: 316 linhas " +
      "com 0 promoter_id gravado, 27 ancoras ASSIGNED, e 198 parcelas entregues pela " +
      "ancora contra 0 pelo filtro antigo. Exercita filtrarCarteiraDoPromotor, a MESMA " +
      "funcao que a rota chama",
  },
  {
    arquivo: "scripts/fila_consorcio_por_parcela_gate.cjs",
    nome: "fila do consorcio lista PARCELA e atribui PROPOSTA",
    modo: "needs-db",
    motivo:
      "createClient; monthly_closing_entries + product_line_assignments de PRODUCAO. " +
      "O bloco 1 prova que as 39 parcelas regulares de jul/2026 viram 39 linhas (e nao " +
      "33, que era a agregacao que escondia 6); o 2 prova que as irmas de uma proposta " +
      "tem a MESMA chave de atribuicao, que e o que faz 'atribuir uma' ser 'atribuir " +
      "todas'; o 3 guarda as 11 ancoras sem parcela no mes, em lista separada e ainda " +
      "atribuiveis; o 4 e a regressao do vazamento (gestor sem comissao_promotor); o 5 " +
      "garante que BBCAP e Conta Corrente nao foram afetados",
  },
  {
    arquivo: "scripts/produto_pmr_empresa_dona_gate.cjs",
    nome: "repasse de produto cai na linha de PMR da empresa DONA",
    modo: "needs-db",
    motivo:
      "createClient; promoter_monthly_results + fechamento de PRODUCAO. O bloco 2 e a " +
      "contraprova (a regra VELHA apontaria para empresa != a da linha com credito, " +
      "criando linha nova); o 3 roda applyProdutoRepasseAoPmr em dryRun e confere que os " +
      "28 buckets (beneficiario, empresa do produto) COLAPSAM em 21 chaves, todas na " +
      "empresa dona; o 4 prova que o produto cai na MESMA linha do credito, que e o que " +
      "faz o .find() de closingProposalRows achar a certa",
  },
  {
    arquivo: "scripts/bbts_carimbo_fechamento_gate.cjs",
    nome: "BBTS: o dinheiro do PDF entra na competencia em que o PDF pagou",
    modo: "self",
    motivo:
      "SELF-CONTAINED: buildAdsCashByPeriod e funcao PURA (entra array, sai Map), entao a " +
      "regra se prova sem createClient e roda no CI. Prova as DUAS metades: a perna do " +
      "pagamento soma pela competencia do FECHAMENTO (nao pela janela das datas do contrato) " +
      "e linha com valor SEM carimbo nao entra em competencia nenhuma e e REPORTADA. A " +
      "fixture reproduz a linha 5240028e (op 221262790, R$ 89,42), que nasceu do DIARIO com " +
      "movement_date 31/07 e recebeu valor de FECHAMENTO por backfill em 28/08: pela janela " +
      "caia em agosto, e o PDF que a pagou e o de JULHO. Provado por MUTACAO em 30/08/2026, " +
      "nos dois sentidos: devolver o leitor a janela derruba 6 assercoes; tirar o carimbo de " +
      "UM dos dois blocos do importador derruba 1 (a contagem e 2 de 2, nao 'pelo menos um'). " +
      "Controles positivos em 2 blocos para nao virar trava geral: PRT e Abertura seguem pela " +
      "competencia literal, e as 4 linhas sadias ficam inteiras sob a mutacao",
  },
  {
    arquivo: "scripts/produtos_detalhamento_escopo_gate.cjs",
    nome: "detalhamento por produto: promotor A nao ve linha de B",
    modo: "needs-db",
    motivo:
      "createClient no bloco 4; os blocos 1-3 sao PUROS (conjunto fabricado com A, B " +
      "e linhas orfas) porque hoje ha ZERO atribuicao e o gate passaria por vacuidade. " +
      "NAO atribui em producao para se testar: PostgREST nao tem transacao, e 'atribui " +
      "e desfaz' sao dois writes — queda no meio deixaria atribuicao real, que muda " +
      "repasse. O bloco 4 fica DECLARADO PENDENTE e ACORDA sozinho quando houver ASSIGNED. " +
      "CUSTO, medido em 30/08/2026: era 150,5s (628 requisicoes, 140,5s de rede, media de " +
      "0,22s cada — N+1, nao consulta lenta). Com memo do builder e o cruzamento em memoria " +
      "foi a 28,4s COM MAIS cobertura (matriz 24x24 completa, 552 pares, contra 115). Ver (3d)",
  },
  {
    arquivo: "scripts/consorcio_gestor_por_proposta_gate.cjs",
    nome: "gestor de consorcio por proposta (base bate, so o centavo diverge)",
    modo: "needs-db",
    motivo:
      "createClient; monthly_closing_entries de PRODUCAO. Blocos 1 e 2 sao PUROS " +
      "(conjunto fabricado; o 2 monta de proposito um caso em que 1 round e N rounds " +
      "divergem, para o gate nao passar por vacuidade quando os dois concordarem); o 3 " +
      "confere jun e jul/2026 — base IDENTICA nas duas reguas e delta em centavos; o 4 " +
      "guarda que a proposta vendida pelo PROPRIO gestor continua na base dos 10%; o 5 " +
      "prova que o 42703 da migration ausente nao derruba o reconsolidar; o 6 executa o " +
      "codigo REAL com escritas interceptadas e prova que competencia FECHADA nao recebe " +
      "upsert de agregado (mas recebe detalhe), com o lado ABERTO fabricado para o teste " +
      "nao passar por meia prova",
  },
  {
    arquivo: "scripts/produtos_visibilidade_comissao_gate.cjs",
    nome: "comissao do promotor nao vaza para quem nao tem direito",
    modo: "needs-db",
    motivo:
      "createClient; monthly_closing_entries + product_line_assignments de PRODUCAO. " +
      "O bloco 1 e puro (a regua por papel); o 2 monta o payload REAL da fila como " +
      "gestor_consorcio e varre em profundidade; o 3 monta como socio e exige o campo " +
      "COM valor (sem ele o gate passaria com a rota devolvendo vazio); o 4 garante que " +
      "empresa e gestor continuam visiveis — suprimir demais seria outro bug",
  },
  {
    arquivo: "scripts/reatribuicao_precedencia_gate.cjs",
    nome: "reatribuicao manual: o diario vence a chave J",
    modo: "needs-db",
    motivo:
      "createClient; monthly_closing_entries + daily_production_records de PRODUCAO. " +
      "O bloco 1 e puro; o 2 prova que a precedencia ANTIGA punha os 5 contratos " +
      "medidos de jul/2026 no dono da chave (contraprova, para o gate nao passar por " +
      "vacuidade); o 3 prova o FALLBACK numa competencia sem diario (2026-01); o 4 " +
      "impede a precedencia voltar a ser escrita a mao nos consumidores",
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
    arquivo: "scripts/gate_trp_vigencia_intra_mes.cjs",
    nome: "TRP - vigencia INTRA-MES (a TRP39 a partir de 05/08)",
    modo: "needs-db",
    motivo:
      "3,2s; createClient; trp_rule_versions de PRODUCAO. FASE 1 da frente da " +
      "vigencia intra-mes: o resolvedor tolera N reguas ativas por competencia e " +
      "escolhe pela contract_date. 4 blocos: (A) TRANSICAO, o resolvedor novo x o " +
      "de origin/main extraido por `git show` e carregado NO MESMO RUN (nao e " +
      "constante congelada) -- MORRE no merge, e o gate diz isso em voz alta em " +
      "vez de passar por vacuidade; (B) INVARIANTE PERMANENTE, competencia de " +
      "regua UNICA resolve independente da data (122 dias medidos em 4 " +
      "competencias) + o percentual do motor com sonda identica dia a dia; (C) o " +
      "CASO CONCRETO sobre FIXTURE (agosto partido: 03-04/08 -> TRP38, 05-06/08 " +
      "-> TRP39, as 2 fronteiras, os 2 buracos de vigencia e a cascata sobre mes " +
      "partido); (D) AUSENCIA -- reprova sem service_role/TRP_SOURCE/competencia. " +
      "Dentes MEDIDOS por 5 mutacoes, 5 de 5 acusadas (a M5, rowValidUntil, so " +
      "passou a ser pega depois de acrescentar o buraco a DIREITA). O stub HONRA " +
      "os .order() do resolvedor de proposito: um stub que ordenasse sozinho " +
      "media o stub, e foi assim que a M2 passou verde na 1a versao. " +
      "FICA na --db, e nao em LENTO, com a medicao na mesa: a faixa JA estourava " +
      "o teto ANTES desta frente -- 119,1s de 90s medidos em worktree no proprio " +
      "origin/main (71c9379) em 31/08/2026, com os MESMOS 3 gates vermelhos " +
      "(produto_pmr_empresa_dona rc=1, gate-srcc-ads rc=1, check_audit_v9 rc=4, " +
      "os tres reproduzidos isolados na base). Com este gate: 120,3s e 123,7s em " +
      "duas execucoes, 3 vermelhos IDENTICOS, executados 30->31 e passaram 27->28. " +
      "A regra 'nao se engorda banda estourada' (ver gate-avista-vs-fechamento) " +
      "foi escrita para um gate de 185-358s; este custa 3,2s, menos que a variacao " +
      "entre execucoes da propria faixa. A divida do teto e ANTERIOR e continua " +
      "NOMEADA -- ela nao e desta frente e nao foi paga por ela.",
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
    arquivo: "scripts/gate_provider_repassa_data.cjs",
    nome: "provider repassa a contractDate (a classe 'provider sem data')",
    modo: "self-contained",
    motivo:
      "0,3s; so le fonte, sem banco e sem env. Vigia a CLASSE que apareceu TRES " +
      "vezes em 24h (02/09/2026): os diagnosticos nomeados no handoff (nota que " +
      "estava ERRADA e foi remediada), o script de medicao da propria frente, e o " +
      "paridade_avista_trp_gate, que acusou a producao de uma divergencia que ela " +
      "NAO tem. Anatomia identica: construidos antes da Fase 1, corretos com UMA " +
      "regua por competencia, silenciosamente errados desde que agosto virou a " +
      "primeira competencia PARTIDA. Assercao dura: nenhuma chamada de " +
      "getResolvedSync/getRegraSync em lib|app|components com 1 argumento (hoje 5 " +
      "sitios, todos com data). scripts/ tem ALLOWLIST ASSINADA, hoje VAZIA, com " +
      "checagem de entrada MORTA (consertou e nao tirou da lista = reprova). " +
      "MUTACAO: um scanner que so testa a existencia da chamada aprova a fixture " +
      "sem data; os dois vereditos divergem. LIMITE: casa 2 funcoes por nome — " +
      "um terceiro caminho de resolucao passa invisivel, e a defesa e a regra " +
      "escrita no handoff. A parte VIVA (com e sem data tem de dar fatias " +
      "diferentes) e o bloco (E) do gate_trp_vigencia_intra_mes, que ja e needs-db",
  },
  {
    arquivo: "scripts/gate_trp_override_vigencia.cjs",
    nome: "TRP - override de vigencia + ANTEPARO DO BURACO",
    modo: "self-contained",
    motivo:
      "1,5s; sem banco, sem env, sem PDF. FASE 3 bloco 2: o override que vem do " +
      "e-mail da Promotiva (a TRP39 a partir de 05/08) atravessa staging -> " +
      "commit -> RPC. E O UNICO PONTO DA FRENTE QUE PODE DERRUBAR PRODUCAO: " +
      "subir regua com override numa competencia sem regua deixa o inicio do mes " +
      "DESCOBERTO e o resolvedor lanca TrpVigenciaGapError, que PROPAGA " +
      "(/promotores, /recebiveis, motor). O banco nao cobre: o EXCLUDE recusa " +
      "fatias que se CRUZAM, e buraco nao cruza nada. 6 blocos, 4 mutacoes: (1) " +
      "sem o `>` estrito o inicio da janela seria aceito e gravaria override que " +
      "nao parte nada; (3) sem o anteparo a chamada CHEGA ao RPC e o buraco " +
      "nasce, e tomar fatias[0] em vez do MAXIMO aprovaria override que reescreve " +
      "regua viva por baixo de outra (a 1a versao deste gate reprovou por isso e " +
      "o conserto foi no CODIGO, nao no stub); (5) ler o override do body em vez " +
      "da LINHA do staging traria data que ninguem revisou. CONTROLE POSITIVO no " +
      "bloco 4: sem override o RPC recebe os MESMOS 11 parametros, p_valid_from = " +
      "janela derivada, e ZERO leitura nova de trp_rule_versions",
  },
  {
    arquivo: "scripts/gate_trp_carimbo_multi_versao.cjs",
    nome: "TRP - carimbo em competencia PARTIDA (multi_versao)",
    modo: "self-contained",
    motivo:
      "0,7s; sem banco e sem env. FASE 3 bloco 1 da vigencia intra-mes: numa " +
      "competencia partida o PMR grava trp_version_id NULL + trp_multi_versao " +
      "true, porque carimbar a ultima regua seria afirmacao FALSA QUE CONFERE " +
      "para os 83 contratos de 31/07-04/08. 6 blocos, dois deles de MUTACAO com " +
      "o criterio errado reimplementado no proprio gate e comparado: (A) o " +
      "carimbo de 31/08 gravaria a TRP39 e o detector diria OK verdinho; (B) " +
      "classify lendo `!multiVersao` reclassificaria TODO o historico (NULL) " +
      "como MULTI_VERSAO e apagaria o detector em silencio. O bloco 5 roda o " +
      "detector REAL sobre stub de Supabase e prova que a partida sai " +
      "MULTI_VERSAO e nao DESCONHECIDO (que seria alerta imortal no " +
      "ledgerHealth), e ASSERTA a divida (ii): partida nunca entra na oferta de " +
      "reconsolidacao. O bloco 6 varre app/ e lib/ atras de escritor novo de " +
      "trp_version_id fora dos 4 conhecidos",
  },
  {
    arquivo: "scripts/detector_regua_camada1_gate.cjs",
    nome: "detector de regua - camada 1",
    modo: "self-contained",
    motivo:
      "RECLASSIFICADO em 29/08/2026, de needs-db para self-contained. Ele NUNCA " +
      "precisou de banco: as assercoes sempre foram estaticas (fonte de " +
      "lib/bbtsMonthly + classify() puro) e a unica parte que tocava o banco era " +
      "um smoke que so IMPRIMIA, sem nenhum ok() atras. Medido: rodando os 30 " +
      "needs-db com credencial FALSA, este passou (exit 0) porque nao precisava " +
      "de uma. Nao era vacuidade, era classificacao errada — e cara: pagava o " +
      "preco da faixa que ninguem roda. O smoke foi REMOVIDO (a pergunta dele ja " +
      "e respondida por gate_schema_colunas.mts, para as 2.844 colunas do codigo), " +
      "junto do readEnv() proprio, que violava o criterio (b). Agora roda no CI",
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
    arquivo: "scripts/gate-avista-vs-fechamento.mts",
    nome: "% a vista: a nossa coluna x o carimbado pelo FECHAMENTO",
    modo: "needs-db-lento",
    motivo:
      "REGISTRADO em 29/08/2026, depois de 6 semanas ORFAO. Ele nunca esteve fora por " +
      "vermelho — estava fora por INSTABILIDADE (morte no teardown do libuv, exit " +
      "3221226505, observada 1 vez em 4 execucoes em 01/08). As 10 execucoes que o " +
      "handoff daquela frente pedia e ninguem fez, feitas agora em serie: 10 de 10 com " +
      "rc=0 e 'GATE OK', entre 7,8s e 10,2s. Um crash em 10 teria sido reprovacao. " +
      "createClient; compara company_received_percent com o '% A VISTA' que o " +
      "fechamento da Promotiva carimba no metadata de cada linha CASH — e a conferencia " +
      "que teria pego o bug da faixa do CNPJ. Entra em LENTO, nao em needs-db, porque a " +
      "faixa --db ja estoura o teto de 90s: nao se engorda banda estourada. (O numero " +
      "deste motivo dizia 358,4s, de 29/08; remedido em 30/08/2026 — 290,7s antes do " +
      "conserto do produtos_detalhamento_escopo e 185,4s/193,2s/193,2s depois dele. O " +
      "teto segue estourado nas cinco medicoes, que e o que sustenta a decisao; so o " +
      "numero envelheceu.)",
  },
  {
    arquivo: "scripts/mov2_proposals_get_gate.cjs",
    nome: "proposals GET lista o fechamento real (nao o cms vazio)",
    modo: "needs-db-lento",
    motivo:
      "REGISTRADO em 29/08/2026, depois de 6 semanas ORFAO. Passa (rc=0) e custa 138,6s — " +
      "por isso LENTO. A razao de registrar nao e o verde: e que ele e uma das DUAS unicas " +
      "provas de lib/promoterReportData.ts (174 linhas, consumida por " +
      "app/api/commissions/proposals/route.ts, app/api/promotores/route.ts, " +
      "PromotoresClient.tsx, lib/closingProposalRows.ts e lib/report.ts). Varrido em " +
      "29/08/2026: NENHUM gate registrado tocava esse modulo. Aposenta-lo apagaria a " +
      "unica cobertura, nao reduziria ruido",
  },
  {
    arquivo: "scripts/companyscope_grupo_gate.cjs",
    nome: "resolveCompanyScope traduz grupo em company_ids (nunca 'grupo:*' cru)",
    modo: "needs-db",
    motivo:
      "NASCEU em 29/08/2026 da SEPARACAO de scripts/test_ads_status_e_grupo.cjs, que e " +
      "orfao por construcao (le um xlsx de cliente em Downloads, que nao pode ser " +
      "versionado — o repositorio e PUBLICO). Aquele arquivo tinha duas metades que nao " +
      "envelhecem juntas: contagem congelada do PR #84 (morreu la) e esta invariante " +
      "permanente. lib/companyScope.ts (30 linhas, consumida por " +
      "app/api/calculate/monthly/route.ts e lib/promoterAnalytics.ts) NAO TINHA NENHUM " +
      "portao registrado; este e a unica prova continua dele. createClient so para ler " +
      "companies; 7 assercoes, com guarda de anti-vacuidade que reprova se nao houver " +
      "grupo no banco, e recusa honesta (exit 2) quando falta credencial",
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
  {
    arquivo: "scripts/agregado_orfao_gate.cjs",
    nome: "agregado orfao: o import nao esvazia, o cancel recusa, o vigia acende",
    modo: "self-contained",
    motivo:
      "38 assercoes, 3 blocos. (1) ANCORAS no fonte de monthlyClosingImport.ts: o " +
      "delete do detalhe legado vem DEPOIS do insert, tem .neq(importId) e guard de " +
      "rowsToInsert, e o recorte AMPLO continua la — as ancoras sao CONTADAS, porque " +
      "`insert(slice)` aparece duas vezes no arquivo e ancorar na de syncProductLines " +
      "fazia a assercao de ORDEM passar COM o codigo defeituoso. (2) a funcao POST " +
      "REAL do cancel contra o espelho scripts/_fakeFechamento.cjs, com TRES controles " +
      "positivos para nao virar trava geral: cancel legitimo passa, FME zerada nao " +
      "trava (o caso 2023-12 AL1) e a competencia vizinha sai byte-identica. (3) o " +
      "vigia 'agregado_sem_detalhe' acende para agregado COM VALOR e fica quieto para " +
      "o ZERADO. Empresa e dados sao FIXTURE (stubReal), nao o banco. Provado por " +
      "mutacao em 28/08/2026, medido NESTE arquivo (nao no gate combinado de antes " +
      "da separacao): reverter a ordem do import derruba 3; tirar a guarda do cancel " +
      "derruba 9; remover o vigia derruba 8; remover a distincao da FME zerada derruba " +
      "2. Sem banco, sem .env, sem caminho absoluto",
  },
  {
    arquivo: "scripts/cancel_agregado_orfao_gate.cjs",
    nome: "agregado orfao: o import REAL nunca zera a competencia, e o dano existe hoje",
    modo: "needs-local",
    motivo:
      "A METADE NAO CI-AVEL do gate acima, e o registro existe para que essa metade " +
      "seja NOMEADA em vez de esquecida. needs-local E needs-db ao mesmo tempo: le o " +
      "xlsx C23677_..._Todos_2_2025.xlsx em C:/Users/diego/Downloads (1,7 MB de dado " +
      "de cliente, que nao esta e nao pode estar versionado) E chama createClient para " +
      "medir producao. CONSEQUENCIA, dita com todas as letras: o CI NUNCA executa " +
      "estas 8 assercoes — elas so acontecem quando alguem roda `npm run gates:full` a " +
      "mao. E o bloco 2, o vigia acendendo em PRODUCAO (2025-02 RR ALAGOAS 1, " +
      "operacoes=6.491, valor_liquido=97.535,61, zero entries), e justamente o que " +
      "impede o check de nascer verde por vacuidade: no gate self-contained o dano e " +
      "fixture, aqui e o banco. O bloco 1 roda importMonthlyClosingWorkbook REAL contra " +
      "o espelho com um observador de contagem apos cada escrita (invariante: nunca " +
      "toca ZERO tendo comecado com detalhe; a ordem antiga mostra `delete 400 -> 0`). " +
      "Mutacoes medidas NESTE arquivo em 28/08/2026: reverter a ordem do import derruba " +
      "1 assercao (a do trace); remover o vigia derruba 2; remover a distincao da FME " +
      "zerada derruba 1. " +
      "So vira CI-avel se o xlsx virar fixture no repo — o que exigiria versionar dado " +
      "de cliente, entao fica como divida NOMEADA, nao como plano",
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
