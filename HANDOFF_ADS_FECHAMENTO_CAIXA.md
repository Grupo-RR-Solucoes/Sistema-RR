# ADS — fechamento na coluna errada + caixa sem a ADS

Medido em 26/08/2026, ramificação `feat/ads-fechamento-caixa` (a partir de `74e1672`).
Todas as consultas em `scripts/diag-ads-*.cjs` (SOMENTE SELECT).

---

## 1. REGISTRADO, sem conserto — a tela rotula todo `daily_imports` como "carga diária"

**Sintoma.** O fechamento de crédito da ADS (PDF) aparece em "Últimas cargas diárias"
no /importacoes. Cosmético, mas confunde: `pdf (1).pdf`, 43 linhas, 03/08 16:43.

**Causa.** O importador de fechamento da ADS registra-se na tabela da diária:

```
lib/bbtsClosingImport.ts:585-587
    const { data: log, error: logErr } = await supabase
      .from("daily_imports")
      .insert({ file_name: opts?.fileName || "fechamento_bbts_junho.pdf", status: "PROCESSING" })
```

A tela tem separação real — duas listas de duas tabelas (`app/api/importacoes/route.ts:67-78`):
`daily_imports` -> "Últimas cargas diárias"; `monthly_closing_imports` -> "Últimos fechamentos mensais".
`bbtsClosingImport.ts` nunca escreve na segunda. Medido: `monthly_closing_imports` tem
530 linhas e **0** com `company_id` da ADS.

São 7 PDFs em `daily_imports` (3x `pdf (1).pdf`, 3x `fechamento_bbts_junho.pdf`,
1x `Crédito ADS-BBTS.pdf`).

**POR QUE NÃO FOI CONSERTADO NA TELA — MEDIDO, não suposto.** Varri as 124 linhas
de `daily_imports` atrás de qualquer discriminador de tipo já existente
(`scripts/diag-ads-18-discriminador.cjs`):

```
total de linhas em daily_imports: 124
coluna | linhas com valor NAO-nulo (de 124)
id               | 124
file_name        | 124
import_date      |   0     <- coluna MORTA (nenhum importador escreve)
status           | 124
rows_count       | 123
processing_notes |   1     <- amostra de erro, nao tipo
created_at       | 124
finished_at      |   0     <- coluna MORTA

distribuicao de extensao do file_name:
.pdf  |   7
.xlsx | 117
```

Não há coluna de tipo, e `import_date`/`finished_at` são 100% nulas — não servem
nem como proxy. O único sinal é a EXTENSÃO. Filtrar por tipo na tela exigiria:
  (a) coluna nova (`kind`/`tipo`) => MUDANÇA DE ESQUEMA; ou
  (b) heurística por extensão do nome do arquivo => frágil (o nome vem do browser:
      "pdf (1).pdf"), quebraria no dia em que uma diária vier em PDF, e é uma regra
      de NEGÓCIO escondida numa string — o mesmo tipo de acoplamento que a âncora
      por texto literal do parser da BBTS já custou uma vez.
Fica registrado, não consertado. **Decisão do Diego (26/08): não conserta agora.**

**Sem estrago em dado.** Sem duplicação (97 linhas ADS, 0 propostas repetidas);
nada lê `daily_import_id` de volta; a lista diária não tem botão de cancelar
(o cancelamento só existe na lista mensal, `app/importacoes/page.tsx:1106`).

---

## 2. RISCO VIVO — reimportar SÓ o PDF de crédito APAGA o seguro, em silêncio

Este é o achado que a frente destravou e **não é cosmético**.

**Mecanismo.** Se o PDF de seguro não for enviado, o extrator devolve lista vazia
e âncora ZERO:

```
lib/bbtsPdfExtract.ts:466
  const seg = seguroData ? await extractBbtsSeguroPdf(seguroData) : { rows: [] as BbtsSeguroRow[], totalAnchor: 0 };
```

A âncora é *self-describing* (sai do próprio arquivo), então `esperado=0` vs
`obtido=0` **PASSA** no gate (`lib/bbtsClosingImport.ts:305`). O import grava e
responde `success: true`.

E o merge entra como `owner: "FULL"`, que é dono de TODA chave presente no registro:

```
lib/dailyRecordMerge.ts:194-196
  const cols =
    owner === "FULL"
      ? Object.keys(record).filter((k) => !CONTROL_KEYS.has(k) && k !== "raw_payload")
```

Sem seguro, o registro carrega `insurance_value: 0`, `has_insurance: false`,
`bbts_seguro_pago: 0` (`bbtsClosingImport.ts:440-443, :472`) — e sobrescreve.

`DERIVED_NEVER_UPDATED` (`dailyRecordMerge.ts:133-138`) **não protege**: ela cobre
só as 4 colunas de COMISSÃO calculada, não as colunas CRUAS de seguro.

**É o gêmeo exato do defeito de 29/07/2026 documentado em `dailyRecordMerge.ts:101-114`**
— resolvido lá para as derivadas, deixado aberto aqui para as cruas.

**Efeito se acontecer:** as 12 linhas de julho com seguro (Σ pago R$ 115,10, base
R$ 113.345,57) zeram, e o gate não reclama.

**Não é hipotético:** o mesmo arquivo foi importado 3x (03/08, 04/08, 14/08).

---

## 3. RISCO VIVO — a diária da ADS desancora a competência do fechamento

`movement_date` e `contract_date` estão em `CREDIT_COLUMNS` (`dailyRecordMerge.ts`),
então a diária da ADS (owner CREDIT) sobrescreve o que o fechamento fixou.

O fechamento ancora as linhas só-seguro no dia 15, dentro da janela:

```
lib/bbtsClosingImport.ts:355
  const compMovementDate = `${year}-${String(month).padStart(2, "0")}-15`;
```

Medido na linha `221262790` (`fonte: fechamento_pdf_seguro_only`):

```
movement_date            : 2026-07-31   (o fechamento gravou 2026-07-15)
insurance_value (base)   : 89.415,39
bbts_seguro_pago (COLUNA): 0,00
__bbts_meta.seguro_valor_relatorio : 89,42
```

A diária de 26/08 12:54 (UTC) moveu a data de 15/07 para 31/07. Pela janela
(`lib/productionPeriod.ts:59-68`) a competência 2026-07 é
`[2026-06-30, 2026-07-31)` — **31/07 já é agosto**. A linha saiu de julho.

**Segundo defeito na mesma linha:** o bloco só-seguro (`bbtsClosingImport.ts:521-569`)
NÃO grava `bbts_seguro_pago`. O valor pago (R$ 89,42) vive só em
`raw_payload.__bbts_meta.seguro_valor_relatorio`. Como a receita da ADS no DRE lê
a COLUNA (`lib/dre.ts:321, :348`), toda linha só-seguro rende R$ 0,00 de receita.

---

## 4. O caixa não conhece a ADS (Achado 2 — causa confirmada)

`lib/financialAnalytics.ts:451-460` lê `fechamento_mensal_empresa`, **sem filtro de
empresa**. A ADS não entra porque **nunca teve linha lá** — medido no histórico
inteiro: 4 CNPJs presentes, `linhas com CNPJ da ADS: 0`. Só
`lib/monthlyClosingImport.ts` (caminho xlsx do RR) escreve nessa tabela.

`grep -n "BBTS_COMPANY_ID|ADS|375aea6d" lib/financialAnalytics.ts` -> nenhuma ocorrência.

O DRE compensa (`lib/dre.ts:314-365`, bloco dedicado lendo `bbts_pag_avista` +
`bbts_seguro_pago` + `bbts_prt_parcelas`); o caixa não. Duas telas, mesma
competência, respostas diferentes.

Julho/2026: caixa de ago/26 = R$ 299.736,82 (4 empresas RR, reproduzido ao centavo).
ADS pela régua do DRE = R$ 18.859,44 (AVT 18.737,33 + seguro 115,10 + PRT 7,01).

**ARMADILHA:** `active=false` da ADS **não** é bug e **não** é a causa.
`lib/cmsMonthly.ts:54` é explícito: "ADS e active=false => NAO entra no gatilho".
O regime de julho fechou certo (4 ativas / 4 cobertas). Falta a RECEITA, não o regime.

---

## 5. RECONCILIAÇÃO PDF x BANCO — ADS julho/2026 (medido 26/08 com os PDFs reais)

Fonte: `C:/Users/diego/Downloads/pdf (1).pdf` (crédito) e `pdf.pdf` (seguro), rodados
pelo extrator do próprio repo (`scripts/diag-ads-20-pdf.cjs`, `-21-`, `-22-`).

Cabeçalho do PDF de crédito, texto cru:

```
Pagamento AVT | Pagamento PRT | Abertura de Conta | Glosa   | Pagamento Total
R$ 18.737,33  | R$ 7,01       | R$ 100,00         | R$ 0,00 | R$ 18.844,34
```

| componente | PDF | banco | delta | causa |
|---|---|---|---|---|
| Pagamento AVT | 18.737,33 | 18.737,33 | 0,00 | **43/43 idênticos** |
| Pagamento PRT | 7,01 | 7,01 | 0,00 | **8/8 idênticos** |
| Abertura de Conta | 100,00 | — | −100,00 | rótulo é MARCADOR DE PARADA |
| Glosa | 0,00 | — | 0,00 | nunca lida (zero neste mês) |
| Seguro `calculo` | 204,52 | 115,10 | −89,42 | 13ª linha só no `raw_payload` |
| Seguro `debito` | −49,45 | 0,00 | +49,45 | fora da produção (correto p/ comissão) |
| **TOTAL** | **18.999,41** | **18.859,44** | **−139,97** | 100,00 + 89,42 − 49,45 |

### 5a. Abertura de Conta: o parser lê o rótulo e joga o dinheiro fora

```
lib/bbtsPdfExtract.ts:376-377
    // a seção acaba no próximo rótulo (Abertura de Conta / Tabela da SRCC)
    if (/^(Abertura de Conta|Tabela da SRCC)/i.test(ln)) break;
```

`grep -rn "Pagamento Total|Glosa|pagamento_total" --include=*.ts lib` -> **nenhuma ocorrência**.

O PDF DECLARA o próprio total (R$ 18.844,34) e o sistema **nunca o lê**. As `_ancoras`
do extrator são `credito_propostas`, `credito_valor_financiado`, `credito_pag_avista`,
`seguro_calculo`, `prt_valor` — nenhuma confere o TOTAL PAGO. Por isso os R$ 100,00
sumiram sem o gate piscar: ele valida as partes que conhece, não o todo declarado.

### 5b. Seguro: o sistema NÃO infla — deflaciona

O extrator parseia as 16 linhas e classifica certo:

```
tratamento | linhas | Sigma valor_seguro
calculo    | 13     |  204,52
debito     |  3     |  -49,45
TOTAL                  155,07   <- bate com o PDF
```

As 3 negativas são **estornos de junho cobrados em julho** (`212146378` −24,00 e
`212205929` −24,05 foram pagas em junho por +24,00 e +24,05). Ficam fora da
produção — correto para COMISSÃO, errado para CAIXA: a BBTS descontou do pagamento.

Das 13 `calculo`, 12 estão na coluna `bbts_seguro_pago`. A 13ª não:

```
221262790 | PDF=89,42 | coluna=0,00 | raw_payload.__bbts_meta.seguro_valor_relatorio=89,42 | fonte=fechamento_pdf_seguro_only
```

É o defeito da seção 3: o bloco só-seguro (`bbtsClosingImport.ts:521-569`) nunca grava
`bbts_seguro_pago`. 115,10 + 89,42 = **204,52** = a âncora `seguro_calculo`. O dado
existe; está na coluna errada para quem lê receita.

### 5c. CONSEQUÊNCIA PARA O CONSERTO DO CAIXA

Os dois números estão certos, para fins diferentes:
- **R$ 18.859,44** = régua do DRE (`lib/dre.ts:319-321`) — visão de PRODUÇÃO/comissão.
- **R$ 18.999,41** = o que a BBTS PAGOU — visão de CAIXA.

O caixa precisa da segunda. **Copiar a régua do DRE para o caixa erraria por R$ 139,97**
em julho, e por valor desconhecido nos outros meses (Abertura de Conta e Glosa variam).
A fonte correta é o TOTAL DECLARADO no cabeçalho do PDF — que hoje ninguém captura
e ninguém persiste.

---

## 6. FRENTE B — o cancelamento de seguro NÃO é ignorado (medido 26/08)

O parser lê o RÓTULO, não o sinal (`lib/bbtsPdfExtract.ts:432`):

```ts
432:    const cancelado = /CANCELADO/i.test(m[7]);
438:      tratamento: cancelado ? "debito" : "calculo",
```

`m[7]` é o grupo "Tipo de Lançamento" do `SEGURO_RE` (`:404`), que só aceita
`POSITIVO|CANCELADO`. Texto cru das 3 linhas de julho:

```
211689509 1.398,00  108 ESTOQUE D0 82374630   260,32 CANCELADO 28May2026 JJ552710 0,10% -R$ 1,40
212205929 24.050,00 108 ESTOQUE D0 82453122 4.602,52 CANCELADO 05Jun2026 JJ552710 0,10% -R$ 24,05
212146378 24.000,00 108 ESTOQUE D0 82442550 4.594,71 CANCELADO 03Jun2026 JJ552710 0,10% -R$ 24,00
```

Rótulo e sinal concordam em **100%** das 16 linhas. E há AUTO-ÂNCORA (`:443-449`):
Σ(calculo + debito) tem de bater o TOTAL do próprio PDF, senão o import ABORTA.
Medido: `calculo 204,52 + debito −49,45 = 155,07` = âncora `R$ 155,07`.

**O sistema não infla.** Os cancelados nunca entram em `daily_production_records`
(`seguroByContrato` recebe só `seguroCalculo`, `bbtsClosingImport.ts:322-323`) e são
persistidos como DÉBITO ao promotor (`:635-648` -> `resolveAdsCancelDebits`).

### Alcance medido (source_kind=DAILY_CANCEL, o caminho da ADS)

| competência | ops | Σ estorno | destino |
|---|---|---|---|
| 2026-06 | 2 | 41,53 | fila=2 (41,53) / debitados=0 |
| 2026-07 | 3 | 49,45 | fila=1 (1,40) / debitados=2 (48,05) |
| **TOTAL** | **5** | **90,98** | |

**PENDÊNCIA REAL:** os R$ 41,53 de junho (ops 209867885 e 209621970) estão na fila
com `promoter_id = null`, `status = PENDING`, desde 09/07/2026. Sem dono, ninguém
foi debitado. Não é defeito de parser — é fila sem tratamento.

## 7. REIMPORTAÇÃO DE 26/08 13:53 UTC — efeito medido

O Diego reimportou o fechamento ADS de julho com os 2 PDFs. Efeitos:
- `221262790` reancorada em `movement_date = 2026-07-15` -> voltou para competência
  **2026-07** (a diária a tinha empurrado para agosto — seção 3 deste handoff);
- PMR jul/26 recalculado: `com_seguro` 38,83 -> **83,54**, `com_final` 10.489,05 -> **10.533,76**;
- 2 dos 3 cancelamentos viraram débito ACTIVE (24,05 + 24,00);
- `bbts_seguro_pago` da linha só-seguro CONTINUA 0,00 — o defeito da seção 3 persiste.

## 8. FRENTE A — não existe filtro de `source` excluindo a ADS

Enumerei TODOS os sítios que filtram o PMR por `source`. **Todos já incluem 'bbts'.**

| # | arquivo:linha | filtro | ADS entra? |
|---|---|---|---|
| 1 | `lib/promoterAnalytics.ts:1403` | `closedSource === "cms" ? ["cms"] : ["fechamento","bbts"]` | SIM |
| 2 | `lib/dre.ts:486,499` | `.in("source", regimeSources)` idem | SIM |
| 3 | `app/api/metas/route.ts:62,93` | `.in("source", regimeSources)` idem | SIM |
| 4 | `app/api/commissions/proposals/route.ts:266` | `.in("source", ["fechamento","bbts"])` | SIM |
| 5 | `lib/closingProposalRows.ts:70` | `.in("source", ["fechamento","bbts"])` | SIM |
| 6 | `lib/financialAnalytics.ts:507` | `.neq("source","daily")` | SIM |

O sítio 6 é o do Caixa, e é o mais permissivo dos seis. **Somar 'bbts' ali é no-op.**

E o "Recebido" NÃO passa por nenhum desses: ele lê `fechamento_mensal_empresa`
(`financialAnalytics.ts:451-460`), tabela que **não tem coluna `source`** (colunas:
`empresa_cnpj, ano, mes, valor_*, operacoes, valor_nota_fiscal, created_at, updated_at`).
A ADS falta ali por AUSÊNCIA DE LINHA, não por filtro.

### Separações que SÃO deliberadas (não confundir)
- `semAds` (`app/api/calculate/monthly/route.ts:711`) — exclui a ADS da escrita do
  motor RR. Deliberada.
- `detectMonthRegime` ignora a ADS via `active=false` (`lib/cmsMonthly.ts:54`). Deliberada.

---

## 9. O SINAL NEGATIVO — verificado, não há defeito (26/08)

`parseBrNumber` **não existe no repo** (`grep -rn parseBrNumber lib app scripts` -> 0).
O parser de número é `money()`, e ele PRESERVA O SINAL de propósito, em dois passos:

```ts
lib/bbtsPdfExtract.ts:33-43
33:function money(raw: unknown): number {
34:  let s = String(raw ?? "").trim();
35:  if (s === "") return 0;
36:  const negative = s.includes("-");          // <- captura ANTES de limpar
37:  s = s.replace(/[^\d,.]/g, "");             // tira R$, sinais, espaços
...
42:  return negative ? -n : n;                  // <- restaura
43:}
```

Prova empírica com as strings reais do PDF:

```
money("-R$ 1,40")      = -1.4
money("-R$ 24,05")     = -24.05
money("-R$ 1.234,56")  = -1234.56
money("R$ 18.737,33")  = 18737.33
money("R$ -")          = 0        <- traço de "sem valor"
```

Os 8 chamadores de `money()`/`moneysIn()`/`pct()` estão em `:294, :326, :327, :329,
:385, :419, :435, :437`. Todos recebem grupos de regex estritamente monetários.

Os ÚNICOS `Math.abs` sobre VALOR no caminho são `debitInsuranceResolver.ts:170` e
`:389`, ambos convertendo estorno em MAGNITUDE POSITIVA para virar débito — correto
e deliberado (um débito de R$ 24,05, não de −24,05). Os `Math.abs` de
`bbtsPdfExtract.ts` são comparação de tolerância e distância de coordenada Y.

### Nunca houve negativo no crédito — medido

PDF de crédito de julho: `Cancelamento=SIM: 0`, `pag_avista < 0: 0`,
`valor_financiado < 0: 0`, `parcela PRT < 0: 0`.

Banco, TODAS as competências da ADS (97 linhas + 16 parcelas PRT):

```
gross_value < 0 : 0   net_value < 0 : 0   insurance_value < 0 : 0
bbts_pag_avista < 0 : 0   bbts_seguro_pago < 0 : 0   bbts_taxa_relatorio < 0 : 0
parcelas PRT negativas : 0
status: {"PRODUCAO":63,"Producao":34}   (as duas grafias sao normalizadas por
                                         isProductionStatus — ver bbtsDailyImport:313-317)
```

A coluna `Cancelamento` do crédito É lida (`bbtsPdfExtract.ts:345`,
`cancelamento: /^SIM$/i.test(m[9])`) e vira `status: "CANCELADO"`
(`bbtsClosingImport.ts:449`), o que tira a linha da produção. Tratada por STATUS,
não por sinal.

### O RISCO REAL É OUTRO: omissão, não perda de sinal

`Glosa` é um total de CABEÇALHO, não coluna por linha — e não é lida por ninguém
(seção 5a). Se a BBTS mandar Glosa != 0, o valor não será "inflado pelo abs": será
**ignorado inteiro**, e nenhuma âncora perceberá, porque nenhuma confere o
`Pagamento Total` declarado. O conserto continua sendo o da seção 5a.

### Aresta nomeada (não é defeito hoje)

`debitInsuranceResolver.ts:389` aplica `Math.abs` a QUALQUER linha `tratamento='debito'`.
Se a BBTS um dia mandar um `CANCELADO` com valor POSITIVO (estorno de estorno), o
`abs` transformaria um crédito ao promotor em débito. Hoje rótulo e sinal concordam
em 100% das linhas medidas, então não acontece.

---

## 10. POR QUE O DEFEITO NÃO ALCANÇA O PROMOTOR — desacoplamento acidental

**Conclusão do Diego (26/08): comissões de promotor corretas, ninguém recebeu a mais.**
Confirmado. Mas o MECANISMO não é o que parecia, e a diferença importa para o dia em
que a base mudar.

**NÃO é verdade que "o repasse de seguro da ADS não deriva da comissão-empresa".**
Ele deriva, e com a MESMA forma do RR (`lib/bbtsMonthly.ts:366`):

```ts
366:    const comPromotorSeguro = a.comEmpSeguro * seguroShare * fatorSeguro;
```

compare com o RR (`lib/bbtsOrchestrator.ts:88-90`):
```
//   repasse_seguro_rr = insurance_commission_value do fechamento RR
//                       `insuranceCommission = seguroEmpresa * seguroShare`
```

**O desacoplamento real está uma camada ACIMA**: a comissão-empresa da ADS é
RECALCULADA pela régua versionada sobre `insurance_value`, e nunca lê
`bbts_seguro_pago` (`lib/bbtsMonthly.ts:270-279`):

```ts
270:    const seguroBase = toNumber(r.insurance_value);   // <- a BASE segurada
271:    const tipo = meta.seguro_tipo ?? r.insurance_type;
272:    let comEmpSeguro = 0;
273:    if (seguroBase > 0) {
274:      const taxa = seguroRateFromRegra(regraSeguro, tipo, r.term_months);
...
278:        comEmpSeguro = seguroBase * taxa.rate;         // <- REGUA, nao o pago
```

Ou seja: **duas colunas, dois consumidores disjuntos.**

| coluna | quem lê | usada para |
|---|---|---|
| `insurance_value` (base segurada) | `bbtsMonthly.ts:270` | comissão-empresa -> repasse ao promotor |
| `bbts_seguro_pago` (o que a BBTS pagou) | `lib/dre.ts:321,348` + auditoria | RECEITA da empresa |

O defeito da seção 3 (R$ 89,42 fora de `bbts_seguro_pago` na linha só-seguro) não
alcança o promotor porque a cadeia do promotor **não passa por essa coluna** — e
`insurance_value` daquela linha ESTÁ preenchida (R$ 89.415,39).

**ISSO É DESACOPLAMENTO ACIDENTAL, NÃO PROTEÇÃO PROJETADA.** Nada no código impede
que alguém, amanhã, faça a comissão-empresa da ADS ler o valor PAGO em vez de
recalcular pela régua — o que seria até defensável (é o realizado). No dia em que
isso acontecer, o furo de `bbts_seguro_pago` passa a ser furo de REPASSE, e as
linhas só-seguro pagam a menos ao promotor. Consertar a seção 3 antes remove a mina.

## 11. FRENTE A — enumeração COMPLETA do filtro `source = 'cms'`

| # | arquivo:linha | forma | a ADS deve entrar? |
|---|---|---|---|
| 1 | `lib/promoterAnalytics.ts:1403` | `closedSource === "cms" ? ["cms"] : ["fechamento","bbts"]` | **NÃO** — ramos EXCLUSIVOS |
| 2 | `lib/dre.ts:486` | idem | **NÃO** — idem |
| 3 | `app/api/metas/route.ts:62-63` | `cms?["cms"] : open?["daily"] : ["fechamento","bbts"]` | **NÃO** — idem |
| 4 | `lib/cms/auditCmsVsPmr.ts:112` | `.eq("source","cms")` | **NÃO** — audita o SEED contra `cms_promoter_entries`; a ADS não está no seed |
| 5 | `lib/reconsolidarCompetencia.ts:60` | `SOURCES_RECONCILIAVEIS = {fechamento,bbts,daily}` — exclui `cms` | já inclui `bbts` |
| 6 | `lib/cmsMonthly.ts:79-88` | precedência `cms > fechamento` no regime | deliberada (`:52-54`) |

**Os sítios 1-3 não são "filtros que excluem a ADS": são SELETORES DE REGIME, e os
dois ramos são mutuamente exclusivos.** Quando o regime é `cms` (jan-mai/2026), o mês
INTEIRO lê o seed do financeiro — para RR e ADS igualmente. Somar `'bbts'` ao ramo
`cms` misturaria seed com recálculo, que é exatamente o que `cmsMonthly.ts:52-54`
proíbe:

```
// A ORDEM importa: jan-mai tem cms E fechamento; a precedencia cms > fechamento
// garante que aqueles meses continuem lendo o SEED do cms (nao recalculam pelo
// fechamento).
```

E não haveria o que ganhar: a ADS tem **UMA** linha `source='cms'` no banco inteiro —
`2026-02`, `production_value = 0,00`.

---

## 12. PORTÃO DO SINAL — `scripts/bbts_sinal_negativo_gate.cjs` (26/08)

`money()` já preservava o sinal; o que NÃO existia era vigia. Agora existe.
Registrado em `run_all_gates.cjs`, faixa `self-contained` (435ms), 18 asserções.

Importa `money` / `SEGURO_RE` / `CREDITO_RE` REAIS (exportados só para isto) e roda
sobre linhas COPIADAS dos PDFs de jun e jul/2026. Nenhuma constante congelada do
lado esperado.

**Mutação testada — o gate reprova de verdade:**

| mutação | resultado |
|---|---|
| `money()` -> `return Math.abs(n)` | **VERMELHO, 11 falhas** (`229.2 !== -229.2`) |
| tirar o `-?` do grupo 11 do `SEGURO_RE` | **VERMELHO, 5 falhas** ("NAO casou — a linha sumiria em silencio") |
| revertido | VERDE |

A 2ª mutação é a mais perigosa e a menos óbvia: sem o `-?`, a linha cancelada não
CASA o regex e é **descartada em silêncio** — não vira zero, some. A auto-âncora do
seguro (`:443-449`) pegaria, mas só depois; o gate pega antes.

## 13. VARREDURA DE TODAS AS COMPETÊNCIAS EM DISCO

Varri os 12 PDFs da ADS em `Downloads` (`scripts/diag-ads-29-varredura.cjs`).
Fechamentos de crédito legíveis: **junho** (`Crédito ADS-BBTS.pdf`, 19 linhas) e
**julho** (`pdf (1).pdf`, 43 linhas). Os de maio e o "COMPLEMENTAR JUNHO" são NOTAS
FISCAIS (começam em "TOMADOR DE SERVIÇOS"), e os `Tabela_de_Pagamento_*` são a TRP.

| competência | Cancelamento=SIM | pag_avista < 0 | valor_financiado < 0 | Glosa |
|---|---|---|---|---|
| 2026-06 | 0 | 0 | 0 | vazio (`R$ -`) |
| 2026-07 | 0 | 0 | 0 | 0,00 |

**O crédito NUNCA veio negativo nem cancelado. Não há inflação de crédito.**
Confirmado também no banco: 0 negativos em 6 campos × 97 linhas × todas as
competências, e 0 parcelas PRT negativas.

### ACHADO NOVO — o cabeçalho MUDA DE LAYOUT entre competências

```
JUNHO:  Pagamento AVT | Pagamento PRT | Abertura de Conta | Valor Descontado | Pagamento Total
        R$ 7.707,03   | R$ 7,01       | R$ -              | -R$              | R$ 7.714,04

JULHO:  Pagamento AVT | Pagamento PRT | Abertura de Conta | Glosa            | Pagamento Total
        R$ 18.737,33  | R$ 7,01       | R$ 100,00         | R$ 0,00          | R$ 18.844,34
```

A 4ª coluna foi RENOMEADA — "Valor Descontado" (jun) -> "Glosa" (jul) — e junho usa
`R$ -` / `-R$` como placeholder de vazio.

**CONSEQUÊNCIA PARA O CONSERTO DA SEÇÃO 5a:** ler o cabeçalho por NOME DE COLUNA
quebra entre meses, e ler por POSIÇÃO ("o 3º R$ da linha") também — porque o regex
de dinheiro exige dígitos e os placeholders `R$ -` / `-R$` NÃO casam, deslocando
tudo. Foi exatamente o erro que minha 1ª varredura cometeu (leu ABERTURA=7.714,04
em junho, que na verdade é o TOTAL). O conserto tem de casar RÓTULO->VALOR por
pareamento, tolerando placeholder, e conferir contra o `Pagamento Total`.

---

## 14. PORTÃO DA FRENTE A — `scripts/ads_no_regime_fechado_gate.cjs` (26/08)

Os 6 sítios já aceitavam `'bbts'`, então não havia conserto. O que NÃO existia era
vigia: nada impedia o PRÓXIMO leitor de nascer só com `'fechamento'` — e a ADS
sumiria daquela tela em silêncio, sem erro e sem linha faltando, só um número menor.
Foi exatamente essa a suspeita que abriu a frente.

Duas partes, ambas lendo os arquivos REAIS (nenhuma lista congelada de esperado):

- **(A)** os 6 sítios mapeados + a forma PERMISSIVA do Caixa (`.neq("source","daily")`).
  Estreitar para `.eq("source","fechamento")` tiraria a ADS do Caixa sem sintoma.
- **(B)** VARREDURA de `lib/` e `app/` (256 arquivos): reprova qualquer array literal
  que cite `"fechamento"` sem `"bbts"`, e qualquer `.eq("source","fechamento")` —
  **inclusive em arquivo que ainda não existe**. É a regra "enumerar por exaustão"
  virada em portão.

**Mutação testada:**

| mutação | resultado |
|---|---|
| tirar `'bbts'` de `lib/dre.ts:486` | **VERMELHO, 2 falhas** — (A) e (B); a (B) nomeia `lib/dre.ts:486` |
| Caixa -> `.eq("source","fechamento")` | **VERMELHO, 2 falhas** |
| revertido | VERDE |

### O que este gate DELIBERADAMENTE não vigia

- `semAds` (`app/api/calculate/monthly/route.ts:711`) — exclui a ADS da escrita do
  motor RR de propósito.
- `detectMonthRegime` ignorar a ADS via `companies.active = false`
  (`lib/cmsMonthly.ts:54`: "as 4 RR bastam").
- o ramo `cms` dos seletores de regime — jan-mai/2026 lê o SEED do financeiro;
  somar `'bbts'` ali recalcularia por cima do ground truth (`cmsMonthly.ts:52-54`).
  A ADS tem 1 linha `source='cms'` no banco, com produção R$ 0,00.

Estão nomeadas no cabeçalho do próprio gate, para que ninguém "conserte" as três.

---

## 15. O CARD "Recebido" — a soma do Diego reproduzida AO CENTAVO (26/08)

`scripts/diag-ads-31-card.cjs` reproduz `cashReceivedFor(2026, 8)` e testa os cenários.

```
=== CARD 'Recebido' ago/26 — AGORA (4 empresas RR) ===
  receivedLiquido  = 283.908,16
  receivedProdutos =  15.828,66
  receivedNet      = 299.736,82   <- o que a tela mostra
  do qual: a-vista 227.393,93 | diferido(PRT) 51.806,30 | seguro 5.131,69
```

**O card NÃO é "crédito bruto à-vista"** — o rótulo mente. Ele soma à-vista +
diferido/PRT + seguro + os 6 produtos. Logo o análogo da ADS é o TOTAL PAGO
(R$ 18.999,41), não só a parte à-vista.

```
=== CENARIOS ===
  hoje                                             299.736,82
  + ADS so com o que esta em COLUNA                318.596,26  (+6,29%)
  + ADS com seguro do raw_payload (conserta 89,42) 318.685,68  (+6,32%)
  + ADS com o TOTAL do PDF (precisa Abertura)      318.736,23  (+6,34%)

  soma a mao do Diego                              318.736,23
```

**O cenário 3 bate a soma do Diego AO CENTAVO.** A conta dele era o caixa + o total
do PDF da ADS. Investigação fechada.

### TETO SEM MIGRATION: R$ 318.636,23

Decomposição do que falta em cada cenário:

| peça | valor | onde está no banco |
|---|---|---|
| AVT | 18.737,33 | `daily_production_records.bbts_pag_avista` |
| PRT | 7,01 | `bbts_prt_parcelas.valor_parcela` |
| seguro `calculo` | 204,52 | 115,10 em coluna + **89,42 só no `raw_payload`** (seção 3) |
| seguro `debito` | −49,45 | `promoter_debit_assignments` + `promoter_debit_sources` |
| **Abertura de Conta** | **100,00** | **NENHUM lugar — não existe coluna** |

`18.737,33 + 7,01 + 204,52 − 49,45 = 18.899,41` -> card = **R$ 318.636,23**.

Os R$ 100,00 **não têm onde morar**. Chegar aos R$ 318.736,23 exatos exige:
1. capturar Abertura de Conta e Glosa do cabeçalho (seção 5a, com o pareamento
   rótulo->valor da seção 13, porque o layout muda entre meses);
2. **uma coluna nova para guardá-los => MIGRATION**;
3. só então a rota do caixa somar a ADS.

O passo 2 é decisão do Diego. Sem ele, o teto é 318.636,23 (R$ 100,00 a menos).

### E ISTO NÃO É O FILTRO `source`

O card lê `fechamento_mensal_empresa` (`financialAnalytics.ts:451-460`), que **não
tem coluna `source`** e não passa por nenhum dos 6 sítios de regime. Nenhuma mudança
em filtro de `source` — `'cms'`, `'bbts'` ou qualquer outro — move este número em
um centavo. O que falta é a ADS ter LINHA/CAMINHO no caixa, não passar num filtro.

---

## 16. DECISÃO 26/08 — a ADS NÃO entra no card "Recebido" por enquanto

**Decisão do Diego.** O código que a incluía foi escrito, medido e REVERTIDO. Está
preservado em `docs-ads-caixa.patch` (aplicável com `git apply`), e o efeito medido
em ago/26 era:

| campo | sem ADS | com ADS | delta |
|---|---|---|---|
| Recebido | 299.736,82 | 318.596,26 | +18.859,44 (+6,29%) |
| Comissões recebidas | 232.525,62 | 251.378,05 | +18.852,43 (+8,11%) |
| Seguro recebido | 5.131,69 | 5.246,79 | +115,10 (+2,24%) |

### O MOTIVO REGISTRADO NÃO SOBREVIVEU À MEDIÇÃO — registrar isso importa

O motivo dado foi "somar pagamento da ADS a valor FINANCIADO do RR seria misturar
grandezas". **Medido (`scripts/diag-ads-33-grandeza.cjs`), não é o que o card faz:**

```
RR  jul/26: valor_avista    227.393,93  sobre financiado 5.957.691,80  ->  3,82%
ADS jul/26: bbts_pag_avista  18.737,33  sobre financiado   547.798,35  ->  3,42%

repasse liquido aos promotores jul = 141.116,15
repasse / (valor_avista + valor_seguro) = 60,69%   <- so faz sentido se for COMISSAO
```

`fechamento_mensal_empresa.valor_avista` é **comissão da empresa**, não desembolso.
Se fosse volume financiado, o card de ago/26 mostraria R$ 5,96 milhões, não
R$ 299 mil. As duas pontas são a MESMA grandeza (~3,8% e ~3,4% de comissão sobre
financiado), e somá-las seria maçã com maçã.

**Fica registrado assim de propósito:** se alguém reabrir esta frente citando
"mistura de grandezas" como impedimento, o impedimento não existe — a medição está
acima. O que existe é uma decisão, que pode ser revista.

### O que É verdade e continua aberto

1. **O rótulo "crédito recebido (bruto)" está errado HOJE, para o RR.** O card soma
   à-vista (227.393,93) + diferido/PRT (51.806,30) + seguro (5.131,69) + os 6
   produtos. Não é "crédito", não é só "à-vista", e não é caixa — é comissão
   reconhecida na competência M-1. Corrigir o rótulo é frente própria.
2. **A cobertura segue incompleta**: o grupo tem 5 empresas e o card mostra 4. O DRE
   mostra as 5 (`lib/dre.ts:314-365`). Duas telas do mesmo sistema, respostas
   diferentes para a mesma competência — isso permanece.
3. Se a ADS entrar um dia, os R$ 139,97 das seções 5a e 3 continuam faltando
   (Abertura de Conta R$ 100,00 sem coluna no banco; seguro só-seguro R$ 89,42 só
   no `raw_payload`).

### PROVA de que não há dupla contagem no `receivedEmpresa`

`bbts_avista_total` **não existe no repo** (`grep -rn` em `.ts/.tsx/.cjs/.sql` -> 0
ocorrências). `receivedEmpresa` (`financialAnalytics.ts:380-382`) soma
`valor_avista + valor_seguro` das linhas de `fechamento_mensal_empresa` da
competência M-1 — e a ADS **nunca teve linha** nessa tabela (0 no histórico inteiro).

Medido depois da reversão: `receivedEmpresa` ago/26 = **R$ 232.525,62**, idêntico ao
valor de antes de qualquer alteração (delta 0,00). Não há caminho por onde a ADS
entre uma vez, quanto mais duas.

E os 6 sítios que filtram o PMR por `source` **não alimentam o `receivedEmpresa`** —
ele não lê o PMR, lê `fechamento_mensal_empresa`. Travado pelo
`ads_no_regime_fechado_gate.cjs`.

---

## 17. `bbts_prt_parcelas` — RLS default-deny, e isso NÃO estava documentado fora da migration

**Quebrou /financeiro em 26/08/2026.** Ao incluir a ADS no Caixa, li
`bbts_prt_parcelas` com o cliente do guard — e a tela inteira caiu com
`42501 permission denied for table bbts_prt_parcelas`.

### O que a tabela é

`supabase/migrations/20260712_000004_bbts_prt_parcelas.sql:40`:

```sql
alter table bbts_prt_parcelas enable row level security;   -- default-deny: sem policy
```

O cabeçalho da migration: *"RLS default-deny (só service_role)"*. A verificação
pós-execução até prevê `select count(*) from pg_policies where tablename='bbts_prt_parcelas'; -- 0`.

**É intencional. Mas está documentado SÓ dentro da migration** — um arquivo que
ninguém abre ao escrever uma tela. Todos os leitores anteriores usam service_role
(`lib/dre.ts:352` via `withSocioAdmin`, `conferenciaBbts.ts:394`,
`sobraCaixa.ts:102`, `bbtsClosingImport.ts:622`), então o buraco nunca aparecera.
**Qualquer leitura futura dela pelo caminho da página vai quebrar igual.**

### O cliente das telas

`app/api/financeiro/route.ts:109` -> `withSocioOrFuncionarioAnon()` ->
`createSupabaseServerClient()` = chave ANON + cookie => papel `authenticated`, RLS
ativo. As QUATRO rotas que chamam `buildFinancialAnalytics` usam guard anon
(`/api/financeiro`, `/api/recebiveis`, `/api/relatorios`, `/api/relatorios/export`),
então o erro alcançava todas.

### Estado de permissão das duas tabelas que a mudança introduziu

| tabela | grant p/ `authenticated` | evidência |
|---|---|---|
| `daily_production_records` | **SIM** | Dashboard lê pelo caminho anon (`app/api/dashboard/route.ts:238` -> `:330/:347/:362`) |
| `bbts_prt_parcelas` | **NÃO** | migration `:40`, 0 policies, só service_role |

NOTA: `bbts_pag_avista` **não é tabela** — é COLUNA de `daily_production_records`.
É por isso que "funciona": pega carona numa tabela que já tem grant.

### O CONTEXTO (padrão repetido)

A memória do projeto registra que `bbts_rule_versions` já teve ZERO políticas e
**zerou comissões de seguro em produção SILENCIOSAMENTE**. O padrão é o mesmo —
tabela da ADS sem política — mas o desfecho foi melhor: aqui falhou ALTO, com
42501 e a tela fora do ar, em vez de devolver zero linhas e um número errado.
Tabela vazia por RLS e tabela sem grant falham DIFERENTE: a primeira mente, a
segunda grita. `bbts_prt_parcelas` grita porque não tem grant, não só policy.

### O conserto (decisão do Diego, opção b)

`buildFinancialAnalytics` lê as DUAS fontes da ADS por `getSupabaseAdmin()`
dirigido — não pelo cliente da página. Não é escalada de privilégio: a
AUTORIZAÇÃO segue no guard de cada rota; muda só o canal de leitura de dois
agregados. Mesmo padrão de `app/api/dre/route.ts:8-13` e `promotores/route.ts:98`.

Rejeitada a alternativa de abrir policy: é a única tabela do grupo deliberadamente
fechada, e afrouxar isso de passagem num conserto de card merece contexto próprio.

**NÃO foi possível fazer pelo PMR**, como se cogitou: `bbts_prt_total` e
`bbts_avista_total` **não existem** em `promoter_monthly_results` (medido), e os
agregados que existem são de outra grandeza — `production_commission_value` da ADS
em jul/26 é R$ 10.450,19 (comissão do PROMOTOR), não os R$ 18.737,33 que a BBTS
pagou à EMPRESA.

Travado por `scripts/ads_caixa_sem_rls_gate.cjs` (faixa needs-db): cliente espião
que estoura se o cliente da página tocar tabela restrita, e que ainda exige que a
ADS continue no número — para "não ler" não virar "remover". Mutação provada:
voltar a ler pelo cliente da página derruba o gate com 3 falhas.

### Gate existente atualizado, não aposentado

`scripts/test_caixa_recebido_empresa.cjs` foi de **6/6 para 3/6** com a mudança — as
três asserções do bloco (a) descreviam a COMPOSIÇÃO antiga (`valor_avista + valor_seguro`,
só as 4 RR). Seguindo a regra "varrer antes de aposentar": as de (b) e (c) são
INVARIANTES e ficaram intactas; só as de (a) foram reescritas para a composição nova,
com o lado esperado computado NO PRÓPRIO RUN (nenhuma constante congelada). Agora
**8/8** — duas asserções a MAIS que antes:
  - "o SEGURO ficou de FORA do receivedEmpresa (decisão 26/08)"
  - "a ADS ENTRA no receivedEmpresa (o conserto não virou remoção)"

**As outras 4 falhas da faixa `--db` NÃO são desta frente** — nenhuma importa
`financialAnalytics` (`grep -c` = 0 em `produto_pmr_empresa_dona_gate.cjs`,
`reatribuicao_precedencia_gate.cjs`, `gate-srcc-ads.mts`, `check_audit_v9_tables.cjs`).
A memória do projeto já registrava `gate-srcc-ads` vermelho antes. A faixa também
estourou o teto de tempo (238,1s de 90s) — dívida anterior, agravada em 1,6s pelo
gate novo.

---

## 18. OS DOIS RÓTULOS DE SEGURO — a relação inverteu num, não no outro

Quando o seguro saiu do "Recebido" (decisão 26/08), o subtítulo do card
**"Seguro recebido"** ficou FALSO. Ele dizia *"do qual das 'comissões recebidas'"* —
e "do qual" afirma SUBCONJUNTO. Com o seguro fora do `receivedNet` E do
`receivedEmpresa`, ele deixou de ser parte do total e virou **parcela independente**:
para saber o que a empresa recebeu no mês, o leitor tem de SOMAR os dois. É por isso
que **"a mais"** é o certo: "do qual" mandava não somar, "a mais" manda somar.

Novo: `"a mais das 'comissões recebidas' — mês anterior"` (`page.tsx:306`).

### O card GÊMEO **não** inverteu — e rotulá-lo igual seria erro

`"Seguro repassado"` continua sendo **"do qual"** das "comissões pagas". Medido:

```
Comissoes pagas       = 139.451,16
Seguro repassado      =   2.309,77   == Sigma insurance_commission_value (exato)
final_commission_value = producao 132.671,58 + seguro 2.309,77 + produtos 6.134,80
```

`paidInsuranceShare` é `Σ insurance_commission_value`, e `final_commission_value`
(base do `comissoesPagas`) JÁ o inclui — o próprio código diz, em
`financialAnalytics.ts`: *"INFORMATIVO: 'do qual seguro' do repasse — subcomponente
do comissoesPagas"*. Trocar para "a mais" faria o leitor somar R$ 2.309,77 em cima
de R$ 139.451,16 e superestimar a saída.

**A assimetria é real e tem causa:** o seguro saiu do lado RECEBIDO (decisão de
grandeza) e continua dentro do lado PAGO (o promotor recebe comissão de seguro
dentro do repasse). Dois cards com nome parecido e relação oposta com o seu total —
por isso os subtítulos precisam ser diferentes. Registrado aqui para não ser
"uniformizado" por engano.
