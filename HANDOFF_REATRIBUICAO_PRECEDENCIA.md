# Reatribuição manual: o DIÁRIO vence a CHAVE J

Medido e implementado em 23/08/2026. Branch `feat/higiene-4-frentes`.

> **REGRA (confirmada por Diego):** quando uma proposta é reatribuída manualmente,
> a produção pertence a quem **RECEBEU** a reatribuição. Nunca a quem tem a
> Chave J.

---

## 1. A causa

`monthly_closing_entries` **não tem coluna de promotor** — o arquivo da Promotiva
só traz a CHAVE J. O diário (`daily_production_records`) tem
`assigned_promoter_id`, que é o campo que o financeiro edita pela tela ao
reatribuir (trilha em `proposal_reassignments`).

O fechamento consultava o diário **apenas para o contrato órfão de chave master**
(`contratos.filter(c => !c.promoterId && ...)`) e, para todo o resto, a chave J
tinha a última palavra. Como a chave J continua no dono **original**, toda
reatribuição promotor→promotor era **desfeita** na consolidação do PMR.

## 2. O dano medido (jul/2026)

5 contratos, **R$ 49.105,56** de produção no dono errado. Todos reatribuídos
antes da importação do fechamento (04/08).

| contrato | chave J | empresa | líquido | dono da chave (errado) | quem recebeu (certo) |
|---|---|---|---|---|---|
| 214022989 | JH138321 | RR PERNAMBUCO | 25.000,00 | CARLA MIRELLE | MONICA PEREIRA |
| 219314256 | JH138321 | RR PERNAMBUCO | 14.000,00 | CARLA MIRELLE | MONICA PEREIRA |
| 219262430 | JJ211412 | RR ALAGOAS 3 | 9.000,00 | TACIANA | MATHEUS AVELINO |
| 219315418 | JH138321 | RR PERNAMBUCO | 645,56 | CARLA MIRELLE | MONICA PEREIRA |
| 221184463 | JH138321 | RR PERNAMBUCO | 460,00 | CARLA MIRELLE | JÉSSICA DE ALBUQUERQUE |

Delta de produção: CARLA **−40.105,56** · MONICA **+39.645,56** · TACIANA
**−9.000,00** · MATHEUS **+9.000,00** · JÉSSICA **+460,00**.

**É o dano inteiro de 2026.** Das 311 linhas de `proposal_reassignments`, só 5
são promotor→promotor com origem não-master, todas em 2026-07. As demais
(2026-04: 38, 2026-06: 67, 2026-08: 79) são master→promotor, que a herança já
honrava.

## 3. O conserto

Precedência **invertida** e extraída para **uma** função, em `lib/herancaMaster.ts`:

- `buildDonoDoDiarioMap(...)` — recebe as linhas do fechamento e devolve
  `Map<"empresa|contrato", promoter_id>` a partir do diário, na competência pela
  **janela**. Não sabe o que é chave master: quem decide o recorte é o chamador,
  e agora o chamador passa **todas** as linhas.
- `resolvePromotorEfetivo(linha, dono)` — diário primeiro, chave J como
  **fallback**, `null` quando nenhum dos dois resolve.

Consumidores (os três chamam o mesmo helper, ninguém reimplementa):

| arquivo | o que consolida |
|---|---|
| `lib/closingMonthly.ts` (`consolidateMonthlyFromClosing`) | PMR do fechamento |
| `lib/closingMonthly.ts` (`resolveDonaCompanyForPromoter`) | empresa dona do débito master |
| `lib/closingMonthly.ts` (`addSeguroAvulso`) | aba INSURANCE/"A Vista" |
| `lib/bbtsOrchestrator.ts` (bloco A) | produção RR consolidada RR+ADS |

**O FALLBACK NÃO É OPCIONAL.** O diário só começa em **2026-03-31**. As
competências 2026-01/02/03 e 2026-05 têm **2.787 linhas de fechamento sem
nenhuma linha no diário**; sem o fallback essa produção evaporaria.

## 4. Dry-run — `scripts/diag-reatribuicao-dryrun.mts`

**Parte A** (2026-01 a 2026-08, regra velha × regra nova, linha a linha):

```
2026-01   0 linhas mudam        2026-05   0 linhas mudam
2026-02   0 linhas mudam        2026-06   0 linhas mudam
2026-03   0 linhas mudam        2026-07   5 linhas, R$ 49.105,56, 5 promotores
2026-04   0 linhas mudam        2026-08   sem fechamento CASH
```

**Parte C — convergência com a planilha manual que pagou julho:**

| promotor | planilha do financeiro | PMR gravado | com o conserto |
|---|---|---|---|
| CARLA MIRELLE | 73.468,54 | 113.574,10 | **73.468,54** |
| MONICA PEREIRA | 164.984,77 | 125.339,21 | **164.984,77** |

Bate ao centavo. O dinheiro que saiu está do lado certo; era o PMR que estava
errado.

**Parte B — repasse de julho no consolidador real (dryRun), contra o gravado:**

| promotor | delta | origem |
|---|---|---|
| MONICA PEREIRA | +986,21 | esta frente |
| CARLA MIRELLE | −425,49 | esta frente |
| MATHEUS AVELINO | +175,34 | esta frente |
| TACIANA | −175,34 | esta frente |
| JÉSSICA | +6,54 | esta frente |
| JUSSARA | +734,96 | janela da herança (`5b7f229`) |
| CLEVITON | +278,99 | janela da herança |
| REBECA | +203,78 | janela da herança |
| CAMILA GOMES | +138,90 | janela da herança |
| GLEICE KAMILA | +89,89 | janela da herança |
| MARIA LETICIA | −0,01 | arredondamento |

**Soma: +R$ 2.013,76.** Dois efeitos somados: esta frente (+567,26) e o conserto
da janela da herança (+1.446,52, commit `5b7f229` de 17/08 — posterior ao cálculo
do PMR de julho, que é de 2026-08-14 13:03). Os dois convergem para a planilha.

**NADA FOI GRAVADO.** Reprocessar julho é decisão separada do Diego.

## 5. Gate — `scripts/reatribuicao_precedencia_gate.cjs`

Registrado em `run_all_gates.cjs` como `needs-db` (3,8s). Quatro blocos, os dois
lados no mesmo run:

1. **PURO** — a precedência do helper (7 asserções, sem banco).
2. **REGRA VELHA** — reimplementa a precedência antiga e prova que ela punha os
   5 contratos medidos no dono da chave, e que a nova os põe em quem recebeu.
   Anti-vacuidade: exige os 5 contratos presentes, o líquido de 49.105,56, e o
   mapa novo estritamente maior que o velho (711 × 57). Assere ainda que em
   jul/2026 mudam **exatamente 5** linhas — nem mais.
3. **FALLBACK** — 2026-01 (635 linhas, 559 resolvendo pela chave J, 0 no diário):
   **zero** linhas mudam de dono.
4. **SEM DUPLICATA** — os consumidores chamam `resolvePromotorEfetivo`, não têm
   a precedência antiga escrita à mão nem recorte por `key_type === "MASTER"`.

## 6. DÍVIDA SEPARADA — NÃO consertada aqui

**`lib/lideranca/baseLideranca.ts:307-321`** resolve promotor por chave J e é o
**pior** dos sítios:

```ts
const pid = r.j_key ? promotorDaChave.get(String(r.j_key)) : undefined;
if (!pid || !ids.has(pid)) continue;
```

- **sem `key_type`** — chave MASTER cai no promotor-balde como se fosse gente;
- **sem herança master** — nem a herança que o fechamento sempre teve;
- **sem normalização de caixa** — `promotorDaChave` é indexado por `String(k.j_key)`
  cru, enquanto todos os outros sítios usam `.toUpperCase()`.

Não está no caminho do PMR (alimenta a remuneração de liderança) e por isso ficou
de fora desta frente. **Frente própria.** Antes de mexer, medir o alcance: a régua
de liderança é versionada (`leadership_rule_versions`) e tem dois regimes.

Outros sítios com a mesma precedência invertida, fora do PMR, já mapeados:

- `lib/debitInsuranceResolver.ts:145,185-190` — chave J INDIVIDUAL ganha do
  `assigned_promoter_id`; tem porém uma escapatória que o fechamento não tinha
  (atribuição manual em `promoter_debit_assignments` vence tudo, `:182-184`).
- Caminho **cms** (jan–mai): `lib/cmsImport.ts:374-390` resolve por chave J **no
  import** e congela `promoter_id` em `cms_promoter_entries`; `lib/cmsMonthly.ts:174-200`
  agrega por essa coluna. Ali a decisão está cristalizada em tabela, não em
  código — consertar exigiria reprocessar o import, não mudar a régua.

## 7. Como reproduzir

```
node scripts/reatribuicao_precedencia_gate.cjs      # gate (banco)
npx tsx scripts/diag-reatribuicao-dryrun.mts        # dry-run 2026-01..08 (não grava)
node scripts/heranca_master_janela_gate.cjs         # a janela continua verde
npx tsc --noEmit && npm run typecheck:gates && npm run build
```
