# Cancelamento com dono automático — ADS

Frente medida e implementada em 27/08/2026, ramificação `feat/cancelamento-dono`
(a partir de `af3c19e`). Scripts em `scripts/diag-canc-*.cjs` (SOMENTE SELECT).

## A frente NÃO é sobre R$ 1,40

O valor em jogo hoje é um cancelamento de R$ 1,40. **O objetivo é eliminar o passo
manual**: até aqui, quem descobria de quem era o contrato cancelado e abatia na
planilha era o financeiro, à mão, todo mês. A rotina automática assume esse passo.

---

## 1. A FILA — fechada, e o motivo REAL

As duas operações de jun/2026 (`209867885` R$ 20,70 e `209621970` R$ 20,83) **não
serão processadas**. Medido:

```
209867885 : 0 linhas em daily_production_records, cms_promoter_entries,
            bbts_prt_parcelas e monthly_closing_entries
209621970 : 0 linhas em todas as quatro
```

**O motivo NÃO é "o cms já traz o desconto embutido".** Isso foi testado e é falso —
ver seção 3. O motivo é mais forte: **essas operações nunca existiram como produção**,
então o promotor **nunca recebeu comissão por elas** e não há o que estornar.
Debitá-las seria cobrança indevida.

Além disso, elas são da ADS (`source_kind = DAILY_CANCEL`), não do RR — o cms nem
se aplica a elas.

Ficam em `promoter_debit_assignments` com `status = PENDING`. **O gate trava que elas
continuem lá** — se algum dia virarem débito, é regressão.

## 2. O que foi implementado

`lib/debitInsuranceResolver.ts`:

- **`resolveAdsCancelDebits` ganhou a cascata do RR.** Até 27/08 olhava SÓ
  `daily.assigned_promoter_id`. Agora: fila-atribuída → `daily.assigned` → 
  `cms.promoter_id` → `j_keys` INDIVIDUAL. A ordem importa: o `daily` é o dado VIVO
  (reatribuição manual mora nele); o `cms` é seed histórico.
- **`promotorInativoNaData()`** — helper exportado com a regra do critério.

Efeito medido (dry-run, sem gravar):

```
jul/2026 — 211689509 (R$ 1,40)  -> BRUNA ALVES, resolvedVia="cms"   [sai da fila]
jun/2026 — as 2 sem producao    -> 0 debitos, 2 na fila             [continua]
jul/2026 — as 2 ja debitadas    -> MARIA LETICIA, resolvedVia="daily"
```

**O R$ 1,40 é gravado no próximo import do fechamento da ADS** — não escrevi no banco.

## 3. O cms NÃO traz o desconto embutido — provado por 4 ângulos

Isto foi afirmado duas vezes ao longo da frente e é **falso**. Medido:

```
promoter_credit  < 0 : 0 de 3.045 linhas
promoter_insurance < 0: 0 de 3.045
chaves do raw_payload com cara de estorno/desconto: NENHUMA
  (as 18 sao de VENDA: COMISSAO PF, COMISSAO SEGURO, VALOR BRUTO, % PENETRACAO...)
os 141 contratos cancelados em jan/26 presentes no cms: 0
PMR do cms x soma CRUA do cms: jan delta 0,02 | mai delta 0,05 (arredondamento)
```

**Consequência:** as competências `source='cms'` mostram a comissão **BRUTA**. A
desatualização é real: **76 casos, R$ 1.175,30** em 2026, concentrada em jan-mai
(0,02% a 0,32% da comissão de cada competência).

**DÍVIDA ACEITA, não problema resolvido.** O backfill foi descartado por mérito — o
dinheiro já saiu certo no fluxo manual, o valor é irrisório em proporção, e lançar
retroativo mexeria em números de caixa de meses fechados. Mas o histórico **segue
mostrando comissão maior que a real**, e isso não deve ser reaberto como "já está
redondo".

## 4. O promotor inativo — VALIDA E PARA (opção (a))

**A regra:** vale o estado do promotor **quando o débito chega**, não quando o
cancelamento ocorreu. Desativado em maio + débito em junho → **empresa**.

**O campo é `promoters.dismissed_at`** (com data, preenchido em 14/14 dos inativos),
ao lado de `active` e `status`. **NÃO é `is_active`** — essa coluna não existe. E
**não é `app_users.active`**: essa tabela tem 7 linhas para 72 promotores, só 1
ligada a promotor, e nenhuma coluna de data — ela corta LOGIN, não vínculo.

**ONDE CAI O DÉBITO DA EMPRESA: ainda não há lugar, e isso é DELIBERADO.**
`promoter_debits.promoter_id` é NOT NULL (`20260709_000001:35`). O caminho previsto é
`promoter_discounts.apply_to_company = true` — campo que já existe e que o
`payableByCompetencia` já respeita, hoje `false` em 74/74.

**Por que não foi implementado:** ZERO casos. Os 33 débitos AUTO apontam todos para
promotor ativo, e **13 dos 14 inativos não têm chave J** — o caminho que os alcançaria
mal existe. Criar estrutura para hipótese é dívida gratuita.

**Quando o primeiro caso aparecer**, `promotorInativoNaData()` devolve `true` e o
resolvedor **sobe um aviso** dizendo que o débito deveria ser da empresa e que é hora
de criar o lugar. Até lá ele lança no promotor para não perder o rastro.

## 5. O gate — `scripts/ads_cancelamento_dono_gate.cjs` (needs-db)

| mutação | resultado |
|---|---|
| tirar o degrau `cms` da cascata | **VERMELHO** — o R$ 1,40 volta para a fila |
| inverter o critério do inativo | **VERMELHO** |
| resolvedor ganancioso (aceita MASTER) | **VERDE — não pega** |
| revertido | VERDE |

**LIMITE DECLARADO no cabeçalho do gate:** a asserção "não inventa dono" **não pega**
um resolvedor que aceite chave MASTER, porque as duas operações de junho não têm
chave J nenhuma e o ramo da chave nem executa. Cobrir isso exigiria um caso com chave
MASTER não resolvido antes pelo `cms` — não existe no dado de hoje.

**VACUIDADE DECLARADA:** o critério do inativo é exercitado com casos sintéticos; o
caminho de PRODUÇÃO não dispara hoje (0 casos).

## 6. Fora do escopo

**Cancelamento de PROPOSTA (crédito) não existe em lugar nenhum.** Os dois
resolvedores tratam só seguro. Se a regra é "proposta ou seguro", essa metade é
frente própria e maior que esta.

---

## 7. A DECISÃO SOBRE O DÉBITO DA EMPRESA — opção (a), com as três registradas

**Decisão do Diego, 27/08/2026: (a) validar e parar com aviso.**

Motivo: hoje há ZERO casos reais na fila de cancelamento. Não é adiar problema — é
reconhecer que não há problema para resolver.

### O comportamento implementado

Promotor **ATIVO** → débito em `promoter_debits` com `company_id` da ADS, idempotente.

Promotor **INATIVO na data do débito** → **NÃO lança**. O item vai para a fila com
motivo explícito e sobe aviso em alto e bom som:

```
motivo: "promotor inativo desde 2026-06-13, debito e da empresa,
         sem estrutura para receber"

aviso : "PENDENTE — operacao 212540080 (1): o dono e ANA CLARA, INATIVO desde
         2026-06-13. Pela regra o debito e da EMPRESA, e NAO HA estrutura para
         debito de empresa. O item NAO foi lancado e ficou na fila. PRIMEIRO CASO:
         decidir a estrutura (ver as tres opcoes em promotorInativoNaData)."
```

### As três opções, com custo — para quem decidir não começar do zero

Estão registradas em comentário em `lib/debitInsuranceResolver.ts`, junto de
`promotorInativoNaData()`:

| opção | o que é | custo |
|---|---|---|
| **(a) validar e parar** *(escolhida)* | o item não vira débito; fila + aviso | o valor fica pendente até alguém decidir. Nada se perde, nada se lança errado. **Reversível**: havendo estrutura, a fila é reprocessada |
| **(b) linha "Empresa" em `promoters`** | promotor sintético por empresa | **ALTO E DIFUSO** — vira dado sujo em TODA consulta que conta promotores, calcula penetração ou monta ranking. 67 viram 68, e um não é pessoa. Espalha por /promotores, /equipe, /projecao e pelo PMR |
| **(c) `promoter_id` nullable** | migration tornando a coluna opcional | exige migration **e** quebra todo leitor que assume não-nulo. Mais correto que (b), mais caro que (a) |

**Caminho mais barato se (c) for escolhida:** `promoter_discounts.apply_to_company`
já existe e o `payableByCompetencia` já o respeita — resolve o lado do REPASSE sem
migration. Falta só onde ancorar o débito em si.

**Quando o primeiro caso aparecer, a decisão tem de ser CONSCIENTE, não de passagem.**
É por isso que o item para em vez de ser lançado em quem já saiu.

### O gate — caso REAL, não sintético

`212540080` é um contrato da ADS cujo dono (**ANA CLARA**) saiu em **13/06/2026**.
Um cancelamento dele hoje chega depois da saída. Há 4 contratos assim na ADS e 57 no
cms — o caso não é hipotético, só ainda não foi cancelado.

| mutação | resultado |
|---|---|
| lança mesmo assim no inativo | **VERMELHO — 3 falhas** |
| para, mas em SILÊNCIO (sem motivo e sem aviso) | **VERMELHO — 2 falhas** |
| tirar o degrau `cms` da cascata | **VERMELHO** |
| inverter o critério do inativo | **VERMELHO** |
| revertido | VERDE |

Os **dois modos de falhar em silêncio** estão travados: lançar em quem não tem mais
repasse de onde descontar, e sumir com o item sem ninguém saber que existiu. Mais um
CONTROLE: o promotor ativo tem de continuar lançando, senão a regra teria virado
trava geral.

---

## 8. O R$ 1,40 GRAVADO — e o que a investigação corrigiu (27/08)

### Onde ele estava: em lugar nenhum

```
promoter_debits com total_amount = 1,40      : 0
promoter_debit_sources com operacao 211689509: 0
ainda na FILA (PENDING, promoter_id NULO)    : 1
```

**A rotina não tinha rodado.** Não foi recálculo apagando: `/api/calculate/monthly`
**não toca** `promoter_debits` nem `promoter_discounts` (grep = 0 ocorrências). Ele
escreve em `promoter_monthly_results` e mais nada de débito.

O débito **já era** gravado em `promoter_debits` desde sempre — a rotina nunca gravou
em outro lugar. E `promoterAnalytics.ts:1833` filtra por `promoter_id + ano + mes`,
**sem `company_id`**: um débito da ADS apareceria normalmente na tela do promotor.
Não havia débito volátil nem débito escondido por empresa.

### A ARMADILHA que quase destruiu dado

A gravação é *delete-and-replace* escopada a `(kind=AUTO, CANCELAMENTO_SEGURO,
start_year, start_month, company_id=ADS)`. **Chamar a rotina com um SUBCONJUNTO
apaga o que ficou de fora.** Rodar só com o R$ 1,40 teria deletado os R$ 48,05 da
MARIA LETICIA.

**A chamada correta passa o conjunto COMPLETO** de linhas `tratamento=debito` do PDF
da competência — que é o que o importador faz. Qualquer script de reprocessamento
tem de fazer o mesmo.

### O resultado

```
ANTES  : 2 debitos, Sigma 48,05  | fila PENDING: 3
DEPOIS : 3 debitos, Sigma 49,45  | BRUNA ALVES 1,40 (via cms) + MARIA LETICIA 24,05 + 24,00
```

### Sobrevive ao recálculo — provado por execução

```
reconsolidarCompetenciaFechada(2026-07) -> ran=true regime=fechamento
DEPOIS DO RECALCULO: 3 debitos, Sigma 49,45   [intactos]
```

### As duas telas concordam

```
/financeiro (matriz, caixa ago/26): linha ADS descontos = -49,45
/promotores BRUNA ALVES jul/26   : discountRows = 1 -> CANCELAMENTO_SEGURO 1,40
conferencia da matriz: 139.405,05 · card 139.405,05 · delta 0,00
```

Os R$ 48,05 viraram **R$ 49,45** — antes NÃO incluíam o R$ 1,40; agora incluem.

### RESÍDUO CONHECIDO — a fila não é limpa

```
fila DAILY_CANCEL PENDING: 3 -> 209867885(20,70), 209621970(20,83), 211689509(1,40)
```

O `211689509` **continua marcado PENDING** em `promoter_debit_assignments` mesmo já
tendo virado débito. A rotina cria entradas na fila para o que não resolve, mas
**não fecha** as que passou a resolver. Hoje é cosmético (a fila é lista de trabalho,
não fonte de cálculo), mas confunde quem a usa para saber o que falta. **Nomeado,
não consertado.**
