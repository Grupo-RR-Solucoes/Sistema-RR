# O1 — data de contratação some nas linhas da ADS

Bloco A da ordem do Diego (29/07/2026), ramificado de `feat/srcc-ads` em `303c1f9`.
Commit único. **Não pushado.**

---

## O defeito

A diária viva da ADS grava `movement_date` e deixa `contract_date` **NULO** —
o arquivo da BBTS não tem coluna de contratação (`lib/bbtsDailyImport.ts:285-286`).
Os pontos de exibição que liam `contract_date` sem fallback mostravam `-`.

Medido em produção, competência 2026-07 (leitura pura):

```
linhas ADS elegíveis (produção, sem SRCC) ..... 35
contract_date NULO ........................... 35/35
movement_date presente ....................... 35/35
```

## O conserto — lado LEITURA, nunca gravação

`contract_date || movement_date` no ponto de exibição. É a convenção que o repo
já usava em `lib/report.ts:696`, `:1453`, `lib/promoterAnalytics.ts:1539`,
`app/api/dashboard/route.ts:574` e `app/api/calculate/monthly/route.ts:1292` —
só três consumidores tinham ficado de fora.

**NÃO se conserta preenchendo `contract_date` na gravação.** A semântica ("data
real de venda") é reservada e não há fonte; é a mesma decisão que
`lib/bbts/conferenciaBbts.ts:373-374` registrou no FIX 2.3.

| arquivo:linha | efeito hoje |
|---|---|
| `app/promotores/PromotoresClient.tsx:2228` | **35/35 linhas saem de `-` para data real** |
| `app/comissoes/editar/page.js:1142` | nenhum — as linhas desta tela são RR, e o RR traz `contract_date` em 599/599 em julho. Entra por ser o MESMO defeito na MESMA fonte |
| `lib/report.ts:1019` (XLSX `DataContratacao`) | coluna deixa de sair vazia nas linhas da ADS. O PDF já tinha o fallback; só o XLSX ficou de fora |

Gate: `tsc --noEmit` 0 erros. Verificação em produção pela lib real
(`buildPromoterAnalytics`, `TRP_SOURCE=db`): 35/35 linhas mudam de `-` para data.

## O que este commit NÃO muda

`% Promotor` e `Comissão promotor` seguem **0,00% / R$ 0,00** nas 35 linhas.
Não é efeito colateral: é outro defeito, de outra família, e está no Bloco B.
Produção líquida R$ 367.977,53 e comissão-empresa R$ 11.360,71 inalteradas.

---

## ÓRFÃOS DA MESMA FONTE QUE FICARAM DE FORA

Regra permanente do Diego (29/07/2026): órfão conhecido entra na frente ou vem
para o handoff **nomeado**. Nunca some. Estes são os que sobraram.

### a) Sem fallback possível — a fonte não tem NENHUMA das duas datas

| arquivo:linha | por quê | dano |
|---|---|---|
| `lib/closingProposalRows.ts:129-130` | grava `movement_date: null` **e** `contract_date: null` nas linhas do fechamento RR | no mês FECHADO a data some na carteira e no PDF do promotor, e nenhum consumidor consegue consertar — o conserto é na origem |
| `lib/promoterReportData.ts:114-116` | linha cms: `movement_date: null` por construção; `contract_date` vem do `raw_payload` | mês cms sem "DATA CONTRATACAO" no payload → data vazia, sem fallback |

### b) Caminho de DINHEIRO, não de exibição — Bloco B/D

Estes leem `contract_date` sozinho para decidir **competência da TRP** ou
**janela de apuração**. Consertar aqui muda número, então não entra no Bloco A.

| arquivo:linha | o que quebra na ADS |
|---|---|
| `lib/motor.ts:512-521` `competenciaDoContrato` | `mes = null` → `regraGate = null` → o tíquete mínimo cai no hardcode e o lookup da TRP não resolve célula: a ADS é calculada pelo fallback `CREDIT_RULES`, não pela régua da vigência |
| `lib/promoterAnalytics.ts:1017` | preload do `trpProvider` a partir de `record.contract_date` — não pré-carrega a competência das linhas ADS |
| `app/api/dashboard/route.ts:825` | idem, no recorte do delta |
| `app/api/calculate/monthly/route.ts:941` | idem (mitigado: injeta `${comp}-15` no preload) |
| `lib/recebiveis/avistaProducao.ts:147-150` | filtro SQL `.gte/.lte("contract_date")` — a ADS **não existe** para o à-vista previsto |
| `lib/auditoriaAvistaViva.ts:322` | a ADS sai do `dailyMes` → a faixa cai para o proxy do fechamento e a lane produzido-não-pago não vê ADS |
| `lib/trp/creditAvistaTrp.ts:127, 213` | retorna `null` sem `contract_date` |

### c) Fora desta fonte, mas na mesma tela e já medido

`promoter_commission_percent` / `_amount` = 0 em **35/35** linhas ADS de julho.
Causa: o motor mensal exclui a ADS (trava `semAds`) — já registrado em
`lib/promoterAnalytics.ts:1669-1677` — e a aba de propostas lê a coluna crua em
`:1667-1668` em vez do PMR/BBTS-2d, que é onde a comissão da ADS mora.
**Primeiro item do Bloco B**, por decisão do Diego.
