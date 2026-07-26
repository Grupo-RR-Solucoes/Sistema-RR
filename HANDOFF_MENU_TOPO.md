# HANDOFF — frente menu-topo (+ delta 3a/3b, UI 4a/4b)

**Branch:** `feat/menu-topo` · **NÃO pushada** · último commit: `46e5100`
**Base da retomada:** `2cfdf47` (fase 3b, o CHECKPOINT onde a sessão começou)
**Data:** 26/07/2026

`tsc --noEmit` = 0 erros em **todos** os commits abaixo, verificado um a um.

---

## Os commits

| commit | entrega |
|---|---|
| `78acb52` | **Fase 1** — tokens da barra (`--nav-h`, `--nav-z`, `--nav-item-active`, `--chrome-offset`) e fim do `240` mágico espalhado em 5 lugares |
| `04b2471` | **Fase 2** — prop `brand` do `HeaderNavy` vira `eyebrow` (17 telas) |
| `728bd84` | **Fase 3** — a barra do topo entra, a sidebar vira drawer em todo breakpoint |
| `2cfdf47` | **Fase 3b** — barra completa até 6 por papel |
| `6039065` | **Regressão P1** — devolve o clamp de largura do shell + migra `/comissoes/editar` |
| `55cbe84` | **P2** — barra vai a 7 itens, ganha Importações/Cadastros/Atribuição |
| `1354c69` | **3a seguro** (recorte por dia) + **3b** (previsão ganha comparativo) |
| `5224d0b` | **4a** — tooltip com valor exato no ponto do gráfico |
| `cf5b890` | **4b** — edição do promotor vira drawer lateral |
| `46e5100` | mata o fóssil de comentário do `paidInsuranceShare` (só comentário) |

---

## FEITO

### Menu (fases 1–4 da frente original)
Barra do topo permanente (`sticky`, 56px), sidebar promovida a drawer sob demanda em todos os breakpoints. Ganho medido: **+220px de largura útil** na maioria dos viewports, por 15px de altura permanente.

### A regressão da Fase 3 — clamp de largura (`6039065`)
A Fase 3 removeu `.rr-content { min-width: 0 }` junto com o grid de 2 colunas do shell. Era **o único clamp de largura do sistema**: sem ele, item de grid (`min-width:auto`) não encolhe abaixo do próprio min-content, o track do `.rr-main-shell` passa dos 1840px e **quem rola na horizontal vira o documento** — barra no rodapé da página inteira e colunas sticky sem scrollport contra o que grudar.

Voltou como `.rr-main-shell > * { min-width: 0 }`, no único grid remanescente do shell.

- Em 1920 a única quebra visível era `/comissoes/editar` (pede 2280px contra 1840 úteis).
- `/promotores` aba wide (1600px) era **quebra latente** — aparece abaixo de ~1660px de viewport, invisível em monitor grande. O clamp mata as duas.
- As 30 chamadas do kit `<Table>` **não** regrediram: a mais larga pede 920px.

### `/comissoes/editar` migrada (`6039065`)
A frente `feat/tabelas-sticky` (PR #20) **nunca tocou este arquivo** — é tabela crua (`<table className="dt">`) com CSS próprio em `.rredit`, dentro do próprio `page.js`. A `.tscroll` era `overflow-x:auto` **sem altura**: a barra horizontal ficava no rodapé das ~700 linhas e o `thead` sticky grudava num scrollport mais alto que a tela.

Ganhou a janela viewport-bound do mesmo token `--chrome-offset`, com reserve **condicional** para a `BulkActionBar` (fixed, 238px) só quando há seleção. As 2 colunas congeladas (`.stk`/`.c-chk`/`.c-ct`, offsets 0 e 46px) ficaram no mecanismo local — o `rr-sticky-col` do kit modela uma coluna só.

### Barra a 7 itens (`55cbe84`)
Medido, não chutado. Item = 26 (padding) + 17 (ícone) + 8 (gap) + rótulo. Cromo fixo = 36 padding + 32 (2 gaps) + 40 logo + 50 hambúrguer + até 264 do bloco de usuário.

| viewport | sobra p/ a lista | cabe |
|---|---|---|
| 1366 | 944px | **7** (834 usados, folga 110) |
| 1440 | 1018px | 8 (956 usados, folga 62) |
| 1920 | 1498px | 9 (1072 usados, folga 426) |

**7 = o maior número que cabe no menor viewport.** 8 ou 9 exigiriam corte por media query, e esconder item por CSS quebra em silêncio o papel que tenha exatamente 8 ou 9 destinos: esse papel não ganha hambúrguer (`visibleItems <= NAV_BARRA.length`), então o item escondido ficaria **inalcançável**. Nenhum papel tem 8 ou 9 hoje — a armadilha é para o próximo.

Fechamento e Auditoria desceram para o drawer, que segue mostrando tudo. `"Atribuição de produtos"` custa 195px de barra e ganhou `barLabel: "Atribuição"` (120px); o drawer mantém o rótulo inteiro.

**Logo:** fica o compacto. A arte full é 1177×696; na barra de 56px caberia a 44px de altura, onde `GRUPO RR` mede 3,8px e `CRED` 5,7px de letra. Ilegível. Para `CRED` ler precisaria de 62px de arte, `GRUPO RR` de 93px — mais que a barra inteira. **Não é pixelização** (74×44 é downscale limpo), é corpo de texto. O lockup segue no header do drawer, a 150px.

### 3a — comissão de SEGURO recorta por dia (`1354c69`)
A comissão de seguro já nasce **por registro** no daily (`insurance_commission_amount`, com `movement_date`): sem derive, sem taxa dependente de volume mensal. As duas pontas saem da mesma query, mesmo predicado, só o filtro de dia muda.

```
antes  julho parcial 3.907,15 x junho CHEIO 4.372,62 = -10,6%
agora  julho 1-23    3.907,15 x junho 1-23  3.828,64 = +2,0%
```
O sinal invertia por janela desigual — o mesmo erro que a Fase 2.1 matou na produção. Fidelidade: junho mês-cheio pelo daily dá 4.297,21 contra 4.372,62 do fechamento (**98,3%**, R$ 75,41).

Evidência: `scripts/probe-delta-3a-comissao-por-dia.cjs` (somente leitura).

### 3a — comissão BRUTA fica em mês-cheio (DECISÃO FECHADA)
Está gravado num bloco `DECISAO FECHADA — NAO REABRIR` em `app/api/dashboard/route.ts`. O caminho **existe** (714 linhas elegíveis em junho), mas foi recusado por dois motivos:

1. **Seria aproximação, não identidade.** 8% das linhas (58 em 714, R$ 472 mil de net) não trazem a taxa à-vista própria e caem no `deriveCompanyReceivedRate`, que acha a faixa da TRP pela produção **mensal** — recortar pode empurrar para faixa inferior, mudando a taxa e não só a janela.
2. **Custaria a âncora de conferência.** O M-1 deixaria de ser o número do fechamento (R$ 196.837,68) e viraria motor-sobre-daily (R$ 187.251,63), que não bate com documento nenhum.

### 3b — previsão de receita ganha comparativo (`1354c69`)
Opção (ii): previsão de julho contra a receita **realizada** de junho, componente a componente (`expectedCash+Prt+Insurance` × `actualCash+Prt+Insurance`, de `closingPayload.companyRows`).

As duas pontas são **mês-cheio** e este é o único card assim, então vai sem janela: `rotuloJanela` devolve `null` e o card **não** mostra `1-23` como os outros. As pontas são métricas diferentes de propósito (previsto × realizado), então as fontes viajam com nomes distintos e `fontesDivergentes` vem `true`. O sub diz `vs junho realizado (mês cheio)`.

Sem M-1 no closing, `valorAnterior` vira `null` e o helper esconde o badge sozinho — falha silenciosa e segura, nunca um número plausível e errado.

### 4a — tooltip do gráfico (`5224d0b`)
Hover ou foco de teclado no ponto amarelo mostra mês + valor em R$ **com centavos** (`brlExato`, não o `brl0` arredondado do card). Alvo de hover separado (círculo transparente r=18 sobre o ponto de r=4,5). Tooltip em **SVG**, não HTML — o gráfico tem viewBox 1000×340 e largura fluida; um balão em HTML exigiria converter coordenada a cada mudança de largura. Posição adaptativa: vira para dentro nas pontas, cai para baixo quando não há espaço em cima.

### 4b — edição do promotor vira drawer (`cf5b890`)
O painel não estava mal posicionado: era **coluna permanente para conteúdo eventual**. `.resumo-grid` era `1fr 340px` e a segunda coluna existia sempre, inclusive sem promotor selecionado. A tabela pagava 340px o tempo todo — e é justamente a tela cuja aba wide pede 1600px.

Agora `.resumo-grid` é `1fr` e a edição é drawer pela direita. **Mecânica promovida do `AppShell`**, não nova: `fixed` + `translateX(100%)` + backdrop + Escape + trava de scroll. Diferenças deliberadas: entra pela **direita** (o menu entra pela esquerda — lados distintos separam navegação de detalhe); backdrop **`.32`** contra o `.42` do menu (o motivo de ser drawer é a linha continuar legível); **z-index 60/59**, a faixa dos drawers de tela do `globals.css`. Fechar não deseleciona a linha.

---

## FALTA — com o caminho já fechado

### 3c-a · `/fechamento` — veredito FECHADO, é só executar
`app/api/fechamento/route.ts:64-71` tem o **último cálculo de variação fora de `lib/delta/`**, e ele está errado:

```js
const recebidoPorMes = payload.trend.filter((t) => toNum(t.actualNet) > 0)  // <- o filtro
const idxSel = recebidoPorMes.findIndex((b) => b.key === selected.key);
const prev = idxSel > 0 ? recebidoPorMes[idxSel - 1] : null;
const variacaoPct = prev && prev.recebido > 0 ? round(((recebidoTotal - prev.recebido) / prev.recebido) * 100) : null;
```

O `.filter(actualNet > 0)` **remove os meses sem fechamento antes de pegar o vizinho**, então `prev` é "o mês fechado anterior", não M-1 — e a tela rotula "vs mês anterior" mesmo pulando mês (com os fósseis de 2025 isso acontece).

**Conserto:** `deltaDaSerie` sobre `payload.trend` **sem** o `.filter(> 0)`, para M-1 ausente virar `valor: null` e o badge sumir, em vez de comparar com abril fingindo ser maio. Remover o inline da linha 71.
Métrica: `recebido` = Σ `actualNet`. Fonte atual e M-1: a mesma série. Janela: sempre mês-cheio (meses fechados).

### 3c-b · `/financeiro` Caixa — 3 prontos, 1 pendente
Existe série mensal em `lib/financialAnalytics.ts:143-152` (`FinanceCashTrendPoint`) — caminho `deltaDaSerie` ideal.

| card | campo | situação |
|---|---|---|
| Recebido | `receivedNet` | ✅ na série — **plugar** |
| Comissões pagas | `comissoesPagas` | ✅ na série — **plugar** |
| Despesas | `totalExpenses` | ✅ na série — **plugar** |
| Saldo | `operatingResult` (card) × `cashBalance` (série) | ⚠️ **campos diferentes** — não verificado se são a mesma métrica. Sem isso provado, não entra. |

**Competência: provada M-1 nos dois lados.** `comissoesPagas`, `paidInsuranceShare` e `receivedEmpresa` leem os três `prevSelKey` / `prevCompetencia` (`financialAnalytics.ts:620-628` e `338-351`). O ponto da série usa a mesma convenção (`linha 842`). O card "Saldo de comissões à vista" subtrai a mesma competência dos dois lados — **não há bug de dinheiro**, o que havia era o comentário fóssil, morto em `46e5100`.

### 3c-c · não investigadas
`/recebiveis`, `/receitas` (RBT12) e `/despesas`. Para cada card: métrica, fonte do mês atual, fonte do M-1, se as pontas casam, se recorta por dia, veredito PLUGAR/NÃO PLUGAR. **Reportar antes de plugar.**

### 3c-d · fora por decisão
Comissões recebidas, Seguro recebido, Seguro repassado e Saldo de comissões ficam **sem delta**: existem só no summary, não na série. Construir série para eles é frente própria, não entra aqui.

### Fases 4, 5 e 6 do plano original do menu — NÃO feitas
- **Fase 4:** remover a marca das 16 telas (hoje repetida no `HeaderNavy` de cada uma, redundante com a barra).
- **Fase 5:** recalibrar `--chrome-offset` — hoje vale `240px`, herdado do mundo PRÉ-BARRA (topbar 40 + 200 de padding/header/folga). O comentário em `globals.css` avisa: **as ~30 chamadas de `<Table scrollable>` dependem deste valor**; trocar o termo da topbar por `var(--nav-h)` exige recalcular, senão as janelas ficam erradas em silêncio.
- **Fase 6:** responsivo.

---

## Decisão do rótulo do delta (Diego, 26/07)

**Rotular sempre com o MÊS REAL da comparação.** Se o card mostra dados de junho e compara com maio, o rótulo diz `vs maio` — nunca assumir M-1 do calendário.

Implementação: passar ao `calcularDelta` **a competência que o card de fato mostra** (M-1, no caso do Caixa) em vez da competência da tela. O `labelAnterior` sai de `competenciaAnterior(competenciaAtual)`, então `vs maio` aparece sozinho, sem gambiarra de string. Mesma disciplina do `1-23` da Fase 2.1: o rótulo mostra o que foi de fato comparado.

---

## PENDÊNCIA QUE ATRAVESSA TUDO — conferência visual

**Nada desta frente foi visto rodando.** A extensão do Chrome foi recusada na sessão, então não houve como dirigir o navegador. Tudo foi verificado por `tsc` e por leitura de código; o único check em runtime foi por HTTP, confirmando que o dev server compilou e serve a regra do clamp no `layout.css`.

Falta olhar, com olho humano:
1. `/comissoes/editar` — barra horizontal alcançável sem rolar a página toda, `thead` grudando no topo da janela, Contrato congelada na horizontal.
2. `/promotores` aba wide em **1440** — validar que o clamp resolveu a quebra latente.
3. A barra com 7 itens em **1366** — confirmar que a conta fecha na prática (a estimativa de largura de texto tem ±5%).
4. O tooltip do gráfico do Dashboard.
5. O drawer do 4b — abre ao clicar na linha, fecha por Escape/backdrop/X, linha visível atrás.
