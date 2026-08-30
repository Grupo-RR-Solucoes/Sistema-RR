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

> **REMEDIADO em 29/08/2026** pela frente `feat/triagem-bloco1-indeterminados`: os
> itens 1, 2 e 4 estão **FECHADOS** — ver "A TRIAGEM FINAL", abaixo. O item 3
> (repositório público) segue aberto e é decisão do Diego.

1. **Os 5 indeterminados** — medidos, **não diagnosticados, nenhum presumido benigno**:
   ```
   motor_credito_trp_db_gate    rc=1   202,6s   169 divergências
   mov3_dre_inclui_tudo_gate    rc=1   255,5s   1 falha
   mov2_dre_gate                rc=127 118,2s   CRASH DE AMBIENTE, não vermelho
   mov2_relatorios_gate         rc=1   149,5s   2 falhas (toca promoterReportData)
   test_ads_credito_trp_sempre  rc=1    35,0s   1 falha
   ```
   Os dois primeiros **terminam** dentro de 600s — não são "portão que não termina".
2. **BLOCO B — os 11 vermelhos `needs-db-lento`: NÃO TOCADO.** Sem execução verde
   registrada em commit nenhum.

   > **O número desta linha envelheceu.** Ela dizia "a faixa segue em 358,4s contra
   > teto de 90s". Remedido em 30/08/2026, medindo a `--db` com o cronômetro do
   > próprio runner: **290,7s** antes do conserto do `produtos_detalhamento_escopo`
   > (medido com `git stash`, para o par sair do mesmo dia) e **185,4s / 193,2s /
   > 193,2s** em três execuções depois dele. O teto continua estourado nas cinco
   > medições — o que envelheceu foi o número, não a conclusão. E a comparação entre
   > DIAS não vale: 358,4s (29/08 cedo), 193,3s (29/08 tarde) e 290,7s (30/08) são o
   > *mesmo conjunto de portões*; a latência do banco domina.
3. **DÍVIDA NOMEADA — o repositório é PÚBLICO.** Medido: a API do GitHub devolve
   `private: false, visibility: public`. É o repo de um sistema que processa produção
   contrato a contrato. **"Versionar fixture" significa "publicar"** — foi o que
   travou a recuperação de `bbts_parser`/`bbts_resolver`, cujo PDF é régua (zero dado
   de cliente) mas é documento comercial de um parceiro. Decisão do Diego, separada
   desta frente. Nenhuma fixture proposta aqui carrega dado de cliente.
4. ~~**1 falha restante em `test_ads_credito_competencia.cjs`** — a de contratos
   nomeados, não a contagem. Não diagnosticada.~~ **MORTA — e já estava morta quando
   esta lista foi escrita.** Ela foi diagnosticada e consertada no commit `4a668ee`,
   o commit do BLOCO 1 desta mesma frente, e a §"A TRIAGEM FINAL" logo abaixo já
   contava isso. A lista de PENDENTE é que não foi remedida junto.

   Medido em 30/08/2026, 4 execuções seguidas: **6 OK / 0 falhas, rc=0 nas 4**.

   ```
   $ node scripts/test_ads_credito_competencia.cjs
     ✅ (a) 213994592 gravada com competência 2026-07 (efetivação 06/07)
     ✅ (b) 213304584 (Cancelamento) NÃO gravada
     ✅ (c) NENHUMA "Proposta CDC" gravada (8 no arquivo)
     ✅ (c+) TODA "Contratação CDC" gravada (35 no arquivo) — controle positivo
     ✅ (d) Contratação CDC de julho (213977398) gravada em 2026-07
     ✅ (e) NENHUMA gravada cai em 2026-06 (junho intocado)
   === 6 passaram, 0 falharam ===
   ```

   **Balde: ÂNCORA VENCIDA, não defeito.** A asserção (c) congelava três números de
   contrato (219509685 / 219421812 / 219351243) como se "Proposta CDC" fosse status
   permanente; 2 dos 3 viraram "Contratação CDC" no mundo real, e gravá-los é o
   comportamento CERTO. Reancorada no STATUS, com os dois lados computados e guarda
   de não-vacuidade nos dois. Nada a aplicar — já estava aplicado.

   **O que continua verdadeiro e é o que importa aqui:** o arquivo segue **órfão**
   (`grep 'arquivo: "scripts/test_ads_credito_competencia.cjs"' scripts/run_all_gates.cjs`
   → 0 ocorrências), porque lê `C:/Users/diego/Downloads/Relatório (3).xlsx`, xlsx de
   cliente que não pode ser versionado. Ele é uma das 2 únicas provas de
   `lib/bbtsDailyImport.ts` (390 linhas, 8 consumidores) e **nenhuma faixa o executa** —
   nem `gates`, nem `gates:db`, nem `gates:full`. Isso é dívida de COBERTURA, não
   falha, e depende da decisão (b) do bloco 4 (repositório público).

---

## DECISÕES PENDENTES COM O DIEGO — nomeadas para não se perderem

Nenhuma das duas é técnica: as duas são de **exposição**, e a segunda decide a
primeira. Registradas aqui em 30/08/2026 porque estavam vivas só em prosa espalhada
por três handoffs, e prosa espalhada é como uma decisão vira esquecimento.

### (a) Versionar a tabela de pagamento da BBTS

**O que se decide:** se a régua de pagamento da BBTS entra no repositório como
fixture.

**O que ela é:** régua de preço — **zero dado de cliente**, nenhum contrato, nenhum
CPF, nenhum nome. Mas é **documento comercial de um parceiro**, e o repositório é
público (ver (b)), então "versionar" aqui significa literalmente **publicar**.

**O que depende disso, e é o custo real de não decidir:** `bbts_parser_gate` e
`bbts_resolver_gate` estão órfãos por causa dela — sem a fixture eles não têm o que
medir. É a decisão que define o destino dos dois: recuperados, ou aposentados por
impossibilidade. Reconferido em 30/08/2026:

```
$ ls scripts/bbts_parser_gate.cjs scripts/bbts_resolver_gate.cjs   -> os DOIS existem
$ grep -c 'scripts/bbts_parser_gate.cjs"'   scripts/run_all_gates.cjs   -> 0
$ grep -c 'scripts/bbts_resolver_gate.cjs"' scripts/run_all_gates.cjs   -> 0
```

Ou seja: o código dos dois portões está no repo e **nenhuma faixa os executa**.

- **Se SIM** — os dois portões voltam a rodar em CI, e a régua da BBTS fica pública.
- **Se NÃO** — os dois viram dívida nomeada permanente, e `lib/bbts/` fica sem
  cobertura executável em CI. Não é "consertar depois": é uma cobertura que não pode
  existir enquanto o repo for público.

**Não há caminho técnico que contorne isso.** Ofuscar a régua descaracteriza o que o
portão mede; mantê-la fora do git é exatamente o estado de hoje.

### (b) O repositório ser público

**O que se decide:** se o repositório continua público.

**Medido por mim em 30/08/2026, sem credencial nenhuma** — que é a prova mais forte
possível, porque a requisição anônima ter funcionado *é* o problema:

```
$ curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/Grupo-RR-Solucoes/Sistema-RR
200
$ curl -s https://api.github.com/repos/Grupo-RR-Solucoes/Sistema-RR | grep -E '"private"|"visibility"'
  "private": false,
  "visibility": "public",
```

É o repositório de um sistema que processa produção contrato a contrato.

**Por que decide a (a):** enquanto for público, toda fixture é uma publicação. Se
passar a privado, a (a) deixa de ser uma decisão de exposição e vira rotina — e o
mesmo vale para as **6 fixtures (1,93 MB)** já nomeadas como dívida na frente do
runner e para o xlsx de `test_ads_credito_competencia` (esse **carrega dado de
cliente** e não entra nem em repo privado sem uma decisão à parte).

**A ordem importa:** decidir (b) primeiro torna (a) barata. Decidir (a) primeiro
obriga a decidir (b) no meio do caminho.

---

## A TRIAGEM FINAL — 17 vermelhos, **17 balde 2, ZERO defeito de produção**

Frente `feat/triagem-bloco1-indeterminados`, ramificada de `main` em `9074033`.
Commits `4a668ee` (bloco 1) e `d8fb05c` (bloco 2). Leitura pura, nada gravado no
banco. `npm run gates` 30/30, `tsc --noEmit` e `typecheck:gates` limpos, `build` OK.

Os 5 indeterminados + a falha restante do `test_ads_credito_competencia` + os 11
`needs-db-lento`. **Nenhum era balde 1**: nenhum centavo errado, nenhuma produção
escondida. É o resultado que fecha a tese das três frentes — o vermelho acumulado
deste repositório era **âncora envelhecida, não defeito**.

### A prova mecânica da tese — R$ 357,14 bisseccionados

A âncora de crédito RR de jun/2026 (`109.538,42`, cravada em `3363ba5`, 12/07) era o
único número da frente que podia ser dinheiro. Bisseccionada em `git worktree`,
commit a commit, contra o banco de hoje:

```
109.587,23   código de 3363ba5 (12/07) rodado HOJE
 -   23,17   competência do volume virou JANELA
 -  960,93   d7d556e 25/08  teto 5,80% (repasse sai da base NO TETO)
 +  578,15   d6febc5 25/08  carve-out INSS da Aldalene (critério = TAXA)
 ---------
109.181,28   HEAD — e as DUAS fontes de TRP dão este mesmo valor
```

Sem resíduo inexplicado. E o primeiro número é a tese inteira em uma linha: **com o
código CONGELADO a base andou +R$ 48,81 em 48 dias** (reatribuições, imports tardios).
Constante absoluta sobre tabela viva **vence sozinha**, sem ninguém tocar em código —
por isso as duas do `mov2_relatorios` viraram comparação computada no mesmo run.

Das 169 divergências do `motor_credito_trp_db_gate`: 132 `calculated_at` (relógio),
30 `trp_version_id`/`trp_fallback` (procedência, que **devem** diferir entre json e
db), 6 do `trend` (a janela de 6 meses andou para agosto e a tolerância estava presa a
`month === 7`), 1 âncora. **Zero eram diferença de cálculo.** A impressão truncava em
8 por seção e escondia a composição.

### Bloco 2 — 10 dos 11 são DUAS causas

1. **Julho fechou** (6 portões, 24 asserções). Todos cravavam `2026-07` como "o mês
   ABERTO", porque julho estava aberto quando foram escritos. Alguns passaram a
   reprovar o comportamento **certo**: o `mov2_grupoA` exigia que o lançamento caísse
   em julho quando a resposta correta já era agosto.
   Conserto único em **`scripts/_competenciaAberta.cjs`** — biblioteca (prefixo `_`),
   uma cópia só porque o `ledgerHealth` já registra o preço que este repo pagou por
   cópias divergentes de lógica de regime. Resolve por `detectMonthRegime` **no run** e
   **LANÇA** quando não há mês aberto: nunca devolve um fechado disfarçado, senão o
   portão passaria medindo a coisa errada. Provado por mutação (âncora de calendário em
   2026-05, janela toda fechada): reprova com a lista dos regimes.
2. **Dois universos de rank** (2 portões). O `gate_ritmo_diario` comparava a lista da
   ROTA (escopada pela competência) com um COUNT da tabela `promoters` (sem
   competência); o `projecao_rank_sem_master`, base escopada pela empresa da PRODUÇÃO
   com rank escopado pela empresa DA PESSOA. 48 contra 53, e **os mesmos 5 nomes nos
   dois** — todos com produção R$ 0,00, quatro cadastrados em agosto. **Contratar
   alguém reprovava os dois portões no dia seguinte.** Varrido o grupo: dos 53
   não-masters ativos com linha, 48 estão em algum rank e os 5 ausentes têm produção
   zero — nenhum centavo fora do rank. Entrou a invariante que a contagem tentava
   dizer, com os dois lados computados e guarda de não-vacuidade.

### CATEGORIA NOVA na taxonomia — portão **MORTO**, não vermelho

`pmr_aberto_sem_daily_gate` **não estava vermelho: estava morto.** Saía em
`admin.from(...).select(...).eq(...).not is not a function` **antes da primeira
asserção** — zero medição, inclusive do bloco de PRODUÇÃO. O commit `b30c6a2` deu ao
chamador um `.not(...)` que o stub em memória não tinha, e atrás dele um `.gte`. O
`try/catch` que o cabeçalho do arquivo invoca não protege: o `TypeError` estoura ao
**montar** a query, não ao aguardá-la.

**É pior que órfão, e merece linha própria na taxonomia.** Órfão ao menos é sabido:
está listado, e quem lê o registro sabe que ninguém o roda. Este estava REGISTRADO,
aparecia na contagem de vermelhos e **contava como cobertura que não existia** — a
única guarda contra o fóssil do PMR em mês aberto voltar, e ela não media nada.
Vermelho pede diagnóstico; morto não pede nada, porque parece só mais um vermelho.
Stub alinhado e, o que importa mais, ele agora **reclama o NOME** do método que lhe
falta em vez de morrer anônimo. Com o portão vivo, os 3 blocos passam: o fóssil não
voltou.

### A faixa `--db` — **não consertada, registrada**

Remedida hoje: **193,3s** de teto 90s. O registro anterior dizia 358,4s; com os mesmos
portões deu 193,3s, então aquele número carrega latência de banco. Estourado nas duas
medições, e o custo **é concentrado, não gordura**:

```
 91,3s  produtos_detalhamento_escopo_gate   <- sozinho passa do teto inteiro
 21,4s  reatribuicao_precedencia_gate
 13,2s  gate_ads_julho_dois_bugs
 -----
125,9s  de 193,3s = 65% em TRÊS. Os outros 27 dividem ~67s.
```

Tirar só o primeiro põe a faixa em ~102s — perto do teto, ainda acima. Problema
separado por decisão do Diego. (`needs-db-lento`: 510,6s em 20, 60% em cinco.)

---

## A CONTAGEM DA §6b — são **NOVE**, e **QUATRO** não são herdadas

Canônico: §6b do `HANDOFF_RESIDUO_FINANCEIRO`. Somando as três frentes:

| # | de quem | a anotação | o que a medição mostrou |
|---|---|---|---|
| 1–4 | herdadas | chave J / cancelamento / "Comissões pagas" / §16 ADS | já consertado, meia verdade, já consertado, falsa |
| 5 | **minha** | "volume medido (zero)", gatilho não disparado | tinha disparado 7 semanas antes (R$ 4,06) |
| 6 | **do Diego** | "a escrita de 26/08 é a segunda sem rastro" | **há rastro**: §7 do `HANDOFF_ADS_FECHAMENTO_CAIXA`, 13:53 UTC, reimportação dele pelos 2 PDFs |
| 7 | **minha** (memória) | "o SQL do piso NÃO está aplicado; a coluna `piso_zerou` não existe" | **os dois existem**: `piso_producao_rule_versions` tem régua (vigência 2026-08-01, piso 150k, 2 ids) e `promoter_monthly_results.piso_zerou` responde |
| 8 | **minha** (memória) | "`typecheck:gates` está VERMELHO em `origin/main` e o CI não o roda" | **verde, e no CI** — `1c67ac7` (21/08) consertou as duas metades e é ancestral de `main` |
| 9 | **do Diego** | "`mov2_dre_gate` rc=127 é CRASH DE AMBIENTE, não vermelho de asserção" | **é FLAKE**: à mão o portão termina em ~223s com rc=1 e falha de asserção real, que era premissa morta (`24625ef`) |

**A conta pedida era OITO; contando dão NOVE** — a base era seis, e as três de hoje
somam nove. Fica o número medido, não o esperado, que é a regra desta seção aplicada
a ela mesma.

**Quatro das nove não são herdadas, e todas foram escritas DEPOIS da regra que as
condena** — a 5ª no dia em que a regra nasceu, a 6ª três turnos depois, a 7ª e a 8ª em
memória de projeto, a 9ª numa classificação de portão. Isso não enfraquece a regra; é a
evidência mais forte a favor dela. Nota não medida é frágil independentemente de idade,
**de autor e de onde mora** — handoff, instrução falada ou memória, dá no mesmo.

A 9ª tem um agravante próprio: **uma classificação errada custou uma frente inteira de
atraso.** "Crash de ambiente" mandou parar de investigar; era uma falha de asserção
real esperando diagnóstico.

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
