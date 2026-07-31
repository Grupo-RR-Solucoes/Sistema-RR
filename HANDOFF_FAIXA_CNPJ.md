# A faixa do CNPJ no lugar da faixa do GRUPO — achado

Medido em 30/07/2026, na branch `feat/tres-frentes` (ramificada de `main` em
`c546d85`). **Somente leitura: nada foi escrito no banco.**

> **A conclusão que decide o encaminhamento: o defeito é NOSSO, não da
> Promotiva.** Não vira item de cobrança. A gestora nunca mandou percentual
> nenhum na diária; a coluna `company_received_percent` é produzida inteiramente
> pelo nosso cálculo, e ele apura a faixa no CNPJ isolado em vez de no grupo.

> **REPRODUTIBILIDADE — os números desta frente.** Um único script produz todos
> eles, e produziu o mesmo resultado nas duas execuções (30/07/2026):
>
> ```
> npx tsx scripts/diag-bloco2-completo.mts
>
> BLOCO 2 — linhas em daily_production_records (TODAS, sem filtro de data): 2282
> competencias COM diaria: 2026-04, 2026-06, 2026-07
> abaixo da faixa do GRUPO: 44   (batem CNPJ: 37 · batem nada: 7)
> TOTAL   R$ 350.821,09 producao   R$ 648,65 comissao-empresa   R$ 378,36 repasse
> ```
>
> **44 linhas, 3 competências, R$ 648,65.** Não existe medição neste repositório
> que produza contagem, período ou valor diferentes — em particular, não há
> como chegar a 128 linhas nem a 15 competências, porque
> `daily_production_records` tem **0 linhas em 2022, 2023, 2024 e 2025** (seção
> "Cobertura temporal"). Cifra que não saia do comando acima não foi medida
> aqui.

---

## 1. O mecanismo

`daily_production_records.company_received_percent` tem dois escritores. O
caminho que produz o defeito é o segundo.

**Escritor 1 — o import da diária** (`app/api/import/daily/route.ts:494-501`)
lê o percentual do arquivo, se existir:

```ts
const companyReceivedPercent = parsePercent(
  getField(lookup, [
    "% A VISTA",
    "% À VISTA",
    "% A VISTA EMPRESA",
    "% AVISTA",
    "Percentual A Vista",
  ])
);
```

`parsePercent` (`route.ts:124-138`) só filtra plausibilidade (0,1% a 6,5%) e
devolve `null` fora da janela. **Não transforma faixa.** Este escritor é inócuo
para o defeito.

**Escritor 2 — o cálculo mensal** (`app/api/calculate/monthly/route.ts:1182-1191`)
é onde o número nasce:

```ts
const companyExpected = companyExpectedMap.get(record.company_id) || null;
const persistedCompanyReceivedPercent =
  getPersistedCompanyReceivedPercent(
    record,
    importedRule
  ) ||
  deriveCompanyReceivedPercentFromMotor(
    record,
    toNumber(companyExpected?.netValidProduction),
    trpProvider
  );
```

`getPersistedCompanyReceivedPercent` (`route.ts:103-129`) procura o mesmo alias
no `raw_payload`. Como o arquivo não tem a coluna, ele devolve `0`, e o `||`
cai no **derive**.

O derive recebe a produção de **um CNPJ**, não do grupo. O mapa é construído
por empresa (`route.ts:972-975`):

```ts
for (const company of companies) {
  const records = companyGroups.get(company.id) || [];
  const expected = calculateCompanyExpectedValues(records, trpProvider);
  companyExpectedMap.set(company.id, expected);
```

e esse valor entra no motor como a base da faixa
(`deriveCompanyReceivedPercentFromMotor`, `route.ts:194`):

```ts
    production_value: companyProductionValue,
```

`companyExpectedMap` é indexado por `company_id`. **A faixa nasce da produção de
um CNPJ isolado. Nunca do grupo.** Depois o valor é persistido de volta na
coluna (`route.ts:1391-1395`):

```ts
recordUpdates.push({
  id: record.id,
  company_id: record.company_id,
  proposal_number: record.proposal_number,
  company_received_percent: persistedCompanyReceivedPercent,
```

---

## 2. A prova de que a Promotiva não mandou o número

Varredura da tabela inteira, sem filtro:

```
linhas totais .................. 2282
com alias de "% A VISTA" ....... 0
chaves que contem %/PERCENT/VISTA em QUALQUER linha:
   "pag_avista"  19 linhas        <- campo da BBTS/ADS, outro caminho
```

**Zero em 2.282.** O arquivo diário da Promotiva (`ProducaoMensalBD_*.xlsx`) tem
29 colunas e nenhuma é percentual de comissão.

### Três exemplos, com o payload cru integral

**Exemplo 1 — proposta 206718920, 2026-04, RR ALAGOAS 1**

```
COLUNA company_received_percent .... 5.49
faixa do GRUPO F3 (R$ 4.192.842,41) .... 5.7000
faixa do CNPJ  F1 (R$   828.726,12) .... 5.4900
a coluna e IGUAL a faixa do CNPJ? SIM
chaves de "% A VISTA" no payload: NENHUMA
```

```json
{
  "UF": "AL", "CPF": "33202559400", "MCI": "847822962", "Prazo": "61",
  "ChaveJ": "JJ247889", "Status": "Produção", "Parcelas": "60",
  "Cód. Coban": "98250", "Nome Cliente": "MARIA TEREZA DE OLIVEIRA",
  "Data Contrato": "02/04/2026", "Data Proposta": "02/04/2026",
  "Data Movimento": "02/04/2026", "Custo Convênio": "1",
  "Código Produto": "2991", "Número Proposta": "206718920",
  "Tipo de Subcanal": "APP", "Valor Financiado": "30000.00",
  "Código Convênio": "000000000", "Tipo de Convênio": "Público",
  "Segmento Convênio": "1", "Tipo de Liberação": "1",
  "Taxa Mensal de Juros": "4.91", "Valor Seguro Crédito": "0.00",
  "Descrição do Produto": "CRÉDITO SALÁRIO",
  "Evento mais Restritivo": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Prefixo Ag. Responsável": "3332",
  "Qtd. Dias de Restrição": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Valor Financiado Líquido": "30000.00",
  "Indicador Restrição SRCC": "Não se aplica"
}
```

**Exemplo 2 — proposta 210188121, 2026-04, RR ALAGOAS 2**

```
COLUNA company_received_percent .... 5.49
faixa do GRUPO F3 (R$ 4.192.842,41) .... 5.7000
faixa do CNPJ  F1 (R$   702.767,08) .... 5.4900
a coluna e IGUAL a faixa do CNPJ? SIM
chaves de "% A VISTA" no payload: NENHUMA
```

```json
{
  "UF": "PE", "CPF": "40914321404", "MCI": "873386662", "Prazo": "85",
  "ChaveJ": "JI489771", "Status": "Produção", "Parcelas": "84",
  "Cód. Coban": "18309", "Nome Cliente": "FRANCISCO BERNARDINO DA SILVA",
  "Data Contrato": "24/04/2026", "Data Proposta": "24/04/2026",
  "Data Movimento": "24/04/2026", "Custo Convênio": "1",
  "Código Produto": "2992", "Número Proposta": "210188121",
  "Tipo de Subcanal": "Portal Mais BB", "Valor Financiado": "2200.00",
  "Código Convênio": "000000000", "Tipo de Convênio": "Público",
  "Segmento Convênio": "1", "Tipo de Liberação": "1",
  "Taxa Mensal de Juros": "4.80", "Valor Seguro Crédito": "0.00",
  "Descrição do Produto": "CRÉDITO BENEFICIO CORRENTISTA",
  "Evento mais Restritivo": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Prefixo Ag. Responsável": "1732",
  "Qtd. Dias de Restrição": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Valor Financiado Líquido": "2200.00",
  "Indicador Restrição SRCC": "Não se aplica"
}
```

**Exemplo 3 — proposta 212571965, 2026-06, RR ALAGOAS 1**

```
COLUNA company_received_percent .... 2.35
faixa do GRUPO F3 (R$ 5.527.522,23) .... 2.4400
faixa do CNPJ  F1 (R$   562.796,94) .... 2.3500
a coluna e IGUAL a faixa do CNPJ? SIM
chaves de "% A VISTA" no payload: NENHUMA
```

```json
{
  "UF": "AL", "CPF": "46956042487", "MCI": "847822962", "Prazo": "120",
  "ChaveJ": "JJ377592", "Status": "Produção", "Parcelas": "120",
  "Cód. Coban": "98250", "Nome Cliente": "FRANCISCO RICARDO CORREIA MATA",
  "Data Contrato": "08/06/2026", "Data Proposta": "08/06/2026",
  "Data Movimento": "08/06/2026", "Custo Convênio": "4",
  "Código Produto": "2881", "Número Proposta": "212571965",
  "Tipo de Subcanal": "APP", "Valor Financiado": "58329.58",
  "Código Convênio": "000001078", "Tipo de Convênio": "Público",
  "Segmento Convênio": "1", "Tipo de Liberação": "1",
  "Taxa Mensal de Juros": "1.78", "Valor Seguro Crédito": "0.00",
  "Descrição do Produto": "CONSIGNADO CORRENTISTA REFIN",
  "Evento mais Restritivo": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Prefixo Ag. Responsável": "1601",
  "Qtd. Dias de Restrição": "Não informado pela CIP/SRCC ou linha de crédito não passível de verificação",
  "Valor Financiado Líquido": "9200.00",
  "Indicador Restrição SRCC": "Não se aplica"
}
```

Os três padrões se repetem: coluna == faixa do CNPJ, até a segunda casa, e
nenhuma chave de percentual no arquivo.

---

## 3. Os números, por competência

Detecção: linha em `PRODUCAO`, não restrita por SRCC, com
`company_received_percent > 0`, cujo valor fica **abaixo** do que a faixa do
GRUPO daria para aquela linha.

```
comp     total  c/pct   abaixo  bate-CNPJ  bate-nada    producao afetada   comissao-empresa a menor   repasse a menor
2026-04    619    500       32         28          4    R$    184.280,44   R$     348,84          R$    203,48
2026-06    820    663        8          8          0    R$    122.940,65   R$     118,42          R$      69,07
2026-07    843     18        4          1          3    R$     43.600,00   R$     181,39          R$     105,81
------------------------------------------------------------------------------------------------------------------
TOTAL                        44         37          7   R$    350.821,09   R$     648,65          R$     378,36
```

**Total: 37 linhas com a faixa do CNPJ + 7 sem explicação, R$ 350.821,09 de
produção afetada, R$ 648,65 de comissão-empresa a menor, R$ 378,36 de repasse
(58,33%).**

### Cobertura temporal — o número é limitado ao período com dado

```
daily_production_records — linhas por ANO:
   2022:      0
   2023:      0
   2024:      0
   2025:      0
   2026:   2282        (2026-04: 619 · 2026-06: 820 · 2026-07: 843)

monthly_closing_entries — linhas por ANO:
   2022:      46    2023:  21343    2024:  77117    2025: 122998    2026:  68316
```

O fechamento cobre dez/2022 a 2026, mas **não tem** a coluna
`company_received_percent` — o defeito não pode existir lá. A diária, única
portadora da coluna, **começa em 2026**. Não há como rodar esta detecção antes
disso: o número acima é o total do universo com dado, não um recorte dele.

---

## 4. As 7 sem explicação são uma TERCEIRA coisa

Não batem com a faixa do grupo nem com a do CNPJ. E o payload delas também não
traz percentual.

```
[1..4] 209847018 / 210016786 / 209994624 / 210005717   2026-04   RR AL1 e AL2
       COLUNA = 2.44      produto 2882 CONSIGNADO CORRENTISTA, conv 000001078,
                          taxa 1,80, prazo 97
       o que a linha daria: F1=3,2100 F2=3,2300 F3=3,3400 F4=3,4800 F5=3,5200

[5..7] 219512438 / 220082349 / 219458668   2026-07   ADS Consultoria
       COLUNA = 1.96
       o que a linha daria: F1=2,3500 F2=2,3700 F3=2,4400 F4=2,5500 F5=2,5800
```

Varredura de **toda** a TRP de 2026-04 — 12 categorias × 6 rótulos de tabela ×
taxa de 0,50% a 6,00% em passos de 0,01 × 14 prazos:

```
=== onde 2,44 aparece na TRP de 2026-04 (varredura taxa x prazo) ===
   2,44 NAO aparece em nenhuma combinacao varrida.
=== e 1,96? ===
   1,96 NAO aparece em nenhuma combinacao varrida de 2026-04.
```

**Nem 2,44 nem 1,96 são célula da régua vigente.** Não são faixa errada — são
valor estranho à TRP daquela competência.

**Aberto:** de onde vêm. Há 184 linhas em 2026 com a coluna em 2,44 (105 delas
"CRÉDITO ANTECIPAÇÃO 13º SALÁRIO", convênio 000137478) e 3 em 1,96 — ou seja,
o valor é recorrente, não ruído de uma linha. Origem não determinada. Candidatos
não testados: o JSON embutido (`getRegra`) em vez da régua do DB, ou escrita
feita sob uma versão anterior da TRP.

---

## 5. A auditoria dos R$ 107 mil NÃO detecta isto — e não deveria

A pergunta era se o subpagamento acumulado escapou da cobrança de 07/05/2026.
**Não escapou, por dois motivos independentes.**

### 5.1 A auditoria apura no GRUPO — logo pegaria uma faixa de CNPJ

`lib/enquadramento.ts:332-351` soma o mês inteiro num acumulador único,
percorrendo todos os CNPJs ativos:

```ts
  let total = 0;
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("audit_v9_avista")
      .select("empresa,valor_liquido,status_fase1")
      .eq("mes", ym)
      .neq("status_fase1", "SRCC")
      .range(from, from + PAGE - 1);
    ...
    for (const r of data as ...) {
      const lab = empresaToActiveLabel(r.empresa);
      if (!lab || !activeLabels.has(lab)) continue;
      total += Number(r.valor_liquido || 0);
    }
```

Confirmado no dado — o total bate com a soma de todos os CNPJs, nunca com um
isolado:

```
2026-04:  fetchVolAvistaRecalc = R$ 4.191.252,41
        soma de TODOS os CNPJs = R$ 4.191.252,41   |   maior CNPJ sozinho = R$ 1.372.559,43
           RR ALAGOAS 2   R$   702.767,08     RR ALAGOAS 3   R$ 1.372.559,43
           RR ALAGOAS     R$   828.726,12     RR PERNAMBUCO  R$ 1.287.199,78
        => a auditoria apura no GRUPO
```

(idem em 2026-01, 2026-02 e 2026-03.)

Desse volume sai a `catDevida`, que é **uma por mês** — não tem dimensão de
CNPJ. E a auditoria de fato pega categoria aplicada a menor; é literalmente o
que os R$ 107 mil são:

```
mes       contratos  catDevida    catAplicada   regime         SUBPAG  cobranca 2.1
2024-07        708   TABELA 2     TABELA 1      META_2_NIVEIS     631  R$  26.771,30
2024-09        635   TABELA 2     TABELA 1      META_2_NIVEIS     527  R$  13.383,60
```

1.158 contratos, R$ 40.154,90, exatamente o padrão "aplicou faixa/tabela
inferior". **A auditoria não passa batido nisso.**

### 5.2 Mas o nosso defeito é invisível para ela — e corretamente

A auditoria lê `audit_v9_avista`, alimentada pelo **fechamento** (o que a
Promotiva efetivamente pagou). Ela nunca lê
`daily_production_records.company_received_percent`. Como a Promotiva pagou
certo e o erro está só na nossa coluna derivada, **não há o que a auditoria
detectar, e não há subpagamento acumulado fora da cobrança de 07/05 por esta
causa.**

Total histórico da auditoria, recomputado sobre as 41 competências disponíveis
(2022-12 a 2026-04): **R$ 61.314,26 em 2.503 linhas** de subpagamento
(`somaPedidoFirme21`).

---

## 5.3 O bug: o que exatamente vira 2,35 no lugar de 2,44

Não há transformação, arredondamento nem leitura de campo errado. **2,44 e 2,35
são duas células diferentes da mesma TRP**, e o derive escolhe a errada porque
recebe a base errada:

```
   2026-06 RR ALAGOAS 1   grupo R$ 5.527.522,23 FAIXA_3  ->  2,44
                          cnpj  R$   562.796,94 FAIXA_1  ->  2,35
```

O percentual não é "reduzido"; é **buscado na linha errada da matriz**. Por isso
a diferença não tem padrão decimal fixo — ela varia com a distância entre a
faixa do grupo e a do CNPJ.

E essa é a única coisa que as linhas afetadas têm em comum. Em **todas** as 9
combinações empresa × competência, o grupo cai em FAIXA_3 e o CNPJ em FAIXA_1
ou FAIXA_2:

```
   2026-04 RR ALAGOAS 1    grupo R$ 4.192.842,41 FAIXA_3  x  cnpj R$   828.726,12 FAIXA_1
   2026-04 RR ALAGOAS 2    grupo R$ 4.192.842,41 FAIXA_3  x  cnpj R$   702.767,08 FAIXA_1
   2026-04 RR ALAGOAS 3    grupo R$ 4.192.842,41 FAIXA_3  x  cnpj R$ 1.374.149,43 FAIXA_2
   2026-04 RR PERNAMBUCO   grupo R$ 4.192.842,41 FAIXA_3  x  cnpj R$ 1.287.199,78 FAIXA_2
   2026-06 RR ALAGOAS 1    grupo R$ 5.527.522,23 FAIXA_3  x  cnpj R$   562.796,94 FAIXA_1
   2026-06 RR ALAGOAS 2    grupo R$ 5.527.522,23 FAIXA_3  x  cnpj R$ 1.488.632,74 FAIXA_2
   2026-06 RR ALAGOAS 3    grupo R$ 5.527.522,23 FAIXA_3  x  cnpj R$ 2.000.450,48 FAIXA_2
   2026-06 RR PERNAMBUCO   grupo R$ 5.527.522,23 FAIXA_3  x  cnpj R$ 1.204.431,23 FAIXA_2
   2026-07 ADS Consultoria grupo R$ 6.307.001,81 FAIXA_3  x  cnpj R$   519.798,35 FAIXA_1
```

Produto e convênio estão espalhados (16x 2882, 6x 2996, 5x 2991, 5x 2992...;
12x conv 1078, 11x conv 0...) — **não são discriminantes**. O discriminante é
CNPJ pequeno dentro de grupo grande.

---

## 5.4 O bug ALCANÇA o pagamento do promotor — R$ 105,81 de dívida interna

Esta é a pergunta que separa "erro de exibição" de "dinheiro". A comissão do
promotor é calculada **proporcionalmente à coluna**, em
`app/api/calculate/monthly/route.ts:1248-1283`:

```ts
          if (effectiveCompanyReceivedPercent > 0) {
            const aVistaClamped = Math.min(
              effectiveCompanyReceivedPercent,
              5.8
            );
            ...
              commissionPercent = aVistaClamped * resolution.sharePercent;
```

e `effectiveCompanyReceivedPercent` é o valor derivado (`:1193`). **Coluna menor
⇒ comissão do promotor menor.**

Mas isso só vira pagamento onde o PMR nasce da diária. Em competência fechada o
PMR é consolidado do **fechamento**, e a coluna não participa. Medido:

```
comp     linhas  fontes do PMR                        delta repasse (58,33%)
2026-04      32  fechamento, (sem PMR)               R$     203,48  (PMR do fechamento: nao alcanca)
2026-06       8  fechamento, (sem PMR)               R$      69,07  (PMR do fechamento: nao alcanca)
2026-07       4  daily, (sem PMR)                    R$     105,81  <- PMR da DIARIA: alcanca pagamento

  delta em competencia cujo PMR vem da DIARIA ....... R$ 105,81   <- divida interna REAL
  delta em competencia cujo PMR vem do FECHAMENTO ... R$ 272,55   (sem efeito no pago)
```

**Conclusão em duas partes:**

1. **R$ 272,55** (04 e 06/2026) é divergência de exibição. O promotor foi pago
   pelo fechamento; a coluna errada não alcançou o bolso dele.
2. **R$ 105,81** (07/2026) é **dívida interna real** — julho ainda está aberto e
   o PMR vem da diária, então o repasse será calculado sobre o percentual menor
   se nada mudar. **Corrigir antes de fechar julho elimina a dívida**, em vez de
   criar um acerto retroativo.

Os R$ 648,65 de comissão-empresa são a **medida da divergência interna**, não
dinheiro a receber de ninguém.

---

## 5.5 PROVA FINAL pela declaração da própria Promotiva — FRENTE ENCERRADA

A diária não traz percentual (0 de 2.282). Mas o **fechamento** traz, no
`metadata` de cada linha CASH, a declaração da gestora:

```
"% A VISTA"        o percentual que ela aplicou
"COMISSÃO PF "     o valor que ela pagou naquela linha
"TABELA"           a faixa que ela diz ter usado
```

Comparando as 44 linhas afetadas contra essa declaração:

```
proposta      comp     empresa         nossa   PROMOTIVA     COMISSAO PF   TABELA    grupo   cnpj   quem a Promotiva seguiu
212571965     2026-06  RR ALAGOAS 1     2.35      2.4400   R$    224,48   FAIXA 3    2.44   2.35   = FAIXA DO GRUPO
210202870     2026-04  RR ALAGOAS 3     5.53      5.7000   R$  2.109,00   FAIXA 3    5.70   5.53   = FAIXA DO GRUPO
212155287     2026-06  RR PERNAMBUCO    4.34      4.4800   R$  1.344,00   FAIXA 3    4.48   4.34   = FAIXA DO GRUPO
213823980     2026-06  RR ALAGOAS 3     2.37      2.4400   R$  1.098,00   FAIXA 3    2.44   2.37   = FAIXA DO GRUPO
...

  achadas no fechamento .......... 40
  ausentes do fechamento ......... 4      (as 4 da ADS, 07/2026, mes aberto)

  o % da Promotiva bate com:
     a NOSSA COLUNA .............. 0
     a FAIXA DO GRUPO ............ 35
     a FAIXA DO CNPJ ............. 0
     nenhuma das tres ............ 5

  COMISSAO PF somada (o que a Promotiva pagou nessas linhas): R$ 11.734,95
```

**35 de 35 conclusivas: a Promotiva aplicou a FAIXA DO GRUPO.** Ela própria
carimba `TABELA = "FAIXA 3"` no metadata — a faixa do grupo, não a do CNPJ.
Zero linhas batem com a nossa coluna, zero batem com a faixa do CNPJ.

As 5 de "nenhuma das três" são o teto: a Promotiva declara 6,00% e a nossa
célula do grupo dá 5,80% — é o teto da visão do promotor (`capPromoterViewRate`),
não divergência de faixa.

### O que isto encerra

1. **A empresa recebeu o devido.** A gestora pagou pela faixa do grupo,
   R$ 11.734,95 nessas linhas. Não há subpagamento, não há cobrança, e nunca
   houve — a hipótese está agora refutada pela declaração dela mesma, não só
   pela ausência de campo na diária.
2. **A nossa coluna é a única errada da história.** Ela guarda a faixa do CNPJ
   enquanto gestora e régua concordam na faixa do grupo.
3. **A única consequência era o repasse ao promotor** (seção 5.4), e ela está
   fora do escopo desta frente.

**FRENTE ENCERRADA POR ESCOPO.** O que sobra vive em duas outras: o repasse de
07/2026 (R$ 105,81, julho ainda aberto) e a correção do derive.

---

## 5.6 OBSERVAÇÃO, sem abrir frente: a referência direta está sendo ignorada

O fechamento traz, por linha, `% A VISTA`, `COMISSÃO PF ` e `TABELA` — **o que a
gestora aplicou, quanto pagou e por qual faixa**. É a referência mais direta que
existe para conferir a nossa própria conta.

Hoje `company_received_percent` **nunca é reconciliada contra esses campos**. O
derive calcula do zero a partir da produção, e o resultado nunca é confrontado
com o que a gestora declarou na linha correspondente — embora o dado esteja no
banco, na mesma competência, casável pelo número da proposta.

Este documento é a primeira vez que essa comparação foi feita, e ela resolveu
em uma rodada uma dúvida que consumiu várias. Vale considerar quando a auditoria
for revista. **Não é frente aberta aqui** — é anotação para quem for mexer nela.

> Ressalva de nomenclatura: os campos são `% A VISTA`, `COMISSÃO PF ` e `TABELA`,
> no `metadata` do `monthly_closing_entries`. Não existem no banco campos
> chamados `pct_pgto`, `vlr_pgto`, `lista_srcc` ou `cd_srcc` — verificado no
> inventário completo das 107 chaves de payload da diária e por grep no código.

---

## 5.7 Histórico deste documento — para ninguém herdar versão desatualizada

Todas as versões são de 30/07/2026, na branch `feat/tres-frentes`:

| commit | o que dizia |
|---|---|
| `0a9eefd` | primeira versão. Já concluía "o defeito é NOSSO, não da Promotiva; não vira cobrança", com base na ausência de percentual na diária (0 de 2.282). |
| `7c1abf1` | acrescenta o carimbo de reprodutibilidade (44 linhas, 3 competências, R$ 648,65). |
| `b82dc3a` | caracteriza o bug (duas células da mesma TRP) e mede que ele alcança o repasse: R$ 105,81 vivos, R$ 272,55 sem efeito. |
| este | prova pela declaração da Promotiva (`% A VISTA` = faixa do grupo em 35/35) e **encerra a frente por escopo**. |

**Nenhuma versão afirmou subpagamento da Promotiva.** A conclusão nunca inverteu;
o que mudou foi a força da prova — de "ela não mandou o campo" para "ela declarou
a faixa do grupo e pagou por ela".

Números que circularam em conversa e **nunca** estiveram neste documento, por não
serem reproduzíveis: R$ 4.912,89, 128 linhas, 15 competências, R$ 2.865,49.

---

## 5.8 O CONSERTO — aplicado em 30/07/2026, vale daqui pra frente

`app/api/calculate/monthly/route.ts`. Duas mudanças funcionais:

```ts
    const groupNetValidProduction = Array.from(companyExpectedMap.values()).reduce(
      (soma, expected) => soma + toNumber(expected?.netValidProduction),
      0
    );
```

e, no derive:

```ts
-        const companyExpected = companyExpectedMap.get(record.company_id) || null;
-            toNumber(companyExpected?.netValidProduction),
+            groupNetValidProduction,
```

`monthly_expected_closings` **não muda** — lá o valor por CNPJ é o certo. O que é
do grupo é a **faixa**, não a produção esperada.

### O que o conserto alcança, medido antes de aplicar

```
comp     regime          linhas  derive MUDA  delta comissao-empresa  | coluna JA gravada  coluna VAZIA
2026-04  fechamento         531          417  R$     3.998,97   |             417              0
2026-06  fechamento         704          585  R$     4.875,65   |             584              1
2026-07  open               680          572  R$    11.889,52   |               0            572
```

**Só julho é alcançado: 572 linhas, R$ 11.889,52** de comissão-empresa exibida.
Em julho o grupo está em R$ 7.145.612,29 (**FAIXA_4**) enquanto cada CNPJ isolado
está em FAIXA_1/FAIXA_2 — o salto é de 2 a 3 faixas, e por isso o efeito é grande.

Abril e junho **não se movem**, por proteção dupla:

1. `route.ts:715-716` desvia quando `regime !== "open"` — mês fechado nunca chega
   ao derive. Regime medido: `2026-04: fechamento`, `2026-06: fechamento`,
   `2026-07: open`.
2. `getPersistedCompanyReceivedPercent` (`:118-121`) devolve a coluna já gravada
   antes de chamar o derive.

Os 417 e 585 de abril/junho na tabela acima são **hipotéticos** — o que
aconteceria se o código rodasse, e ele não roda.

### DECISÃO DE ESCOPO — o que NÃO será feito, e por quê

Registrado por decisão do Diego, 30/07/2026:

- **Abril e junho ficam como estão.** São competências FECHADAS e PAGAS; o `cms`
  é a fonte de verdade do mês fechado. Não se reescreve PMR de mês pago para
  corrigir exibição.
- **Os R$ 105,81 de repasse ao promotor não serão repostos.** Repasse está fora
  do escopo da régua do Diego: o que importa é o que a **empresa** não recebeu ou
  recebeu a menor — e a empresa recebeu certo, porque a Promotiva pagou pela
  FAIXA 3 (§5.5, 35 de 35 conclusivas).
- **Não se mexe no curto-circuito** de `getPersistedCompanyReceivedPercent`.
  Mudar precedência de dado já gravado é risco sem retorno aqui; hoje ele é
  justamente o que protege o mês fechado.

**O conserto vale daqui pra frente.** Julho fecha na faixa certa.

---

## 6. Ressalvas — o que este documento NÃO prova

1. **Os números se movem.** Uma medição anterior desta mesma frente registrou
   47 + 7 linhas e R$ 681.344,46 de produção afetada; hoje medi 37 + 7 e
   R$ 350.821,09. Julho está aberto e foi reimportado (o import de 29/07/2026
   reescreveu as 739 linhas do RR de julho). Os números acima são de
   30/07/2026 e devem ser refeitos antes de virar peça formal.

2. **A premissa "a apuração correta é no grupo" não foi reverificada aqui.**
   Ela vem do trabalho anterior (`scripts/medida-b-faixa-cnpj-ou-grupo.mts`,
   1.394 linhas concordando com o grupo contra 47 com o CNPJ). Este documento
   a assume; o item 5.1 a corrobora de forma independente, mostrando que a
   auditoria também apura no grupo.

3. **A base da auditoria vai até 2026-04.** 05, 06 e 07/2026 ainda não estão em
   `audit_v9_avista`.

4. **Deriva entre gravado e recomputado:** a soma de `diferenca < 0` gravada em
   `audit_v9_avista` dá R$ 67.096,25 / 2.529 linhas, contra R$ 61.314,26 /
   2.503 recomputados agora. Não investigado.

5. **Nenhum conserto foi proposto ou aplicado.** O diagnóstico para aqui.

---

## Como reproduzir

Somente leitura, todos:

```
npx tsx scripts/diag-bloco2-completo.mts     # payload cru + numeros por competencia
npx tsx scripts/diag-bloco2-auditoria.mts    # alias, cobertura, auditoria historica, grupo x CNPJ
npx tsx scripts/diag-bloco2-fechamento.mts   # cobertura temporal + as 7 contra toda a TRP
npx tsx scripts/diag-bloco2-origem244.mts    # varredura de 2,44 e 1,96 na regua
npx tsx scripts/diag-faixa-cnpj-bug.mts      # o bug: alcanca pagamento? (R$ 105,81)
npx tsx scripts/diag-degrau-taxa.mts         # qual dos 3 degraus pega, e inventario de chaves
npx tsx scripts/diag-pct-promotiva-vs-coluna.mts  # a declaracao da Promotiva x a nossa coluna
```
