# HANDOFF — materializacao assincrona + 3 competencias fechadas

Frente de 03/09/2026. Branch `feat/materializacao-assincrona-fila`.

---

## 1. Materializacao da carteira PRT — ASSINCRONA (fila + pg_cron)

### O defeito

`app/api/import/closing/route.ts` chamava as duas RPCs de materializacao pelo
PostgREST. **Medido:** o role `authenticator` tem `statement_timeout=8s` e
`lock_timeout=8s`; as duas funcoes juntas queimam **38-51s**. A chamada nunca
podia terminar por aquela porta, e nao terminava **desde 2026-07-07** — dois
fechamentos inteiros. As MESMAS funcoes rodam sem problema no Studio: foi assim
que a carteira chegou a 2026-08 em 02/09/2026 (`created_at` unico
`2026-09-02T21:27:50`).

Escopar por competencia nao era saida: a 2a funcao nao tem competencia para
escopar — ela comeca com TRUNCATE e reconstroi a janela 2026+ inteira.

### O desenho

1. a rota faz **um INSERT** em `materializacao_fila` (milissegundos);
2. o job pg_cron `materializacao_fila` (1 min) chama
   `fn_materializacao_fila_processar()`, que roda **dentro do banco**, com
   `set local statement_timeout = 0`, e grava status/ms/erro CRU de volta.

A fila fica em `public` de proposito: o PostgREST desta instancia expoe SO
`public` e `graphql_public`, entao fila em `public` = observavel de fora com
service_role. So o AGENDADOR fica fora do alcance, e para ele existe
`fn_diag_materializacao_cron()` (so-leitura sobre `cron.job`,
`cron.job_run_details` e os timeouts por role). O **worker nao tem grant para
service_role**: pela API ele cairia nos mesmos 8s.

### O risco que a frente cria, e a defesa

Trocar sincrono por assincrono cobra o **silencio**. "Enfileirei" nao e
"funcionou": sem o job vivo o insert continua devolvendo 200 e a carteira
envelhece calada — o mesmo defeito, mudado de lugar. Por isso o bloco do
pos-import le a fila **inteira** (nao a linha que acabou de inserir) e so sai
`ok=true` quando o insert passou **E** a fila esta saudavel: nada sem terminar ha
mais de 10 min, nada em `ERRO`. A denuncia de um import atrasado chega no import
seguinte, em `import_pos_diag`.

### Congelamento: catch-up por competencia EXPLICITA

`congelarPrevisao` e TypeScript e nao roda dentro do banco. Ele passa a congelar
as competencias que a fila marca como materializadas (`status='OK'`) e ainda nao
congeladas — na pratica, a do import anterior — ou por
`POST /api/recebiveis/congelar?competencia=YYYY-MM`. **A rota NAO espera a fila**
(decisao do Diego): esperar reporia o sincronismo e os mesmos 38-51s.

A competencia sai de PARAMETRO porque o `max(competencia)` de `carteira_contrato`
deixou o vintage de **2026-07 inalcancavel**: a materializacao morreu em 07/07 e,
quando rodou (02/09), reconstruiu a carteira de 2026-01 em diante — **julho ESTA
la** — mas o max ja era 2026-08 e so o max podia ser pedido. `previsao_snapshot`
e write-once: vintage nao congelado na hora so volta por essa porta. O resultado
agora carrega `competenciaOrigem: "parametro" | "max_carteira"`.

### APLICADA E PROVADA DE PONTA A PONTA — 03/09/2026

A migration foi aplicada no Studio e o ciclo esta provado com dado real.

**O NUMERO QUE SUSTENTA O DESENHO INTEIRO:**

```
fila origem='manual', 2026-08:
  status OK | ms = 60.150 | linhas_producao 270.198 | linhas_carteira 74.956
  carteira_competencia_max 2026-08
```

**Sessenta segundos contra um teto de oito: 7,5x.** E o portao imprime o teto no
mesmo run, lido do banco:
`authenticator -> ["session_preload_libraries=safeupdate","statement_timeout=8s","lock_timeout=8s"]`.
Nao era margem apertada — era impossibilidade. Nenhuma otimizacao razoavel da
funcao caberia nos 8s, e e por isso que "escopar por competencia" nunca ia
resolver.

Agendador vivo: `cron.job` jobid 1, `materializacao_fila`, `* * * * *`,
`active=true`; `cron.job_run_details` com **10 execucoes registradas, todas
`succeeded`**, uma por minuto.

**ARMADILHA CORRIGIDA — `'1 minute'` NAO E ACEITO.** Eu tinha escrito
`cron.schedule(..., '1 minute', ...)` e esta versao do pg_cron **recusa**: ela
aceita cron classico (`* * * * *`) ou intervalo em segundos (`'[1-59] seconds'`),
e nada entre os dois. Pior, a justificativa que eu havia deixado no arquivo
("'1 minute' nao depende do suporte a intervalo sub-minuto") estava errada nos
DOIS sentidos: o suporte sub-minuto existe, e era a forma em minutos que nao era
aceita. Migration corrigida em disco para `* * * * *`.

**Sobre o trabalho passar do minuto** (60.150 ms ja passa, por 150 ms): o disparo
seguinte cai no `pg_try_advisory_xact_lock` e volta na hora, sem fila dupla. E
para isso que o lock esta la, e e por isso que ele e `xact` e nao `session`.

**A ARMADILHA DO D10 SE RESOLVEU NA DIRECAO CERTA.** Antes da migration, chamar o
worker devolvia `PGRST202` — o mesmo codigo que a ausencia da funcao produz —, e
por isso a assercao ficava SUSPENSA. Com a migration aplicada ela voltou a valer e
devolve **`42501` (permission denied)**: codigo DIFERENTE, e prova de que o revoke
pegou de verdade. Se eu tivesse deixado o D10 valer desde o inicio, ele teria
passado verde por vacuidade e ninguem saberia se o revoke funcionava.

**Portao VERDE**, os 4 lados: 12 assercoes de regra + 7 mutantes, 10 de rota, 10
da migration, 10 do banco.

### O vintage de 2026-07 — RECUPERADO em 03/09/2026

Era o residuo desta frente e **esta fechado**. Congelado por
`POST /api/recebiveis/congelar?competencia=2026-07`, depois de dry-run e da
medicao do item 3 abaixo.

```json
{ "snapshot": "2026-07", "competenciaOrigem": "parametro",
  "linhasGravadas": 146, "linhasProjetadas": 146,
  "vintageJaExistia": false, "linhasDescartadas": 0,
  "vintageIncompleto": false, "avisos": [] }
```

`previsao_snapshot`: **148 -> 294 linhas** (`{"2026-06": 148, "2026-07": 146}`).
Alvos 2026-07 .. 2038-08; `base_snapshot_prt` = `2026-07` nas 146.
Sigma `previsto_prt` 656.003,26 | `previsto_avista` 229.791,99 |
`previsto_diferido` 9.805,59.

Quatro conferencias, todas OK:
1. 146 linhas com `competencia_snapshot='2026-07'`;
2. `competenciaOrigem = "parametro"` — o `max(competencia)` da carteira (hoje
   2026-08) nao foi consultado. **Era isto que tornava julho inalcancavel**;
3. `previsto_avista` **229.791,99 no alvo 2026-07**, e ZERO linhas com a-vista em
   qualquer outro alvo — prova de que a competencia chegou tambem ao
   `buildAvistaProducao`. Sem isso o vintage misturaria dois meses, em definitivo;
4. vintage **2026-06 INTACTO**: 148 linhas antes e depois, e **0 linhas com
   qualquer campo diferente** (comparacao campo a campo, incluindo `id` e
   `data_congelamento`, contra uma leitura da tabela inteira feita ANTES da
   escrita).

**ARMADILHA de execucao, sem dano:** a 1a tentativa morreu em `ENOENT` ao gravar o
arquivo do "antes" — caminho MSYS (`/c/Users/...`) vira `C:\c\Users\...` no Node
do Windows. Como a leitura do "antes" acontece ANTES do congelamento, nada foi
escrito no banco; conferido (`{"2026-06": 148}`) antes de repetir. Se a ordem
fosse a inversa, a falha teria acontecido DEPOIS de gravar um vintage write-once,
sem o "antes" para comparar.

### Item 3 do dry-run — RESOLVIDO, e eu tinha lido errado

Antes de autorizar, o Diego mandou provar a igualdade `previsto_prt` de 2026-07 e
2026-08 (51.358,22 nos dois, caindo so em 2026-09). Eu tinha escrito que era
"nenhum contrato com exatamente 1 parcela restante". **Errado.**

A igualdade e **ESTRUTURAL**: `projectPrtAgenda` (`lib/recebiveis/prtAgenda.ts:172`)
filtra por `parcelasRestantes >= h`, e NAO `> h` — o `> h` era um off-by-one que
derrubava a ultima parcela, ja corrigido la, com comentario. Logo `h=1` inclui
todo contrato com `restantes >= 1`, isto e, TODOS os ativos. A igualdade com a
base vale sempre que nenhum ativo tenha `restantes = 0`.

Medido em `carteira_contrato` 2026-07, `status='ativo'` (9.289 contratos,
Sigma comissao 51.358,22):

```
restantes = 0 :   0 contratos | Sigma 0,00      <- explica a igualdade
restantes = 1 :  22 contratos | Sigma 70,71
restantes = 2 :  42 contratos | Sigma 131,42
restantes < 0 :   0
```

**Os degraus batem ao centavo com as coortes**, o que mata a hipotese de "o
horizonte soma algo que nao deveria":
`51.358,22 - 51.287,51 = 70,71` (os 22 de `restantes=1`) e
`51.287,51 - 51.156,09 = 131,42` (os 42 de `restantes=2`).

E o vintage de **2026-06 ja gravado tem a MESMA forma**: 51.669,43 em 2026-06 e
em 2026-07 (delta 0,00), caindo so em 2026-08 (-120,78). Nao havia sinal.

Nota de contexto, nao defeito: a base gravada de junho (51.669,43) nao bate com o
que a carteira de 2026-06 da hoje (51.226,00), porque a carteira foi reconstruida
inteira em 02/09 e a chegada dos fechamentos de julho e agosto reclassifica
contratos. E exatamente por isso que o vintage e write-once — ele guarda o que se
sabia entao.

### O vintage de 2026-08 — CONGELADO em 03/09/2026

Era o ultimo residuo da frente. Dry-run limpo, mesma estrutura de julho (ja
conferida no item 3 acima), gravado por `?competencia=2026-08`.

```json
{ "snapshot": "2026-08", "competenciaOrigem": "parametro",
  "linhasGravadas": 146, "linhasProjetadas": 146,
  "vintageJaExistia": false, "linhasDescartadas": 0,
  "vintageIncompleto": false, "avisos": [] }
```

`previsao_snapshot`: **294 -> 440 linhas**
(`{"2026-06":148, "2026-07":146, "2026-08":146}`). Alvos 2026-08..2038-09,
`base_snapshot_prt` = `2026-08` nas 146. Sigma `previsto_prt` 656.050,60 |
`previsto_avista` 178.461,87 | `previsto_diferido` 5.674,59.

As quatro conferencias, todas OK: (1) 146 linhas; (2) `competenciaOrigem` =
`"parametro"`; (3) a-vista **178.461,87 no alvo 2026-08**, com ZERO linhas de
a-vista em qualquer outro alvo; (4) **2026-06 e 2026-07 INTACTOS** — 148 e 146
linhas antes e depois, com **0 campos diferentes** na comparacao campo a campo
contra uma leitura da tabela inteira feita ANTES da escrita.

Os tres vintages existem, e a serie "previsto ENTAO vs recebido DEPOIS" volta a
ser continua de 2026-06 em diante.

### Gates (depois do commit)

`npm run gates` **39/39**. `npm run gates:db`, depois da migration aplicada: o
portao desta frente PASSA, e sobram **4 vermelhos anteriores e alheios**, nenhum
deles lendo os modulos tocados aqui: `produto_pmr_empresa_dona` (crash de teardown 3221226505),
`gate_trp_vigencia_intra_mes`, `gate-srcc-ads`, `check_audit_v9_tables`.
Teto da faixa `--db`: **204,0s de 90s**, ja estourado antes; os 2,2s deste portao
sao ~1%. `tsc --noEmit` 0.

---

## 2. 2026-07 — DIVIDA CONSCIENTE: **NAO reconsolidar**

**Decisao do Diego, 03/09/2026.** A reconsolidacao de julho foi medida em
dry-run e **nao foi feita**, de proposito.

O numero: Sigma final **141.071,44 -> 134.936,65**. Descontando R$ 909,04 que sao
artefato do recorte (duas linhas de PRODUTO PURO, MAGNOLIA LEITE 475,19 e MARCOS
VINICIUS 433,85, que nao vem de `grupo.payload` e **nao seriam apagadas** —
`reconciliacao.apagadas_*` = 0), o efeito real e:

> **-R$ 5.225,75, em 20 promotores, todos perdendo, nenhum ganhando.**

A razao de nao fazer: **a comissao BRUTA nao se move.**
`production_commission` 132.671,58 -> 132.671,63 e `insurance_commission`
2.265,06 -> 2.265,02. So o **REPASSE ao promotor** muda. Isso nao e corrigir um
erro de calculo — e aplicar regua nova a um mes **ja pago**. 0 linhas mudam
`target_status`.

Maiores deltas: THAYNARA -2.568,04 (11.802,72 -> 9.234,68), ERIVAN -827,54,
JARLES -369,47, BIANCA -358,16, JENIFFER -193,15.

**CONSEQUENCIA ACEITA, e ela e visivel:** `detect_rules_stale` fica **ACESO** em
2026-07 (`state: STALE`, `stored_fp` `86ccd6ad415ab1c3cf308694db4fee51`,
`current_fp` `774cea4d3319d6543eaecce2dc44e318`, fingerprint gravada em
2026-08-30T00:34:32). **Isso NAO e um alarme a apagar** — mas o motivo NAO e o
que esta secao dizia antes.

> **CORRECAO DE 03/09/2026 — duas coisas que este handoff tratava como UMA.**
>
> Eu tinha escrito aqui que o STALE de julho "diz a verdade: a regua de hoje
> produziria um PMR diferente do que esta gravado". **Isso conflacionava duas
> coisas independentes, e a medicao separou as duas:**
>
> 1. **`detect_rules_stale` hasheia DADO, nunca CODIGO.** Os 8 sub-hashes de
>    `compute_rules_fingerprint` (migration 20260715_000001) leem TABELAS:
>    `promoter_share_profile`, `promoter_goal_repasse`, `monthly_targets`,
>    `j_keys`, `companies` e agregados de `monthly_closing_entries` /
>    `daily_production_records`. Nenhum deles enxerga uma linha de TypeScript.
> 2. **Os -R$ 5.225,75 vem de mudanca de CODIGO** (a janela do volume, o
>    zeramento da chave master, a precedencia do diario), nao de regua editada.
>
> Logo **o STALE de julho NAO e o -5.225,75**. Sao dois fatos verdadeiros sobre a
> mesma competencia, com causas diferentes, e o alarme nao esta apontando para o
> dinheiro. A decisao de nao reconsolidar continua valendo pelo motivo do numero
> — mes ja pago —, mas quem ler o STALE esperando encontrar os 5.225,75 atras
> dele nao vai achar.
>
> **MEDIDO (03/09/2026), e e o que sustenta a correcao:** nenhum dos 8 insumos se
> moveu depois do baseline, nem em julho nem em agosto —
> `d_src_cash`/`d_src_ins` de 2026-08 tem `max(created_at)` 2026-09-02T14:25:09 e
> `d_src_ads` 14:45:27, contra baseline 21:09:44; as 5 tabelas de regua tem
> `max(updated_at)` em 2026-08-25T18:47 **ou antes**. E os baselines mais VELHOS
> (abril 25/08, junho 27/08) estao **OK** enquanto os mais NOVOS (julho 30/08,
> agosto 02/09) estao **STALE** — o inverso do que "algo mudou depois" produziria.
>
> **HIPOTESE NAO TESTADA, registrada para quem pegar:** `pmr_prom` — o escopo dos
> sub-hashes 1 a 4 — e lido LIVE de `promoter_monthly_results` dentro da propria
> funcao. Se o baseline for computado num instante em que o PMR daquela
> competencia ainda nao esta completo (as linhas `source='bbts'` da ADS entram
> ~7s depois das `source='fechamento'` da RR), o hash gravado cobre um conjunto
> de promotores DIFERENTE do que a recomputacao de hoje ve — e o STALE aparece
> sem que regua nenhuma tenha mudado. A hipotese concorrente, de implementacao
> dupla JS/PG, esta **DESCARTADA**: `lib/rulesFingerprint.ts` chama a MESMA RPC.
>
> **ANOTADO, sem explicacao:** o baseline de 2026-08 tem `computed_at`
> **2026-09-02T21:09:44**, cerca de **6 horas DEPOIS** dos quatro imports das
> 14:20-14:25 daquele dia. Alguma coisa reescreveu aquela linha as 21:09 e nao se
> sabe o que — nenhum import, nenhuma reconsolidacao e nenhuma materializacao
> esta registrada nesse horario (a materializacao manual daquele dia foi as 20:31
> e 21:27). Enquanto isso nao for explicado, a hipotese do `pmr_prom` nao pode
> ser confirmada nem descartada.

Quem for "consertar" o STALE de julho reconsolidando esta, de qualquer modo,
retirando R$ 5.225,75 de 20 promotores ja pagos — e sem sequer resolver o STALE,
porque a causa dele nao esta medida.

Refazer a medicao a qualquer momento, sem gravar:
```
COMPETENCIAS=2026-07 TRP_SOURCE=db node -e "require('./scripts/_ts_register.cjs');require('./scripts/diag-reconsolidar-dryrun-jul-abr.cjs')"
```

**2026-08 tambem esta STALE** (`stored_fp` `45a4f9a431a3fd7c15a1ad95dcecc053`,
`current_fp` `63faefb962f27c3153e29583946a41d8`, gravada em 2026-09-02T21:09:44).
MEDIDO em 03/09/2026: e a **MESMA classe** da de julho, e a nota antiga de que
seriam classes diferentes nao se sustenta na medicao — em NENHUM dos dois meses
qualquer insumo do fingerprint se moveu depois do baseline. Ver a correcao na
secao 2. Nao foi reconsolidado, e nao ha numero de dinheiro medido para agosto.

---

## 3. 2026-04 — RECONSOLIDADA (autorizada e feita)

**Feito em 03/09/2026**, com `TRP_SOURCE=db`, por
`scripts/reconsolidar-2026-04-executar.cjs` (que exige `EXECUTAR=1` e grava o
ANTES em disco antes de qualquer escrita).

```
Sigma final_commission_value: 94.004,77 -> 93.840,73   (delta -164,04)
41 linhas gravadas | reconciliacao: 0 apagadas, 0 sobrescritas
linhas alteradas: 2 de 41
```

| linha | antes | depois |
|---|---:|---:|
| RENATA OLIVEIRA DA SILVA - CHAVE MASTER AL 3 (company 77f3992e) | prod 114,54 / seg 2,54 / **final 117,08** | 0 / 0 / **0** |
| JULIANA DOS SANTOS OLIVEIRA - CHAVE MASTER (company ecff243c) | prod 46,07 / seg 0,89 / **final 46,96** | 0 / 0 / **0** |

Chave master e um BALDE, nao uma pessoa: `cmsMonthly` ja zerava a comissao na
origem e `closingMonthly` nao (conserto em `c7f8643`).

**O dry-run previa TAMBEM 1 centavo em BIANCA (12,57 -> 12,56) e ERIVAN
(67,70 -> 67,69). Nao aconteceu** — e a previsao e que estava errada: o payload
do dry-run traz float NAO arredondado e eu o comparei com o valor ja arredondado
do banco. Gravado, o arredondamento devolve o mesmo centavo. O resultado real e
mais limpo que o previsto: **so as 2 linhas master, nada mais**.

`detect_rules_stale` de 2026-04 voltou a **OK** (fingerprint recomputada em
2026-09-03T18:16:07), o que confirma a escrita por um caminho independente.

O snapshot do ANTES ficou em `.pmr-2026-04-antes-<timestamp>.json`, na raiz.
**Nao versionar** — o repositorio e publico e o arquivo tem comissao por
promotor. Ja coberto pelo `.gitignore`.

---

## 4. AL1 2025-02 — PARADO POR FALTA DO ARQUIVO

`C23677_48357275000103_Todos_2_2025.xlsx` **nao esta em disco** (Downloads
varrido). Sem ele nao ha como dizer o que a reimportacao produziria. O Diego vai
procurar o xlsx.

O que ficou **medido** em 03/09/2026:

**O agregado fecha internamente, ao centavo.** A linha de
`fechamento_mensal_empresa` existe (`empresa_cnpj` 48.357.275/0001-03, ano 2025,
mes 2):

```
avista 56.535,69 + diferido 39.790,61 + seguro 2.549,61 - estorno 727,40 - renovacao 612,90
= 97.535,61   (= valor_liquido)        operacoes = 6.491
```

A mesma formula fecha em 2026-05 AL1 (60.765,54). Contra o **detalhe** nao ha o
que conferir: `monthly_closing_entries` = **0**.

**Cinco imports do MESMO arquivo:** 3 `COMPLETED` (23/04/2026 14:38:09, 18:14:52,
18:19:57) e 2 `CANCELLED` (18:30, 18:37), as duas com `finished_at`
**2026-06-05T02:23:24** — cancelamento em lote, mais de um mes depois.

**Censo das 104 linhas de FME do banco inteiro:** exatamente **1** com zero
entries e valor (esta) e **1** com zero entries e agregado zerado (2023-12 AL1,
que **nao e perda**). O vigia tem de distinguir os dois casos.

Quando o xlsx aparecer, o alvo que a reimportacao tem de reproduzir e:
**6.491 operacoes e valor_liquido 97.535,61**, com as 5 pernas acima.

---

## Anotados, nao investigados

- **`TRP_SOURCE` nao esta no `.env.local`.** Script local resolve a TRP pelo JSON
  enquanto a producao usa o banco. Medi os dois lados em jul e abr: **o PMR sai
  identico** (o fechamento nao usa a TRP como insumo do PMR), mas sem a flag saem
  dezenas de `[motor] DRIFT ... usando fallback` que sao da AUDITORIA. Os scripts
  desta frente exigem ou documentam a flag.
- **A funcao (1) hoje insere ZERO** — entries PRT x `producao_contrato` batem em
  2026-06 (10.238), 2026-07 (10.258) e 2026-08 (10.200) — e ainda assim queima o
  tempo. Decisao do Diego: nao otimizar agora; dentro do worker o custo e
  irrelevante.
- **O probe de RPC por assinatura VOLTOU a funcionar.** A nota antiga dizia que
  "esta versao do PostgREST nao emite a dica". Emite: PostgREST **14.5** devolve
  `PGRST202` com `"hint": "Perhaps you meant to call the function ..."`. O que
  continua sendo falso negativo e o `Accept-Profile` de schema nao exposto, que
  da a MESMA mensagem de um schema inventado.
- **2026-05 AL1:** FME `operacoes` 5.970 contra **5.862** chaves `NRO OPERACAO`
  distintas em 6.001 linhas de entries (medido hoje). A nota de 28/08 dizia 5.963
  chaves — ou o dado andou, ou os metodos de contagem diferem. Nao mergulhado.
