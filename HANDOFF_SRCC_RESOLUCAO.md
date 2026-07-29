# SRCC não resolvido pelo fechamento — MAPA + IMPLEMENTAÇÃO

Ramificada de `main` em `2760c98`. 27/07/2026.

> **Status: IMPLEMENTADO e aplicado.** Migration `20260727_000001` rodada no
> Studio; backfill de 03–06/2026 executado. O mapa abaixo é o levantamento que
> precedeu a decisão; o resultado está em **IMPLEMENTAÇÃO**, no fim.

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


---

# IMPLEMENTAÇÃO (28/07/2026)

## O desenho: coluna separada, não campo reaproveitado

O passo grava em **`srcc_resolucao`** — coluna nova — e não no `raw_payload`.

O motivo é o mesmo que a frente anterior pagou caro para aprender: o que
gravamos **não é o dado da gestora, é uma conclusão nossa** derivada do
fechamento. Misturar as duas coisas no mesmo campo foi o que criou a ambiguidade
da `company_received_percent`, que custou duas rodadas de investigação (0,95
querendo dizer 0,95% e sendo lido como 95%). Três donos, três campos:

| campo | dono |
|---|---|
| `raw_payload["Indicador Restrição SRCC"]` | cópia **fiel** do arquivo da gestora, intocada |
| `is_srcc_restricted` | o booleano que o **cálculo** consulta (`isValidRecord`) |
| `srcc_resolucao` | a **conclusão** derivada do fechamento (+ fonte + data) |

**Descoberta que forçou a coluna:** gravar só o booleano **não resolveria nada**.
`getSrccRestrictionLabel` lê o `raw_payload` antes do booleano, então a linha
continuaria com rótulo "Consulta não realizada" — âmbar para sempre — e
continuaria "indefinida", sendo recandidatada a cada rodada sem forma de saber
que já tinha sido resolvida. Medido antes de escolher o desenho.

A precedência do rótulo passou a ser, da resposta **mais nova** para a mais
antiga: `srcc_resolucao` → `raw_payload` → booleano. Quem não tem resolução se
comporta exatamente como antes (conferido caso a caso).

## Resultado do backfill (03–06/2026)

```
candidatas (indefinidas) ....... 114
  resolvidas para NAO ..........  97
  resolvidas para SIM ..........   1
  resolvidas p/ NAO_SE_APLICA ..   0
SEM RESPOSTA ...................  16
  ausentes do fechamento .......  16
  achada mas sem a coluna ......   0
  valor desconhecido ...........   0
```

03 e 05 não têm candidatas (não têm diária). As 98 resolvidas se distribuem por
4 CNPJs, com fonte `fechamento_rr` e carimbo de data.

**Zero linhas achadas sem a coluna e zero valores desconhecidos** — quando a
linha existe no fechamento, a coluna sempre existe e sempre traz valor
reconhecido. Confirma no dado o que o mapa dizia: a resposta é explícita, nunca
precisou ser inferida por pagamento.

## O efeito medido: a tela converge com o pagamento

A proposta **213615547** (junho, Thaynara, R$ 80.000,00) era o caso central. O
fechamento diz `RESTRIÇÃO SRCC = "Sim"`.

```
srcc_resolucao      (null)  ->  SIM
is_srcc_restricted  false   ->  true
rótulo   "Consulta não realizada por problemas técnicos"  ->  "Sim" (vermelho)
```

Produção exibida da promotora em 06/2026, pelo predicado de
`isEligibleProductionRecord`:

```
ANTES:   23 linhas   R$ 474.317,20
DEPOIS:  22 linhas   R$ 394.317,20   (−R$ 80.000,00)
```

**R$ 394.317,20 é exatamente o `production_value` do PMR dela em junho**, medido
na fase de mapeamento e vindo do fechamento. Antes, a tela mostrava R$ 474.317,20
e o PMR pagava sobre R$ 394.317,20 — R$ 80.000,00 de divergência entre o que se
vê e o que se paga. Agora os dois dizem o mesmo número, e não por ajuste: a
diária chega nele sozinha ao parar de contar a proposta que o banco restringiu.

Confirmação independente do desenho — nenhum dos dois lados foi calibrado para o
outro.

## Idempotência: provada, não presumida

Segunda execução com `--gravar`:

```
candidatas 16 · resolvidas 0 · produção delta R$ 0,00
98 linhas com srcc_resolucao, mesmos carimbos de data, 98/98 coerentes
```

As 98 resolvidas **saem** do universo "indefinido" porque `srcc_resolucao` vence
no rótulo. Restam as 16 sem resposta — que continuam candidatas **de propósito**:
elas são genuinamente indefinidas, e reavaliá-las a cada rodada é o certo. Se um
fechamento futuro (reimportação, correção) passar a incluí-las, serão resolvidas
sozinhas. O que importa para idempotência é que **nada é escrito** na segunda
passada.

## As 16 sem resposta: ficam indefinidas, e agora com razão explícita

Não é falha do casamento — **a proposta não entrou no arquivo de fechamento**.
Estão em Produção na diária e simplesmente não aparecem entre as linhas CASH da
competência. Verificado: as 16 seguem com `srcc_resolucao` NULL e
`is_srcc_restricted` false, sem terem sido tocadas.

Em competência fechada a etiqueta delas diz **"Não resolvido"**, com o texto de
ajuda "a competência já fechou e a consulta de restrição continua sem resposta".
Isso **passa a ser literal**: antes descrevia um efeito colateral (o fechamento
não reescrevia nada, então tudo ficava sem resolver); agora descreve o fato
específico daquela linha — o fechamento resolveu 98 e não tinha o que dizer sobre
estas 16.

Por que uma proposta em Produção não entra no fechamento continua **sem
investigação**. Pode ser timing (contratada na competência seguinte), pode ser
outra coisa.

## Daqui para frente: sem backfill

O passo roda **dentro do import de fechamento RR** (`monthlyClosingImport`),
depois da consolidação. Cada fechamento novo resolve o que a diária daquela
competência deixou em aberto, sozinho, e reporta no resultado da importação:
quantas resolveu, para cada valor, e quantas ficaram sem resposta separadas por
motivo.

**O backfill foi um evento único** para 03–06/2026. Não precisa rodar de novo — e
se rodar, não faz nada.

O passo é best-effort: falha nele não derruba o import (o fechamento já está
gravado e o PMR consolidado). Como é idempotente, a próxima importação tenta de
novo.

## O que continua em aberto

- **As 16 ausentes** — por que uma proposta em Produção não entra no fechamento.
- ~~**O colapso `2/3/4 → false` no lado ADS** (`bbtsClosingImport.ts:263`)~~ —
  **FECHADO em 28/07/2026**, ver `HANDOFF_SRCC_ADS.md`. E a ressalva registrada
  acima estava certa pela metade: o código 3 **nunca apareceu** na ADS (a diária
  da BBTS não manda coluna de SRCC nenhuma), mas as 19 linhas em que a gestora
  **respondeu** mostravam "Sem informação" na tela — o rótulo não conhecia a
  chave `srcc_cd`. Não era a dúvida que sumia; era a certeza.
- **A tela que soma diária em mês fechado.** O backfill corrigiu o sintoma nas
  linhas restritas; a causa (ler diária em competência fechada) é outra frente.
