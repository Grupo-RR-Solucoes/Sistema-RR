# Detalhamento do Financeiro — matriz EMPRESA × PRODUTO

Mapeamento medido em 26/08/2026, ramificação `feat/financeiro-detalhamento` (a
partir de `158b881`). Scripts em `scripts/diag-fin-*.cjs`, SOMENTE SELECT.

---

## 1. As duas matrizes fecham 100% — não há linha "não atribuído"

```
card 'Recebido'        = 318.596,26   matriz = 318.596,26   delta = 0,00
card 'Comissoes pagas' = 139.451,16   matriz = 139.451,16   delta = 0,00
```

Todas as fontes carregam empresa:

| fonte | coluna de empresa |
|---|---|
| `fechamento_mensal_empresa` | `empresa_cnpj` |
| `receita_lancamento_manual` | `company_id` **+ `categoria`** |
| `promoter_monthly_results` | `company_id` (0 nulos em 58 linhas de jul/26) |
| `promoter_discounts` | `company_id` (24 de 24) |
| `bbts_prt_parcelas` | `company_id` |
| `daily_production_records` | `company_id` |

`receita_lancamento_manual` tem `company_id` e `categoria` no banco, mas o select de
`lib/financialAnalytics.ts:645` pega só `ano, mes, valor, data_credito` — **a empresa
existe e é descartada na consulta**.

## 2. O PRT não precisa de derivação: a empresa está na própria linha

`monthly_closing_entries` com `entry_type='PRT'` em jul/26:

```
linhas PRT em 2026-07: 10258        <- nao 340
  company_id    | nao-nulo em 10258/10258
  company_cnpj  | nao-nulo em 10258/10258
  j_key         | nao-nulo em 10258/10258
  promoter_id   | coluna NAO existe
```

**Não existe coluna `promoter_id` nessa tabela**, então a junção `promoter_id → PMR`
não é um caminho disponível para o PRT — e também não é necessária, porque a empresa
vem carimbada em 100% das linhas.

A matriz do Recebido nem usa essa tabela: usa `fechamento_mensal_empresa.valor_diferido`,
agregado por CNPJ (R$ 51.806,30 RR + R$ 7,01 ADS em jul/26).

RECONCILIAÇÃO PENDENTE, fora do escopo desta frente: Σ `commission_value` das 10.258
entradas = R$ 54.594,05 contra `valor_diferido` R$ 51.806,30 — **R$ 2.787,75** de
diferença entre a tabela de entradas e a de totais. Ninguém conferiu isso.

## 3. PROMOTOR MULTI-EMPRESA — real, e não é protegido por desenho

Em jul/26: **50 promotores, 42 com uma empresa, 8 com duas** (todos pares RR+ADS).

Os quatro nomes que o Diego citou EXISTEM (a coluna é `promoters.name`, não
`full_name`), e três deles têm competência multi-empresa:

```
CAMILA GOMES XAVIER  2026-06 | RR ALAGOAS 3=2.322,88 | ADS=779,29      <<< MULTI
MARIA LETICIA        2026-06 | RR ALAGOAS 3=1.662,79 | ADS=985,47      <<< MULTI
MARIA LETICIA        2026-07 | ADS=104,27 | RR ALAGOAS 3=302,39        <<< MULTI
FABIANA BEZERRA      2026-06 | RR ALAGOAS 3=1.207,90 | ADS=584,47      <<< MULTI
CAMILA CAVALCANTE    trocou de empresa ao longo do ano (AL1 -> ADS -> AL1)
LETICIA JAYENE       7 competencias, sempre RR PERNAMBUCO (uma empresa)
```

MARIA LETICIA aparece em **3 empresas distintas** ao longo de 2026 (AL1, AL3, ADS).

**POR QUE ISSO NÃO QUEBRA A MATRIZ HOJE:** o PMR já está no grão
`(promotor × empresa)` — cada combinação tem LINHA SEPARADA com `company_id` próprio.
Agrupar por `company_id` soma certo, e o promotor contribui para duas linhas da
matriz, que é o correto.

**ISSO É AUSÊNCIA CIRCUNSTANCIAL, NÃO PROTEÇÃO PROJETADA.** A ambiguidade só
apareceria se houvesse uma linha SEM empresa a ser atribuída via promotor. Hoje não
há. No dia em que uma fonte de PRT por parcela chegar SEM `company_id`, a junção por
promotor fica ambígua para estes casos e vai precisar de critério — o contrato
original, a empresa de maior produção, ou cair em "não atribuído". Nada no código
impede isso hoje.

## 4. `diferido_parcelas` — dívida de dado, não de tela

Única fonte do Financeiro sem vínculo de empresa. Três medições:

- **Vazia:** 0 linhas.
- **Fora do Recebido:** alimenta só `futureDeferredBalance`
  (`lib/financialAnalytics.ts:829-840`), que é saldo diferido FUTURO.
- **A empresa não seria derivável se ela fosse populada.** Sondagem coluna a coluna:

```
company_id | NAO EXISTE      valor         | existe
empresa_cnpj | NAO EXISTE    status        | existe
proposal_number | NAO EXISTE data_prevista | existe
contrato | NAO EXISTE
j_key | NAO EXISTE
mci | NAO EXISTE
source_filename | NAO EXISTE
```

Nenhum dos três caminhos de derivação (contrato, chave J/MCI, arquivo de origem)
existe. **O conserto é na ESCRITA, não na leitura.**

---

## 5. IMPLEMENTADO — aba "De onde veio" (26/08/2026)

Aba nova em `/financeiro`, ao lado de "Caixa & Resultado" e "DRE". Duas matrizes
EMPRESA × COMPONENTE: entrada (Recebido) e saída (Comissões pagas).

### Decisões de leitura

- **Por LINHA.** A pergunta é "de onde veio cada real", e "de onde" é EMPRESA — é
  como a NF é emitida e como o Diego somou à mão quando descobriu que a ADS faltava.
  Total de linha em negrito; total de coluna no rodapé, discreto.
- **Empresa sticky** na 1ª coluna: quando "Outros" expande, ela não sai da vista.
- **Zero vira `—`**, não `0,00`. O vazio da ADS nas colunas de produto É informação:
  ela não vende consórcio nem BBCAP.
- **ADS por último**; é a diferente em gestora, fonte e cobertura de colunas.
- **SEM DELTA.** Regra transversal respeitada: nenhuma variação vs mês anterior. O
  único número comparativo é a conferência, que é reconciliação da MESMA competência.

### Lançamentos avulsos em linha própria (decisão do Diego)

A receita manual NÃO é distribuída entre as empresas — linha própria, marcada
`avulso`, desdobrada por CATEGORIA (não por produto). NOTA FACTUAL: a tabela
`receita_lancamento_manual` TEM `company_id`, então atribuir não seria inventar
procedência — mas a decisão se sustenta pela NATUREZA: o ressarcimento de
R$ 1.509,44 tem competência de origem 06/2026 e caixa 07/2026, e diluir na linha da
empresa esconderia isso.

### Dois defeitos que a implementação revelou

1. **Descontos caíam em "sem empresa".** `promoter_discounts` tem `company_id`, mas
   o select de `financialAnalytics.ts` não o trazia — a matriz jogava R$ 1.664,99
   numa linha órfã. Corrigido no select (`company_id` adicionado).
2. **Resíduo de arredondamento de R$ 0,01** em jul/26 na saída. O card faz
   `round(Σ A) − round(Σ B)`; a matriz fazia `Σ round(A_empresa − B_empresa)`. Um
   centavo em R$ 115 mil é irrelevante como dinheiro e FATAL como matriz — o Diego
   confere somando a coluna. Resolvido por `fecharLinha()`, que devolve o resíduo
   para a MAIOR célula, e por reconciliação em `montarMatriz()` limitada a
   1 centavo por linha. **Acima disso o delta SOBREVIVE e a tela mostra** — aí é
   divergência de verdade, e a linha de conferência existe para denunciar.

### Gate — `scripts/financeiro_matriz_fecha_gate.cjs` (needs-db)

30 asserções em 3 competências × 2 lados. Nenhuma constante congelada: o lado
esperado é sempre o card do MESMO payload.

| mutação | resultado |
|---|---|
| componente novo no Recebido, matriz intacta (`+1.234,56`) | **VERMELHO, 3 falhas** — as 3 competências da entrada |
| coluna "Consórcio" removida das `COLS_SAIDA` | **VERMELHO, 4 falhas** — células ≠ total e linhas ≠ colunas |
| revertido | VERDE |

A primeira mutação é exatamente o cenário que o Diego nomeou: "se alguém
acrescentar componente ao Recebido e esquecer da matriz, o portão reprova".

---

## 6. A MARCA DE FONTE NA COLUNA — o que ela diz, e o que ela NÃO diz

Pedido original: marcar a coluna PRT dizendo que a atribuição por empresa é
*derivada do promotor*, porque `diferido_parcelas` não guarda a empresa.

**Esse texto não foi para a tela porque é falso.** Medido:

| caminho do PRT | atribuição de empresa |
|---|---|
| coluna PRT da matriz (RR) | `fechamento_mensal_empresa.valor_diferido`, por `empresa_cnpj` — **LIDO** |
| PRT por entrada | `monthly_closing_entries.company_id`, **10.258/10.258** — **LIDO** |
| PRT da ADS | `bbts_prt_parcelas.company_id` — **LIDO** |
| `diferido_parcelas` | **vazia (0 linhas)** e fora do Recebido |

E a junção que a nota descreveria **não existe**: `monthly_closing_entries` **não tem
coluna `promoter_id`**. Não há de onde derivar — nem necessidade.

Uma nota de rodapé alegando derivação faria a tela declarar uma incerteza inventada
e descrever um mecanismo inexistente. É o mesmo dano que a marca pretendia evitar,
na direção contrária.

### O que FOI marcado, porque é verdade e estava invisível

A coluna mistura **duas fontes**. As colunas com `*` (À vista, PRT, Seguro) trazem
RR e ADS de origens diferentes:

> `*` coluna com DUAS fontes: as 4 RR vêm do fechamento da Promotiva (agregado por
> CNPJ); a ADS vem do que a BBTS pagou, somado por linha. Nos dois casos a empresa é
> LIDA do dado, nunca derivada.

Mais um `<details>` "Fonte de cada coluna" com a tabela/coluna de origem de cada uma.
A distinção que isso preserva: o número do RR é **o que a Promotiva declarou**; o da
ADS é **o que a BBTS pagou, somado por nós**. As duas são lidas, mas não são a mesma
coisa, e quem confere precisa saber qual está olhando.

### Promotor multi-empresa — registrado no código, não na tela

Está em comentário em `lib/financialAnalytics.ts`, junto das colunas:

- É real: 8 de 50 em jul/2026. **CAMILA GOMES**, **MARIA LETICIA** e **FABIANA** têm
  competência com duas empresas; MARIA LETICIA aparece em **três** empresas
  distintas ao longo de 2026. (Os nomes estão em `promoters.name`, não `full_name` —
  uma busca no campo errado dá zero e engana.)
- **Não afeta esta matriz**, porque o PMR já está no grão `(promotor × empresa)`,
  com linha e `company_id` próprios.
- **É ausência circunstancial de problema, não proteção projetada.** No dia em que
  chegar uma fonte de PRT por parcela SEM `company_id`, atribuí-la via promotor fica
  ambíguo exatamente para esses casos e vai precisar de critério — contrato original,
  empresa de maior produção, ou não-atribuído. Nada no código impede isso hoje.

Não vai para a tela porque hoje não há número derivado a sinalizar; marcar seria
avisar sobre um risco que não está no dado exibido.

---

## 7. A matriz voltou para DENTRO de "Caixa & Resultado" (26/08, decisão do Diego)

A aba "De onde veio" foi removida — a tela volta a ter **2 abas** (Caixa & Resultado,
DRE). O detalhamento explica os cards, então mora no mesmo lugar que eles.

**Ordem: ENTRADA → SAÍDA → SALDO.** O saldo é a subtração das duas tabelas que
acabaram de ser mostradas, então vem depois delas.

**Abertas por padrão.** Matriz recolhida é matriz que ninguém abre, e ela existe
justamente para o total não ser aceito às cegas.

### ARMADILHA DE RÓTULO no bloco Saldo — nomeada no código

A subtração das duas matrizes é `Recebido − Comissões pagas`, que corresponde ao card
**"Saldo"** (que ainda abate despesas). **NÃO** é o card **"Saldo de comissões à
vista"**, que usa `receivedEmpresa` — um SUBCONJUNTO do Recebido (só à-vista +
seguro, sem PRT nem produtos).

Em ago/2026 os dois são: **179.145,10** (Saldo) contra **111.926,89** (Saldo de
comissões à vista). Confundi-los daria um saldo errado em R$ 67 mil. O bloco
`SaldoDasMatrizes` escreve a conta na tela e confere contra o card "Saldo".

### Custo de altura — calculado a partir do CSS, não renderizado

| bloco | altura |
|---|---|
| matriz ENTRADA | ~360px |
| matriz SAÍDA | ~317px |
| bloco SALDO | ~112px |
| gaps (3 × 22) | ~66px |
| **total abaixo dos cards** | **~855px** |

Expandir "Outros" não custa altura (troca colunas, não linhas) — mas em 1366 passa a
rolar horizontalmente dentro da matriz (~1385px de conteúdo contra ~1270px úteis).

**Em 1366 isso é mais de uma tela extra de rolagem** (viewport útil ~630px). Foi o
atrito que motivou a proposta de aba separada; a decisão foi aceitá-lo em troca de o
detalhamento ficar junto do que ele explica.

---

## 8. TERCEIRA MATRIZ — despesas (EMPRESA × CATEGORIA), 26/08/2026

### O dado, medido (contagem exata)

```
financial_expenses: 5 linhas no total
  2026-05 | RR PERNAMBUCO | Folha      | COMPANY | PAID |  4.361,28
  2026-05 | RR PERNAMBUCO | FGTS       | COMPANY | PAID |    348,90
  2026-05 | RR ALAGOAS 1  | Folha      | COMPANY | PAID | 22.613,07
  2026-05 | RR ALAGOAS 1  | Pró-labore | COMPANY | PAID |  5.000,00
  2026-05 | RR ALAGOAS 1  | FGTS       | COMPANY | PAID |  1.809,03
  TOTAL = 34.132,28

despesas de escopo GRUPO: 0 linhas, R$ 0,00
junho/2026: 0 linhas, R$ 0,00
```

`company_id` preenchido em 5/5; `scope = COMPANY` em 5/5. **Uma única competência
com movimento: 2026-05.** Jun, jul e ago estão zerados — a matriz nasce vazia nas
três competências que o Diego olha hoje, e mostra "Nenhuma despesa lançada em X".

### O corte das colunas — e por que é DIFERENTE das outras duas

Nas matrizes de entrada e saída as colunas são **estruturais**: componentes fixos do
fechamento e do PMR, sempre os mesmos, sempre com valor. Aqui a categoria é um
cadastro **aberto** — 11 hoje, podem virar 15 — e o uso é concentrado: das 11
cadastradas (todas ativas, todas `is_default`, nenhuma criada por usuário) apenas
**3 tiveram movimento**:

```
Folha       | 26.974,35 | 79,0%
Pró-labore  |  5.000,00 | 14,6%  (acum 93,7%)
FGTS        |  2.157,93 |  6,3%  (acum 100,0%)
```

Colunas fixas dariam **8 colunas de zero permanente**. Então: as categorias com
valor na competência exibida, ordenadas por valor, **teto de 4 colunas**; da 5ª em
diante entra em "Outros", expansível — o mesmo critério de materialidade das outras
duas.

### A linha de GRUPO — rótulo deliberado

`"Grupo (sem empresa)"`, **nunca** `"não atribuído"`. A primeira diz *esta despesa
não pertence a uma empresa*; a segunda diria *faltou o dado*. São coisas diferentes
e só uma é verdade aqui: `lib/financialAnalytics.ts:1058` define despesa de grupo
como `scope ∈ {GROUP, GRUPO}` **ou** `company_id` nulo — é categoria legítima, e o
`dre.ts:560-570` já a trata como tal.

### As três competências são DIFERENTES, e cada matriz diz a sua

`lib/financialAnalytics.ts:833` — `selectedExpenses` filtra por `selectedPeriod`, o
mês CORRENTE, enquanto Recebido e Comissões pagas leem M-1. **Não é defeito, é o
regime de caixa**: o que entrou veio do fechamento do mês passado; a despesa é deste
mês. Três tabelas na mesma tela com janelas diferentes seriam um convite ao erro se
não dissessem qual é — por isso os subtítulos passaram a ser explícitos:

- `Recebido — fechamento de jul/26 (M-1)`
- `Comissões pagas — competência jul/26 (M-1)`
- `Despesas — competência ago/26 — o mês CORRENTE, não M-1`

### O fechamento — as duas provas

```
2026-05 despesa: matriz 34.132,28 · card 34.132,28 · delta 0,00
2026-05: 238.727,01 − 93.540,18 − 34.132,28 = 111.054,55 = card "Saldo"
2026-06: 249.566,80 − 105.773,30 − 0,00 = 143.793,50 = card
2026-07: 274.217,84 − 115.936,94 − 0,00 = 158.280,90 = card
2026-08: 318.596,26 − 139.451,16 − 0,00 = 179.145,10 = card
```

**O card "Saldo" ficou rastreável pelas três matrizes.**

### Gate — mutação provada

`maio/2026 é OBRIGATÓRIO` na lista de competências do gate: é a única com despesa
real. Sem ela o lado da despesa passaria por **vacuidade** (matriz vazia contra card
zerado fecha trivialmente).

| mutação | resultado |
|---|---|
| card Despesas anda R$ 777,77, matriz intacta | **VERMELHO, 8 falhas** (4 de `matriz == card` + 4 do Saldo) |
| teto de categorias 4→2 e a cauda some em vez de ir para "Outros" | **VERMELHO, 2 falhas** |
| revertido | VERDE |

**VACUIDADE DECLARADA:** a asserção do rótulo de GRUPO **não exercita hoje** —
mutá-la para `"nao atribuido"` mantém o gate VERDE, porque não existe despesa de
grupo no banco. Ela é uma trava POSICIONADA para quando a primeira aparecer, não uma
prova de que o rótulo funciona. Está declarado no cabeçalho do próprio gate.

---

## 9. A matriz de despesa NUNCA some (26/08/2026)

**Decisão do Diego.** Seção que aparece em alguns meses e some em outros cria
comportamento inconsistente — quem olha não sabe se não há despesa ou se a tela
quebrou. E há o caso prático: quando houver lançamento na competência corrente, o
Diego precisa ter ONDE conferir depois de lançar; se a seção só nascesse com dado,
ele não acharia o lugar.

Estado vazio com `EmptyStatePanel` (`components/EmptyStatePanel.tsx`, o do kit),
`compact`, com ação para `/despesas`:

> **Sem lançamento** · Nenhuma despesa lançada na competência ago/26.
> Assim que houver lançamento, ele aparece aqui por empresa e categoria, e o total
> desta tabela passa a bater com o card. → *Ir para Despesas*

**Não é tabela com traços.** Traço em célula significa "esta célula é zero"; uma
tabela inteira de traços diria "todas as empresas gastaram zero", que é diferente de
"ninguém lançou nada". A linha de conferência continua visível no vazio
(`0,00 · card 0,00 · delta 0,00`) — é ela que prova que o vazio é vazio de verdade.

CORREÇÃO DE REGISTRO: em mensagem anterior eu disse que não havia `Table` no kit.
**Havia** — `components/ui/Table.tsx` exporta `Table` e `Num`. A `MatrizTabela`
segue própria porque precisa de coluna sticky, cabeçalho clicável e rodapé de
conferência, mas a afirmação estava errada.

### As três competências, medidas

```
CAIXA ago/26   entrada 318.596,26 | saida 139.451,16 | despesa VAZIA (0,00)
               saldo 318.596,26 - 139.451,16 - 0,00 = 179.145,10 = card [FECHA]

CAIXA jun/26   entrada 249.566,80 | saida 105.773,30 | despesa VAZIA (0,00)
               saldo 249.566,80 - 105.773,30 - 0,00 = 143.793,50 = card [FECHA]

CAIXA mai/26   entrada 238.727,01 | saida  93.540,18 | despesa 34.132,28
               Folha 26.974,35 · Pro-labore 5.000,00 · FGTS 2.157,93
               saldo 238.727,01 - 93.540,18 - 34.132,28 = 111.054,55 = card [FECHA]
```

**jun/26 está VAZIO de despesa** — 0 linhas, R$ 0,00. Não há R$ 55 mil em junho; a
tabela `financial_expenses` tem 5 linhas no total e todas são de **mai/26**
(contagem exata, medida três vezes). A competência a conferir com dado real é
**mai/26**, não jun/26.
