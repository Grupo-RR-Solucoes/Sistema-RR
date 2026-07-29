# SRCC do lado ADS — a resposta da BBTS chega na tela

Ramificada de `main` em `8dc92d8` (o merge da #147). 28/07/2026.

Medições: `scripts/mapa-srcc-ads.mts` (leitura) · gate: `scripts/gate-srcc-ads.mts`.
Nenhum dos dois entra no `npm run gates`: ambos leem o banco de produção
(`needs-db`), como o `backfill-srcc-resolucao.mts` da frente anterior. Rodar com
`npx tsx scripts/gate-srcc-ads.mts`.

---

## A frente virou outra no meio do mapeamento

Entrou como "o colapso 2/3/4 → `false`" — o espelho do que o RR consertou na
#147. O dado disse que o alvo era outro.

**O código 3 nunca apareceu.** Nem uma vez, em nenhuma das 54 linhas da ADS:

| fonte | linhas | srcc_cd |
|---|---|---|
| diária BBTS (`bbtsDailyImport`) | 34 (07/2026) | **null em 34/34** |
| fechamento PDF (`bbtsClosingImport`) | 19 (06/2026) | **2: 18 · 4: 1** |
| fechamento só-seguro | 1 | null |

E na diária não é raridade, é impossibilidade: o arquivo da BBTS tem **51
colunas e nenhuma de SRCC** (nem `cd_restricao_srcc`, nem nada contendo
`RESTRIC`). O `srccCd` é sempre `null` e o booleano nasce `false` **por ausência
de dado**, não por colapso. Confirmado por três vias independentes: o banco, o
`bbts_junho_fechamento.json` e a re-extração do PDF pelo `bbtsPdfExtract`.

**O defeito vivo era o inverso.** As 19 linhas de junho em que a BBTS
**respondeu** (18× "não", 1× "não se aplica") mostravam **"Sem informação"** na
tela. `getSrccRestrictionLabel` procurava o `raw_payload` por `"Indicador
Restrição SRCC"` / `"Restrição SRCC"` — e a ADS grava a chave **`srcc_cd`**. Sem
alias, caía no booleano `false` e devolvia "Sem informação". O tradutor de
códigos (`SRCC_POR_CODIGO`) já existia; faltava a **chave**.

No RR a dúvida ficava presa em âmbar. Na ADS era a **certeza** que sumia.

---

## O que mudou

**1. O fechamento ADS grava a resposta em COLUNA** (`bbtsClosingImport`):
`1→SIM`, `2→NAO`, `4→NAO_SE_APLICA`, **`3→não grava`**, fonte `fechamento_ads`,
com carimbo de data. Reusa a coluna, o domínio e a precedência da #147 — nenhuma
migration nova.

Reusa também o **tradutor**: `traduzirValorFechamento` já aceitava a forma
numérica (`"1"`/`"2"`/`"4"`) porque o RR podia mandar código, e já devolvia
`null` para o 3. A função que lê o texto da Promotiva lê o código da BBTS sem uma
linha de adaptação — e o `null` do 3 **é** o mecanismo que mantém a linha
indefinida. O domínio de três valores não tem como dizer "ainda não se sabe", e
não deve ter: quem não sabe fica NULL, âmbar, candidato a ser resolvido depois.

**2. `srccCd === 1` continua sendo a única fonte de `true`.** Nada no cálculo
mudou. Todos os consumidores testam `=== true`/`!== true` (`isValidRecord`,
`closingAnalytics:364`, `bbtsOrchestrator:140`, `projecaoMetas:67`,
`promoterAnalytics:844`, `bbtsMonthly:188`) — `false` e `null` são
indistinguíveis para o dinheiro. A dúvida não cabe no booleano; cabe no rótulo.

**3. Alias `srcc_cd` no rótulo** — mais `cd_restricao_srcc` e `Cd. Restrição
SRCC`, os nomes que o `bbtsDailyImport` já procura, para o dia em que a BBTS
mandar a coluna na diária. Isso conserta as 19 de junho **sem reimportar nada**.

**4. Os `false` fixos de (c) e (d) ficaram** — `bbtsClosingImport:392`
(só-seguro) e `adsSeguroDailyImport:213` (Prestamista) — com comentário dizendo o
que o `false` significa ali: **"não há dado de SRCC nesta linha"**, não "não há
restrição". Nas duas, ausência real: a linha não tem crédito, o relatório não tem
código, não há o que concluir — e por isso nenhuma delas grava `srcc_resolucao`.

---

## Por que COLUNA e não `raw_payload` — o risco que o mapa achou

O código já estava gravado em dois lugares (`raw_payload.srcc_cd` e
`__bbts_meta.srcc_cd`), e **os dois são apagáveis**:

- o fechamento entra como `owner: "FULL"`, a diária como `owner: "CREDIT"`, e
  `is_srcc_restricted` está em `CREDIT_COLUMNS` → **reimportar a diária
  sobrescreve o booleano** com o `false` dela;
- pior, `mergeRawPayload` mescla `__bbts_meta` **campo a campo** (`{...bv,
  ...iv}`), então um `srcc_cd: null` da diária **apaga** o `srcc_cd: 2` do
  fechamento.

Hoje é inócuo: a BBTS nunca mandou `cd=1`, e a diária não tem a coluna. No dia em
que mandar, reimportar a diária apagaria a restrição **em silêncio** — o mesmo
padrão que os `NESTED_TRACE_KEYS` já tiveram de corrigir uma vez (o "pago" da
BBTS). Registrado em comentário no `dailyRecordMerge`, ao lado da coluna.

**`srcc_resolucao` é imune, e isso foi verificado, não presumido:**
`ownedColumnsFor` (`dailyRecordMerge:143-150`) devolve, para donos parciais,
apenas a interseção com `CREDIT_COLUMNS`/`INSURANCE_COLUMNS` — e a coluna não
está em nenhuma das duas. A diária não a alcança nem por engano. Só o `FULL`
escreve, e só as chaves que o registro traz (`:145`): por isso o código 3 **omite
os três campos** em vez de gravar `null`, e omitir é literalmente "não tocar",
inclusive numa reimportação.

---

## Gate — `scripts/gate-srcc-ads.mts`, 21/21

O "antes" não é reimplementado: é a **mesma função** rodando sobre uma cópia do
registro sem as chaves novas. Reimplementar a regra do rótulo para compará-la
consigo mesma provaria a reimplementação, não o conserto.

```
1. CLASSIFICACAO   cd=1->SIM · cd=2->NAO · cd=3->null (nao grava) · cd=4->NAO_SE_APLICA

2. IMPORT EM DRY-RUN (junho)
   ancora_ok=true  propostas=19  {"SIM":0,"NAO":18,"NAO_SE_APLICA":1,"indefinidas":0}
   restritas (booleano) segue 0

3. ROTULO NO DADO DE HOJE (2226 linhas de 2026: ADS 54 · RR 2172)
   ADS antes : "Sem informação": 54
   ADS depois: "Não": 18 · "Não se aplica": 1 · "Sem informação": 35
   19 mudancas, TODAS na ADS · nenhuma linha do RR muda
   estados: neutro 19 · sem-info 35 · restrito 0 · nenhum tingimento novo

4. PRODUCAO E BOOLEANO INTOCADOS
   linhas elegiveis  1914 = 1914
   soma de producao  R$ 15.183.226,33 = R$ 15.183.226,33
```

`tsc` 0 erros · `npm run gates` 3/3 (2 pulados, os de sempre).

As 35 de julho seguem "Sem informação" — **está certo**: a diária da BBTS não
traz SRCC, e "não sei" é a informação correta sobre elas. É a mesma decisão que a
#147 tomou para as 16 ausentes do RR.

---

## Efeito prático e o que falta acontecer

O conserto do **rótulo** vale imediatamente no deploy: as 19 de junho aparecem
certas sem reimportar nada.

A **coluna** só se preenche no próximo import de fechamento ADS — hoje as 54
linhas têm `srcc_resolucao` NULL. **Não fiz backfill** e não recomendo um: o
alias já resolve a exibição das linhas existentes, e a coluna dessas 19 se
preenche sozinha se o fechamento de junho for reimportado. Diferente do RR, onde
o backfill existia para destravar 114 linhas presas em âmbar, aqui não há nada
preso.

## O que continua em aberto

- **A diária da BBTS não manda SRCC.** 51 colunas, nenhuma de restrição. Vale
  perguntar à gestora se a coluna existe no extrato e não está sendo enviada — se
  vier, o importador e o rótulo já a leem, sem código novo.
- **O código 3 nunca foi visto.** Está coberto, mas nunca exercitado em dado
  real: a base é um fechamento (junho) e um mês de diária (julho, 34 linhas).
- **`is_srcc_restricted` é sobrescrevível pela diária** (o risco acima). Não
  morde hoje. O conserto seria tirá-lo de `CREDIT_COLUMNS` ou dar-lhe precedência
  por fonte — nenhum dos dois é gratuito, e nenhum é urgente enquanto a BBTS não
  mandar `cd=1`.
