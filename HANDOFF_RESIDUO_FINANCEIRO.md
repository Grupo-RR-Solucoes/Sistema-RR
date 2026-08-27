# HANDOFF — feat/residuo-financeiro (27/08/2026)

Frente de três resíduos do fechamento da ADS, mais uma investigação do seguro do RR
que consumiu a maior parte do tempo e terminou sem buraco.

---

## 1. O SEGURO DO RR — ASSUNTO ENCERRADO POR VARREDURA

### Os números que circularam e NÃO se reproduzem

Quatro valores foram tratados como "buraco medido" ao longo da frente. Nenhum
sobreviveu à verificação. Registrado aqui com a procedência de cada um, porque o
mesmo padrão já custou tempo na FRENTE 3 (números invalidados que continuaram
circulando por não terem sido enterrados por escrito):

| valor | de onde veio | o que era |
|---|---|---|
| R$ 10.102,33 | **medição minha**, reportada e depois retratada na mesma sessão | artefato: o mesmo arquivo existe em `RRCRED/Relatório de Produção` **e** em `RRCRED/producao/Relatório de Produção`, e foi somado duas vezes. Deduplicado por nome, o delta é −0,01 |
| R$ 24.591,60 | mensagem do Diego | nunca reproduzido. A coincidência mais próxima é o total de 2023 inteiro, R$ 24.586,60, que **já está no sistema** (1.047 linhas INSURANCE) |
| R$ 128.128,20 | mensagem do Diego | nunca reproduzido |
| R$ 138.245,63 | mensagem do Diego | nunca reproduzido |

### A varredura que fecha o assunto

`scripts/diag-residuo-32-varredura-100.cjs`. Para cada uma das 100
competências-empresa, compara a coluna `COMISSÃO SEGURO` da aba "A Vista" e a
coluna `COMISSÃO` da aba "Seguro" do arquivo em disco contra as linhas
`entry_type='INSURANCE'` do banco, **separadas por `sheet_name` de origem**.

```
74 batem ao centavo
18 divergem  — 17 delas por CENTAVOS (−0,06 a +0,06), Σ = −0,09: arredondamento
 8 sem arquivo em disco (2026-04 e 2026-05 das 4 empresas)
```

**Divergência real: 1.** É a única, e tem nome:

```
2025-02 RR ALAGOAS 1   A Vista arq 2.549,61  bd 0,00  delta 2.549,61
                       Seguro  arq   372,31  bd 0,00  delta   372,31
```

É a competência cujas `monthly_closing_entries` foram apagadas por um
cancelamento de import (2 registros CANCELLED; `operacoes = 6491` prova que as
linhas existiram). O total da empresa está certo — `valor_seguro = 2.549,61`
dentro de `valor_liquido = 97.535,61`, conferido campo a campo. Mas os
**R$ 372,31 da aba "Seguro" nunca entraram no `valor_seguro`**, e as 6.491 linhas
de detalhe estão perdidas. É o único dinheiro de seguro do RR fora do sistema.

### Por que não havia buraco: as duas fontes são independentes e as duas são lidas

O seguro chega por **dois caminhos**, e o importador lê os dois:

- aba **"A Vista"**, coluna `COMISSÃO SEGURO` → `monthlyClosingImport.ts:1085-1098`
  (toda linha CASH gera **também** uma entry INSURANCE)
- aba **"Seguro"**, coluna `COMISSÃO` → `inferSheetType` (`:154`)

O banco registra a aba de origem em `monthly_closing_entries.sheet_name`:

```
2026-06 RR ALAGOAS 3 — 91 linhas INSURANCE
  "A Vista "   81 linhas   Σ(+) 1.603,55   Σ(−)    0,00
  "Seguro"     10 linhas   Σ(+)     0,00   Σ(−) −113,06
  banco: valor_seguro=1.603,55  valor_estorno=113,06
```

**Teste de intersecção** (`scripts/diag-residuo-29-duplicidade.cjs`), chave
`CONTRATO` × `OPERAÇÃO`: **0 de 10** em jun/2026 e **0 de 54** em jan/2026. Nunca
é a mesma operação. Dá para ver por quê na numeração: a aba "Seguro" de janeiro
traz operações `189.682.047` … `199.375.071` (safras anteriores — é o *estoque*),
enquanto a "A Vista" de junho já está em `206.958.579`+ (a venda do mês).

**ARMADILHA NOMEADA:** fazer o importador "somar a coluna da A Vista junto com a
aba Seguro" **duplicaria** o seguro — a coluna já é lida sempre, sem depender da
aba. Em AL3/jun o `valor_seguro` iria de 1.603,55 para 3.207,10. Não fazer.

O **Resumo não arbitra nada**: nos arquivos de 2026 é template com as células de
valor VAZIAS (`C10 = "Comissão Seguros"`, `D10` vazia). Por isso
`readResumoTotals` devolve `null` e o `Object.assign` de `:1560-1563` não roda —
os totais vêm das entries. Nos arquivos de 2023/2024 o Resumo TEM valor, e bate.

### Panorama, para não reabrir

```
ano   comps  com linha INSURANCE  sem linha   Σ valor_seguro   Σ linhas INSURANCE
2022      1                   1          0          416,85                   15
2023     12                  10          2       24.586,60                 1047
2024     19                  19          0       74.677,89                 4988
2025     40                  39          1      123.669,06                 9615
2026     28                  28          0       36.672,28                 3477
TOTAL   100                  97          3      260.022,68                19142
```

As 3 sem linha: 2023-09 e 2023-12 (AL1) — o próprio Resumo declara
`Comissão Seguros | 170 | 0` e `| 87 | 0`, quantidade > 0 e **valor zero**; e
2025-02 (AL1), acima.

---

## 2. REIMPORTAR FECHAMENTO — O QUE SOBREVIVE E O QUE NÃO

Medido em 27/08/2026, não inferido.

**SOBREVIVE:**
- linhas de produto BBCAP / CONTA_CORRENTE / CONSORCIO — excluídas do delete
  (`monthlyClosingImport.ts:1570-1580`)
- débitos da **ADS** — `.neq("company_id", BBTS_COMPANY_ID)` em
  `debitInsuranceResolver.ts:420`
- `bbts_seguro_pago` e `srcc_resolucao` da ADS — moram em
  `daily_production_records`, outra tabela; o fechamento RR não os alcança
- atribuições `ASSIGNED` na fila (`debitInsuranceResolver.ts:312, 523`)
- débitos de cancelamento de **2026-06** — `DEBITO_AUTO_PRIMEIRA_COMPETENCIA =
  "2026-07"` congela tudo anterior. São 17 linhas, R$ 899,21.

**NÃO SOBREVIVE:**
- `monthly_closing_entries` da competência (delete-and-replace)
- débitos `CANCELAMENTO_SEGURO` de **2026-07** — 19 linhas, R$ 420,30 — são
  apagados e recriados a partir do mesmo fechamento

**TRAVA INOPERANTE, registrada:** a 2ª guarda de `persistAutoInsuranceDebits`
(`:1856`) só protege competência que tenha alguma parcela `CANCELAMENTO_SEGURO`
com `status='APPLIED'`. Medido: **não existe nenhuma** em todo o banco — os 6
APPLIED são ADIANTAMENTO (5) e LIQUIDACAO_ANTECIPADA (1), todos ≤ 2026-05. A
trava é real no código e vazia no dado; ela só passa a valer quando alguém marcar
APPLIED. Ver a memória `promoter-discounts-sem-contador`.

---

## 3. OS TRÊS CONSERTOS DA ADS (implementados, SQL não executados)

### Abertura de Conta — R$ 100,00 em 2026-07
`extractCabecalhoNf` pareia rótulo↔valor por geometria e valida pela identidade
da soma (componentes = "Pagamento Total", senão LANÇA). Necessário porque o 4º
rótulo mudou de "Valor Descontado" (06/26) para "Glosa" (07/26), e porque ler por
posição quebra num mês sem coluna PRT. Detalhe medido: em 07/26 o rótulo "Glosa"
começa em x=565,1, à DIREITA do seu próprio valor (x=562,6) — pareamento por
proximidade, não por ordem de x.

Valor vai para `bbts_fechamento_cabecalho`, tabela por competência (mesmo
precedente do PRT: grandeza de competência, não de contrato).

### Linha só-seguro — R$ 89,42
1 linha em todo o banco (contrato 221262790). O bloco só-seguro não promovia o
valor a coluna. Corrigido no código. A linha existente depende do SQL 3.

**ERRATA:** o comentário do `financialAnalytics` dizia "faltam R$ 139,97 da ADS em
jul/2026". Só os R$ 100,00 eram de julho — os 89,42 caem na janela 2026-08,
porque aquela linha está com `movement_date=2026-07-31` (a janela manda 31/07
para agosto) enquanto as 12 irmãs do mesmo fechamento estão em 2026-07-15.

### Import só-crédito
`seguro_pdf_ausente` distingue ausência de zero. Com a bandeira, as chaves de
seguro são **omitidas** do registro (no merge por dono de coluna, omitir é "não
tocar") em vez de zeradas. Medido: `ownedColumnsFor(FULL, …)` passou a tocar
**0** colunas de seguro, contra 5 antes. Sem o conserto, importar só o crédito de
julho zerava 12 linhas — R$ 115,10 de `bbts_seguro_pago` e R$ 113.345,57 de
`insurance_value` — com `ancora_ok=true`.

---

## 4. SQL PENDENTES (nada executado)

```
20260827_000001_bbts_fechamento_cabecalho.sql        cria a tabela (aditiva, vazia)
20260827_000002_bbts_cabecalho_seed_jun_jul.sql      grava jun e jul sem reimportar PDF
20260827_000003_bbts_seguro_pago_linha_so_seguro.sql 1 linha; move movement_date p/ julho
```

O SQL 3 move a linha de competência: leva R$ 12.200,00 de produção e R$ 89.415,39
de base segurada para a janela 2026-07, que é mês FECHADO. Nada recalcula sozinho.
Para deixar os R$ 89,42 em agosto sem mover produção, apagar a linha
`movement_date = date '2026-07-15',` do UPDATE.

---

## 5. DÍVIDA NOMEADA, NÃO ABERTA

A rota de cancelamento (`app/api/import/closing/cancel/route.ts:49-56`) apaga
`monthly_closing_entries` por `monthly_closing_import_id` e **não recompõe**
`fechamento_mensal_empresa`. É o que deixou 2025-02 AL1 com total certo e detalhe
zerado. Um check `fechamento_sem_entries` pegaria as 2 competências nessa
situação hoje (2023-12 e 2025-02, ambas AL1).

---

## 6. A LIÇÃO — a varredura devia ter vindo na primeira suspeita

Quatro números foram tratados como buraco medido ao longo desta frente, em ordem
crescente: R$ 10.102,33 → R$ 24.591,60 → R$ 128.128,20 → R$ 138.245,63. Nenhum
sobreviveu. O que os derrubou foi uma varredura exaustiva
(`scripts/diag-residuo-32-varredura-100.cjs`) que compara, para as 100
competências-empresa, a coluna do arquivo contra as linhas do banco separadas por
`sheet_name` de origem — e que levou minutos para escrever e rodar.

Ela veio na QUINTA rodada de suspeita. Devia ter vindo na primeira. Cada rodada
intermediária produziu uma medição parcial que parecia confirmar o buraco e que,
por ser parcial, alimentou a rodada seguinte com um número maior.

O erro estruturante foi sempre o mesmo: **somar o que o arquivo declara sem
verificar, linha a linha e por origem, o que o banco já tem**. Foi assim que o
meu R$ 10.102,33 nasceu (o mesmo arquivo somado duas vezes por existir em duas
árvores de diretório) e é a forma de erro que os outros três também tinham —
contar como faltante o que já estava gravado.

**REGRA:** diante de suspeita de dinheiro faltando, a primeira medição é a
varredura exaustiva do universo inteiro, cruzando documento contra banco pela
chave de origem. Amostra e soma agregada vêm depois, para explicar o que a
varredura achar — nunca antes, para decidir se há o que achar.

Mesmo padrão dos números invalidados da FRENTE 3.

---

## 7. ERRATA DO ITEM 4 — os débitos de cancelamento

Uma versão anterior deste registro dizia que os débitos "sobrevivem à
reimportação porque `promoter_discounts` é reconstruído a partir de
`promoter_debits`, que a reimportação não toca". As duas metades estão erradas.
Medido em 27/08/2026:

- o resolver **apaga** `promoter_debits` (`debitInsuranceResolver.ts:416-428`),
  com predicado `kind='AUTO'` + `debit_type=CANCELAMENTO_SEGURO` + competência +
  `company_id != ADS`; parcelas e sources caem por CASCADE
- `promoter_discounts` recebe **insert** do resolver (`:454`) — o fluxo é o
  contrário do descrito

```
promoter_debits hoje:
  2026-06 | CANCELAMENTO_SEGURO | RR      17      899,21
  2026-07 | CANCELAMENTO_SEGURO | ADS      3       49,45
  2026-07 | CANCELAMENTO_SEGURO | RR      16      370,85
```

O que de fato acontece:

- **2026-06 sobrevive** — mas pela trava de competência
  (`DEBITO_AUTO_PRIMEIRA_COMPETENCIA = "2026-07"`), que impede
  `persistAutoInsuranceDebits` de chamar o resolver. Não é a tabela que está
  protegida; é a competência.
- **2026-07 NÃO sobrevive** — 16 linhas RR (R$ 370,85) apagadas e recriadas a
  partir do mesmo fechamento. Débitos com `kind` diferente de `AUTO` (lançados à
  mão) não são alcançados pelo predicado.
- **Os 3 débitos da ADS (R$ 49,45) sobrevivem** — `.neq("company_id", BBTS)`.

A 2ª trava (`:1856`, competência com parcela `APPLIED`) segue inoperante: não há
nenhum `CANCELAMENTO_SEGURO` com status APPLIED em todo o banco.
