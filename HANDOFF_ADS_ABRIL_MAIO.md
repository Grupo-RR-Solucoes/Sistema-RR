# ADS abril e maio/2026 — o fechamento que nunca entrou

Estado em 30/08/2026. Branch `feat/ads-abril-maio-fechamento`.

> **MAIO FOI IMPORTADO EM PRODUCAO.** ABRIL nao — e a unica coisa que resta
> desta frente. Ver as duas ultimas secoes.

---

## O buraco

`daily_production_records` da ADS (`company_id` 375aea6d-…) tem **0 linhas** com
`movement_date` em 2026-03, **2026-04** e **2026-05**. A menor competência
existente é junho (19 linhas, à vista 7.707,03); julho tem 46 (18.737,33).
`bbts_fechamento_totais` e `bbts_prt_parcelas` só têm junho e julho.

Os 4 PDFs, medidos e conferidos contra as âncoras do próprio documento:

| | crédito | seguro |
|---|---|---|
| abril | 37 propostas · AVT 9.780,86 + PRT 0 + Abertura 225,00 = **10.005,86** | 14 contratos · TOTAL **213,47** |
| maio | **10** propostas · AVT 634,31 + PRT 5,84 + Abertura 25,00 = **665,15** | 6 contratos · TOTAL **40,56** |

Zero linhas CANCELADO nos quatro. Total ausente **R$ 10.671,02** de crédito
+ 254,03 de seguro.

> O enunciado da frente dizia "maio crédito: 17 props". São **10**. Os 17 são
> 10 de crédito + 7 do PRT — as duas seções somam à mesma NF, mas só a primeira
> vira proposta. A Σ pag_avista das 10 fecha a âncora AVT ao centavo.

---

## FEITO — o extrator aceita os três layouts (`lib/bbtsPdfExtract.ts`)

Antes deste commit o extrator **recusava 3 dos 4 PDFs**. Não era um layout novo:
eram **três eixos que variam de forma independente** no relatório de seguro, mais
um no PRT. Medidos nos PDFs de 04, 05 e 07/2026:

| eixo | 04/26 | 05/26 | 07/26 |
|---|---|---|---|
| `R$ ` prefixando Valor Total e Prêmio | sim | sim | **não** |
| coluna "Data de Movimentação" | **não** | sim (`05/05/2026`) | sim (`03Jun2026`) |
| posição da Chave J | **fim**, após o valor | meio | meio |
| cabeçalho do TOTAL | `Valor pagamento Total` | `PAGAMENTO DESCONTO TOTAL` | idem |

E no crédito de 05/26: a **"N. da parcela PRT" vem `#N/D`** nas 7 linhas. Elas
existem e somam 5,84 — exatamente a âncora —, mas com `(\d+)` nenhuma casava, a Σ
dava 0 e o extrator abortava o PDF inteiro.

**A conferência não foi afrouxada.** A Σ continua tendo de bater a âncora do
próprio documento; não batendo, o extrator lança e `importBbtsClosing` não grava
nada. Aceitar mais forma de LINHA não aceita mais VALOR — o caminho perigoso era
o inverso, e foi o que aconteceu: linha estreita, Σ zero, PDF recusado inteiro.

Duas funções puras nasceram do conserto — `parseSeguroLines` e `parsePrtSection`
(linhas → linhas, com a conferência dentro). É o que permite ao portão exercitar
o caso que ABORTA sem um PDF em disco.

### `n_parcela = 0` é o código de "o documento não informou"

`bbts_prt_parcelas.n_parcela` é `integer NOT NULL` **e** faz parte da chave única
`(company_id, proposal_number, competencia, n_parcela)`. `#N/D` não podia virar
`null` por dois motivos independentes: o insert seria rejeitado (23502) e o bloco
do PRT só registra *aviso* — a perda seria silenciosa; e, se a coluna fosse
anulável, `NULL` não colide com `NULL` em índice único e reimportar duplicaria as
parcelas em vez de sobrescrevê-las.

O que 0 **não** resolve está guardado: dois `#N/D` do **mesmo contrato** na mesma
competência cairiam na mesma chave, o upsert guardaria um e descartaria o outro,
e a Σ conferiria (a extração viu os dois). `parsePrtSection` **lança** nesse caso.
Em 05/2026 são 7 `#N/D` em 7 contratos distintos — não acontece hoje, e é por isso
que precisa de guarda: quando acontecer, ninguém estará olhando.

### Portão

`scripts/bbts_layouts_pdf_gate.cjs`, self-contained, registrado no runner (463ms).
**Fixtures sintéticas por obrigação** — o repositório é público e nenhuma linha de
PDF de cliente entra ali; preserva-se a FORMA (ordem das colunas, ausência de cada
uma, formato da data), não o dado.

Prova nos dois sentidos: 4 mutantes (um afrouxamento desfeito por vez) que **têm
de derrubar fixture**, e 6 documentos mal formados que **têm de abortar** —
incluindo a fronteira da tolerância (1 centavo passa, 2 abortam), que a 1ª versão
da fixture errou e o portão pegou.

### Não-regressão, medida

Mesmo diagnóstico, código de antes e de depois (`git stash`), sobre os PDFs reais:

| | antes | depois |
|---|---|---|
| junho | 19 propostas, AVT 7.707,03, PRT 8/7,01 | **idêntico** |
| julho | 43 propostas, 16 de seguro, TOTAL 155,07, 3 canceladas (−49,45) | **idêntico** |
| abril | `Âncora 'TOTAL' não encontrada` | 37 · 9.780,86 · seguro 14 · 213,47 |
| maio | `PRT: Σ 0 ≠ âncora 5,84` | 10 · 634,31 · PRT 7/5,84 · seguro 6 · 40,56 |

---

## DÍVIDA ESTRUTURAL NOMEADA — uma proposta, duas competências

**Não consertada. Nomeada, com o caso medido.**

`daily_production_records` guarda **uma linha por `(company_id, proposal_number)`**
e **um** `bbts_competencia_fechamento`. O modelo assume que uma proposta pertence
a uma competência de fechamento. A BBTS não trabalha assim.

**O caso medido — contrato 212021557:**

| perna | competência em que a BBTS pagou | onde está hoje |
|---|---|---|
| crédito (à vista 255,26 · bruto 4.254,32) | **junho** | a linha, carimbada 2026-06-01 |
| seguro (base 4.254,32) | **maio** | em lugar nenhum — maio nunca entrou |

A proposta foi vendida em 29/05. O crédito caiu no fechamento de junho; o seguro,
no de maio. **Não há onde escrever as duas coisas.** Importar maio por cima
mesclaria: 19 colunas mudariam, `gross_value` 4.254,32 → 0, `bbts_pag_avista`
255,26 → 0, `movement_date` 06-15 → 05-15, carimbo 06 → 05. Junho cairia para
7.451,77 e **a âncora de junho deixaria de fechar**. Só a atribuição sobrevive —
o merge preserva `assigned_promoter_id` quando o existente é `MANUAL_REASSIGNMENT`.

O que **não** serve como conserto:
- **carimbo por perna** (duas colunas, uma para crédito outra para seguro) — os 6
  leitores do carimbo passariam a ter de escolher qual, e hoje nenhum escolhe;
- **duas linhas para a mesma proposta** — quebra a chave única e todo consumidor
  que soma por proposta;
- **exceção manual para este contrato** — não é uma exceção, é o modelo.

O precedente que já existe no código é o do PRT: perna com competência própria
mora em **tabela própria** (`bbts_prt_parcelas`), fora de `daily_production_records`.
É o caminho a considerar quando a dívida for paga. **Hoje ela é só custo latente:
1 linha, R$ 255,26 de à vista, e cresce a cada competência em que uma proposta
cruze a virada do mês.**

---

## FEITO — a recusa 409, e o predicado que a sustenta

**Predicado, geral, sem nome de contrato:**

> ao importar a competência `C`, uma proposta é **excluída da gravação** quando a
> linha que já existe no banco tem `bbts_competencia_fechamento > C` — ou seja,
> já foi carimbada por um fechamento **posterior** ao que está entrando.

A justificativa é a mesma regra que o repositório já usa em outros lugares:
**o fechamento mais recente é a verdade mais recente sobre onde aquela proposta
está**; um fechamento antigo chegando depois não pode mover uma linha que um
fechamento posterior já colocou.

### Efeito medido hoje (`scripts/diag-ads-carimbo-posterior.cjs`)

```
ABRIL  — competência 2026-04-01 | 37 propostas alvo | 0 já existem
   predicado aciona: 0    → gravaria 37 de 37
MAIO   — competência 2026-05-01 | 11 propostas alvo | 1 já existe
   predicado aciona: 1    → gravaria 10 de 11
      212021557 carimbo=2026-06-01 mov=2026-06-15 avista=255,26 bruto=4.254,32
   dinheiro protegido: 255,26 de à vista, 4.254,32 de bruto
```

### O buraco do predicado, dito antes de alguém descobrir

`bbts_competencia_fechamento` **NULL não é "posterior"**, então o predicado não
aciona. Censo do diário da ADS hoje: 18 linhas carimbadas 2026-06, 43 carimbadas
2026-07, **43 com NULL**. Dessas 43, 42 são de agosto (mês aberto, sem fechamento)
e **1 é de junho** (212850402, valor 0,00) — ou seja, o buraco existe de verdade,
não é só "o mês corrente".

Para abril e maio ele está **vazio**: nenhuma das 48 propostas alvo tem linha com
carimbo NULL. Estender o predicado para `movement_date` fecharia o buraco, mas
passaria a bloquear linha de mês ABERTO, que é outra decisão e não a que foi
pedida. Fica nomeado, não silencioso.

### Onde entraria, e como ficaria visível

Em `lib/bbtsClosingImport.ts`, imediatamente antes de `mergeDailyProductionRecords`
— uma leitura de `(proposal_number, bbts_competencia_fechamento)` das propostas
alvo, o filtro, e o resultado devolvido em `result.pulados_por_carimbo_posterior`
com contrato, carimbo encontrado e valor. **Pular em silêncio seria o mesmo
defeito de outro ângulo**; a rota deve exibir isso como exibe o aviso do seguro.

### As duas decisões, tomadas pelo Diego

**RECUSA 409 com confirmação explícita**, não "pula e avisa" — aviso dentro de
resposta de sucesso é o mesmo defeito do campo `detalhe` que a tela não
renderizava: o operador lê "importado" e segue. E **proposta inteira**, não só as
colunas que movem — gravar o seguro de maio na linha de junho seria a dívida
estrutural fingindo estar resolvida, com o agravante de ficar invisível.

`lib/bbts/carimboPosterior.ts` + bloco 3c do `bbtsClosingImport` + o 409 na rota.
A confirmação (`confirmarPularCarimboPosterior`, `=== true`, campo próprio do
corpo) **não libera a gravação**: a exclusão mora dentro do importador, então não
há opção, flag nem script que grave a bloqueada. A guarda fica **depois** da
âncora ser calculada e **antes** do gate dela — a âncora sai do PDF e tem de
continuar saindo, senão fecharia sobre um documento que não é o que está em
disco. Se a coluna do carimbo não existir, a guarda **lança**: ausência de
medição não é aprovação.

Portão `scripts/bbts_carimbo_posterior_gate.cjs`, self-contained, Supabase falso
+ `importBbtsClosing` real capturando os upserts. **Armadilha que ele já pagou:**
`importBbtsClosing` é dry-run por padrão (`opts?.dryRun !== false`), e a 1ª versão
do gate passava por vacuidade — nada era gravado. Há anti-vacuidade exigindo que
algo tenha sido gravado.

---

## MAIO — IMPORTADO EM 30/08/2026

Pela **rota** (`POST /api/import/closing/ads`), nao por script, com sessao de
socio. `importedBy: diretoria@rrcred.srv.br`. Duas chamadas, como projetado.

**1a, sem confirmacao -> HTTP 409** (1632 bytes, 2,08s). A recusa nomeou o
contrato 212021557, o carimbo `2026-06-01` que ele ja tem, e os R$ 255,26 de a
vista e R$ 4.254,32 de producao que sairiam de junho. A chamada foi feita com
`dryRun:false`: o banco foi refotografado logo depois e veio **identico a foto de
antes, linha a linha** — a recusa nao escreveu nada.

**2a, com `confirmarPularCarimboPosterior=true` -> HTTP 200**, `gravadas: 10`.
A 212021557 aparece em `puladas_carimbo_posterior` **tambem na resposta de
sucesso**: a confirmacao liberou o resto, nao a sobrescrita.

As 4 ancoras fecharam com **delta 0**, nao com tolerancia: propostas 10,
vfin 20.725,63, avista 634,31, seguro 40,56. `pmr_fechado: ran=false, regime
'cms'` — maio nao recalcula PMR, como previsto.

### O que entrou

| onde | valor |
|---|---|
| `bbts_fechamento_totais` 2026-05-01 | avt 634,31 · prt 5,84 · abertura 25,00 · total 665,15 · seguro_total 40,56 |
| `bbts_prt_parcelas` 2026-05 | 7 parcelas = 5,84, **todas com `n_parcela=0`** |
| daily da ADS, carimbo 2026-05-01 | 10 linhas · a vista 634,31 · seguro 34,18 |

### Junho intacto, conferido nas duas fotos

18 linhas carimbadas 2026-06-01, a vista **7.707,03**, seguro **97,54**, bruto
**266.210,84** — sem uma casa decimal de diferenca. A 212021557 continua carimbo
2026-06-01, a vista 255,26, bruto 4.254,32, `promoter_source
MANUAL_REASSIGNMENT`.

**Nao mudou:** PMR 2026-05 segue 60 linhas `source='cms'`; os 3 estornos seguem
identicos (`debit_sources`=1, `assignments`=2 ambos PENDING com 20,70 e 20,83,
`promoter_debits` CANCELAMENTO_SEGURO da ADS=3). Nenhum debito novo, nenhum
duplicado — os 4 PDFs tinham zero linhas CANCELADO, entao o bloco que chama
`resolveAdsCancelDebits` nem executou.

### As telas

Matriz do /financeiro fecha com o card nos dois meses (delta 0,00). DRE 2026-05:
ADS `receita 699,33` = 634,31 + 5,84 + 34,18 + 25,00. DRE 2026-06: ADS
`receitaFechamento 7.811,58` = 7.707,03 + 97,54 + 7,01, exatamente os
componentes de junho que nao se moveram.

**Uma distincao que precisa ficar escrita:** a linha da ADS passou a APARECER na
matriz da competencia 2026-06, com 699,33. Isso **nao e junho se mexendo** — o
card Recebido e regime de caixa e usa M-1, entao o dinheiro de MAIO aparece na
competencia de JUNHO. E o efeito pretendido de importar maio. Nao foi capturada
imagem-antes dessa tela, entao a afirmacao vem da decomposicao dos componentes,
nao de um delta medido.

### A assimetria dos R$ 6,38, agora viva em producao

Aprovada pelo Diego antes do import, e medida depois:

| | documento | diario | diferenca |
|---|---|---|---|
| a vista | 634,31 | 634,31 | 0 |
| seguro | 40,56 | **34,18** | **6,38** |

Os 6,38 sao a comissao de seguro da 212021557, a proposta excluida.
`bbts_fechamento_totais` guarda os **40,56** (o que a BBTS depositou);
`daily_production_records` soma **34,18**. **As duas tabelas divergem em 6,38 de
proposito** — e a divida estrutural aparecendo como numero, em vez de sumir
dentro de uma linha carregando duas competencias. Quem conferir maio vai
encontrar isso; esta e a explicacao.

### ARMADILHA DE MEDICAO — `buildDre` e POSICIONAL

`buildDre(supabase, year, month)`, nao `buildDre(supabase, { year, month })`.
Passar objeto faz `year && month` dar falso e a funcao cai no `periods[0]` — o
mes fechado **mais recente**. Na 1a medicao pos-import, maio e junho vieram
IDENTICOS, os dois com os 19.048,86 de JULHO, e parecia defeito grave. Nao era.
Registrado em `scripts/diag-ads-dre-mai-jun.cjs`.

---

## ABRIL — A UNICA COISA QUE RESTA

**Nao importado. Decisao do Diego, pendente.**

Abril esta pronto do lado do codigo: o extrator passa (37 propostas, AVT
9.780,86 / PRT 0 / Abertura 225,00 / Total 10.005,86, seguro 14 contratos /
213,47, identidade do cabecalho fechando), e o predicado de carimbo posterior
**aciona 0 de 37** — nao ha nada a bloquear, entao a 1a chamada ja daria 200.

**O que segura e o regime.** `detectMonthRegime` da **2026-04 = `fechamento`**
(PMR com 41 linhas `source='fechamento'`, nenhuma da ADS). A
`reconsolidarCompetenciaFechada` que a rota chama logo apos gravar **RODA** —
dry-run confirmou `ran: true`, **41 promotores**. Maio nao tinha esse risco
porque e regime `cms` (`ran: false`).

Ou seja: importar abril **toca competencia FECHADA e recalcula o PMR de 41
promotores**. E a diferenca de natureza entre as duas competencias, e foi por
isso que a ordem decidida foi maio primeiro, sozinho.

Antes de importar abril, vale medir o dry-run da reconsolidacao promotor a
promotor e comparar com o PMR atual — o import de maio nao gerou esse dado
porque em `cms` a reconsolidacao e no-op.

---

## ORDEM DE IMPORT — cumprida

**MAIO primeiro, sozinho** — feito em 30/08. Abril fica para o Diego decidir
vendo o efeito de maio.

Razão medida: `detectMonthRegime` dá **2026-05 = `cms`** (PMR com 60 linhas
`source='cms'`) e a `reconsolidarCompetenciaFechada` que a rota chama logo após
gravar é **no-op** (`ran:false` — o PMR do regime `cms` é ground truth do
financeiro e não se recalcula pelo fechamento). Já **2026-04 = `fechamento`** e a
reconsolidação **roda**, sobre **41 promotores**.

---

## Os 3 estornos — resolvidos na origem, e o import é idempotente por vacuidade

Medido nos PDFs: os três estão lá, pagos como **POSITIVO**, e o PDF de seguro
**carrega a chave J** (no layout de abril ela é a última coluna). Os três também
têm linha de crédito no PDF da mesma competência.

```
Seguro abril  209621970 … POSITIVO 0,10% R$ 20,83 JJ…
Seguro abril  209867885 … POSITIVO 0,10% R$ 20,70 JJ…
Seguro maio   211689509 … POSITIVO 28/05/2026 JJ… 0,10% R$ 1,40
```

A cascata de débitos não achou dono porque **abril e maio nunca foram
importados**, não porque o dado não exista. A nota que dizia "dono nunca
registrado / sem chave J" está retificada.

Os 4 PDFs têm **zero linhas CANCELADO**, então `result.debitos` sai vazio e o
bloco que chama `resolveAdsCancelDebits` **nem executa** — não há débito novo nem
duplicado. O que já existe fica de pé e o import não remove: `promoter_debits`
AUTO 1,40 para 211689509 (start 2026-07) e `promoter_debit_assignments` 2026-6
PENDING para os outros dois, 20,70 + 20,83 = **41,53**. O desbalanço — débito
lançado sem o crédito de origem — se fecha por decisão, não pelo import.
