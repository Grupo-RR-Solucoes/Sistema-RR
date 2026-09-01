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

**Os 28 scripts de `scripts/` que chamam `calcularOperacao`** (dos quais os que
constroem provider via `buildTrpCreditProvider`: `diag-16-veredito.mts`,
`diag-220147900-e-ads.mts`, `diag-ausentes-valor-medido.mts`,
`diag-bloco2-completo.mts` e os demais) **passam a medir agosto pela ÚLTIMA
régua da competência** quando 2026-08 estiver partida — porque resolvem por
competência, sem `contract_date`.

Isso é **certo para 496 contratos e errado para 83**. Os diagnósticos ficam
levemente otimistas até serem atualizados para passar a data. Dívida
**nomeada, não corrigida** nesta frente, por decisão explícita.

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
