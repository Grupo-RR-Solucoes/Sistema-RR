## FRENTE DE DIVIDAS TECNICAS — as tres fechadas, na ordem 3 -> 2 -> 1

Nenhuma regua sobe, nenhum valor muda, e `trp_rule_versions` continua com as 7
linhas de 01/09. O unico codigo de PRODUCAO tocado e de exibicao (o rotulo do
diff) e de aviso (o banner do item 2) — mais um `select` a mais no staging.

A ordem foi a do Diego, com a emenda que eu pedi: **o item 3 comeca remediando a
nota falsa**, antes de qualquer codigo.

---

## COMMIT 0 — a nota que mandava a proxima pessoa para o lugar errado

`1781182`

O handoff afirmava que **28 diagnosticos** passariam a medir agosto pela ultima
regua. **E falso.** `lib/motor.ts:605` e `:682` fazem
`trpProvider(mes, op.contract_date ?? undefined)` — **o motor passa a data** —,
entao todo script que usa `buildTrpCreditProvider` + `calcularOperacao` resolve a
fatia CERTA. Medido: 29 scripts constroem provider assim, 28 mencionam
`contract_date`, e os tres nominalmente citados montam o `op` com
`contract_date: r.contract_date`. O unico que nao menciona pre-carrega so abril e
julho e nunca chega em agosto.

**E o tipo do erro esta dito, nao so o fato dele:** nao foi medicao que
envelheceu, foi **precaucao escrita como se fosse medicao**. Eu supus e escrevi
com a mesma voz com que escrevo o que medi — um leitor nao tinha como
distinguir. O paragrafo antigo ficou **riscado no lugar**, nao apagado.

Junto, o **VIGIA** (item 4, fora da fila): o carimbo do bloco 1 **nunca rodou
contra dado real** — `trp_multi_versao` tem 0 linhas nao-nulas no banco INTEIRO e
o PMR de 2026-08 tem 0 linhas. Gatilho: o PMR de agosto nascer. Os 4 pontos a
conferir estao no handoff. Se sair errado, a decisao (b) cai e a fila muda de
assunto.

---

## ITEM 3 — a classe "provider sem data"

`ed63362` · zero producao: 5 arquivos de `scripts/` + portao novo + registro.

A medicao mostrou que a divida era **menor e de duas naturezas**, nao uma:

**Forma (a) — resolucao POR CONTRATO**, onde faltar a data E o defeito (1 linha
cada): `diag_julho_candidate_list.cjs` e `trp_paridade_f5_json.cjs`.

**Forma (b) — inspecao da REGUA DO MES**, onde passar data NAO seria o conserto,
porque numa competencia partida **nao existe *a* regua, existem duas**:
`trp_prazo_min_gate` e `trp_tx_juros_min_gate` passaram a resolver a competencia
inteira, **imprimem quantas fatias ativas acharam** e rodam a assercao **em cada
fatia**.

No `prazo_min` apareceu um segundo defeito que nao estava na lista: o piso do
sintoma vinha de UMA regua, entao o prazo de um contrato de 03/08 seria comparado
com o piso da regua de 05/08. Passou a vir da fatia que rege AQUELE contrato.

**Portao `gate_provider_repassa_data.cjs`** (self-contained, 0,5s):
- assercao dura: **0 chamadas com 1 argumento em `lib|app|components`** (hoje 5,
  todas com data, listadas na saida);
- **allowlist ASSINADA** para `scripts/`, hoje **vazia**, com checagem de
  **entrada morta** — consertar e nao tirar da lista REPROVA;
- **mutacao**: um scanner que so testa a EXISTENCIA da chamada aprova a fixture
  sem data; os dois vereditos divergem na mesma fixture;
- nao-vacuidade: varredura vazia reprova em vez de passar por vazio.

Ele **reprovou a si mesmo** na 1a execucao — as fixtures sao chamadas sem data
escritas de proposito. A auto-exclusao esta la com o motivo escrito.

**Bloco (E) vivo** dentro do `gate_trp_vigencia_intra_mes` (que ja e needs-db, em
vez de portao novo numa faixa que estoura o teto): resolve a MESMA competencia
COM e SEM data e exige fatias DIFERENTES. Contra producao:

```
2026-08: 2 fatias ativas | v1 2026-07-31..2026-08-04 | v2 2026-08-05..2026-08-28
OK  SEM data resolve a ULTIMA fatia (v2)
OK  COM data 2026-07-31 resolve a PRIMEIRA fatia (v1)
OK  com e sem data dao fatias DIFERENTES — a contractDate E honrada
```

A **auto-declaracao de vacuidade e obrigatoria** e esta escrita: sem competencia
partida ele diz, em voz alta, que NAO MEDIU NADA — e avisa que, se agosto deixou
de estar partida, alguem desfez a frente inteira.

**Limite honesto, no cabecalho:** casa DUAS funcoes por nome. Um terceiro caminho
de resolucao passa invisivel, e a defesa continua sendo a regra escrita.

---

## ITEM 2 — o aviso que interrompe o rascunho que SUBSTITUI

`b40cb71` · saida (i), a que **nao reabre** a armadilha do so-leitura.

A armadilha: no fluxo delegado o campo de override e so-leitura (o servidor le a
data da LINHA do staging), e o botao "Salvar rascunho" nao existe com rascunho
aberto. Um rascunho salvo SEM override **nao tem como receber a data** e,
confirmado assim, cai na SAIDA 1 (SUBSTITUI) — desativa a fatia ativa e poe a
regua nova valendo o mes inteiro. E o desenho **5b, RECUSADO**. Aconteceu em
01/09 e foi pego na conferencia, nao pelo sistema.

A condicao virou regua pura (`lib/trp/avisoRascunhoSubstitui.ts`), com **tres
pernas**:

```
1. fluxo DELEGADO (ha rascunho aberto)
2. o rascunho NAO tem override
3. a competencia JA TEM regua ativa
```

A **(3) e a que evita ruido** — sem ela o aviso apareceria no primeiro upload de
todo mes, onde confirmar sem override e o caminho normal. E e **estado do
banco**: o `GET /api/trp/staging/[id]` passou a devolver `fatiasAtivas`.

O aviso **diz o que acontece e o que fazer**: nomeia a fatia que sera desativada
(a de maior `valid_from`, calculada em codigo e nao por posicao na lista), diz
que a regua do PDF passa a valer o mes inteiro, e ensina o caminho — subir o PDF
de novo, marcar a caixa, informar a data e **salvar o rascunho**, que substitui o
pendente ja com a data. E diz quando NAO ha problema: se era re-upload
corrigindo a regua do mes, pode confirmar.

Portao: bloco 7 do `gate_trp_override_vigencia`, com **3 mutacoes** — sem
condicao (apareceria no rascunho PARTIDO e no mes VAZIO), sem aviso (o caso
perigoso passa calado) e sem a perna do override (o rascunho que PARTE receberia
o aviso).

---

## ITEM 1 — a base do diff, e o rotulo dizendo qual fatia

`f99a7c6` · so exibicao.

`.lt("competencia", alvo)` buscava a competencia ESTRITAMENTE ANTERIOR. Era a
unica base possivel quando competencia tinha UMA regua; virou mentira de rotulo
no instante em que agosto passou a ter a propria.

`lib/trp/baseDoDiff.ts` (novo): a ultima fatia ATIVA da PROPRIA competencia — a
mesma contra quem o RPC decide —, com fallback para a anterior quando o mes ainda
nao tem regua. Os dois sitios eram copia um do outro e agora chamam o mesmo
helper.

O rotulo passou a dizer a fatia, a vigencia, e a distinguir base propria de
herdada:

> Comparando com **2026-08 v1** (2026-07-31 a 2026-08-04) — a regua que esta
> valendo nesta competencia.

Portao `gate_trp_base_do_diff.cjs`, com as 2 mutacoes: voltar ao `.lt` (as bases
divergem E as REGUAS divergem) e remover o fallback (o primeiro upload do mes
perde o diff).

**O cuidado que decide se este portao vale alguma coisa:** a fixture **nao repete
o azar de producao**. La a `2026-07 v2` e a `2026-08 v1` sao A MESMA REGUA (as
duas sao a TRP38 — medido: 11 produtos, 0 diferencas), e foi POR ISSO que o
defeito passou despercebido. Com reguas iguais na fixture, a mutacao A nao
derrubaria nada e o portao passaria por VACUIDADE. O **bloco 0** prova que as
tres reguas da fixture sao diferentes ANTES de qualquer assercao depender disso.

---

## Verde

- `npm run gates`: **37/37** (eram 35 no inicio da frente; 2 portoes novos).
- `npm run typecheck:gates` e `npx tsc --noEmit`: limpos.
- `npm run gates:db`: **27/31** — os **mesmos 4 pre-existentes** (`repasse de
  produto`, `competencia por janela`, `SRCC ADS`, `audit_v9`) e o teto de tempo
  da faixa. Nenhum vermelho novo. Fora do escopo desta frente por decisao: cada
  um e uma investigacao propria.

## O que fica

- **VIGIA do carimbo** (item 4): verificacao com gatilho, esperando o PMR de
  2026-08 nascer. Esta escrita no handoff com os 4 pontos.
- A **TRP40** nao subiu.
- O handoff ganhou tabela de estado das tres dividas — todas **RESOLVIDAS**.
