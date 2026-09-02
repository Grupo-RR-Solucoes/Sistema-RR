# TRP — vigência intra-mês (a TRP39 valendo a partir de 05/08/2026)

Branch: `feat/trp-vigencia-intra-mes` · base `71c9379` (main) · aberta em 31/08/2026.

## O problema, medido

A TRP39 passou a valer em **05/08/2026**. Essa data **só existe no e-mail da
Promotiva** — não está no PDF e, por decisão do Diego (31/08), **nunca estará**:
foi pontual e não vai ser corrigida na origem. A régua padrão da casa
(`vigenciaDaCompetencia`: último dia útil do mês anterior → penúltimo dia útil do
mês vigente) continua valendo para **todo o resto**; o tratamento de exceção é
exclusivo desta vigência.

Estado de `trp_rule_versions` em produção quando esta frente abriu:

```
2026-04 v1 ativa   2026-03-31..2026-04-29  TRP35
2026-05 v1 ativa   2026-04-30..2026-05-28  TRP36
2026-06 v1 ativa   2026-05-29..2026-06-29  TRP37
2026-07 v1 INATIVA 2026-06-30..2026-07-30  TRP38
2026-07 v2 ativa   2026-06-30..2026-07-30  TRP38
```

**Não há linha de 2026-08.** Agosto resolve hoje por *fallback em cascata* para a
TRP38 de julho — régua certa para 31/07–04/08 e errada para 05/08–28/08.

Efeito medido em 31/08 (`/tmp/vig.log`, 579 contratos RR de agosto pela
`contract_date` real):

```
até 04/08 (regem-se pela TRP38): 83     atingidos: 17   efeito  -115,28  <- DANO
de 05/08 em diante (TRP39)     : 496    atingidos: 100  efeito -1.397,87 <- legítimo
                                                   soma        -1.513,15
```

Os **-115,28** são o dano da falta de vigência intra-mês. Os -1.397,87 são a
TRP39 valendo e devem permanecer.

## Decisões do Diego (31/08/2026)

- **(a) Desenho 5a — duas linhas explícitas para 2026-08.** TRP38 materializada
  como v1 (31/07–04/08) e TRP39 como v2 (05/08–28/08). O 5b (só a TRP39, com a
  fatia 31/07–04/08 caindo na cascata) foi **recusado**: faria dinheiro de mês
  vivo depender de um mecanismo desenhado para "não subiram a TRP deste mês".
- **(b) O carimbo do PMR numa competência PARTIDA:** `trp_version_id = NULL` +
  coluna nova `trp_multi_versao boolean = true`. Carimbar a última régua seria
  gravar afirmação **falsa que confere** para os 83 contratos de 03–04/08 — pior
  que vazia. `NULL` diz "não cabe em um id"; o booleano impede que esse `NULL`
  seja lido como "esqueceram de carimbar" e dá ao
  `detectTrpStaleAfetadasPorVersao` critério para **não** marcar agosto como
  stale para sempre.
- **Ordem não negociável:** Fase 1 (só código, no-op provado) → Fase 2
  (migrations, SQL colado, o Diego roda no Studio) → Fase 3 (tela/staging/commit
  com o override). **Nenhuma régua sobe em nenhuma fase**; a TRP39 entra por
  último e só com autorização explícita.

## Por que a ordem é obrigatória

`resolveTrpRegraDb` usa `.maybeSingle()` na busca da versão ativa. Com **duas**
linhas ativas o PostgREST devolve erro, que o código converte em `TrpInfraError`
— e essa classe **propaga de propósito** (nunca vira fallback). Se a migration
rodar antes do deploy do código, `/promotores`, `/recebiveis` e o motor caem no
primeiro upload partido. É o gêmeo exato da armadilha do `piso_zerou`.

## DÍVIDA NOMEADA — não corrigida agora

> ## ⚠ ESTE PARÁGRAFO ESTAVA ERRADO. REMEDIADO EM 02/09/2026.
>
> O texto abaixo, riscado, afirmava que 28 diagnósticos passariam a medir agosto
> pela última régua. **É falso, e a próxima pessoa precisa saber QUE TIPO de erro
> foi**: não foi medição que envelheceu — foi **precaução escrita como se fosse
> medição**. Eu supus, no dia em que a Fase 1 entrou, que os scripts resolviam
> por competência, e escrevi isso com a mesma voz com que escrevo o que medi. Um
> leitor não tinha como distinguir.
>
> **O que a medição de 02/09 mostra:** `lib/motor.ts:605` e `:682` fazem
> `trpProvider(mes, op.contract_date ?? undefined)` — **o motor passa a data**.
> Logo, todo script que usa `buildTrpCreditProvider` + `calcularOperacao`
> resolve a fatia CERTA, porque quem consulta o provider é o motor, com a data do
> contrato em mãos. Medido: **29** scripts constroem provider assim, **28**
> mencionam `contract_date`, e os três nominalmente citados abaixo
> (`diag-16-veredito`, `diag-220147900-e-ads`, `diag-ausentes-valor-medido`)
> montam o `op` com `contract_date: r.contract_date`. O único que não menciona
> (`diag-bloco2-origem244.mts`) pré-carrega só `2026-04-15` e `2026-07-15` e
> nunca chega em agosto.
>
> **O que de fato sobra são 4 sítios, em DUAS formas diferentes** — está na
> dívida 3, no fim deste arquivo. Custou uma varredura de 10 minutos que eu não
> fiz na hora de escrever.
>
> ~~Os 28 scripts de `scripts/` que chamam `calcularOperacao` (dos quais os que
> constroem provider via `buildTrpCreditProvider`: `diag-16-veredito.mts`,
> `diag-220147900-e-ads.mts`, `diag-ausentes-valor-medido.mts`,
> `diag-bloco2-completo.mts` e os demais) passam a medir agosto pela ÚLTIMA
> régua da competência quando 2026-08 estiver partida — porque resolvem por
> competência, sem `contract_date`. Isso é certo para 496 contratos e errado
> para 83.~~

O mesmo vale, com efeito diferente, para o carimbo: os dois sítios que escrevem
`trp_version_id` (`app/api/calculate/monthly/route.ts:1015-1024` e
`lib/bbtsMonthly.ts:347`) resolvem a versão a partir de `${comp}-15` — dia 15,
que em agosto cai na TRP39. É exatamente o que a decisão (b) desarma na Fase 2/3.

## Janela

28/08 foi o penúltimo dia útil de agosto. Enquanto agosto **não** for
consolidado isto é conserto de mês aberto. Depois, é reprocessamento de mês
fechado, com a trava conhecida (`trava-competencia-janela-volume`).

## LIÇÃO — rodar os portões ANTES de commitar dá VERDE FALSO na G5

Aconteceu nesta frente, no PR #203. Eu rodei `npm run gates`, reportei **33/33**
e commitei depois. O CI reprovou o `gate_teto_avista_rr.ts`.

**Não foi CI × local.** Reproduzido nesta máquina, com `origin/main` recém-buscado
(71c9379, o mesmo do CI): reprova aqui também.

A causa é a forma de **três pontos**. A G5 roda
`git diff --name-only origin/main...HEAD`, que compara o *merge-base* com o
**HEAD commitado** — ela **não enxerga a árvore de trabalho**. Medido:

```
git diff --name-only origin/main...c149895  -> lib/motor.ts aparece: 1
git diff --name-only origin/main...8d8b9d4  -> lib/motor.ts aparece: 0
   (8d8b9d4 = o commit do handoff; mudava só o .md)
```

Quando rodei os portões, o HEAD era `8d8b9d4`: o `lib/motor.ts` estava alterado
**no disco**, mas ainda não commitado. O verde era verdadeiro naquele instante e
**não cobria a mudança do motor**.

Isso está documentado no próprio `scripts/_diffContraRef.ts`, e a distinção entre
os dois gates é deliberada:

> G5 usa `origin/main...HEAD` — só o COMMITADO da branch, desde a bifurcação.
> G6 usa `origin/main`        — a árvore de trabalho contra a main, então também
>                               pega alteração ainda não commitada.

É a mesma família da armadilha já registrada em
[[frente-runner-gates-3-faixas]] (gate novo ainda *untracked* dá verde falso
porque o passo de cobertura lê `git ls-files`), só que do outro lado: código
**modificado mas não commitado** passa por baixo da forma de três pontos.

**RITUAL, a partir de agora: COMMIT PRIMEIRO, GATES DEPOIS.** Ou re-rodar
`npm run gates` depois do commit, antes de abrir o PR. Um verde medido sobre um
HEAD que não contém a mudança não é verde sobre a mudança.

Corolário para quem for escrever gate novo: `A...B` mede commits, `A..B` e `A`
medem a árvore. Escolher a forma é escolher O QUE se afirma — e a G5 afirma
sobre o commitado de propósito, não por engano.

## FASE 2 APLICADA E VERIFICADA EM PRODUÇÃO — 01/09/2026

O Diego rodou as duas migrations no Studio, **depois** de o código da Fase 1
estar em produção (merge do PR #203 em `5f46418`, deploy Vercel de Production
concluído em 01/09 02:49:56). A ordem não negociável foi cumprida.

### `20260831_000001` — DDL

| prova | resultado |
|---|---|
| (a) `btree_gist` | **1.7**, no schema `extensions` |
| (b1) `ck_trp_vigencia_ordenada`, `ex_trp_vigencia_sem_overlap` | existem, `convalidated = true` |
| (b2) índices | `uq_trp_rule_versions_active_from` PRESENTE · `uq_trp_rule_versions_active` SUMIU |
| (c) as 5 linhas | intactas |
| (d) as 3 colunas | nuláveis, sem default |
| (e1) duas fatias sem sobrepor | **PASSOU** — é o caso TRP38/TRP39 |
| (e2) sobreposição | **23P01** `ex_trp_vigencia_sem_overlap` |
| (e3) mesmo `valid_from` ativo | **23505** `uq_trp_rule_versions_active_from` |
| (e4) mesma vigência INATIVA | **PASSOU** — o par de 2026-07 |
| (e5) vigência invertida | **23514** `ck_trp_vigencia_ordenada` |

A (e3) é a que importa mais: prova que **não perdemos a garantia antiga** — o
re-upload sem override continua colidindo, logo continua SUBSTITUINDO.

### `20260831_000002` — o RPC das três saídas

| prova | resultado |
|---|---|
| (a) assinatura | **1 só** (sem overload), `security_definer = true` |
| (b) grants | `service_role` EXECUTE · **nada** para anon/authenticated |
| (c1/c2) SAÍDA 0 + SAÍDA 2 (PARTE) | `1 t 2026-07-31..2026-08-04` (truncada) + `2 t 2026-08-05..2026-08-28` |
| (c3) SAÍDA 1 (SUBSTITUI) | a **v1 SEGUE ATIVA**; só a v2 foi desativada |
| (c4) SAÍDA 3 (RECUSA) | **P0001**, mensagem certa, linha 54 |

A (c3) prova o ponto do `where id = v_ativa.id`: com a competência partida,
substituir a última fatia **não derruba** a anterior. Era o risco real de
regressão do RPC.

**Uma diferença entre o esperado e o medido, e ela não é defeito:** o (b) trouxe
`postgres EXECUTE` além do `service_role`, e o bloco de verificação dizia
"service_role EXECUTE, e NADA para anon/authenticated/public". `postgres` é o
**dono** da função e mantém EXECUTE por propriedade — o `revoke ... from public,
anon, authenticated` não o alcança, e não deveria. A fronteira de segurança que
importa (anon/authenticated sem nada) está intacta. Foi a minha linha de
"esperado" que foi incompleta, não o resultado.

### Conferido por medição independente (01/09, via service_role)

Não tomei o relato como prova. Medido daqui depois do Studio:

```
promoter_monthly_results.trp_multi_versao  -> existe (null)
trp_rule_uploads.valid_from_override       -> existe (null)
trp_rule_versions: 5 linhas, 4 ativas, NENHUMA de 2026-08
```

Os `rollback` das provas funcionais não deixaram resíduo. **Nenhuma régua subiu.**

### Onde a frente está

- Fase 1 (código) — **em produção**.
- Fase 2 (estrutura) — **aplicada e verificada**.
- Fase 3 — **AUTORIZADA em 01/09/2026 e partida em 3 blocos** (ver a seção do
  bloco 1 no fim deste arquivo). O bloco 1 (carimbo + detector) está commitado;
  o bloco 2 liga o `valid_from_override` da ponta à ponta; o 3 é a TRP39.
- A **TRP39 não subiu** e só sobe por último, com autorização explícita.

**O banco hoje aceita a vigência partida e ninguém a usou ainda.** Agosto segue
resolvendo por cascata para a TRP38 de julho — certa até 04/08, errada de 05/08
em diante, os mesmos −115,28 de dano medido. A estrutura está pronta; o conserto
só acontece na Fase 3 + upload.

## FASE 3 — BLOCO 1 (carimbo + detector) COMMITADO — 01/09/2026

Branch `feat/trp-vigencia-fase3-carimbo`, commit `61802ba`, base `b608407`.
**Nenhuma régua subiu. Nenhum valor mudou.**

### A janela, medida antes de mexer (service_role, somente leitura)

```
promoter_monthly_results 2026-08 ....... 0 linhas   (controle: 2026-07 = 58)
trp_rule_versions ...................... 5 linhas, 4 ativas, ZERO de 2026-08
promoter_monthly_results.trp_multi_versao  existe, 0 linhas não-nulas no banco
trp_rule_uploads.valid_from_override ....  existe, 1 linha (2026-07), null
```

O PMR de agosto ainda não nasceu — o fechamento da Promotiva chega dia 03/04.
Este bloco entra ANTES dele: se só ele estiver de pé quando o fechamento chegar,
agosto nasce carimbado **honesto** (id da TRP38 por cascata, que é a verdade
enquanto a TRP39 não subir).

### A ordem dentro da Fase 3, e por que o bloco 1 vem sozinho

A janela de 2-3 dias **não é para a régua — é para o carimbo**. Se a TRP39
subisse antes, o PMR de agosto nasceria com `trp_version_id` = TRP39 nas linhas
dos 83 contratos de 31/07-04/08. E, ao contrário do valor, **reprocessar não
conserta**: gravaria a mesma mentira de novo.

### O que entrou

- `lib/trp/carimboPmr.ts` — régua ÚNICA das 3 saídas do carimbo. Os dois
  escritores consomem; nenhum decide por conta própria.
- O comentário do `${comp}-15` reescrito nos dois sítios: virou **chave de
  cache**, não escolha de régua (o motor resolve por `contract_date` desde a
  Fase 1). Em agosto o dia 15 cai na TRP39 — era daí que saía o id falso.
- `classify` ganhou o 5º estado `MULTI_VERSAO`, lido SEMPRE com `=== true`. O 4º
  parâmetro é opcional: ausente se comporta exatamente como antes.
- `ledgerHealth`: item `trp_multi_versao`, severidade **info**. Agosto não podia
  cair em `trp_desconhecido` — aquela descrição seria falsa nas duas metades, e
  alerta que nunca apaga treina todo mundo a ignorar o painel.
- `PmrReconsolidarCard`: banner e chip próprios. Sem isso a tela diria "Nenhuma
  linha usa TRP em agosto/2026" — flatly falso — e no cross agosto não apareceria
  em bucket nenhum.

### DÍVIDA (ii) — dita em voz alta, e ASSERTADA no portão

**Staleness de competência partida não é detectável pela Camada 1.** Nem hoje
nem depois. O PMR guarda UM id; uma competência partida foi produzida por N
réguas; o NULL honesto tira um dos dois lados da comparação que É a Camada 1.

Custo concreto: subir uma TRP39 v3 corrigida **não vai oferecer reconsolidar
agosto — nunca**. Quem reconsolidar agosto faz a mão, porque decidiu.
`detectTrpStaleAfetadasPorVersao` NÃO foi alterada, de propósito. O conserto
(`trp_version_ids uuid[]`) está escrito no topo do detector para quando o caso
deixar de ser único.

### Portões — rodados DEPOIS do commit (a lição da G5, cumprida)

- `npm run gates` (faixa rápida): **34/34**, com o gate novo
  `gate_trp_carimbo_multi_versao` (1,4s) e o `detector_regua_camada1` re-apontado.
- `npm run typecheck:gates`: **limpo**.
- `npx tsc --noEmit`: **limpo**.
- `npm run gates:db`: 26/31, **5 vermelhos — TODOS PRÉ-EXISTENTES**. Medido, não
  afirmado: worktree em `origin/main` (b608407), os mesmos 4 gates, os MESMOS
  códigos de saída (`produto_pmr_empresa_dona` 1, `competencia_janela_comissoes`
  1, `check_audit_v9_tables` 4, `gate-srcc-ads` 1). O 5º é o teto de tempo da
  faixa (159,9s de 90s), que é da faixa e não deste commit — o gate novo é
  self-contained e roda na rápida.
- `gate_schema_colunas`: **PASSOU** nos dois lados, e a diferença é a prova de
  que a coluna existe no banco real: 2.868 colunas pedidas na base, **2.871**
  aqui. Ele aborta no teardown pelo bug conhecido do libuv (a mesma nota que
  está em `detector_regua_camada1_gate.cjs`) — aborta igual em `origin/main`.

### Onde a frente estava quando o bloco 1 foi commitado

- Fase 1 (código) — em produção.
- Fase 2 (estrutura) — aplicada e verificada.
- **Fase 3 bloco 1 (carimbo + detector) — commitado, aguardando merge e deploy.**
  É o que precisa estar em PRODUÇÃO antes de o fechamento de agosto chegar.
- Fase 3 bloco 2 (o override ponta a ponta, **com a validação preventiva do
  buraco junto, não depois**) — próximo.
- Fase 3 bloco 3 (a TRP39 pela tela, com o Diego confirmando 05/08) — por último.

**Se o fechamento chegar antes do deploy do bloco 1:** ou segurar a importação,
ou aceitar que agosto nasce com carimbo mentiroso — e, pela dívida (ii), ninguém
vai ser lembrado de consertar.

> REMEDIADO em 01/09/2026: os três blocos foram para produção no mesmo dia
> (90daea6 e f08fbb8, ambos Production/Ready) e a TRP39 subiu às 23:04. O estado
> final está na seção **FRENTE FECHADA**, no fim deste arquivo. O aviso acima
> deixou de valer: o fechamento não chegou antes do deploy.

---

# FRENTE FECHADA — 01/09/2026, 23:04:26Z

**A TRP39 está viva com vigência a partir de 05/08/2026, e agosto está partido
em duas fatias explícitas.** Foi o que a frente inteira existiu para permitir.

## O estado final, medido (somente leitura, service_role)

`trp_rule_versions` — 7 linhas:

```
2026-04-01 v1 ATIVA   2026-03-31 .. 2026-04-29 | TRP35 | 702e8431 | 2026-07-02T01:27:20
2026-05-01 v1 ATIVA   2026-04-30 .. 2026-05-28 | TRP36 | 545d1dec | 2026-07-02T01:27:20
2026-06-01 v1 ATIVA   2026-05-29 .. 2026-06-29 | TRP37 | ff32f334 | 2026-07-02T01:27:20
2026-07-01 v1 INATIVA 2026-06-30 .. 2026-07-30 | TRP38 | 563fec5d | 2026-07-03T23:17:03
2026-07-01 v2 ATIVA   2026-06-30 .. 2026-07-30 | TRP38 | 59025dd8 | 2026-07-17T23:29:13
2026-08-01 v1 ATIVA   2026-07-31 .. 2026-08-04 | TRP38 | b7bcd68f | 2026-09-01T22:55:20
2026-08-01 v2 ATIVA   2026-08-05 .. 2026-08-28 | TRP39 | f85dac76 | 2026-09-01T23:04:26
```

Agosto: **duas linhas, as duas ATIVAS**, sem se cruzar. A v1 nasceu cobrindo a
janela inteira (31/07–28/08) no passo 1 e foi TRUNCADA em 04/08 pelo passo 2 —
é a SAÍDA 2 (PARTE) do RPC tendo rodado, com o UPDATE antes do INSERT.

**Julho INTACTO**: 2 linhas, 1 ativa, `30/06..30/07` nas duas, `uploaded_at` de
03/07 e 17/07 — não foram tocados. É a prova do `where id = v_ativa.id` que a
Fase 2 introduziu: com a competência partida, substituir/partir NÃO derruba a
fatia anterior nem vaza para outra competência.

**A trilha completa** — `trp_rule_uploads`:

```
2026-07-01 confirmado  override= null        | committed= 563fec5d | TRP38
2026-08-01 confirmado  override= 2026-08-05  | committed= f85dac76 | TRP39
```

O `committed_version_id` aponta para a v2 de agosto. A data que só existia no
e-mail da Promotiva está registrada **como declaração**, não apenas como efeito
— porque o commit foi feito pelo staging, e não pelo fluxo direto.

## A prova pelo motor REAL

Resolvedor sobre 2026-08: `partida: true`, 2 fatias, janela `31/07..28/08`.

```
ATE 04/08 -> v1 (TRP38, b7bcd68f)
  213731664  2026-08-04  1,9600%   213683815  2026-08-04  4,3100%
  213058364  2026-08-03  2,3500%
DE 05/08  -> v2 (TRP39, f85dac76)
  216022526  2026-08-27  3,2100%   216004133  2026-08-27  0,0000%
  216005364  2026-08-27  3,2100%
```

**Varredura exaustiva: 599 contratos da competência 2026-08 (74 até 04/08 e 525
de 05/08), ZERO fora da fatia esperada.**

## O NÚMERO QUE DECIDE

```
contratos ate 04/08 que MUDARAM:   0    delta      0,00   <- o dano NAO aconteceu
contratos de 05/08 que MUDARAM : 104    delta -1.452,18   <- legitimo, a TRP39 valendo
contratos de 29-31/08 (compet. 2026-09, por cascata): 12   delta   -200,52
delta TOTAL:                                        -1.652,70
```

**Zero.** Os contratos de 31/07 a 04/08 não mudaram um centavo: seguem na TRP38,
que é o que a v1 grava. **Os −115,28 medidos em 31/08 — o dano da falta de
vigência intra-mês — NÃO ACONTECERAM.** Era exatamente para isso que esta frente
existiu.

Os −1.452,18 são a TRP39 valendo, e são maiores que os −1.397,87 de 31/08 porque
agosto continuou entrando (496 → 525 contratos daquele lado).

Os 12 contratos de 29–31/08 mudaram porque a competência **2026-09** não tem
régua e agora herda por cascata a TRP39 (antes herdava a TRP38 de julho). Está
CERTO — e é o desempate por `valid_from` da Fase 1 que faz a cascata pegar a
TRP39 e não a v1 de agosto. Quando a TRP40 subir, esses números mudam de novo.

## CORREÇÃO DE UM NÚMERO MEU: 74/525, não 83/558

O recorte que circulou em 31/08 e em 01/09 — "83 até 04/08 e 558 de 05/08" — era
por **data crua**. Pela **competência real** (que é o que o motor usa) os 641
registros filtrados por `movement_date` de agosto se distribuem assim:

```
2026-07: 9    2026-08: 599    2026-09: 33
```

Dos 83, nove são de 30/07 ou antes e pertencem a **2026-07**; dos 558, trinta e
três são de 29–31/08 e pertencem a **2026-09**. O par correto para agosto é
**74 / 525**. Não muda o desenho nem o resultado — muda o número que se cita.

## O `TrpVigenciaGapError` disparou no DADO VIVO

Por acidente de script: pedi a fatia de um contrato de **31/08** dentro da
competência 2026-08. O resolvedor RECUSOU:

> BURACO de vigência em 2026-08 — a data 2026-08-31 não é coberta por nenhuma
> das 2 régua(s) ativa(s) [2026-08-05..2026-08-28, 2026-07-31..2026-08-04].
> Não escolho "a mais próxima": isso pagaria pela régua errada em silêncio.

O erro era do script; a recusa está certa. Vale como prova acidental de que o
FALHA ALTO funciona no dado de produção, não só na fixture do portão.

## Onde a frente está

- Fase 1 (resolvedor tolera N réguas) — **em produção**.
- Fase 2 (DDL + RPC das 3 saídas) — **aplicada e verificada**.
- Fase 3 bloco 1 (carimbo honesto + 5º estado) — **em produção** (90daea6).
- Fase 3 bloco 2 (override + anteparo do buraco) — **em produção** (f08fbb8).
- Fase 3 bloco 3 (a TRP39 pela tela) — **FEITO**, 01/09 22:55 e 23:04.

PMR de 2026-08 continua em **0 linhas** e o fechamento da Promotiva não chegou:
tudo isto é conserto de mês ABERTO, sem reprocessamento e sem PMR a reconsolidar.

A **TRP40 (setembro) NÃO subiu**. Está em disco, e subir é outra decisão.

## AS TRÊS DÍVIDAS QUE FICAM

> **STATUS EM 02/09/2026** — uma frente própria, só de dívidas, foi aberta e a
> ordem decidida foi **3 → 2 → 1**, com o VIGIA por fora.
>
> | # | o que é | estado |
> |---|---|---|
> | 1 | o diff da tela pela competência ANTERIOR (`.lt`) | **RESOLVIDA** em 02/09 (régua única + rótulo por fatia) |
> | 2 | rascunho sem override não pode ganhar a data | **RESOLVIDA** em 02/09 (aviso condicional) |
> | 3 | a classe "provider sem data" | **RESOLVIDA** em 02/09 (4 sítios + portão) |
>
> As seções abaixo ficam como estão, com o registro do que era o defeito; o que
> mudou está anotado no fim de cada uma.

### 1. O diff da tela compara com a competência ANTERIOR, não com a fatia ativa da MESMA

`app/api/trp/parse/route.ts:61` e o gêmeo em `app/api/trp/staging/[id]/route.ts`
buscam a base do diff com `.lt("competencia", firstDayAlvo)` — competência
**estritamente anterior**. O desempate por `valid_from` está lá (entrou na Fase
1, para o caso de a competência ANTERIOR estar partida); o que falta é olhar
para a própria competência primeiro.

Enquanto uma competência tinha uma régua só e o upload SUBSTITUÍA, "a anterior"
era a única base possível. Com vigência partida isso deixa de valer no instante
em que a competência já tem régua — que aconteceu pela primeira vez na história
em 01/09, no passo 2.

**Sem consequência hoje, e isso foi MEDIDO**: comparei `2026-07 v2` (a base
usada) com `2026-08 v1` (a base correta) — 11 produtos, mesmas chaves, **0
diferenças**. São a mesma régua, então as células amarelas exibidas eram
idênticas às que a base certa produziria. O diff é só EXIBIÇÃO: não entra em
nada do que é gravado.

**Onde engana de verdade:** numa **v3** corrigindo a TRP39. A base certa seria a
2026-08 v2, mas a tela mostraria a TRP38 de julho e pintaria de amarelo tudo o
que a TRP39 já havia mudado, como se fosse novidade da correção.

**Conserto:** base = última fatia ATIVA da MESMA competência, se houver; senão a
cascata para a anterior. Dois sítios. **É o primeiro item da próxima frente.**

### ✔ RESOLVIDA em 02/09/2026 — régua única + o rótulo dizendo a FATIA

`lib/trp/baseDoDiff.ts` (novo): a última fatia ATIVA da PRÓPRIA competência — a
mesma contra quem o RPC decide substituir/partir — com fallback para a anterior
quando o mês ainda não tem régua. Os dois sítios eram cópia um do outro e agora
chamam o mesmo helper; o `.lt` inline saiu dos dois.

O rótulo da tela passou a dizer a fatia e a vigência, e a distinguir base própria
de herdada: *"Comparando com **2026-08 v1** (2026-07-31 a 2026-08-04) — a régua
que está valendo nesta competência"*. Antes dizia só `2026-07 (v2)`, que era
verdade sobre o que ele comparava e mentira sobre o que ele devia comparar.

Portão `scripts/gate_trp_base_do_diff.cjs` (self-contained), com as 2 mutações —
voltar ao `.lt` (bases divergem, e as RÉGUAS divergem) e remover o fallback (o
primeiro upload do mês perde o diff). **A fixture não repete o azar de produção**:
lá as duas bases são a mesma régua, e é por isso que o defeito passou
despercebido; com réguas iguais na fixture a mutação não derrubaria nada. O bloco
0 prova que as três réguas da fixture são diferentes antes de qualquer asserção
depender disso.

### 2. Rascunho salvo SEM override não pode ganhar a data depois

Fechei uma armadilha e abri outra. No fluxo DELEGADO o campo do override é
**só-leitura** (`trp-ov--ro`), porque o servidor lê o override da LINHA do
staging: se o campo fosse editável ali, o sócio mudaria a data, confirmaria, e o
sistema usaria a outra. Correto.

Só que o botão "Salvar rascunho" **não existe com um rascunho aberto**
(`{!currentUploadId ? <Button…/> : null}`). Consequência: um rascunho salvo sem
override **não tem como receber a data pela caixa de rascunhos**.

Isso ACONTECEU em 01/09: o rascunho da TRP39 foi salvo com
`valid_from_override = null`. Confirmá-lo assim não partiria nada — cairia na
SAÍDA 1 (SUBSTITUI), desativando a v1 e pondo a TRP39 valendo 31/07–28/08, que é
exatamente o desenho **5b recusado pelo Diego**. Foi pego na conferência, não
pelo sistema: **nada avisa**.

O contorno usado (e que funciona): subir o PDF de novo — upload fresco reabre o
campo —, marcar, digitar a data e **Salvar rascunho**, o que SOBRESCREVE a mesma
linha pendente (o POST faz upsert por competência), agora com o override; e só
então confirmar pela caixa.

**Conserto possível (não decidido):** ou exibir "Salvar rascunho" também com
rascunho aberto (e aí o campo volta a ser editável, com o salvar sendo o único
caminho para valer), ou um aviso explícito na revisão delegada quando o rascunho
NÃO tem override, dizendo que confirmar vai SUBSTITUIR e não partir. A segunda é
menor e não reabre a armadilha original.

### ✔ RESOLVIDA em 02/09/2026 — saída (i), o aviso condicional

Decisão do Diego: a (i), **sem** reabrir a armadilha do só-leitura.

A condição virou régua pura em `lib/trp/avisoRascunhoSubstitui.ts`, com **três
pernas**, e a terceira é a que evita ruído:

```
1. estamos no fluxo DELEGADO (há rascunho aberto)
2. o rascunho NÃO tem override
3. a competência JÁ TEM régua ativa      <- sem esta, o aviso apareceria em todo
                                            primeiro upload de todo mês, onde
                                            confirmar sem override é o caminho
                                            NORMAL. Aviso que aparece quando não
                                            há o que avisar treina a ignorar.
```

A perna (3) é **estado do banco** — o client não tem como saber. Por isso o
`GET /api/trp/staging/[id]` passou a devolver `fatiasAtivas` (as fatias ATIVAS da
PRÓPRIA competência, só-leitura).

O aviso **diz o que acontece e o que fazer**, não "atenção, verifique": nomeia a
fatia que será desativada (a de maior `valid_from`, calculada em código e não por
posição na lista), diz que a régua do PDF passará a valer o mês inteiro, e ensina
o caminho — subir o PDF de novo pelo formulário, marcar a caixa, informar a data
e **salvar o rascunho**, que substitui o pendente já com a data.

Portão: bloco 7 do `gate_trp_override_vigencia`, com **3 mutações**: sem condição
(o aviso apareceria no rascunho partido e no mês vazio), sem aviso (o caso
perigoso passa calado) e sem a perna do override (o rascunho que PARTE receberia
o aviso).

### 3. PROVIDER SEM DATA — a terceira ocorrência da MESMA classe em 24 horas

Esta não é uma dívida a mais na lista: é **um padrão**, e ele se manifestou três
vezes em um dia, sempre igual.

```
ontem      os 28 scripts de diagnostico que chamam calcularOperacao   (NOMEADA no handoff)
01/09 21h  o meu proprio script de medicao da frente                  (escolherFatia sem competencia certa)
01/09 23h  scripts/paridade_avista_trp_gate.cjs — PORTAO REGISTRADO   (providerPrev sem data)
```

**A anatomia é sempre a mesma.** Todos foram construídos ANTES da Fase 1, num
mundo em que competência tinha **uma régua só**. Nesse mundo, resolver por
competência sem passar a data era *correto* — não havia o que escolher. Todos
continuaram "certos" por meses. E todos ficaram **silenciosamente errados no
instante em que a primeira competência partida passou a existir**, em 01/09/2026
às 23:04. Nenhum deles quebrou: eles passaram a responder a pergunta errada com
cara de resposta certa.

O caso do portão é o mais instrutivo porque ele **acusou a produção de um defeito
que a produção não tem**: 19 divergências, todas de contratos de 31/07–04/08,
com o `previsto` dando TRP39 onde o motor dava TRP38. A causa era uma linha:

```js
// o portao, escrito antes da Fase 1:
const providerPrev = (c) => preloader.getResolvedSync(c);           // <- sem data
// a producao, avistaProducao.ts:208:
provider = (competencia, contractDate) =>
  preloader.getResolvedSync(competencia, contractDate ?? null);     // <- com data
```

Corrigido em 01/09. **Prova, não leitura:** com a data repassada, **2411/2411
contratos iguais, 0 divergências**.

#### REGRA: todo provider construído antes de 01/09/2026 está sob suspeita

E o teste é uma pergunta só: **ele repassa a `contractDate`?**

Varredura feita em 01/09/2026 (`getResolvedSync(` / `getRegraSync(` em `lib/`,
`app/`, `components/`, `scripts/`):

**PRODUÇÃO — os 4 sítios estão CERTOS, todos passam a data:**

```
lib/recebiveis/avistaProducao.ts:208   getResolvedSync(competencia, contractDate ?? null)
lib/trp/conferenciaTrp.ts:126          getResolvedSync(ym, contractDate ?? null)
lib/trp/conferenciaTrp.ts:181          getResolvedSync(ym, contractDate ?? null)
lib/trp/creditTrpProvider.ts:97,99     getRegraSync/getResolvedSync(competencia, contractDate ?? null)
```

**E SÃO DUAS FORMAS, não uma** (medido em 02/09/2026 — a primeira versão desta
dívida tratava tudo como o mesmo caso, e não é):

- **forma (a) — resolução POR CONTRATO.** Aqui faltar a data É o defeito: numa
  competência partida cai sempre na última fatia. Conserto = passar a data.
- **forma (b) — inspeção da RÉGUA DO MÊS.** Aqui "passar a data" NÃO é o
  conserto: a pergunta é "a TRP vigente tem o campo X?", e numa competência
  partida **não existe *a* régua, existem duas**. Conserto = iterar TODAS as
  fatias ativas e exigir a asserção em CADA uma. Passar uma data só trocaria
  uma fatia arbitrária por outra.

**scripts/ — o que sobra, com a forma e o dano de cada um:**

```
(a) scripts/paridade_avista_trp_gate.cjs:121  CONSERTADO em 01/09 (era o vermelho falso)
(a) scripts/diag_julho_candidate_list.cjs:46  nao registrado. Gemeo exato do acima:
                                              resolveAvistaTrpDb(rec, (c) => getResolvedSync(c))
(a) scripts/trp_paridade_f5_json.cjs:148      nao registrado. Mesma forma.
(b) scripts/trp_prazo_min_gate.cjs:89         REGISTRADO. getRegraSync(COMP), e a COMP e
                                              DESCOBERTA (compsRR[length-1], a ultima com
                                              contrato) — ele ja aponta para agosto/setembro e
                                              afirma sobre "a regua vigente" tendo olhado UMA
                                              fatia. Verde por sorte, e sem NOMEAR na saida qual
                                              competencia escolheu.
(b) scripts/trp_tx_juros_min_gate.cjs:87      REGISTRADO. getRegraSync("2026-07") — julho nao
                                              esta partida, entao esta certo HOJE por sorte da
                                              competencia cravada, nao por construcao.
```

Os dois portões REGISTRADOS acima estão **verdes e não foram tocados** — verdes
por medirem competência de régua única, não por passarem a data. É verde por
sorte da competência, e a sorte acaba quando alguém partir a competência que
eles olham.

## VIGIA — o carimbo NUNCA rodou contra dado real (verificação com gatilho)

**Não é dívida e não entra em fila: é uma verificação que espera um gatilho
externo.** Medido em 02/09/2026:

```
PMR 2026-08: 0 | linhas com trp_multi_versao NAO nulo (banco INTEIRO): 0
fechamento de 2026-08 importado: 0
```

`trp_multi_versao` **nunca foi escrito uma vez sequer, em lugar nenhum**. O
portão `gate_trp_carimbo_multi_versao` prova o caminho com stub de Supabase; o
banco nunca viu. E agora existe a primeira competência partida da história, então
a **primeira gravação real** acontece quando o fechamento da Promotiva entrar.

**O GATILHO:** o PMR de 2026-08 nascer (`promoter_monthly_results` deixar de ter
0 linhas para year=2026, month=8).

**O QUE CONFERIR, na hora:**

1. as linhas `source='daily'` e `source='bbts'` de 2026-08 saíram com
   `trp_version_id = NULL` **E** `trp_multi_versao = true` — as duas coisas, não
   uma. `NULL` sozinho é indistinguível de "esqueceram de carimbar";
2. as linhas `source='fechamento'` (RR) seguem com os dois NULL — elas não usam
   TRP e isso é legítimo;
3. `detectTrpStaleForCompetencia({year:2026,month:8})` devolve
   `has_multi_versao: true`, `has_desconhecido: false` e `has_stale: false`;
4. o `ledgerHealth` põe agosto no item **`trp_multi_versao` (info)** e **NÃO** em
   `trp_desconhecido` (alerta).

**SE SAIR ERRADO:** a decisão (b) inteira cai — o carimbo honesto não estaria
sendo gravado, e a fila de dívidas muda de assunto na hora. Custo da conferência:
~15 minutos, somente leitura.

**Por que isto precisa estar escrito:** pela dívida (ii) deste mesmo arquivo,
**nada acusa** uma competência partida mal carimbada. Não há alerta, não há
oferta de reconsolidação, não há vermelho. Se ninguém for olhar por decisão, não
se olha nunca.

#### ✔ RESOLVIDA em 02/09/2026 — 4 sítios + o portão que vigia a classe

- **forma (a)**, 1 linha cada: `diag_julho_candidate_list.cjs` e
  `trp_paridade_f5_json.cjs` passaram a repassar a data.
- **forma (b)**: `trp_prazo_min_gate` e `trp_tx_juros_min_gate` passaram a
  resolver a competência inteira, **imprimem quantas fatias ativas acharam** e
  rodam a asserção **em cada fatia**. No `prazo_min` apareceu um segundo defeito
  que não estava na lista: o piso do sintoma vinha de uma régua só, então o prazo
  de um contrato de 03/08 seria comparado com o piso da régua de 05/08 — passou a
  vir da fatia que rege AQUELE contrato.
- **portão novo** `scripts/gate_provider_repassa_data.cjs` (self-contained,
  0,5s): asserção dura sobre produção, allowlist assinada (hoje vazia) com
  checagem de entrada morta, não-vacuidade, e mutação do scanner.
- **bloco (E) vivo** dentro do `gate_trp_vigencia_intra_mes` (needs-db):
  resolve a mesma competência com e sem data e exige fatias DIFERENTES. Contra
  produção: `2026-08`, sem data → v2, com `2026-07-31` → v1. Com auto-declaração
  de vacuidade obrigatória se um dia não houver competência partida.

O desenho abaixo é o que foi proposto e implementado.

#### PORTÃO PROPOSTO (implementado em 02/09/2026)

Um portão que varra os **construtores de provider** e exija que repassem a data.
Esboço do que ele mediria, e por que dá para fazer sem heurística frágil:

1. **Varredura estática, universo fechado.** Casar
   `/(getResolvedSync|getRegraSync)\s*\(([^)]*)\)` em `lib/`, `app/`,
   `components/` e `scripts/`. Cada ocorrência tem 1 ou 2 argumentos — contar
   vírgulas de topo já separa os dois casos. Universo hoje: 11 sítios, dos quais
   6 com data e 5 sem.
2. **A asserção dura, e ela é sobre PRODUÇÃO:** nenhum sítio em `lib/`, `app/`
   ou `components/` pode chamar com 1 argumento. Isso é invariante permanente, e
   é o que impede a regressão que importa (dinheiro e tela).
3. **A lista NOMEADA para `scripts/`:** um allowlist explícito, com motivo, para
   os que ficam sem data de propósito. Sair da lista sem passar a data reprova;
   entrar na lista exige escrever o porquê. Isso transforma "dívida esquecida"
   em "dívida assinada".
4. **A parte que só um portão VIVO pega**, e que vale mais que a estática:
   quando existir competência partida no banco, resolver a MESMA competência
   com e sem data e exigir que os resultados **difiram** — se derem igual, ou a
   competência não está partida (e o portão se declara vacuidade em voz alta,
   não passa calado), ou o `contractDate` parou de ser honrado pelo preloader,
   que é o defeito de verdade.
5. **Custo:** ~120 linhas, self-contained na parte estática; a parte (4) é
   needs-db e a faixa `--db` já está estourando o teto (276,3s de 90s), então
   ela entraria como bloco condicional do portão da vigência intra-mês, que já é
   needs-db, em vez de portão novo.

O que este portão NÃO resolve: um provider construído fora destes dois nomes de
função. Se alguém criar um terceiro caminho de resolução, a varredura não o vê —
e a única defesa continua sendo a regra escrita aqui.

---

## A LINHA DE BASE DO `trp_desconhecido` — medida 02/09/2026, ANTES do import

A decisão (b) nunca rodou contra dado real. **2026-08 é a primeira competência
PARTIDA** (TRP38 até 04/08 `b7bcd68f`, TRP39 de 05/08 `f85dac76` — conferido no
banco), e o PMR de agosto ainda não existe: o import do fechamento da ADS é o que
vai acioná-la.

Antes disso, o contador do vigia foi medido:

```
trp_stale            count=0  (erro)
trp_desconhecido     count=1  (alerta)   detalhe: [{"year":2026,"month":6}]
trp_multi_versao     count=0  (info)
```

**`trp_desconhecido` JÁ ESTÁ EM 1, e aponta para JUNHO/2026.** Isso é **anterior
a esta frente** e não tem relação com agosto: é PMR fechado da ADS calculado
antes de o rastreamento existir, e resolve numa reconsolidação de junho.

### O que se cobra quando agosto entrar

> **O contador tem de CONTINUAR EM 1, e o detalhe tem de continuar dizendo só
> junho.** Se virar **2** — ou se `2026-08` aparecer no detalhe — agosto caiu no
> **bucket errado** e a **decisão (b) falhou**.

O erro que isso pegaria é preciso: a competência partida estaria sendo
classificada como *"esqueceram de carimbar"* (`trp_desconhecido`, alerta) em vez
de *"não cabe em um id"* (`trp_multi_versao`, info). O `ledgerHealth.ts:312-317`
já explica por que os buckets são separados — a descrição do `trp_desconhecido`
seria falsa nas duas metades: agosto foi calculado **com** rastreamento, e
reconsolidar grava o **mesmo** NULL. *"Alerta que nunca apaga treina todo mundo a
ignorar o painel."*

Nota: **zero não é a expectativa correta** aqui. Cobrar `trp_desconhecido === 0`
faria o vigia reprovar por causa de junho, que é dívida legítima e conhecida. A
asserção certa é *não cresceu* + *agosto não está na lista*.

### Onde isso está cravado, para não depender de memória

Comparar "antes × depois" a olho depende de alguém lembrar do número. Por isso a
base virou **constante conferida** em `scripts/diag-vigia-carimbo-trp.cjs`:

```js
const DESCONHECIDO_BASE = 1;
const DESCONHECIDO_BASE_COMPETENCIAS = ["2026-06"];
```

O script imprime `linha de base` e `agora` lado a lado e reprova (exit 1) se
crescer ou se a competência-alvo aparecer no detalhe.

### Como rodar o vigia

```
node scripts/diag-vigia-carimbo-trp.cjs            # 2026-08 alvo, 2026-07 controle
node scripts/diag-vigia-carimbo-trp.cjs 2026-08 2026-07
```

**Só depois do import do fechamento da ADS.** O fechamento da **RR não exercita o
carimbo**: `closingMonthly.ts:574-580` grava `trp_version_id: null` por
construção — a comissão já vem pronta do arquivo e a TRP ali é régua de
**auditoria**, não insumo do PMR. Quem exercita é `bbtsMonthly.ts:422`.

Os 4 pontos que o script cobra, já corrigidos por medição:

| # | esperado |
|---|---|
| 1 | linhas da ADS em 2026-08 com `trp_version_id` NULL e `trp_multi_versao === true` |
| 2 | **zero** linhas com id carimbado (uma que seja é o defeito), e `trp_fallback` false |
| 3 | agosto em `trp_multi_versao` (info); `trp_desconhecido` **continua em 1 (junho)**; `trp_stale` zerado |
| 4 | controle julho: mantém `id=59025dd8` e `multi=NULL` — **NULL, não `false`** |

O ponto 4 tem armadilha própria: todo o histórico do PMR está `NULL` (medido
01/09: 0 linhas não-nulas no banco inteiro), porque as linhas são anteriores à
coluna. Julho só vira `false` se for **reconsolidado**. Cobrar `false` ali
acusaria defeito onde não há — foi por isso que o enunciado original do ponto 4
precisou ser corrigido.
