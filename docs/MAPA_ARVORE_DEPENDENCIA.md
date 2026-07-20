# Sistema RR — Mapa da Árvore de Dependência (Frente Estrutural, passo 1)

**Data do levantamento:** 13/07/2026
**Natureza:** read-only, nada foi alterado no código ou banco.
**Objetivo:** enxergar onde o sistema recomputa a mesma grandeza de formas
diferentes ("retalho"), antes de desenhar a convergência.

---

## Achado central

**O ledger canônico já existe:** é o `promoter_monthly_results` (PMR), com
a chave `(promoter_id, year, month, company_id)`.

O problema **não é ausência de camada** — é falta de **contrato** sobre a
camada que já existe:

1. **Quatro consolidadores** escrevem no PMR com **réguas diferentes**.
2. Os **leitores não concordam** sobre qual `source` ler em cada regime.

**A fratura raiz:** o PMR com `source='fechamento'` **não é escrito por
nenhuma rota** — só por script (`scripts/rodarClosingMonthly.ts`,
`scripts/rodarBbtsOrchestrator.ts`). Enquanto isso, `/api/calculate/monthly`
em regime fechado (junho+) ainda chama `consolidateMonthlyFromCms`, que lê
`cms_promoter_entries` — **tabela que não é mais alimentada**. Logo, o
ledger de junho+ só existe se alguém rodar um script manual. É a origem de
"cada tela mostra um número".

---

## A. Fontes de verdade

### Produção — 6 fontes, 3 conceitos distintos

| Fonte | Conceito | Escreve | Lê |
|---|---|---|---|
| `daily_production_records` | bruto por proposta, mês vivo | `dailyRecordMerge` (único gravador) | ~15 consumidores |
| `promoter_monthly_results` (PMR) | consolidado promotor+mês+empresa | 4 escritores (abaixo) | ~10 consumidores |
| `monthly_closing_entries` | o que o banco pagou (CASH/PRT/INSURANCE) | `closingImportPipeline` | fechamento, auditoria, recebíveis |
| `cms_promoter_entries` | ground-truth do repasse (jan–mai/26) | `runCmsImportPipeline` | cmsMonthly, report, dashboard |
| `producao_contrato` | materialização tipada do PRT | SQL fn | só carteira_contrato |
| `carteira_contrato` | carteira viva / saldo a receber | SQL `fn_materializar_carteira_contrato()` | recebiveis/prtAgenda |

Os dois últimos são **derivadas do PRT**, não fontes concorrentes. Estão certos.

### Os 4 escritores do PMR — réguas incompatíveis

- `consolidateMonthlyFromCms` → `source='cms'` — reproduz o cms, sem teto/acordo/faixa.
- `consolidateMonthlyFromClosing` → `source='fechamento'` — acordo por contrato, faixa 5,80%, penetração individual.
- `consolidateMonthlyFromBbts` → `source='bbts'` — TRP Promotiva Faixa 3, teto 5,80%.
- `/api/calculate/monthly:POST` → `source='daily'` — motor ao vivo.

### Regime do mês — 1 definição canônica, 11 reimplementações

- Canônica: `lib/cmsMonthly.ts:detectMonthRegime` (retorna cms/fechamento/open).
- Mas `detectClosedMonth` colapsa cms e fechamento num **booleano** — e é o
  booleano que quase todo mundo consome.
- Reimplementações: `dre.ts:104` (ignora `monthly_closing_imports`),
  `historicoMensal.ts:94` ("fechado = mês ≠ atual"), 3 telas comparam
  `new Date()` na mão.

---

## B. Consumidores — quem recomputa vs deriva

| Tela | Produção | Comissão | Recomputa? | Respeita regime? |
|---|---|---|---|---|
| Dashboard | PMR/daily | cms/motor | Sim (status, competência, teto, seguro) | Sim (booleano) |
| Projeção | PMR/daily janela própria | — | Sim (holiday-aware, ritmo, seguro) | Sim |
| Promotores | PMR por source/escopo | PMR/daily | Sim (elegibilidade, teto) | **Sim — única com detectMonthRegime completo** |
| Financeiro/Caixa | não lê produção | Σ PMR M-1 | Deriva | Não |
| Recebíveis | daily janela | recomputa resolveAvistaTrp | Sim | Não (usa "existe fechamento?") |
| Auditoria RR | monthly_closing_entries | recomputa | Sim | Não (by design) |
| Auditoria BBTS | daily ADS | resolveBbtsRegra Faixa 4 teto 6% | Sim | Não (by design) |
| Fechamento | daily | motor/gravado | Sim | Não |
| Equipe | vw_team_production (daily) — **ignora PMR até em mês fechado** | — | Sim | Não |
| DRE | — | PMR competência M | Deriva | Sim |
| Relatórios | PMR sem closedSource → `.find()` de 1 linha, não soma RR+ADS | idem | Deriva | Parcial |

### Pares que leem a mesma grandeza de fontes diferentes (mais graves)

- **"Produção do promotor no mês"** tem 3 respostas: promoterAnalytics
  (daily mês inteiro), projecaoMetas (daily janela+corte hoje),
  teamProduction (vw_team_production sem corte). Em mês fechado, Equipe
  continua no diário.
- **"Comissão paga do mês"**: Financeiro soma todas as linhas do PMR
  (inativos incluídos, qualquer source) em M-1; DRE soma só ativos em M.
- **% à vista por contrato**: 4 motores, 3 tetos — promoterAnalytics→motor
  (política Promotiva), recebiveis (6%), conferenciaTrp (6% liso).

---

## C. Regras repetidas — o retalho concreto

| Família | Implementações | Veredito |
|---|---|---|
| Elegibilidade | 9 (+1 runtime) | **Divergem.** bbtsMonthly/closingProposalRows não exigem PRODUCAO — contam LIQUIDADO. Só 3 leem `__bbts_meta.cancel`. SRCC é o único eixo uniforme. |
| Competência | 8 noções | **Divergem.** Uma linha por `productionPeriodFromValue`, junho por calendário puro (proposalDetailing). `productionPeriod.ts` não é holiday-aware apesar de chamada de canônica. Coincidem hoje por acaso. |
| Régua | 7 caminhos | **Divergem.** ADS: conferência usa resolveBbtsRegra (BBTS Faixa 4 teto 6%); quem grava o PMR usa calcularOperacao (TRP Promotiva Faixa 3 teto 5,8%). Fallback difere: sem regra, creditAvistaTrp paga zero. |
| Teto/diferido | 5 tetos, 4 splits | **Divergem.** 0.06 duplicado; bbtsMonthly.ts:189 corta o diferido no teto do promotor (5,8%) — operação 6,1% gera diferido 0,3% onde outros geram 0,1%. |
| Faixa por volume | 8 fontes | **Divergem.** monthlyVolumesMap não filtra status nem SRCC — volume da escala inclui cancelada. Duas escalas de seguro incompatíveis. |

---

## D. O que JÁ é canônico — não mexer

- **TRP no banco:** `trp_rule_versions` + `resolveTrpRegraDb` + preloader. Alicerce.
- **Régua BBTS:** `bbts_rule_versions` + `resolveBbtsRegra` genérico (versão ativa + fallback cascata).
- **Régua única de débitos:** `lib/debitRules.ts:debitAmountFor`.
- **detectMonthRegime:** a definição está **certa**. Problema é adoção, não desenho.
- **dailyRecordMerge:** gravador único do diário, merge por dono.
- **producao_contrato / carteira_contrato:** derivadas, não concorrentes.
- **Chave do PMR** `(promoter_id, year, month, company_id)`: correta.

---

## Ranking do retalho — do pior pro menor

### Bugs de código (corrigíveis JÁ, não esperam o ledger)
- **[2]** `bbtsOrchestrator.ts:111` — query ADS **sem filtro de competência** (`.eq("company_id")` só). Soma a ADS inteira de todos os meses; alimenta meta e penetração. **Bug ativo.**
- **[3]** `invalidateMonthlySnapshots` (import/daily/route.ts:233) deleta PMR **sem filtrar source** — re-import diário apaga linhas cms/fechamento/bbts.
- **[14]** "BELOW_META" vs "ABAIXO" — vocabulário de meta incompatível.

### Retalho arquitetural (desenho do passo 2)
1. **PMR `source='fechamento'` não é escrito por nenhuma rota.** Junho+ em regime 'fechamento', mas `/api/calculate/monthly:641` chama `consolidateMonthlyFromCms`. Raiz de "cada tela mostra um número".
4. `detectClosedMonth` colapsa cms e fechamento — consumidor com só o booleano lê fonte errada em jun+.
5. Competência M-1 (caixa) vs M (DRE), sobre populações diferentes (todos vs só ativos). Dois "comissão paga" que nunca batem.
6. Duas réguas para a mesma operação ADS (conferência Faixa 4 vs gravação Faixa 3) — auditoria acusa subpagamento contra um devido que o sistema não usa pra pagar.
7. bbtsMonthly conta LIQUIDADO (não exige PRODUCAO).
8. Split do diferido no teto errado (bbtsMonthly.ts:189).
9. Equipe ignora o PMR em mês fechado (vw_team_production).
10. report.ts/dre.ts usam `.find()` sem closedSource — não somam RR+ADS; promotor multi-empresa truncado.
11. Duas escalas de seguro (motor.ts:297 viva, cortes 0,6/0,4/0,2 vs oficiais 0,30/0,21/0,11).
12. monthlyVolumesMap sem filtro status/SRCC — infla a escala.
13. 11 reimplementações do regime do mês (pior: dre.ts:104).

---

## Direção do passo 2 (a desenhar, ainda NÃO decidido)

O ledger existe (PMR). A convergência é **contrato**, não construção:
1. **Um escritor canônico** do PMR por regime (não 4 réguas soltas).
2. **Leitores concordam no source** por regime (via detectMonthRegime, não o booleano).
3. Convergir leitor por leitor com **paridade provada** (como o motor TRP db):
   nenhum número muda até que se prove que deve mudar.

Bugs [2], [3], [14] são corrigidos ANTES, pra o mapeamento não ser sobre
dados contaminados.

---

## Movimento 1 — decisões (13/07)

- **Furo 1 (best-effort):** decidido **A** — consolidação dentro do
  runImportPipeline, antes de COMPLETED. Invariante "regime fechado ⇒ PMR
  fechado existe" garantido. Sem isso, recria o buraco do abril.
- **Reconciliação:** apaga as sobras source='daily' da competência fechada
  (hoje seguras só porque zeradas — sorte, não desenho). PMR fechado = só
  o conjunto recém-calculado. Também apaga órfãos (conjunto que encolhe).
- **Abril:** entra como BACKFILL explícito (não automático) via botão
  "reconsolidar competência" — mesmo mecanismo de /api/import/closing/ads
  e re-fechamentos. Abril está em regime fechamento com PMR 100% daily=60
  fósseis; /promotores mostra zero. É buraco a fechar, não só junho.
- **Paridade (2 etapas):** (1) estrutural — dry-run bate tudo exceto seguro;
  delta do seguro = exatamente +1,50 do bug 2; qualquer outra divergência
  reprova. (2) adoção — reconsolidar junho 1x pra absorver os corrigidos.
- **1 chamada:** consolidateMonthlyGroup (RR+ADS com injeções), não os
  consolidadores soltos.
- **Função compartilhada:** reconsolidarCompetenciaFechada — usada pela
  rota de fechamento, pela de ADS, e pelo botão de backfill.

---

## Movimento 1 — resultado (13/07)

- **Premissa "+1,50" estava ERRADA.** O PMR de junho gravado no banco não
  é pré-fix do bug 2 — é bem mais antigo (seguro bbts gravado=44,83, a
  âncora antiga; pré-fix era 39,66; hoje 41,16). Veio de script rodado
  quando o dado ADS era outro. Ex: proposta 213983877 (Kétley, mov 30/06)
  hoje cai em julho pela janela, saiu de junho; PMR gravado ainda conta
  em junho (count=2 vs 1 hoje). Divergência real = 4 campos, delta seguro
  −3,66. **O ledger está congelado no último script manual — é a fratura
  que o Mov 1 fecha.** Gate contra banco velho NÃO devia passar.
- **No-op correto:** hash das rows branch == main (bc6150895c39dabd,
  crédito 109.538,42, seguro 3.490,65). O código não move o cálculo; as
  divergências vs banco são defasagem de dado, absorvida pela Etapa 2.
- **empresaEmVoo:** o import marca COMPLETED por empresa no fim; a última
  empresa não se veria fechar. Resolvido estendendo a função canônica
  (antecipa o COMPLETED iminente), NÃO duplicando a regra de cobertura.
- **Abril:** reconsolidar produz 39 linhas reais (prod R$4.059.206,31),
  apagaria 21 fósseis. Backfill pós-merge.
- **Pós-merge, na ordem:** (1) POST /api/pmr/reconsolidar {2026,6};
  (2) POST /api/pmr/reconsolidar {2026,4} backfill abril; (3) daí o
  fechamento escreve o PMR sozinho.

---

## Movimento 2 — iniciado (13/07)

Alvo: trocar o booleano detectClosedMonth pelo enum detectMonthRegime
(cms/fechamento/open) em todos os consumidores, pra concordarem no source.
Hoje só /promotores usa o enum completo. Delicado: mexe na LEITURA de cada
tela (o Mov 1 era aditivo na escrita). Disciplina de paridade rígida:
cada consumidor prova que o número não muda, OU muda só onde o Mov 1
consertou (abril/junho com PMR fechado real agora). Distinguir "mudou
porque consertou" de "mudou porque quebrei" — só o mapeamento diz.
Começa por levantamento read-only, não por código.

## Movimento 2 — mapa (13/07)

Achado: o booleano responde 2 perguntas. "Mes aberto?" (binaria, colapso
cms==fechamento proposital, 3 consumidores leem CERTO) vs "De qual fonte
leio?" (3 respostas, booleano colapsa em cms, cms vazio em abr/jun, 4
consumidores leem ERRADO).

GRUPO A (no-op, colapso proposital -> vira regime==='open'):
- debitsData:409 resolveCompetenciaAberta
- projecaoMetas:184
- proposals PUT:609/DELETE:734 (bloqueio edicao; +corrige texto 403 que
  diz "cms" pra mes de fechamento)
Gate: nenhum numero muda abr/jun/jul.

GRUPO B (conserto, muda numero pro certo -> valida na tela):
1. Dashboard:125 - comissao bruta abr/jun sai de R$0,00 (cms vazio) pro
   fechado real. Passa closedSource ao analytics.
2. Proposals GET:207 - editor de propostas abr/jun deixa de estar vazio
   (buildClosingProposalRows, o que /promotores ja usa).
3. Relatorios (report.ts:183->2403,2571) - closedSource mata o .find()
   legado (junho trunca 4 promotores RR+ADS: 118.227,41 correto vs
   115.513,83 legado).
4. DRE (dre.ts:177) POR ULTIMO - agravante: listClosedPeriods:104
   reimplementa cobertura lendo so cms_imports, ignora
   monthly_closing_imports -> junho nunca aparece no DRE. Trocar booleano
   nao basta; tem que matar a reimplementacao. Maior risco.

RISCO: os 3 do Grupo A viram regime==='open' (NEGADO), nunca
'fechamento' - senao tratariam mes cms como aberto. Colapso proposital
confirmado nos 3.

## Movimento 2 — COMPLETO (13/07)

Grupo A (no-op): debitsData, projecaoMetas, proposals PUT/DELETE viram
regime!=='open'. Grupo B (conserto de fonte):
- Dashboard: comissao abr/jun R$0->real; +seletor de competencia.
- Proposals GET: editor abr/jun vazio->494/726 linhas. Achado: universo
  de promotores tambem vinha do cms vazio.
- Relatorios: mata .find() legado. Junho +R$2.713,58 (4 promotores RR+ADS
  truncados). Abril -R$163,52 (chave master recebia comissao - achado).
- DRE (o mais arriscado, 4 defeitos p/ 2 previstos): cobertura
  (listClosedPeriods so lia cms_imports; junho/abril nao apareciam ->
  agora aparecem via detectMonthRegime). Fonte (enum+closedSource,
  analyticsRegimeArgs movido pro cmsMonthly, 1 lugar). ACHADO 3: ADS
  active=false sem receita fabricaria prejuizo -> excluida com alerta.
  ACHADO 4 (regressao evitada): mes com fechamento mas 0 PMR daria
  resultado falso -> guarda dura (so entra se tiver base de comissao).

LICAO: "telas concordam" = leem a MESMA FONTE (PMR), nao o mesmo valor
final. DRE mostra LIQUIDO (descontos, so ativos, sem ADS): 111.695,39;
as telas de operacao mostram BRUTO: 118.227,41. Convergencia de fonte,
nao de valor. Cada tela aplica suas transformacoes legitimas por cima do
mesmo PMR.

detectClosedMonth (booleano) saiu de proposals/report/dre; sobra como
wrapper no cmsMonthly so pra pergunta binaria "aberto?". FALTA Movimento
3 (telas viram views derivadas de vez).

---

## Movimento 3 — iniciado (13/07)

Alvo: telas param de RECOMPUTAR, viram views derivadas do PMR. Mais
nebuloso que Mov 1/2. RISCO: confundir recomputacao LEGITIMA (DRE aplica
descontos/ativos - natureza dele, nao retalho) com recomputo DIVERGENTE
(retalho). Comeca por mapeamento que separa os dois, tela por tela.
Conteudo concreto = o ranking do retalho restante (itens 5,7,8,11,12), nao
"reescrever tudo" abstrato. Cada recomputo divergente atacado com paridade.

## Movimento 3 — retalho real RESOLVIDO (13/07)

Reclassificacao do ranking:
- Item 7 (LIQUIDADO): NAO era retalho. ds_transacao='Contratacao CDC'
  filtra no PORTAO do import (bbtsDailyImport:240-243); Proposta CDC e
  Cancelamento nem chegam em daily_production_records. Producao ADS julho
  100% Contratacao CDC (12 linhas R$143.747,75) - certa. LIQUIDADO = so
  andamento, irrelevante. (Ressalva: regra num lugar so; fechamento_pdf
  grava sem ds_transacao mas so lista o que o banco pagou - sem 2a linha
  de defesa no consolidador, endurecer se um dia entrar linha por outro
  caminho.)
- /equipe (feat/ledger-mov3-equipe): ULTIMO leitor fora do consenso.
  Recomputava do diario em mes fechado. Convergido pro PMR (mesmo client
  admin/colunas da serie, sem migration). 3 consertos: jan-mai R$0->real;
  abril/junho -> PMR; proposta 213615547 (SRCC R$80k, false no diario)
  saiu. AS 4 TELAS DE PRODUCAO CONCORDAM. Mascaramento preservado (gestor
  nao ve comissao). Julho open no-op.
- Item 5 (M-1 caixa vs M DRE): deslocamento LEGITIMO (caixa vs
  competencia, nao tocar). MAS retalho de POPULACAO: DRE exclui inativos
  que o caixa paga (delta R$3.490,47 = inativos 483,85 + ADS 3.006,62).
  DECISAO DE NEGOCIO pendente do Diego: DRE inclui inativos OU caixa
  exclui.
- Item 8 (split diferido): diagnostico, nao load-bearing no PMR; R$20/mes;
  amarrado ao item 6 (regua ADS 5,8% vs auditoria 6%).
- Item 11 (2 escalas seguro motor:297): CODIGO MORTO (seguro.promotor
  ninguem le). Item 12 (monthlyVolumesMap sem filtro): mina latente,
  impacto zero (share efetivo nao muda). detectClosedMonth: sem call-site
  vivo. -> FAXINA num PR, nao muda numero.

SOBRA do Mov 3: (1) faxina 11/12/detectClosedMonth (1 PR, no-op);
(2) decisao de negocio item 5 (DRE vs caixa inativos).

## Item 5 (populacao DRE) — DECISAO DE NEGOCIO do Diego (13/07)

Diego: "Deve incluir sim, caixa e DRE nao se exclui nada que saiu ou
entrou." -> se comissao foi PAGA, e custo real, entra no DRE. Inativos E
ADS incluidos.

IMPLICACAO: reabre a exclusao da ADS do DRE que o Mov 2 (item 4 Grupo B)
tinha feito "com alerta" pra nao fabricar prejuizo. A regra do Diego diz
que aquela exclusao estava errada. MAS: incluir so a COMISSAO da ADS
(R$3.006,62) sem a RECEITA da ADS refabrica o prejuizo - a receita ADS
NAO esta em fechamento_mensal_empresa (ADS fatura pela BBTS, outro
caminho). CORRETO = representar a ADS INTEIRA (receita + despesa), nao so
incluir a comissao. Precisa achar de onde vem a receita da ADS.
Inativos (R$483,85) = simples, entra direto (producao deles ja esta la).

## Movimento 3 — COMPLETO / FRENTE ESTRUTURAL FECHADA (13/07)

Item 5 (DRE inclui tudo, feat/ledger-mov3-dre-inclui-tudo): regra do Diego
"nao excluir nada que saiu ou entrou". 3 fixes:
1. row.active===false removido (inativo = custo real, junho R$483,85).
2. atribuicao por CNPJ dominante (8o bug): agrupa pela linha do proprio
   PMR (fechamento->RR, bbts->ADS), nao a consolidada. R$2.191,74 sai do
   RR AL3 pro ADS - neutro no grupo, conserta por CNPJ.
3. guarda "empresa sem receita" -> anti-silencio (como Forecast): entra +
   alerta duro se fechamento nao importado.
Receita ADS = AVT+PRT+seguro (mesmo fluxo RR), junho R$7.811,58, CNPJ ADS.
Resultado ADS +R$2.616,89 (positivo). DRE junho grupo 140.695,13->
145.019,91 (+4.324,78). Bug introduzido e pego pelo gate: payable usava
discount_value (coluna zerada); real vem de promoter_discounts. Ancora
145.019,91 cravada.

FRENTE ESTRUTURAL FECHADA (3 movimentos). 8 vezes o gate contrariou uma
suposicao (mapa/premissa/proprio codigo) e estava certo. O "cada tela
mostra um numero" acabou: produção (4 telas concordam), leitura (todas no
source via detectMonthRegime), DRE (inclui tudo, por CNPJ real).

BACKLOG que sobra (nao urgente, frentes proprias): capturar "Abertura
Conta"/"Descontado" do PDF ADS se forem receita (lacuna registrada);
endurecer 2a linha de defesa ds_transacao no consolidador; item 8 (regua
ADS 5,8% vs auditoria 6%, R$20/mes); item 6. Tudo que depende do
fechamento de julho espera AGOSTO.

---

## Frente: 2a linha de defesa ds_transacao (iniciada 13/07, pos-estrutural)

Contexto: a regra "so ds_transacao='Contratacao CDC' produz" vive HOJE so
no portao do import da diaria (bbtsDailyImport:240-243). Proposta CDC e
Cancelamento nem chegam em daily_production_records. Mas o consolidador
NAO re-verifica - se um dia entrar linha por outro caminho (fechamento
PDF grava sem ds_transacao; algum import futuro; correcao manual), nao ha
rede. Objetivo: 2a linha de defesa no consolidador. NO-OP hoje (nenhuma
linha invalida existe). Mapear ANTES de codar: onde a 1a defesa mora, por
onde escapa, onde o consolidador deve re-checar.

---

## AUDITORIA DE COBERTURA TOTAL (13/07, apos correcao do Diego)

Diego: arquitetura estrutural deve existir de ponta a ponta - nada de fora,
sem brechas, da primeira a ultima tela. A frente cobriu o eixo
fechamento->PMR->telas de LEITURA; NAO cobriu o eixo reguas
(TRP/BBTS)->recalculo, botoes fora de regime, campos nao capturados.
"Fechada" foi termo errado. Metodo correto: enumerar TUDO por EXAUSTAO
(nao por memoria) e provar cada item ligado a fonte canonica OU justificar
por que legitimamente nao esta. Antes de mais codigo: mapa de cobertura.

## AUDITORIA DE COBERTURA — VEREDITO (13/07)

O SISTEMA NAO ESTA LIGADO PONTA A PONTA. 3 escritores auto-consistentes
(closing RR, closing ADS, closing-history) e ~30 que gravam e ficam
calados. "Frente estrutural fechada" foi termo ERRADO: cobriu so o eixo
fechamento->PMR->telas de leitura.

BRECHA #1 (a raiz): nao existe elo regua->recalculo. E o PMR NAO guarda
version_id -> a divergencia e INVISIVEL POR CONSTRUCAO (nenhuma query
responde "quais competencias tem regua obsoleta?"). Cenario: TRP v2 sobe,
PMR de junho fica na v1; /recebiveis e /auditoria recomputam com v2,
/promotores e /financeiro leem PMR v1 -> sistema fala 2 verdades, e a
Conferencia (que compara contra a Promotiva, nao contra o PMR) atribui a
diferenca a erro DA PROMOTIVA - diagnostico invertido. Infra ja existe
(invalidateMonthlySnapshots, reconsolidarCompetenciaFechada) - nunca
chamada do commit. /api/trp/commit devolve recalculoPendente:true
hardcoded que NINGUEM le.

SANGRANDO HOJE: (2) receita ADS julho R$0 com R$150.450,97 de producao
(bbts_pag_avista so vem do fechamento PDF; julho so tem diaria) -> DRE
fabrica prejuizo AGORA. (3) agreement_adjustment_value zerado sem
fallback -> relatorio imprime "Ajuste Comercial R$0,00". (4) reimport de
fechamento SOMA fechamento_mensal_empresa (existing+increment :610-617)
-> receita de produto DOBRA.

CORROMPEM AO CLICAR: (5) reimportar diaria em mes fechado reescreve PMR;
(6) proposals/bulk sem trava de regime (a unitaria tem 403); (7)
/api/promotores POST cego ao regime (bomba-relogio); (8) closing/cancel
apaga entries e deixa PMR vivo.
CONGELAM: (9) import CMS sem rota de consolidacao (so CLI); (10) diaria RR
deleta PMR daily e nao recria; (11) override manual/metas/remuneracao
gravam e nao disparam nada.
LATENTES: (12) /projecao e /metas leem PMR sem filtrar source (truncam
RR+ADS); (13) /financeiro Caixa soma PMR sem filtrar source (diverge do
DRE na mesma tela).
DESCARTADOS DA FONTE: (14) Abertura de Conta ADS (E receita - R$25 PF/R$45
PJ pela TRP, capturada no RR, descartada por break em
bbtsPdfExtract.ts:314), chave J do seguro (forcado JJ552710), sobra de
caixa (taxa_relatorio capturado e nunca usado), diferido ADS, Portab INSS,
estornos.
HIGIENE: scripts/test_*.cjs gravando em prod com dryRun:false;
/api/diagnostico nao monitora o PMR (a tabela canonica esta fora do
health-check).

ORDEM: comecar pelo DETECTOR (trp_version_id no PMR + badge "regua
desatualizada"), NAO pelo auto-recalculo (recalcular sozinho mes ja pago e
sua propria classe de bug). Tornar visivel primeiro; automatizar depois.

## DETECTOR CAMADA 1 — NO AR E VALIDADO (13-14/07)

Migration 20260714_000001 rodada no Studio + PR mergeado. Ciclo validado
na tela: junho mostrou "Versao da TRP desconhecida" (honesto - calculado
antes do detector) -> reconsolidado -> "PMR alinhado com a TRP vigente".
Baseline gravado.

ACHADO que reorientou: a TRP so obsoleta bbts (ADS fechada) e daily (mes
aberto). fechamento (RR) e cms NAO usam TRP - a comissao vem pronta do
arquivo; pro RR a TRP e regua de AUDITORIA, nao insumo do PMR.
trp_version_id=NULL explicito nesses 2 (comentario anti-"conserto").

Estados: fechamento/cms->NAO_APLICAVEL; bbts/daily NULL->DESCONHECIDO;
==vigente->OK; !=vigente->STALE. Gate prova que NULL x NULL NAO colapsa em
OK. Sem backfill (honesto). Botao "Verificar TRP" no PmrReconsolidarCard.

PENDENTE: reconsolidar ABRIL pra ganhar baseline (sai de DESCONHECIDO).

FASE 2 (Camada 2, decidida mas nao feita): rules_fingerprint pras reguas
MUTAVEIS SEM VERSAO que tambem obsoletam o PMR (promoter_share_profile,
share_scale_tier, promoter_goal_repasse, monthly_targets,
promoter_agreements, overrides, e as entries-fonte). Um UPDATE nelas muda
o passado sem rastro. Decisao tomada: sera CONTADOR no painel de
reconsolidacao ("N competencias com regras alteradas"), NAO badge por
linha - acenderia no estado normal de trabalho (mexer em meta/balde antes
de reconsolidar) e viraria ruido. Camada 1 = divergencia real (badge);
Camada 2 = fila de trabalho (contador). Naturezas diferentes, sinais
diferentes.

O elo regua->AUTO-RECALCULO continua NAO existindo (decisao futura do
Diego - recalcular sozinho mes ja pago mexe em dinheiro que ja saiu).
Agora ele SABE quando precisa reconsolidar a mao.

## Brechas #12/#13 — FECHADAS (14/07), sem impacto financeiro

#12 (/projecao e /metas truncando RR+ADS) SANGRAVA na TELA: junho
R$247.936,21 ocultos, os 4 duais (Camila 146.631,08; Maria Leticia
123.792,69; Fabiana 92.000; Ketley 22.912,44) apareciam com 1 linha so.
FIX: /projecao passa analyticsRegimeArgs (igual dre.ts:396); /metas filtra
source regime-aware e AGREGA SOMANDO (decisao do Diego: a meta e DO
PROMOTOR, faixa/repasse sobre consolidado RR+ADS).
ACHADO: abril -R$6.069,56 = 2 CHAVES MASTER (Renata AL3, Juliana) que o
.find() tratava como promotor - outra metade da correcao do Mov 2.
Efeito: producao da master some da projecao de mes fechado (correto pro
proposito; se quiser visivel = frente a parte).
#13 (/financeiro Caixa somava PMR sem filtrar source): era protecao por
INVARIANTE (Mov 1: daily so em mes aberto - os 2 gatilhos suspeitos foram
verificados e AMBOS desviam pro reconsolidar). Agora exclui daily =
impossivel por FILTRO. No-op.

VERIFICACAO DE PAGAMENTO (Maria Leticia): NAO houve pagamento a menos. O
CONSOLIDADOR sempre somou RR+ADS certo - PMR gravado tem status=META_2 nas
2 linhas, comissao gravada (1.576,19+961,45=2.537,64) IDENTICA ao
orquestrador dry-run de hoje (o contrafactual BASE seria ~2.453,11). O bug
era SO de visualizacao. Escopo fechado: unico promotor dual E com repasse
Frente C e ela (os outros 3 duais nao tem linha de repasse -> faixa
irrelevante pro pagamento). Junho inteiro: gravado==orquestrador nos 46.
LICAO: resolveFrenteCShare como funcao unica (motor+tela) segurou - o
calculo estava certo mesmo com o leitor quebrado. Verificar ANTES de
"corrigir retroativo" evitou pagar 2x.

A classe de bug do truncamento RR+ADS morreu nos 5 leitores (report, dre,
/equipe, /projecao, /metas).

## Brechas #6/#7/#8 FECHADAS + #2 FALSO POSITIVO (14/07)

#6/#7/#8 (a classe "corrompe se alguem clicar"): guarda POR ACAO, nao em
bloco. ACHADO CRITICO: o Diego REATRIBUI em mes fechado de verdade (38 em
abril, 74 em junho - medido) -> barrar quebraria o fluxo dele. #7: as 4
latentes (reassign/target/agreement/prefixar) CONTINUAM funcionando +
devolvem competencia_fechada:true (ZERO 403 adicionado - estruturalmente
nao pode barrar); as 5 read-time (discount/debit) liberadas. UI: banner
ambar + link /importacoes?reconsolidar=YYYY-MM que abre o card no fluxo
Simular->Reconsolidar EXISTENTE (avisar puro = tarefa esquecida;
automatico = reescrever mes pago sem Simular). #6 bulk: rejeicao PARCIAL
(denied_closed_ids), nao 403 no lote, fail-open em erro de infra. #8:
ja era PROCESSING-only (COMPLETED=409) e regime so e fechamento com todos
COMPLETED -> competencia fechada NAO pode ser quebrada; 0 orfaos hoje; so
adicionado reconsolidar best-effort pos-delete (janela de crash), NAO
apaga PMR.

#2 (receita ADS zerada -> "DRE fabrica prejuizo"): FALSO POSITIVO,
PROVADO. O DRE nao monta mes aberto: listClosedPeriods faz
if(regime==='open') continue, e pedir julho explicito bate na guarda dura
(dre.ts:228) -> closed:false, 0 linhas, alerta "competencia ainda nao
fechada, o DRE e realizado e nao exibe numero parcial". O dre.ts:313
(receita ADS=0) e INALCANCAVEL pra mes aberto. /financeiro julho: 0
empresas com resultado negativo (a ADS nem aparece - nao tem
fechamento_mensal_empresa). E a guarda anti-silencio do Mov 3 cobre o
cenario real (julho fechar sem o PDF ADS -> comissao entra + ALERTA DURO).
A auditoria leu o dre.ts:313 ISOLADO, sem rastrear as guardas antes/depois.

LICAO: a auditoria exaustiva foi certa (enumerar o sistema todo), mas nem
toda brecha listada e real. VERIFICAR ANTES DE CONSERTAR desarmou 4:
#4 (soma nao disparou; valor_avista e upsert), #13 (latente por
CONSTRUCAO - os 2 gatilhos suspeitos desviam), pagamento Maria Leticia (o
consolidador sempre somou certo, so a tela mentia), #2 (guardas ja
existiam).

## Blindagem dos scripts — FECHADA (14/07)

Contexto: NAO HA STAGING (.env.local = tufgkbtgdxewiggrfvan = producao);
zero scripts checavam ambiente; 10 escreviam por default. O padrao certo
JA existia (run_metas_import_maio: dryRun:!apply) - metade nao adotou.
P1 test_item3_ads_seguro (o pior: dryRun:false hardcoded lendo arquivo do
Downloads do Diego, sobrescrevia seguro de 7 propostas reais) -> READ-ONLY.
P2 seed_padrao_d (default invertido) -> --apply. P3 run_pmr_cms (gravava
PMR ao rodar, zero guarda) + run_import_cms + seed-convenio-segmento ->
--apply. P4: 5 one-off -> scripts/archive/ (git mv, 0 referencias).
P5 test_merge_dono_coluna -> opt-in, sandbox mantido.
PROVA: 6 rodados sem flag, contagens antes==depois; PMR jan/mar
max(calculated_at) INALTERADO (prova que run_pmr_cms nao reconsolidou).

## ESTADO DA AUDITORIA DE COBERTURA (14/07)

FECHADAS: #1 (detector Camada 1 no ar), #4 (falso positivo - soma nao
disparou; valor_avista e upsert), #2 (falso positivo - DRE nao monta mes
aberto, guardas ja existiam), #6/#7/#8 (guardas de regime), #12 (truncamento
/projecao e /metas - a classe morreu nos 5 leitores), #13 (defesa em
profundidade), scripts blindados.
ABERTAS: #9/#10/#11 (congelam - dado velho; o aviso da #7 cobre
parcialmente; a Camada 2 fecharia sistematicamente), #3
(agreement_adjustment_value zerado -> relatorio imprime "Ajuste Comercial
R$0,00"), #14 (dado descartado da fonte: Abertura de Conta E receita real
R$25 PF/R$45 PJ capturada no RR e descartada na ADS por break em
bbtsPdfExtract:314; chave J do seguro forcada JJ552710; taxa_relatorio
capturado e nunca usado; diferido ADS), /api/diagnostico nao monitora o
PMR, Camada 2 do detector (contador no painel).

## DETECTOR CAMADA 2 — NO AR E VALIDADO (15/07)

Migrations 20260715_000001 (tabela + RPCs) e 000002 (fix do cast de enum)
rodadas no Studio; PRs mergeados. Validado na tela: "0 com regras
alteradas / 1 desconhecidas (04/2026) / 1 OK (junho)". Buckets SEPARADOS.

updated_at MORTO (provado): 0 trigger em 64 migrations, 6 das 10 tabelas
sem a coluna, e o empirico promoter_goal_repasse 0/19 moveram apesar de
re-imports. -> hash de CONTEUDO, escopado por promotor-no-PMR (mata o
falso positivo estrutural). RPC unica grava E compara (sem drift).

BUG que custou 2 rodadas: ERROR 42883 - profile_type e ENUM
(share_profile_type); o Postgres nao faz coercao implicita enum->text em
ARGUMENTO de funcao (so em comparador col='X'). LICAO REGISTRADA NO SQL:
plpgsql NAO valida nomes/tipos no CREATE - o corpo e string ate a 1a
execucao. "Success" na migration NAO prova que a funcao roda. CRIAR !=
RODAR. Toda RPC precisa de teste de EXECUCAO (select compute_...) antes do
merge. O gate antigo MENTIA (schema sintetico declarava profile_type como
text); corrigido pra usar o enum real + G0 que reproduz o 42883.

PROCESSO (pedido do Diego): sempre mandar o SQL E a ordem numerada dos
passos. O SQL TRUNCA no chat (linhas longas) - entregar o caminho do
arquivo local OU o link Raw do GitHub, nunca colar no chat.

VALIDADO 15/07: abril reconsolidado -> detector LIMPO ("0 com regras
alteradas, 0 desconhecidas, 2 OK"). Ciclo completo provado na tela. A
brecha #1 esta FECHADA nos 2 eixos: Camada 1 (TRP, badge: junho "alinhado
com a TRP vigente", abril "nao aplicavel" - RR puro nao usa TRP) e Camada
2 (reguas mutaveis, contador: 2 OK). A divergencia que era "invisivel por
construcao" agora responde em 2 cliques.

## SLIP da ADS le a regua — FECHADO (15/07)

Bug: bbtsMonthly.ts:44 tinha SEGURO_RATE={ESTOQUE:.001, SLIP:.0035} FIXO,
ignorando o prazo. A regua BBTS manda variar (0-36 .001 / 37-60 .0015 /
61-84 .0025 / 85+ .0035).
IRONIA: a regua canonica JA estava no banco e CERTA (bbts_rule_versions
2026-07, gravada pela tela self-service) e o resolver ate devolvia
.seguro - ninguem consumia. Constante em codigo com regua em dado
disponivel = o pecado que a frente estrutural combateu. E o detector
Camada 2 NAO pegaria: a regua no banco esta certa, quem erra e o codigo
que nao a le.
FIX: resolveBbtsRegraDb (mesmo padrao do trpProvider) + helper
lib/bbts/seguroBbts.ts (seguroRateFromRegra). Contrato igual ao
lookupPctBbts: {rate} ou {rate:null,motivo} - NUNCA chuta. Prazo ausente
-> seguro ZERO + aviso (nao herda o 0,35 como fallback).
IMPACTO: junho no-op (R$97,54 - a unica linha SLIP e prazo 96 = faixa 85+,
onde .0035 coincide). Julho -R$17,49 (42,89->25,40; SLIP 0-36 14,66->4,19;
37-60 12,29->5,27). Julho e mes ABERTO - sem acerto retroativo; fecha
certo em agosto.
RR INTOCADO (armadilha): RR usa insurance_slip_rules com numeros
DIFERENTES (.0015/.0025/.004/.0055, FIX-3), fonte diferente. Gestoras
diferentes. NAO unificar - o gate prova.

Agora os 2 lados da ADS derivam de DADO versionado: credito le a TRP do
banco, seguro le a regua BBTS do banco. Nenhuma constante de regra.

## /api/diagnostico vigia o PMR — FECHADO (15/07)

Antes: count(*) em 8 tabelas, SEM o PMR (a canonica). Endpoint orfao (zero
referencias, sem cron, sem tela). As invariantes da frente estrutural
dependiam do codigo estar certo - NADA verificava. O abril fossil existiu
meses porque nao havia vigia.
Agora: secao "ledger" (aditiva) com regime_fechado_sem_pmr,
fechado_com_daily, master_com_comissao (erros), rules_stale/
rules_desconhecido (CONSOME detect_rules_stale da Camada 2, nao
reimplementa), promotor_multi_linha (info). Regime via detectMonthRegime.
Le com getSupabaseAdmin.
PLACAR HOJE: status=erro por master_com_comissao=1 (2026-02, R$18,91,
source cms - do ground-truth, sobreviveu aos consertos do Mov 2). Estava
MUDO. Os outros zerados.

>>> ACHADO GRANDE (investigado, nao e recebivel historico): 2025-09..12
estao em regime fechamento com ZERO PMR - sao FECHAMENTOS DE COMISSAO
REAIS: 27-31 promotores/mes, ~R$583.106 de comissao, mesmas j_keys
INDIVIDUAL que produzem abril/junho, + receita de empresa em
fechamento_mensal_empresa (R$159k-230k/comp). Vieram no backfill de
abr-jun/2026 junto com o PRT. cms de 2025 = 0 linhas (o ledger nasce em
jan/2026). E um buraco de 4 meses de ledger - "abril x4".
DECISAO: PISO 2026-01 no health-check, documentado. O ledger de promotor
nasce no seed cms de jan/2026 ("dez/2025 FORA" - escopo ja decidido na
virada arquitetural). Piso = definicao de ESCOPO, nao varrer pra baixo do
tapete. Provado: sem piso (a)=4 (exatamente os 4 de 2025); com piso (a)=0
e NENHUMA competencia de 2026 sai - o piso nao esconde nada de dentro do
escopo.
RECUPERAVEL: os 4 meses sao reconsolidaveis SE o Diego quiser historico
2025 no sistema. RISCO: injetaria ~R$583k na tabela que TODAS as telas
somam (financeiro/dashboard/DRE/projecao), com dupla contagem vs o legado
onde essas comissoes ja foram pagas. FORA do mandato do health-check -
decisao de negocio do Diego. Ressalva: re-imports (22-28/comp) podem
inflar a cifra; o numero robusto e "27-31 promotores/mes"; a cifra exata
sairia de um dry-run real.

PENDENTE (achado do vigia): o master de fev com R$18,91 vai acender
enquanto estiver la. Opcoes: zerar (master e balde, nao promotor) ou
aceitar como legado do cms.

## Master com comissao no cms — FECHADO (15/07). VIGIA VERDE.

O /api/diagnostico nasceu apontando 1 erro real: master_com_comissao=1
(2026-02, R$18,91). Investigado: a planilha do financeiro lancou COMISSAO
PROMOTOR=18,91 num contrato de 13o (201830802) cuja CHAVE J e a MASTER
JG626476 (Renata AL = o CNPJ 48.357.275/0001-03). O importador
REPRODUZIU FIELMENTE (ground-truth item #21) - resolveu pela 1a via
(chave J direta -> master), marcou is_master=true correto. Nao ha promotor
individual "Renata Oliveira" cadastrado.
CAUSA RAIZ: consolidateMonthlyFromCms era a UNICA derivacao que esquecia
"master e balde". Telas, daily, closing, /equipe e projecao ja filtravam -
por isso sobreviveu aos consertos do Mov 2.
FIX (a'): excluir is_master na consolidacao cms->PMR. NAO viola o
ground-truth: cms_promoter_entries INTACTA (18,91 + comissao-empresa 32,42
preservados pra reconciliacao); muda so o PMR DERIVADO. "Master = balde" e
taxonomia do SISTEMA (j_keys.key_type=MASTER), nao do cms - aplica-la na
derivacao nao e editar a fonte, e ser consistente. Fix de abril movido uma
camada antes.
NAO unificado com daily/closing de proposito: eles evitam a master na
ATRIBUICAO (closingPromoterBase:178); o cms e estruturalmente diferente (a
fonte keia direto na master, que E promotor cadastrado).
APLICACAO: o botao Reconsolidar NAO cobre cms (a guarda recusa
regime='cms' pra proteger o historico). O PMR de mes cms so e reescrito
pelo runner: node scripts/run_pmr_cms.cjs 2 --apply (o mesmo script que
foi BLINDADO hoje de manha - 1a vez que o padrao --apply foi usado de
verdade: pediu o flag, fez backup de 60 linhas, so entao gravou).
Diego mergeou ANTES de rodar -> sem janela de regressao.
RESULTADO: Renata master fev final=0 (linha nao apagada, production_value
1.328,65 mantido); AUDITORIA 2 verde (0 divergencias, Thaynara confere);
espelho intacto. VIGIA VERDE: master_com_comissao 1->0, ledger.status ok.

>>> O ciclo completo funcionou: o vigia nasceu, apontou um erro real que
estava MUDO, o erro foi investigado ate a causa raiz, consertado no lugar
certo (a derivacao, nao a fonte), aplicado, e o vigia fechou. E o que um
health-check deve fazer.

## #3 (Ajuste Comercial) — FALSO POSITIVO + gap latente FECHADO (15/07)

A premissa ("o relatorio que vai pro promotor afirma ajuste zero") NAO se
sustenta:
- O R$0,00 e VERDADEIRO. agreement_adjustment_value = soma dos
  promoter_agreements tipo SPECIAL (ajuste avulso PERCENT/FIXED). Em prod:
  2 acordos SHARE_OF_COMPANY inertes (valor 0) e ZERO SPECIAL, jamais
  criados. Como so SPECIAL alimenta o campo, o 0 e o valor CERTO - o
  sistema SABE. Nada escondido (diferente dos fosseis 2025 e do master).
- O campo e INTERNO: so o XLSX de gestao (buildReportExport:976,1001)
  imprime. O PDF do promotor (buildPromoterPdf) e a XLSX fiel ("modelo
  LUCIANA") NAO tem a coluna.
- Varredura do relatorio: discount_value do PMR tambem e Sigma=0 mas NAO
  mente - "Descontos" vem da tabela VIVA promoter_discounts (debitos reais
  fluem por la, jun R$2.168,84). Era a unica coluna lida crua do PMR.

O PROBLEMA REAL (fechado): so o daily calculava o ajuste; cms/closing/bbts
gravavam 0 HARDCODED -> um SPECIAL lancado em competencia FECHADA era
engolido EM SILENCIO. Dormente (0 SPECIAL), armado pra sempre.
DECISAO: AVISAR, nao HONRAR. 3 evidencias: (1) a doc do
consolidateMonthlyFromCms diz "final = production + insurance (e NADA
MAIS). Sem 5,80%/acordo/FIX-6/descontos" - mes fechado REPRODUZ a fonte
por design; (2) nao ha como saber se a fonte ja embutiu o ajuste
(promoter_agreements e lancamento avulso, sem vinculo com contratos nem
campo "ja aplicado") -> honrar arriscaria DOUBLE-COUNT de dinheiro ja
pago; (3) anti-silencio. HONRAR so seria certo se a fonte
comprovadamente nao incluisse o ajuste - nao se prova pelo dado.
lib/agreements/specialFechadoAviso.ts + plugues nos 3. Gate: no-op hoje +
sintetico provando que os 3 AVISAM e o numero NAO e honrado.
CONFLITO no merge (a branch saiu de main antiga; 3 PRs andaram): o
cmsMonthly auto-mergeou (regioes diferentes - master fix no loop, aviso no
return); bbtsMonthly conflitou so nos imports. O fix do MASTER sobreviveu
(verificado) - se tivesse sumido, o R$18,91 voltaria no proximo reimport.

>>> PLACAR DA AUDITORIA: 5 "brechas" DESARMADAS pela verificacao (#4, #13,
pagamento Maria Leticia, #2, #3) e 6 FECHADAS de verdade (detector Camada
1+2, guardas de regime, truncamento nos 5 leitores, scripts blindados,
vigia do PMR, master do cms). LICAO: enumerar por exaustao foi certo;
tratar cada item como fato sem MEDIR teria sido o erro seguinte.

## FORECAST buraco 3 — FECHADO (15-16/07). 3 investigacoes, 2 hipoteses derrubadas.

PR #117 (gate) + PR #118 (fix do motor).

A DIVIDA (memoria item 30): previsto usa creditAvistaTrp, motor usa
getCreditPercent - 2 implementacoes da MESMA regra. Decisao inicial: NAO
convergir (o pct converge 100%, 1528/1528; o merge custa caro e muda
numero). >>> ESSA DECISAO FOI TOMADA COM INFORMACAO INCOMPLETA: o
"converge 100%" so media contratos onde AMBOS resolvem. Os casos onde o
motor DESISTE nunca entraram na comparacao - e e exatamente ali que ele
errava.

CAUSA RAIZ (3a investigacao; as 2 primeiras erradas):
1a hipotese: tiquete_min e residuo legado -> ERRADA (o motor:410 reproduz
   EXATAMENTE o tiquete_min da TRP: 100/2000/2500/1000; e nao morde - os
   casos tem net R$200-16k, acima do minimo).
2a hipotese: prazo_min, o fix e "aplicar o piso" -> ERRADA (nao e piso).
3a e definitiva: RESOLUCAO DE CATEGORIA. O previsto
   (getMatrizTRPParaContrato) itera categoriasCandidatasFor - lista
   ORDENADA [CONSIG_PUBLICO, CONSIG_PRIVADO, CONSIG_GERAL] (regrasLoader:
   666). O motor (getCreditPercent->inferCreditTable) commitava numa UNICA
   categoria e desistia -> 0. lookupPctInRegra esta CERTO (rejeita a
   categoria errada corretamente) - o bug era nao tentar a irma.
REALIZADO PROVA: os 5 de abril (convenios PRIVADOS
744558/730054/868533/738562, taxa 3,2-3,99%, prazo 20-27): CONSIG_PUBLICO
rejeita (prazo_min 36); a celula REAL esta na irma CONSIG_PRIVADO (tx_min
0.0254, prazo 18-35, Faixa 3 = 0,0081). O metadata do fechamento traz
"% TABELA OPP = 0,0081" - a Promotiva PAGOU pela tabela privada.

FIX: lookupCreditPercentTrp tenta as irmas quando a primaria da null,
REUSANDO categoriasCandidatasFor (a funcao do previsto - nao nasceu 3a
implementacao).
PROVA ANTI-SOBRE-PAGAMENTO: 16.780 celulas (1.678 contratos RR+ADS x 2
construcoes de op x 5 faixas, TRP_SOURCE=db). "Celulas que JA RESOLVIAM e
mudaram de valor: 0". As unicas 25 = os 5 de abril x 5 faixas.
FECHADO NAO MEXE: sha256 do payload identico - abril 84f732cf, junho
d2913035.

>>> O GATE MENTIA: os "7 de julho" eram ARTEFATO. O gate rodava SEM
TRP_SOURCE=db - o previsto le o DB sem flag, o motor honrava o env ->
comparava previsto(db) x motor(json), e o JSON embutido nao tem a TRP38
(vive em branch nao-mergeada) -> o motor caia no CREDIT_RULES e zerava. Em
PROD os 8 de julho NUNCA estiveram zerados (resolvem pela primaria no
TRP38, pct 0,0285-0,0937, delta 0, e todos tem "% A VISTA" persistido). O
gate agora FORCA TRP_SOURCE=db (fonte simetrica).

CONSEQUENCIA HONESTA: o fix NAO muda numero de producao hoje (fechados nao
recalculam pelo motor; julho ja pagava). MATA A CLASSE e vale pra proxima
TRP com prazo_min na primaria. E blindagem, nao conserto de dinheiro.

LICAO: ir ate o REALIZADO resolveu. Se tivesse parado na 1a resposta,
teriamos "consertado" o getMinimumTicket - que estava certo. E um gate com
fontes assimetricas (db x json) inventa divergencia que nao existe.

## tiquete_min nasce da regua — FECHADO (17/07)

A MESMA CLASSE DO SLIP: existia regua no banco
(trp_rule_versions.regra_json.<categoria>.tiquete_min) e o motor tinha
constante hardcoded reproduzindo (getMinimumTicket, motor:410: FGTS 1000,
PORTAB 2500, PRIVADO 2000, default 100). Certo por REPRODUCAO MANUAL. O
detector Camada 2 NAO pega (a regua esta certa; erra o codigo que nao a
le).

A CLASSE NAO E HIPOTETICA - o campo JA MUDOU 2x (varredura dos 47 JSONs,
dez/2022->jul/2026):
- CONSIG_PRIVADO 100 -> 2000: era 100 de TRP10 (2024-08) a TRP17
  (2025-03) - 8 MESES em que o hardcode 2000 SUPER-GATEAVA (zerava
  contratos que a regua mandava pagar).
- PORTAB_INSS = 1000 era categoria SEPARADA no schema antigo; o hardcode
  colapsa toda portabilidade em 2500.
(Ressalva: pre-ledger - o motor nao recalcula 2025 - entao provavelmente
nunca mordeu em prod. Mas prova que o campo muda.)

ACHADO QUE DEFINIU O DESENHO: a TRP38 (julho) NAO TEM tiquete_min - nem
prazo_min, nem tx_juros. So a matriz de pct. Julho nasceu do PARSER
SELF-SERVICE, que descarta os escalares. Fix ingenuo "le da regua"
QUEBRARIA julho (PRIVADO 2000->100, PORTAB 2500->100, FGTS 1000->100). O
fallback ?? getMinimumTicket e OBRIGATORIO.

FIX: helper tiqueteMinFromRegra(regra, tableKey) espelhando o padrao do
SLIP; le regra[categoria].tiquete_min com fallback no hardcode (que vira
REDE, nao fonte). Reusa o TABLEKEY_TO_CATEGORIA existente. O gate do
minimo foi movido pra DEPOIS da resolucao da regua (ordem das guardas
rate<=0/term<=0 preservada). Chaveia no tableKey PRIMARIO, nao na
categoria do candidate-list - gates independentes.
GATE: no-op (abr/jun 11/11 identico; julho 11/11 no fallback). SINTETICO:
com CONSIG_PRIVADO=100 (como era em TRP10-17) o motor PAGA ticket R$1.000
a 0,0081 onde o hardcode zeraria.

>>> RESIDUO ABERTO (novo, revelado por esta frente): o PARSER
SELF-SERVICE da TRP descarta os ESCALARES (tiquete_min, prazo_min,
tx_juros) - so extrai a matriz de pct. Por isso a TRP38/julho nao os tem.
Enquanto isso, toda competencia nova nasce dependendo do hardcode como
rede. E a mesma lacuna do "Abertura de Conta" da ADS (o parser ve e
descarta). Candidato a frente propria: fazer o parser capturar os
escalares.

As 2 constantes de regra-em-codigo do motor morreram: SLIP (ADS, 15/07) e
tiquete_min (RR, 17/07). O que resta hardcoded sao limites que o motor JA
le da regua (tx_juros_min, motor:502) e o teto/carve-outs (politica de
empresa, nao regua da Promotiva).

## Parser da TRP captura os escalares — FECHADO (17/07)

O PADRAO (mesma classe do SLIP e do "Abertura de Conta" da ADS): o STOP
regex do parseMatrix JA CASAVA com a linha "Tabela: X, Y / Tiquete: a
partir de R$ N / Custo: R$ N" - o parser VIA a linha e a usava so como
FRONTEIRA, descartando o conteudo. Capturar = parsear a mesma linha.
PROVA de que a info esta no PDF: os escalares das 47 TRPs historicas foram
DIGITADOS A MAO (build_opp072.py tem os literais) - alguem leu essa linha
e digitou. Lacuna de ESCOPO do parser, nao dado externo.
POR QUE IMPORTAVA: a TRP38 (julho) foi a 1a 100% self-service e nasceu SEM
tiquete_min -> toda competencia nova dependia do hardcode como rede.

FIX: parseEscalares reusa PROD_ANCHORS (nao duplica o mapa). DOIS regex - o
FGTS foge do padrao ("Tiquete >= R$ 1 mil": sem ":", sem "a partir de", e
"1 mil" POR EXTENSO). RISCO EVITADO: regex ingenuo leria "1" -> minimo R$1
-> o gate SOME -> paga FGTS que devia zerar (erro silencioso PIOR que a
lacuna). Gate prova FGTS=1000 + 2 iscas que nao casam. NOTA HONESTA: o
clamp 0<t<=10000 NAO pegaria um "1" - o que protege e o parse "1 mil"->1000
e o gate.
GRUPOS: "1.2, 1.3" / "1.4 e 1.6" / "2.2, 2.3" / "3.2 e 3.3" - um tiquete
cobre N categorias, expandido pra todas.
NASCE "CONFERIR" (ambar), nunca "provado"; ausente/implausivel/ambiguo ->
OMITE (cai na rede getMinimumTicket). Melhor ausente que errado.
GATE DEEP-EQUAL (valida contra o OLHO HUMANO): abril e junho - o tiquete
capturado == o JSON CURADO A MAO, 11/11 x2. Julho == hardcode (no-op).

PENDENTE (acao do Diego): RE-SUBIR o PDF da TRP de julho pela tela. A
regua e versionada, NAO ha backfill - a TRP38/v1 segue sem os escalares
ate ser re-subida. Re-subir cria v2 COM tiquete_min (e exercita o "conferir"
ambar pela 1a vez com escalares). Ate la, julho no fallback (funciona).

RESIDUO ABERTO (reportado, nao forcado): o tx_juros_min de CATEGORIA
tambem e descartado e TEM CONSUMIDOR VIVO - o motor le cat.tx_juros_min no
gate B do ADIANTAMENTO_13 (motor:503); em julho esta undefined -> ESSE
GATE NAO RODA. Nao fica na linha "Tiquete:" (esta na matriz) - captura
propria. Item proprio.

## tx_juros_min derivado (floor x particao) — FECHADO (17/07)

Residuo da frente do parser de escalares: o tx_juros_min de CATEGORIA nao
fica na linha "Tiquete:" (esta na matriz) e era descartado. O motor le
cat.tx_juros_min no gate B do ADIANTAMENTO_13 (motor:541); em julho estava
undefined -> gate PULADO em silencio.

NAO ERA BUG VIVO (medido): julho tem 77 contratos de 13o, ZERO abaixo do
piso (os menores estao exatamente em 3,25%, e inRange e >=). Contrafactual
com a regua de junho (que TEM o campo): 0 divergencia. O piso JA era
enforced por outro caminho - o parser capturou o 3,25% como tx_min da
CELULA, e o lookupPctInRegra rejeita taxa < tx_min do mesmo jeito.
FIZEMOS pelo INSS_RENOV, o caso MULTI-CELULA: o tx_juros_min=0,01 de
categoria cobria TODAS as celulas, mas o PDF so escreve "A partir de 1,00%"
na celula 61-84; as 48-60 e 85-999 ficam SEM PISO. E onde a celula NAO e
rede suficiente.

>>> A MINHA REGRA ESTAVA FURADA e o Claude Code provou antes de
implementar: "min(cell.tx_min)" INVENTARIA tx_juros_min pra 7 categorias
que o curado deliberadamente OMITE (CONSIG_PUBLICO 0,0175, SIAPE 0,0164,
CONSIG_PRIVADO 0,0254, PORTAB, NAO_CONSIGNADO). Teria gravado dado FALSO
na regua canonica, em silencio.
O DISCRIMINADOR REAL: FLOOR x PARTICAO. Deriva so quando ha 1 tx_min
DISTINTO E (celula unica OU alguma celula sem tx_min). Semantica: um PISO
de categoria (INSS_RENOV: 1% vale pra tudo, o PDF so escreveu numa celula)
!= uma PARTICAO por faixa de taxa (CONSIG_PUBLICO: cada celula tem sua
faixa; o menor nao e piso, e o comeco da 1a faixa).
GATE: abr/jun deep-equal vs o curado A MAO 11/11 x2 (deriva 2, omite 9);
julho no-op em 448 contratos.
BONUS: o comentario do gate B MENTIA (falava de um skipTxJurosMin removido
na Fase 4.4). Corrigido - o gate B e cinto redundante sobre o suspensorio
do loader, que hoje aplica o piso a TODAS as categorias.

RESIDUO IRMAO (registrado, fora de escopo): prazo_min de categoria tem a
mesma natureza - a celula ja o enforca.

## prazo_min de categoria — BUG VIVO (17/07). O oposto do gemeo.

Ao contrario do tx_juros_min (no-op), a ausencia do prazo_min de categoria
na TRP38 (julho) esta PAGANDO 6 contratos que a regua zeraria: ~R$602 de
a-vista sobrepago (Faixa 3). CONSIGNADO CORRENTISTA prazo 3/5/6/12,
CREDITO BENEFICIO prazo 2, SIAPE prazo 8 - todos abaixo do piso da
categoria (CONSIG_PUBLICO 36, SIAPE 48, NAO_CONSIGNADO 13).

>>> EU ESTAVA ERRADO: "a celula ja enforca o prazo_min" e FALSO pro
CONSIG_PUBLICO - ele tem 9 celulas e SO 1 tem prazo_min proprio; as outras
8 sao prazo-ABERTAS. Um contrato de prazo 6 casa uma celula sem restricao
e paga 8,15%. A afirmacao valia so pro ADIANTAMENTO_13 (celula unica com o
piso).

>>> POR QUE O GATE DE PARIDADE (1608/1608) NAO PEGOU: ele compara previsto
x motor, e os DOIS leem a MESMA regua deficiente -> concordam na resposta
ERRADA. O bug esta no DADO (regua sem prazo_min), nao na logica. LICAO
MAIOR: duas implementacoes concordando NAO provam que estao certas -
provam que leem a mesma coisa. So um gate regua<->FONTE (PDF) pegaria.

REGRA CONFIRMADA NA MEMORIA (nao e interpretacao): o prazo minimo e
CONDICAO DE ELEGIBILIDADE, nao faixa. A TRP pag.3: "e imprescindivel que a
linha do produto, taxa de juros, prazo e ticket minimo estejam devidamente
previstos". Precedente de 01/06 (proposta 209454643, prazo 24 < 36 -> o
Diego pos 0% e estava certo). E o D29 (28/05) ja catalogava os pisos:
Consignado Publico/SP-MG 36, SIAPE 48, INSS Novo/Renov 48, CNC
Auto/Sal/Benef 13, CNC 13o 5, FGTS 36-84 - batem EXATO com os curados de
abr/jun. Contratos assim eram classificados "LEGITIMO_PRAZO_CURTO" (a
Promotiva nao comissiona).

## prazo_min — FIX MERGEADO (17/07). Falta a RE-SUBIDA da TRP38.

Fix = DERIVAR + CAPTURAR (so derivar seria fix PARCIAL SILENCIOSO: zeraria
5/6 e deixaria o NAO_CONSIGNADO sangrando R$5,70).
- DERIVA 5 (prazo inline na matriz -> cell.prazo_min): CONSIG_PUBLICO 36,
  SIAPE 48, CONSIG_SP_MG 36, ADIANTAMENTO_13 5, FGTS 36. Discriminador
  GENERALIZADO em derivarPisoDeCelulas(cells, campo) - o tx_juros_min
  agora tambem o chama (1 funcao, 2 campos). As 3 de particao
  (INSS_NOVO/RENOV, CONSIG_PRIVADO) OMITEM.
- CAPTURA 3 (capture gap): nas secoes "geral" o prazo vem numa LINHA
  ISOLADA sem % ("A partir de 48") que o parseMatrix pula (so coleta linhas
  com >=ncols de %). parsePrazoCategoria ancorado em PROD_ANCHORS + STOP +
  cabecalho. PORTAB_PUBLICO 48, PORTAB_PRIVADO 36, NAO_CONSIGNADO 13.
CONFERIR ALARMANTE (diferenca critica vs o tiquete): omitir prazo_min NAO
e seguro - nao ha rede. Omitir = o contrato PAGA quando devia zerar. Se
falhar, o item nasce com "ALERTA: contratos abaixo do piso serao PAGOS".
GATE: deep-equal 8/8 vs curados; regex distingue prazo puro de taxa/tiquete/
inline; julho exatamente 6 de 448 mudam (R$602,17 -> 0); anti-regressao 0
legitimo zerou.

>>> PENDENTE (acao do Diego, ORDEM OBRIGATORIA): RE-SUBIR o PDF da TRP de
julho pela tela. O fix de codigo NAO conserta a TRP38/v1 que ja esta no DB
sem prazo_min - o motor segue pagando os 6 ate a v2 existir. Re-subir cria
v2 (o RPC desativa a v1, atomico). Julho e mes ABERTO -> o proximo
recompute (import diario ou refresh) zera os 6 SOZINHO, sem reconsolidar.
Conferir na tela os itens ambar dos escalares (1a vez com eles).

LICAO MAIOR (a mais valiosa da serie): o gate de paridade (1608/1608) NAO
pegou este bug - ele compara previsto x motor, e os DOIS liam a MESMA
regua deficiente -> concordavam na resposta ERRADA. DUAS IMPLEMENTACOES
CONCORDANDO NAO PROVAM QUE ESTAO CERTAS - PROVAM QUE LEEM A MESMA COISA. So
um gate regua <-> FONTE (o PDF) pega. E o que o deep-equal contra os
curados faz.

## TRP38 v2 GRAVADA (17/07) — o ciclo completo dos escalares fechou

Diego re-subiu o PDF da TRP de julho pela tela. A v2 nasceu COM os
escalares, validada na tela:
- tiquete_min: "lido da linha 'Tiquete:' do PDF" - INSS 100, CONSIG_PRIVADO
  2000, PORTAB 2500, FGTS 1000 (os 4 valores certos).
- prazo_min DERIVADO (5): CONSIG_PUBLICO 36, SIAPE 48, CONSIG_SP_MG 36,
  ADIANTAMENTO_13 5, FGTS 36 ("das celulas, piso unico de prazo").
- prazo_min CAPTURADO (3): PORTAB_PUBLICO 48, PORTAB_PRIVADO 36,
  NAO_CONSIGNADO 13 ("da linha isolada 'A partir de N' da secao - piso de
  elegibilidade").
- tx_juros_min DERIVADO: INSS_RENOV 0.01, ADIANTAMENTO_13 0.0325.
- PARTICOES OMITIRAM CERTO: INSS_NOVO/RENOV e CONSIG_PRIVADO sem
  prazo_min (suas celulas particionam por prazo). O discriminador acertou
  no PDF real.
- ZERO alerta de "contratos abaixo do piso serao PAGOS" - a captura nao
  falhou em nenhuma categoria. Percentuais "provado" (496 linhas).

EFEITO: os 6 contratos de julho (R$602,17) param de ser pagos. Julho e mes
aberto e as leituras sao ao vivo ("os Recebiveis passam a usar a nova TRP
na hora").

>>> A REGUA DA TRP AGORA NASCE COMPLETA DO PARSER: matriz (ja vinha) +
tiquete_min (capturado) + prazo_min (5 derivados + 3 capturados) +
tx_juros_min (derivado). O que era DIGITADO A MAO nos 47 JSONs historicos
(build_opp072.py) agora sai do PDF sozinho, com "conferir" na tela.

RESIDUO A CHECAR: o prazo_max de categoria (lookupPctInRegra:168 le
cat.prazo_max). Se o prazo_min estava ausente na TRP38, o prazo_max
provavelmente tambem. Mesma familia - pode ter ficado metade. O sub-caso
do contrato de julho com 96 parcelas (CONSIG CORR REFIN, 1a01aa9e) pode
ser exatamente isso.

## prazo_max — INVESTIGADO, NAO E BUG (17/07). Frente NAO aberta.

Suspeita: "se o prazo_min estava ausente na TRP38, o prazo_max tambem - o
fix ficou pela metade". ERRADA.
- SO O FGTS tem prazo_max (84). O mapeamento anterior ("outras categorias
  tem") estava errado - era so o FGTS. (O Claude Code corrigiu a si mesmo.)
- E a CELULA do FGTS ja o enforca: o PDF traz "1,79% >= R$ 1 mil 36 a 84"
  INLINE, e o parsePrazoRange ja le -> cell.prazo_max=84. Provado que o
  FGTS resolve pela celula (nao tem cat.pct_geral que faria atalho antes do
  teto): prazo 84 paga 0,042; prazo 96 -> null/FORA_DA_TABELA.
- O contrato de julho com 96 parcelas (1a01aa9e) e SIAPE, que NAO tem teto
  em competencia nenhuma (celulas abertas, prazo_max=999). Produto longo,
  96 meses e LEGITIMO. Nao e bug.
- Contrafactual (v2 vs v2 + FGTS.cat.prazo_max=84): 0 divergencia. Os 209
  contratos com prazo > 84 estao todos em categorias SEM teto (INSS 90-96,
  CONSIG, SIAPE) - corretamente pagos. FGTS com prazo > 84: ZERO.

A ASSIMETRIA E DO PROPRIO PDF: o PISO vem "solto" (linha isolada ou inline
em 1 de 9 celulas) -> precisou derivar+capturar. O TETO vem INLINE, so onde
existe -> o parser ja pega. Nao e descuido - e a forma do documento.
DECISAO: NAO abrir frente. Derivar cat.prazo_max exigiria um
derivarTetoDeCelulas proprio (excluir 999 como "aberto", pegar o max dos
finitos), e o unico com teto finito (FGTS) ja e enforced pela celula.
No-op redundante com codigo novo.

CONFIRMADO de passagem: a TRP38 v2 TEM os 8 prazo_min (CONSIG_PUBLICO 36,
SIAPE 48, ..., PORTAB/NAO capturados). O fix + a re-subida estao vivos.

## Item 8/6 — RESOLVIDO (17/07): NAO era bug. E abriu uma frente de PRODUTO.

O "item 6" (regua ADS 5,8% vs auditoria 6%) NAO E BUG: o 5,80% e POLITICA
INTERNA do Grupo RR (confirmado pelo Diego; e registrado na memoria desde
26/05 - "a Promotiva paga ate 6,00% BACEN, a RR limita a visao do promotor
a 5,80%, ficando com o spread de 0,20%"). O PMR capa em 5,80% (o que o
promotor recebe) e a auditoria confere a 6% (o que a Promotiva deve a
EMPRESA) - medem coisas diferentes, ambos certos.
O "item 8" (split do diferido): diagnostico, nao load-bearing no PMR.

2 ALARMES FALSOS MEUS, desarmados pela medicao:
- "duas escalas de penetracao (0,30/0,21/0,11 vs 0,10/0,25/0,35/0,50)":
  ERRADO. Os "0,30/0,21/0,11" sao os LIMIARES de penetracao (min); os
  shares sao 0,10/0,25/0,35/0,50 - identicos a planilha. UMA escala,
  descrita por 2 eixos. Eu li limiar como share.
- "o 58,33% da planilha prova que o DEFAULT_SHARE e rede": ERRADO. O
  codigo NAO usa a coluna COMISSAO da planilha - usa a "3a FAIXA"
  (a-vista) e multiplica pelo share do PERFIL. A tabela
  promoter_share_profile guarda o profile_type, NAO o percent. O
  DEFAULT_SHARE=0.5833 e a FONTE VIVA de 39/46 promotores.

O TETO 5,80% E LOAD-BEARING (nao e redundancia): o RR le o a-vista de 3
fontes - a planilha (JA capada), o raw_payload, e o motor/TRP (NAO
capada). O Math.min(...,5.8) e redundante pra planilha mas SEGURA o
fallback. A ADS le a TRP crua. Nao da pra apagar o hardcode.

ACHADO ESTRUTURAL: "estar numa tabela != versionado por competencia".
promoter_share_profile e GLOBAL (sem competencia) -> reconsolidar abr/jun
usa o perfil de HOJE. O Dia 4.5 migrou a EDICAO (o Diego muda sem deploy)
mas nao o PASSADO. Mesmo risco de uma constante. 0 drift hoje.
DUPLICACAO LATENTE: o teto vive em 3 lugares (TETO_AVISTA, FAIXA_580,
literais 5.8 inline); a escala de seguro vive na constante (consolidacao =
o que PAGA) e na tabela SEGURO_SLIP (analytics = o que EXIBE). Batem hoje,
sao paralelas - o motor:297 esperando reincidir.

A PLANILHA DE REMUNERACAO (self-service, year/month, ja existe!) esta
SUBUTILIZADA: so persiste SEGURO em tabela queryavel
(commission_table_rows, rule_type=INSURANCE); as 7 abas de CREDITO ficam
so no audit_logs.payload; a aba BBCAP NEM E PARSEADA (o parser le indices
0-6); e os consolidadores de mes FECHADO nao leem nada disso
(open-month-only).

>>> DECISAO DO DIEGO (17/07): NAO mexer no parser agora. CAP, ABERTURA DE
CONTA e CONSORCIO vao virar FRENTE DE PRODUTO - precisam de telas
proprias, visao propria, e entrar nos relatorios do promotor. E modelagem
de produto novo (regras diferentes do credito: CAP calcula sobre "valor do
titulo" ou "1a parcela"; Abertura de Conta e R$25 PF/R$45 PJ por conta;
Consorcio a definir), nao conserto de parser. Um fix parcial (ler a aba e
gravar em algum lugar) seria trabalho jogado fora quando o modelo certo
vier.

## /projecao — master no rank FECHADO (17/07) + 2 frentes abertas

Comecou com o Diego olhando a tela e estranhando 2 numeros (jul/26,
empresa=ADS): producao R$0,00 e "MARIA EDUARDA - CHAVE MASTER ADS" em 1o
no rank "puxando o grupo pra baixo" (0%, meta R$300k). NENHUM dos 3
achados estava em auditoria nenhuma.

FECHADO: master no rank. filteredSummaryRows filtrava so por company_id,
NAO por is_master -> TODAS as 5 empresas traziam seu master (Renata AL,
Maria Jose AL2, Renata AL3, Juliana, Maria Eduarda). Benigno no RR (sem
meta, soterrados entre 10-20 individuais); gritante no ADS (rank de 1
linha, e com meta). Mesma classe do relatorio/DRE/cms. Fix: 1 condicao
reusando base.promoterById. Producao/projecao/penetracao INALTERADAS (0
linhas de julho em master). A meta do grupo ADS foi 300k->0 e o "em risco"
global 22->21 (o gate reconciliou o "22" que o Diego via: era GLOBAL, e a
unica master vermelha era a da ADS).

>>> 2 FRENTES ABERTAS, nesta ordem:
(1) CROSS-COMPANY (pre-requisito): a producao ADS de julho (R$250.349,01,
21 linhas - bate com o portal BBTS R$248.252,23, +R$2.096,78 de uma
contratacao ainda nao desembolsada) e dos 7 promotores RR
(Monica/Rosangela PE, Bruna/Jessica AL2, Gleice/Ketley AL3, Maria Leticia
AL1 - MANUAL_REASSIGNMENT; o balde esta VAZIO, o Diego ja migrou). As
linhas sao company=ADS, os promotores sao company=RR -> INVISIVEIS em toda
view por-empresa (somem na ADS porque o promotor nao e de la; somem no RR
porque a producao nao e de la - Bruna e Jessica aparecem com R$0 na view
RR). So o bbtsOrchestrator consolida RR+ADS por promotor; a /projecao nao.
E a dimensao que o Mov 2 nao mapeou: la consertamos o TRUNCAMENTO (2 linhas
do mesmo promotor); aqui e o CROSS-COMPANY (promotor de uma empresa,
producao de outra).
(2) META DE EMPRESA (depois): a meta da ADS e REAL e o Diego a ALTERA MES A
MES. REGRA CONFIRMADA: a meta de EMPRESA SUBSTITUI a soma das metas de
promotor ENQUANTO nao houver promotores proprios COM META ("quando a ADS
tiver promotor suficiente, a meta deles vira referencia"). O predicado e
sobre METAS, nao producao (os 7 RR produzem na ADS mas sao de outra
empresa - nao contam). SO A ADS precisa. Hoje vive na master
(monthly_targets e por promotor; nao ha conceito de meta de empresa).
DESENHO: tabela company_monthly_targets - os consolidadores leem so
monthly_targets, entao o invariante "meta de empresa NUNCA vira meta de
promotor no repasse" fica garantido POR CONSTRUCAO (hoje o closingMonthly:54
exclui a master e o bbtsOrchestrator casa por promotor real - a meta da
master e inerte no calculo; so afeta a visao).
ORDEM FORCADA: cross-company PRIMEIRO. Senao a tela mostraria "meta 300k /
producao R$0 = 0%" numa empresa que fez R$250k (83% da meta) - PIORA a
tela.

FALSO ALARME MEU (registrado): eu disse que "faltavam R$104k de producao
ADS" comparando o portal (R$248k) com R$143.747,75 - mas esse era um
SNAPSHOT do import de 13/07. O Diego reimportou 4x depois (14, 15, 16,
17/07 - Relatorio(2), 21 rows). O estado real bate com o portal. Citei
numero velho como se fosse atual e chamei de urgente. O mesmo erro de
trabalhar de memoria em vez de medir.

## /projecao ADS — RESOLVIDO (17-18/07). O fix era o CADASTRO, nao o codigo.

VALIDADO NA TELA: a view ADS de julho saiu de R$0,00 -> R$243.199,01, com
os 7 no rank e os ESTADOS preservados:
- Alagoas (4): R$228.846,78 / R$280.000 = 81,7% (Bruna 223,5%, Ketley,
  Jessica, Cleviton)
- Sergipe (1): Gleice R$8.363,05 / R$136.000 = 6,1%
- Pernambuco (2): Monica 110,9%, Rosangela 73,6% - R$162.331,40 /
  R$180.000 = 90,2%
"Puxando o grupo pra baixo" agora lista 4 promotores REAIS (nao o balde).

>>> O MODELO QUE O DIEGO DEFINIU (e que derrubou 2 frentes minhas):
- EMPRESA != ESTADO. A Bruna e ADS (o CNPJ que remunera) e produz em
  ALAGOAS (o estado, a que meta responde). Ate a ADS, os dois coincidiam
  (RR Alagoas 1/2/3 -> AL). A ADS quebra: e UMA empresa MULTI-ESTADO (AL,
  PE, SE).
- O promotor pertence a UMA empresa. O rank de uma view = os promotores
  DAQUELA empresa. A Bruna aparece SO na ADS; na RR nao aparece, mesmo
  tendo vendido la.
- O NUMERO de producao da empresa conta tudo vendido nela (o que a Bruna
  vendeu na RR conta pro numero da RR, sem ela estar no rank de la).
- O ATINGIMENTO dela = producao TOTAL (RR+ADS) / meta dela.
- FUTURO: grupos separados (vendedor RR so vende RR, ADS so vende ADS) ->
  cadastro e producao coincidem de novo.

=> O filtro do rank por CADASTRO estava CERTO. O errado era o CADASTRO (a
Bruna cadastrada RR sendo ADS). MEXER NO CADASTRO ERA O FIX. As frentes
"rank por producao" e "cross-company" que eu ia fazer foram CANCELADAS -
eu estava resolvendo o problema errado.

O ESTADO JA EXISTIA como conceito separado (promoters.estado +
estado_confirmado, por promotor, ja preenchido) e a /projecao ja usava
pr.estado (nao o company_id). A verificacao pre-cadastro provou que a tela
NAO zera o estado (campo proprio do form; a API usa o valor enviado, nao
deriva da empresa; o estadoDaEmpresa("ADS")=null so alimenta um chip de
divergencia inocuo). O Diego ativou a ADS + moveu os 7. Estados intactos.

A META DE EMPRESA (R$300k) RESOLVEU-SE SOZINHA: a regra do Diego era "a
meta de empresa SUBSTITUI a soma das metas de promotor ENQUANTO nao houver
promotores proprios com meta". Agora HA (os 7 tem meta) -> a soma assume
(grupo = R$596.000 = 280k AL + 136k SE + 180k PE). A frente
company_monthly_targets pode nem ser necessaria.

PENDENTE (transitorio): o atingimento usa a producao DA VIEW, nao a TOTAL
(a Bruna mostra 223,5% = so o ADS; deveria somar o RR dela). O Diego quer
total. MAS resolve-se SOZINHO quando os grupos separarem (producao-da-view
== total). Fix de codigo so se a transicao demorar.

## AS 3 DIVIDAS LATENTES — FECHADAS (18/07). "As tres de uma vez" (ordem do Diego).

Diego: "trabalhar as tres de uma vez e nao me questione, pois sempre que
deixa uma pra depois vc esquece." Feito - 3 commits numa branch
(feat/dividas-latentes), reversao independente.

DIVIDA 3 (seguro) - a unica com bug estrutural, mas 0 impacto real:
- 2 fontes: a constante INSURANCE_SHARE_CUTS (o que PAGA, 4 caminhos:
  calculate/closing/bbtsMonthly/bbtsOrchestrator) e a tabela share_scale
  SEGURO_SLIP (o que EXIBE). Divergiam na BORDA.
- REGUA TRAVADA (memoria 01/06, confirmada pelo Diego): p>=min AND p<max,
  cortes 0.10/0.20/0.30, ultima aberta -> 20,00% cravado = 0,35. (Eu
  inverti a leitura 2x nesta sessao antes de o Claude Code MEDIR e travar.)
- A CONSTANTE (decrescente-inclusiva) JA dava a regua certa; o BANCO estava
  ERRADO (0.11/0.21 por UPDATE manual nao versionado - a migration
  20260528 SEMPRE esteve certa com 0.10/0.20/0.30). Fix = DESFAZER o UPDATE
  manual (restaurar banco = migration = regua), nao migration nova.
- ARMADILHA: nenhuma migration batia com o banco. Rodar migrations num
  ambiente limpo REGREDIRIA (a migration tem o certo; o banco tinha o
  errado). O script alinha os dois.
- A constante morre como FONTE -> le a tabela (fallback no literal como
  rede). Impacto real: 0 (ninguem com penetracao em [10,11%) ou [20,21%),
  as unicas faixas que mudam - medido em jun/jul).
- SAGA DO SQL (licoes): (1) temp table com "on commit drop" QUEBRA no Studio
  do Supabase (o editor fragmenta o paste; _alvo morre antes dos UPDATEs).
  (2) 3 UPDATEs SOLTOS sao perigosos: se o 2o falha, o 1o ja commitou e o
  raise nao desfaz - foi o que a v1 fez (aplicou a mutacao, estourou no
  _alvo depois, guarda nunca rodou). (3) SOLUCAO: tudo num bloco DO unico
  (atomico; o Studio nao quebra; raise desfaz os 3 juntos), escopo por
  scale_code inline, sem begin/commit explicito (conflita com o wrapping do
  editor). (4) A v1 acabou corrigindo o banco POR ACIDENTE (aplicou antes
  de falhar); a v2 e o artefato correto pro repo. VALIDADO na tela:
  0.00/0.10/0.20/0.30, shares 0.10/0.25/0.35/0.50.

DIVIDA 1 (teto 5,80%) - no-op: 3 lugares (TETO_AVISTA, FAIXA_580, literais)
unificados numa fonte versionada por competencia. O motor:544 Math.min(0.06)
e o teto da EMPRESA (6%), CONCEITO DIFERENTE - NAO unificado. Gate: teto ==
5,80% em toda competencia; o 6% intocado.

DIVIDA 2 (share_profile global) - so REGISTRO, nao versionado: a Camada 2
(rules_fingerprint) JA hasheia o promoter_share_profile -> o detector JA
acende STALE se o perfil mudar antes de reconsolidar. 0 drift hoje.
Versionar (ADD year/month + resolver + migrar historico) seria caro sem
ganho. So um comentario fixando que o perfil e global e que reconsolidar
mes fechado exige checar o STALE antes.

LICAO (a mais importante da sessao, ja registrada no prazo_min mas
reforcada aqui): eu, Claude, inverti a leitura da regua de seguro DUAS
vezes com justificativas que pareciam solidas. O que resolveu foi o Claude
Code MEDIR (as 2 reguas exatas, o banco, a planilha) em vez de eu decidir
de memoria. E ele RECUSOU meu desenho (3 UPDATEs soltos) com o proprio bug
da v1 como prova. Trabalhar de memoria em regra que PAGA e perigoso -
medir sempre.

## Atingimento por producao total — NAO E BUG (18/07). Registro anterior estava errado.

A nota "o atingimento usa a producao DA VIEW, nao a TOTAL" (registrada
ontem) estava DESATUALIZADA/ERRADA. Medido: a /projecao (promoterAnalytics:
247) agrega o PMR do promotor SEM filtrar company_id -> o "acumulado" JA E
producao TOTAL (RR+ADS). Os 223,5% da Bruna JA sao o total dela (ela so
produziu ADS ate agora: R$136.050, zero RR - por isso "parecia" so ADS). O
filtro por empresa afeta QUAIS promotores aparecem (o rank), nao QUANTO
cada um soma. O fix que eu ia fazer JA ESTAVA FEITO.

E o CABECALHO por estado ja esta CERTO tambem, pela regua de 06/07
(frente "Projecao por Estado"): "o estado e uma dimensao GERENCIAL (onde a
producao pertence na hierarquia), independente do CNPJ fiscal". Caso ancora
THAYNARA: CNPJ de PE mas producao conta pra ALAGOAS -> estado=AL. "Meta por
estado = DERIVADA (soma dos target dos promotores do estado)". Entao o
cabecalho soma a producao TOTAL do promotor no estado DELE - correto. Minha
proposta de "blindar contra cross-estado" QUEBRARIA a regua da Thaynara (a
producao PERTENCE ao estado gerencial, nao ao lugar da venda).

LICAO: eu registrei "pendente (transitorio)" ontem sem medir de novo hoje.
A verificacao mostrou que ja estava resolvido. Nota de backlog nao e
verdade ate ser re-medida - o mesmo erro do "R$104k faltando" (snapshot
velho).

## Housekeeping + Gates automaticos — FECHADO (18/07)

FRENTE 1 (atingimento por producao total): NO-OP - ja estava certo (ver
secao anterior; o promoterAnalytics agrega total; o cabecalho segue a
regua do estado gerencial de 06/07). Registro de ontem estava
desatualizado.

FRENTE 2 (housekeeping): quase tudo no-op -
- Scripts: 4 novos em 4 dias, todos legitimos (3 gates + RESTAURA_CORTES
  v2). ZERO scripts que escrevem por default - a blindagem de 15/07
  segurou.
- v1 do SQL: NUNCA foi commitada no repo (so existiu no Downloads do
  Diego). Nada a remover.
- docs/: nao existe - o Diego vai por o MAPA_ARVORE_DEPENDENCIA.md em
  docs/ (Claude entrega o arquivo atual por download; Claude Code nao
  acessa o ambiente do Claude).

O QUE TINHA CODIGO (a frente real que surgiu): GATES AUTOMATICOS. Os 3
gates de regressao (paridade a-vista, tiquete_min, escalares) so rodavam
quando o Diego pedia manualmente - guardas que nao guardavam. Diego: "o
sistema e automatizado, com isso haja tecnicamente".
- run_all_gates.cjs + npm run gates (self-contained, CI) e gates:full
  (inclui banco, manual).
- FIXTURIZADOS pra rodar em CI sem banco: tiquete_min
  (TABLEKEY_TO_CATEGORIA e estavel -> JSON) e paridade a-vista (contratos
  representativos ANONIMIZADOS - so categoria/prazo/taxa/valor, sem
  nome/CPF; baseline "0 divergencias em M FIXO", matou o 1608/1663 movel).
  Escalares ja era self-contained.
- .github/workflows/gates.yml: on pull_request, MODO AVISO (X visivel, NAO
  bloqueia).
- DECISAO TECNICA (bloquear vs avisar): AVISO agora. Bloqueio (branch
  protection) e decisao FUTURA - so ligar quando os 3 estiverem provados
  por semanas. Ligar agora daria FALSA COBERTURA (so 1 era self-contained
  ate a fixturizacao) e travaria o merge do socio por gate imaturo. Regra:
  so confia em check pra bloquear depois que ele provou nao dar
  falso-positivo.

>>> A partir daqui: a cada PR, os 3 gates rodam SOZINHOS. Quebrou a
paridade/escalares/tiquete -> X vermelho no PR antes do merge.

BACKLOG que fica:
- docs/ com o mapa (acao do Diego - Claude entrega o arquivo).
- CAP/Abertura de Conta/Consorcio (frente de produto - a maior).
- Historico 2025 (R$583k, decisao do Diego).
- Bloqueio de merge por gate (quando os 3 provarem maturidade).

## Bloqueio de merge por gate — ADIADO com GATILHO (18/07)

Decisao do Diego (a madura): NAO ligar branch protection agora. Os 3 gates
rodaram em CI pela 1a vez no PR feat/gates-automaticos - 0 PRs de
historico. Ligar bloqueio hoje = confiar num check que nunca rodou de
verdade num PR real; se der falso-positivo (path errado, dep que nao
instala no runner, timeout), TRAVA o merge do socio sem quem destrave.

GATILHO PRA LIGAR (nao esquecer, nao antecipar): apos ~3-5 PRs reais em que
os gates rodaram e (a) passaram quando o codigo estava certo, (b) NAO deram
falso-positivo (nao falharam por bug de config/ambiente). Quando esse
historico existir, ligar branch protection na main com os 3 gates como
required status checks + "include administrators" opcional (o Diego decide
se quer override de emergencia nesse momento).
COMO LIGAR (quando for a hora): Settings > Branches > Add rule > main >
Require status checks to pass > selecionar o job do gates.yml. E decidir
override (permitir admin forcar vs bloqueio duro).
ATE LA: modo AVISO (o X vermelho aparece, o Diego decide). Ja e melhor que
"so quando o Claude pede".
