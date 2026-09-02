# A vigência da RÉGUA cobre o calendário inteiro (o dia órfão)

> Arquivo descartável — existe só para o corpo do PR não passar pelo terminal.
> Some no merge.

Commit único: `e564c89`.

---

## O defeito

As janelas de competência **não particionam o calendário**. Entre o **penúltimo**
dia útil de um mês (onde a janela de M termina) e o **último** (onde a janela de
M+1 começa) sobram dias **órfãos**. E `competenciaDaData` devolve competência
para eles mesmo assim — é o `return competenciaKey(current)` no fim da função,
depois de testar as duas janelas e não achar nenhuma.

Nenhuma fatia cobria esses dias, e `escolherFatia` lançava `TrpVigenciaGapError`.
**Ninguém captura esse erro** (grep em `app/` e `lib/`): ele derrubava
**/promotores**, **/recebiveis** e **/dashboard** na primeira linha, porque sobe
do `trpProvider(...)` chamado **síncrono** dentro de `calcularOperacao`
(`motor.ts:605`).

### O tamanho, medido

| | |
|---|---|
| meses varridos (2020-01..2035-11) | 191 |
| meses com órfão | **25 — 13,1%** |
| datas órfãs nas competências vivas | **6**: 29-30/08/2026, 28-29/11/2026, 29-30/05/2027 |
| contratos nessas datas, hoje | **0** |
| contratos fora de janela em 2.621 linhas desde 2024 | **0** |

### A mecânica

A emenda entre dois meses só é adjacente quando o **último** e o **penúltimo**
dia útil são dias de calendário **consecutivos**. Qualquer não-útil entre os dois
vira órfão. Dois formatos, os dois medidos:

- **24 dos 25 casos** — o último dia do mês é uma **segunda útil**: último útil =
  essa segunda, penúltimo = a sexta anterior, órfãos = sábado e domingo.
- **2024-05** — o mês acaba na sexta 31/05 e a **quinta 30/05 é Corpus Christi**:
  órfão de **1 dia, em dia útil**. É o formato de risco real, e é o que o bloco B
  do portão exercita.

Os contraexemplos confirmam o mesmo mecanismo pelo avesso: 2022-02 e 2033-02
terminam numa segunda que **é Carnaval**, então o último útil recua para a sexta,
fica colado no penúltimo, e não há órfão.

### Não é efeito do mês partido

Achei primeiro que fosse consequência de agosto/2026 estar dividido em duas
fatias. **Não é.** Rodei `escolherFatia` com **uma fatia só**, na vigência
canônica que o commit grava num mês não partido:

```
2026-11 com UMA fatia so: janela 2026-10-30..2026-11-27
  2026-11-27  -> OK
  2026-11-28  -> LANCOU TrpVigenciaGapError
  2026-11-29  -> LANCOU TrpVigenciaGapError
```

A linha da régua cobre a **janela**; a atribuição de competência cobre **mais
datas** que a janela. Por isso o comentário do resolvedor que chamava o buraco de
*"INALCANÇÁVEL enquanto o índice `uq_trp_rule_versions_active` estiver no banco"*
estava errado para essas datas.

---

## A decisão: caminho (a), só na TRP

**A vigência da régua se separa da janela de produção.** São perguntas
diferentes:

- `vigenciaDaCompetencia` responde **"que produção conta neste mês"** — tem
  consequência em meta, ritmo, faixa e valor pago. São **17 sítios**, e é o
  recorte que `lib/proposalDetailing.ts` protege com a TRAVA (*"REPROCESSAR
  COMPETÊNCIA FECHADA COM ESTE CÓDIGO PODE MUDAR VALOR JÁ PAGO"*).
- `vigenciaReguaDaCompetencia` responde **"que tabela rege este contrato"**.

Compartilhavam implementação por **conveniência**, não por identidade. E a
assimetria decide: **dia órfão é sempre não-útil**, então a janela de produção
não perde nada ignorando-o — nenhum contrato existe lá. Mas a régua precisa
cobrir **toda data que possa carregar um `contract_date`**, inclusive sábado por
import atrasado, ajuste manual ou carimbo de data não-útil.

### O critério

> **A última fatia ativa da competência cobre até o dia anterior ao `valid_from`
> da competência seguinte. As demais mantêm o limite gravado, sem exceção.**

Três propriedades, as três cobradas pelo portão:

1. **`max`, nunca substituição** — o limite efetivo jamais *encolhe* uma fatia
   gravada. Um `valid_until` escrito à mão além do calculado continua valendo.
2. **Só a última, e ela é CALCULADA** — nunca `fatias[0]`. Mesma disciplina já
   escrita em `commitVersion.ts`: o `.order()` da query é otimização de tráfego,
   a decisão é do código.
3. **Só na cauda** — a extensão só existe **depois** do `validUntil` da janela.
   Por construção, incapaz de tapar um buraco no **meio** da competência.

Decidido na **leitura**: **nenhuma linha gravada foi reescrita**. Isso também
cobre o **fallback em cascata**, que monta uma fatia *virtual* e não teria linha
para um `UPDATE` alcançar — e duas das seis órfãs (2026-11 e 2027-05) resolvem
justamente por cascata.

---

## Não-regressão medida

671 dias (2026-03-01..2027-12-31) resolvidos pelo **caminho real**
(`competenciaDaData` → fatias do banco → `escolherFatia`), antes e depois:

```
dias comparados : 671
IDENTICOS       : 665
MUDARAM         : 6
  2026-08-29  LANCOU -> OK  (comp 2026-08, fatia 2026-08-05..2026-08-28)
  2026-08-30  LANCOU -> OK
  2026-11-28  LANCOU -> OK  (comp 2026-11, por cascata)
  2026-11-29  LANCOU -> OK
  2027-05-29  LANCOU -> OK  (comp 2027-05, por cascata)
  2027-05-30  LANCOU -> OK
todas as mudancas sao LANCOU -> OK? SIM
```

Nenhum dia trocou de competência. Nenhuma fatia encolheu. E **nenhum dia útil**
entrou ou saiu de janela nenhuma — logo `countBusinessDays`, ritmo, meta e faixa
são bit-a-bit os mesmos.

### Nota: os 30 dias `NULL` de março/2026 — medidos e DESCARTADOS

Quem rodar a mesma medição vai ver, além dos 6 dias que mudaram, **30 dias com
desfecho `NULL`**. Eles **não são buraco de vigência** e não abrem frente
nenhuma. Medido:

```
dias NULL   : 30
primeiro    : 2026-03-01     ultimo: 2026-03-30
competencias: {"2026-03": 30}   (contiguos, sem furo)
primeiro dia OK: 2026-03-31 -> comp 2026-04, fatia 2026-03-31..2026-04-29
```

São o **começo da série**: a competência 2026-03 não tem linha em
`trp_rule_versions` e não existe competência anterior com linha, então a cascata
devolve lista vazia e `escolherFatia` retorna `null` — o comportamento correto e
documentado (*"AUSÊNCIA REAL: query OK, mas nenhuma competência tem versão
ativa"*). A primeira régua gravada é a **TRP35**, cuja janela começa em
**2026-03-31**.

E março **não fica sem régua**: quando o provider devolve `null`, o motor cai no
JSON embutido (`motor.ts:606-608`, `getRegra(mes)`), e `TRP34_2026-03.json`
existe no repo — junto com `TRP32_2026-01` e `TRP33_2026-02`. É a cobertura
pré-abril prevista desde o flip do `TRP_SOURCE`.

**Ausência de régua antes da primeira competência com linha ≠ buraco de
vigência.** Não confundir com as 6 órfãs, que são datas *dentro* de uma
competência *com* régua.

---

## O que ficou como está, de propósito

### A conferência (c) de `commitTrpVersion` — rigidez DELIBERADA

Ela compara o override com o `valid_until` **gravado**, não com o limite efetivo.
Fica assim, e está registrado no código com o exemplo:

> Agosto/2026 v2 está gravada até **28/08** e cobre de fato até **30/08**. Um
> override de 30/08 **não deixaria buraco nenhum**, e mesmo assim é **recusado**,
> porque 30/08 > 28/08.

Recusar um split legítimo é o lado **seguro** do erro — o sócio vê a mensagem e
decide. Aceitar um que deixe buraco derruba produção. Usar o limite efetivo ali
aumentaria a superfície sem fechar buraco nenhum: a extensão vive na **cauda**, a
(c) trata do **meio**.

As três conferências (`fatias.length === 0`, `cobreInicio`,
`override > ultima.valid_until`) ficam **intocadas**, e o bloco E do portão cobra
que continuem lá — elas existem porque *"o EXCLUDE do banco pega SOBREPOSIÇÃO,
nunca AUSÊNCIA"*.

### A BBTS não entra — mas o desalinhamento fica registrado

No cabeçalho **dela**, `lib/bbts/resolveBbtsRegra.ts`, que hoje se apresenta como
*"Espelho de lib/trp/resolveTrpRegraDb.ts"*. Isso passa a ser falso num ponto
específico:

- a **TRP** escolhe fatia por **data** e, agora, a última cobre a cauda; data sem
  cobertura → `TrpVigenciaGapError`, que propaga;
- a **BBTS** resolve por **competência** com `.maybeSingle()` e **não escolhe
  fatia por data**. Numa data órfã, a TRP lança e a BBTS entrega a régua **em
  silêncio**.

Divergência **conhecida e não resolvida**, sem consequência medida hoje (a BBTS
não tem vigência intra-mês, então uma fatia só cobre a competência inteira de
qualquer jeito). Só passaria a ter se a BBTS ganhar fatias por data.

---

## Onde a divergência fica registrada (4 lugares)

Para ninguém "unificar" de volta achando que é duplicação:

| lugar | o que diz |
|---|---|
| `lib/trp/vigenciaRegua.ts` | o texto principal — perguntas diferentes, a assimetria, os números |
| `lib/trp/vigencia.ts` | aviso junto de `vigenciaDaCompetencia`: não use esta função para cobertura de régua |
| `lib/projecaoMetas.ts` | **a emenda obrigatória** — o *"MESMA função, um único lugar"* ia virar falso |
| o portão, bloco F | reprova se qualquer um dos avisos sumir |

A emenda do `projecaoMetas` não é zelo: nota não remediada vira pista errada, e
esse comentário seria lido por quem fosse investigar a próxima divergência de
janela.

---

## O portão — `scripts/trp_vigencia_regua_gate.cjs`

Self-contained, registrado no runner. Fixture **sintética** sobre `escolherFatia`
**real** (função pura) e `vigenciaDaCompetencia` (não toca banco). Sem
`createClient`, sem caminho absoluto.

| bloco | assere |
|---|---|
| A | as 6 datas órfãs de 2026-27 resolvem — **computadas no run**, nunca cravadas; reprova se o calendário deixar de ter 3 competências com 6 órfãs |
| B | o órfão em **dia útil** (2024-05-30, Corpus Christi, quinta) resolve |
| C | **não afrouxou**: buraco no **meio** continua lançando, e a cauda do mesmo mês resolve |
| D | nenhuma fatia encolhe; só a última estica; `max` preservado; no-op onde não há órfão |
| E | as três conferências do commit seguem no lugar, e a rigidez da (c) segue registrada como deliberada (busca pelo "30/08") |
| F | a divergência está registrada nos 4 lugares |

### As 5 mutações — e as duas que me corrigiram

Todas no JS emitido, cada uma exigindo **alvo confirmado** (`trocas > 0`, senão o
portão reprova em vez de dar a mutação por feita).

| # | mutação | efeito medido |
|---|---|---|
| 1 | desfaz a extensão | a órfã volta a **lançar** — A e B caem |
| 2 | estende **todas** as fatias | **20/08 sai da TRP39 e vai para a TRP38** |
| 3 | `max` vira substituição direta | um `valid_until` gravado além do calculado é **encolhido** |
| 4 | a última vira `fatias[0]` | **29/08 sai da fatia certa** |
| 5 | afrouxa o limite **inferior** | o buraco do miolo (12/08) passa a resolver — C cai |

As mutações **2 e 4** corrigiram o desenho durante a construção. Eu esperava que
as duas fizessem a data **lançar**. Não lançam: entregam a **régua errada em
silêncio** — pagariam errado sem sintoma, que é *pior* que a exceção que esta
frente conserta. As asserções agora cobram a **fatia certa**, não a exceção.

---

## Verificação

```
npm run gates       39 executados | 39 passaram | 0 falharam
                    (portao novo em 2164ms, mais a varredura do criterio
                     self-contained e a cobertura de tipagem dos gates)
npx tsc --noEmit    rc = 0
```

## Arquivos

| arquivo | |
|---|---|
| `lib/trp/vigenciaRegua.ts` | **novo** — o conceito nomeado, com o porquê da separação |
| `lib/trp/resolveTrpRegraDb.ts` | o critério de cobertura no `escolherFatia` |
| `lib/trp/vigencia.ts` | aviso de não-uso junto de `vigenciaDaCompetencia` |
| `lib/trp/commitVersion.ts` | a rigidez deliberada da (c), com o exemplo do 30/08 |
| `lib/projecaoMetas.ts` | a emenda do *"um único lugar"* |
| `lib/bbts/resolveBbtsRegra.ts` | o desalinhamento conhecido, no cabeçalho dela |
| `scripts/trp_vigencia_regua_gate.cjs` | **novo** — o portão, 6 blocos, 5 mutações |
| `scripts/run_all_gates.cjs` | registro como `self-contained` |
| `_PR_BODY_TRP_VIGENCIA_REGUA.md` | este arquivo, descartável |

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_014Rkia4qvJ5QFHiFnAyEZzS
