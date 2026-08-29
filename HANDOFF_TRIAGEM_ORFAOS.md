# HANDOFF — `feat/triagem-orfaos-e-vermelhos` (29/08/2026)

Frente de três blocos, ramificada de `main` em `9add6bc`. **Dois fechados, um não
tocado.** Zero migrations, zero DDL, **nada gravado no banco** — a frente inteira foi
leitura, e os dois consertos são de código.

> Todo número aqui saiu de uma consulta ou execução nomeada ao lado. Onde a premissa
> que abriu o bloco caiu, ela está registrada como caída — foram **três** nesta frente.

---

## BLOCO C — 2026-05 RR ALAGOAS 1: **FECHADO, ninguém recebeu errado**

Era o único bloco com dinheiro. **As duas premissas caíram na medição.**

**Premissa 1 — "7 operações de diferença" (5.970 × 5.963).** Não são 7 operações
sumidas: são **duas regras de contagem diferentes**.

```
monthly_closing_entries 2026-05 AL1, 6001 linhas
  por aba/tipo: PRT/PRT 5862 | A Vista/CASH 95 | Crédito 4 | Débito 2 | INSURANCE 38
  5862 + 95 + 4 + 2 = 5963      <- o "5963" era CONTAGEM DE LINHAS não-INSURANCE
  distintos -> j_key: 74 | operation_number: 5865 | contract_number: 95
  FME.operacoes = 5970 conta operationKeys.size no import (monthlyClosingImport.ts:1696)
```
Nenhuma das três chaves distintas dá 5.963. O "delta de 7" compara uma contagem de
linhas com uma contagem de chaves.

**Premissa 2 — "`valor_diferido` delta −1.750,82".** Era `Σ PRT` **cru**, sem o filtro
que o próprio import aplica. Reproduzindo `isPayablePrtRow` (`monthlyClosingImport.ts:1514`,
COD EST vazio ou = 1):

```
  valor_diferido reproduzido : 34605.03
  FME.valor_diferido         : 34622.63
  DELTA                      : -17.60        <- não -1750,82
  linhas fora por COD EST != 1: 476 | soma 1745.50
```
A hipótese que o handoff anterior deixou por verificar está **confirmada**: as 476
linhas com COD EST ≠ 1 somam 1.745,50 e explicam quase todo o suposto buraco. Resta
**−17,60** no agregado.

**Ninguém recebeu a mais ou a menos.**
```
PMR 2026-05: 60 linhas | por source: {"cms":60} | updated_at 2026-06-04
quem lê fechamento_mensal_empresa: auditoria.ts, auditoriaAvistaViva.ts,
  closingAnalytics.ts, diagnostico/fechamentoParcial.ts   (nenhum paga promotor)
```
Maio é regime **cms** — o PMR não deriva do fechamento. O `fechamento_mensal_empresa`
é agregado de empresa, lido só por auditoria e diagnóstico. O −17,60 vive no agregado
e não alcança pagamento. **Bloco encerrado; nada a consertar.**

---

## BLOCO A — triagem dos 19 órfãos: **FECHADO** (commit `da516d1`)

Universo **re-derivado**, não herdado: 103 arquivos com `gate`/`test` no nome,
rastreados, menos `MUTA_`/`.manual.` — o 103º é o próprio runner. Os 19 do registro
anterior reproduzem exatamente.

| resultado | quantos | quais |
|---|---|---|
| não eram portões (renomeados) | 2 | `_motor_credito_trp_db_lib.cjs` (biblioteca), `diag-residuo-09-silencio.cjs` (diagnóstico) |
| **registrados** | 3 | `gate-avista-vs-fechamento` (10/10 estáveis), `mov2_proposals_get` (única prova de `promoterReportData`), `companyscope_grupo_gate` (**novo**) |
| aposentado | 1 | `dump-medida-b-conserto.mts` — constantes de transição 27/20/4/4 contra 30/461/0/0 |
| separados | 2 | `test_ads_status_e_grupo` (→ **8/0**), `test_ads_credito_competencia` |
| não-executáveis por argumento | 4 | os `bbts_*` — saem com mensagem de uso, não são vermelhos |
| deixado órfão | 1 | `trp_paridade_gate_f3` — uma competência sai `matches: 0` |
| indeterminados | 5 | ver ABERTO |

O CI foi de 53 para **56 pulados**; os 30 self-contained seguem 30/30.

### O defeito vivo que o órfão pegou — `lib/trp/parseTrpDraft.ts`

```
$ grep -c 'totalPct +='       lib/trp/parseTrpDraft.ts  ->  0
$ git show 7ad20fc -- lib/trp/parseTrpDraft.ts
-    provadoProdutos[k] = produtos[k].rows;
-    totalPct += produtos[k].rows.flat().length;
7ad20fc  17/07/2026  "trp: deriva tx_juros_min de categoria das celulas"  -> EM MAIN
```
Colateral de uma frente que mexia em outra coisa. `totalPct` ficou declarado e nunca
escrito, e `confianca.provado` viajava `{0, {}}` até a tela de revisão do sócio, que
dizia **"0 provados"** com 195 provados — por 43 dias.

**O parser NUNCA esteve quebrado**, e isso foi medido antes de qualquer conserto:
11 produtos, **260 percentuais**, valores certos (INSS Faixa 3 = `0.0334`), competência
e vigência corretas. A gravação não lê `confianca` (`app/api/trp/commit/route.ts`:
zero ocorrências), então nada foi corrompido e o erro era para o lado cauteloso.
Restaurado. O teste vai de 8/2 a **10 OK / 0 FAIL**.

A segunda falha do mesmo teste era **asserção vencida por conserto correto**:
`b47ade6` (03/07, em main) preencheu o prazo do CONSIG_PRIVADO — medido: célula com
`prazo_min 18 / prazo_max 35`, e nenhum item `conferir` sobre prazo. Aposentada.

### A âncora datada — `gate_ads_seguro_via_render.ts`

A âncora continua **externa**; recomputar os dois lados no mesmo run viraria
tautologia. O que ela ganhou foi **data e procedência no código**, e o portão, ao
reprovar, discrimina âncora vencida de divergência viva por
`max(updated_at) das linhas` **contra** `cravadaEm`.

Reancorada `49,91 → 115,10`, com procedência externa: `115,10 + 89,42` (só no
`raw_payload`) `= 204,52 = seguro_calculo` do PDF da BBTS. O 49,91 não estava errado —
envelheceu: em **26/08 13:53:38** uma reimportação do fechamento ADS reescreveu 43
linhas da ADS de 2026-07, 12 com seguro. O portão ficou vermelho e ninguém viu,
porque era órfão.

---

## O QUE FICA ABERTO

1. **Os 5 indeterminados** — medidos, **não diagnosticados, nenhum presumido benigno**:
   ```
   motor_credito_trp_db_gate    rc=1   202,6s   169 divergências
   mov3_dre_inclui_tudo_gate    rc=1   255,5s   1 falha
   mov2_dre_gate                rc=127 118,2s   CRASH DE AMBIENTE, não vermelho
   mov2_relatorios_gate         rc=1   149,5s   2 falhas (toca promoterReportData)
   test_ads_credito_trp_sempre  rc=1    35,0s   1 falha
   ```
   Os dois primeiros **terminam** dentro de 600s — não são "portão que não termina".
2. **BLOCO B — os 11 vermelhos `needs-db-lento`: NÃO TOCADO.** A faixa segue em
   **358,4s contra teto de 90s**, sem execução verde registrada em commit nenhum.
3. **DÍVIDA NOMEADA — o repositório é PÚBLICO.** Medido: a API do GitHub devolve
   `private: false, visibility: public`. É o repo de um sistema que processa produção
   contrato a contrato. **"Versionar fixture" significa "publicar"** — foi o que
   travou a recuperação de `bbts_parser`/`bbts_resolver`, cujo PDF é régua (zero dado
   de cliente) mas é documento comercial de um parceiro. Decisão do Diego, separada
   desta frente. Nenhuma fixture proposta aqui carrega dado de cliente.
4. **1 falha restante em `test_ads_credito_competencia.cjs`** — a de contratos
   nomeados, não a contagem. Não diagnosticada. O arquivo segue órfão por construção
   (lê xlsx de cliente), e é uma das 2 únicas provas de `lib/bbtsDailyImport.ts`.

---

## A CONTAGEM DA §6b — são **SEIS**, e **DUAS** são minhas

Canônico: §6b do `HANDOFF_RESIDUO_FINANCEIRO`. Somando as duas frentes:

| # | de quem | a anotação | o que a medição mostrou |
|---|---|---|---|
| 1–4 | herdadas | chave J / cancelamento / "Comissões pagas" / §16 ADS | já consertado, meia verdade, já consertado, falsa |
| 5 | **minha** | "volume medido (zero)", gatilho não disparado | tinha disparado 7 semanas antes (R$ 4,06) |
| 6 | **do Diego** | "a escrita de 26/08 é a segunda sem rastro" | **há rastro**: §7 do `HANDOFF_ADS_FECHAMENTO_CAIXA`, 13:53 UTC, reimportação dele pelos 2 PDFs |

**As duas não-herdadas foram escritas DEPOIS da regra que as condena** — a 5ª no dia
em que a regra foi escrita, a 6ª três turnos depois, por quem a escreveu. Isso não
enfraquece a regra; é a evidência mais forte a favor dela. Nota não medida é frágil
independentemente de idade **e de autor**.

E nesta frente caíram mais três premissas de instrução, todas medidas antes de agir:
o commit-base `a2c7f31` (não existe neste repositório), os "7 operações" e o
"−1.750,82" do Bloco C. Duas correções minhas também entram na conta: marquei
`tsconfig.f3.json`/`tsconfig.gate.json` como insumo ausente quando os gates os
**geram** em diretório temporário, e li `bbts_rule_versions` com `competencia="2026-07"`
quando a coluna é DATE — as duas corrigidas antes de virarem afirmação.
