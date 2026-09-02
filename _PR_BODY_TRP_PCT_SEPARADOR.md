# O parser da TRP lê o percentual com VÍRGULA e com PONTO

> Arquivo descartável — existe só para o corpo do PR não passar pelo terminal.
> Some no merge.

**Decisão do Diego (02/09/2026):** não é caso especial da TRP40 — é o formato que
o documento pode usar, e o sistema tem de ler os dois.

Commit único: `0427099`.

---

## O defeito é de LINHA MISTA, não de arquivo

Na TRP40 as duas grafias convivem **na mesma linha**: a coluna de taxa vem com
vírgula e as cinco colunas de faixa vêm com ponto.

```
"1,75% a 1,77%  0.83% 0.83% 0.89% 0.89% 0.89%"
"a partir de 2,48%  9.54% 9.54% 10.23% 10.23% 10.23%"
```

Medido no PDF: **62 linhas com vírgula, 24 com ponto**. Com o parser só-vírgula,
`pctsIn` achava 2 percentuais numa linha que precisava de 5, a linha era descartada
em silêncio e três grupos saíam **vazios** — `CONSIG_PUBLICO`, `CONSIG_SP_MG` e
`NAO_CONSIGNADO`. O upload inteiro reprovava:

```
TrpParseError: o PDF parece ter sido lido errado: produtos ausentes/vazios
  sem matriz para: CONSIG_PUBLICO, CONSIG_SP_MG, NAO_CONSIGNADO (achei 11/11)
```

---

## 1. O tratamento é no SÍTIO — são 8, em 2 arquivos

Todos passaram a consumir a régua única `lib/trp/pctTrp.ts`, que nasce neste PR.
Ninguém mais reimplementa a forma nem a conversão.

| # | arquivo | o que lia percentual | como estava |
|---|---|---|---|
| 1 | `parseTrpPdf.ts` | o achador da matriz | `PCT = /(\d+,\d+)%/g` |
| 2 | `parseTrpPdf.ts` | o conversor | `pctToDec()` local |
| 3 | `parseTrpPdf.ts:152` | apaga o pct consumido da linha | `non.replace(p + "%", "")` — segue o casado, coberto de graça |
| 4 | `parseTrpDraft.ts` | o conversor | **SEGUNDA CÓPIA** de `pctToDec()` — eliminada |
| 5 | `parseTrpDraft.ts` | `parseTxRange`, faixa fechada | `(\d+,\d+)%\s*a\s*(\d+,\d+)%` |
| 6 | `parseTrpDraft.ts` | `parseTxRange`, faixa aberta | `A partir de\s*(\d+,\d+)%` |
| 7 | `parseTrpDraft.ts` | a máscara do `parsePrazoRange` | `token.replace(/\d+,\d+%/g, " ")` |
| 8 | `parseTrpDraft.ts` | o lookahead do prazo | `(?!\s*,)` → `(?!\s*[.,])` |

O sítio 8 não é zelo: prazo é **inteiro**. Sem ele, com o ponto aceito e a máscara
falhando, `"A partir de 1.90%"` daria `prazo_min = 1`.

**Não tocados, de propósito, e dito no código:**

- `tiqueteToNumber` — é **R$**, não %. Tem `.replace(/\./g,"")` porque para dinheiro
  o ponto *é* milhar. Mexer ali seria trocar uma decisão correta por outra.
- `PRAZO_ISOLADO` — ancorado em `^…$`, e um percentual sempre carrega o `%`.
  Não alcança.

---

## 2. A ambiguidade do milhar — decidida, e escrita no código

Está no cabeçalho de `lib/trp/pctTrp.ts`, com o porquê de cada degrau. Três
degraus, **todos barulhentos** — o parser nunca adivinha em silêncio:

**(a) Teto semântico.** Percentual de TRP nunca chega a 100. Qualquer leitura
`>= 100` é **RECUSADA** (lança), nunca "normalizada" tirando o separador.
Normalizar seria silencioso e gravaria régua errada; recusar é barulhento e o
sócio corrige antes de gravar.

**(b) Forma ambígua → LANÇA.** `1.234` é milhar-válido (1–3 dígitos, ponto,
exatamente 3 dígitos) **e** decimal-plausível ao mesmo tempo: as duas leituras são
defensáveis e escolher uma seria chute.
`10.23` **não** é ambíguo — 2 casas não formam grupo de milhar, então só a leitura
decimal existe, e ela passa em (a) com folga.

**(c) Duas formas no mesmo token** (`1.234,56`) não é percentual de TRP — seria
> 1000. Não casa a forma canônica e lança por forma não reconhecida.

O degrau (a) é o que faz o (b) ser conservador em vez de tímido: mesmo que a régua
de (b) deixasse passar uma leitura de milhar, o teto de 100 a pegaria. **São duas
redes, não uma** — e o bloco F3 do portão prova qual delas está segurando.

O `TrpPctError` vira `TrpValidationError` em `comoErroDeRegua()` e sai como **422
visível** na rota. Nada de meia-régua, nada de valor adivinhado.

---

## 3. A conferência NÃO afrouxou

A lição dos três layouts da BBTS vale aqui: **aceitar mais forma de VALOR não
aceita mais forma de LINHA.** Ficaram intactos, sem uma linha de diff:

- `PROD_ANCHORS` (as 11 âncoras de produto), `STOP`, `HDR`
- `MAX_PLAUSIVEL` (0,15), as 5 faixas completas por linha, os 11 produtos obrigatórios
- `validarProdutos`, `validateRegraDraft`

O **bloco E** do portão cobra os dois lados: percentual com ponto fora de seção de
produto continua ignorado, e linha de faixa incompleta continua reprovando — com
ponto **e** com vírgula, para a guarda não virar seletiva.

---

## 4. Não-regressão MEDIDA — as 5 TRPs que já estão no banco

`buildTrpDraft` rodado sobre os PDFs reais, antes e depois, comparando o
`regraDraft` **e** a lista `conferir` (sha-256 dos 12 primeiros dígitos):

| TRP | antes | depois | |
|---|---|---|---|
| TRP35 2026-04 | `eff348393175` | `eff348393175` | IDÊNTICA |
| TRP36 2026-05 | `9593380b3f66` | `9593380b3f66` | IDÊNTICA |
| TRP37 2026-06 | `536f7fca0105` | `536f7fca0105` | IDÊNTICA |
| TRP38 2026-07 | `f8d206a31af8` | `f8d206a31af8` | IDÊNTICA |
| TRP39 2026-08 | `ab022f56aba0` | `ab022f56aba0` | IDÊNTICA |

**0 / 5 com qualquer diferença.** 195 pct em cada, dos dois lados. Medido três
vezes: no conserto, depois do `String.raw`, e de novo depois do registro no runner
(o registro mexe no runner).

E a TRP40:

```
ANTES : TrpParseError — sem matriz para CONSIG_PUBLICO, CONSIG_SP_MG, NAO_CONSIGNADO
DEPOIS: OK, 195 pct — 9, 9 e 6 celulas nos tres grupos

CONSIG_PUBLICO, 1a celula: {"tx_min":0.0175,"tx_max":0.0177,
                            "Faixa 1":0.0083, ... }
CONSIG_PUBLICO, ultima   : {"tx_min":0.0248,"tx_max":999,
                            "Faixa 3":0.1023, ... }   <- o "10.23%"
```

---

## 5. A regressão que essa medição pegou — e por que virou o bloco 7

A **primeira** versão deste conserto montou as regexes de taxa com template
literal **cru**. Em template literal, `` `\s` `` avalia para `"s"`: as regexes
viraram `(...)%s*as*(...)%` e pararam de casar **em silêncio**.

O estrago não foi na TRP40, o alvo do conserto. Foi nas **cinco TRPs antigas, que
já estão no banco**:

- `celulas_taxa_prazo` virou `celulas_prazo` em 8 produtos;
- `tx_juros_min` **sumiu** de `INSS_RENOV` e `ADIANTAMENTO_13` — é o piso de taxa
  da categoria; sem ele o gate B do motor para de barrar contrato fora da faixa;
- o `CONSIG_PRIVADO` passou a acusar "herança de prazo NÃO validada".

**O `tsc` ficou verde** (a expressão é válida, só significa outra coisa) e o olho
não pegou. Quem pegou foi a medição do item 4. `String.raw` resolveu.

Medir os 5 PDFs é caro e depende de arquivo fora do repo. Por isso o **bloco 7**
assere as duas regexes **direto**, com fixture: se alguém trocar `String.raw` por
template literal cru, o portão derruba na hora, no CI, sem PDF nenhum. As duas
regexes passaram a ser exportadas exatamente para isso, com o motivo escrito
acima delas no arquivo.

**Medido:** com o `String.raw` desfeito no fonte, o bloco 7 derruba **7 asserções**
e os outros 6 blocos ficam **todos verdes** — sem esse bloco a regressão passaria
calada pelo portão inteiro.

---

## 6. O portão — `scripts/trp_pct_separador_gate.cjs`

**Self-contained**, registrado no `run_all_gates.cjs`, roda no CI.

Fixture **sintética** (números inventados) porque **o repo é público e nenhum PDF
da TRP está versionado** (`stress_test_workspace_local/*` é gitignored). É por isso
que o `buildTrpDraft` foi partido em `buildTrpDraftFromLines` — *extrair + delegar*,
sem lógica duplicada e **sem ramo "de teste"**: a fixture exercita o montador real,
o mesmo do upload, com matriz + taxa + prazo + escalares + validações.

Uma tabela só, renderizada duas vezes, com a coluna de taxa **sempre em vírgula** e
a de faixa no separador variável — a mistura exata da TRP40. Isso torna o bloco B
forte: não é "o ponto também parseia", é "o ponto produz a **mesma** régua".

### Os 7 blocos

| | assere |
|---|---|
| A | vírgula continua — 11 produtos, valor a valor |
| B | ponto passa, e a régua é **idêntica** à da vírgula (`conferir` incluído) |
| C | `>= 100` **reprova** — no token e dentro da matriz; e `99,99` continua passando |
| D | `1.234` **lança**; `10.23` passa; `1,234` com vírgula segue lendo 1,234% |
| E | as âncoras não afrouxaram (pct fora de seção ignorado; linha incompleta reprova) |
| F | mutação, três sentidos |
| G | as regexes de taxa **casam** — a lição do `\s` |

### A mutação, três sentidos

Sobre o **JS emitido** do próprio sítio, cada uma exigindo **alvo confirmado**
(`trocas > 0`, senão o portão **reprova** em vez de dar a mutação por feita —
mutação que não mutou nada é verde por vacuidade):

| | mutação em `pctTrp.js` | tem de acontecer |
|---|---|---|
| **F1** | `[.,]` → `[,]` (tira o ponto) | a fixture da **TRP40 cai**; a de vírgula segue de pé |
| **F2** | `[.,]` → `[.]` (tira a vírgula) | a fixture das **5 antigas cai** |
| **F3** | `PCT_MAX_EXCLUSIVO = 100` → `Infinity` | `1234.56` **passa** e vira 1234,56% |

O F3 é o que separa mérito de sorte: prova que quem recusa o absurdo é **o teto de
100**, e não o acaso de a fixture não conter um valor grande.

---

## Verificação

```
npm run gates       38 executados | 38 passaram | 0 falharam
                    (inclui o portao novo, a varredura do criterio
                     self-contained e a cobertura de tipagem dos gates)
npx tsc --noEmit    rc = 0
```

---

## Arquivos

| arquivo | |
|---|---|
| `lib/trp/pctTrp.ts` | **novo** — a régua única: forma, conversão, os três degraus da ambiguidade |
| `lib/trp/parseTrpPdf.ts` | sítios 1–3 passam a consumir a régua |
| `lib/trp/parseTrpDraft.ts` | sítios 4–8; `buildTrpDraftFromLines` extraído; `comoErroDeRegua` |
| `scripts/trp_pct_separador_gate.cjs` | **novo** — o portão, 7 blocos, mutação em 3 sentidos |
| `scripts/run_all_gates.cjs` | registro como `self-contained` |
| `_PR_BODY_TRP_PCT_SEPARADOR.md` | este arquivo, descartável |

## Fora de escopo, nomeado

`scripts/trp_parser_paridade.cjs` (paridade 195×3 contra os JSONs canônicos)
continua **órfão** — depende dos PDFs, que não estão versionados. Não foi tocado.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014Rkia4qvJ5QFHiFnAyEZzS
