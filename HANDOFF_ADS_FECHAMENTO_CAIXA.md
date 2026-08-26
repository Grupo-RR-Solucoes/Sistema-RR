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
