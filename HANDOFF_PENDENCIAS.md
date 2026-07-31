# Pendências acumuladas — o que virou conserto, o que virou portão, o que NÃO é achado

Branch `feat/pendencias`, ramificada de `main` em `612ca49` (#151 fundida em
`04eab51`, #152 em `612ca49`). Medido em 30–31/07/2026.

> **REGRA DESTE DOCUMENTO: todo número tem script que o reproduz**, listado no
> fim. Nenhum valor é estimado; linha que não calcula é declarada como "não
> calcula". Cifra que apareça em conversa e não esteja aqui não foi medida.

---

## Bloco 1 — o derive passou a apurar a faixa no GRUPO

Commit `83c12c5`. Detalhe completo em `HANDOFF_FAIXA_CNPJ.md` §5.8. Resumo:

- `deriveCompanyReceivedPercentFromMotor` recebia a produção de **um CNPJ**; a
  TRP escalona por volume da **gestora**. Passou a receber
  `groupNetValidProduction`.
- Confirmado pela declaração da própria Promotiva: nas linhas onde as duas bases
  divergem, o `% A VISTA` dela bate com a faixa do GRUPO em **996** e com a do
  CNPJ em **0**.
- Efeito real: **só 2026-07** (572 linhas, R$ 11.889,52 de comissão-empresa).
  Abril e junho não se movem — `route.ts:715-716` desvia em mês fechado e
  `getPersistedCompanyReceivedPercent:118-121` devolve a coluna já gravada.
- Validado na tela pelo Diego: 212571965 → 2,44% e 212155287 → 4,48%.

---

## Bloco 2 — o portão que teria pego o bug

Commit `af241e5`. `scripts/gate-avista-vs-fechamento.mts`.

Compara `company_received_percent` contra o `% A VISTA` que o fechamento
carimba, por competência **fechada**. Acusa; não grava, não conserta.
Custo medido: **4–15s** de parede para 2026 inteiro.

**Piso `2026-07`.** Sem ele o portão nasceria vermelho com 35 linhas de 04 e
06/2026 que ninguém vai corrigir. As 35 **não sumiram**: viraram a constante
`ESTADO_CONHECIDO` no topo do arquivo, impressa a cada execução, com contagem
por competência, delta, causa, as duas razões de o conserto não as alcançar e o
comando para reencontrá-las (`--desde 2026-04`).

**Teto tolerado.** A Promotiva declara 6,00 (o teto do à-vista) onde a nossa
coluna traz a célula da TRP. Não é erro de faixa — `TETO` é reportado e não
derruba o portão. Reprovam `FAIXA` e `INVERSA`.

**Tolerância de 0,01 pp.** Os dois lados chegam ao percentual por caminhos
diferentes (a gestora carimba já arredondado; a nossa coluna passa por ponto
flutuante). Diferença na terceira casa é arredondamento, não faixa.

> **Ressalva honesta:** não encontrei nenhum caso de 2,5199 × 2,52 na base. A
> menor diferença real entre as 35 divergências de faixa é **0,0200 pp**
> (0,79 × 0,81, quatro linhas), então a tolerância de 0,01 é **no-op hoje** —
> antes (0,005) e depois (0,01) o portão acha as mesmas 35. É guarda para o
> futuro, com margem de 2x abaixo do menor sinal verdadeiro. Se um dia a TRP
> tiver células a menos de 0,02 pp de distância, esta tolerância precisa cair.

**Provado que reprova** (`--provar-falha`, injeção só em memória):

```
com injecao : 2026-06  661 conferidas  86 divergem  FAIXA 9  exit 1
              INJECAO ARTIFICIAL ATIVA: proposta 212729295 (2026-06, RR ALAGOAS 1):
                                        coluna 2.44 -> 1.44 SO EM MEMORIA (Promotiva 2.44)
sem a flag  : 2026-06  661 conferidas  85 divergem  FAIXA 8  exit 1
piso padrao : 0 conferidas, exit 0, com o ESTADO_CONHECIDO impresso
```

+1 e −1 exatos. O banco não é tocado, então não houve o que restaurar.

---

## Bloco 3 — NÃO-ACHADO: não há lacuna de matriz. NÃO REABRIR.

Levantou-se a hipótese de que as linhas com comissão-empresa zero escondiam uma
**lacuna de matriz** — células que deveriam existir e a busca não acha. **A
hipótese foi testada e é falsa.**

A matriz do INSS tem célula para 48..60, e é aí que a pergunta se resolve:

```
### 2026-04
  INSS_NOVO          prazo_min_cat=   -  celulas( 3): 48..60  61..84  85..999
  INSS_RENOV         prazo_min_cat=   -  celulas( 3): 48..60  61..84  85..999
```

Separando as 83 linhas sem célula por prazo:

```
  prazo 48..60 (LACUNA real) ....... 0 linhas   R$ 0,00
  prazo < 48 (piso legitimo) ....... 79 linhas   R$ 367.488,50
  prazo > 60 ....................... 4 linhas   R$ 54.524,33

  >>> NAO HA LACUNA abaixo de 61: todas sao piso. O assunto ENCERRA.
```

**Zero linhas entre 48 e 60.** Nenhuma falha de busca. As 79 abaixo de 48 são
**piso de elegibilidade**: a matriz começa em 48 e abaixo disso não há comissão
devida. As 4 de prazo > 60 não são INSS e ficam fora da pergunta:

```
  206249535  2026-04  2881 conv=000096801 taxa=1.72 prazo=120  R$ 22.500,00  PUBLICO_GERAL
  213588492  2026-06  2881 conv=000096801 taxa=1.72 prazo=120  R$ 12.900,00  PUBLICO_GERAL
  220190366  2026-07  2882 conv=000644473 taxa=1.46 prazo= 61  R$ 11.124,33  PRIVADO
  213994048  2026-06  2997 conv=000000000 taxa=1.49 prazo= 72  R$  8.000,00  AUTOMATICO_SALARIO_BENEFICIO
```

**Comissão devida: R$ 0,00 nos dois grupos.** Nenhuma célula cobre o prazo e
nenhum valor foi estimado.

Contexto do universo maior, para quem reabrir: das 111 linhas em Produção com
comissão-empresa zero (R$ 485.392,07), **28 têm piso declarado pela régua**
(ADIANTAMENTO_13 prazo < 5, SIAPE prazo < 48, tx_juros_min) e as outras **83 são
as acima**. Nenhuma é lacuna.

Reproduz: `npx tsx scripts/diag-inss-48-60.mts`.

---

## Bloco 4 — resíduos

### (a) O `null` do `bbtsClosingImport` não alcança porque o merge o remove

`bbtsClosingImport.ts:368-369` e `:459-460` gravam
`insurance_commission_amount: null` e `insurance_commission_percent: null`.

Não chegam por causa de `lib/dailyRecordMerge.ts:133-138`:

```ts
export const DERIVED_NEVER_UPDATED = new Set([
  "promoter_commission_percent",
  "promoter_commission_amount",
  "insurance_commission_percent",
  "insurance_commission_amount",
]);
```

filtrado em `ownedColumnsFor` (`:202`):

```ts
  return cols.filter((k) => !DERIVED_NEVER_UPDATED.has(k));
```

**É o merge protegendo — mas só no UPDATE.** No caminho de INSERT (`:258-264`) o
registro é gravado inteiro:

```ts
      for (const [k, v] of Object.entries(rec)) if (!CONTROL_KEYS.has(k)) full[k] = v;
```

Ou seja: linha **existente** fica protegida; linha **nova** nasce com os nulls.
As 3 da ADS estão preenchidas porque já existiam quando o fechamento passou.
A guarda chegou em `4ef56dc`.

### (b) A tela é `/promotores`, e já foi resolvida

`lib/promoterAnalytics.ts:1172-1175`:

```ts
  // Mês FECHADO consolidado (closedSource): esses agregados vêm do PMR, não do
  // daily. Zera aqui — senão a produção master do daily (inclui a SRCC não flagada)
  // vazaria no productionTotal e infla. No fechamento não há órfão (herança resolve).
  if (!closedSource) {
```

Em mês fechado o laço sobre `recordsForPeriod` não roda, e `summaryRows` fica no
ramo `CALCULATED` (PMR/cms). Resolvido em **`b4dac2a`** — *"feat(virada):
/promotores lê a fonte fechada no mês fechado (fechamento+bbts)"*.

---

## O que fica em aberto

- **As 4 linhas INVERSA** de 04/2026 (nossa coluna MAIOR que a da Promotiva,
  −R$ 64,25). Estão no `ESTADO_CONHECIDO` do portão, mas o motivo **não foi
  investigado**. É a única das três categorias sem explicação.
- **O curto-circuito** de `getPersistedCompanyReceivedPercent:118-121` continua:
  consertar o derive não alcança linha com a coluna já gravada. Hoje isso é
  proteção (mês fechado), mas é também o motivo de o conserto não se propagar.

---

## Como reproduzir

```
npx tsx scripts/medida-derive-grupo.mts            # antes x depois do conserto do derive
npx tsx scripts/probe-regime-2026.mts              # o regime real de cada competencia
npx tsx scripts/gate-avista-vs-fechamento.mts      # o portao (piso 2026-07)
npx tsx scripts/gate-avista-vs-fechamento.mts --desde 2026-04     # as 35 historicas
npx tsx scripts/gate-avista-vs-fechamento.mts --desde 2026-06 --provar-falha
npx tsx scripts/diag-zero-piso-vs-lacuna.mts       # as 111 linhas com comissao zero
npx tsx scripts/diag-inss-48-60.mts                # a matriz da TRP e a separacao por prazo
```
