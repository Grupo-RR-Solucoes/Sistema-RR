## FRENTE FECHADA — a TRP39 vale desde 05/08 e agosto esta partido em 2 fatias

Handoff do fim da frente da vigencia intra-mes + o conserto de UMA LINHA no
portao da paridade, que acusou a producao de um defeito que ela nao tem.

**Nao muda codigo de producao.** Um `.md` e um `.cjs` de portao.

### O estado final, MEDIDO (somente leitura, service_role)

```
2026-07-01 v1 INATIVA 2026-06-30 .. 2026-07-30 | TRP38 | 563fec5d | 2026-07-03T23:17:03
2026-07-01 v2 ATIVA   2026-06-30 .. 2026-07-30 | TRP38 | 59025dd8 | 2026-07-17T23:29:13
2026-08-01 v1 ATIVA   2026-07-31 .. 2026-08-04 | TRP38 | b7bcd68f | 2026-09-01T22:55:20
2026-08-01 v2 ATIVA   2026-08-05 .. 2026-08-28 | TRP39 | f85dac76 | 2026-09-01T23:04:26
```

Agosto: duas linhas, **as duas ATIVAS**, sem se cruzar. A v1 nasceu cobrindo a
janela inteira no passo 1 e foi TRUNCADA em 04/08 pelo passo 2 — a SAIDA 2
(PARTE) do RPC, com o UPDATE antes do INSERT.

**JULHO INTACTO**: 2 linhas, 1 ativa, `30/06..30/07` nas duas, `uploaded_at` de
03/07 e 17/07. E a prova do `where id = v_ativa.id` da Fase 2: partir agosto nao
tocou em julho.

**Trilha completa** — `trp_rule_uploads` de 2026-08: `confirmado`,
`valid_from_override = 2026-08-05`, `committed_version_id = f85dac76` (a v2). A
data que so existia no e-mail da Promotiva ficou registrada como **declaracao**,
nao apenas como efeito, porque o commit foi pelo staging.

### A prova pelo motor REAL

**599 contratos da competencia 2026-08 varridos (74 ate 04/08, 525 de 05/08):
ZERO fora da fatia esperada.**

```
ATE 04/08 -> v1 (TRP38, b7bcd68f)     DE 05/08 -> v2 (TRP39, f85dac76)
  213731664  2026-08-04  1,9600%        216022526  2026-08-27  3,2100%
  213683815  2026-08-04  4,3100%        216004133  2026-08-27  0,0000%
  213058364  2026-08-03  2,3500%        216005364  2026-08-27  3,2100%
```

### O NUMERO QUE DECIDE

```
contratos ate 04/08 que MUDARAM:   0    delta      0,00   <- o dano NAO aconteceu
contratos de 05/08 que MUDARAM : 104    delta -1.452,18   <- legitimo, a TRP39 valendo
29-31/08 (competencia 2026-09, cascata): 12   delta   -200,52
```

**Zero.** Os contratos de 31/07 a 04/08 nao mudaram um centavo. **Os -115,28
medidos em 31/08 — o dano da falta de vigencia intra-mes — NAO ACONTECERAM.**

### Duas correcoes de fato, minhas

1. **74/525, nao 83/558.** O recorte que circulou era por data crua. Pela
   competencia real, dos 641 registros filtrados por `movement_date`, 9 sao de
   2026-07 e 33 de 2026-09. Nao muda o desenho; muda o numero que se cita.
2. **O `TrpVigenciaGapError` disparou no DADO VIVO**, por acidente do meu script
   de medicao (pedi a fatia de um contrato de 31/08 dentro de 2026-08). Recusou
   em vez de escolher a mais proxima. O erro era do script; a recusa esta certa
   — e vale como prova de que o falha-alto funciona em producao, nao so na
   fixture.

### O conserto do portao (uma linha, com prova)

O `gates:db` acusou **19 divergencias em 2026-08**, todas de contratos de
31/07-04/08, com o `previsto` dando TRP39 onde o motor dava TRP38. **Nao era
defeito de producao — era o proprio portao:**

```js
// scripts/paridade_avista_trp_gate.cjs:121, escrito ANTES da Fase 1:
const providerPrev = (c) => preloader.getResolvedSync(c);            // sem data
// lib/recebiveis/avistaProducao.ts:208, a PRODUCAO:
provider = (competencia, contractDate) =>
  preloader.getResolvedSync(competencia, contractDate ?? null);      // com data
```

Com a data repassada: **2411/2411 contratos iguais, 0 divergencias.**

### As TRES dividas que ficam

1. **O diff da tela compara com a competencia ANTERIOR** (`.lt`) em vez da fatia
   ativa da MESMA competencia. Sem consequencia hoje — MEDIDO: `2026-07 v2` e
   `2026-08 v1` sao a mesma regua, 0 diferencas em 11 produtos —, mas engana
   numa v3, pintando de amarelo tudo o que a TRP39 ja tinha mudado. E so
   exibicao. **Primeiro item da proxima frente.**
2. **Rascunho salvo SEM override nao pode ganhar a data depois** — no fluxo
   delegado o campo e so-leitura e o botao "Salvar rascunho" nao existe com um
   rascunho aberto. Fechei uma armadilha e abri outra. Aconteceu em 01/09:
   confirmar aquele rascunho teria caido na SAIDA 1 (SUBSTITUI) e produzido o
   desenho **5b, recusado pelo Diego**. Foi pego na conferencia — nada avisa.
3. **PROVIDER SEM DATA — a mesma classe TRES vezes em 24h**: os 28 scripts de
   diagnostico (nomeada ontem), o meu script de medicao (21h) e este portao
   registrado (23h). Todos construidos ANTES da Fase 1, todos corretos num mundo
   de uma regua por competencia, todos silenciosamente errados a partir das
   23:04 de hoje.

   **REGRA: todo provider construido antes de 01/09/2026 esta sob suspeita, e o
   teste e uma pergunta so — ele repassa a `contractDate`?**

   Varredura dos 11 sitios: os **4 de PRODUCAO estao certos**. Sobram 2 portoes
   REGISTRADOS (`trp_prazo_min_gate:89`, `trp_tx_juros_min_gate:87`) verdes por
   medirem competencia de regua unica, **nao por passarem a data** — verde por
   sorte da competencia —, e 2 scripts nao registrados.

   Um portao para vigiar isso esta **PROPOSTO no handoff, nao implementado**.

### Verde

- `npm run gates`: **35/35** (depois do commit).
- `npm run gates:db`: **27/31** — `paridade a-vista TRP` **VERDE**, e os 4
  pre-existentes de sempre (`repasse de produto`, `competencia por janela`,
  `SRCC ADS`, `audit_v9`) + o teto de tempo da faixa (239,4s de 90s).

### Fora de escopo, dito com todas as letras

A **TRP40 (setembro) NAO subiu**. Esta em disco, e subir e outra decisao. Note
que os 12 contratos de 29-31/08 pertencem a competencia 2026-09 e hoje herdam a
TRP39 por cascata — quando a TRP40 entrar, esses numeros mudam de novo.

PMR de 2026-08 segue em **0 linhas** e o fechamento da Promotiva nao chegou:
tudo isto foi conserto de mes ABERTO, sem reprocessamento.
