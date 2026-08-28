# HANDOFF — feat/residuo-financeiro (27/08/2026)

Três resíduos do fechamento da ADS, mais uma investigação de seguro do RR que
consumiu a maior parte da frente e terminou sem buraco.

> **Como ler este documento.** Todo número aqui foi medido por consulta ou execução,
> e o script que o produziu está nomeado. Onde a medição contradisse o que se
> acreditava, a contradição está registrada — inclusive quando o que se acreditava
> era meu. A seção 8 lista o que eu corrigi em relação ao ditado deste handoff.

---

## 1. ESTADO DA RAMIFICAÇÃO

**Branch:** `feat/residuo-financeiro`, criada de `origin/main` em `5221676`
(que já continha a PR #157, confirmada por `git log --grep`: merge `5b95ac4`).

**Nada foi pushado.** Os 15 commits estão só local.

| commit | entrega |
|---|---|
| `1212c1f` | captura da Abertura de Conta: `extractCabecalhoNf`, pareamento rótulo↔valor por geometria + identidade da soma |
| `bf7b65c` | linha só-seguro grava `bbts_seguro_pago`; import só-crédito para de zerar as colunas de seguro; rota exige confirmação |
| `b30c6a2` | `lib/diagnostico/fechamentoParcial.ts` — os checks do "que não chegou", consumidos pelo `ledgerHealth` |
| `6e471b7` | seed do cabeçalho (superseded pelo `1f9ad19`) |
| `b4b4f50` | 1ª medição do seguro do RR: 3 de 100 sem linha |
| `80c5059` | SQL do Bloco 2 (o UPDATE dos R$ 89,42) |
| `9a144e8` | re-investigação do RR contra os arquivos originais |
| `164d2f0` | BLOCO A: o seguro está em duas colunas e as duas são lidas |
| `f6ae3d8` | panorama do seguro por ano |
| `470a99e` | **a varredura das 100** — 1 divergência real |
| `bbc06c9` | a lição da varredura tardia + errata do item 4 |
| `5b45862` | pós-UPDATE do R$ 89,42 e o estorno não abatido |
| `2d9772f` | âncora permanente (`ads_ancora_totais`) |
| `1f9ad19` | alinhamento à tabela REAL `bbts_fechamento_totais` |
| *(este)* | handoff |

**Arquivos de produção tocados:** `lib/bbtsPdfExtract.ts`, `lib/bbtsClosingImport.ts`,
`lib/dre.ts`, `lib/financialAnalytics.ts`, `lib/diagnostico/ledgerHealth.ts`,
`lib/diagnostico/fechamentoParcial.ts` (novo), `app/api/import/closing/ads/route.ts`.
`npx tsc --noEmit` limpo.

---

## 2. O QUE FOI FEITO, E O QUE FOI SÓ ENTREGUE

### FEITO — tabela `bbts_fechamento_totais` (migration rodada no Studio)

Criada por você em 27/08. Lida do schema **antes** de eu tocar em código:

```
colunas (11): id, company_id, competencia, pagamento_avt, pagamento_prt,
              abertura_conta, glosa, pagamento_total, arquivo_origem,
              created_at, updated_at
única: (company_id, competencia)
```

Difere do que eu propus (`bbts_fechamento_cabecalho`, com `outras_deducoes`,
`source_filename` e `rotulos`). O código foi adaptado ao que existe; a migration
`20260827_000001` foi reescrita para descrever o banco real.

**Duas perdas nomeadas, não abertas:**
- `glosa` é nome FIXO para uma coluna de rótulo VARIÁVEL ("Valor Descontado" em
  06/26, "Glosa" em 07/26). A captura pareia por rótulo, então ler não quebra — mas
  se a BBTS trouxer as duas como colunas separadas, caem somadas e a distinção se
  perde **sem a identidade da soma acusar**.
- Sem coluna `rotulos`, o layout que produziu cada número não fica registrado.
  `alter table bbts_fechamento_totais add column if not exists rotulos jsonb;`

**Para que a tabela serve:** até agora o `pagamento_total` era usado como âncora de
importação e **descartado** — a conferência acontecia uma vez e morria ali. Com o
declarado gravado, ela vira permanente (§3).

### FEITO — a captura, pareando rótulo com valor

`extractCabecalhoNf` em `lib/bbtsPdfExtract.ts`. Geometria (ordinal quando as
contagens batem, `|Δx|` como plano B), validada pela identidade da soma:

```
2026-06   AVT 7.707,03 + PRT 7,01 + Abertura   0,00 + "Valor Descontado" 0,00 =  7.714,04  FECHA
2026-07   AVT 18.737,33 + PRT 7,01 + Abertura 100,00 + "Glosa"           0,00 = 18.844,34  FECHA
```

Ler por posição não serve (o próprio código já admitia mês sem coluna PRT); ler por
nome fixo não basta (o 4º rótulo mudou). E o pareamento ingênuo "rótulo à esquerda
do valor" morre em 07/26, onde "Glosa" começa em x=565,1, à **direita** do seu
próprio valor (x=562,6). Se o pareamento errar, a identidade quebra e o extrator
**lança** em vez de gravar número plausível.

### FEITO — o UPDATE dos R$ 89,42

Aplicado por você. Conferido depois:

```
id=5240028e-464b-428a-870d-86576c31dfc6  prop=221262790
movement_date=2026-07-15  bbts_seguro_pago=89.42
linhas ainda NULL no predicado: 0
```

O bruto de seguro da ADS em julho passou a **R$ 204,52**, que é a soma das 13 linhas
`tratamento='calculo'` do PDF. A identidade fecha:

```
204,52 (bruto) − 49,45 (3 cancelamentos, em promoter_debits) = 155,07 = âncora TOTAL do PDF
```

### FEITO — a âncora de conferência

`scripts/diag-residuo-37-ancora-totais.cjs`, declarado no PDF × soma das linhas
gravadas, para **as 2 competências que existem em disco**:

```
comp     | AVT declarado   AVT nas linhas  delta | PRT declarado  PRT linhas  delta
2026-06  |      7.707,03         7.707,03   0,00 |         7,01       7,01    0,00  BATE
2026-07  |     18.737,33        18.737,33   0,00 |         7,01       7,01    0,00  BATE
>>> BATEM: 2   DIVERGEM: 0
```

E o check permanente `ads_ancora_totais` em `fechamentoParcial.ts` faz a mesma
comparação a qualquer momento, contra o declarado gravado.

### **NÃO FEITO** — o backfill, e portanto a Abertura no card

Medido em 27/08, última verificação da frente:

```
=== bbts_fechamento_totais: 0 linhas  (a tabela INTEIRA, sem filtro) ===
=== receivedClosing 2026-08 AGORA: 318.685,68 ===

A LINHA DA ADS na matriz de ENTRADA, célula a célula:
  avista 18.737,33 | prt 7,01 | seguro 204,52 | consorcio 0,00 | outros 0,00 | ajustes 0,00
  Σ das células = 18.948,86  |  total da linha = 18.948,86  -> FECHA
```

**A tabela está vazia.** O SQL do backfill existe
(`supabase/migrations/20260827_000004_bbts_totais_backfill.sql`, 2 competências,
âncora já conferida no cabeçalho) e **não foi executado**. Sem ele:

- `outros` da ADS = `0,00` — a Abertura não está em coluna nenhuma **nem no total**
- `receivedClosing` de ago/26 = **318.685,68**, não 318.696,26

A matriz **não está quebrada**: Σ das células = total da linha, ao centavo, e não há
chave em `celulas` sem coluna declarada. O zero é o valor correto da origem vazia.

**Depois de rodar o backfill, o esperado é:** `outros` = 100,00 · total da linha =
19.048,86 · `receivedClosing` = **318.785,68** · `ads_cabecalho_nf_ausente` = 0 ·
`ads_ancora_totais` = 0.

---

## 3. A DIFERENÇA CONTRA O EXTRATO — a conta completa

```
DEPÓSITO DECLARADO pela BBTS em 07/2026 : 18.999,41
   = 18.844,34 ("Pagamento Total" do PDF de crédito)
   +    155,07 (âncora TOTAL do PDF de seguro = 204,52 de cálculo − 49,45 de cancelamento)

O SISTEMA, competência 2026-07
   hoje                : 18.948,86   →  diferença  −50,55
   após o backfill     : 19.048,86   →  diferença  +49,45
```

Os R$ 139,97 originais eram `100,00 (Abertura) + 89,42 (só-seguro) − 49,45
(cancelados)`, válidos quando **nenhum** conserto estava aplicado. O UPDATE já
consumiu os 89,42, o que deixou a diferença de hoje em `139,97 − 89,42 = 50,55`.
Somar os 100,00 leva a `50,55 − 100,00 = −49,45`: o sistema passa a mostrar
**49,45 a mais** que o depósito.

**Não sobram R$ 39,97.** O residual é `+49,45`, e são os cancelamentos — que por
decisão anterior não abatem receita (§4).

---

## 4. O ESTORNO NÃO ABATIDO — desenho, quantificado

Medido, contra a crença de que o DRE lê a régua:

```
lib/dre.ts:348   receitaAds += toNum(r.bbts_pag_avista) + toNum(r.bbts_seguro_pago);
grep insurance_commission_amount lib/dre.ts  ->  ZERO ocorrências
```

A premissa está certa numa metade: **os dois lados usam colunas diferentes**. O
repasse ao promotor sai de `insurance_commission_value` do PMR
(`financialAnalytics.ts:806, 1422`); a receita sai da coluna da BBTS. Mas a receita
é **bruta** e o estorno não é subtraído:

```
comp      seguro BRUTO no DRE   estorno em promoter_debits   líquido real
2026-06                97,54                         0,00          97,54
2026-07               204,52                        49,45         155,07   <<<
```

`bbts_seguro_pago` só guarda positivo (0 linhas negativas em todo o banco); as
linhas `tratamento='debito'` viram `promoter_debits`. A lógica fecha **se** o débito
for cobrado: empresa recebe 155,07 da BBTS e recupera 49,45 do promotor. Os três
estão `status=ACTIVE`, não aplicados. Se algum for perdoado, o card fica 49,45 acima
do que entrou, permanentemente.

**Não mexi** porque `financialAnalytics.ts:455` traz o bloco
`GRANDEZA DO CARD "Recebido" — HISTÓRICO DE DECISÕES. NÃO REABRIR SEM O DIEGO`, e
essa é a decisão que estaria sendo reaberta.

---

## 5. PENDENTE

1. **Rodar o backfill** (`20260827_000004`). É o que falta para a Abertura entrar.
2. **Abertura na matriz: "Outros" ou coluna própria.** Hoje está em `outros`, a
   mesma célula que agrega Conta Corrente/BBCAP/Dental/LOB do RR. Decisão sua.
3. **BLOCO 3 — implementado, nunca exercitado em produção.** Está no commit
   `bf7b65c` e medido: `ownedColumnsFor(FULL, registro SEM seguro)` toca **0**
   colunas de seguro (antes 5), e a rota devolve 409 com o dano medido na hora
   (hoje: 12 linhas, R$ 115,10 de `bbts_seguro_pago` e R$ 113.345,57 de
   `insurance_value`). O que nunca aconteceu foi um import real só-crédito
   passando por esse caminho.
4. **Os +49,45** contra o extrato — §4, decisão de negócio.
5. **R$ 372,31 em 2025-02 AL1** — §6.
6. **Dívida nomeada:** a rota de cancelamento
   (`app/api/import/closing/cancel/route.ts:49-56`) apaga
   `monthly_closing_entries` sem recompor `fechamento_mensal_empresa`. É a origem
   do item anterior e das 6.491 linhas de detalhe perdidas.

---

## 6. OS NÃO-ACHADOS — para ninguém reabrir

### O "buraco de seguro do RR" não existe

**A varredura foi das 100 competências-empresa**, não de 41
(`scripts/diag-residuo-32-varredura-100.cjs` — compara a coluna do arquivo contra as
linhas do banco **separadas por `sheet_name` de origem**):

```
74 batem ao centavo
18 divergem — 17 delas por CENTAVOS (−0,06 a +0,06), Σ = −0,09: arredondamento
 8 sem arquivo em disco (2026-04 e 2026-05 das 4 empresas)
```

**Divergência real: 1**, e não é zero:

```
2025-02 RR ALAGOAS 1   A Vista arq 2.549,61  bd 0,00
                       Seguro  arq   372,31  bd 0,00
```

Competência esvaziada por um cancelamento de import (`operacoes = 6491` prova que as
linhas existiram). O total está certo (`valor_seguro 2.549,61` dentro de
`valor_liquido 97.535,61`), mas os **R$ 372,31 da aba "Seguro" nunca entraram** no
`valor_seguro`. É o único dinheiro de seguro do RR fora do sistema.

### Os quatro números que circularam como buraco

| valor | procedência | o que era |
|---|---|---|
| R$ 10.102,33 | **medição minha** | artefato: o mesmo arquivo existe em `RRCRED/Relatório de Produção` **e** em `RRCRED/producao/Relatório de Produção`, e foi somado duas vezes. Retratado na mesma sessão. Deduplicado por nome, o delta é −0,01 |
| R$ 24.591,60 | mensagem do Diego | **nunca reproduzido.** Coincidência mais próxima: o total de 2023 inteiro, R$ 24.586,60, que já está no sistema (1.047 linhas) |
| R$ 128.128,20 | mensagem do Diego | **nunca reproduzido** |
| R$ 138.245,63 | mensagem do Diego | **nunca reproduzido** |

Nenhum deles foi diagnosticado como "contava linhas já gravadas" — três nunca foram
reproduzidos, então a causa deles permanece desconhecida. O único diagnosticado foi
o meu.

### O seguro do RR chega por DUAS fontes, e as duas são lidas

```
aba "A Vista", coluna COMISSÃO SEGURO  →  monthlyClosingImport.ts:1085-1098
                                          (toda linha CASH gera TAMBÉM uma entry INSURANCE)
aba "Seguro",  coluna COMISSÃO         →  inferSheetType (:154)
```

O banco registra a origem em `monthly_closing_entries.sheet_name`:

```
2026-06 RR ALAGOAS 3 — 91 linhas INSURANCE
  "A Vista "   81 linhas   Σ(+) 1.603,55   Σ(−)    0,00
  "Seguro"     10 linhas   Σ(+)     0,00   Σ(−) −113,06
```

**Teste de intersecção** (chave `CONTRATO` × `OPERAÇÃO`): **0 de 10** em jun/2026 e
**0 de 54** em jan/2026. Fontes independentes — a aba "Seguro" traz o *estoque*
(operações `189.682.047…199.375.071`, safras anteriores), a coluna da "A Vista" traz
a venda do mês (`206.958.579`+).

> **ARMADILHA:** fazer o importador "somar a coluna da A Vista junto com a aba
> Seguro" **duplicaria** o seguro. A coluna já é lida sempre. Em AL3/jun o
> `valor_seguro` iria de 1.603,55 para 3.207,10. **Não fazer.**

### As competências sem linha de seguro são 3, e não são de 2026

```
2023-09 RR ALAGOAS 1   valor_seguro=0,00   (Resumo declara: Comissão Seguros 170 | 0)
2023-12 RR ALAGOAS 1   valor_seguro=0,00   (Resumo declara: Comissão Seguros  87 | 0)
2025-02 RR ALAGOAS 1   valor_seguro=2.549,61  (entries apagadas por cancelamento)
```

As duas de 2023 são caso (a) provado pelo documento: quantidade > 0, **valor zero**.

**Em jan-mai/2026 as abas "Seguro" NÃO estão vazias** — jan/2026 AL3 tem 54 linhas
(45 positivas somando 44,02) e jan/2026 AL1 tem 249 linhas. Quem tem aba quase vazia
é jun/jul, onde ela traz só cancelamentos. Panorama:

```
ano   comps  com linha INSURANCE  sem linha   Σ valor_seguro   Σ linhas INSURANCE
2022      1                   1          0          416,85                   15
2023     12                  10          2       24.586,60                 1047
2024     19                  19          0       74.677,89                 4988
2025     40                  39          1      123.669,06                 9615
2026     28                  28          0       36.672,28                 3477
TOTAL   100                  97          3      260.022,68                19142
```

### O Resumo não arbitra nada nos arquivos de 2026

Template com as células de valor **vazias** (`C10 = "Comissão Seguros"`, `D10`
vazia). Por isso `readResumoTotals` devolve `null` e o `Object.assign` de
`monthlyClosingImport.ts:1560-1563` não roda — os totais vêm das entries. Nos
arquivos de 2023/2024 o Resumo TEM valor, e bate.

### Reimportar fechamento: o que sobrevive

- **sobrevive:** BBCAP/CONTA_CORRENTE/CONSORCIO (excluídos do delete); débitos da
  **ADS** (`.neq("company_id", BBTS)`); `bbts_seguro_pago` e `srcc_resolucao` da ADS
  (outra tabela); atribuições `ASSIGNED`; débitos de **2026-06** (17 linhas,
  R$ 899,21) — pela trava `DEBITO_AUTO_PRIMEIRA_COMPETENCIA = "2026-07"`
- **não sobrevive:** `monthly_closing_entries` da competência; débitos
  `CANCELAMENTO_SEGURO` de **2026-07** (16 linhas RR, R$ 370,85) — apagados e
  recriados

**Trava inoperante:** a 2ª guarda de `persistAutoInsuranceDebits` só protege
competência com parcela `APPLIED`. Não existe nenhum `CANCELAMENTO_SEGURO` APPLIED
em todo o banco — os 6 APPLIED são ADIANTAMENTO (5) e LIQUIDACAO_ANTECIPADA (1).

---

## 7. A LIÇÃO

Quatro números crescentes tratados como buraco medido — R$ 10.102,33 → R$ 24.591,60
→ R$ 128.128,20 → R$ 138.245,63. Nenhum sobreviveu. O que os derrubou foi uma
varredura exaustiva que levou **minutos** para escrever e rodar, e que veio na
**quinta** rodada de suspeita. Devia ter vindo na primeira. Cada rodada intermediária
produziu uma medição parcial que parecia confirmar e alimentou a seguinte com um
número maior.

O mesmo padrão se repetiu no R$ 89,42: cinco rodadas, e um `id` citado como
inexistente (`0dc42962-4bcc-4a55-af16-7c9483c1b41c`) que nunca apareceu em nada que
eu produzi — o `id` que eu reportei (`5240028e…`) sempre existiu e o predicado sempre
casou 1 linha. A consulta que resolveu tinha três linhas.

E aconteceu de novo **dentro** da última medição: a âncora acusou divergência de
R$ 7.707,03 em 2026-06. Era bug meu — o filtro montava `${comp}-31` à mão, e junho
não tem dia 31, então a janela devolvia zero linha em silêncio. Pego antes de virar
relatório, e corrigido com o porquê no comentário (`proxComp()`).

> **REGRA.** Diante de suspeita de dinheiro faltando, a **primeira** medição é a
> varredura exaustiva do universo inteiro, cruzando documento contra banco **pela
> chave de origem**. Amostra e soma agregada vêm depois, para explicar o que a
> varredura achar — nunca antes, para decidir se há o que achar.
>
> **COROLÁRIO.** Toda janela de data se monta pelo primeiro dia da competência
> seguinte, nunca concatenando `-31`.

---

## 8. O QUE EU CORRIGI EM RELAÇÃO AO DITADO DESTE HANDOFF

Registrado para você poder discordar com o número à vista:

| ditado | medido |
|---|---|
| "o backfill das competências em disco" | **não foi rodado** — `bbts_fechamento_totais` tem 0 linhas |
| "ago/26 foi de 318.596,26 para 318.696,26" | está em **318.685,68**; 318.596,26 era o valor **antes** do UPDATE do 89,42. Após o backfill: **318.785,68** |
| "a diferença caiu de 139,97 para 39,97" | hoje **−50,55**; após o backfill **+49,45** — inverte o sinal |
| "varredura de 41 competências" | foram **100**: 74 batem, 18 divergem (17 por centavos), 8 sem arquivo |
| "bateu ao centavo / buraco zero" | **1 divergência real: R$ 372,31** em 2025-02 AL1 |
| "os três números contavam linhas já gravadas" | três **nunca foram reproduzidos**; a causa é desconhecida. Só o meu (10.102,33) foi diagnosticado |
| "o DRE lê `insurance_commission_amount`" | `dre.ts` tem **zero** ocorrências desse identificador; lê `bbts_seguro_pago`, bruto |
| "43 competências sem linha de seguro em jan-mai/2026" | são **3**, e são 2023-09, 2023-12 e 2025-02 |
| "as abas de jan-mai/2026 estão vazias" | **não estão** — jan/2026 AL1 tem 249 linhas na aba "Seguro", AL3 tem 54 |
| "três ids que não existiam" | **um** id citado não existe (`0dc42962…`), e não foi produzido por mim |
