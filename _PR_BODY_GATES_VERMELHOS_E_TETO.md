# Os 4 vermelhos cronicos do `gates:db`, o teto da faixa, e os dois residuos

Arquivo descartavel: cola no corpo do PR e depois se apaga, como os
`_PR_BODY_*.md` anteriores. O registro que fica e o
`HANDOFF_MATERIALIZACAO_ASSINCRONA.md`.

---

## De 4 vermelhos para 1 — e **nenhum** era defeito de producao

Rodei os quatro ISOLADOS antes de tocar em qualquer coisa. Tres eram defeito do
PORTAO; o quarto e uma cegueira que precisa de uma RPC no banco.

### (a) `produto_pmr_empresa_dona` — o crash NAO era a falha

A pergunta era se ele reprova de verdade antes de morrer ou se o crash E a
falha. **Reprova de verdade:** 3 execucoes isoladas, 3x `exit 1` com a
reprovacao impressa, ZERO crash. O `3221226505` e o flake de teardown do libuv
que as notas do proprio runner ja descrevem, e ele nao esconde nada.

A falha real era a guarda `res.promotores > pidsDistintos.size` ("ha COLAPSO
real"). Varri as competencias:

```
2026-04: 0 buckets   2026-05: 0   2026-06: 13 -> 13   2026-07: 22 -> 22   2026-08: 0
```

**O colapso nao existe em competencia nenhuma** — nenhum promotor teve produto em
duas empresas no mesmo mes, nunca. Guarda amarrada a um formato de dado que o
banco nao produz nao vigia nada: so fica vermelha.

No lugar, dois pedacos, porque afrouxar era a saida errada: **(1)** nao-vacuidade
do que E provavel (tem de haver bucket para medir — sem isso um mes sem produto
passaria feliz, e 2026-08 e esse mes); **(2)** uma **varredura** que continua
procurando o colapso em todas as competencias — enquanto nao existir, o gate DIZ
que a assercao nao foi exercitada, em vez de fingir que foi; no dia em que
existir, REPROVA cobrando que o gate aponte para aquele mes.

Custo, dito por inteiro: o gate saiu de sempre-vermelho para verde em **22,6s**,
dos quais ~18s sao a varredura nova.

### (b) `gate_trp_vigencia_intra_mes` — o que mudou, e desde quando

Commit **`e564c89`**, "a vigencia da REGUA cobre o calendario inteiro (o dia
orfao)": a ultima fatia passou a **esticar de proposito**, porque as janelas de
competencia nao particionam o calendario e sobravam dias orfaos (25 meses em
191) onde o resolvedor lancava e derrubava /promotores e /recebiveis. A assercao
"buraco a DIREITA LANCA" nasceu em `c984b98`, estava CERTA entao, e virou FALSA
ali. Assercao de transicao morre; invariante fica.

Entraram duas: **(i)** a cauda estica ate `reguaUntil`; **(ii)** alem disso ainda
LANCA — a extensao TEM fim, senao um contrato de setembro seria pago pela regua
de agosto.

**E aqui eu errei, e a medicao me corrigiu.** Escrevi no comentario que o buraco
A ESQUERDA ja defendia o `rowValidUntil` contra a mutacao M5. Fui conferir por
mutacao: **o portao inteiro seguia VERDE.** Aquela fixture tem UMA fatia so, que
portanto e a ultima, e o lancamento acontece por qualquer caminho — o
`rowValidUntil` estava sem ninguem olhando desde `e564c89`. Entrou a **(iii)**:
vao ENTRE duas fatias (v1 ate 02/08, v2 desde 05/08, contrato 03/08), onde a
primeira NAO e a ultima. Provado por mutacao: com M5 aplicada, **so ela** fica
vermelha.

### (c) `gate-srcc-ads` — cinco retratos, nao cinco defeitos

As 5 assercoes descreviam o mundo **antes** de o import da ADS rodar ("nenhuma
linha vira restrito", "19 viram neutro", "nenhum tingimento novo", "nenhuma tem
`srcc_resolucao` gravada ainda", "nenhuma tem `is_srcc_restricted=true`"). Ele
rodou: hoje ha 2 restritos, 113 neutros, tingimento e as duas colunas gravadas.
**As cinco reprovavam todo dia anunciando que o recurso FUNCIONOU** — o oposto do
que um portao serve para dizer.

E o MESMO erro que o bloco logo acima ja corrigira em 01/08/2026, quando as
contagens 18/1/35/54 viraram invariante ("Retrato so vale no dia em que foi
tirado"). Estas cinco escaparam daquela varredura.

No lugar entram invariantes de **coerencia**, cada uma amarrando DUAS leituras da
mesma verdade — que e exatamente o que um retrato nunca fez:

| invariante | medido hoje |
|---|---|
| tingimento deriva do estado (restrito=risco, indefinido=alerta, resto=null) | 0 fora |
| `srcc_resolucao` gravada => a tela nunca diz "Sem informação" | 96 com coluna, 0 mentindo |
| `is_srcc_restricted=true` => estado `restrito` | 2 marcadas, 0 incoerentes |
| as CHAVES_NOVAS mudam ao menos um rotulo (nao-vacuidade) | 19 — **reportado**, nunca cravado |

### (d) `check_audit_v9_tables` — `exit 4` = **NAO MEDIU**

O gate promete conferir "7+ indexes nao-PK" e nao conferia: o PostgREST nao expoe
`pg_indexes`. Ele ja tratava isso do jeito certo (reprovar em vez de fingir) e o
proprio texto oferece as duas saidas. Escolhida a **(a)**: a RPC vai versionada
em `supabase/migrations/20260903_000003_pg_indexes_audit_v9.sql`.

**PENDENTE DE APLICAR** — ate la o gate segue vermelho, como deve.

**Achado extra, consertado aqui:** `exit 4` disparava **tambem** quando ele media
e achava menos de 7. No dia em que a RPC existisse e um index estivesse faltando
de verdade, o gate acusaria a propria cegueira em vez do defeito, e o achado real
ficaria escondido atras da mensagem errada. Agora: **3 = mediu e achou; 4 = nao
mediu**.

---

## O teto da faixa `--db`: 90s -> 300s, mais um teto POR GATE de 45s

O teto de 90s foi posto quando a faixa era menor e vinha sendo estourado em TODA
medicao registrada desde 03/08/2026 (113,0s; 130,0s; 290,7s; 185,4s; 193,2s).
Teto que reprova sempre nao informa nada — **a mesma doenca dos 4 gates cronicos
que este PR acabou de curar**: vermelho permanente ensina a ignorar o painel.

A conta, com as quatro medicoes de 03/09/2026 (204,0 / 175,2 / 180,6 / 198,6s):

```
pior medicao          204,0s
x dispersao de 1,43   (= 111,7s / 78,0s, a razao que as notas do PROPRIO runner
                       registram para o MESMO conjunto no mesmo dia; a variacao
                       e latencia de banco, nao codigo)
= 292s                -> 300s
```

A soma dos gates **e** o tempo da faixa (196,3s de gates para 198,6s de faixa):
nao ha overhead de runner para cortar. Quem quiser baixar o numero tira gate.

**Teto POR GATE, novo.** O escalar da faixa nao distingue "a faixa cresceu" de
"UM gate ficou lento", e e o segundo caso que sempre foi o problema aqui (em
30/08 um unico gate de 91,3s respondia por 65% da faixa). Hoje 4 gates seguram
51% do tempo: o total cabe nos 300s enquanto um deles dobra sozinho, sem ninguem
ver. **45s = 1,37x o maior de hoje** (32,9s).

Depois do PR: `teto da faixa --db: 196.3s de 300s` PASSOU · `teto POR GATE: o
mais lento tem 33.6s de 45s` PASSOU.

---

## Handoff corrigido: duas coisas que ele tratava como UMA

Eu tinha escrito que o STALE de julho "diz a verdade: a regua de hoje produziria
um PMR diferente do que esta gravado". Era conflacao:

1. **`detect_rules_stale` hasheia DADO, nunca CODIGO.** Os 8 sub-hashes leem
   TABELAS (`promoter_share_profile`, `promoter_goal_repasse`, `monthly_targets`,
   `j_keys`, `companies` e agregados de entries/daily). Nenhum enxerga uma linha
   de TypeScript.
2. **Os -R$ 5.225,75 vem de mudanca de CODIGO** (janela do volume, zeramento da
   chave master, precedencia do diario).

Logo **o STALE de julho NAO e o -5.225,75**. Dois fatos verdadeiros, causas
diferentes, e o alarme nao aponta para o dinheiro.

**Medido:** nenhum dos 8 insumos se moveu depois do baseline, nem em julho nem em
agosto — `d_src_cash`/`d_src_ins` de 2026-08 com `max(created_at)`
2026-09-02T14:25:09 e `d_src_ads` 14:45:27 contra baseline 21:09:44; as 5 tabelas
de regua com `max(updated_at)` em 2026-08-25T18:47 **ou antes**. E os baselines
mais VELHOS (abril 25/08, junho 27/08) estao **OK** enquanto os mais NOVOS (julho
30/08, agosto 02/09) estao **STALE** — o inverso do que "algo mudou depois"
produziria. A nota de que agosto seria "classe diferente" de julho **nao se
sustenta**.

**Hipotese registrada, nao testada:** `pmr_prom` — o escopo dos sub-hashes 1 a 4
— e lido LIVE de `promoter_monthly_results` dentro da propria funcao; baseline
computado antes de o PMR da competencia estar completo cobre um conjunto de
promotores diferente do atual. A hipotese concorrente (implementacao dupla JS/PG)
esta **descartada**: `lib/rulesFingerprint.ts` chama a MESMA RPC.

**Anotado, sem explicacao:** o baseline de 2026-08 tem `computed_at`
**2026-09-02T21:09:44**, ~6h DEPOIS dos imports das 14:20-14:25. Algo reescreveu
aquela linha e nao se sabe o que.

---

## Vintage de 2026-08 congelado

Ultimo residuo da frente anterior. Dry-run limpo, mesma estrutura de julho.

```json
{ "snapshot": "2026-08", "competenciaOrigem": "parametro",
  "linhasGravadas": 146, "linhasProjetadas": 146,
  "vintageJaExistia": false, "vintageIncompleto": false, "avisos": [] }
```

`previsao_snapshot` **294 -> 440** (`{"2026-06":148,"2026-07":146,"2026-08":146}`).
Sigma `previsto_prt` 656.050,60 | `previsto_avista` 178.461,87 |
`previsto_diferido` 5.674,59.

Quatro conferencias, todas OK: 146 linhas · `competenciaOrigem = "parametro"` ·
a-vista **178.461,87 no alvo 2026-08** com zero linhas de a-vista em outro alvo ·
**2026-06 e 2026-07 INTACTOS** (0 campos diferentes campo a campo, contra leitura
da tabela inteira feita ANTES da escrita).

Os tres vintages existem e a serie "previsto ENTAO vs recebido DEPOIS" volta a
ser continua de 2026-06 em diante.

---

## Nota de processo

O commit `89c8950` afirmou na mensagem que o bloco do vintage de agosto tinha
entrado no handoff. **Nao tinha**: a ancora de texto nao casou porque a secao que
eu procurava ja havia sido reescrita na branch `docs/vintage-julho-congelado`,
que nao estava mergeada aqui; o script falhou, o arquivo nao mudou e o commit
passou assim mesmo. Corrigido em `ebd6bff`, depois de trazer aquela branch para
esta (as duas frentes editam o MESMO handoff — resolvido aqui, e nao na hora do
merge). Mensagem de commit nao e prova de que o arquivo mudou.

---

## Estado

`tsc --noEmit` 0 · `npm run gates` **39/39** · `npm run gates:db` **33 de 34**,
com os dois tetos passando. O unico vermelho e o `audit_v9` (`exit 4`, "nao
mediu"), esperando a migration `20260903_000003`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V1vHxmzKP1zaKTPmoRVmSY
