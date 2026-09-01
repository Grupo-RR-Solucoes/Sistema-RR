## FASE 3 bloco 2 — o override ponta a ponta, com o ANTEPARO DO BURACO

O bloco 1 esta em producao (90daea6, Production Ready). Este e o **unico ponto
desta frente capaz de derrubar /promotores e /recebiveis**, e por isso a
validacao preventiva entra JUNTO, no mesmo commit — nao depois.

**Nenhuma regua sobe.** `trp_rule_versions` segue com 5 linhas e nenhuma de
2026-08; `valid_from_override` segue nulo na unica linha de staging. Sem
override, o caminho e **byte-identico ao de ontem** — provado no bloco 4 do
portao: os MESMOS 11 parametros do RPC, `p_valid_from` = janela derivada, e ZERO
leitura nova de `trp_rule_versions`.

### Por que o anteparo nao pode ficar para depois

O RPC diz, no proprio cabecalho, o que ele **nao** protege: nao conhece a janela
holiday-aware (ela e da aplicacao, `lib/trp/vigencia.ts`), entao nao sabe se um
`p_valid_from` e o inicio do mes ou o meio dele. Subir a PRIMEIRA regua de uma
competencia **ja com override** deixaria de `validFrom` ate `override-1` **sem
regua nenhuma**. O resolvedor entao lanca `TrpVigenciaGapError` no primeiro
contrato daquele pedaco — e ele PROPAGA de proposito: /promotores, /recebiveis e
o motor caem.

**E o banco nao cobre isso.** O `ex_trp_vigencia_sem_overlap` recusa fatias
ATIVAS que se CRUZAM; um buraco entre duas fatias nao cruza nada e passa liso. O
EXCLUDE pega sobreposicao, nunca ausencia.

### O que entrou

**`lib/trp/vigencia.ts` — `validarOverrideNaJanela`** (+ `somaUmDia` /
`subtraiUmDia`)

Devolve VEREDITO, nao lanca: `TrpValidationError` mora em `parseTrpDraft.ts`,
que IMPORTA este arquivo — lancar daqui fecharia ciclo. Efeito colateral bom: as
recusas se exercitam no portao sem try/catch, e a mutacao aparece como veredito
diferente, nao como excecao que sumiu.

O **`>` ESTRITO** e a decisao do Diego (01/09): override IGUAL ao inicio da
janela **nao parte nada** — no RPC ele cai na SAIDA 1 (SUBSTITUI), que e o
re-upload de sempre. E RECUSADO, nunca normalizado em silencio: gravar um
`valid_from_override` que nao produziu efeito faria a proxima pessoa a ler
aquela linha concluir que a competencia foi partida quando nao foi.

Recusa tambem: fora da janela (antes ou depois), formato invalido, e data
inexistente no calendario (`2026-02-31` casa no regex e nao existe).

**`lib/trp/commitVersion.ts` — as 3 conferencias, ANTES do RPC**

- (a) existe ao menos UMA fatia ativa na competencia;
- (b) alguma fatia ativa COBRE o inicio da janela;
- (c) a ULTIMA fatia ativa satisfaz `valid_from < override <= valid_until`.

A (c) espelha a recusa que o RPC ja faria, com mensagem que diz o que aconteceu.
As (a) e (b) sao as que o RPC **nao tem como** fazer.

**As 3 rotas — a data anda, e vem de onde deve**

`staging` POST grava `valid_from_override` (`""` e `undefined` viram NULL); a
inbox do socio devolve a coluna, entao ele ve que o rascunho PARTE o mes **antes
de abrir**; o `GET :id` devolve para a revisao.

`commit`: no fluxo **DELEGADO** o override e lido da **LINHA DO STAGING**, nunca
do corpo — mesma invariante que ja valia para o `regraDraft`. Um `uploadId` com
override no body seria uma data revisada por ninguem entrando na regua viva. No
fluxo DIRETO vem do body, que ali e a unica fonte e a rota inteira e socio-only.

**`components/trp/TrpUploadReview.tsx`**

Checkbox **fechado por padrao** — o caminho normal e nao tocar nele, e 100% das
reguas ate hoje foram assim. Aberto, mostra a janela derivada e o efeito em
portugues: *"a regua que hoje vale sera truncada em 04/08 e CONTINUA ATIVA; a
nova vale de 05/08 a 28/08. Nada e substituido."* O input tem `min` = dia
seguinte ao inicio (o `>` estrito visivel na propria UI) e `max` = fim da janela.

Upload fresco **zera** o override: ele nunca vem do PDF e nao pode sobreviver de
uma revisao para a proxima.

**No fluxo delegado o campo e SO LEITURA**, em destaque. O botao "Salvar
rascunho" nao existe com um rascunho aberto — se o campo fosse editavel ali,
criaria a armadilha de o socio mudar a data, confirmar, e o servidor usar a
outra (ele le do staging). Em destaque porque e o UNICO campo da revisao que nao
veio do PDF. O funcionario preenche no rascunho (decisao do Diego): rascunho nao
e regua.

### O portao reprovou a 1a versao deste codigo, e o conserto foi NO CODIGO

Eu tomava `fatias[0]` confiando no `.order()` da query. Com a competencia **ja
partida** e as fatias chegando em outra ordem, a conferencia (c) comparava
contra a fatia ERRADA — a de 31/07 em vez da de 05/08 — e **aprovava** um
override de 03/08, que reescreveria regua viva por baixo de outra.

Agora o maximo e calculado em codigo (`reduce`), a ordenacao volta a ser so
trafego, e o fixture do gate entrega as fatias na **ordem errada de proposito**.
Meu stub tambem ignorava o `.order()` — corrigi os dois: um stub que ignora a
ordem mede o STUB, nao o codigo.

E a mesma licao ja registrada na frente do piso: **vigencia se confere em
CODIGO, nao no ORDER BY da query.**

### Portao: `scripts/gate_trp_override_vigencia.cjs` (novo, self-contained, 1,0s)

6 blocos, **4 mutacoes**, todas com o criterio errado reimplementado no proprio
gate e comparado:

1. sem o `>` estrito, o inicio da janela seria ACEITO — vereditos divergem;
2. sem o anteparo a chamada **CHEGA ao RPC** (`rpcCalls` 1 x 0) e o buraco nasce;
3. tomar `fatias[0]` em vez do maximo aprovaria o override de 03/08;
4. ler o override do body traria 20/08 onde o staging guardou 05/08.

O bloco 2 prova que o RPC recebe `p_valid_from` = OVERRIDE e `p_valid_until` =
fim da janela (e por isso ele PARTE em vez de SUBSTITUIR). O bloco 4 e o
**controle positivo**: sem override — e com `null`, `""` e `undefined` — o
`p_valid_from` volta a ser a janela e nao ha leitura nova.

O draft valido e construido em memoria a partir de `EXPECTED_PRODUCTS`: sem
fixture em disco, sem dado de cliente.

### Verde, e o que esta vermelho por outro motivo

- `npm run gates`: **35/35** (rodados DEPOIS do commit — a licao da G5).
- `tsc --noEmit` e `npm run typecheck:gates`: limpos.
- `npm run gates:db`: 26/31 — **os mesmos 5 vermelhos pre-existentes**, nome por
  nome, medidos em worktree de `origin/main` (b608407) na revisao do bloco 1:
  `produto_pmr_empresa_dona` (1), `competencia_janela_comissoes` (1),
  `check_audit_v9_tables` (4), `gate-srcc-ads` (1) e o `gate_schema_colunas`
  (que PASSA e aborta no teardown pelo bug conhecido do libuv). O 5o e o teto de
  tempo da faixa. **Nenhum vermelho novo.**
- O tempo da faixa `--db` foi 259,1s contra 159,9s de ontem: e latencia de
  banco, a mesma variacao que o proprio runner documenta (78s / 93,6s / 111,7s
  no mesmo dia, mesmo conjunto).

### Depois deste merge

**Bloco 3** — a TRP39 pela tela, com o Diego confirmando 05/08. E o ultimo, e o
unico em que uma regua sobe.
