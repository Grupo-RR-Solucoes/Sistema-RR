# As 16 ausentes do fechamento — veredito contrato a contrato

Medido em 30/07/2026, branch `feat/tres-frentes`. **Somente leitura: nada foi
escrito no banco.**

> **O número que sobra é R$ 53,11 de comissão-empresa, em UMA proposta.**
> As outras 15 têm motivo legítimo de não-pagamento. Este documento existe para
> registrar que a curadoria foi feita — e que ela reduziu o achado de 16 para 1.
> Não recomendo abrir cobrança por este valor isoladamente.

---

## 1. O mecanismo — por que a auditoria não vê isto

A auditoria dos R$ 107 mil (`lib/auditoriaAvistaBatch.ts` → `lib/auditoriaAvista.ts`)
audita **o que foi pago**. Ela lê `audit_v9_avista`, que é alimentada pelo
fechamento da Promotiva, e para cada contrato compara a comissão paga contra a
comissão devida pela régua.

O contrato que **não está no arquivo** não gera linha em `audit_v9_avista`.
Não tem `comissao_paga` para comparar, não tem `pct_aplicado` para conferir, não
entra em nenhum status. Ele simplesmente não existe para a auditoria.

**É um ponto cego estrutural, não um defeito da auditoria.** Uma auditoria de
pagamento compara o que foi pago contra a régua; ausência não é pagamento a
menor, é ausência. Detectar contrato faltante exige cruzar duas fontes — a
diária (o que vendemos) contra o fechamento (o que a gestora reconheceu) — e
esse cruzamento não existia até esta medição.

O cruzamento é: para cada linha da diária da competência, procurar o número da
proposta entre as linhas `CASH` do fechamento daquela competência/empresa,
casando por `operation_number` **ou** `contract_number`, só dígitos e sem zeros
à esquerda (a mesma chave de `lib/srccResolucao.ts:123` e `:226`).

### Como as "16" foram isoladas, e por que o recorte engana

As 16 vieram do handoff #147 como subproduto de outra frente: são as linhas que
o passo de resolução de SRCC não conseguiu resolver, porque estavam **ausentes
do fechamento**. Ou seja, o recorte é a interseção de dois filtros:

```
(ausente do fechamento da competência)  ∩  (SRCC ainda indefinido)
```

Isso tem duas consequências que precisam estar claras:

1. **A premissa "16 propostas em Produção" é falsa.** Medido: **10 Cancelado,
   3 Em Aberto, 3 Produção.** O filtro de SRCC não seleciona por status.
2. **O universo real do fenômeno é maior**: em competência fechada (04 e
   06/2026) há **43** linhas em Produção ausentes do fechamento, R$ 168.456,54.
   As 16 são um recorte enviesado dele — só 3 das 16 estão em Produção.

O descasamento é **unidirecional**: medido nos dois sentidos, há 0 linhas no
fechamento que não estejam na diária. O fechamento é subconjunto da diária.

---

## 2. As 16, uma a uma, com veredito

Todas de **RR** (nenhuma da ADS — ver seção 4). Verificações aplicadas a cada
uma: status, `cancellation_date`, `is_srcc_restricted`, `srcc_resolucao`,
presença no fechamento em **qualquer** aba/tipo e em **qualquer** ano
(A Vista/CASH, A Vista/INSURANCE, Seguro, PRT, Crédito, Débito, Consórcio), e
remuneração pela régua na faixa do grupo da competência.

| # | proposta | comp | empresa | promotor | net | status | veredito | motivo |
|---|---|---|---|---|---|---|---|---|
| 1 | 207315590 | 04 | AL 1 | Erika Liliam | 1.310,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-06 |
| 2 | 208410306 | 04 | AL 1 | Erika Liliam | 4.570,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-06 |
| 3 | 208837609 | 04 | AL 1 | Jamerson | 16.450,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-22 |
| 4 | 208659430 | 04 | AL 2 | Mayanne | 1.090,00 | Em Aberto | LEGÍTIMO | não é produção |
| 5 | 210339104 | 04 | AL 2 | Mayanne | 3.400,00 | Em Aberto | LEGÍTIMO | não é produção |
| 6 | 208999372 | 04 | AL 2 | Mayanne | 1.095,00 | Em Aberto | LEGÍTIMO | não é produção |
| 7 | 208662342 | 04 | AL 2 | Erivan | 20.600,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-09 |
| 8 | 208432066 | 04 | AL 3 | Lilian | 4.800,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-08 |
| 9 | 207940662 | 04 | AL 3 | Aldalene | 6.020,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-06 |
| **10** | **210100613** | **04** | **AL 3** | **Lilian** | **1.590,00** | **Produção** | **SEM EXPLICAÇÃO** | — |
| 11 | 210348461 | 04 | AL 3 | Lilian | 8.000,00 | Produção | LEGÍTIMO | régua não remunera: pct = 0 (produto 2882, taxa 1,85, prazo 37) |
| 12 | 209530512 | 04 | AL 3 | José Buarque | 10.500,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-15 |
| 13 | 209702205 | 04 | PE | Monalisa | 400,00 | Produção | LEGÍTIMO | régua não remunera: pct = 0 (produto 2880, taxa 1,85, **prazo 5**) |
| 14 | 209635135 | 04 | PE | Thaynara | 3.000,00 | Cancelado | LEGÍTIMO | cancelada em 2026-04-22 |
| 15 | 210625792 | 06 | AL 2 | Adriana | 19.520,00 | Cancelado | LEGÍTIMO | cancelada em 2026-06-09 |
| 16 | 212263306 | 06 | AL 2 | Adriana | 19.450,00 | Cancelado | LEGÍTIMO | cancelada em 2026-06-01 |

```
LEGITIMO ......... 15
SEM EXPLICACAO ... 1
```

Observações relevantes:

- **As 10 canceladas foram canceladas no mesmo dia do movimento.** Não é
  cancelamento tardio; a proposta nasceu e morreu no mesmo dia.
- **Nenhuma das 16 tem restrição de SRCC.** Todas com `is_srcc_restricted=false`
  e `srcc_resolucao` NULL — é justamente por isso que continuam "indefinidas" e
  caíram neste recorte.
- **Nenhuma das 16 aparece em fechamento nenhum**, em nenhum ano (2022–2026),
  em nenhuma aba, em nenhum tipo. Verificado com proposta de controle
  (213615547, que a busca encontra normalmente).
- **Os dois casos de "régua não remunera" são reais**, não artefato de lookup:
  a 209702205 tem prazo 5, abaixo do piso de elegibilidade; a 210348461 tem
  prazo 37 e cai em célula sem remuneração. Em ambos a comissão devida é R$ 0,00
  — a Promotiva não pagar está correto.

---

## 2.1 Não é recusa informada — é ausência silenciosa

Verificação exaustiva feita depois da curadoria, para remover o contra-argumento
"a operação tinha restrição / foi estornada / foi renovada".

**Escopo:** 2026 inteiro, todas as empresas, todos os meses, todas as abas —
**68.316 linhas varridas**.

```
abas x tipos existentes no fechamento de 2026:
   A Vista  / CASH                    3999
   A Vista  / INSURANCE               1137
   CONSORCIO / CONSORCIO              37
   Crédito / CREDIT                   16
   Débito / DEBIT                     16
   PRT / PRT                          60972
   Seguro / INSURANCE                 2139
```

A busca foi em três níveis: (1) o número da proposta em `operation_number` e
`contract_number`; (2) o número como **valor de qualquer chave** de qualquer
`metadata`; (3) inventário das chaves, atrás de campo de status/recusa.

```
  NENHUMA MENCAO. Nenhuma das 16 aparece em nenhum campo de
  identificacao nem como valor de nenhuma chave de metadata, em
  nenhuma aba, de nenhum fechamento de 2026, de nenhuma empresa.
```

### A hipótese da renovação está descartada, e o teste foi direto

A aba **Seguro** tem o campo que materializa exatamente essa hipótese:

```
  Seguro / INSURANCE
      COMISSÃO  |  VALOR_SEGURO  | DATA_CANCELAMENTO | DATA_OPERACAÇÃO | MCI |
      NUMERO_SEGURO | NUMERO_SEGURO CANCELADO | OPERAÇÃO | OPERAÇÃO RENOVADA  |
      RAZÃO SOCIAL | STATUS | VALOR BRUTO | VALOR LIQUIDO
```

O nível 2 compara o número contra o valor de **toda** chave de **todo**
metadata, então `OPERAÇÃO RENOVADA` foi coberto. Zero ocorrências.

### A gestora tinha três formas de dizer "não pago, e eis o porquê"

```
  A Vista  / CASH
     >>> candidatas a motivo: STATUS COMISSÃO PF | STATUS_CONTRATO
  Seguro / INSURANCE
     >>> candidatas a motivo: DATA_CANCELAMENTO | NUMERO_SEGURO CANCELADO | STATUS
```

E a aba **Débito** referencia proposta em texto livre — a busca pegaria:

```
  RR ALAGOAS 1 2026-05   metadata: {"VALOR":-95.76,"PRODUTO":"CRÉDITO PF",
     "DESCRIÇÃO":"Deb.Liquidação 209913450 - 04/2026", ...}
  RR PERNAMBUCO 2026-05  metadata: {"VALOR":-179.2,
     "DESCRIÇÃO":"Déb.Cancelamento 202095278 - 04/2026", ...}
```

Os estornos existem, citam número de proposta, e **nenhum dos 16 números aparece
em nenhum deles**.

**Conclusão: não há posição da gestora a contestar — há ausência de posição.**
A proposta não entrou no arquivo, sem status, sem estorno, sem cancelamento e
sem referência cruzada.

> **Ressalva de escopo.** A varredura de `metadata` cobre 2026; 2025 e anteriores
> não entram (122.998 linhas estouram o statement timeout). A hipótese da
> renovação aponta para **depois** da proposta, e as 16 são de 04 e 06/2026,
> então a janela cobre o caso — mas não é varredura universal. A busca pelos
> campos de identificação, essa sim, cobriu 2022–2026.

---

## 3. O subconjunto sem explicação

```
proposta      comp     empresa        promotor                    net           pct     comissao-empresa esperada
210100613     2026-04  RR ALAGOAS 3   LILIAN CRISLAYNE TRINDADE   R$ 1.590,00   3,3400   R$ 53,11

  producao ..................... R$ 1.590,00
  comissao-empresa esperada .... R$ 53,11
```

**Uma proposta. R$ 1.590,00 de produção. R$ 53,11 de comissão-empresa esperada**
(3,34% = célula da FAIXA 3 para produto 2881, convênio 000001640, taxa 1,68,
prazo 97, na TRP vigente de 04/2026).

Corroboração independente, registrada com ressalva: a produção do grupo em
04/2026 medida pela diária dá R$ 4.192.842,41; medida pela base da auditoria
(`fetchVolAvistaRecalc`, que soma o fechamento) dá R$ 4.191.252,41. A diferença
é **R$ 1.590,00** — exatamente o valor desta proposta. As duas somas vêm de
tabelas diferentes com filtros próprios, então a coincidência **não é prova
formal** de causalidade; é um sinal forte de que esta é a única linha de
produção válida que a diária tem e o fechamento não.

---

## 4. RR × ADS — não há caso de ADS, e não haveria mesmo

```
empresas: RR ALAGOAS 1 · RR ALAGOAS 2 · RR ALAGOAS 3 · RR PERNAMBUCO
da ADS: 0   do RR: 16
```

**As 16 são todas do RR, cuja gestora é a Promotiva.** Nenhuma é da ADS. Não há
segunda cobrança contra a BBTS decorrente deste achado.

### E as linhas da ADS não são achado — são competência ainda aberta

Medido, para fechar a dúvida de uma vez:

```
linhas da ADS na diaria: 62
   2026-06: 19 linhas   net R$ 271.210,84
   2026-07: 43 linhas   net R$ 519.798,35

PMR da ADS por competencia (de onde veio a comissao?):
   2026-02: 1 promotores  producao R$       0,00  comissao R$     0,00  source=cms
   2026-06: 9 promotores  producao R$ 271.210,84  comissao R$ 5.153,53  source=bbts
   2026-07: 8 promotores  producao R$ 258.499,01  comissao R$ 4.622,92  source=daily
```

**06/2026 já está fechada** (`source=bbts` — o fechamento da BBTS foi
processado e pagou R$ 5.153,53). **07/2026 ainda está aberta** (`source=daily`,
ou seja, o PMR ainda vem da diária, não do fechamento).

O fechamento da ADS **não vive em `monthly_closing_entries`** — a ADS tem 0
linhas lá e 0 registros em `monthly_closing_imports`. O caminho dela é o
`bbtsClosingImport`, que materializa o resultado na própria diária. Por isso o
cruzamento diária × `monthly_closing_entries` **não se aplica à ADS**: ele
acusaria 100% de ausência em qualquer competência, inclusive nas pagas.

**Consequência: qualquer linha da ADS de 07/2026 está "ainda não fechada", não
"não paga".** O fechamento de julho da BBTS sai em agosto. Não há achado de ADS
neste documento, e nenhuma frente de cobrança contra a BBTS nasce daqui.

O lado ADS é estruturalmente diferente e já foi fechado em outra frente: o
fechamento da BBTS resolve o SRCC no próprio PDF (`lib/bbtsClosingImport.ts:307`),
e a ADS tem **zero** linhas indefinidas — todas as 52 caem em "sem informação"
porque a diária da BBTS não manda coluna de SRCC. Por construção, a ADS não
produz candidatas para este recorte.

### Cuidado com as 5 do universo maior — são RR e são falso positivo

No universo das 43 (Produção ausentes do fechamento), 5 propostas **aparecem
sim** no fechamento, na aba **"A Vista"**, mas com `COMISSÃO PF = 0`; o nosso
importador as classificou como `entry_type = INSURANCE` e o cruzamento — que só
olha `CASH` — as contou como ausentes.

```
208005642  2026-4  INSURANCE/A Vista  RR ALAGOAS 3   net=1549.05  com=3.24   status=FATURAR
209535041  2026-4  INSURANCE/A Vista  RR ALAGOAS 3   net=5000     com=7.50   status=FATURAR
209411658  2026-4  INSURANCE/A Vista  RR ALAGOAS 2   net=1024.54  com=1.54   status=FATURAR
209454643  2026-4  INSURANCE/A Vista  RR PERNAMBUCO  net=15579.39 com=23.37  status=FATURAR
209704758  2026-4  INSURANCE/A Vista  RR PERNAMBUCO  net=7800     com=11.70  status=FATURAR
```

Todas **RR**, não ADS. E a 209704758 traz `"RESTRIÇÃO SRCC":"Sim"` no metadata —
motivo legítimo de não-pagamento do crédito.

**Consequência: o cruzamento por `entry_type = "CASH"` produz falso positivo.**
Qualquer contagem futura precisa casar contra a aba, não contra o tipo derivado.

---

## 4.1 Comissão esperada ZERO — risco real, mas a causa não é o convênio

Levantou-se a hipótese de que uma proposta com comissão esperada R$ 0,00 estaria
saindo da conta porque o **convênio não está mapeado na régua**. Investigado:

**O convênio não é o discriminador.** O 96801 tem 4 linhas na diária, todas RR
PERNAMBUCO, e **duas delas pagam 6% cheio**:

```
   206249535    2026-04 net=R$    22.500,00 -> avista_empresa=R$       0,00  pct=0.0000  prod=2881 taxa=1.72 prazo=120
   213588492    2026-06 net=R$    12.900,00 -> avista_empresa=R$       0,00  pct=0.0000  prod=2881 taxa=1.72 prazo=121
   212558612    2026-06 net=R$     2.500,00 -> avista_empresa=R$     150,00  pct=6.0000  prod=2882 taxa=2.4  prazo=120
   205046814    2026-04 net=R$     8.300,00 -> avista_empresa=R$     498,00  pct=6.0000  prod=2882 taxa=2.4  prazo=120
```

Mesmo convênio, resultados opostos. O zero acompanha **produto 2881 (REFIN) +
taxa 1,72 + prazo 120/121**, não o convênio.

E "o convênio não está na TRP" não significa nada: a TRP não indexa por
convênio. Ela tem 12 categorias e nenhuma enumera código de convênio —

```
TRP 2026-04: 12 categorias
   FGTS, SIAPE, _meta, INSS_NOVO, INSS_RENOV, CONSIG_SP_MG, CONSIG_PRIVADO,
   CONSIG_PUBLICO, NAO_CONSIGNADO, PORTAB_PRIVADO, PORTAB_PUBLICO, ADIANTAMENTO_13
   categorias que citam "96801": NENHUMA
```

o mesmo vale para **todos** os convênios.

### Mas o fenômeno existe, e é maior que uma proposta

```
linhas em PRODUCAO (nao restritas) ......... 1977
  dessas, com avista_empresa = 0 .......... 111
  producao liquida nessas linhas .......... R$ 524.205,91

por competencia:
   2026-04:   34 de  531   net R$ 144.952,00
   2026-06:   43 de  723   net R$ 232.178,37
   2026-07:   34 de  723   net R$ 147.075,54
```

O padrão dominante é **prazo**, não convênio:

```
por prazo:  17x prazo 37 · 16x prazo 25 · 4x prazo 24 · 4x prazo 16 · 6x prazo 4
            8x prazo 13 · 1x prazo 120 · 1x prazo 121 · 6x prazo 36
```

**5,6% das linhas em produção não geram comissão-empresa, carregando
R$ 524.205,91.** Parte disso é legítima — duas das 16 foram verificadas e a
régua realmente não remunera (uma com prazo 5, abaixo do piso). Mas **não foi
determinado, caso a caso, quanto é piso legítimo e quanto é lacuna da régua.**
É a frente seguinte, e ela é maior que este documento.

> A proposta **220147900** (R$ 289.000, convênio 96801) foi procurada e **não
> existe em `daily_production_records`** — nem ela nem a 219880201. Não há como
> investigá-las neste banco.

---

## 5. Aviso — este valor NÃO está pronto para virar cobrança

1. **A curadoria contrato a contrato é obrigatória, e foi o que derrubou o
   número de 16 para 1.** Aplicar o mesmo rigor às 43 do universo real é
   trabalho ainda não feito; pelo que se viu aqui (5 falso-positivos já
   identificados, além de cancelamentos e piso de prazo), é esperado que o
   resíduo real também seja muito menor que R$ 168.456,54.

2. **R$ 53,11 não sustenta uma cobrança isolada.** O valor faz sentido como item
   somado a uma cobrança maior, ou como sintoma de um processo a corrigir — não
   como pleito autônomo.

3. **A comissão-empresa esperada é cálculo nosso, pela régua**, não valor
   reconhecido pela gestora. Ela usa a faixa do grupo da competência
   (R$ 4.192.842,41 → FAIXA 3). Se a Promotiva discordar da faixa, discute-se o
   percentual antes do valor.

4. **Os números se movem.** Julho está aberto e é reimportado; medições
   sucessivas desta mesma frente deram contagens diferentes. Refazer antes de
   qualquer uso formal.

5. **Falta perguntar à gestora.** O caminho antes de cobrar é perguntar por que
   a 210100613 não entrou no arquivo de 04/2026 — pode haver motivo que o nosso
   dado não mostra.

---

## Como reproduzir

Somente leitura:

```
npx tsx scripts/diag-16-ausentes.mts      # identifica as 16 e lista os dados
npx tsx scripts/diag-16-parte2.mts        # cruzamento sem filtro de competencia + dinheiro
npx tsx scripts/diag-16-veredito.mts      # o veredito uma a uma (este documento)
npx tsx scripts/diag-16-probe-abas.mts    # abas/tipos do fechamento e as 5 INSURANCE
npx tsx scripts/diag-bloco1-completo.mts  # o universo real das 43, nos dois sentidos
npx tsx scripts/diag-16-mencao-total.mts   # busca exaustiva de mencao em 2026 (68.316 linhas)
npx tsx scripts/diag-220147900-e-ads.mts   # convenio 96801 e as linhas da ADS
npx tsx scripts/diag-comissao-zero.mts     # as 111 linhas com comissao-empresa zero
```
