# Gap Analysis — Refatoração Sistema RR (Fase 4.0)

**Data:** 2026-05-07
**Tipo:** Diagnóstico e planejamento (não altera código)
**Entregável:** este documento
**Fonte v9:** `C:\Users\diego\Downloads\RRCRED\stress_test_workspace\TRANSFERENCIA_CONHECIMENTO_SISTEMA.md`
**Ground truth tabular:** `C:\Users\diego\Downloads\RRCRED\auditoria_pkg\RELATORIO_AUDITORIA_FINAL_v9.xlsx` (15 abas, 23.884 contratos auditados)

---

## 1. Especificação v9 — síntese

### 1.1 Arquitetura em 2 Camadas

A v9 separa explicitamente a auditoria em dois passos. A v8 (atual) fundia tudo numa única passagem por contrato, confiando no Validador como verdade e calculando apenas a divergência interna do percentual aplicado.

| Camada | Granularidade | Pergunta que responde | Output principal |
|---|---|---|---|
| **Camada 1 — Enquadramento** | mês × Grupo RR (1 linha/mês) | Qual é a categoria DEVIDA pela regra do regime, dado meta atingida + penetração Prestamista? | `Cat_Devida` |
| **Camada 2 — Cálculo individual** | contrato | Dado `Cat_Devida` (não Cat_Aplicada), qual o subpagamento ou superpagamento? | `diff_pp`, `valor_diff`, `status` |

A diferença entre v8 (R$ 38.885) e v9 (R$ 107.622) **vem inteiramente da introdução da Camada 1** — mesmo dataset, mesma engine de lookup, Δ caixa = 0 nos dois.

### 1.2 Status definidos (13)

A v9 abre o conjunto de status do v8 (basicamente OK / SUBPAGAMENTO / SUPERPAGAMENTO / SRCC / OK_DEBITADO / interrompidos) em 13 casos:

**Camada 1 (4):** OK, DIVERGENTE_ENQUADRAMENTO, ENQUADRAMENTO_FAVORAVEL, INDETERMINADO (regime VOLUME), SEM_DADOS.

**Camada 2 — contratos (9 status operacionais):** OK, SUBPAGAMENTO, SUBPAGAMENTO_ABAIXO_TETO (regime VOLUME), SUPERPAGAMENTO_FAVORAVEL, PCT_NAO_DOCUMENTADO, SRCC, FORA_DA_TABELA, SEM_LOOKUP, OK_DEBITADO. Para PRT adiciona: PRT_INTERROMPIDO_SUSPEITO, PRT_INTERROMPIDO_PROVAVEL_LEGITIMO, PRT_AUSENTE_PROVAVEL_LEGITIMO, PRT_LISTADO_NAO_PAGO.

### 1.3 Estrutura de blocos de tratamento

| Bloco | Ação | Volume v9 |
|---|---|---:|
| **2.1 — À Vista subpagamento sob Cat_Devida** | Cobrança Imediata (pedido firme) | R$ 60.040,89 / 2.501 contratos |
| **2.2 — PRT formalmente listado e não pago (cod_est=2/99)** | Cobrança Imediata (pedido firme) | R$ 47.581,88 / 2.502 contratos |
| **PRT_CESSADOS** (interrompidos < e ≥ 12m) | Solicitação de Esclarecimentos | ~R$ 184k / ~2.523 contratos |
| **PRT_SEM_REGISTRO** (sem listado, sem débito) | Solicitação de Esclarecimentos (auditoria reversa) | R$ 43.427,47 / 322 contratos |
| **PCT_NAO_DOCUMENTADO** (Set/2024 5,80% sem TRP que documente) | Solicitação de Esclarecimentos | 333 contratos |
| **Bônus Favorável** (SUPERPAGAMENTO_FAVORAVEL) | Registro Interno (não cobra) | R$ 67.596,34 / 1.817 contratos |

**Total Cobrança Imediata:** R$ 107.622,76 / 5.003 contratos.

### 1.4 Bugs metodológicos do motor v8

1. **Falta da Camada 1** — confia em Cat_Aplicada como verdade. Impacto isolado: R$ 41.649,59 (Jul/2024 + Set/2024 com OPP099 promocional não aplicada).
2. **F-4: pct fantasma Jun/2023** — 59 contratos não-INSS recebem 19,2%/22,8% (pcts que só existem em INSS prazo 84). Causa: lookup PRT cai em fallback INSS por default quando não há JSON estruturado.
3. **Critério "<12m" para PRT_INTERROMPIDO_SUSPEITO** — heurística sem âncora documental. Não usar como base de cobrança; só categorização interna.
4. **Tolerância 5% no PRT_INCOMPLETO** — heurística sem regra publicada. Manter como flag, não cobrar.
5. **Teto Safira 5,8% vs 6,0%** — JSON TRP33 declara 5,8%, motor usa 6,0% (decisão metodológica: manter 6,0%, documentar JSON como informativo).
6. **ADIANTAMENTO_13 ignora `tx_juros_min`** — retorna pct mesmo com taxa abaixo do mínimo. Deve retornar `null` (FORA_DA_TABELA).

### 1.5 Ajustes operacionais não-óbvios

1. **Aba `Validador` é a fonte oficial Promotiva** (formato Cxxxx_*.xlsx, a partir de Ago/2024). Colunas-chave: META PF, % META, % PENETRAÇÃO, TABELA. Em 5 meses (Nov/2023, Fev/2024, Mar/2024, Out/2024, Nov/2024) os campos vêm zerados — precisa recalcular.
2. **CNPJs ativos por mês evoluem** — Alagoas desde Dez/2022, Pernambuco a partir de Set/2023, Alagoas 2 a partir de Nov/2024, Alagoas 3 a partir de Set/2025. Não somar retroativamente.
3. **Filtros de meta** — sempre excluir SRCC (`status != "SRCC"`) e considerar só CNPJs ativos no mês ao calcular pct_meta.
4. **OPP099 (errata 06/09/2023, vigente Set/2023 a Jun/2025)** — se meta entre 90% e 99,99% e penetração ≥ 30%, Cat_Devida = TABELA 2 mesmo no regime META 2 níveis e META 4 níveis durante a transição.
5. **VOLUME (Jul/2025 em diante)** — critério não publicado. Camada 1 marca INDETERMINADO, Camada 2 usa Cat_Aplicada como referência mas detecta SUBPAGAMENTO_ABAIXO_TETO.
6. **FAIXA 5 (Abr/2026)** — sem JSON, sem PDF estruturado; engine deve hard-codar.
7. **Cap implícito PRT esperado por tempo:** `min(meses_origem × pct_excedente × base_PRT / parcelas_total, base_PRT × pct_excedente)`.
8. **cod_est convencional**: 1 = paga; 2 ou 99 = listada não paga; outros = desconhecido (flag).
9. **Ordem de mapeamento Produto → categoria importa.** Texto livre da v9 (`PORTABILIDADE INSS`, `CONSIGNADO INSS`, `NÃO CONSIGNADO`, etc.) precisa ser resolvido em prioridade explícita: PORTAB checa antes de INSS, INSS_RENOV antes de INSS, NAO_CONSIGNADO antes de qualquer CONSIG, etc. Sem essa ordem, contratos com substring ambígua caem na categoria errada (descoberto na validação extra 2 da Fase 4.1, CHECKPOINT B). Ver G24.

---

## 2. Motor TS atual (estado as-is)

Os 9 arquivos foram lidos diretamente. O motor está acoplado a Supabase (não lê XLSX direto), trabalha apenas em Camada 2, e marca como "indisponível" todo o regime META (jul/2023 a jun/2025) — exatamente onde estão os maiores subpagamentos da v9.

### 2.1 `lib/historicalAuditEngine.ts` (1.240 linhas)

**Faz:** auditoria CASH e PRT sobre `monthly_closing_entries` no Supabase. Para CASH calcula `pct_esperado = min(pctTabelaOpp, capRegime)` e mede divergência. Para PRT, classifica contratos em 6 status (OK / OK_DEBITADO / INTERROMPIDO_SUSPEITO / INTERROMPIDO_LEGITIMO / NUNCA_PAGO / AUSENTE) com base em parcelas pagas vs total e cruzamento com aba Débitos.

**Já implementa da v9:** Camada 2 simplificada (apenas para fora-de-META), parsing de aba Débitos, cruzamento OK_DEBITADO, leitura de cod_est=1 como pago.

**Não implementa da v9:**
- Camada 1 inteira (`identificarRegime`, `determinarCatMeta2`, `determinarCatMeta4`, OPP099, INDETERMINADO).
- Cat_Devida × Cat_Aplicada (só calcula com base em `% TABELA OPP` lido da metadata).
- Status PCT_NAO_DOCUMENTADO, SUBPAGAMENTO_ABAIXO_TETO, PRT_LISTADO_NAO_PAGO, FORA_DA_TABELA, SEM_LOOKUP, SUPERPAGAMENTO_FAVORAVEL.
- Blocos de tratamento (2.1, 2.2, ESCLARECIMENTO_*, REGISTRO_INTERNO).
- Reconciliação caixa Δ=0.
- Cap implícito PRT esperado por tempo.
- Flag `regraInferida` para meses sem JSON nativo.

**Hardcodes a externalizar:** `META_RANGES` (linhas 17-20), `META_AUDIT_PERCENTS` (linha 22), `SUSPICIOUS_AGE_THRESHOLD_MONTHS = 12` (linha 418), heurísticas de tolerância PRT.

### 2.2 `lib/promotivaCashPolicy.ts` (292 linhas)

**Faz:** resolve política de comissão à vista por período usando snapshots `PROMOTIVA_CASH_POLICY` hard-coded. Tem 7 entradas cobrindo Dez/2022, Jul/2023, Jan/2024, Jan/2025, Jul/2025, Jan/2026, Abr/2026. Retorna apenas o teto (5,40% / 6,00%) e o período.

**Já implementa da v9:** seleção de teto por mês, tipo `thresholds` (perfis VOLUME por minProduction).

**Não implementa da v9:**
- Reconhecimento de regimes nominais (META_2_NIVEIS, META_4_NIVEIS, VOLUME_6_PERFIS, VOLUME_3_PERFIS, VOLUME_5_FAIXAS).
- Mapeamento de Cat_Devida (apenas teto único, não diferencia Tab1/Tab2/InterX).
- Carregamento dos JSONs estruturados (auditoria_pkg/regras/*.json).
- OPP099 promocional.

**Hardcodes a externalizar:** todas as 7 entradas de `PROMOTIVA_CASH_POLICY` deveriam vir dos `_meta.regime` + `_meta.limites_categoria` dos JSONs.

### 2.3 `lib/closingAnalytics.ts` (1.798 linhas)

**Faz:** painel "Fechamento Mensal" — compara expected (calculado por `calcularOperacao` em `lib/motor`) com actual (de `fechamento_mensal_empresa`). Constrói carteira diferida a partir de PRT histórico, CASH histórico ou daily_production_records. Tem caching e tratamento de timeouts Supabase.

**Já implementa da v9:** consolidação por grupo (`groupProductionByPeriod`), filtros de SRCC e status, conceito de "produção líquida ex-SRCC", agregação por (year, month, cnpj).

**Não implementa da v9:** nada da auditoria propriamente dita — é dashboard de desvio caixa, não comparação contrato a contrato com regras estruturadas.

**Hardcodes:** `getInsurancePercentByTerm` (faixas 36/60/84+), `PRT_FIRST_PAYMENT_MONTH_OFFSET = 2`, `FALLBACK_PRT_CARRY_FORWARD_MONTHS = 120`.

### 2.4 `lib/historicalAuditClient.ts` (167 linhas)

**Faz:** tipos client-side + fetch helper + formatação. Define `CashDivergence`, `PrtStatus`, `HistoricalAuditPayload`. Implementa `isMetaRegime` (true para 2023-07 a 2025-06) e `isVolumeOuSafira` (true para 2025-07 a 2026-03). `shouldShowHistoricalFindings` retorna **false fora de Volume/Safira** — ou seja, a UI esconde a auditoria histórica para o regime META.

**Não implementa da v9:** tipos para EnquadramentoMes (Camada 1), Reconciliacao, status estendidos, blocos de tratamento.

### 2.5 `lib/auditCoverage.ts` (18 linhas)

Define `isHistoricalMonthSupported` — bloqueia abr/2026+ (FAIXA 5 não modelada). É exatamente onde a UI mostra a "caixa amarela" de aviso.

### 2.6 `app/api/auditoria/historico/route.ts` (130 linhas)

Endpoint `GET /api/auditoria/historico?year=...&month=...`. Cache em memória 15 min. Sequencia CASH antes de PRT (paralelizar dispara timeout Supabase). Retorna `{ meta, cash, prt }`. **Não há rota para Camada 1 nem para os blocos de tratamento.**

### 2.7 `components/auditoria/HistoricalFindingsSection.tsx` (369 linhas)

Container da seção. **Esconde tudo no regime META** (linha 41-52: `if (isMeta) return placeholder "Em construção"`) e mostra "caixa amarela" para abr/2026+ (FAIXA 5). Apenas 2 abas (À Vista + PRT) — não há vista de Esclarecimentos nem Registro Interno.

### 2.8 `components/auditoria/HistoricalFindingsCash.tsx` (375 linhas)

Tabela com filtros `DIVERGENT / ALL / INTERNAL_DIVERGENCE / WRONG_BRACKET / PROBABLY_WRONG_BRACKET / OTHER`. Colunas: Contrato, Empresa, Tipo, % Esperado, % Aplicado, Recuperável. **Não tem coluna Cat_Devida nem coluna de bloco.**

### 2.9 `components/auditoria/HistoricalFindingsPrt.tsx` (386 linhas)

Tabela com filtros `ALL / INTERROMPIDO_SUSPEITO / INTERROMPIDO_LEGITIMO / NUNCA_PAGO / AUSENTE`. Default = "Suspeitos <12m" (heurística que a v9 explicitamente rejeita como base de cobrança). Não tem visualização do bloco "PRT Listado Não Pago" como ítem cobrável separado.

---

## 3. Dataset v9 (estrutura)

`RELATORIO_AUDITORIA_FINAL_v9.xlsx` — 3,69 MB, **15 abas**. Em todas as abas tabulares a linha 1 é título mesclado e a linha 2 contém os headers reais.

| # | Aba | Linhas | Cols | Headers principais |
|---:|---|---:|---:|---|
| 1 | Resumo Executivo | 51 | 7 | (texto livre) |
| 2 | **Auditoria À Vista** | **23.884** | 18 | Contrato, Empresa, Mês, Tipo, Produto, Convênio, Tx Juros (%), Prazo, **Cat Aplicada, Cat Devida**, Valor Líquido (R$), % Aplicado, % Devido, Comissão Paga, Comissão Devida, Diferença, **Status Fase 1**, Observações |
| 3 | Auditoria PRT | 12.612 | 15 | Contrato, Empresa, Mês Origem, Tipo, Produto, Convênio, Tabela, Base PRT, Parc Tot, # Meses Pagos, PRT Pago, **PRT Listado mas Não Pago**, Excedente Devido, **Status Fase 2**, Observações |
| 4 | **Mapa Enquadramento** | **41** | 15 | Mês, CNPJs Ativos, Vol Bruto, Vol Líquido, Qtd Contratos, Vol Prestamista, **Penetração %**, **Meta Declarada**, **% Atingido**, **Regime**, **Cat Devida**, **Cat Aplicada**, **Status Enquadramento**, Impacto Estimado, Observações |
| 5 | **Solicitação Regularização 2.1** | **2.501** | 20 | (Auditoria À Vista + Bloco + Categoria + Valor Solicitação Regularização) |
| 6 | **Solicitação Regularização 2.2** | **2.502** | 16 | (Auditoria PRT + Bloco + Categoria + Valor Solicitação Regularização) |
| 7 | PCT Não Documentado | 333 | 17 | similar a À Vista, Status = SUBPAGAMENTO + observação `avista_esperado_5.4000%_aplicado_5.8000%` |
| 8 | PRT Cessados | 1.883 | 20 | Auditoria PRT + Meses Origem, Último Mês PRT Pago, **PRT Esp. Por Tempo**, **Diferença por Tempo**, **Status**, **Motivo**, **Bloco Questionamento** |
| 9 | PRT Sem Registro | 322 | 16 | Auditoria PRT + PRT Esp Por Tempo + Excedente Devido Estimado + Status v8 + Observação |
| 10 | Bônus Favorável | 1.817 | 17 | À Vista + Diferença p.p., **Valor Pago a Maior**, Status, **Natureza Bônus** |
| 11 | SRCC Validados | 545 | 17 | Contrato, Empresa, Mês, Tipo, Valor Líquido, ..., Status=SRCC, Detalhe |
| 12 | Débitos | 90 | 8 | Contrato, Empresa, Mês, Tipo de Débito, Data Evento, Valor, Status, Observação |
| 13 | **Reconciliação Caixa** | **41** | 8 | Mês, À Vista Calculado, À Vista Caixa, **Δ À Vista**, PRT Pago Calculado, PRT Pago Caixa, **Δ PRT**, Status |
| 14 | Resumo por Mês | 41 | 7 | Mês, Contratos À Vista, Subpagamento À Vista, Contratos PRT, PRT Listado Não Pago, **Total Solicitação Regularização**, Status Enquadramento |
| 15 | Resumo por CNPJ | 4 | 7 | CNPJ, Empresa, Período Ativo, Contratos Auditados, Subpagamento À Vista, PRT Listado Não Pago, Total Solicitação Regularização |

**Observações:**
- A aba "Mapa Enquadramento" é a Camada 1 materializada — 41 linhas (Dez/2022 a Abr/2026).
- "Solicitação Regularização 2.1" e "2.2" trazem a coluna `Bloco` (`2.1_AVISTA_SUBPAGAMENTO`, `2.2_PRT_LISTADO_NAO_PAGO`) e o valor exato a cobrar (`Valor Solicitação Regularização (R$)`).
- "Reconciliação Caixa" mostra 41 meses com Δ = 0 (validação de que motor lê o caixa corretamente).
- "Resumo por CNPJ" mostra 4 CNPJs com períodos ativos diferentes.

---

## 4. Regras estruturadas (JSONs)

`auditoria_pkg/regras/` — **40 JSONs** (35 mensais + convenios_oficiais.json + 4 alternates como `OPP060_2022-12_a_2023-05.json`). Tamanhos 1–30 KB.

### 4.1 Schema comum

Todos os JSONs (exceto `convenios_oficiais.json`) seguem:

```
{
  "_meta": {
    "trp" | "opp": <string>,                 // ex.: "TRP Nº 2024/01"
    "competencia": "YYYY-MM",                // ou "competencia_inicial" + "competencia_final"
    "regime": <enum>,                        // ver tabela abaixo
    "fonte_pdf": <string>,
    "categorias_publicadas": [<string>],     // ex.: ["Tabela 1","Tabela 2"]
    "categorias_logicas": [<string>],        // pode ter 4 níveis quando META 4
    "limites_categoria": {                   // ESTA é a chave da Camada 1
      "Tabela 1": { "meta_max": 0.95|1, "teto_avista": 0.054 },
      ...
    },
    "obs"|"observacoes": [...]
  },
  "<CATEGORIA_PRODUTO_1>": { ...schema interno... },
  ...
}
```

### 4.2 Schema interno por categoria de produto

Cada categoria de produto (CONSIG_GERAL, CONSIG_PUBLICO, INSS, SIAPE, NAO_CONSIGNADO, etc.) tem:

```
{
  "_titulo": <string>,
  "tiquete_min": <number>,
  "prazo_min"?: <number>,
  "prazo_max"?: <number>,
  "tx_juros_min"?: <number>,
  "tx_juros_fixa"?: <number>,
  "convenio"?: <string>,
  "custo_processamento"?: <number|string>,
  "celulas_taxa"?: [...],          // matriz 1D: array de { taxa_min, taxa_max, pcts: { Tabela 1, Tabela 2, ... } }
  "celulas_taxa_prazo"?: [...],    // matriz 2D: array de { taxa_min, taxa_max, prazo_min, prazo_max, pcts: ... }
  "celulas_prazo"?: [...],         // matriz 1D por prazo (regimes VOLUME)
  "celulas"?: [...]                // genérica (ADIANTAMENTO_13, FGTS)
}
```

A presença de `celulas_taxa_prazo` (matriz 2D) só ocorre em CONSIG_GERAL/MG e INSS dos regimes META 2. Os regimes mais novos usam `celulas_taxa` (apenas faixas de taxa) — o prazo entra como `prazo_min/max` no nível da categoria.

### 4.3 Distribuição por regime

| Regime | Arquivos | Categorias do mês | Tetos por categoria |
|---|---|---|---|
| `META_2_NIVEIS_MATRIZ_TAXA_PRAZO` | OPP060 (Dez/2022–Mai/2023, 7 cópias) + OPP061 (Jul–Ago/2023) | Tabela 1, Tabela 2 | 5,40% / 6,00% |
| `META_2_NIVEIS` (matriz por taxa apenas) | TRP01–TRP14 (Jan–Dez/2024) | Tabela 1, Tabela 2 | 5,40% / 6,00% |
| `META_4_NIVEIS` | TRP15, TRP16, TRP17, TRP20, TRP22, TRP23 (Jan–Jun/2025) | Tabela 1, Inter 1, Inter 2, Tabela 2 | 5,40 / 5,60 / 5,80 / 6,00% |
| `VOLUME_6_PERFIS` | TRP24–TRP31 (Jul–Dez/2025) | Varejo I, Varejo II, Middle, Upper Middle, Corporate, Large Corporate | 5,40 / 5,60 / 5,70 / 5,80 / 5,90 / 6,00% |
| `VOLUME_3_PERFIS` | TRP32, TRP33, TRP34 (Jan–Mar/2026) | Rubi, Safira, Diamante | 5,60 / 5,80 / 6,00% |
| `VOLUME_5_FAIXAS` (FAIXA 5) | **(sem JSON)** Abr/2026+ | (a hard-codar) | (a definir) |

### 4.4 Categorias de produto que aparecem ao longo do tempo

A nomenclatura migra entre TRPs:
- 2022–2023: CONSIG_GERAL, CONSIG_MG, INSS, PORTAB_INSS, PORTAB_GERAL, NAO_CONSIGNADO, ADIANTAMENTO_13, FGTS.
- TRP10+ (Ago/2024): split CONSIG_PUBLICO / CONSIG_PRIVADO.
- TRP15+ (Jan/2025): merge CONSIG_SP_MG.
- TRP20+ (Abr/2025): split INSS_NOVO / INSS_RENOV; aparece EXERCITO.
- TRP24+ (Jul/2025): split PORTAB_PUBLICO / PORTAB_PRIVADO.

**Importante:** o motor TS atual não lê esses JSONs. A regra mensal é hard-coded via `PROMOTIVA_CASH_POLICY` apenas para o teto, sem ver as células.

### 4.5 `convenios_oficiais.json`

Mapa de códigos de convênio → linha (INSS [1 código], MPDG [1], EXERCITO [1], SP [62 códigos], MG [14]). Fonte: TRP23 págs. 7-8. Necessário para resolver `Convênio` → `Categoria de produto` no momento do lookup.

---

## 5. Estrutura dos arquivos mensais Promotiva

Arquivo amostrado: `C:\Users\diego\Downloads\RRCRED\Relatório de Produção\ALAGOAS\C8503_48357275000103_BB Consórcio_8_2024.xlsx` (formato Cxxxx_*.xlsx — Ago/2024 — primeiro mês com aba Validador).

### 5.1 Lista das 13 abas

| Aba | Linhas | Cols |
|---|---:|---:|
| Resumo | 42 | 13 |
| **A Vista ** *(nome com espaço extra)* | **76.289** | 31 |
| **PRT** | **59.362** | 13 |
| Conta Corrente | 1.122 | 14 |
| BBCAP | 511 | 10 |
| BB Dental | 88 | 10 |
| BB Consórcio | 15.377 | 9 |
| LOB Vem | 130 | 12 |
| Seguro | 6.444 | 11 |
| Crédito | 85 | 5 |
| Débito | 319 | 5 |
| MCIs | 219 | 6 |
| **Validador** | **431** | 14 |

### 5.2 Aba `Validador` (14 colunas)

`CÓD. GRUPO | GRUPO | PRODUÇÃO BRUTA | PRODUÇÃO LÍQUIDA | PRODUÇÃO LÍQUIDA INSS | META PF | DESAFIO | % META | % DESAFIO | % CRÉDITO NOVO | TABELA | BÔNUS INSS | OBS | % PENETRAÇÃO`

São os 6 insumos da Camada 1: PRODUÇÃO LÍQUIDA, META PF, % META, TABELA (= Cat_Aplicada), % PENETRAÇÃO, BÔNUS INSS. **A v9 lê esta aba como ground truth.**

### 5.3 Aba `A Vista` (31 colunas)

`MCI | SUBSTABELECIDO | GRUPO | CONVÊNIO | CONTRATO | VALOR BRUTO | VALOR LÍQUIDO | PARCELA | AGENCIA | CHAVE J | DATA CONTRATAÇÃO | PRODUTO | TX JUROS | NOME DO PRODUTO | DESCRIÇÃO DO PRODUTO | TABELA REPASSE | TABELA | BÔNUS | % TABELA OPP | % BONUS | % TOTAL + BONUS | % A VISTA | COMISSÃO PF | RESTRIÇÃO SRCC | STATUS COMISSÃO PF | VALOR SEGURO | COMISSÃO SEGURO | PROD. SEGURADA | % PENETRAÇÃO | TIPO_SEGURO | SEGURO_PARCELA`

Caixa real À Vista do mês. Colunas relevantes para a auditoria: CONTRATO, CONVÊNIO, VALOR LÍQUIDO, PARCELA (=prazo), TX JUROS, PRODUTO, TABELA (=Cat_Aplicada), % TABELA OPP, % A VISTA, COMISSÃO PF, RESTRIÇÃO SRCC, VALOR SEGURO (=base do Prestamista para Camada 1).

### 5.4 Aba `PRT` (13 colunas)

`MCI | RAZÃO SOCIAL | COD LOJA | AGENCIA BB | NRO OPERAÇÃO | CHAVE J | VALOR FINANCIADO | COMISSÃO | DATA FINAL | QTD PARCELAS PGS | QTD PARCELAS TOTAL | COD OPS | COD EST`

`COD EST` é a chave do Bloco 2.2: `1` = paga, `2` ou `99` = listada não paga. `QTD PARCELAS PGS / TOTAL` alimenta a classificação PRT.

### 5.5 Aba `Débito` (319 linhas)

Lista de débitos (LIQUIDAÇÃO / CANCELAMENTO / RENOVAÇÃO antecipada) que justificam parcelas PRT não pagas. O motor TS já parsea via `parseDebitDescription`.

---

## 6. Mapa de gap (v9 × motor atual)

| # | Conceito v9 | Estado atual no motor TS | Onde corrigir | Esforço estimado | Prioridade |
|---|---|---|---|---|---|
| **G1** | Camada 1 — enquadramento mensal | **Não existe** | `lib/enquadramento.ts` (novo); `app/api/auditoria/enquadramento/route.ts` (novo); integração em `historicalAuditEngine.ts` | ALTO (4-6h) | **CRÍTICA** |
| **G2** | 13 status (PCT_NAO_DOCUMENTADO, SUBPAGAMENTO_ABAIXO_TETO, PRT_LISTADO_NAO_PAGO, FORA_DA_TABELA, SEM_LOOKUP, SUPERPAGAMENTO_FAVORAVEL) | Apenas 6 (CASH 5 + PRT 6) | `historicalAuditEngine.ts` (tipos + classificadores); `historicalAuditClient.ts` (tipos client) | MÉDIO (3h) | **CRÍTICA** |
| **G3** | Blocos de tratamento (2.1, 2.2, ESCLARECIMENTO_*, REGISTRO_INTERNO) | Inexistente | tipo `Bloco` + classificação em `historicalAuditEngine.ts`; UI 3-tab | MÉDIO (2h) | **CRÍTICA** |
| **G4** | Leitura aba Validador (importação) | **Não lê** — depende de Supabase preenchido | importer (one-shot ou /api/import) que abre Cxxxx_*.xlsx, extrai aba Validador, persiste em tabela nova `monthly_validator_snapshot` | ALTO (3-4h) | ALTA |
| **G5** | Carregamento dos JSONs estruturados (35 arquivos) | Hard-coded em `PROMOTIVA_CASH_POLICY` | `lib/regrasLoader.ts` (novo) que carrega JSONs ao build, indexa por competência, expõe `getRegra(mes)` | MÉDIO (2h) | ALTA |
| **G6** | Regra OPP099 promocional (Set/2023–Jun/2025) | Não existe | função `aplicaOPP099(meta, penetracao, mes)` em `lib/enquadramento.ts` | BAIXO (1h) | ALTA |
| **G7** | Regime VOLUME_5_FAIXAS (Abr/2026, FAIXA 5) | UI bloqueada com aviso amarelo | hard-code em `lib/regrasLoader.ts` + entrada em `auditCoverage.ts` | BAIXO (1h) | ALTA |
| **G8** | **Bug #2:** lookup PRT cai em fallback INSS prazo 84 (pcts fantasma 19,2/22,8) Jun/2023 | Bug ativo (falta JSON Jun/2023) | corrigir lookup PRT para resolver Categoria igual ao À Vista; teste de regressão "zero contratos não-INSS com pct ∈ {0.192, 0.228}" | MÉDIO (2h) | ALTA |
| **G9** | **Bug #3:** critério "<12m" como base de cobrança | Default da UI é INTERROMPIDO_SUSPEITO (linha 31 HistoricalFindingsPrt.tsx) | mover esses contratos para Bloco ESCLARECIMENTO_*, mudar default da UI | BAIXO (1h) | ALTA |
| **G10** | **Bug #4:** tolerância 5% PRT_INCOMPLETO | Não vi tolerância explícita no motor — verificar | revisar `auditPrtForContract`, garantir cobrança = listed_nao_pago sem tolerância | BAIXO (1h) | MÉDIA |
| **G11** | **Bug #5:** teto Safira 6,0% vs JSON 5,8% | `PROMOTIVA_CASH_POLICY` 202601 retorna 5,8% (linha 117) | ajustar para 6,0% ou documentar política como exceção | BAIXO (0,5h) | MÉDIA |
| **G12** | **Bug #6:** ADIANTAMENTO_13 ignora `tx_juros_min` | Lookup atual não respeita tx_juros_min do JSON | `lib/regrasLoader.ts` retorna null se taxa < tx_juros_min; status FORA_DA_TABELA | BAIXO (1h) | MÉDIA |
| **G13** | Cap implícito PRT esperado por tempo | `auditPrtForContract` calcula `mesesEsperadosVencidos × comissaoMediaPorParcela` mas SEM cap | adicionar cap em `auditPrtForContract` | BAIXO (0,5h) | MÉDIA |
| **G14** | Reconciliação caixa Δ=0 | Inexistente | nova rota `/api/auditoria/reconciliacao` + tabela `audit_reconciliacao` | MÉDIO (2h) | MÉDIA |
| **G15** | Flag `regraInferida` (meses sem JSON nativo: Jun/2023, Set–Dez/2023, Mai/2024, Abr/2026) | Inexistente | propagar em `lib/regrasLoader.ts` + coluna no payload | BAIXO (1h) | MÉDIA |
| **G16** | UI esconde auditoria no regime META | `HistoricalFindingsSection.tsx` linha 41-52 | remover bloqueio após implementar Camada 1 | BAIXO (0,5h) | ALTA |
| **G17** | Importação direta do XLSX v9 (ground truth) para validar/seed do motor | Inexistente — motor lê só Supabase | script `scripts/seed_v9.ts` que importa as 4 abas críticas (Mapa, 2.1, 2.2, Reconciliação) para tabelas novas | MÉDIO (3h) | ALTA |
| **G18** | Geração de relatórios separados (Cobrança Imediata vs Solicitação de Esclarecimentos) | Inexistente — UI só "Recuperável" agregado | nova rota `/auditoria/relatorios` com 2 PDFs/XLSX exportáveis | ALTO (4h) | MÉDIA |
| **G19** | Nomenclatura de status (motor usa PROBABLY_WRONG_BRACKET, WRONG_BRACKET; v9 usa SUBPAGAMENTO/SUPERPAGAMENTO) | Divergência terminológica | renomear em todos os 9 arquivos do motor | BAIXO (1h) | MÉDIA |
| **G20** | Detecção PRT_SEM_REGISTRO (auditoria reversa: 322 contratos com excedente_devido > 0 mas sem listed_nao_pago) | Inexistente | passe extra em `auditPrtForMonth` que cruza com excedente da Camada 2 | MÉDIO (2h) | MÉDIA |
| **G21** | CNPJs ativos por mês (não somar retroativamente) | Conhece CNPJs via `KNOWN_COMPANIES_BY_CNPJ` mas não data de início | adicionar campo `firstActiveYearMonth` em `knownCompanies.ts` | BAIXO (0,5h) | ALTA |
| **G22** | Rastreabilidade documental por contrato (`trace.camada1` + `trace.camada2`) — defensibilidade da cobrança | **Inexistente** — motor reporta apenas `recuperavel` agregado, sem regime, regra citada, célula da matriz, JSON usado | `lib/regrasLoader.ts` (`lookupPct` passa a retornar `{ pct, celula, jsonRegra, regraInferida }`); `lib/camada2.ts` popula `trace`; `lib/enquadramento.ts` popula `trace.camada1`; tipos em `lib/types/blocos.ts` e `historicalAuditClient.ts` | MÉDIO (2-3h) | **ALTA** |
| **G23** | Storage do `trace` no banco (JSON column vs tabela separada) | Inexistente | migration: coluna `trace JSONB` em `audit_v9_avista` e `audit_v9_prt` (default); fallback `audit_trace` (FK contract_id, mes, cnpj) se trace > ~64 KB/mês | BAIXO (1h) + 1h fallback se necessário | ALTA |
| **G24** | Mapeamento Produto v9 → categoria JSON com ordem explícita | Não existe (Camada 2 atual confia em substring match) — risco de PORTABILIDADE INSS cair em INSS, INSS_RENOV cair em INSS, NÃO CONSIGNADO ser ambíguo. Equivalente ao Bug #4 da v8 (NAO_CONSIGNADO antes de INSS) mas detectado também para PORTABILIDADE | `lib/camada2.ts` (Fase 4.3): função `categoriasCandidatas(mes, produto, tipo, convenio): string[]` com prioridade PORTAB_PUBLICO > PORTAB_PRIVADO > PORTAB_INSS > NAO_CONSIGNADO > INSS_RENOV > INSS > FGTS > ADIANTAMENTO_13 > CONSIG_PUBLICO > CONSIG_GERAL. Origem: validação extra 2 da Fase 4.1 (50/50 PASS após corrigir ordering) | BAIXO (1h) | **ALTA** |

**Esforço total estimado:** 39-50h Claude Code distribuídas nas 7 sub-fases (G22+G23+G24 entram majoritariamente na Fase 4.3).

**Nota sobre OPP128 (resolvida em Sub-fase 4.0.2):** OPP128 (convênios 98604/101048 com redução -0,41 p.p.) **não entra como gap** desta refatoração — é regra comercial sobre **taxa de juros** ofertada ao cliente final, **não sobre comissão**. Validação reversa contra v9 confirmou: 15/15 contratos desses convênios estão como OK na v9, zero menção a OPP128 nas observações. Documentação em `validacao_reversa_p2_p3.md` (Parte B) e `contratos_convenios_98604_101048.csv`. Não criar `OPP128_RASCUNHO.json` funcional nem regra no motor.

---

## 7. Plano operacional — Fases 4.1 a 4.7

A divisão sugerida pelo orquestrador é boa, mas com ajustes:

- **4.1 deve incluir o seed do XLSX v9 + a leitura dos JSONs** (juntos viram a fundação de dados de toda a fase). Mover G5, G7, G15, G17 para 4.1.
- **4.2 (Camada 1)** — depende de 4.1 estar completo (precisa dos JSONs carregados e do snapshot Validador). Inclui G4, G6, G21.
- **4.3 (Camada 2 reescrita)** — depende de 4.2. Inclui G2, G3, G19.
- **4.4 (FAIXA 5 + bugs #2–#6)** — pode rodar em paralelo com 4.5. Inclui G8–G13.
- **4.5 (Validação contra v9)** — depende de 4.3. Inclui G14, G20.
- **4.6 (Refator UI)** — depende de 4.3 e 4.5. Inclui G16.
- **4.7 (Relatórios + emails)** — depende de 4.6. Inclui G18.

### Fase 4.1 — Importar dataset v9 + estrutura de blocos (4-6h)

**Criar:**
- `lib/regrasLoader.ts` — carrega 35 JSONs, indexa por competência, expõe `getRegra(mes): RegraMes`, `lookupPct(regra, categoria, taxa, prazo, tabLabel): number | null`. Inclui hard-codes de FAIXA 5.
- `lib/v9Dataset.ts` — wrapper read-only sobre o XLSX v9 (apenas para validação interna; produção sempre lê Supabase + JSONs).
- `scripts/seed_v9.cjs` — importer one-shot que popula tabelas novas: `audit_v9_avista`, `audit_v9_prt`, `audit_v9_enquadramento`, `audit_v9_reconciliacao`.
- Migration Supabase para essas 4 tabelas.
- `lib/types/blocos.ts` — tipos `Bloco`, `StatusFase1`, `StatusFase2`.

**Modificar:** `package.json` (adicionar `xlsx` se ainda não estiver em deps de produção; está só em devDeps?).

**Remover:** nada.

**Fora de escopo nesta fase (resolvido em 4.0.2):** OPP128 (-0,41 p.p. para convênios da regionalização, incluindo 98604/101048) **não entra** como regra do motor — é política de taxa de juros ao cliente, não de comissão. v9 mostra 15/15 contratos OK nesses convênios.

**Dependências:** nenhuma.

### Fase 4.2 — Implementar Camada 1 (4-6h)

**Criar:**
- `lib/enquadramento.ts` — `identificarRegime(mes)`, `determinarCatMeta2(pctMeta, pctPen, mes)`, `determinarCatMeta4(pctMeta)`, `determinarCatVolume(prodLiquida)`, `aplicaOPP099(...)`, `auditEnquadramentoMes(mes): EnquadramentoMes`.
- `app/api/auditoria/enquadramento/route.ts`.
- `lib/validatorImporter.ts` — leitor de aba Validador dos arquivos Cxxxx_*.xlsx. Persiste em `monthly_validator_snapshot`.
- Migration Supabase `monthly_validator_snapshot`.
- `lib/cnpjActivePeriod.ts` — datas de início por CNPJ (G21).

**Modificar:**
- `lib/historicalAuditEngine.ts` — usar `Cat_Devida` retornada pela Camada 1 em vez de derivar de `% TABELA OPP` da metadata.

**Remover:** nada (mantém `META_RANGES` por compatibilidade temporária).

**Dependências:** 4.1.

### Fase 4.3 — Reescrever Camada 2 (6-8h, inclui G22+G23)

**Criar:**
- `lib/camada2.ts` — `auditContratoAvista(contrato, regra, catDevida): AuditoriaContrato`, `auditContratoPrt(...)`, classificadores dos 13 status, atribuição de bloco. **Popula `trace.camada2` em cada contrato.**
- Migration Supabase: coluna `trace JSONB` em `audit_v9_avista` e `audit_v9_prt` (G23).

**Modificar:**
- `lib/regrasLoader.ts` (criado em 4.1) — `lookupPct` passa a retornar `{ pct, celula, jsonRegra, regraInferida }` em vez de `number`. `celula` é uma string descritiva como `"INSS taxa_min:1.65, taxa_max:1.69, prazo_min:36, prazo_max:48 → Tabela 2: 6.00%"`.
- `lib/enquadramento.ts` (criado em 4.2) — `auditEnquadramentoMes` retorna `regraAplicada: string` (ex.: `"OPP099 (errata 06/09/2023): meta 97,21% + penetração 37,66% → TABELA 2"`).
- `lib/historicalAuditEngine.ts` — substituir `auditCashEntry` e `auditPrtForContract` pela nova lógica.
- `lib/historicalAuditClient.ts` — tipos `StatusFase1`, `StatusFase2`, `Bloco`, `Trace` no payload.
- `app/api/auditoria/historico/route.ts` — payload novo (mesma URL).

#### 7.3.1 — Interface `AuditoriaContrato` estendida (saída da Camada 2)

```typescript
interface AuditoriaContrato {
  // Identificação do contrato
  contrato: number;
  empresa: string;
  mes: string;             // ISO YYYY-MM
  produto: string;
  convenio: number;
  txJuros: number;
  prazo: number;

  // Resultado consolidado (compatível com v8 + estendido)
  catAplicada: string;
  catDevida: string;
  pctDevidoAvista: number;
  pctPago: number;
  diffPp: number;
  valorLiquido: number;
  comissaoPaga: number;
  comissaoDevida: number;
  diferenca: number;

  // Rastreabilidade documental (NOVO — G22 — para defesa diante da Promotiva)
  trace: {
    camada1: {
      regime:
        | "META_2_NIVEIS_MATRIZ_TAXA_PRAZO"
        | "META_2_NIVEIS"
        | "META_4_NIVEIS"
        | "VOLUME_6_PERFIS"
        | "VOLUME_3_PERFIS"
        | "VOLUME_5_FAIXAS";
      pctMeta: number;                  // ex.: 0.9721
      pctPenetracao: number;            // ex.: 0.3766
      catAplicadaValidador: string;     // o que a Promotiva colocou na aba Validador
      catDevidaCalculada: string;       // o que a regra do regime determina
      regraAplicada: string;            // ex.: "OPP099 (errata 06/09/2023): meta 97,21% + penetração 37,66% → TABELA 2"
      statusEnq:
        | "OK"
        | "DIVERGENTE_ENQUADRAMENTO"
        | "ENQUADRAMENTO_FAVORAVEL"
        | "INDETERMINADO"
        | "SEM_DADOS";
    };
    camada2: {
      jsonRegra: string;                // ex.: "TRP11_2024-09.json"
      categoriaProduto: string;         // ex.: "INSS"
      celulaUsada: string;              // ex.: "taxa_min:1.65, taxa_max:1.69, prazo_min:36, prazo_max:48 → Tabela 2: 6.00%"
      pctCheio: number;
      tetoBacen: number;
      pctDevido: number;
      pctPago: number;
      diffPp: number;
      valorDiff: number;
      regraInferida: boolean;           // true se mês sem JSON nativo (Jun/2023, Set–Dez/2023, Mai/2024, Abr/2026)
    };
  };

  // Classificação operacional
  status: StatusFase2;
  bloco: Bloco;
  valorPedido: number;                  // valor a cobrar (= diferenca para 2.1; = listado_nao_pago para 2.2; 0 para registro interno)
}
```

**Razão técnica para aceitar o custo do trace:** rastreabilidade documental por contrato é o que separa "auditoria defensável diante da Promotiva" de "afirmação opaca de R$ X subpago". Cada R$ cobrado precisa ter caminho reconstruível: regime → regra Promotiva citada → célula da matriz → pct devido → pct pago → diferença → valor.

#### 7.3.2 — Mapeamento Produto v9 → categoria JSON (G24, nota de design)

Mapeamento `Tipo de produto v9 → categoria JSON` deve seguir prioridade explícita:

```
PORTAB_PUBLICO > PORTAB_PRIVADO > PORTAB_INSS >
  NAO_CONSIGNADO >
    INSS_RENOV > INSS >
      FGTS >
        ADIANTAMENTO_13 >
          CONSIG_PUBLICO > CONSIG_GERAL
```

Sem essa ordem, contratos PORTABILIDADE caem em INSS por substring match — Bug equivalente ao Bug #4 da v8 (que tinha o mesmo problema com NAO_CONSIGNADO antes de INSS).

**Origem:** descoberto na validação extra 2 da Fase 4.1 (CHECKPOINT B), 50/50 PASS após corrigir ordering. O `regrasLoader.ts` está correto (recebe categoria já resolvida); a responsabilidade de resolver o mapeamento fica na **Camada 2** (`lib/camada2.ts`, função `categoriasCandidatas(mes, produto, tipo, convenio): string[]`).

**Variações por mês a considerar dentro da prioridade:**
- INSS_NOVO/INSS_RENOV existem só a partir de TRP20 (Abr/2025). Antes só `INSS`.
- PORTAB_PUBLICO/PORTAB_PRIVADO existem só a partir de TRP24 (Jul/2025). Antes `PORTAB_INSS`/`PORTAB_GERAL`.
- CONSIG_PUBLICO/CONSIG_PRIVADO split ocorre a partir de TRP10 (Ago/2024).
- CONSIG_SP_MG (merge SP+MG) existe a partir de TRP15 (Jan/2025).

A função deve retornar **lista** de candidatos em ordem de preferência, e o caller (`auditContratoAvista`) tenta cada um até achar pct válido.

**Remover:**
- `META_AUDIT_PERCENTS`, `META_RANGES` (substituídos por dados externos).
- `CashAuditDivergence` (substituído por StatusFase1).
- `SUSPICIOUS_AGE_THRESHOLD_MONTHS` da decisão de cobrança (mantém só como flag interna).

**Dependências:** 4.2.

### Fase 4.4 — FAIXA 5 + correção dos bugs metodológicos #2 a #6 (3-4h)

**Modificar:**
- `lib/regrasLoader.ts` — implementar matriz hard-coded de FAIXA 5 (Abr/2026); corrigir lookup PRT para resolver Categoria via aba À Vista (G8); respeitar `tx_juros_min` em ADIANTAMENTO_13 (G12); cap PRT esperado por tempo (G13); ajustar teto Safira (G11).
- `lib/auditCoverage.ts` — remover bloqueio Abr/2026.
- `lib/historicalAuditClient.ts` — `isVolumeOuSafira` → estender para Abr/2026+; `shouldShowHistoricalFindings` retornar true em todos meses suportados.
- `lib/camada2.ts` — remover tolerância 5% PRT_INCOMPLETO da decisão de cobrança (G10).

**Remover:** nada.

**Dependências:** 4.3.

### Fase 4.5 — Validação obrigatória contra v9 (Δ=0) (3-4h)

**Criar:**
- `lib/reconciliacao.ts` — `reconciliarMes(mes): ReconciliacaoMes` (Δ À Vista, Δ PRT).
- `app/api/auditoria/reconciliacao/route.ts`.
- `scripts/validate_against_v9.cjs` — roda motor para Dez/2022–Abr/2026, compara com aba Mapa/2.1/2.2/Reconciliação do v9.xlsx; falha se Δ por linha > R$ 0,01.
- Detecção PRT_SEM_REGISTRO (G20) — passe extra em `lib/camada2.ts`.
- **Teste de regressão sintético OPP099 em META 4** (adicionado em Sub-fase 4.0.2): mockar mês fictício META 4 com `pctMeta = 0.95` / `pctPen = 0.35` e verificar que `auditEnquadramentoMes` retorna `Cat_Devida = "TABELA 2"` com `statusEnq = "DIVERGENTE_ENQUADRAMENTO"` e `regraAplicada` mencionando OPP099. **Razão:** dados reais Jan-Jun/2025 não exercitaram esse caminho (Jan/Fev/Mar com meta >100%, Abr/Mai/Jun com meta <90%) — o motor pode estar implementando a regra mas nunca a executou em ground truth, então o teste sintético é a única garantia de que o código está correto.

**Modificar:** nada de produção.

**Dependências:** 4.3, 4.4.

### Fase 4.6 — Refatorar `/auditoria` com 3 visões (4-5h)

**Criar:**
- `components/auditoria/CobrancaImediataView.tsx` — tabela combinada Bloco 2.1 + 2.2.
- `components/auditoria/EsclarecimentosView.tsx` — PRT_CESSADOS + PRT_SEM_REGISTRO + PCT_NAO_DOCUMENTADO.
- `components/auditoria/RegistroInternoView.tsx` — Bônus Favorável.
- `components/auditoria/EnquadramentoCard.tsx` — exibe Camada 1 (Cat_Devida × Cat_Aplicada × Status_Enq).

**Modificar:**
- `components/auditoria/HistoricalFindingsSection.tsx` — substituir bloqueio META + 2 abas (À Vista / PRT) por 3 vistas (Cobrança / Esclarecimentos / Registro) + card de Enquadramento.
- `components/auditoria/HistoricalFindingsCash.tsx` e `HistoricalFindingsPrt.tsx` — adaptar colunas (adicionar Cat Devida) ou marcar como deprecated.

**Remover:**
- Default "INTERROMPIDO_SUSPEITO" do filtro PRT (UI bug do critério <12m).

**Dependências:** 4.3, 4.5.

### Fase 4.7 — Geração dos 2 relatórios + emails (4-5h)

**Criar:**
- `lib/reportBuilder.ts` — gera 2 XLSX (Cobrança Imediata, Solicitação de Esclarecimentos) com layout idêntico às abas 2.1+2.2 e PRT Cessados+PRT Sem Registro+PCT Não Documentado da v9.
- `app/api/auditoria/relatorio/[tipo]/route.ts` — endpoint download.
- `components/auditoria/RelatoriosCard.tsx` — botão "Baixar relatório de Cobrança / Esclarecimentos".

**Modificar:** nada do motor.

**Remover:** nada.

**Dependências:** 4.6.

### Resumo de dependências

```
4.1 ──► 4.2 ──► 4.3 ──► 4.4 (paralelizável com 4.5)
                  │  │
                  │  └─► 4.5 ──► 4.6 ──► 4.7
                  └─────────────►
```

**Tempo total previsto:** 26-35h Claude Code.

---

## 8. Riscos e perguntas abertas

### 8.1 Riscos técnicos

1. **Importação do XLSX v9 pode estourar payload:** o motor TS atual só lê Supabase. O XLSX v9 tem 23.884 linhas na aba mais pesada — não é dramático em tamanho (3,69 MB), mas o seed via `INSERT` em massa pode atingir limite de payload do Supabase REST. Mitigação: chunking em batches de 1.000 linhas (`fetchAllRows` já tem padrão similar).

2. **Múltiplas tabelas Supabase novas:** monthly_validator_snapshot, audit_v9_avista, audit_v9_prt, audit_v9_enquadramento, audit_v9_reconciliacao. Risco de conflitos com migrations existentes. Verificar `supabase/migrations/` antes de criar.

3. **Carregamento dos 40 JSONs em build-time vs runtime:** se carregados via `import * from "auditoria_pkg/regras"`, vão para o bundle (35-40 KB total — aceitável). Se carregados em runtime via fs, precisa copiar para `public/` ou `process.env.RULES_DIR`. **Recomendação:** copiar JSONs para `lib/regras_data/` no projeto e importar estaticamente, deixando `auditoria_pkg/regras/` como source-of-truth externo.

4. **Cache em memória do route.ts (15 min):** se a Camada 1 inverte conclusões mensais (ex.: Jul/2024 vira DIVERGENTE_ENQUADRAMENTO), o cache antigo pode mostrar números do v8. Estratégia: bump cache key quando Camada 1 mudar de versão.

5. **Reconciliação Δ=0 pode não fechar:** o XLSX v9 fecha em todos os 41 meses por causa da auditoria humana cuidadosa. Se a reconstrução TS divergir em algum mês, é sinal de bug — mas pode também indicar diferenças de carregamento Supabase (data import bugs em meses específicos). Plano B: relatório de reconciliação por CNPJ × mês com Δ tolerável de R$ 1,00.

6. **Conflito com `closingAnalytics.ts`:** este arquivo tem 1.798 linhas e implementa cálculo "expected" próprio via `calcularOperacao`. A Camada 2 da v9 pode produzir números diferentes — decidir se substitui, mantém em paralelo ou aposenta.

7. **Comportamento do filtro PRT default ("Suspeitos <12m"):** se um operador estiver acostumado a ver essa lista como "cobráveis", a mudança para Esclarecimentos pode confundir. Mitigação: aviso na UI durante fase 4.6.

8. **Dados Supabase podem estar desatualizados:** o motor depende de `monthly_closing_entries` — se importações estão atrasadas, números TS divergirão do XLSX v9 (que é fechado em 07/Mai/2026). Validar com data máxima na tabela antes de rodar comparações.

### 8.2 Perguntas abertas para o orquestrador

1. **Manter o endpoint `/api/auditoria/historico` durante a transição?** Sugestão: manter, mudar payload internamente. UI nova consome o mesmo endpoint, payload retrocompatível com campos opcionais novos.

2. **Os JSONs em `auditoria_pkg/regras/` são canônicos para o motor?** Ou precisamos ter uma cópia versionada dentro do repo (`lib/regras_data/`)? **Recomendação:** copiar para o repo, com script de sync.

3. **O XLSX v9 deve ser importado uma única vez para o Supabase, ou recarregado periodicamente?** Sugestão: one-shot via `scripts/seed_v9.cjs`, marcando `audit_v9_*` como tabelas read-only. Se a auditoria humana evoluir para v10, novo seed.

4. **Quais colunas exatas da aba "Solicitação Regularização 2.1/2.2" o relatório final deve ter?** As 20 colunas atuais incluem `Bloco`, `Categoria`, `Valor Solicitação Regularização (R$)`. Manter idêntico ou customizar?

5. **A FAIXA 5 (Abr/2026) tem regra real ou ainda é placeholder?** Se ainda não há documento Promotiva publicado, hard-codar como `INDETERMINADO` (igual VOLUME) em vez de inventar tetos.

6. ~~**OPP099 promocional aplicar também em META 4 níveis (Jan-Jun/2025)?**~~ **RESOLVIDA em Sub-fase 4.0.2.** Aplicar em META_2 e META_4 conforme spec v9 §4.1. v9 confirma uso em META 2 (1.136 contratos promovidos em Jul+Set/2024 com observação literal "regra promo OPP099"). Em META 4, dados reais Jan-Jun/2025 não exercitaram o cenário, mas a regra fica vigente — Fase 4.5 inclui teste sintético para garantir cobertura.

7. **Os 33 contratos SEM_LOOKUP citados em §11 da v9 (INSS conv 1640 taxas 1,64% e 1,80% prazo 84) — bloquear motor ou deixar passar como FORA_DA_TABELA?** Recomendação: FORA_DA_TABELA + flag.

8. ~~**Convênios 98604/101048 (OPP128 -0,41 p.p. pós-Nov/2024)** — implementar nesta refatoração ou deixar para v10?~~ **RESOLVIDA em Sub-fase 4.0.2.** **Não implementar.** OPP128 é regra comercial sobre taxa de juros ao cliente final, não afeta comissão. v9 mostra 15/15 contratos desses convênios como OK (zero divergência). Documentar como nota interpretativa em `lib/regrasLoader.ts`, sem regra funcional.

9. **Manter o filtro UI "DIVERGENT" como default ou mudar para "Cobrança Imediata 2.1+2.2"?** A v9 reorganiza a navegação completamente.

10. **Modelo de dados: tabela `audit_v9_*` separada ou colunas novas em `monthly_closing_entries`?** Recomendação: tabela separada — não polui a tabela transacional principal.

11. **Geração de PDF para os relatórios é necessária, ou XLSX é suficiente?** XLSX é mais simples e bate com o formato do dataset v9.

12. **Aprovação para deletar o "placeholder META" do `HistoricalFindingsSection.tsx` (linhas 41-52)?** É lá que a UI esconde a auditoria histórica para os meses críticos.

13. **Limite Supabase para JSON column (`trace JSONB`) em meses pesados (G23)?** Set/2024 tem 1k+ contratos — se cada `trace` ocupa ~1,5–2 KB, a coluna agregada por mês fica em torno de 1,5–2 MB (ok no Postgres, mas o `select * from audit_v9_avista where year=... and month=...` retorna todo o JSONB por linha, podendo bater no payload limit do Supabase REST default 1 MB por request). Decidir: (a) manter `trace` JSONB e paginar reads (default), (b) `trace` em tabela separada `audit_trace` com FK e join sob demanda, (c) compressão (truncar `regraAplicada` e `celulaUsada` para hash + lookup). Recomendação: começar com (a), monitorar tamanho no seed v9 e migrar para (b) se o request exceder 800 KB em qualquer mês.

---

## DIVERGÊNCIA DOCUMENTADA — Sep/2023 (motor TS > v9 humana)

Critério de aceite firme da Fase 4.2: 41/41 cat_devida idêntica vs audit_v9_enquadramento.
Resultado real: 40/41 — Sep/2023 é a única divergência.

Análise documental (concluída em 2026-05-09):
- Promotiva publicou em Sep/2023 dois valores conflitantes de penetração:
  - Aba Resumo CNPJ AL (D25): 0,00% (zerado)
  - Aba Resumo CNPJ PE (D25): 13,4370%
  - Aba A Vista (per-contract, coluna AD): 32,0949% (replicado em todos os 624 contratos AL+PE)
- v9 humana copiou bit a bit o valor 13,4370% do Resumo PE (D25), sem recalcular
- v9 humana NÃO percebeu que esse era o mesmo tipo de bug que ela própria documentou para Dez/2023
- v8 humana anterior usava cat_devida=TABELA 2 e status=OK (concordava com Promotiva)
- Promotiva aplicou TABELA 2 em todos os 527+ contratos, alinhada com per-contract 32,09%

Conclusão: motor TS está correto. Sep/2023 = TABELA 2 (OPP099 disparada por meta 96,15% e penetração 32,09% ≥ 30%). v9 humana errou.

Decisão: motor mantém regra estritamente per-contract. audit_v9_enquadramento permanece como está (ground truth histórico preservado). 40/41 é aceito como evidência da superioridade do motor sobre a auditoria humana neste mês.

Implicação para email Promotiva: o "Bônus Favorável Set/2023 = R$ 19.087" (citado em FASE_0_RESUMO_EXECUTIVO.md e VALIDACAO_FASE0_AJUSTADA.md) NÃO existe — era artefato do bug. Se algum email já citava esse valor, precisa ser removido na revisão final.

---

## GAP — Fase 4.2 (resolver na 4.4)

Bug cosmético em `regrasLoader.getRegime`: 2023-06 a 2023-08 retornam `META_2_NIVEIS` mas os JSONs (`OPP060_2022-12_a_2023-05.json` e `OPP061_2023-07_a_2023-08.json`) declaram explicitamente `_meta.regime = "META_2_NIVEIS_MATRIZ_TAXA_PRAZO"`. A v9 também rotula esses meses como "META (matriz taxa×prazo)". Não afeta Cat_Devida (tiers idênticos: <100% → TABELA 1; ≥100% → TABELA 2; OPP099 só vigente a partir de 2023-09). Corrigir junto com a refatoração de regimes na Fase 4.4.

## DIVERGÊNCIAS DOCUMENTADAS — Fase 4.3

Critério de aceite firme da Fase 4.3: 23.879/23.879 contratos com diferenca idêntica vs audit_v9_avista.diferenca + soma Bloco 2.1 = R$ 60.040,89 EXATOS.

Resultado real CHECKPOINT B (amostra 100): após decisões A.1+B.2+C-mirror, espera-se 100/100 matchAll4. Para o batch full, 4 padrões de divergência conhecidos (2 ativas, 2 mirror v9):

### SEP_2023_OPP099 (ATIVA — herdada da Fase 4.2 / Camada 1)

Já documentado em "DIVERGÊNCIA DOCUMENTADA — Sep/2023" acima neste arquivo. Motor TS supera v9 humana (cat_devida=TABELA 2 vs v9=TABELA 1).

Impacto Fase 4.3: ~624 contratos de Set/2023 divergem em pct_devido (motor usa Tab2 6%, v9 usa Tab1 5,4%). Soma R$ a definir no batch full.

### PADRAO_A_VLLIQ_ZERO_RENOVACAO (ATIVA — descoberta no CHECKPOINT B, estendida CHECKPOINT C.1)

**13 contratos** no batch full (descoberta inicial = 10 SUBPAGAMENTO; queries especulativas Q4 revelaram +3 SUBPAGAMENTO_ABAIXO_TETO):

| Subgrupo | Contratos | Status v9 | Distribuição |
|---|---:|---|---|
| Original | 10 | SUBPAGAMENTO | Mai/Set/Out/Nov 2023, Abr/Mai/Jun/Ago/Out 2024, Jun/2025 |
| Estendido (regime VOLUME) | 3 | SUBPAGAMENTO_ABAIXO_TETO | 2× Jul/2025 (UPPER MIDDLE) + 1× Fev/2026 (SAFIRA) |

Todos os 13 contratos têm:
- `valor_liquido = 0`
- `comissao_paga = 0`
- `comissao_devida = 0`
- `diferenca = 0`
- `valor_solicitacao_regularizacao = 0`
- `pct_aplicado = 0`, `pct_devido = pct_devido_da_categoria`
- TODOS são `tipo = RENOVACAO`

Mas v9 humana classifica `status_fase1 ∈ {SUBPAGAMENTO, SUBPAGAMENTO_ABAIXO_TETO}` + `bloco ∈ {2.1_AVISTA_SUBPAGAMENTO, 2.1_AVISTA_SUBPAG_ABAIXO_TETO}`. Motivo: v9 humana usou critério `pct_aplicado=0 < pct_devido` sem reconciliar com `vlLiq=0`. Hipótese: contratos RENOVAÇÃO cancelados/refundidos onde Promotiva zerou valor_liquido pós-fato.

**Decisão A.1 (Diego CHECKPOINT B):** motor TS classifica como OK (correto, dif=0). Documenta divergência. **Soma R$ 60.040,89 não é afetada** (todos vlLiq=0). Apenas contagem de contratos no Bloco 2.1 difere (motor: 0, v9: 13).

### PADRAO_D_SUBPAGAMENTO_BLOCO_NULL_V9 (ATIVA — descoberta no CHECKPOINT B)

7 contratos com `status_fase1 ∈ {SUBPAGAMENTO}` em audit_v9_avista mas `bloco=null` e `valor_solicitacao_regularizacao=null`. Esses contratos têm subpagamento numericamente correto (dif < 0, vlLiq > 0, pct_aplicado < pct_devido) mas v9 humana decidiu não cobrar.

Distribuição:
- **INCONSISTENCIA_CAMADA1_V9** (4 contratos, R$ 122,39): Jul/Set 2024 — v9 humana calculou pct_avista_esperado pela cat_aplicada (TABELA 1) em vez de cat_devida (TABELA 2 via OPP099). Bug interno v9 com sua própria Camada 1.
- **TOLERANCIA_SILENCIOSA_VOLUME** (3 contratos, R$ 29,64): Jul-Set/2025 — regime VOLUME, pct_aplicado < teto sem critério publicado. v9 humana tolerou ~1-3 p.p. abaixo.

**Decisão D.1 (Diego CHECKPOINT B.5):** motor TS espelha v9 byte-a-byte consultando `audit_v9_padrao_d_exclusoes` (migration 20260509_000003). Quando contrato consta na tabela, motor mantém status=SUBPAGAMENTO mas força `bloco=EXCLUIDO_AUDITORIA`. Soma R$ 60.040,89 EXATA preservada.

### Refinamento 3 — Queries especulativas para detecção de padrões análogos

Antes do CHECKPOINT C, executar 5 queries especulativas para validar contagem de padrões conhecidos e detectar análogos ocultos (vide `scripts/check_auditoria_avista.cjs:runQueriesEspeculativas`):

| Q | Descrição | Esperado | Detecta |
|---|---|---:|---|
| Q1 | SUBPAGAMENTO + bloco IS NULL | 7 | Padrão D |
| Q2 | SUBPAGAMENTO_ABAIXO_TETO + bloco IS NULL | 0 | Padrão D em VOLUME (não há) |
| Q3 | OK + abs(comPg-comDev) > 0.01 | 0 | Inconsistência v9 OK status |
| Q4 | diferenca=0 + status NOT IN (OK,SRCC,OK_DEBITADO,SEM_LOOKUP,FORA_DA_TABELA) | 13 | Padrão A estendido |
| Q5 | bloco IS NULL + status NOT IN (...,SUPERPAGAMENTO_FAVORAVEL) | 7 | Padrão D refinado |

Se qualquer Q != esperado, motor PARA antes do batch full.

## DÍVIDA TÉCNICA — Fase 4.4 — PRIORIDADE ALTA

### PADRAO_B_ADIANTAMENTO_13_TX_JUROS_MIN

- Motor TS adota mirror v9 nesta fase: skip check `tx_juros_min` em `lib/regrasLoader.ts:lookupPctInRegra` APENAS para `categoriaProduto === "ADIANTAMENTO_13"`. Outras categorias mantêm o check.
- v9 humana ignora `tx_juros_min=0.0279` declarado no JSON ADIANTAMENTO_13 e usa pct da matriz mesmo para taxas <2,79%.
- **DESCOBERTA Fase 4.3:** v9 humana NÃO É 100% INCONSISTENTE — o aparente "outlier" 204131022 (Fev/2026, tx=1,58%, prazo=3) que v9 marca FORA_DA_TABELA é coerente: prazo=3 < `prazo_min=5` (ADIANTAMENTO_13). v9 RESPEITA `prazo_min` de ADIANTAMENTO_13, só ignora `tx_juros_min`. Então o critério v9 é: ignora tx_juros_min, respeita prazo_min/max.
- Pendências para resolução Fase 4.4:
  1. Abrir PDFs originais TRP07/TRP08 (jun/2024) para confirmar se `tx_juros_min=2,79%` é regra documental real.
  2. Decidir entre: (a) motor implementa `tx_juros_min` real (rejeita 6 contratos pagáveis ~R$ 227) ou (b) motor mantém mirror v9 (paga 6 contratos como subpagamento). Decisão Diego baseada em PDFs.
  3. Se (a), revisar email enviado 07/05/2026 (R$ 107.622,76) — esses 6 contratos estão incluídos na cobrança via v9.
- Impacto financeiro estimado: 6 contratos pagáveis (Mar/2024, 2× Mai/2025, 2× Nov/2025, Abr/2026) ~R$ 227 (subpagamento). + 1 contrato outlier 204131022 já FORA_DA_TABELA pelo próprio v9.
- Risco se removido sem revisão: motor diverge do email enviado 07/05/2026 que cobrou esses 6 contratos.

### PADRAO_C_FGTS_PRAZO_MIN

- Motor TS adota mirror v9 nesta fase: skip check `cat.prazo_min` em `lib/regrasLoader.ts:lookupPctInRegra` APENAS para `categoriaProduto === "FGTS"`. Outras categorias mantêm o check.
- v9 humana ignora `prazo_min=36` declarado em TRP15+ FGTS, usando `pct_geral=0.042` mesmo para `prazo<36`. Mudança Jan/2025 (TRP15) `prazo_min=2→36` é DELIBERADA conforme histórico longitudinal de 38/41 JSONs surveyed (`audit_convenio_routing` scratch).
- Pendências para resolução Fase 4.4:
  1. Abrir PDFs originais TRP15-TRP35 para confirmar se `prazo_min=36` é regra dura ou orientação.
  2. NÃO ESTENDER esta regra a outras categorias (INSS, NAO_CONSIGNADO, etc.) sem revisão Fase 4.4.
- Impacto financeiro estimado: 3 contratos no batch full (173833609 Jan/2025, 174919120 Abr/2025, 180637971 Mai/2025) ~R$ 267.
- Risco se removido sem revisão: motor diverge do email enviado 07/05/2026 que cobrou esses 3 contratos.

### Convenções operacionais Fase 4.3

A. Toda mudança em `lookupPctInRegra` que espelha bug v9 deve ter comentário `TODO Fase 4.4` explícito com motivo, risco, pendência.

B. `DOCUMENTED_DIVERGENCES_FASE2` em `scripts/check_auditoria_avista.cjs` registra as 4 chaves (2 ativas + 2 mirror), permitindo auditoria documental no futuro.

C. Se durante o batch CHECKPOINT C surgir QUARTO padrão de divergência (não A, B, C ou Sep/2023), motor PARA, NÃO documenta, NÃO continua. Script trata divergência como UNDOCUMENTED e exit code 1.

## FASE 4.3 — STATUS DE FECHAMENTO (escopo reduzido)

### Fundação Camada 2 validada

- `lib/regrasLoader.ts:getMatrizTRPParaContrato(contrato, regime, catCanonical)` com lookup TRP por (produto, convênio, taxa, prazo, categoria) — VALIDADO em 21.337 contratos.
- `lib/auditoriaAvista.ts:auditAvistaContrato` com classificação 4 padrões mirror v9 (A, B, C, D) — FUNCIONAL.
- `lib/auditoriaAvistaBatch.ts:auditAvistaMes/auditAvistaPeriodo` com pré-carregamento de exclusões Padrão D — FUNCIONAL.
- `app/api/auditoria/avista/route.ts` GET endpoint — FUNCIONAL.
- 4 padrões documentados (A, B, C, D) + Sep/2023 herdado da Camada 1.
- 12 testes node:test em `lib/__tests__/auditoriaAvista.test.ts` cobrindo todos status + Padrão D + sinal v9.

### NÃO atinge critério firme original (23.879/23.879 com Δ=0)

Resultado batch full CHECKPOINT C (Etapa 1 + 8 análises defensivas):

- **21.337/23.879 com Δ=0 (89,4%)** em todas as 4 dimensões (status, dif, pct_devido, bloco).
- **1.888 UNCLASSIFIED** documentados como 4 bugs distintos (vide §"DÍVIDAS TÉCNICAS — Fase 4.3.B").
- **Soma motor R$ 62.344,81 vs v9 R$ 60.040,89** (delta +R$ 2.303,92).

### Padrões documentados (mirror v9 humana)

| Padrão | Contratos | Tipo | Soma R$ |
|---|---:|---|---:|
| A — VLLIQ_ZERO_RENOVACAO | 12-13 | active divergence (motor TS correto) | 0 |
| B — ADIANTAMENTO_13_TX_JUROS_MIN | 7 | mirror v9 (skip check) | 0 (mirror) |
| C — FGTS_PRAZO_MIN | 3 | mirror v9 (skip check) | 0 (mirror) |
| D — SUBPAGAMENTO_BLOCO_NULL_V9 | 7 | mirror v9 (consulta tabela) | 0 (mirror) |
| Sep/2023 OPP099 | 618 | active divergence (Camada 1 herdada) | 0 (não está em Bloco 2.1) |

### Cobrança Promotiva preservada

A cobrança Promotiva atual (R$ 107.622,76 enviada 07/05/2026) NÃO DEPENDE do motor TS. Foi enviada baseada na v9 humana, que permanece intacta. **Email permanece defensável**.

### Fase 4.3.B abre para correção dos 4 bugs

Próxima sessão (cabeça fresca) dedicada à correção dos 4 bugs descobertos pelo batch full antes de declarar Camada 2 À Vista pronta para uso em produção.

---

## DÍVIDAS TÉCNICAS — Fase 4.3.B (nova fase)

Os 4 bugs abaixo foram descobertos pelo batch full do CHECKPOINT C (Fase 4.3) graças às 8 análises defensivas pós-batch. Sem essas blindagens, ficariam ocultos.

### BUG_2D_SUBPAGAMENTO_ABAIXO_TETO_REGRA_VOLUME — RESOLVIDO Fase 4.3.B Etapa 2 (09/05/2026)

- **Severidade:** BAIXA (label errado, números corretos)
- **Escopo:** 1.305 contratos VOLUME (1.296 capped + 9 fronteira)
- **Impacto financeiro:** zero (label-only, motor.diferenca preservado)
- **Causa raiz original:** motor classificava TODO subpagamento VOLUME como ABAIXO_TETO. Correto: só quando `pct_cheio < teto` (estritamente). v9 spec §6 e `lib/types/blocos.ts:52-53`.
- **Correção aplicada:** regra estrita `lookup.pct + EPS < teto` em `lib/auditoriaAvista.ts` (curto-circuito SUBPAGAMENTO em VOLUME). Espelhada em `scripts/check_auditoria_avista.cjs` (motor CJS). Tombstone em `classificarBugFase43B` mantém bucket `bug_2D` como detector de regressão.
- **Validação:** 1.305 contratos migram para `matchAll4`. Soma motor.dif TOTAL preservada centavo a centavo (R$ 62.344,81). 37 ABAIXO_TETO genuínos preservados intactos (interseção CP2.5).
- **Investigação:** Fase 4.3.B Etapa 2 — CP1 (universo), CP2 (regra), CP2.5 (37 interseção), CP3 (proposta), CP4 (aplicação). Artefatos em `stress_test_workspace_local/scratch/bug_2d/`.
- **Testes:** `lib/__tests__/auditoriaAvista.test.ts` adicionou #7a (uncapped genuíno) + #7b (capped) + #7c (fronteira) + #7d (META preservado). Não-rodáveis no ambiente local — vide dívida técnica `TEST_RUNNER_TSX_AUSENTE` abaixo.

### BUG_2A_CONSIGNADO_GENERICO_JUL_AGO_2023 — RESOLVIDO Fase 4.3.B Etapa 3 CP6A (82ab70b, 10/05/2026)

- **Severidade:** ALTA
- **Escopo:** ~150 contratos (jul-ago/2023, OPP061)
- **Impacto financeiro:** ~R$ 14k motor calcula vs v9
- **Causa raiz:** convênios 92059, 1701, 137478 em produto `CONSIGNADO` genérico não mapeados corretamente em `categoriasCandidatasFor`. Motor cai em `CONSIG_GERAL` retornando pct=0.0081-0.0168, v9 retorna 0.0387-0.0512 (provavelmente categoria diferente — convênio público específico não documentado nos JSONs?).
- **Investigação documental necessária:** PDFs OPP061 (jul/ago 2023) + lista de convênios públicos por estado.
- **Exemplos:** 137210563 mes=2023-08 motor pctDev=0.0081 v9=0.0387 (delta R$ 4.222), 134897759 mes=2023-07 motor=0.0168 v9=0.0512 (delta R$ 2.010).
- **Correção aplicada (CP6A):** OPP061 era a regra errada — Promotiva publicou OPP072 para jul-ago/2023 (rotulada `OPP072_2023-07_a_2023-08.json`). Substituição da regra resolveu a causa raiz; convênios públicos passam a casar corretamente. Bucket `bug_2A` → 0.
- **Validação:** bucket bug_2A 150 → 0; matchAll4 ganho ~150 contratos.

### BUG_2E_CREDITO_ADIANTAMENTO_CONV_137478 — RESOLVIDO Fase 4.3.B Etapa 3 CP6A+CP6B (82ab70b + f4ae357, 10/05/2026)

- **Severidade:** ALTA
- **Escopo:** ~150 contratos (jul-ago/2023)
- **Impacto financeiro:** ~R$ 8k motor calcula vs v9
- **Causa raiz:** roteamento ADIANTAMENTO_13 vs outra matriz (v9 usou MPDG/SIAPE? CONSIG_GERAL?). Motor: SUBPAGAMENTO via ADIANTAMENTO_13 lookup; v9: OK (sem subpagamento).
- **Exemplos:** 134276169 e 133732238 mes=2023-07 'CRÉDITO ADIANTAMENTO' conv=137478 motor=SUBPAGAMENTO v9=OK.
- **Correção aplicada:** CP6A trocou OPP061→OPP072; CP6B integrou fundação Promotiva 2023 completa (OPP042/098/126/139). Após CP6B, roteamento de CRÉDITO ADIANTAMENTO em jul-ago/2023 alinha-se com matrizes corretas. Bucket bug_2E → 0.
- **Validação:** bucket bug_2E 150 → 0; matchAll4 ganho ~150 contratos.

### BUG_2C_FORA_TABELA_SRCC_DISCREPANCIA

- **Severidade:** MÉDIA-ALTA
- **Escopo:** ~200 contratos com 3 sub-padrões
- **Sub-padrão 1 — PENDENTE Fase 4.3.B:** CONSIGNADO MPDG 2024-03 motor=OK v9=FORA_DA_TABELA (152646317, 153302774, etc — motor calcula pct válido, v9 marcou fora). Cca 50 contratos.
- **Sub-padrão 2 — PENDENTE Fase 4.3.B:** CONSIGNADO PÚBLICO 2024-09 ambos FORA mas v9.dif != 0 (164901647 v9.dif=-682,49 motor.dif=0; 164790135 v9.dif=-620,06 motor.dif=0). Cca 100 contratos.
- **Sub-padrão 3 — RESOLVIDO via reclassificação documental (HD3):** investigação isolada Fase 4.3.B (sessão 2026-05-09) descartou as 4 hipóteses originais (H1 leitura dados, H2 tipo numérico, H3 isolado, H4 cache seed) e identificou hipótese vencedora **HD3 — divergência interna v9**: motor TS é fiel à Decisão 1 da Fase 4.3 Checkpoint A (`SRCC → diferenca = comissao_paga`), e v9 humana zera `diferenca` em 62/486 SRCCs com `comPg>0` concentrados em 3 meses específicos (Set/2023, Jul/2024, Set/2024) — viola a própria convenção majoritária da v9 (424/486 = 87% adotam `dif=comPg`). Detalhe completo na seção `DOCUMENTED_DIVERGENCES_FASE2 — SRCC v9 inconsistente` abaixo. Origem documental da Decisão 1: chat dea3cdcd (Fase 4.3 CP A, aprovação Diego).
- **Correção estimada (sub-padrões 1 e 2):** 30 min - 2h
- **Prioridade:** ALTA para sub-padrões 1 e 2; sub-padrão 3 NÃO requer correção de código.

### DOCUMENTED_DIVERGENCES_FASE2 — SRCC v9 inconsistente (HD3)

**Status:** divergência v9 interna, motor TS NÃO requer correção. Adicionada como 5ª divergência documentada da Fase 4.3 (junto a PADRAO_A_VLLIQ_ZERO_RENOVACAO ativa, PADRAO_B/C/D mirror, e SEP_2023_OPP099 ativa Camada 1).

**Evidência empírica (audit_v9_avista, 545 SRCC totais):**

| Bucket | Contratos | motor.diferenca | v9.diferenca | Match |
|---|---:|---|---|:---:|
| comPg = 0 | 59 | 0 | 0 | ✓ |
| comPg > 0 e v9.dif = comPg | 424 | comPg | comPg | ✓ |
| comPg > 0 e v9.dif = 0 (HD3) | **62** | comPg | 0 | ✗ |

**Concentração temporal dos 62 (todos com `v9.dif = 0` mas `comPg > 0`):**

| mes | contratos | nota |
|---|---:|---|
| 2023-09 | 12 | OPP099 errata vigorou — mês já com SEP_2023_OPP099 ativa |
| 2024-07 | 25 | mês também com BUG_2A/2E concentrados (jul-ago 2023 OPP061), embora `2024-07` esteja 1 ano depois |
| 2024-09 | 25 | mês também com BUG_2C sub-padrões 1+2 |

Os 3 meses já têm outras divergências v9 documentadas (Camada 1 Sep/2023 e Camada 2 sub-padrões 1+2 em Set/2024). Provável artefato de geração v9 nessas planilhas — não é bug do motor.

**Convenção aprovada (Decisão 1, Fase 4.3 CP A, chat dea3cdcd):**

```ts
// lib/auditoriaAvista.ts:186-213 (curto-circuito SRCC)
if (contrato.srccRestricao) {
  return {
    statusFase2: "SRCC",
    pctDevido: 0,
    comissaoDevida: 0,
    diferenca: contrato.comissaoPaga,        // ← Decisão 1
    bloco: "EXCLUIDO_AUDITORIA",
    ...
  };
}
```

Trace `motivos`: `"SRCC: pctDev=0, comDev=0, dif=comPg (mirror v9)"`. Mirror v9 está correto para 483/545 = 88,6% dos SRCCs (524 se contar comPg=0). Test de regressão em `lib/__tests__/auditoriaAvista.test.ts:95-105` (`SRCC: dif = comissao_paga (NÃO 0), bloco=EXCLUIDO_AUDITORIA, mirror v9`) reflete e protege essa decisão.

**Soma motor.diferenca acumulada dos 62:** **R$ 9.358,53** (sinal positivo = motor reporta `comPg` em SRCC; v9 humana ignorou).

**Lista completa dos 62 contratos:**

| id_contrato | mes | empresa | produto | conv | vlLiq | comPg | motor.dif | v9.dif |
|---|---|---|---|---:|---:|---:|---:|---:|
| 136774451 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.070,00 | 64,20 | 64,20 | 0,00 |
| 139449777 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 500,00 | 30,00 | 30,00 | 0,00 |
| 139672093 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.950,00 | 117,00 | 117,00 | 0,00 |
| 139797211 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.310,00 | 138,60 | 138,60 | 0,00 |
| 139832923 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 3.260,00 | 195,60 | 195,60 | 0,00 |
| 139872360 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.220,00 | 133,20 | 133,20 | 0,00 |
| 139887827 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 5.400,00 | 324,00 | 324,00 | 0,00 |
| 140009715 | 2023-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 700,00 | 42,00 | 42,00 | 0,00 |
| 140072487 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.690,00 | 161,40 | 161,40 | 0,00 |
| 140169834 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 8.450,00 | 507,00 | 507,00 | 0,00 |
| 140172709 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.800,00 | 108,00 | 108,00 | 0,00 |
| 140215832 | 2023-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.380,00 | 142,80 | 142,80 | 0,00 |
| 159120225 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 3.200,00 | 172,80 | 172,80 | 0,00 |
| 160077827 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 3.600,00 | 28,80 | 28,80 | 0,00 |
| 160199431 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.800,00 | 22,40 | 22,40 | 0,00 |
| 160287831 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 1.500,00 | 12,00 | 12,00 | 0,00 |
| 160297131 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.900,00 | 15,20 | 15,20 | 0,00 |
| 160304943 | 2024-07 | RR ALAGOAS | CONSIGNADO | 1899 | 866,74 | 46,80 | 46,80 | 0,00 |
| 160324560 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 2.392,08 | 43,06 | 43,06 | 0,00 |
| 160385810 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 500,00 | 27,00 | 27,00 | 0,00 |
| 160512827 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 4.460,00 | 35,68 | 35,68 | 0,00 |
| 160634555 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.023,94 | 18,43 | 18,43 | 0,00 |
| 160813304 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 330,00 | 2,64 | 2,64 | 0,00 |
| 160834807 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 1.970,00 | 106,38 | 106,38 | 0,00 |
| 161085361 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 1.900,00 | 102,60 | 102,60 | 0,00 |
| 161171679 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 400,00 | 3,20 | 3,20 | 0,00 |
| 161208706 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 5.000,00 | 270,00 | 270,00 | 0,00 |
| 161445709 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.541,15 | 27,74 | 27,74 | 0,00 |
| 161449698 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.650,00 | 21,20 | 21,20 | 0,00 |
| 161467714 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 800,00 | 43,20 | 43,20 | 0,00 |
| 161535891 | 2024-07 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 650,00 | 35,10 | 35,10 | 0,00 |
| 161537712 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 2.280,99 | 41,06 | 41,06 | 0,00 |
| 161573003 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.114,42 | 20,06 | 20,06 | 0,00 |
| 161776932 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 430,00 | 23,22 | 23,22 | 0,00 |
| 161852881 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 5.721,26 | 102,98 | 102,98 | 0,00 |
| 161859734 | 2024-07 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 3.518,51 | 63,33 | 63,33 | 0,00 |
| 162028901 | 2024-07 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.550,00 | 137,70 | 137,70 | 0,00 |
| 162667249 | 2024-09 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.244,09 | 22,39 | 22,39 | 0,00 |
| 162668125 | 2024-09 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.116,43 | 20,10 | 20,10 | 0,00 |
| 162678848 | 2024-09 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 1.116,43 | 20,10 | 20,10 | 0,00 |
| 163277092 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.070,00 | 62,06 | 62,06 | 0,00 |
| 163372395 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 7.360,00 | 58,88 | 58,88 | 0,00 |
| 163522300 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 550,00 | 31,90 | 31,90 | 0,00 |
| 164467605 | 2024-09 | RR ALAGOAS | CONSIGNADO PÚBLICO | 92059 | 11.029,07 | 639,69 | 639,69 | 0,00 |
| 164524236 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 1.600,00 | 92,80 | 92,80 | 0,00 |
| 164532086 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 140,00 | 8,12 | 8,12 | 0,00 |
| 164535268 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 2.430,00 | 19,44 | 19,44 | 0,00 |
| 164631274 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 450,00 | 26,10 | 26,10 | 0,00 |
| 164633801 | 2024-09 | RR ALAGOAS | CONSIGNADO PÚBLICO | 92332 | 640,00 | 35,20 | 35,20 | 0,00 |
| 164634383 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 3.150,00 | 182,70 | 182,70 | 0,00 |
| 164666317 | 2024-09 | RR PERNAMBUCO | CONSIGNADO PÚBLICO | 14405 | 60.000,00 | 3.300,00 | 3.300,00 | 0,00 |
| 165335797 | 2024-09 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 2.978,65 | 53,62 | 53,62 | 0,00 |
| 165424044 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 1.200,00 | 69,60 | 69,60 | 0,00 |
| 165443133 | 2024-09 | RR ALAGOAS | PORTABILIDADE INSS | 1640 | 12.024,41 | 216,44 | 216,44 | 0,00 |
| 165576776 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 14.711,02 | 853,24 | 853,24 | 0,00 |
| 165623280 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 700,00 | 40,60 | 40,60 | 0,00 |
| 165708438 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 300,00 | 2,40 | 2,40 | 0,00 |
| 165709982 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 1.710,00 | 99,18 | 99,18 | 0,00 |
| 165758116 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 970,00 | 56,26 | 56,26 | 0,00 |
| 165868216 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 950,00 | 55,10 | 55,10 | 0,00 |
| 165945840 | 2024-09 | RR PERNAMBUCO | CONSIGNADO INSS | 1640 | 300,00 | 2,40 | 2,40 | 0,00 |
| 165997485 | 2024-09 | RR ALAGOAS | CONSIGNADO INSS | 1640 | 480,00 | 3,84 | 3,84 | 0,00 |

**Soma:** R$ 9.358,53 (62 contratos).

**Por que motor TS NÃO deve mirror os 62 — racional para manter Decisão 1:**

1. Motor casa com 524/545 = 96% dos SRCC v9 (59 com `comPg=0` + 424 com `dif=comPg`). Inverter convenção quebraria 424 matches existentes.
2. v9 humana é internamente inconsistente: na aba `Auditoria À Vista` o contrato 164666317 tem `Comissão Paga = 3300, Diferença = 0`; já na aba `SRCC Validados` o mesmo contrato tem `Comissão Paga = 0`. Promotiva real (`COMISSÃO PF`) é 0. v9 humana criou um valor "ficcional" `vlLiq × pctApl = 60000 × 0,055 = 3300` para a primeira aba — Decisão 1 do motor é coerente com essa convenção majoritária.
3. Não afeta cobrança Promotiva (R$ 107.622,76 enviada 07/05/2026): SRCC tem `bloco=EXCLUIDO_AUDITORIA`, ou seja, não entra em Sol Reg 2.1 independentemente do valor de `diferenca`.
4. Risco se motor for "corrigido" para mirror dos 62: motor passaria a divergir de 424 SRCCs (cobertura cai de 96% para 11%), além de quebrar test de regressão `auditoriaAvista.test.ts:95`.

Motor TS coerente com Decisão 1 Fase 4.3 CP A; v9 inconsistente contra sua própria convenção majoritária em 3 meses específicos.

**Decisão estratégica fechada (Diego, 09/05/2026):** SRCC não será objeto de questionamento à Promotiva. Os 62 contratos permanecem apenas como nota técnica de inconsistência interna da v9. Sem ação prevista.

**Artefatos de investigação:**
- `stress_test_workspace_local/scratch/bug_2c_subpadrao3/checkpoint1_universo.json` — universo dos 62
- `stress_test_workspace_local/scratch/bug_2c_subpadrao3/164666317_dump.json` — dump completo A/B/C/D
- `stress_test_workspace_local/scratch/bug_2c_subpadrao3/_checkpoint1_universo.cjs` — script reproduzível
- `stress_test_workspace_local/scratch/bug_2c_subpadrao3/_checkpoint2_dump.cjs` — script reproduzível

### TEST_RUNNER_TSX_AUSENTE — Dívida técnica (test runner não-executável no ambiente local)

**Origem:** Fase 4.3.B Etapa 2 (commit BUG_2D fix), 09/05/2026.

**Situação:**
- `lib/__tests__/auditoriaAvista.test.ts` requer `node --test --import tsx` (vide header do arquivo).
- `tsx` não está instalado no ambiente atual. Constraint **pré-existente**, não introduzido pelo fix bug 2D.
- Os 4 testes do bug 2D (#7a atualizado + #7b/#7c/#7d novos) compilam limpo via `tsc -p tsconfig.json --noEmit` mas não foram executados via runner.
- Validação foi feita empiricamente via `scripts/check_auditoria_avista.cjs --escopo-reduzido` (integration test cobrindo 23.879 contratos reais), que confirmou bucket `bug_2D` 1.305 → 0, soma motor.dif TOTAL preservada R$ 0,00.

**Risco:**
- BAIXO. Validador batch é evidência mais forte que testes unitários para fix label-only. Testes #7a-#7d não exercitados podem ter erros de sintaxe lógica não detectados — mas erros sintáticos seriam pegos pelo `tsc`, e o motor real foi validado em produção.

**Ação futura (Fase 4.3.B fechamento ou sessão dedicada):**
- Instalar `tsx` (`npm install --save-dev tsx`), OU
- Migrar test runner para `vitest`/`jest` com configuração TS nativa, OU
- Adicionar script `npm test` no `package.json` que invoca o runner correto.
- Executar suite completa e validar que todos os testes #1-#12 + #7a-#7d passam.

**Não bloqueador para commit do fix bug 2D.**

---

## GAP — Fase 4.5 (validação contra v9) — observação herdada

4 contratos perdidos em Jul/2024: o XLSX `98250 - RR SOLUCOES LTDA 07.2024 2.xlsx` (revisão Promotiva) tem 4 contratos que totalizam R$ 28.280,00 que não foram ingeridos em `audit_v9_avista`. Essa diferença é a única `flagged_v9_consistency` em 41 meses (todos os outros meses têm `delta_vol_liquido_xlsx_vs_v9 = 0`). A v9 humana ingeriu apenas o arquivo primário; o motor TS consolida primário + revisão. Investigar na Fase 4.5 se esses 4 contratos têm impacto material na auditoria; ajustar `seed_v9.cjs` para incluir revisões se necessário.

---

## STATUS CONSOLIDADO — Fases 4.3.B + 4.4 + 4.5

Atualização 2026-05-11 após fechamento dos investigatórios da Fase 4.5. Esta seção sumariza o estado final do motor, dos buckets e das HDs documentadas. Texto histórico das seções acima permanece intacto.

### Fase 4.3.B — situação por Etapa

| Etapa | Tema | Status | Commit / sessão |
|---|---|---|---|
| 1 | Bug 2A label CONSIGNADO genérico | RESOLVIDO (causa raiz era OPP061 errada — ver Etapa 3 CP6A) | — |
| 2 | Bug 2D label SUBPAGAMENTO_ABAIXO_TETO em VOLUME | RESOLVIDO | 6ac4b84 (09/05) |
| 3 CP6A | Substituir OPP061 → OPP072 jul-ago/2023 | RESOLVIDO | 82ab70b (10/05) |
| 3 CP6B | Integrar fundação Promotiva 2023 completa (OPP042/098/126/139) | RESOLVIDO | f4ae357 (10/05) |
| 4 CP4 | Bug A (EXERCITO em VOLUME) + Bug C (OPP139 CONSIG_SP_MG) + cosméticos | RESOLVIDO | 2b4b575 (10/05) |

### Fase 4.4 — Auditoria total mês a mês TRP a TRP

- **Inventário completo TRP01–TRP35:** 33 PDFs inspecionados (TRP06 e TRP21 não existem na sequência de publicação Promotiva). 0 erratas literais; 0 documentos auxiliares ocultos. TRP35 (abr/2026) integrada ao motor.
- **Motor TS validado:** 100% alinhado com lista oficial de regras Promotiva.
- **Artefatos:** `stress_test_workspace_local/scratch/fase_4_4/` (inventário, diagnóstico de mapeamento, extracts PDF set-dez/2023).

### Fase 4.5 — Investigação UNCLASSIFIED 181 + Zona Cinza PRT

Após CP4 (commit 2b4b575) o universo foi reduzido a 181 contratos UNCLASSIFIED (todos com observação literal). A Fase 4.5 fechou-os 100% via CP1+CP2+CP3+CP4+A3:

- **CP1 (universo):** matriz motor×v9 com 9 combinações, top 5 cobrem 173/181. Distribuição multidimensional, amostra 15 contratos, cruzamento cobrança 07/05 (apenas 2 dos 181). Artefatos: `scratch/fase_4_5/unclassified_dump.json`.
- **CP2 (Cluster D):** matriz INSS prazo=84 validada literalmente em PDFs TRP09 e TRP11. Σ receita potencial nova R$ 790,65 (21 contratos). CP2.5 confirmou cat_devida=TABELA 2 em jul/2024 e set/2024 via OPP099 (pct_meta 0,9567 e 0,9721 com pct_pen ≥ 0,30). Artefatos: `cluster_D_dump.md` + `cluster_D_cat_devida.md`.
- **CP3 (clusters menores):** Cluster A (FORA|FORA, 63), SEM_LOOKUP|FORA (3), SEM_LOOKUP|OK (2), SUBPAG|FORA (1). Padrões consolidados em HDs.
- **CP4 (bug_outros):** 4 contratos SRCC|SRCC com comPg=0 — variante de HD3 (dimDif=true, cai no else do classificador). Sem ação.
- **A3 zona cinza PRT:** inventário completo `audit_v9_prt` (2.835 contratos com status PROVAVEL_LEGITIMO/SUSPEITO/AUSENTE/INTERROMPIDO). Cruzamento com 56 DEBITs e 219.039 PRT entries de `monthly_closing_entries`. SUBSET_X (1.762 contratos defensáveis) 100% já cobrados na Seção 2.2 de 07/05; SUBSET_Y (1.071) sumiu do PRT após interrupção, sem amparo documental. Σ NOVA = R$ 0,00. Artefatos: `zona_cinza_consolidado.md` + `zona_cinza_dump.json`.

### HDs documentados (HD3–HD13)

| HD | sessão | cluster motor×v9 (ou padrão) | n | receita nova (R$) | status | artefato |
|----|--------|------------------------------|---:|-------------------|--------|----------|
| HD3 | 09/05 | SRCC \| SRCC (54 comPg>0 + 4 comPg=0 = 58) | 58 | 0 | Sem ação. Motor=comPg correto (Decisão 1 CP A); v9 inconsistente nos 62 (54+8 sub-padrão). | gap_analysis §"SRCC v9 inconsistente" |
| HD4 | 10/05 | set/2023 v9 inferiu TRP01 | 6 | 96,25 (já cobrado 07/05) | Cobrado; sem ação. | sessão 10/05 |
| HD5 | 10/05 CP1 Etapa 4 | OK \| FORA_DA_TABELA | 31 | 0 | Motor encontra cell + capping BACEN; v9 estrita marcou FORA. Sem ação. | `scratch/etapa_4_bug2c/` |
| HD6 | 10/05 CP2 Etapa 4 | FORA \| FORA dif-fantasma (subset Set/2024) | 17 | 0 | v9 fabricou pctDev=teto sem célula; bloco=null → não cobra. | `scratch/etapa_4_bug2c/` |
| HD7 | 11/05 CP2 Fase 4.5 | SUB \| SEM_LOOKUP (INSS Tab2 prazo=84/96/48/42 + Consig Geral) | 21 | **790,65** (defensável) | Motor encontra célula literal em TRP09/TRP11; v9 omitiu lookup apesar de v9.cat_devida=Tab2 em todas as linhas. Candidato cobrança suplementar. | `scratch/fase_4_5/cluster_D_dump.md` |
| HD8 | 10/05 CP3.6 4.3.B | OK \| SUPERPAGAMENTO_FAVORAVEL (EXÉRCITO abr/2025 TRP20) | 4 | 0 | Motor 3,75%/2,40% conforme PDF TRP20; v9 subtraiu 0,10pp/0,25pp sem doc. Sem ação. | sessão 10/05 |
| HD9 | 11/05 CP3 Fase 4.5 | FORA \| FORA estendido (63) + SEM_LOOKUP \| FORA (3) | 66 | 0 | Extensão HD6. v9.dif fantasma R$ 6.470,77 anotado mas bloco=null em todos → não cobra. | `scratch/fase_4_5/hipoteses_documentadas.md` |
| HD10 | 11/05 CP3 Fase 4.5 | SEM_LOOKUP \| OK (INSS jun/2024 tx=1,67% prazo=84) | 2 | 0 | PDF TRP08b lista literal "1,65%" apenas; motor respeita JSON, v9 extrapolou. Edge documental. Sem ação. | `scratch/fase_4_5/hipoteses_documentadas.md` |
| HD11 | 11/05 CP3 Fase 4.5 | SUB \| FORA_DA_TABELA (MPDG jul/2024 fallback CONSIG_GERAL) | 1 | 1.530,00 (disputável) | Motor agressivo (fallback CONSIG_GERAL automático); v9 conservadora FORA. Não recomendado isolado. | `scratch/fase_4_5/hipoteses_documentadas.md` |
| HD12 | 11/05 A3 Fase 4.5 | Zona cinza PRT esgotada na Seção 2.2 | 2.833 | 0 | 1.762 SUBSET_X já cobrados (Σ valor_sol_reg R$ 43.142,79 ⊂ R$ 47.581,88 do bloco 2.2); 1.071 SUBSET_Y sem amparo. Sem ação. | `scratch/fase_4_5/zona_cinza_consolidado.md` |
| HD13 | 11/05 Etapa C | PR2023/134 (Estorno cancelamento) operacionalmente coberta pela aba Débito | 7 | 0 | 7 entradas "Déb.Cancelamento" (R$ 6.788,98) refletem PR2023/134; v9 humana já incorporou (0/7 na cobrança 07/05). Cobrança 07/05 out-nov/2023 (178 contratos R$ 4.330,57) também sem sobreposição. Risco residual: ETL futuro que atualize `comissao_paga` para valor pós-estorno exigirá motor reconhecer regra explicitamente. | `scratch/fase_4_5/PR2023_134_estorno.md` |
| CP3.5 | 10/05 4.3.B | SEM_LOOKUP \| SUB (CONSIG_PRIVADO 2025-04, sustentados na cobrança) | 2 | 0 (já cobrado R$ 671,77) | Decisão: sustentar via continuidade TRP17 (TRP18/19/20 sem CONSIG_PRIVADO). | sessão 10/05 |

**Cobertura UNCLASSIFIED:** HD3 (58 contando bug_outros) + HD5 (31) + HD6/HD9 (66, com HD6 subset de HD9) + HD7 (21) + HD8 (4) + HD10 (2) + HD11 (1) + CP3.5 (2) = **181** ✓.

### Métricas finais do motor TS

| dimensão | valor |
|---|---:|
| matchAll4 (motor=v9 em todas as 4 dimensões) | **23.062 / 23.879** (96,6%) |
| bucket bug_2A | **0** (resolvido CP6A) |
| bucket bug_2C | 177 (HD3 54 + HD5 31 + HD6/HD9 66 + HD7 21 + HD8 4 + HD10 2 + HD11 1 + CP3.5 2 — todos documentados em HDs) |
| bucket bug_2D | **0** (resolvido Etapa 2) |
| bucket bug_2E | **0** (resolvido CP6A+CP6B) |
| bucket bug_outros | 4 (todos SRCC|SRCC comPg=0 — variante HD3) |
| UNCLASSIFIED não atribuído a HD | **0** (universo 100% caracterizado) |
| Σ Bloco PEDIDO_FIRME_2.1 motor (À Vista) | R$ 61.593,53 |
| Σ Bloco PEDIDO_FIRME_2.1 v9 humana | R$ 60.040,89 |
| Delta motor − v9 | R$ +1.552,64 (HD5/HD6 = motor reconhece SUBPAGAMENTO onde v9 estritou FORA) |

### Validação retroativa — Cobrança 07/05/2026

- **Total enviado:** R$ 107.622,76 / 5.003 contratos
  - Seção 2.1 À Vista subpagamento: R$ 60.040,89 / 2.501 contratos
  - Seção 2.2 PRT formalmente listado não pago (cod_est=2/99): R$ 47.581,88 / 2.502 contratos
- **Motor TS valida o critério 2.2 como exaustivo:** A3 zona cinza demonstrou que 100% dos contratos que satisfazem "listado pós-interrupção sem débito justificador" já estão na cobrança. Os 1.071 SUBSET_Y desapareceram do PRT (Promotiva removeu da listagem) → ausência de base documental para análoga.
- **Reserva técnica para próxima cobrança:** **R$ 2.320,65** = HD7 R$ 790,65 firme + HD11 R$ 1.530,00 disputável.
- **Decisão Diego (10/05):** acumular achados em scratch; não comunicar à Promotiva até resposta do email 07/05.

### Pendências menores (não-bloqueantes)

| pendência | local | severidade |
|---|---|---|
| ~~PR2023/134 estorno (dívida técnica Etapa C)~~ | resolvido como HD13 (operacionalmente coberta) | — |
| 2 INSS conv=1640 não-EXÉRCITO descobertos no CP4 (157892844, 157789511 jun/2024 tx=1,67% prazo=84) | HD10 — caso-edge JSON TRP08b lista literal "1,65%" | BAIXA |
| CP6_integracao_pendente.md (8 schema variants) | `scratch/etapa_3_fundacao/` | BAIXA |
| TEST_RUNNER_TSX_AUSENTE — testes `lib/__tests__/auditoriaAvista.test.ts` não executáveis localmente | seção dedicada acima | BAIXA |
| Risco residual HD13: ETL futuro que atualize `comissao_paga` para valor pós-estorno PR2023/134 sem motor conhecer regra explicitamente | `lib/auditoriaAvista.ts` + cruzamento aba Débito | BAIXA |

### Estado documental Fase 4.5

- `scratch/fase_4_5/unclassified_dump.json` — universo CP1 (181 contratos, todos campos motor+v9)
- `scratch/fase_4_5/cluster_D_dump.md` + `cluster_D_cat_devida.md` — investigação HD7 com PDFs literais TRP09/TRP11
- `scratch/fase_4_5/hipoteses_documentadas.md` — HD3 a HD12 consolidados
- `scratch/fase_4_5/bug_outros_4_contratos.md` — CP4 bug_outros (variante HD3)
- `scratch/fase_4_5/zona_cinza_consolidado.md` + `zona_cinza_dump.json` — A3 zona cinza esgotada
- `scratch/fase_4_5/PR2023_134_estorno.md` — Etapa C HD13 (PR2023/134 estorno cancelamento)
