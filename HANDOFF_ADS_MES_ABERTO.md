# Bloco B item 1 — a ADS não tinha casa no mês ABERTO

Frente de 29/07/2026, empilhada sobre `feat/o1-data-contratacao`. **Não pushada.**
Decisões do Diego registradas ao final (seções DÍVIDA A e DÍVIDA B).

---

## O defeito

`/promotores`, competência **aberta**, linhas da ADS: `% Promotor` e
`Comissão promotor` em **0,00% / R$ 0,00**, nos CARDS e na LISTA.

Causa — três portas, todas fechadas no mês vivo:

| porta | por que não servia |
|---|---|
| coluna `promoter_commission_amount` do diário | `/api/calculate/monthly` não escreve para a ADS (trava `semAds`, `route.ts:655`) |
| PMR com `source='bbts'` | o mês aberto ignora o PMR de propósito (`promoterAnalytics`, ramo LIVE_BASE) |
| PMR com `source='daily'` | é o que existe, mas é lixo do motor errado (jul/2026: R$ 4.622,92 × R$ 9.955,36 da régua certa) |

No mês **FECHADO** nada disso acontece: a rota desvia para
`buildClosingProposalRows` (`app/api/promotores/route.ts:253`) e o filtro de
regime passa a aceitar `'bbts'`. **Junho/2026 já estava correto** (19 linhas,
R$ 5.153,53) e continua intocado.

### A trava `semAds` NÃO é resíduo

Decisão do Diego, registrada em comentário no próprio `semAds`
(`app/api/calculate/monthly/route.ts:630-676`): a ADS nasceu como **pipeline
próprio e paralelo** ao RR — diária BBTS, fechamento em 2 PDFs, régua própria
(`bbts_rule_versions`), consolidação própria (`consolidateMonthlyFromBbts`).
`calculate/monthly` é o motor da **Promotiva**; a trava impede que ele calcule
sobre dado que não é dele. **O que faltava nunca foi remover a trava — era o
caminho ADS ter o equivalente do que o RR tem.** É o que esta frente entrega,
do lado da LEITURA.

## O conserto

`lib/bbtsOrchestrator.ts` passa a expor `ads_detalhe` (por proposta + por
promotor). `lib/promoterAnalytics.ts` monta `adsCreditoPorContrato` a partir de
uma consolidação em **dry-run** (nunca grava) e usa `creditoAdsDaLinha` nos
**dois** consumidores: o card (`summaryRows`) e a linha (`proposalRows`).

Exatidão, não rateio: `comPromotorCredito = comEmpAvista × acordo` com o acordo
**uniforme por promotor** (`bbtsMonthly:336`), então por linha é
`comEmpresa_linha × acordo` — decomposição exata da própria soma.

Custo medido: ~6,5-7 s por consolidação, memoizada 5 min sob a chave
`promoters:ads-credito:<comp>`. **O prefixo não é decorativo:** todo invalidador
do sistema limpa por prefixo (`clearMemoryCache("promoters:")`), chamado por
`/api/import/daily:650`, `/api/import/closing/ads:65`, `/api/calculate/monthly:700`
e `/api/pmr/reconsolidar:41`. Chave fora desses prefixos nunca seria invalidada.

## Medição (antes × depois, mesmo script via `git stash`)

```
PARIDADE — o que não podia mudar
  linhas do RR, julho ....... 46 promotores, R$ 96.447,50 -> R$ 96.447,50   0 divergências
  junho fechado ............. 9 promotores,  R$  5.153,53 -> R$  5.153,53   byte-idêntico

ADS julho/2026 (mês aberto)
  linhas .................... 41
  linhas exibindo valor ..... 0 -> 37   (as 4 restantes não têm crédito: só-seguro,
                                         gross 0, ou TRP 0 por prazo — o motor zera)
  comissão promotor LISTA ... R$ 0,00 -> R$ 9.955,36
  comissão promotor CARDS ... R$ 0,00 -> R$ 9.955,36

INVARIANTE: Σ linhas por promotor == PMR que o BBTS-2d gravaria
            diferença 1,8e-12 (float puro)
```

Nota de universo: eram 35 linhas na medição do Bloco A e são 41 aqui — **6 linhas
ADS de julho foram criadas em 29/07**, durante a sessão. O dado cresceu; não é
divergência de método.

## Herdam o conserto (mesma fonte, `proposalRows`)

`app/promotores/PromotorView.tsx:219,358` · `lib/report.ts:705,711,1028,1458,1464`
(PDF e XLSX do promotor). **Não medidos** — vão no gate.

---

# DÍVIDA A — o PMR de julho da ADS está podre (transitório POR CONSTRUÇÃO)

**DECISÃO (Diego, 29/07/2026): NÃO gravar o PMR de julho agora.**

Estado hoje: 8 linhas para 10 promotores, `source='daily'`, calculadas em
**2026-07-20 14:54**, somando R$ 4.622,92. A régua certa (BBTS-2d em dry-run)
dá **R$ 9.955,36** e cobre os 10 promotores.

Por que não gravar: julho fecha nos primeiros dias úteis de agosto e o
`bbtsOrchestrator` roda no fechamento. Gravar agora um valor de mês aberto que
será sobrescrito é **escrever para descartar**, e derruba a `/metas` no intervalo
(ver DÍVIDA B). O PMR podre de julho é transitório por construção.

### ⚠️ O QUE CONFERIR DEPOIS DO FECHAMENTO DE AGOSTO

**Se o orquestrador NÃO rodar no fechamento, o PMR fica podre de forma
PERMANENTE** — e aí deixa de ser transitório e vira número errado exibido.

Checagem (uma linha de SQL):

```sql
select promoter_id, source, production_commission_value, calculated_at
from promoter_monthly_results
where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'  -- ADS
  and year = 2026 and month = 7;
```

- `source = 'bbts'` nas 10 linhas → OK, o orquestrador rodou.
- `source = 'daily'` sobrando → **NÃO rodou**; rodar
  `consolidateMonthlyGroup({year:2026, month:7, dryRun:false})` ou
  `/api/pmr/reconsolidar`.

Consumidores que passam a mostrar número errado se ficar `'daily'`:

| arquivo:linha | o que mostra errado |
|---|---|
| `app/api/metas/route.ts:88-93` | produção ADS **some** (ver DÍVIDA B) |
| `app/api/dashboard/route.ts:299-303` | produção/segurado do grupo subestimados |
| `lib/projecaoMetas.ts:204` | série histórica com julho baixo |
| `lib/dre.ts:481` | comissão do DRE |
| `lib/equipe/teamProduction.ts:726` | produção do time |
| `lib/financialAnalytics.ts:469` | receita |
| `lib/report.ts:2169` | relatório do promotor no mês fechado |
| `lib/diagnostico/ledgerHealth.ts:120` | o vigia não acusa (é a fonte dele) |
| `lib/trp/detectorReguaObsoleta.ts:95,167` | `trp_version_id` da linha errada |
| `lib/produtoAssignments.ts:297,354` | base dos produtos |
| `app/api/commissions/proposals/route.ts:242,387` | penetração/seguro |
| `lib/promoterAnalytics.ts:923` | cards, **depois** que julho fechar |

---

# DÍVIDA B — `/metas` e o filtro por `source`

**DECISÃO (Diego, 29/07/2026): `/metas` continua lendo a diária.** Ela mostra
produção de **mês aberto** e deve refletir o que a diária diz; trocar por PMR
fecharia a mesma porta que esta frente está abrindo.

### A mecânica exata (`app/api/metas/route.ts:61-63`)

```ts
const regimeSources =
  regime === "cms" ? ["cms"] : regime === "open" ? ["daily"] : ["fechamento", "bbts"];
```

Precisão importante: **em competência FECHADA o filtro JÁ aceita `'bbts'`.** A
cegueira é no mês ABERTO, onde só `'daily'` entra.

O efeito que o Diego descreveu — *"em competência fechada a produção ADS some da
/metas"* — **está correto, mas a causa é a DÍVIDA A, não o filtro**: quando julho
fechar, `regimeSources` passa a `['fechamento','bbts']`; se as linhas da ADS ainda
estiverem com `source='daily'` (orquestrador não rodou), elas ficam **fora do
filtro** e a produção ADS desaparece da `/metas`.

**Consequência prática: as DÍVIDAS A e B colapsam numa única verificação** — a
checagem de `source` após o fechamento de agosto cobre as duas. Se o source virar
`'bbts'`, `/metas` volta a enxergar a ADS sozinha, sem nenhuma mudança de código.

Fica registrado o resíduo independente: no mês ABERTO, uma linha legítima com
`source='bbts'` (se alguém rodar o orquestrador fora do fechamento) seria
**invisível** para `/metas`. Hoje é inócuo — ninguém roda o BBTS-2d em mês aberto.

---

# Órfãos nomeados desta frente

| arquivo:linha | estado |
|---|---|
| `app/comissoes/editar` + `app/api/commissions/proposals/route.ts:42,480,526` | seguem lendo a coluna crua. **Latente, não vivo:** a rota filtra `.eq("status","Produção")` (com acento) e a ADS grava `"Producao"`/`"PRODUCAO"` — linha ADS nunca chega nessa tela. Se alguém normalizar esse filtro, a tela nasce zerada |
| divergência tela × PMR | a tela passa a mostrar R$ 9.955,36 e o PMR de julho guarda R$ 4.622,92. No mês aberto o PMR não paga, mas os dois números discordam até o fechamento resolver (DÍVIDA A) |
| `lib/report.ts` PDF/XLSX | herdam o conserto por consumirem `proposalRows`, mas **não foram medidos** |
