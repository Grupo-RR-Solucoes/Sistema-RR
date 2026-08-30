# ADS abril e maio/2026 — o fechamento que nunca entrou

Estado em 30/08/2026. Branch `feat/ads-abril-maio-fechamento`.
**NADA FOI IMPORTADO. Nenhuma escrita no banco.**

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

## PROPOSTA — como excluir a linha sem inventar exceção (PARA APROVAÇÃO)

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

Duas perguntas em aberto para você:
1. **pular e avisar**, ou **recusar com 409** e exigir confirmação, como já se faz
   quando falta o PDF de seguro?
2. o predicado exclui a **proposta inteira**, ou só as colunas que moveriam a
   linha (`movement_date`, `bbts_competencia_fechamento`, `gross_value`)? A
   primeira é mais simples e mais fácil de explicar; a segunda gravaria o seguro
   de maio na linha de junho, o que **é a dívida estrutural disfarçada de conserto**
   — e por isso não a recomendo.

**Nada disso está implementado.** O predicado só existe no diagnóstico que o mede.

---

## ORDEM DE IMPORT — decidida

**MAIO primeiro, sozinho.** Depois o Diego decide abril vendo o efeito de maio.

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
