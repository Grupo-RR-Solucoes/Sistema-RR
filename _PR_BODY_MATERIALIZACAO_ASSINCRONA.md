# Materializacao da carteira PRT vira assincrona (fila + pg_cron)

Arquivo descartavel: cumpre a funcao de ser colado no corpo do PR e depois e
apagado, como os `_PR_BODY_*.md` anteriores. O registro que fica e o
`HANDOFF_MATERIALIZACAO_ASSINCRONA.md`.

---

## O numero

```
fila origem='manual', 2026-08, medido DENTRO do worker:
  status OK | ms = 60.150 | producao 270.198 | carteira 74.956 | max 2026-08

teto do role authenticator, lido do banco pelo proprio portao:
  statement_timeout = 8s | lock_timeout = 8s
```

**Sessenta segundos contra oito. 7,5x.**

A materializacao da carteira PRT era chamada pelo PostgREST, e por aquela porta
ela **nunca teve chance**. Nao terminava desde **2026-07-07** — dois fechamentos
inteiros com `producao_contrato` e `carteira_contrato` parados em 2026-06, e o
congelamento da previsao recalculando sempre o mesmo vintage e jogando fora no
write-once. As MESMAS funcoes rodam sem problema no Studio, que nao tem esse teto.

Isso tambem encerra a hipotese "escopa por competencia e cabe": nenhuma
otimizacao razoavel tira 60s para dentro de 8s, e a 2a funcao nem competencia
tem para escopar — ela comeca com `TRUNCATE` e reconstroi a janela 2026+ inteira.

## O desenho

1. a rota de import faz **um INSERT** em `materializacao_fila` (milissegundos,
   cabe folgado nos 8s) e devolve;
2. o job pg_cron `materializacao_fila` chama `fn_materializacao_fila_processar()`,
   que roda **dentro do banco** com `set local statement_timeout = 0`, e grava
   status / ms / **erro CRU** de volta na linha da fila.

**A fila mora em `public`, e isso e decisao, nao acaso.** O PostgREST desta
instancia expoe SO `public` e `graphql_public` — entao fila em `public` = a
frente inteira permanece observavel de fora com service_role. So o AGENDADOR fica
fora do alcance, e para ele existe `fn_diag_materializacao_cron()`, so-leitura
sobre `cron.job`, `cron.job_run_details` e os timeouts por role. **O worker nao
tem grant para service_role, de proposito**: pela API ele cairia nos mesmos 8s.

## O risco que este PR cria, e a defesa

Trocar sincrono por assincrono cobra o **silencio**. "Enfileirei" nao e
"funcionou": sem o job vivo o insert continua devolvendo 200 e a carteira
envelhece calada — o mesmo defeito de 07/07, so mudado de lugar.

Por isso o bloco do pos-import le a fila **inteira**, e nao a linha que acabou de
inserir, e so sai `ok=true` quando o insert passou **E** a fila esta saudavel
(nada sem terminar ha mais de 10 min, nada em `ERRO`). A denuncia de um import
atrasado chega no import seguinte, em `import_pos_diag`.

## Congelamento: catch-up por competencia EXPLICITA

`congelarPrevisao` e TypeScript e nao roda dentro do banco. Ele passa a congelar
as competencias que a fila marca como materializadas (`status='OK'`) e ainda nao
congeladas — na pratica, a do import anterior — ou por
`POST /api/recebiveis/congelar?competencia=YYYY-MM`. **A rota NAO espera a fila:**
esperar reporia o sincronismo e os mesmos 60s.

A competencia sai de **parametro** porque o `max(competencia)` de
`carteira_contrato` deixou o vintage de **2026-07 inalcancavel**: quando a
materializacao finalmente rodou (02/09) ela reconstruiu a carteira de 2026-01 em
diante — **julho esta la** — mas o max ja era 2026-08 e so o max podia ser pedido.
`previsao_snapshot` e write-once: vintage nao congelado na hora so volta por essa
porta. O resultado agora carrega `competenciaOrigem: "parametro" | "max_carteira"`,
e o a-vista le a MESMA competencia do PRT (senao o vintage mistura dois meses, em
definitivo).

## Portao — `scripts/gate_materializacao_fila.cjs` (needs-db, 3,1s)

VERDE nos quatro lados, todos no mesmo run:

- **A. as regras** (`lib/materializacao/filaRegras.ts`): congelar so sobre
  `status='OK'`, ordem cronologica (julho antes de agosto), flag lida em
  ESTRITO — `!== false` classificaria o historico inteiro, a mesma armadilha do
  `trp_multi_versao` e do `piso_zerou` —, e fila doente derrubando o bloco do
  rastro. **7 mutantes do fonte real.**
- **B. as rotas:** nao chamam mais `fn_materializar_*` direto; o congelamento
  recebe a competencia da fila; a divida so e baixada DEPOIS de o congelamento
  voltar sem lancar (e nao num `finally`, que baixaria tambem quando lancou).
- **C. a migration em disco:** `statement_timeout = 0`, lock de TRANSACAO,
  `SKIP LOCKED`, ordem asc, os revokes, `sqlerrm`, e a linha que falhou NAO
  voltando para `PENDENTE` (retry automatico de 60s viraria quatro falhas).
- **D. o banco:** tabela, RPC, job **ATIVO** e com execucao **REGISTRADA** em
  `cron.job_run_details` — job que nunca rodou nao prova nada.

## Duas armadilhas que este PR pagou, e ficam documentadas

**1. `cron.schedule(..., '1 minute', ...)` e RECUSADO.** Esta versao do pg_cron
aceita cron classico (`* * * * *`) ou intervalo em segundos (`'[1-59] seconds'`),
e nada entre os dois. A justificativa que eu havia escrito no arquivo — "'1
minute' nao depende do suporte a intervalo sub-minuto" — estava errada nos DOIS
sentidos: o suporte sub-minuto existe, e era a forma em minutos que nao era
aceita. Corrigida, com a medicao no lugar do palpite.

**2. `PGRST202` significa duas coisas.** Antes da migration, chamar o worker
devolve `PGRST202` — exatamente o codigo que a **ausencia** da funcao produz. Ler
isso como "o revoke pegou" seria verde por vacuidade, entao a assercao D10 nasceu
**suspensa ate D3 passar**. Com a migration aplicada ela voltou a valer e devolve
**`42501` (permission denied)**: codigo DIFERENTE, prova de que o revoke pegou de
verdade. Deixa-la valendo desde o inicio teria dado um verde que nao provava nada.

## Tambem neste PR

- **2026-04 reconsolidada** (autorizada apos dry-run): Sigma 94.004,77 ->
  93.840,73, **-164,04**, **2 linhas de 41** — so as duas de CHAVE MASTER
  (RENATA/AL3 117,08 -> 0 e JULIANA/PE 46,96 -> 0). `detect_rules_stale` de
  2026-04 voltou a **OK**. O 1 centavo que o dry-run previa em BIANCA e ERIVAN
  **nao existia**: era float cru comparado com `numeric` ja armazenado.
- **2026-07 NAO reconsolidada, e a divida esta NOMEADA no handoff.** A comissao
  BRUTA nao se move (132.671,58 -> 132.671,63); so o REPASSE, **-5.225,75 em 20
  promotores ja pagos, todos perdendo**. Aplicar regua nova a mes pago nao e
  corrigir erro. O `detect_rules_stale` de 2026-07 fica **ACESO de proposito** —
  quem "consertar" reconsolidando tira dinheiro de gente ja paga.
- **AL1 2025-02** parado por falta do xlsx; o que foi medido esta no handoff (o
  agregado fecha internamente ao centavo, 5 imports do mesmo arquivo com 2
  cancelados em lote em 05/06, e e 1 de 2 linhas de FME com zero entries em 104).

## Estado

`tsc --noEmit` 0. `npm run gates` **39/39**. `npm run gates:db`: o portao desta
frente **PASSA**; os 4 vermelhos restantes sao **anteriores e alheios**
(`produto_pmr_empresa_dona` com o crash de teardown 3221226505,
`gate_trp_vigencia_intra_mes`, `gate-srcc-ads`, `check_audit_v9_tables`) e
nenhum deles le os modulos tocados aqui. O teto da faixa `--db` segue estourado
(175,2s de 90s), divida anterior a esta frente; este portao custa 3,1s.

**A migration `20260903_000002` JA FOI APLICADA em producao (03/09/2026)**, e o
ciclo esta provado de ponta a ponta com os numeros do topo.

**Residuo aberto, nomeado:** a linha da fila e de 2026-08, entao o vintage de
**2026-07** continua devendo e nao tem linha —
`POST /api/recebiveis/congelar?competencia=2026-07` (write-once: o primeiro
congelamento e o definitivo; usar `?dryRun=1` antes).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V1vHxmzKP1zaKTPmoRVmSY
