# HANDOFF — feat/residuo-financeiro (27–28/08/2026)

Três resíduos do fechamento da ADS, mais uma investigação de seguro do RR que
consumiu a maior parte da frente e terminou sem buraco.

> **Como ler este documento.** Todo número aqui foi medido por consulta ou execução,
> e o script que o produziu está nomeado. Onde a medição contradisse o que se
> acreditava, a contradição está registrada — inclusive quando o que se acreditava
> era meu. A seção 8 lista o que eu corrigi em relação ao ditado deste handoff.
>
> **As seções são de 27/08 e trazem ERRATA de 28/08 onde a medição mudou** — a
> errata fica no lugar do texto velho, nunca no fim: quem lê a §2 ou a §5 tem de
> ver o estado de hoje ali, não três seções adiante. As mudanças de 28/08 são o
> backfill executado (§2 e §5.1), a Abertura virando coluna própria com o defeito
> que isso revelou (§5.2), o bloco 3 finalmente exercitado (§5.3) e a lição de
> ferramenta do `.next` (§9).

---

## 1. ESTADO DA RAMIFICAÇÃO

**Branch:** `feat/residuo-financeiro`, criada de `origin/main` em `5221676`
(que já continha a PR #157, confirmada por `git log --grep`: merge `5b95ac4`).

**Nada foi pushado.** Os **20** commits estão só local (eram 15 em 27/08).

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
| `f67305c` | handoff da rodada de 27/08 |
| `8a958d7` | **prova por mutação** do apagamento: banco espelho + gate no caminho real |
| `bc75fdf` | a recusa do só-crédito nomeia a empresa, escreve o dano no campo que a tela exibe, e a interface ganha o caminho de confirmação |
| `b27f4cd` | conferência do backfill contra os PDFs, antes de rodar o SQL |
| `1faba4a` | pós-backfill: o caixa bate 318.785,68, e o detalhe de "Outros" não |
| `3c09a5c` | Abertura de Conta vira **coluna** na matriz; gate das duas identidades |
| *(este)* | handoff atualizado |

**Arquivos de produção tocados:** `lib/bbtsPdfExtract.ts`, `lib/bbtsClosingImport.ts`,
`lib/dre.ts`, `lib/financialAnalytics.ts`, `lib/diagnostico/ledgerHealth.ts`,
`lib/diagnostico/fechamentoParcial.ts` (novo), `app/api/import/closing/ads/route.ts`,
`app/importacoes/page.tsx`.

**Gates novos, os dois self-contained (entram no CI):**
`scripts/ads_import_so_credito_gate.cjs` (17 asserções, 982 ms) e
`scripts/financeiro_matriz_detalhe_gate.cjs` (14 asserções, 982 ms), mais o
utilitário `scripts/_fakeDpr.cjs`. Medido em 28/08: `npm run gates` →
**28 executados, 28 passaram**; `npm run build` OK; `npx tsc --noEmit` = 0.

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

### FEITO — o backfill, e a Abertura no card  *(era "NÃO FEITO"; executado em 28/08)*

**ERRATA de 28/08/2026.** Esta seção dizia "a tabela está vazia" e "não foi
executado". O Diego rodou o SQL no Studio em **28/08 01:33 UTC**. O texto anterior
está substituído; o que ele previa virou medição, e a previsão bateu ao centavo.

Estado ANTES (27/08, última medição da rodada anterior):

```
=== bbts_fechamento_totais: 0 linhas  (a tabela INTEIRA, sem filtro) ===
=== receivedClosing 2026-08: 318.685,68 ===
  ADS: avista 18.737,33 | prt 7,01 | seguro 204,52 | consorcio 0,00 | outros 0,00 | ajustes 0,00
       Σ células = total da linha = 18.948,86
```

Estado DEPOIS (`scripts/diag-residuo-45-pos-backfill.cjs`):

```
=== bbts_fechamento_totais: 2 linha(s) ===
  2026-06-01  avt=7.707,03  prt=7,01  abertura=0,00    glosa=0,00  total=7.714,04   soma=7.714,04   delta=0,00  insert=true
  2026-07-01  avt=18.737,33 prt=7,01  abertura=100,00  glosa=0,00  total=18.844,34  soma=18.844,34  delta=0,00  insert=true

=== /api/financeiro 2026-08 ===
  receivedClosing   318.785,68     (previsto 318.785,68 — delta 0,00)
  receivedNet       318.785,68
  receivedEmpresa   251.467,47     (inalterado)
  receivedInsurance   5.336,21     (inalterado)

  ADS: avista 18.737,33 | prt 7,01 | seguro 204,52 | abertura 100,00 | consorcio 0,00 | outros 0,00 | ajustes 0,00
       Σ células = total da linha = 19.048,86

  [ads_cabecalho_nf_ausente] count=0     [ads_ancora_totais] count=0
```

`created_at == updated_at` nas duas linhas: foi **INSERT**, o ramo `do update` do
`on conflict` não rodou. A única `uq_bbts_totais (company_id, competencia)`
confirmada pelo Diego no Studio — o OpenAPI do PostgREST **não expõe constraint**,
então isso não era mensurável daqui; o modo de falha era seguro (sem a única, o
`on conflict` estoura `42P10` dentro do `begin` e nada é gravado).

**A Abertura NÃO ficou em "Outros"** — ver a errata do item 2 da §5.

---

## 3. A DIFERENÇA CONTRA O EXTRATO — a conta completa

```
DEPÓSITO DECLARADO pela BBTS em 07/2026 : 18.999,41
   = 18.844,34 ("Pagamento Total" do PDF de crédito)
   +    155,07 (âncora TOTAL do PDF de seguro = 204,52 de cálculo − 49,45 de cancelamento)

O SISTEMA, competência 2026-07
   antes do backfill   : 18.948,86   →  diferença  −50,55
   HOJE (28/08, medido): 19.048,86   →  diferença  +49,45
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

> **ERRATA DE 28/08/2026 — esta lista é a de 27/08 e envelheceu.** Os itens 1, 2
> e 3 estão RESOLVIDOS, e um defeito que ela não previa apareceu e foi consertado.
> Cada item traz o que mudou; o que continua aberto está marcado.

1. ~~**Rodar o backfill** (`20260827_000004`).~~ **MORTO em 28/08 01:33 UTC.**
   Executado pelo Diego no Studio: 2 linhas, identidade da soma fechando nas
   duas, `created_at == updated_at` (INSERT). O caixa de ago/26 foi de
   **318.685,68 para 318.785,68** — a previsão desta frente, ao centavo. Ver a
   errata da §2.

2. ~~**Abertura na matriz: "Outros" ou coluna própria.**~~ **DECIDIDO em 28/08:
   COLUNA PRÓPRIA**, `abertura` / "Abertura de conta", entre `seguro` e
   `consorcio`. Motivo do Diego: é totalizador do fechamento da BBTS, mesma
   natureza do AVT e do PRT — não é produto.

   **E havia uma razão técnica que só apareceu depois de o backfill rodar:**
   "Outros" tem CONTRATO DE AGREGADO. A célula é DERIVADA do próprio detalhe
   (`financialAnalytics.ts:1274`, `outros.reduce`), e a tela **troca a coluna
   pelas linhas do detalhe** quando o leitor a expande
   (`app/financeiro/page.tsx:163-167`). A Abertura violava esse contrato:

   ```
   ADS, medido em 28/08 logo depois do backfill:
     celulas.outros        = 100,00      <- a Abertura
     Σ(outrosDetalhe)      =   0,00      (bbcap, conta_corrente, dental, lob, credito)
     delta                 = -100,00
     Σ(celulas) = total    = 19.048,86   <- ESTA fechava; só a outra quebrava
   ```

   Na tela expandida os R$ 100,00 **sumiam** — a coluna vira as cinco do detalhe,
   todas zero na ADS — enquanto a coluna Total continuava com eles. A linha do RR
   nunca teve o defeito, e a diferença é estrutural: lá a célula nasce do detalhe,
   então os dois lados não têm como divergir. Consertado: `celulas.outros` da ADS
   voltou a `0,00`, a Abertura foi para a coluna nova, e a `fonte` de "Outros" foi
   corrigida (dizia `fechamento_mensal_empresa (por CNPJ)` para uma coluna cuja
   linha da ADS nunca teve entrada nessa tabela e cuja linha de avulsos vem de
   `receita_lancamento_manual`). Validado no navegador pelo Diego em 28/08.

   Vigia: `scripts/financeiro_matriz_detalhe_gate.cjs` (self-contained, 14
   asserções) cobra em TODA linha `Σ(outrosDetalhe) == celulas.outros` e
   `Σ(celulas) == total`. Provado por mutação: devolver a Abertura para `outros`
   derruba 4 asserções.

3. ~~**BLOCO 3 — implementado, nunca exercitado.**~~ **EXERCITADO em 27/08.** O
   apagamento foi REPRODUZIDO no caminho real, contra um banco espelho semeado
   com produção (`scripts/_fakeDpr.cjs`, que reproduz o upsert parcial do
   PostgREST), com o fechamento REAL de julho:

   ```
   codigo de HOJE     : 0 de 12 linhas alteradas
   codigo de 1212c1f  : 12 de 12   bbts_seguro_pago 115,10 -> 0,00
                                   insurance_value  113.345,57 -> 0,00
                                   has_insurance    true -> false
                                   insurance_type   "SLIP" -> null
   nos DOIS casos: ancora_ok=true, gravadas=43, nenhum aviso
   ```

   E a recusa da rota ganhou o que faltava: **empresa** pelo nome (lida de
   `companies`), os números **dentro do campo `error`** — o único que a tela
   renderiza; antes moravam em `detalhe`, que ninguém exibia — e **caminho de
   confirmação na interface** (bloco com o dano em números + botão "Confirmo:
   importar SÓ o crédito", que nasce nulo, só existe depois de uma recusa e morre
   a cada troca de arquivo). Vigia: `scripts/ads_import_so_credito_gate.cjs`
   (self-contained, 17 asserções, com a função POST real da rota).

4. **ABERTO — os +49,45** contra o extrato. §4, decisão de negócio sobre os
   cancelamentos de julho. Não é defeito.

5. **RETRATADO — os R$ 372,31 em 2025-02 AL1 NÃO se reproduzem.** Ver a errata
   de 28/08/2026 em §6. O número tem a mesma procedência dos quatro que já
   morreram: não é reprodutível a partir dos arquivos em disco. O que **é**
   verificável nessa competência é outra coisa — o agregado órfão do item 6.

6. **FECHADO em 28/08/2026 — a perda de detalhe de 2025-02 AL1.** A dívida
   nomeada aqui dizia que a rota de cancelamento
   (`app/api/import/closing/cancel/route.ts:49-56`) apagava
   `monthly_closing_entries` sem recompor `fechamento_mensal_empresa`. **Meia
   verdade**: a rota de fato não recompõe, mas o delete destrutivo estava no
   **IMPORT** — `monthlyClosingImport.ts` apagava por `company+year+month`, sem
   filtro de `importId`, **antes** de inserir. O cancel só removia o substituto.
   Consertado em três commits: o import passou a INSERIR primeiro e APAGAR
   depois (janela reversível); o cancel RECUSA com 409 quando deixaria agregado
   órfão; e o vigia `agregado_sem_detalhe` acende para o estado que sobrou.
   **A competência NÃO foi reparada** — sem fonte verificada, recompor
   escreveria 0,00 sobre 97.535,61 e completaria a perda.

7. **ARESTA NOMEADA, não aberta — o resíduo de centavo e a coluna expansível.**
   `fecharLinha` (`financialAnalytics.ts:632-653`) devolve resíduo de arredondamento
   para a **maior célula** da linha, e o fechamento da matriz (`:1487-1500`) pode
   reaplicá-lo. Se um dia a maior célula de alguma linha for `outros`, a identidade
   `Σ(detalhe) == célula` cai por 1 centavo — e o gate ficará vermelho **com razão**:
   seria o resíduo entrando numa coluna agregada sem entrada no detalhe. A resposta
   certa é manter o resíduo **fora de coluna expansível**, nunca afrouxar a
   asserção. Hoje não acontece: a maior célula é sempre `avista`.

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

**Divergência real: nenhuma confirmada.** O que esta seção afirmava:

```
2025-02 RR ALAGOAS 1   A Vista arq 2.549,61  bd 0,00
                       Seguro  arq   372,31  bd 0,00
```

### ERRATA — 28/08/2026: os R$ 372,31 NÃO se reproduzem

Tentei reproduzir o número a partir do arquivo cancelado, o
`C23677_48357275000103_Todos_2_2025.xlsx`. Ele existe em **duas** cópias em
disco (`RRCRED/Relatório de Produção/ALAGOAS` e
`RRCRED/producao/Relatório de Produção/ALAGOAS`) — a mesma duplicação que já
produziu o artefato dos R$ 10.102,33. As duas são idênticas:

```
    tamanho: 1740724 bytes   mtime: 2025-03-07T14:19:30.000Z   (as duas)
    celulas numericas na aba Resumo: L30C2=847822962           (so o MCI)
    aba Seguro: 317 linhas   Sigma COMISSAO = -355.09
```

Ou seja: **a aba Resumo do arquivo não tem valor nenhum** (só o MCI), e a soma da
coluna COMISSÃO da aba "Seguro" é **−355,09**, não +372,31. Não reproduzi nem os
372,31 nem os 2.549,61 a partir do arquivo. O `valor_seguro = 2.549,61` que está
no banco não veio desta cópia.

**O número fica REBAIXADO de "única divergência real da varredura das 100" para
"não reproduzido"**, com a mesma procedência dos quatro da tabela abaixo. Não é
prova de que o dinheiro está certo — é o registro de que a afirmação não se
sustenta com o que há em disco, e de que qualquer reparo baseado nela seria
reparo sem fonte.

**O que sobrou verificável nessa competência** não é o 372,31, é o AGREGADO
ÓRFÃO: `fechamento_mensal_empresa` de 2025-02 AL1 tem `operacoes = 6.491` e
`valor_liquido = 97.535,61` com **zero** linhas em `monthly_closing_entries`.
Varridas as 100 linhas de FME, é a única quebrada (2023-12 AL1 também está sem
entries, mas com o agregado zerado — não é perda). Isso agora tem vigia
permanente: `agregado_sem_detalhe`, em `lib/diagnostico/fechamentoParcial.ts`.

### ABERTO — 2026-05 AL1 diverge entre o agregado e o detalhe

Achado novo de 28/08/2026, **não investigado, não tocado nesta frente**. Ao
medir se `fechamento_mensal_empresa` é reconstituível a partir das entries em
competências consideradas sadias:

```
   RR ALAGOAS 1  2026-04   operacoes(FME)=6025 x chaves(entries)=6025 => IGUAIS
                           valor_avista 34.123,96 == Sigma CASH 34.123,96
   RR PERNAMBUCO 2026-02   operacoes(FME)=2891 x chaves(entries)=2891 => IGUAIS
                           valor_avista 57.232,43 == Sigma CASH 57.232,43
   RR ALAGOAS 1  2026-05   operacoes(FME)=5970 x chaves(entries)=5963 => DIFERENTES (delta -7)
                           valor_diferido 34.622,63  x  Sigma PRT 36.373,45  (delta -1.750,82)
```

Duas das três batem exatamente; **2026-05 AL1 não**. São 7 operações e
R$ 1.750,82 de diferença entre o que o agregado declara e o que o detalhe soma,
numa competência que ninguém considera quebrada. Parte do delta de `valor_diferido`
tem explicação plausível na régua (`isPayablePrtRow` filtra COD EST = 1, negativos
vão para estorno), mas **as 7 operações não foram explicadas**, e a hipótese não
foi verificada. Foi este achado que derrubou os dois desenhos de "recompor o
agregado": recompor sempre reescreveria esta competência.

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

## 6b. O PADRÃO — nota de projeto que não é MEDIDA volta como pista errada

> **Contagem em 29/08/2026: SEIS anotações derrubadas por medição — quatro herdadas,
> duas escritas DEPOIS desta regra (a 5ª minha, a 6ª do Diego).** Ver também
> `HANDOFF_TRIAGEM_ORFAOS.md`.

Registrado em 28/08/2026, depois da **terceira** ocorrência na mesma frente. Três
anotações abriram um bloco de trabalho como se o defeito estivesse vivo, e nas três
o defeito **já tinha sido consertado** ou **estava em outro lugar**. Nenhuma era
mentira quando foi escrita; todas apodreceram porque ninguém as remediu quando o
conserto entrou.

| # | a anotação dizia | o que a medição de 28/08 mostrou |
|---|---|---|
| 1 | "o fechamento atribui por chave J e ignora `assigned_promoter_id`" | **já consertado** em `4cb31c3` (23/08), que É ancestral de `main`, e o PMR de julho já tinha sido reconsolidado. Sobrava um QUARTO sítio, na EXIBIÇÃO (`closingProposalRows`), que a anotação não mencionava |
| 2 | "a rota de cancelamento apaga `monthly_closing_entries` sem recompor" | **meia verdade**: a rota de fato não recompõe, mas o delete destrutivo estava no **IMPORT** (`monthlyClosingImport.ts`, por `company+year+month` sem filtro de `importId`, ANTES do insert). Consertar a rota sozinha não teria fechado nada |
| 3 | "'Comissões pagas' mostra M e deveria mostrar M-1" | **já consertado** pela CORRECAO B (`financialAnalytics.ts:990-995`). Medido nas três últimas competências: o card bate ao centavo com o líquido de M-1 e não bate com M em nenhuma |

E há uma quarta, no outro handoff: a §16 do `HANDOFF_ADS_FECHAMENTO_CAIXA` dizia "a
ADS NÃO entra no card Recebido", falso desde 28/08 — a ADS entra com R$ 18.959,44
em ago/26.

### A quinta, escrita NO PRÓPRIO DIA — o padrão não é sobre idade

Em 28/08/2026, ao mandar registrar a regra do débito de empresa, a instrução dizia
*"o volume medido (zero)"* e *"o gatilho para revisitar — o primeiro item que cair
na fila por promotor inativo"*, assumindo que o gatilho ainda **não** tinha ocorrido.
A medição do mesmo dia derrubou a premissa:

```
   FILA op=208875852  2026-06  R$ 2,03  motivo: promotor inativo desde 2026-06-13
   FILA op=211780610  2026-07  R$ 2,03  motivo: promotor inativo desde 2026-06-13
   (os dois de ANA CLARA — total R$ 4,06; o primeiro entrou na fila em 09/07/2026)
```

O gatilho tinha disparado **sete semanas antes**. O que é zero é outra coisa: a
ESTRUTURA (`apply_to_company` em 0 de 77 linhas), nunca o caso.

Esta é a única das cinco que **não foi herdada** — nasceu e morreu no mesmo dia.
E é a que corrige o enunciado do padrão: **não se trata de nota VELHA, e sim de
nota NÃO MEDIDA.** Uma anotação escrita há cinco minutos sobre um estado que
ninguém consultou é tão frágil quanto uma de abril. A regra abaixo vale para as
duas idades.

O registro foi escrito com o texto CERTO em `lib/debitInsuranceResolver.ts`
(bloco "O PRIMEIRO CASO APARECEU"), incluindo a errata da própria instrução.

### A SEXTA — 29/08/2026, e é do próprio Diego, três turnos depois da regra

Ao mandar medir a escrita em massa de `2026-08-26T13:53:38`, a instrução dizia que era
*"a SEGUNDA escrita em massa sem rastro documental"*, por analogia com a de 27/08 às
20:32. **Há rastro, e é do próprio repositório:**

```
HANDOFF_ADS_FECHAMENTO_CAIXA.md:274
## 7. REIMPORTAÇÃO DE 26/08 13:53 UTC — efeito medido
O Diego reimportou o fechamento ADS de julho com os 2 PDFs.
```

Medido junto: `audit_logs` na janela 13:40–14:10 tem **zero** linhas (as 6 do dia são
`MANUAL_CHANGE` do financeiro, entre 18:01 e 20:01), e o escopo das 43 linhas é 100%
ADS / 100% competência 2026-07 — coerente com a reimportação. **O rastro é documental,
não de banco**; a diferença para 27/08 20:32 é que lá não havia nenhum dos dois.

Esta é a **segunda não-herdada** e, com a quinta, fecha o ponto: a 5ª nasceu no dia em
que a regra foi escrita, a 6ª três turnos depois **por quem a escreveu**. Nota não
medida é frágil independentemente de idade **e de autor**.

### A medição do item 3, para não precisar refazer

```
   MES NA TELA    comissoesPagas    liquido de M  liquido de M-1   veredito
   2026-08            139.405,05       -1.024,09      139.405,05   LE M-1 (certo)
   2026-07            117.769,41      139.405,05      117.769,41   LE M-1 (certo)
   2026-06            105.773,30      117.769,41      105.773,30   LE M-1 (certo)
```

Árbitro: o líquido do PMR (`final_commission_value` − `promoter_discounts`) por
competência, somado por script independente, não pelo código da tela. Os cards
vizinhos foram medidos junto: `receivedEmpresa` também lê M-1 (bate ao centavo com
`Σ(valor_avista+valor_seguro)` do fechamento M-1 em jun/26; em jul e ago fica acima
porque a ADS entrou no card e a ADS **não tem linha** em `fechamento_mensal_empresa`).
**As duas metades do painel estão na mesma competência.**

### O custo, e o que fazer a respeito

Cada uma dessas três custou uma FASE A inteira de medição para ser derrubada — e o
custo é justo, porque a alternativa (acreditar na nota) teria produzido um conserto
em cima de código já correto. O que é evitável é a nota continuar lá depois.

**A regra:** quando um conserto entra, a anotação que o pediu é **remedida ou
riscada no mesmo commit** — com data e com o número que a derrubou. Nota sem data de
medição não é pista, é boato. As revogações deste arquivo e da §16/§19 do
`HANDOFF_ADS_FECHAMENTO_CAIXA` são o formato: texto original preservado, marcado
REVOGADO/RETRATADO com a data, e o estado vigente em cima.

---

## 6c. A RODADA DE 27/08 ÀS 20:32 — parcialmente reconstituível, e foi ela que motivou o vigia

Registrado em 29/08/2026. **Não é possível afirmar que houve troca de dono, nem que
não houve.** O rastro foi destruído pela própria rodada.

### O que se mede

```
promoter_debits (CANCELAMENTO_SEGURO), created_by e created_at:
   2026-06 | rotina-automatica | AUTO   17 linhas   2026-08-27T20:32:22 .. 20:32:29
   2026-07 | rotina-automatica | AUTO   19 linhas   2026-08-27T20:32:37 .. 20:32:48
```

Os 36 débitos foram **recriados** naquele minuto — não nas datas dos imports (09/07 e
04/08). A assinatura `"rotina-automatica"` só existe em `scripts/canc-run-fila.cjs:20,27`
e `canc-run-jul-ads.cjs:24`; o import assina `"import-fechamento"`
(`monthlyClosingImport.ts:1903`).

**Não há registro documental da escrita.** Zero ocorrências de `canc-run-fila` em
qualquer `.md` ou mensagem de commit. O `HANDOFF_CANCELAMENTO_DONO.md`, escrito às
15:57 do mesmo dia, diz o contrário: *"O R$ 1,40 é gravado no próximo import do
fechamento da ADS — **não escrevi no banco**"*. O contexto explica a rodada (o PR #195,
que deu ao RR a cascata `cms` e o critério do inativo, foi mergeado às 18:56), mas o
contexto não é registro.

### Por que é irrecuperável

Nada persistia o dono anterior — medido em 28/08/2026:

| onde | por quê não serve |
|---|---|
| `promoter_debits` | só `promoter_id` (o dono ATUAL); sem `updated_at`, sem coluna de anterior |
| `promoter_debit_sources` | `on delete cascade` (migration `20260709_000001:53`) — **0 linhas órfãs** |
| `promoter_discounts` | nasce no mesmo run; as 36 têm `debit_id`, caem no mesmo cascade |
| `audit_logs` | **0 linhas** de débito |

### As duas conferências indiretas que dão para fazer

1. **Junho bate contra um total documentado duas horas ANTES da rodada.** A linha
   *"a rotina lancou em jun/26 = -899,21"* entrou no `HANDOFF_CANCELAMENTO_DONO.md:390`
   pelo commit `4809d7e`, às **18:25**. Hoje junho soma **899,21** em 17 linhas. O
   **total** não se moveu. (Não prova que nenhum promotor individual trocou — o
   handoff registra o total, não a distribuição.)
2. **O candidato óbvio está descartado.** A inversão de precedência do BLOCO 1
   (`4cb31c3`, 23/08) mudou a atribuição de 5 contratos de julho. Medido: **nenhum dos
   5 tem linha de seguro** em 2026-07 (0 de 201 linhas `INSURANCE`), logo não gera
   estorno, logo não gera débito. A inversão não alcança débito.

**Julho fica sem conferência possível.** A primeira documentação do valor (*"16 linhas
RR, R$ 370,85"*) é do commit `f67305c`, às **21:49** — posterior à rodada.

### CORREÇÃO de 29/08/2026 — a rodada é PARCIALMENTE reconstituível, e o rastro
### estava num portão que ninguém roda

O texto acima dizia "irrecuperável". **É meia verdade, e a metade que faltava é a
tese do BLOCO 5 inteira, medida.**

`scripts/test_debitos_junho_congelado.cjs` congelou o estado de junho em
**12/07/2026**:

```
131  ok(depois.debits.length === 22, `junho segue com 22 debitos (15 AUTO + 7 MANUAL)`)
132  ok(depois.discounts.length === 25, `junho segue com 25 parcelas`)
134  ok(Math.abs(somaAuto - 872.71) < 0.005, `soma dos AUTO de junho segue 872,71`)
```

Rodado em 29/08/2026, ele **reprova**, e as três mensagens dizem o que mudou:

```
  FALHOU  junho segue com 22 debitos (15 AUTO + 7 MANUAL) — tem 24
  FALHOU  junho segue com 25 parcelas — tem 27
  FALHOU  soma dos AUTO de junho segue 872,71 — tem 899.21
```

**Junho foi de R$ 872,71 para R$ 899,21 — +R$ 26,50 e +2 débitos** (15 AUTO → 17),
em algum ponto entre 12/07 e 27/08.

**E não é troca de dono: é ADIÇÃO.** A forma bate com o degrau `+cms` do PR #195,
cujo próprio corpo de commit registra *"A fila caiu de 7 para 4"* — três operações
que estavam órfãs na fila ganharam dono, e duas delas eram de junho. Débito que não
existia passou a existir; ninguém perdeu nada para ninguém.

Isso **não contradiz** as duas conferências acima: o total de 899,21 já estava
documentado às 18:25 de 27/08, antes da rodada das 20:32, e a rodada das 20:32
recriou os mesmos valores. O que muda é o alcance da afirmação: para **junho** se
sabe agora *o que* mudou e *por quê*, não apenas que o total batia. **Julho segue
sem conferência.**

### O que isto ensina, e é o motivo do BLOCO 5

O rastro **existia**. Estava num portão que registrou a divergência no minuto em que
ela aconteceu — e ficou vermelho, sozinho, por semanas, porque é `needs-db-lento` e
essa faixa só roda em `npm run gates:full`, que **nunca teve execução verde
registrada em commit nenhum** (medido: 358,4s de teto 90s).

Não foi falta de instrumento. Foi instrumento que ninguém lê. É a mesma família do
§6b — nota não medida — aplicada a portão: **portão não executado é anotação não
remedida com outro nome.**

### O que foi feito a respeito

Não dá para reconstruir o passado inteiro; dá para não repetir. O commit
`registrarTrocaDeDono` faz a memória nascer **antes** do delete, em `audit_logs`, e o
check `debito_auto_trocou_dono` a lê. A pergunta *"o que essa rodada mudou?"* passa a
ter onde ser respondida — e, desta vez, num lugar que a tela de diagnóstico mostra,
não num portão que espera alguém lembrar.

### DÍVIDA NOMEADA, não consertada — o script contorna as duas guardas

`scripts/canc-run-fila.cjs:20` chama `resolveInsuranceDebits` **direto**, sem passar
por `persistAutoInsuranceDebits`. Com isso ele não vê:

- a trava de junho — `DEBITO_AUTO_PRIMEIRA_COMPETENCIA = "2026-07"`
  (`monthlyClosingImport.ts:1845`), que impede o import de tocar competências
  anteriores a julho;
- a guarda do `APPLIED` (`monthlyClosingImport.ts:1881-1896`).

**Foi por isso que junho — congelado para o import — foi reescrito em 27/08.** O
cabeçalho do script é honesto sobre o que faz (`/* GRAVA. Reprocessa jun e jul... */`),
mas honestidade no comentário não é guarda no código.

Não consertado nesta frente **de propósito**: fechar isso é decidir se o script deve
respeitar as travas do import ou se ele é a válvula de escape legítima para reprocessar
competência congelada — e essa é decisão de negócio, não de código. A partir de agora,
pelo menos, ele **deixa rastro**: a memória mora no resolvedor, abaixo dele.

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
| "bateu ao centavo / buraco zero" | ~~1 divergência real: R$ 372,31 em 2025-02 AL1~~ **RETRATADO em 28/08/2026**: o número não se reproduz do arquivo em disco (Resumo sem valores; Σ COMISSÃO da aba Seguro = −355,09). Ver a errata em §6 |
| "os três números contavam linhas já gravadas" | três **nunca foram reproduzidos**; a causa é desconhecida. Só o meu (10.102,33) foi diagnosticado |
| "o DRE lê `insurance_commission_amount`" | `dre.ts` tem **zero** ocorrências desse identificador; lê `bbts_seguro_pago`, bruto |
| "43 competências sem linha de seguro em jan-mai/2026" | são **3**, e são 2023-09, 2023-12 e 2025-02 |
| "as abas de jan-mai/2026 estão vazias" | **não estão** — jan/2026 AL1 tem 249 linhas na aba "Seguro", AL3 tem 54 |
| "três ids que não existiam" | **um** id citado não existe (`0dc42962…`), e não foi produzido por mim |

---

## 9. LIÇÃO DE FERRAMENTA — `next build` corrompe o `next dev` em execução

**Aconteceu em 27/08/2026, 22:46.** O `/financeiro` em `localhost:3000` ficou
parado em "Carregando financeiro..." **e sem CSS**. Não era a rota, não era
permissão, não era o backfill, não era a coluna nova da matriz: era o `.next`.

`next build` e `next dev` **escrevem no mesmo `.next`**. Rodar o build com o dev
server de pé substitui, debaixo dele, os artefatos que ele está servindo. O
processo continua vivo e respondendo — por isso o sintoma não parece de build.

**A causa foi cumprir a regra "npm run build com tsc em 0 antes de qualquer
commit" sem antes olhar se havia dev server rodando.** Dois builds nesta frente,
antes de `bc75fdf` e de `3c09a5c`.

### O quadro clínico, medido

```
processo na porta 3000 (PID 23140)   next dev, vivo desde 27/08 15:58:39
.next/BUILD_ID                       22:46:39   <- marcador de `next build`
.next/export-marker.json             22:46:52   <- idem
.next/server/app/financeiro.html     22:46:49   <- pagina PRE-RENDERIZADA (dev nao gera)
.next/server/chunks/1331.js          22:46:04   <- layout de PRODUCAO (chunks/)
.next/server/webpack-runtime.js      22:50:37   <- reescrito pelo DEV, depois
.next/static/t-AbTIOGfbj-5k-X2uwgL/  22:46      <- buildId de producao
.next/static/development/            22:50      <- ... lado a lado com o do dev
```

No log, na ordem: quatro `GET /api/financeiro 200`, um `✓ Compiled in 588ms`, e
então `TypeError: Cannot read properties of undefined (reading 'call')` no
`/financeiro` e `Cannot find module './1331.js'` (o `webpack-runtime.js` do dev
procura o chunk ao lado dele; o build o pôs em `server/chunks/`).

**O que explica os DOIS sintomas de uma vez:**

```
GET /_next/static/chunks/main-app.js  ->  404
```

Sem o bundle raiz o React não inicializa: o HTML chega (por isso `GET /financeiro
200`), o estado inicial "Carregando…" fica na tela para sempre, e o CSS do App
Router não é aplicado. **Tela sem CSS + spinner eterno + rota que respondia 200
minutos antes = `.next` corrompido, não defeito de código.**

### A REGRA

> **Antes de `npm run build`, confira se há `next dev` rodando** (`netstat -ano |
> grep :3000`). Ou o dev está parado, ou o build vai para diretório separado:
> `next build --distDir .next-build`.

### O conserto, quando acontecer

`npm run dev:clean` (já existe no `package.json:7` — `rm -rf .next && next dev`).
Se o dev estiver de pé, derrube antes: o `rm -rf` não conserta um processo que já
carregou os módulos velhos na memória.

### O que NÃO ajudou a diagnosticar, e por quê

Rodar `buildFinancialAnalytics` pelo cliente ANON para procurar um 42501 como o
de 26/08 (§17 do `HANDOFF_ADS_FECHAMENTO_CAIXA.md`). Sem sessão o papel é `anon`,
não `authenticated`, e **as 12 tabelas negam** — inclusive as que a página lê bem
todo dia. O teste é inconclusivo por construção e diria "permission denied" com o
sistema perfeitamente saudável. Um resultado que aparece igual nos dois mundos
não separa nada.
