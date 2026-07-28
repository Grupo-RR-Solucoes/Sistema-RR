# SRCC não resolvido pelo fechamento — MAPA (read-only)

Ramificada de `main` em `2760c98`. 27/07/2026. **Nada implementado.**

Medições: `scripts/mapa-srcc-resolucao.mts` (somente leitura, funções reais do repo).

---

## Resumo: duas premissas do levantamento estavam erradas

Antes dos 5 pontos, porque muda o desenho:

**1. A resposta do fechamento é EXPLÍCITA, não implícita.** O levantamento supunha
inferir por pagamento ("paga = não havia restrição"). Não precisa: **100% das
3.999 linhas CASH de 2026** têm `RESTRIÇÃO SRCC` no `metadata` do
`monthly_closing_entries`. Valores: `Não` 2.993 · `Não se aplica` 1.003 · `Sim` 3.

**2. `import/daily` NÃO é o único que grava.** São **cinco** escritores, e um
deles é um importador de FECHAMENTO:

| escritor | o quê |
|---|---|
| `app/api/import/daily/route.ts:610` | diária RR — `parseSrccRestricted` |
| `lib/bbtsDailyImport.ts:325` | diária ADS |
| **`lib/bbtsClosingImport.ts:307`** | **fechamento ADS — resolve pelo `srcc_cd`** |
| `lib/bbtsClosingImport.ts:392` | linhas só-seguro, `false` fixo |
| `lib/adsSeguroDailyImport.ts:213` | `false` fixo |

**O lado ADS já resolve o SRCC no fechamento.** O PDF da BBTS traz `srcc_cd` com
os códigos oficiais (1=restrição, 2=não, 3=consulta não realizada, 4=n/a), e o
importador grava `is_srcc_restricted = (srcc_cd === 1)` via
`mergeDailyProductionRecords` com `owner: "FULL"` — e `is_srcc_restricted` está em
`CREDIT_COLUMNS`, então a escrita vale.

**O buraco é só do RR.** Confirmado no dado: zero linhas indefinidas na ADS.

> Ressalva sobre o lado ADS: o mapeamento `srcc_cd === 1` colapsa 2, 3 e 4 em
> `false`. Um código 3 da BBTS vira "não restrito" em vez de "indefinido" — não
> fica preso em âmbar, mas também não preserva a dúvida. Fora do escopo deste
> mapa; registrado.

---

## 1. O fechamento carrega a resposta?

**RR (Excel Promotiva): SIM, explícita.** A aba "A Vista" tem `RESTRIÇÃO SRCC`, e
o `monthlyClosingImport` já preserva o metadata completo — inclusive das linhas
com `COMISSÃO PF = 0`, que são justamente as restritas (o comentário em
`monthlyClosingImport.ts:971` registra que descartá-las "escondia as restritas do
banco e da tela").

Não é preciso inferir por pagamento — o que é bom, porque a inferência seria
**insegura**: comissão zero também acontece por prazo abaixo do piso, produto fora
de tabela e cancelamento. Os três motivos coexistem no mesmo campo. A coluna
explícita elimina a ambiguidade.

**ADS (PDFs BBTS): SIM, explícita — e já aplicada.** Ver acima.

**Consequência de desenho:** os dois lados têm resposta explícita, mas em lugares
diferentes — RR no `metadata` do `monthly_closing_entries`, ADS já materializado
na coluna. A rotina só precisa existir para o **RR**.

---

## 2. As indefinidas de competência fechada × fechamento

**114 linhas** indefinidas em competência fechada (04 e 06/2026 — as únicas
fechadas com diária).

```
achadas no fechamento .......... 98
  PAGAS (comissão > 0) ......... 95    -> não havia restrição
  NÃO pagas (comissão = 0) ......  3    -> havia, ou outro motivo
AUSENTES do fechamento ......... 16    -> sem resposta
```

O que o fechamento **diz** dessas 98: `Não` → 97 · `Sim` → 1.

Ou seja: **97 das 114 (85%) têm resposta explícita e são "Não"** — resolvíveis
sem heurística. Uma é "Sim". As 16 ausentes ficam sem resposta mesmo.

> **Divergência de contagem vs o levantamento**, registrada: o handoff anterior
> dizia 116 (4 em 03, 61 em 04, 1 em 05, 50 em 06). Medi 114 em competência
> fechada (65 em 04 + 49 em 06); 03 e 05 não têm diária na janela. O dado se move
> enquanto julho está aberto. Os números aqui são de 27/07/2026.

---

## 3. O dinheiro na transição — NÃO houve pagamento indevido

Esta era a pergunta que podia mudar a prioridade. **Não muda.**

```
das 114 indefinidas fechadas:
  com comissão de promotor computada .... 95  ·  R$ 18.582,06
    dessas, o fechamento NÃO pagou ......  1  ·  R$  2.004,00
    dessas, ausentes do fechamento ......  1  ·  R$      8,85
```

Os dois casos:

| proposta | comp | promotor | net | comissão na diária | fechamento |
|---|---|---|---|---|---|
| 213615547 | 06/2026 | Thaynara | 80.000,00 | 2.004,00 | achada, comissão **0**, `RESTRIÇÃO SRCC = "Sim"` |
| 210100613 | 04/2026 | Lilian | 1.590,00 | 8,85 | **ausente** |

**O valor não está no PMR.** O PMR das duas competências tem `source=fechamento`,
ou seja, foi escrito pelo consolidador a partir do fechamento — não da diária.
Prova para o caso maior:

```
fechamento CASH da Thaynara em 06/2026:  17 linhas, comissão R$ 12.997,16
PMR dela (production_commission_value):                R$ 12.958,26
```

O PMR é **menor** que o fechamento — não pode conter um extra de R$ 2.004,00. E a
linha restrita aparece no fechamento com net R$ 80.000,00 e **comissão R$ 0,00**.

**Conclusão: o promotor não recebeu comissão por proposta que a gestora não
pagou.** O R$ 2.012,85 vive só na coluna `promoter_commission_amount` da diária —
resíduo de quando o mês estava aberto — e não alcança o pagamento.

**O que ESTÁ errado é a exibição.** A produção de R$ 80.000,00 dessa proposta
continua contada como válida em caminhos que leem a diária, porque
`is_srcc_restricted` segue `false`. É defeito de tela, não de caixa.

---

## 4. Risco da resolução retroativa — SEGURO para o dinheiro

O campo **afeta cálculo**: `app/api/calculate/monthly/route.ts:272`
(`isValidRecord`) descarta a linha quando `is_srcc_restricted` é true.

**Mas esse caminho não roda em competência fechada.** Em `route.ts:692`, se
`regime !== "open"` a rota desvia para `reconsolidarCompetenciaFechada`, que
consolida o PMR a partir do **fechamento** (RR+ADS), não da diária.

E o único ponto do consolidador fechado que lê a diária com guarda de SRCC —
`bbtsOrchestrator.ts:140` — está atrás de `.eq("company_id", BBTS_COMPANY_ID)`:
**é só ADS**, e a ADS já tem o campo correto.

**Portanto: reescrever o SRCC do RR em 03–06/2026 não altera o PMR nem o valor
pago.** Afeta exibição — somas de produção que leem a diária, etiquetas e
tingimento de linha. E afeta **para corrigir**: a produção da 213615547 deixa de
ser contada.

Ainda assim, a rotina deve **gravar apenas o campo de SRCC**, sem tocar em
comissão, e ser precedida de dry-run — o risco não é o campo, é um `update`
largo demais.

---

## 5. Volume — fluxo normal, sem mês atípico

Estado do SRCC por competência e gestora (diária, 2026):

| comp | gestora | total | restrito | **indefinido** | sem-info | neutro |
|---|---|---|---|---|---|---|
| 2026-04 | RR | 619 | 11 | **65** | 0 | 543 |
| 2026-06 | RR | 801 | 3 | **49** | 0 | 749 |
| 2026-07 | RR | 727 | 13 | **63** | 0 | 651 |
| 2026-06 | ADS | 19 | 0 | **0** | 19 | 0 |
| 2026-07 | ADS | 33 | 0 | **0** | 33 | 0 |

**~8% das linhas RR por mês** (65/619, 49/801, 63/727). Constante — não há mês
atípico. É fluxo normal, o que significa que a rotina precisa ser **recorrente**,
não um mutirão único.

A ADS tem **zero** indefinidas: todas as 52 linhas caem em "sem informação"
(a BBTS não manda a coluna que o rótulo lê). Coerente com o fechamento ADS já
materializar o campo.

---

## PROPOSTA DE DESENHO (não implementada)

### Forma: um passo do import de fechamento RR, não uma rotina separada

O dado chega todo mês, no mesmo arquivo, no mesmo momento. Uma rotina avulsa
precisaria ser lembrada; um passo do importador roda sozinho.

**Onde:** ao final de `monthlyClosingImport`, depois de gravar as entries e antes
de consolidar — mesmo lugar onde a resposta acaba de entrar no banco.

**O que faz:** para cada linha CASH da competência com `RESTRIÇÃO SRCC` no
metadata, casa com a diária por operação/contrato e grava `is_srcc_restricted`:

| metadata do fechamento | grava |
|---|---|
| `Sim` | `true` |
| `Não`, `Não se aplica` | `false` |
| ausente | **não toca** |

Só o campo de SRCC. Nada de comissão, nada de status.

### O que NÃO fazer, e por quê

**Não inferir por pagamento.** Comissão zero também vem de prazo curto, produto
fora de tabela e cancelamento — três causas no mesmo sinal. A coluna explícita
existe em 100% das linhas; inferir seria trocar certeza por heurística.

**Não mexer no `promoter_commission_amount` da diária.** É resíduo do mês aberto e
não alimenta pagamento (item 3). Reescrevê-lo é risco sem retorno.

**Não reconsolidar a competência depois.** O PMR fechado vem do fechamento e não
muda com o campo (item 4). Disparar reconsolidação seria tocar em mês pago sem
necessidade.

### O backfill de 03–06/2026

Um passo à parte, rodado uma vez, com dry-run obrigatório e relatório por
competência. Resolve **97 linhas** para "Não" e **1** para "Sim"; **16** ficam
como estão, por ausência de resposta.

Sugestão: manter as 16 em "indefinido" e **não** inventar um quarto estado — a
tela já sabe mostrar âmbar, e "não sei" é a informação correta sobre elas.

### O que fica em aberto

- **As 16 ausentes.** Vale entender por que uma proposta em Produção na diária não
  aparece no fechamento. Pode ser timing (contratada no mês seguinte), pode ser
  outra coisa. Não investigado.
- **O colapso 2/3/4 → `false` no lado ADS** (`bbtsClosingImport.ts:263`). Perde a
  distinção entre "não há restrição" e "não foi consultado".
- **A tela que soma diária em mês fechado.** O item 3 mostra que a produção de
  R$ 80.000,00 da 213615547 ainda conta. A resolução retroativa corrige o sintoma;
  a causa (ler diária em mês fechado) é outra frente.
