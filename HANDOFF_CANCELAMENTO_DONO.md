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

## 4. O promotor inativo — regra escrita, estrutura NÃO criada

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
