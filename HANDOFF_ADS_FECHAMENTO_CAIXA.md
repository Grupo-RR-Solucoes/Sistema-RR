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

**POR QUE NÃO FOI CONSERTADO NA TELA.** `daily_imports` não tem coluna de tipo.
Colunas medidas: `id, file_name, import_date, status, rows_count, processing_notes,
created_at, finished_at`. Filtrar por tipo na tela exigiria:
  (a) coluna nova (`kind`/`tipo`) => MUDANÇA DE ESQUEMA; ou
  (b) heurística por extensão do nome do arquivo => frágil (o nome vem do browser:
      "pdf (1).pdf"), e quebraria no dia em que uma diária vier em PDF.
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
