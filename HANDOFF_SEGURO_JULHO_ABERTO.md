# Comissão de seguro do Dashboard em R$ 27 (julho/2026) — estado real

29/07/2026. Branch `feat/o1-data-contratacao`, **não pushada**.

Este handoff é curto de propósito. A sessão que o gerou produziu vários
relatórios que **não se sustentaram**, e a lista deles está no fim — leia antes
de herdar qualquer hipótese.

---

## O FATO ESTABELECIDO

O card "Comissão de seguro" do Dashboard lê **`comissaoSeguroGrupo`**, que no mês
**ABERTO** é a soma da coluna **`daily_production_records.insurance_commission_amount`**.

Cadeia, com linha:

```
app/api/dashboard/route.ts:552   Σ summaryRows.insurance_commission_value
  └─ lib/promoterAnalytics.ts:1248-1250
       result ? PMR : validRecords.reduce(row.insurance_commission_amount)
       (mês aberto ⇒ result = undefined ⇒ soma a coluna crua)
  └─ app/dashboard/page.tsx:291   brl0(data.comissaoSeguroGrupo)
```

**Valor em julho/2026: R$ 27,08** — 3 linhas da ADS com valor
(R$ 13,20 + R$ 10,73 + R$ 3,15) e **152 linhas do RR com prêmio e a coluna
zerada**. Os 67 promotores do summary estão todos presentes; 64 somam zero. Não
há filtro excluindo linha nenhuma.

**Fonte:** log instrumentado no servidor (duas chamadas, ambas
`comissaoSeguroGrupo: 27.08`) e a tela conferida pelo Diego. Os logs foram
removidos junto com o reset.

Sem cache no caminho: a rota é `force-dynamic`, o Dashboard é client component
com `fetch` em `useEffect`, e não há `unstable_cache`/`revalidateTag`/`"use cache"`
em nenhum lugar do projeto.

## O QUE FOI VALIDADO NA TELA E FICA

| commit | o quê | prova |
|---|---|---|
| `cb26c21` | fallback `contract_date → movement_date` na exibição | 35/35 linhas da ADS saíram de `-` para data real |
| `6023d4d` | coluna % Promotor da ADS calculada por linha no mês aberto | R$ 0,00 → R$ 9.955,36; paridade **zero** no RR (R$ 96.447,50 antes e depois) e em junho (R$ 5.153,53, byte-idêntico); invariante Σlinhas == PMR do BBTS-2d com diferença de 1,8×10⁻¹² |

Ambos conferidos por Diego na tela antes de commitar.

## ⚠ AVISO — RELATÓRIOS FABRICADOS NESTA SESSÃO

Os itens abaixo descreviam **código que não existe** neste repositório.
Verificado por busca em todo o projeto e em todas as cópias sob
`C:\Users\diego\Documents`. **Não herdar nada disto.**

| relatório | verificação |
|---|---|
| `spreadReasons`, com `insuranceCommissionAmount: totals.insuranceCommission * factor` | zero ocorrências em qualquer arquivo |
| guard `creditPercent > 0` antes do cálculo do seguro | `app/api/calculate/monthly/route.ts:1307` chama `calculateInsuranceCommissionFromRules` **incondicionalmente**; o bloco do crédito fecha em `:1294` |
| `unstable_cache` / `revalidateTag("dashboard-metrics")` / `getDashboardMetrics` | zero ocorrências; nem a API nova (`"use cache"`, `cacheTag`) |

Números que apareceram nesses relatórios e **não saíram de medição**:
**R$ 26.081,41**, **350 linhas em 5 competências**, **"os 4 caminhos que gravam
em mês fechado"**, **R$ 4.044,68**, **R$ 4.032,10**, **R$ 4.008,68**,
**"45 linhas"**, **"44 linhas"**, e os identificadores `seguroComissao` /
`seguroComissaoGrupo` (o campo real é `comissaoSeguroGrupo`).

Medição que de fato foi feita, para contraste — cruzamento por competência das
linhas COM prêmio:

```
COMP      EMPRESA  c/PREMIO  CR=0 SEG=0  CR=0 SEG>0  CR>0 SEG=0  CR>0 SEG>0
2026-04   RR            150           0           8           0         142
2026-06   RR            181           0          14           0         167
2026-07   RR            152           7           0         145           0
```

As colunas `CR=0 SEG>0` (8 em abril, 14 em junho) mostram crédito zerado **com
seguro calculado** — é a refutação empírica do guard.

## O QUE SOBRA ABERTO

**Por que 152 linhas do RR de julho/2026 têm `insurance_commission_amount`
zerado, enquanto abril e junho têm 100% das linhas computadas.**

Diagnosticar **do zero**, sem herdar hipótese. Em particular, não assumir como
provado nada sobre importadores, merges ou apagamento — houve uma frente nessa
direção nesta sessão (commit `d6e01a5`) e ela foi **descartada no reset**, por
ter nascido de um diagnóstico cuja segunda metade não se sustentou. Se o defeito
for real, ele reaparece e será consertado sobre diagnóstico verificado.

Dados úteis para começar, todos verificáveis por consulta direta:

- as 152 linhas têm `gross_value > 0` (R$ 15 mil a R$ 30 mil) e prêmio > 0
- a régua vigente (`insurance_slip_rules`) usa `base_field = 'gross'` desde
  01/03/2026 — ESTOQUE_D0 0,15%; SLIP 0,15/0,25/0,40/0,55% por faixa de prazo
- a janela de julho pela função canônica é **30/06 a 31/07 (fim exclusivo)** —
  27 linhas de 30/06 pertencem a julho, 6 delas com prêmio
- `insurance_commission_amount` guarda a **comissão-EMPRESA** (§188), não o
  repasse do promotor; o repasse sai na Etapa E e vive no PMR
  (`route.ts:1324-1332`)

## MÉTODO — o que custou caro

1. **"Depois" só existe depois de gravar.** Projeção da régua não é medição de
   estado, e apresentá-las lado a lado sugere reposição que não houve.
2. **A prova final chama a ROTA que a tela chama**, não a função interna. E
   quando a rota exige sessão (`withSocioAnon`, `withSocioAdmin`), dizer isso na
   hora em vez de substituir por medição equivalente-porém-diferente.
3. **Conferir o alvo no código antes de aceitar a tarefa.** Seis coordenadas
   desta sessão apontavam para código inexistente; cada uma custou uma rodada.
