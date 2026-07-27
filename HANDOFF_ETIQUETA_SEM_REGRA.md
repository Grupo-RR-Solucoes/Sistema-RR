# Frente `feat/etiqueta-sem-regra` — MEDIDA B

Ramificada de `main` em `0f9ca26` (com a #144 já fundida). 27/07/2026.

---

## O que foi feito

A etiqueta **"SEM REGRA TRP"** de `/comissoes/editar` acendia lendo
`company_received_percent` **cru**, que é o segundo de **três** degraus. O
terceiro — o `deriveCompanyReceivedRate`, que consulta a TRP — não era
consultado.

Não era aviso visual. O texto afirmava *"Promotiva não comissionou esta
proposta"* e chamava a linha de *"candidata a auditoria mensal"* — afirmação
sobre dinheiro alheio, mais uma ordem de serviço que **nenhum processo
executa**: a auditoria à vista nem olha esse campo, ela parte do fechamento
(`monthly_closing_entries` CASH).

| | antes | depois |
|---|---|---|
| linhas exibindo a etiqueta | 47 | **27** (o universo real) |
| dessas, mentindo | 20 | 0 |
| COMISSÃO PROMOTOR nas 20 | R$ 0,00 | R$ 4.109,74 |
| 4 linhas de escala errada | R$ 7.273,74 | R$ 1.199,67 |

Gate: `scripts/gate-medida-b-conserto.mts`, 5/5.

### Commits

| commit | o quê |
|---|---|
| `208e3ee` | `resolverTaxaAvistaEfetiva` exposta do motor; morre o espelho `temTaxaPropria` |
| `3370e70` | a medição (somente leitura) |
| `bcfbbb6` | o conserto: rota, tela, `recalculateSingleProposal` |
| `3f79839` | `parsePercent` do import passa a gravar PERCENTUAL, com janela |

---

## Dívida estrutural encontrada: dois escritores, convenções opostas

`company_received_percent` tinha **cinco** consumidores e **duas** convenções:

| # | onde | o quê | convenção |
|---|---|---|---|
| 1 | `import/daily:97` `parsePercent` | **escreve** | FRAÇÃO → **corrigido em `3f79839`** |
| 2 | `calculate/monthly:48` `toPercentUnits` | lê + **escreve** | PERCENTUAL |
| 3 | `promoterAnalytics:291` `toPercentRate` | lê | FRAÇÃO |
| 4 | `proposalDetailing:379` `getAVistaPercent` | lê | PERCENTUAL |
| 5 | `promotivaCashPolicy:140` `normalizePercent` | lê (via `op.company_cash_percent`) | FRAÇÃO |

Mais duas na mesma classe, **outro campo** (metadata do fechamento/auditoria):
`closingAnalytics:289` e `historicalAuditEngine:61`.

Todas usam adivinhação por magnitude (`v > 1 ? v/100 : v` ou o inverso), que
**erra os valores legítimos abaixo de 1%** — e a TRP38 tem células de 0,78% a
1,02%.

**Ainda aberto:** os sítios 3, 4 e 5 seguem com a heurística. Depois de `3f79839`
a coluna tem uma convenção só na escrita, mas as leituras continuam adivinhando.
Não quebra hoje (medido: zero frações vivas), mas volta a morder se alguma fonte
nova gravar direto na coluna.

---

## FRENTE: FAIXA DO CNPJ APLICADA NO LUGAR DA FAIXA DO GRUPO

> **NÃO FEITA.** Medida, dimensionada, com uma pergunta em aberto que decide o
> encaminhamento.

### O achado

**54 linhas** trazem na coluna um percentual **abaixo** do que a faixa do grupo
justifica. Dessas, **47 trazem exatamente o pct da faixa do CNPJ isolado**:

```
206718920  RR ALAGOAS 1 (F1)   coluna 5.49   grupo F3=5.70   cnpj F1=5.49
208617727  RR ALAGOAS 3 (F2)   coluna 5.53   grupo F3=5.70   cnpj F2=5.53
215649713  RR PERNAMBUCO (F2)  coluna 3.23   grupo F3=3.34   cnpj F2=3.23
220641347  RR ALAGOAS 2 (F2)   coluna 0.95   grupo F3=0.97   cnpj F2=0.95
```

F1 para Alagoas 1 e 2, F2 para Alagoas 3 e Pernambuco — em toda linha. Não é
ruído: é assinatura, em 4 CNPJs e 3 competências.

As **7 restantes** não batem com nenhuma das duas faixas:
- 4 com coluna **2,44** onde grupo = 3,34 e CNPJ = 3,21
- 3 da **ADS** com coluna **1,96** onde grupo = 2,44 e CNPJ = 2,35

### A apuração correta é no GRUPO — provado, não assumido

Teste sobre as 1.741 linhas com valor plausível, em que grupo e CNPJ **sempre**
dão faixas diferentes:

```
coluna bate SÓ com a faixa do GRUPO ..... 1394
coluna bate SÓ com a faixa do CNPJ ......   47
bate com as duas (célula de pct igual) ..  144
não bate com nenhuma ....................  156
```

**30 para 1.** Se a apuração fosse por CNPJ, as 1.394 estariam erradas. Nenhum
CNPJ isolado chega a F3 (R$ 3 mi); o grupo chega em todas as competências:

| competência | grupo | RR PE | RR AL 3 | RR AL 2 | RR AL 1 | ADS |
|---|---|---|---|---|---|---|
| 2026-04 | 4.192.842 **F3** | 1.287.200 F2 | 1.374.149 F2 | 702.767 F1 | 828.726 F1 | — |
| 2026-06 | 5.607.522 **F3** | 1.284.431 F2 | 2.000.450 F2 | 1.488.633 F2 | 562.797 F1 | 271.211 F1 |
| 2026-07 | 5.243.424 **F3** | 1.122.851 F2 | 1.879.827 F2 | 1.274.373 F2 | 626.346 F1 | 340.028 F1 |

### Tamanho

```
produção financiada nas 54 .................... R$ 681.344,46
diferença de comissão-EMPRESA (grupo − coluna)  R$     825,25
repasse do promotor a 58,33% sobre ela ........ R$     481,37
```

Residual. Os degraus da TRP são estreitos (0,79 → 0,81; 5,53 → 5,70).

### Distribuição

Competências **04, 06 e 07/2026**. Quatro CNPJs. **Sem lote de importação
comum** — `created_at` espalhado entre 21/04 e 27/07.

### PERGUNTA EM ABERTO — decide o encaminhamento

**Quem aplicou a faixa do CNPJ?**

- Se veio **no arquivo da Promotiva**, é subpagamento **dela**, e vira item de
  auditoria/cobrança — mesma natureza dos R$ 107 mil.
- Se foi **o nosso importador ou cálculo**, é bug nosso e o conserto é interno.

**NÃO INVESTIGADO.** Não dá para decidir o encaminhamento sem isso, e o caminho
para responder é comparar o `raw_payload` original das 47 contra o que a coluna
guardou.

### Resíduo separado: as 16 "acima" que não são teto

Das 145 linhas com a coluna **acima** da faixa do grupo, **129 (89%) estão em
≥ 5,80** — coerente com o teto do à-vista (excedente vira diferido), e **nenhuma
delas bate com a faixa do CNPJ**, o que confirma ser outro fenômeno.

As **16 restantes ficam sem explicação**: 12 com coluna 3,21, 3 com 2,44, 1 com
2,52. As de 3,21 **podem** ser a controvérsia do INSS (3,19 vs 3,21 —
`TRP35_REFERENCIA.md` erra as Faixas 1-3), mas **não foi medido** e não está
estabelecido.

---

## Scripts desta frente (todos somente leitura)

| script | o quê |
|---|---|
| `medida-b-etiqueta-sem-regra.mts` | quantas linhas exibem a etiqueta e para quantas ela mente |
| `gate-medida-b-conserto.mts` | gate do conserto, 5/5 |
| `medida-b-faixa-cnpj-ou-grupo.mts` | o teste decisivo grupo × CNPJ |
| `medida-b-faixa-das-9.mts` | produção × coluna × derive, linha a linha |
| `gate-import-percentual.mts` | prova que trocar o import não quebra leitura |
| `diag-medida-b-desceram.mts` | por que 4 linhas descem |
| `diag-medida-b-escala-sub1.mts` | alcance da ambiguidade sub-1 |
| `diag-medida-b-escala-escritores.mts` | os dois escritores da coluna |

### Armadilha que custou uma medição inteira

Paginação do PostgREST **sem `ORDER BY`** devolve linhas em ordem arbitrária: a
mesma linha pode vir duas vezes ou nenhuma. A produção do grupo em julho saiu
R$ 4,75 mi numa rodada e R$ 5,24 mi na outra. Todo script que pagina
`daily_production_records` precisa de `.order("id")`.

---

## Pendências

- **A conferência visual.** Nada desta frente foi visto rodando: a etiqueta com
  o texto novo, as 20 linhas com comissão preenchida, as 4 com o valor corrigido.
- **A frente da faixa do CNPJ**, acima.
- **As heurísticas de leitura** (sítios 3, 4 e 5 da tabela).
- **As 16 "acima"** sem explicação.
