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
