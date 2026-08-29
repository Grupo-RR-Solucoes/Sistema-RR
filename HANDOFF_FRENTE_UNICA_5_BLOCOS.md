# HANDOFF — `feat/frente-unica-5-blocos` (28–29/08/2026)

Cinco blocos que começaram como cinco pistas soltas do fechamento e terminaram
como um assunto só: **o sistema perdia o rastro de quem é dono do quê, e os
instrumentos que deveriam avisar ou não rodavam, ou avisavam para ninguém.**

> **Como ler.** Nenhum número aqui é estimativa. Cada um saiu de uma consulta ou
> de uma execução, e a consulta está nomeada ao lado. Onde a medição derrubou a
> premissa que abriu o bloco, a premissa derrubada está registrada — são cinco, e
> a §3 as lista.

> **Por que este arquivo existe, e não uma seção nova no `HANDOFF_RESIDUO_FINANCEIRO`.**
> Aquele documento é o handoff de **outra ramificação** (`feat/residuo-financeiro`,
> 20 commits), e a §1 dele declara o estado daquela branch. Pendurar 10 commits de
> outra branch ali faria a §1 mentir — que é exatamente o defeito que a §6b nomeia.
> Ele também já está em 811 linhas e 9 seções.
>
> **O que ficou lá, de propósito, e NÃO está duplicado aqui:** a **§6b** (o padrão
> da nota não medida) e a **§6c** (a rodada de 27/08). As duas foram *emendadas por
> esta frente no lugar onde já viviam* — que é a regra da própria §6b aplicada a si
> mesma. Este arquivo aponta para elas; copiar criaria duas versões para apodrecer
> em ritmos diferentes.

---

## 1. ESTADO DA RAMIFICAÇÃO

**Branch:** `feat/frente-unica-5-blocos`, **10 commits, nenhum enviado** (a branch
não tem upstream configurado — `git status -sb` sai sem `origin/...`).

**Zero migrations. Zero DDL. Nada gravado em produção em nenhum dos 10 commits.**
Nenhum débito criado, movido ou apagado; nenhuma competência reparada.

| commit | bloco | entrega |
|---|---|---|
| `79b98fe` | 1 | reatribuição manual: o QUARTO sítio, na EXIBIÇÃO, também honra o diário |
| `1aac723` | 2 | import de fechamento: INSERE primeiro, APAGA depois (janela reversível) |
| `ae3785f` | 2 | cancelamento de import: RECUSA quando deixaria o agregado órfão |
| `cdbb562` | 2 | vigia `agregado_sem_detalhe` — FME com valor e ZERO entries |
| `83fae75` | 2 | errata: os R$ 372,31 não se reproduzem |
| `681295f` | 2 | separa a metade CI-ável do portão e REGISTRA as duas |
| `de58363` | 3 | `/financeiro`: o subtítulo do "Recebido" para de mentir; (a) não existia |
| `bb129ce` | 4 | débito de empresa: o primeiro caso apareceu, e a decisão foi REAFIRMADA |
| `1606e2b` | 5 | troca de dono de débito: a memória nasce ANTES do delete, e o vigia a lê |
| `680d729` | 5 (extensão) | 3 portões consertados, e a dívida do próprio sistema de portões nomeada |

### Diffstat, separando código de produção de script de prova

Quem revisa precisa saber onde olhar. **A superfície de produção é pequena; a
maior parte do diff é prova.**

```
PRODUÇÃO (lib/, app/)     7 arquivos   +641  -69     <- é AQUI que se revisa
  lib/debitInsuranceResolver.ts          +191   -2    registrarTrocaDeDono + nota do débito de empresa
  lib/diagnostico/fechamentoParcial.ts   +224   -4    2 vigias novos (agregado_sem_detalhe, debito_auto_trocou_dono)
  app/api/import/closing/cancel/route.ts  +96   -0    a recusa 409 com o dano em números
  lib/monthlyClosingImport.ts             +54  -19    insere-antes-de-apagar
  lib/closingProposalRows.ts              +42  -39    precedência do diário no 4º sítio
  app/financeiro/page.tsx                 +22   -1    o subtítulo
  lib/herancaMaster.ts                    +12   -4    buildDonoDoDiarioMap exportado

SCRIPTS DE PROVA          9 arquivos  +1406  -60     <- não roda em produção
  scripts/agregado_orfao_gate.cjs          +504   -0  self-contained, 61 asserções
  scripts/reatribuicao_precedencia_gate    +246  -11  94 asserções (era exit 1 com 2 falhas)
  scripts/_fakeFechamento.cjs              +239   -0  espelho para rodar a rota REAL sem banco
  scripts/cancel_agregado_orfao_gate.cjs   +180   -0  needs-local, 8 asserções
  scripts/run_all_gates.cjs                +127   -3  registros + o bloco de dívidas
  scripts/heranca_master_janela_gate        +27   -4  25 asserções
  scripts/estorno_sem_leitor_gate           +37   -5  C2
  scripts/competencia_janela_comissoes      +28   -1  C1
  scripts/detector_regua_camada1_gate       +18  -36  C3 (o único que ENCOLHE)

DOCUMENTAÇÃO              2 arquivos   +325  -25
  HANDOFF_RESIDUO_FINANCEIRO.md          +274  -13    §6b (a quinta nota), §6c (a correção), errata dos 372,31
  HANDOFF_ADS_FECHAMENTO_CAIXA.md         +51  -12    retratação da §16
```

*(Este arquivo não entra na conta acima: ele é novo e nasce fora do diff medido.)*

### Verificação, na árvore final

```
npm run gates      executados: 30 | passaram: 30 | falharam: 0 | pulados: 53   exit 0
npx tsc --noEmit   exit 0, zero linhas de saída
npm run build      exit 0, 55 páginas, "Compiled successfully in 8.6s"
```

Rodados com o `next dev` **parado** — zero processos `node.exe`, porta 3000 livre
(a razão está na §9 do `HANDOFF_RESIDUO_FINANCEIRO`: `next build` corrompe o
`.next` de um `next dev` em execução).

---

## 2. OS CINCO BLOCOS — o que cada um MEDIU antes de consertar

O padrão é o mesmo nos cinco: **primeiro a medição, e em três dos cinco a medição
mudou o alvo do bloco.**

### BLOCO 1 — a reatribuição manual, e o quarto sítio (`79b98fe`)

**A pista que abriu o bloco estava errada.** O sintoma registrado era *"o
fechamento atribui por chave J e ignora `assigned_promoter_id`"*. Medido: **já
consertado** em `4cb31c3` (23/08), que é ancestral de `main`, e o PMR de jul/2026
já tinha sido reconsolidado sob a regra nova (a linha da MÔNICA em RR PERNAMBUCO
tem `updated_at 2026-08-23T19:41:54Z`, `production_value 39.645,56`). **O
pagamento estava certo.**

O que restava era o **quarto sítio, no caminho de EXIBIÇÃO** —
`lib/closingProposalRows.ts:141-145`, com a precedência velha (chave J vencia; o
diário só servia para a linha órfã). Medido em 28/08 com `buildClosingProposalRows`
REAL, a mesma função que `/api/commissions/proposals` chama no mês fechado,
jul/2026:

```
  CARLA MIRELLE   exibia 15 linhas / R$ 113.574,10  e foi PAGA sobre 73.468,54
  MÔNICA PEREIRA  não exibia NENHUM dos 3 contratos por que foi paga (39.645,56)
  TACIANA         exibia o 219262430 (9.000,00) que foi pago ao MATHEUS
  JÉSSICA         não exibia o 221184463 (460,00) que lhe foi pago
```

**A tela contradizia o contracheque.** O total do card nunca esteve errado — o
rateio distribui o valor do PMR, que já vinha certo; errado era **de quem** era
cada linha. Depois: exatamente os 5 contratos, **R$ 49.105,56**, todos de 2026-07;
varredura de 2026-01..08 não acha nenhuma outra linha REATRIB.

Dois defeitos de portão apareceram no caminho, da mesma família — **lista de
consumidores escrita à mão** e **constante congelada**:

- `reatribuicao_precedencia_gate` já estava **vermelho em `main`**, com 2 falhas,
  antes desta frente: exigia `chamadas >= 3` em `closingMonthly`, número escrito à
  mão; o `62f65f7` (24/08) removeu o terceiro sítio e o gate ficou vermelho **4
  dias** sem nada errado no código.
- Os dois gates varriam uma lista de **2 arquivos escrita à mão**, e
  `closingProposalRows` **nunca esteve em nenhuma delas** — apesar de decidir dono
  de linha desde sempre. Foi assim que a cópia própria da janela sobreviveu ali até
  18/08 e a precedência antiga até 28/08, sem nenhum vermelho.

Estado final, medido na execução de 29/08: `reatribuicao_precedencia_gate`
**94 OK / 0 falhas**; `heranca_master_janela_gate` **25 OK / 0 falhas**.

### BLOCO 2 — o agregado órfão (`1aac723`, `ae3785f`, `cdbb562`, `83fae75`, `681295f`)

**A anotação também estava meio errada.** Ela dizia *"a rota de cancelamento apaga
`monthly_closing_entries` sem recompor"*. Medido: a rota de fato não recompõe, mas
**o delete destrutivo estava no IMPORT** — `monthlyClosingImport.ts`, por
`company+year+month` **sem filtro de `importId`, ANTES do insert**. Consertar a
rota sozinha não teria fechado nada.

O dano medido, varridas as **100 linhas** de `fechamento_mensal_empresa` em 28/08:
**duas** estão sem entries, e só uma é dano.

```
  2025-02 RR ALAGOAS 1   operacoes=6.491  valor_liquido=97.535,61   <- DANO (vivo desde 23/04/2026)
  2023-12 RR ALAGOAS 1   operacoes=0      valor_liquido=0,00        <- NÃO é dano
```

Quatro meses invisível. Um check sem essa distinção nasceria com falso positivo
permanente — e falso positivo permanente treina o leitor a ignorar o vigia, que foi
**exatamente como este estado sobreviveu**.

Custo do vigia, medido no mesmo dia com o detector inteiro:

```
  75s        contagem count:'exact' sequencial por competência
  17–36s     a mesma contagem em lotes paralelos de 10
  5,4–7,4s   SONDA DE EXISTÊNCIA .limit(1) em lotes de 10   <- é o que ficou
  2,7s       baseline do detector SEM este check
```

O SELECT da tabela de entries inteira não é opção: passa de 60 mil linhas e estoura
o statement timeout do PostgREST (57014).

**Não recompõe o agregado, de propósito** (decisão de Diego, 28/08): recompor
*sempre* reescreveria competência sadia que já diverge; recompor *só quando zera*
escreveria 0,00 sobre 97.535,61, **completando a perda em vez de reparar**. Recusar
é a única ação que não destrói informação — 409 com o dano em números no campo
`error` (que é o que a tela renderiza; número em campo que ninguém exibe é número
que não foi dito).

O portão nasceu violando dois dos três critérios de self-contained (lê
`C:/Users/diego/Downloads`, chama `createClient`) e por isso **não estava
registrado** — portão não registrado é portão que ninguém roda. Foi **separado em
dois**, e a parte CI-ável é a maior: `agregado_orfao_gate.cjs` **self-contained,
61 asserções** (contadas na execução de 29/08) e `cancel_agregado_orfao_gate.cjs`
**needs-local, 8 asserções**. A consequência está escrita no `motivo`, não
subentendida: **o CI nunca executa aquelas 8** — e o bloco que mais sofre com isso
é justamente o de PRODUÇÃO, porque no gate self-contained o dano de 2025-02 é
fixture, e fixture não prova que o dano existe hoje. Só vira CI-ável se o xlsx
virar fixture no repo, o que exigiria versionar 1,7 MB de dado de cliente. **Fica
como dívida nomeada, não como plano.**

### BLOCO 3 — o subtítulo do "Recebido" (`de58363`)

**Duas partes, e a primeira MORREU NA MEDIÇÃO.** A anotação dizia *"'Comissões
pagas' mostra M e deveria mostrar M-1"*. Já estava consertado pela CORREÇÃO B
(`financialAnalytics.ts:990-995`). Medido rodando `buildFinancialAnalytics` — a
mesma função que `/api/financeiro:100` chama — contra o líquido do PMR
(`final_commission_value` − `promoter_discounts`) somado por script **independente**:

```
   MÊS NA TELA    comissoesPagas    líquido de M   líquido de M-1   veredito
   2026-08            139.405,05       -1.024,09       139.405,05   LÊ M-1 (certo)
   2026-07            117.769,41      139.405,05       117.769,41   LÊ M-1 (certo)
   2026-06            105.773,30      117.769,41       105.773,30   LÊ M-1 (certo)
```

Bate ao centavo com M-1 nas três e não bate com M em nenhuma. **Nada foi consertado
em (a).** Os vizinhos foram medidos junto: `receivedEmpresa` também lê M-1, e as
duas metades do painel estão na mesma competência.

O que existia era **(b), o subtítulo**: `app/financeiro/page.tsx:536` dizia
*"crédito recebido (bruto)"* e mentia em quatro pontos, medidos em ago/26
(`receivedNet` 318.696,26):

- **não é "crédito"** — o à-vista é 227.393,93 de 318.696,26 (**71%**); o resto é
  PRT 51.806,30, seguro 5.131,69, os 6 produtos 15.828,66 e a ADS 18.959,44;
- **não é "bruto"** — `valor_liquido` já vem líquido de estorno (419,21) e
  renovação (4,55);
- **não é volume** — é comissão da **empresa**, ~3,8% sobre o financiado;
- **e não é uma competência só.**

### BLOCO 4 — o débito de empresa (`bb129ce`)

**Registro, não conserto. Nenhuma estrutura foi construída e nenhum débito mudou de
dono.** A metade final da regra de 28/08 — *"se o promotor já saiu, o negativo fica
com a EMPRESA"* — segue conscientemente não implementada.

**O gatilho que a nota pedia já tinha disparado.** Medido em 28/08 rodando
`resolveInsuranceDebits` REAL em `dryRun`:

```
   FILA op=208875852  2026-06  R$ 2,03  MASTER+cms  promotor inativo desde 2026-06-13
   FILA op=211780610  2026-07  R$ 2,03  MASTER+cms  idem
   (os dois de ANA CLARA — total R$ 4,06; o primeiro entrou na fila em 09/07/2026)
```

**Sete semanas antes de alguém perguntar.** O que é zero não é o caso, é a
**estrutura**: `apply_to_company` em **0 de 77 linhas**.

**A decisão se mantém, mas por outra razão.** Não mais "não há caso" — que
envelheceu sozinha e já envelheceu — e sim **por volume**: o custo da opção (b)
(67 promotores virarem 68 em `/promotores`, `/equipe`, `/projecao` e no PMR) é
ordens de grandeza acima de **R$ 4,06 de um promotor só**. Trocar a razão importa.

Gatilho novo, porque o antigo veio e não bastou: soma dos itens parados por inativo
passar de **R$ 500** numa competência, **ou** aparecer item de mais de um promotor
inativo. Os dois números são **arbitrários**, e a nota diz isso com todas as letras
— são limiar de atenção, não regra de negócio, e não disparam nada automaticamente.

Contexto medido da fila inteira (varredura degrau a degrau, 28/08) — **R$ 45,59**:

```
   208875852  R$  2,03  INATIVO        (cascata ACHOU o dono)
   211780610  R$  2,03  INATIVO        (idem)
   209867885  R$ 20,70  DADO FALTANDO  (0 linhas em daily/cms/fechamento/PRT/prt_parcelas)
   209621970  R$ 20,83  DADO FALTANDO  (idem; existem SÓ em promoter_debit_assignments)
```

As duas de DADO FALTANDO são DAILY_CANCEL, vieram do PDF de cancelamento da ADS e
**nunca tiveram lastro** — não é defeito de código, é reimportar ou atribuir à mão.

### BLOCO 5 — a memória nasce antes do delete (`1606e2b`)

**Prevenção, não reparo, e o commit diz isso na primeira linha:** hoje **zero**
promotores mudam em jun e jul, e o check **nasce em 0**. O que ele fecha é a
impossibilidade de responder *"essa rodada mudou alguma coisa?"* — pergunta que já
voltou sem resposta uma vez (§6c).

`registrarTrocaDeDono` compara o conjunto que **vai ser apagado** com o que **vai
ser gravado** e, se algum promotor mudar, escreve **uma** linha em `audit_logs`
**antes** do delete. Nos dois sítios (RR `:462`, ADS `:777`), que são o funil dos
três chamadores — import RR, import ADS e o script manual `canc-run-fila.cjs`.

**Zero DDL:** `audit_logs` já existe, já é o registro canônico (481 linhas em
28/08) e já é usada pelo próprio import. Crescimento medido: a tabela cresce ~112
linhas/mês; este commit acrescenta **no máximo uma linha por rodada que mude dono**
— hoje, zero. Ordem de grandeza: unidades por ano.

Custo — e **a primeira medição foi inutilizável, e está registrada como tal**:
ANTES 12,0/10,9/10,8s contra DEPOIS 9,8/51,1/38,5s, com uma execução DEPOIS mais
rápida que TODAS as ANTES. Deriva de latência, não sinal. Refeita de duas formas:

```
  ISOLADO, 6 execuções da consulta:  2673, 409, 385, 388, 384, 554 ms  -> mediana 409 ms
  INTERCALADO A/B/A/B/A/B:  ANTES 7,3 / 6,5 / 7,6s   DEPOIS 5,2 / 6,3 / 9,0s
                            mediana ANTES 7,3s x DEPOIS 6,3s
```

**Severity `info`, e a escolha é o ponto.** `erro` é perda comprovada; `alerta` é
descontinuidade que só uma pessoa resolve. Troca de dono não é nenhum dos dois — não
perde nada, não é ambígua, e **pode estar certa**: se a fonte mudou legitimamente, o
novo dono é o dono certo. Chamar de erro treinaria o leitor a ignorar a tela.

Controle positivo com dados reais, contra o espelho (nada escrito em produção):

```
   2026-06  gravado 17 débitos (899,21)  x  hoje 17 (899,21)  -> 0 mudanças, 0 linhas
   2026-07  gravado 16 débitos (370,85)  x  hoje 16 (370,85)  -> 0 mudanças, 0 linhas
   produção, linhas com action=AUTO_DEBIT_OWNER_CHANGED: 0
```

A mutação que importa é a **M2** (a porta do no-op removida): 3 asserções caem. Sem
a porta, o helper gravaria a cada import, o diagnóstico encheria de ruído e alguém
desligaria o vigia — **o modo de falha que esta frente inteira combate.**

---

## 3. AS CINCO ANOTAÇÕES DERRUBADAS POR MEDIÇÃO

Canônico: **§6b do `HANDOFF_RESIDUO_FINANCEIRO`**. Reproduzido aqui em índice
porque três dos cinco blocos acima abriram em cima de uma delas.

| # | a anotação dizia | o que a medição mostrou | bloco |
|---|---|---|---|
| 1 | "o fechamento atribui por chave J e ignora `assigned_promoter_id`" | **já consertado** em `4cb31c3` (23/08), ancestral de `main`; o PMR de julho já reconsolidado. Sobrava o 4º sítio, na EXIBIÇÃO, que a anotação não mencionava | 1 |
| 2 | "a rota de cancelamento apaga `monthly_closing_entries` sem recompor" | **meia verdade**: o delete destrutivo estava no **IMPORT**, sem filtro de `importId`, ANTES do insert. Consertar a rota sozinha não fecharia nada | 2 |
| 3 | "'Comissões pagas' mostra M e deveria mostrar M-1" | **já consertado** pela CORREÇÃO B; bate ao centavo com M-1 nas três últimas competências e com M em nenhuma | 3 |
| 4 | §16 do `HANDOFF_ADS_FECHAMENTO_CAIXA`: "a ADS NÃO entra no card Recebido" | **falsa desde 28/08** — a ADS entra com R$ 18.959,44 em ago/26 | 3 |
| 5 | "o volume medido (zero)" e "o gatilho: o primeiro item que cair na fila por promotor inativo" | o gatilho **já tinha disparado 7 semanas antes** (R$ 4,06, ANA CLARA, desde 09/07). Zero é a ESTRUTURA, nunca o caso | 4 |

**As quatro primeiras são herdadas. A quinta é minha, e é a que corrige o enunciado
do padrão** — nasceu e morreu no mesmo dia, ditada de manhã e derrubada pela medição
da tarde. Escrevê-la como ditada teria criado, dentro desta frente, exatamente o que
a frente combate.

> **A regra, com o enunciado corrigido: não se trata de nota VELHA, e sim de nota
> NÃO MEDIDA.** Uma anotação escrita há cinco minutos sobre um estado que ninguém
> consultou é tão frágil quanto uma de abril. **Quando um conserto entra, a
> anotação que o pediu é remedida ou riscada no mesmo commit — com data e com o
> número que a derrubou.** Nota sem data de medição não é pista, é boato.

Custo direto: **cada uma dessas custou uma fase de medição inteira para ser
derrubada.** O custo é justo — a alternativa (acreditar na nota) teria produzido
conserto em cima de código já correto, e em dois dos casos no arquivo errado. O que
é evitável é a nota continuar lá depois.

---

## 4. A EXTENSÃO DO BLOCO 5 — portão não executado é anotação não remedida com outro nome

A §6c dizia **"irrecuperável"**. É meia verdade, e a metade que faltava é a tese do
bloco 5 inteira, medida.

`scripts/test_debitos_junho_congelado.cjs` congelou o estado de junho em
**12/07/2026**. Rodado em 29/08, **reprova**, e as três mensagens dizem o que mudou:

```
  FALHOU  junho segue com 22 debitos (15 AUTO + 7 MANUAL) — tem 24
  FALHOU  junho segue com 25 parcelas — tem 27
  FALHOU  soma dos AUTO de junho segue 872,71 — tem 899.21
```

**Junho foi de R$ 872,71 para R$ 899,21 — +R$ 26,50 e +2 débitos** (15 AUTO → 17),
em algum ponto entre 12/07 e 27/08. **E não é troca de dono: é ADIÇÃO.** A forma
bate com o degrau `+cms` do PR #195, cujo próprio corpo registra *"A fila caiu de 7
para 4"* — três operações órfãs ganharam dono, duas delas de junho. Débito que não
existia passou a existir; **ninguém perdeu nada para ninguém**.

Isso não contradiz as conferências anteriores: o total de 899,21 já estava
documentado às **18:25** de 27/08, **antes** da rodada das 20:32, e a rodada
recriou os mesmos valores. O que muda é o alcance da afirmação: para **junho** se
sabe agora *o que* mudou e *por quê*, não apenas que o total batia. **Julho segue
sem conferência possível.**

> **O rastro EXISTIA.** Estava num portão que registrou a divergência no minuto em
> que ela aconteceu — e ficou vermelho, sozinho, por semanas, porque é
> `needs-db-lento` e essa faixa só roda em `npm run gates:full`, que **nunca teve
> execução verde registrada em commit nenhum** (medido: 358,4s de teto 90s).
>
> Não foi falta de instrumento. Foi instrumento que ninguém lê. É a §6b aplicada a
> portão: **portão não executado é anotação não remedida com outro nome.**

Foi essa constatação que gerou os três consertos de `680d729`, e os três são a mesma
doença em três formas:

| | o defeito | a medição que o pegou |
|---|---|---|
| **C1** `competencia_janela_comissoes_gate` | asserção da **LETRA** (`/pertenceACompetencia\(/`) que quebrou com refatoração **correta** — o arquivo passou a chamar `buildDonoDoDiarioMap`, que a chama por dentro | vermelho por **5 commits** sem ninguém ver, porque a faixa needs-db não é rodada. Virou asserção de **PROPRIEDADE**. Mutação: reintroduzir `startsWith` derruba 1; **a versão de `main` também passa** — duas implementações corretas, as duas verdes |
| **C2** `estorno_sem_leitor_gate` | dois escapes (sem credencial `:173`, banco recusa `:187`) deixavam o gate VERDE sem rodar a asserção de não-vacuidade, enquanto o `motivo` no runner **prometia** que ele conferia | dos **30** needs-db rodados com credencial FALSA, 27 reprovaram e **2 passaram**; este era um. Agora: URL falsa exit 1, sem credencial exit 1, `GATE_ESTATICO=1` exit 0 **declarando modo reduzido** |
| **C3** `detector_regua_camada1_gate` | **nunca precisou de banco** — o smoke live só imprimia, sem nenhum `ok()` atrás | passou (exit 0) com credencial falsa porque não precisava de uma. **Não era vacuidade, era classificação errada** — e cara: pagava o preço da faixa que ninguém roda. A pergunta dele já tem dono (`gate_schema_colunas`, 2.844 colunas). CI foi de 29 para **30** |

E o estado do próprio sistema de portões, medido em 29/08 e registrado **dentro do
`run_all_gates.cjs`**, não num handoff, porque é sobre aquele arquivo:

```
  102 portões versionados  =  83 registrados  +  19 ÓRFÃOS
  faixa --db: 358,4s de teto 90s — 4x estourado (o registro anterior dizia 216,9s)
  varridas TODAS as mensagens de commit do repo: dezenas afirmam "npm run gates
  29/29", "17/17", "20/20"; NENHUMA jamais afirmou a faixa --db verde. Não é
  "faz tempo que não roda": não há registro de ela ter rodado verde alguma vez.
  o CI é modo AVISO — sem required status check e sem branch protection, não bloqueia merge
  rodada limpa de 29/08: 83 executados, 66 passaram, 17 vermelhos
```

---

## 5. O QUE FICA ABERTO

Seis itens, e nenhum deles é "quase pronto".

**1. `2026-05 RR ALAGOAS 1` diverge entre agregado e detalhe — NÃO investigado.**

```
  RR ALAGOAS 1  2026-04   operacoes(FME)=6025  x  chaves(entries)=6025   IGUAIS
  RR PERNAMBUCO 2026-02   operacoes(FME)=2891  x  chaves(entries)=2891   IGUAIS
  RR ALAGOAS 1  2026-05   operacoes(FME)=5970  x  chaves(entries)=5963   −7
                          valor_diferido 34.622,63 x Σ PRT 36.373,45     −1.750,82
```

Duas das três batem exatamente; esta não, **numa competência que ninguém considera
quebrada**. Parte do delta de `valor_diferido` tem explicação *plausível* na régua
(`isPayablePrtRow` filtra COD EST = 1), mas **as 7 operações não foram explicadas e
a hipótese não foi verificada**. Foi este achado que derrubou os dois desenhos de
"recompor o agregado" — recompor sempre reescreveria esta competência.

**2. Os 19 portões órfãos, e sua triagem.** Existem em `scripts/`, rastreados no
git, e ninguém roda. **Não devem ser registrados um a um** — encher a faixa de
vermelho de origem desconhecida troca um problema por outro. A lista está no
`run_all_gates.cjs`; o critério de triagem é: **(a)** a invariante dele ainda existe
no código? se não, EXCLUSÃO; **(b)** existe mas outro gate já a cobre? APOSENTADORIA,
com o gate que a cobre nomeado no commit; **(c)** existe e ninguém cobre? REGISTRO,
na faixa que os três critérios de classificação mandarem. **É frente própria.**

**3. Os 11 vermelhos `needs-db-lento` NÃO diagnosticados.** Dos 17 vermelhos, 6
estão caracterizados: 1 falso vermelho (crash do runner, não do gate), 1 recusa
deliberada, 1 anti-vacuidade funcionando como desenhada, 1 defeito vivo já conhecido,
1 constante congelada, 1 já tratado nesta frente. **Os outros 11 não foram
diagnosticados, e nenhum deve ser presumido benigno** — cada um exige investigação
própria.

**4. `canc-run-fila.cjs` contorna as duas travas.** Chamando o resolvedor direto,
passa por cima da trava de junho (`DEBITO_AUTO_PRIMEIRA_COMPETENCIA`) e da guarda do
`APPLIED` — foi por isso que junho, congelado para o import, pôde ser reescrito.
**Fechar isso é decidir se o script é válvula de escape legítima, e essa decisão é
de negócio, não de código.** A partir de `1606e2b` ele ao menos deixa rastro.

**5. Os +R$ 49,45 contra o extrato.** O residual da §3 do
`HANDOFF_RESIDUO_FINANCEIRO`: depois do backfill o sistema mostra **49,45 a mais**
que o depósito declarado pela BBTS em 07/2026, e são os **cancelamentos**, que por
decisão anterior não abatem receita (§4 de lá). **Não sobram R$ 39,97.** Fora do
escopo desta frente; segue aberto lá.

**6. Os R$ 372,31, RETRATADOS.** Não é item a perseguir — é item a **não** reabrir.
Tentada a reprodução a partir do arquivo cancelado
(`C23677_48357275000103_Todos_2_2025.xlsx`, duas cópias idênticas em disco,
1.740.724 bytes, mtime `2025-03-07T14:19:30.000Z`): a aba Resumo não tem valor
nenhum além do MCI, e a soma da coluna COMISSÃO da aba "Seguro" é **−355,09**, não
+372,31. Nem os 372,31 nem os 2.549,61 saem desse arquivo. O número foi rebaixado de
"única divergência real da varredura das 100" para **"não reproduzido"**. **Não é
prova de que o dinheiro está certo** — é o registro de que a afirmação não se
sustenta com o que há em disco, e de que reparo baseado nela seria reparo sem fonte.

### E o que esta frente deliberadamente NÃO fez

- **Não reparou `2025-02 AL1`.** Recompor escreveria 0,00 sobre 97.535,61; o
  agregado órfão é hoje o **único** registro daquele dinheiro. O reparo certo é
  reimportar o arquivo de origem, e **a fonte não está verificada** (item 6 acima).
- **Não construiu a estrutura de débito de empresa.** R$ 4,06, de um promotor só,
  contra 67 promotores virando 68 em quatro superfícies.
- **Não consertou o `canc-run-fila.cjs`.** Decisão de negócio, não de código.
- **Não registrou os 19 órfãos um a um.** Vermelho de origem desconhecida em massa
  é troca de problema, não conserto.
