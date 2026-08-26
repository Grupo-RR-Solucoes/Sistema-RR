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
