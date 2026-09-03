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

### PENDENTE E BLOQUEANTE

**A migration `supabase/migrations/20260903_000002_materializacao_fila.sql` NAO
foi aplicada.** O portao `scripts/gate_materializacao_fila.cjs` reprova em **D1**
(tabela) e **D3** (RPC) ate ela rodar — isso e projeto, nao defeito: sem ela a
rota enfileira para ninguem.

Medido no Studio em 03/09/2026, antes: `pg_extension` vazio;
`pg_available_extensions` com **pg_cron 1.6.4**, `installed_version` NULL. Por
isso o `create extension` entra na propria migration.

Depois de aplicar, a prova de ponta a ponta **sem import**:

```sql
insert into materializacao_fila (origem, year, month) values ('manual', 2026, 8);
-- ... 1 min ...
select status, ms, linhas_carteira, carteira_competencia_max, erro
  from materializacao_fila where origem = 'manual' order by criado_em desc limit 1;
```

E daqui: `node scripts/gate_materializacao_fila.cjs` fica verde e
`node scripts/diag-materializacao-async-medir.cjs` passa a responder as secoes 4 e 5.

### ARMADILHA que o portao documenta

Antes da migration, chamar o worker devolve `PGRST202` — **o mesmo codigo que o
revoke produz depois de aplicada**. Ler isso como "o revoke pegou" seria verde
por vacuidade, entao a assercao **D10 fica suspensa ate D3 passar**.

### Gates (depois do commit)

`npm run gates` **39/39**. `npm run gates:db`: 5 vermelhos — 1 desta frente
(D1/D3, esperado) e **4 anteriores e alheios**, nenhum deles lendo os modulos
tocados aqui: `produto_pmr_empresa_dona` (crash de teardown 3221226505),
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
2026-08-30T00:34:32). **Isso NAO e um alarme a apagar.** Ele diz a verdade: a
regua de hoje produziria um PMR diferente do que esta gravado, e a decisao foi
manter o gravado. Quem for "consertar" o STALE de julho reconsolidando esta
retirando R$ 5.225,75 de 20 promotores ja pagos.

Refazer a medicao a qualquer momento, sem gravar:
```
COMPETENCIAS=2026-07 TRP_SOURCE=db node -e "require('./scripts/_ts_register.cjs');require('./scripts/diag-reconsolidar-dryrun-jul-abr.cjs')"
```

**2026-08 tambem esta STALE** (`stored_fp` `45a4f9a431a3fd7c15a1ad95dcecc053`,
`current_fp` `63faefb962f27c3153e29583946a41d8`, gravada em 2026-09-02T21:09:44).
E de **classe diferente** da de julho — ver o diag `adcf3da` — e NAO foi tocado
nesta frente.

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
