# Rastro do pós-import (2 rotas) + desconto por piso + chave master

Três consertos aprovados, cada um com portão próprio provado por **mutação do
fonte real**. Nenhum toca a materialização da carteira — o desenho assíncrono
fica para depois, e a segunda função ainda vai ser cronometrada isolada no
Studio.

## PRÉ-REQUISITO DE DEPLOY

**Aplicar `supabase/migrations/20260903_000001_import_pos_diag.sql` no Studio.**

Sem a tabela, o conserto (1) é inerte: o insert falha, o rastro continua
invisível e **dois portões ficam vermelhos de propósito** —
`gate_pos_import_diag` (lado B) e o pré-existente `gate_schema_colunas`. Os dois
somem juntos quando a migration rodar. Verde sem a tabela seria a mesma mentira
que este PR veio desfazer.

---

## 1. O erro dos blocos de efeito colateral para de morrer no log

**O custo do silêncio, medido:** a materialização da carteira PRT falhava desde
2026-07-07 e passou **dois fechamentos inteiros** (julho e agosto) com
`producao_contrato` e `carteira_contrato` parados em 2026-06 — e, por tabela, o
congelamento da previsão recalculando sempre o vintage 2026-06 e descartando
tudo no write-once. Descoberto só em 02/09/2026, por varredura manual. A única
testemunha era um `console.error` que morre com a invocação serverless.

Cada bloco passa a ser cronometrado e o resultado vai para a tabela
`import_pos_diag`: `{ nome, ok, ms, erro CRU, extra }` por bloco, mais
`houve_falha` e `falharam[]` para achar os imports quebrados sem abrir o jsonb.

O `ms` não é enfeite: foi cronometrando o bloco (2) em 5,5s dentro de uma janela
observada de 43–57s que se descobriu que o bloco (1) **morre depois de ~38–51s**
em vez de falhar na hora — o que virou a hipótese de timeout de statement, desde
então confirmada (as funções passam no Studio; o que falha é a chamada pela API).

### O buraco que este PR fecha, e ele era meu

A primeira versão gravava numa **coluna de `monthly_closing_imports`**, e só a
rota da RR passa por ali. O fechamento da ADS de 02/09 rodou e não deixou foto
nenhuma — **nem teria deixado com aquela migration aplicada**, porque a ADS entra
por `app/api/import/closing/ads/route.ts` e se registra em `daily_imports`.

Rastro que só existe numa das duas rotas de fechamento não é rastro.

### Por que tabela própria, e não coluna equivalente em `daily_imports`

1. **Rastro em duas formas são dois rastros.** A pergunta operacional é "o que
   quebrou em algum import?" e ela tem de ter **uma** consulta. Coluna em duas
   tabelas viram dois formatos e duas queries — e a terceira rota (o backfill de
   `closing-history` já existe) viraria a terceira.
2. **`daily_imports` é compartilhada** com a importação diária de produção. A
   coluna ficaria NULL na esmagadora maioria das linhas da própria tabela onde
   mora, e NULL ambíguo — "não rodou" contra "rodou e passou" — é exatamente a
   leitura errada que este rastro existe para impedir.
3. **Há coisa engolida que não pertence a rota nenhuma:** os best-effort *dentro*
   de `reconsolidarCompetenciaFechada` (fingerprint da Camada 2, marcação de
   desconto por piso) rodam pelas duas. Numa tabela própria têm onde morar sem
   escolher dono.

O critério não mudou: **a mensagem crua só existe no instante da chamada.**

Isso apaga `20260902_000001_pos_import_diag.sql`, que criava a coluna e nunca foi
aplicada (medido: 42703). Migration superada em disco é convite para alguém
aplicá-la depois e criar coluna morta.

### A regra que NÃO se quebrou

A rota da ADS é **fail-loud** nos dois blocos: âncora que não fecha vira 422,
reconsolidação que falha vira erro. Instrumentar aqui é **registrar e relançar** —
nunca virar best-effort. O `throw e` continua, e o 422 grava **antes** do
`return`, porque depois do return não há mais instante. O portão cobra as duas
coisas.

---

## 2. O desconto que o piso não deixou acontecer para de se disfarçar de PENDING

Regra do Diego (20/08/2026): piso zerou o repasse ⇒ a parcela **não é
consumida**. Não é `max(0, final − desconto)`. A regra estava certa; faltavam
duas coisas.

**O status mentia.** A linha ficava `PENDING`, e PENDING diz "ainda vai ser
cobrado". É falso: nenhum leitor de dinheiro consulta `status` e todos amarram
por `(year, month)` — medido em 02/09/2026 (`promoterAnalytics:998` lê a tabela
inteira e casa por competência; `dre.ts:612` e `financialAnalytics:811` filtram
por `(year,month)`). Uma linha de 2026-08 só pode ser lida **como** 2026-08. A
cobrança não está adiada: deixou de existir.

**Por que `WAIVED` e não um `NAO_APLICADO_PISO` novo:** o CHECK aceita
`PENDING|APPLIED|WAIVED|CANCELLED`. Valor novo exigiria migration, e migration
neste repo é aplicada à mão — o padrão que já deixou código inerte várias vezes e
que é a origem desta própria frente. `WAIVED` descreve o efeito com exatidão e
estava **livre**: medido, 0 linhas no banco e nenhuma escrita de `'WAIVED'` em
todo o código. A nuance "foi o piso, não uma pessoa" vai no `notes` com marcador
estável, e é ela que torna a marcação reversível sem pisar num waiver humano.

**Nenhuma tela mostrava.** Novo item `desconto_nao_cobrado_por_piso` no
ledgerHealth (`info`, com competência, promotor e valor).

**Escopo:** nenhum centavo muda de lugar — escreve só `status`/`notes`. Hoje são
2 casos, ambos 2026-08, R$ 8,54, **primeira ocorrência da história**
(`piso_zerou=true` existe em 2 linhas no banco inteiro, e as 447 linhas do PMR
têm o flag preenchido). Os dois são parcela **1/1**, cobrança avulsa: não há
cauda a deslocar.

**Estado:** a marcação roda na reconsolidação. As 2 linhas de agosto seguem
`PENDING` até 2026-08 ser reconsolidada — e reconsolidar mês fechado não estava
autorizado nesta frente.

---

## 3. `closingMonthly` zera a comissão da chave master, como o cms já fazia

Chave master é o CNPJ: balde de produção sem dono individual, não é promotor e
não recebe repasse. `cmsMonthly.ts:268-275` aplicava isso na origem;
`closingMonthly` **não** — ele só excluía a chave master da ADS/BBTS, que é outra
coisa.

Medido em 02/09/2026: 2 linhas vivas, 2026-04, `source='fechamento'`,
**R$ 164,04**.

**A anotação que existia errava em dois pontos** — dizia "escopo só fev/2026,
R$ 18,91, source cms". Não é fev (2026-02 tem 5 linhas master, todas R$ 0,00) e
não é cms (o cms já zera). Era o fechamento, em abril.

Aplicada **por último**, depois do piso, de propósito: master zerado não é "piso
zerou". O balde nunca teve repasse a perder, então `piso_zerou` continua dizendo
a verdade sobre o piso. Produção, contagem e penetração ficam intactas — só o
repasse é zero; apagar a linha esconderia produção real.

**Escopo:** é defesa. **Não** limpa o fóssil de 2026-04 — limpar exige
reconsolidar mês fechado, que mexe em dinheiro, e é decisão à parte.

---

## Os portões

`scripts/_mutanteTs.cjs` aplica a mutação ao **fonte real** (o mesmo arquivo que
a produção importa), não a uma cópia escrita à mão, e **confere que cada troca se
aplicou** — alvo que sumiu vira erro, nunca no-op silencioso. Sem isso o portão
ficaria verde por não ter mutado nada.

| portão | lados | mutantes | modo | custo |
|---|---|---|---|---|
| `gate_pos_import_diag` | regra + tabela + **as 2 rotas** | 3 | needs-db | 1,4s |
| `gate_desconto_piso` | regra + banco + tela | 3 | needs-db-lento | 16,7s |
| `gate_master_sem_comissao` | regra + **chamador** + banco | 3 | needs-db | 0,9s |

Dois lados merecem nota porque são os que costumam faltar:

- **o chamador** (`gate_master_sem_comissao`, lado B): assere que `closingMonthly`
  realmente chama a regra **e** carrega `is_master` na consulta. Função pura sem
  chamador é decoração, e é o lado que apodrece calado.
- **as duas rotas** (`gate_pos_import_diag`, lado C): nasceu do buraco descrito
  acima. Exige `registrarPosImportDiag` com a origem certa nas duas, o `throw e`
  depois do registro, e o registro antes do 422.

O `gate_desconto_piso` amarra ledgerHealth e regra no **mesmo número**,
recomputado do banco — sem constante de dinheiro congelada — e exige
não-vacuidade (tem de haver `piso_zerou=true` no banco).

## Gates

- `npm run gates` — **39/39**.
- `npm run gates:db` — 7 falhas: **5 pré-existentes**, medidas na linha de base
  em `origin/main` `8b99513` (repasse de produto, competência por janela, TRP
  vigência intra-mês, SRCC ADS, audit_v9), mais **2 minhas, ambas a mesma
  causa**: a tabela `import_pos_diag` ainda não existe.
- Teto da `--db`: **128,6s** contra **130,0s** da base. A faixa já estava
  estourada antes desta frente; o portão caro foi para `needs-db-lento` para não
  engordar banda estourada.

`tsc --noEmit`: 0 erros.

## Não entra aqui

- a função de materialização por competência (espera a medição do Studio);
- o fóssil de master de 2026-04;
- o agregado órfão da AL1 em 2025-02;
- `rules_stale` de 2026-07 — medido, **classe diferente** da de agosto: nenhum
  dos 8 insumos mudou por carimbo, e sobram exatamente os que um carimbo não
  consegue ver (`monthly_targets` de julho não tem `updated_at`; `j_keys` e
  `promoter_share_profile` têm a coluna morta). Resolver é reconsolidar julho, o
  que mexe em dinheiro de mês fechado — decisão, não tarefa.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01L36AJ3AcTBmqweCWmxUrrc
