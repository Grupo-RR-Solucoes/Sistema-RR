# Sistema RR — Especificação: Import do cms (ground truth da comissão)
## Sessão 01/06/2026 — SUBSTITUI o modelo de recálculo por fechamento

> **Virada arquitetural:** o sistema NÃO calcula a comissão do promotor. Ele
> IMPORTA e REPRODUZ o cms (PRODUÇÃO_GERAL_RR), onde o financeiro RR já calculou
> a comissão. O modelo anterior (recálculo por fechamento, Opção A) foi
> DESCARTADO porque nunca converge para o que o financeiro paga.

---

## 1. POR QUE A VIRADA

Passamos a sessão tentando o sistema **calcular** a comissão do promotor a partir
das `monthly_closing_entries` (bruto Promotiva) aplicando teto 5,80%, repasse,
share, PRT. Nenhuma tentativa bateu o número real:

| Fonte | Thaynara março (crédito) | Bate o real? |
|---|---|---|
| Diário (previsão) | 15.280,63 | não |
| Recálculo Fase 1 (Opção A) | 12.579,20 | não |
| **cms (ground truth)** | **14.889,29** | **É a verdade** |

A comissão do promotor é o que o **financeiro digitou no cms**, não uma fórmula.
O cms aplica ajustes/acordos/seguro que não são puramente deriváveis. Logo: o
sistema deve **ler o cms**, não recalcular.

**Causa do problema:** o cms NUNCA foi importado. O sistema só importa o
`ProducaoMensalBD` (diário/previsão). A comissão-promotor do cms não está em
lugar nenhum do banco.

---

## 2. ESTRUTURA DO cms (verificada)

Arquivos: `(cms)PRODUÇÃO GERAL RR <AL1|AL2|AL3|PE> <MÊS> <ANO>.xlsx` — 4/mês.
Abas: **GERAL** + 1 aba por promotor.

⚠️ **Descoberta crítica:** na aba GERAL as colunas de repasse (COMISSÃO PROMOTOR
/ COMISSÃO SEGURO) estão **VAZIAS**. O repasse só está preenchido nas **abas por
promotor**. → A fonte do ground truth são as ABAS POR PROMOTOR, não a GERAL.

Colunas (idênticas em todas as abas):

| idx | Coluna | Destino |
|---|---|---|
| 0 | CONTRATO | contract_number |
| 1 | VALOR BRUTO | gross_value (ref.) |
| 2 | VALOR LÍQUIDO | net_value (ref.) |
| 5 | CHAVE J | j_key → promotor |
| 6 | PROMOTOR(A) | nome/atribuição |
| 8 | TX JUROS | interest_rate (ref.) |
| 9 | DESCRIÇÃO DO PRODUTO | product_description |
| 10 | % A VISTA | avista_percent (ref.) |
| 11 | COMISSÃO PF | company_commission (empresa, ref. p/ auditoria) |
| 13 | VALOR SEGURO | prêmio (ref.) |
| 14 | COMISSÃO SEGURO | seguro empresa (ref.) |
| 15 | % PENETRAÇÃO | penetration (ref.) |
| **16** | **COMISSÃO PROMOTOR** | **promoter_credit ← GROUND TRUTH crédito** |
| **17** | **COMISSÃO SEGURO (última col)** | **promoter_insurance ← GROUND TRUTH seguro** |

---

## 3. TABELA DESTINO (nova — não estender daily)

```
cms_promoter_entries (
  id uuid pk,
  cms_import_id uuid → cms_imports(id),
  company_id uuid → companies(id),
  company_cnpj text,
  prod_year int, prod_month int,        -- competência = mês de PRODUÇÃO (nome do arquivo)
  j_key text,
  promoter_id uuid → promoters(id),      -- resolvido por j_key (fallback nome da aba)
  promoter_name_sheet text,
  contract_number text,
  product_description text,
  net_value numeric, gross_value numeric,
  avista_percent numeric,                -- ref.
  company_commission numeric,            -- COMISSÃO PF (empresa) — p/ reconciliação
  promoter_credit numeric,               -- col 16 — GROUND TRUTH crédito
  promoter_insurance numeric,            -- col 17 — GROUND TRUTH seguro
  insurance_premium numeric, penetration numeric,
  source_sheet text, raw_payload jsonb, created_at timestamptz
)

cms_imports ( id, company_id, prod_year, prod_month, file_name, status, finished_at, created_at )
```

Tabela separada do diário porque o cms é por promotor já atribuído, traz repasse
pronto (não recalculado), e a competência é mês de produção.

---

## 4. CONSUMO PELO /api/calculate/monthly

```
mêsFechado = existe cms_imports COMPLETED p/ (prod_year, prod_month) em TODAS as empresas

SE mêsFechado:
   PMR.production_commission_value = Σ promoter_credit    (por promoter_id, ano/mês)
   PMR.insurance_commission_value  = Σ promoter_insurance
   PMR.final_commission_value      = production_commission_value + insurance_commission_value
   → REPRODUZ o cms. NÃO recalcula. NÃO aplica 5,80% / acordo / FIX-6 / descontos.
SENÃO (mês aberto):
   usa daily_production_records (previsão) + FIX-6, como hoje.
```

**Regra do valor final (cravada 01/06):** no mês fechado, o final é
**COMISSÃO PROMOTOR + COMISSÃO SEGURO do cms, e nada mais** — sem somar acordo,
sem subtrair descontos, sem aplicar FIX-6 (tudo já embutido no cms pelo
financeiro). Descontos desconsiderados.

---

## 5. DECISÕES CRAVADAS (01/06)

1. **Empresa→CNPJ→aba:** mapear token do nome do arquivo (AL1/AL2/AL3/PE) →
   company_id. (Thaynara = PE, 51.457.289/0001-03.)
2. **Seguro mês fechado:** FIX-6 NÃO se aplica — o cms já traz o seguro-repasse
   pronto (Thaynara 1.162,28). FIX-6 vale só no modo diário/aberto.
3. **Reconciliação:** gravar COMISSÃO PF (empresa) no import, para auditar o cms
   contra `monthly_closing_entries` (bruto Promotiva) e detectar divergências.
4. **Abas sem match de promotor** (nem por chave J nem por nome) → relatório de
   erro, nunca silenciar.
5. **Valor final = cms puro** (decisão acima).

---

## 6. ANTI-DUPLA-CONTAGEM + EXCLUSÕES

- Importar **só as abas por promotor** (col 16/17 preenchidas). NÃO somar a
  GERAL (repasse vazio; somar empresa+aba misturaria bases). Cada contrato
  aparece 1× na aba do seu promotor.
- A GERAL pode ser lida à parte só para o total-empresa de auditoria.
- Mapeamento: CHAVE J → `j_keys.promoter_id` (robusto), fallback nome da aba
  (atenção a variações de acento: MONALIZA/MONALISA, JARLLES/JARLES).
- **JJJ552710:** não aparece neste cms, mas manter filtro de exclusão por
  segurança.
- Pular linhas "TOTAL" (CONTRATO não numérico).
- PRT legado / chave não-mapeada: não tem aba de promotor → fica naturalmente
  com a empresa (não entra no PMR). ✔ atende a regra.

---

## 7. TESTE DE ACEITE (validado contra arquivo real)

Aba **THAYNARA TAVARES**, cms PE, produção março:
- Σ COMISSÃO PROMOTOR (col 16) = **R$ 14.889,29** (crédito)
- Σ COMISSÃO SEGURO (col 17) = **R$ 1.162,28** (seguro)
- **TOTAL = R$ 16.051,57**

O import lendo cols 16/17 das abas por promotor reproduz exatamente. ✅

---

## 8. SEQUÊNCIA DE IMPLEMENTAÇÃO

1. Migration: `cms_imports` + `cms_promoter_entries`.
2. Rota/lib de import do cms (lê abas por promotor, mapeia j_key→promotor,
   grava cols 16/17, exclui JJJ552710, pula TOTAL, relatório de não-mapeados).
3. Tornar `/api/calculate/monthly` condicional: mês fechado lê cms; mês aberto
   segue diário+FIX-6.
4. Importar cms de dez/25, jan, fev, mar (todos os 4 CNPJs) — Diego tem todos.
5. Validar Thaynara março = 16.051,57; depois validar outros promotores.
6. Reconciliação cms × monthly_closing_entries (auditoria empresa).

---

## ESTADO COLATERAL (não esquecer)
- FIX-7 (parser ×10) e FIX-8 (Thaynara 4,48%) commitados local, sem push.
- TRP35 errata: 3.2/4,30-4,75/F3 = 4,48% (sistema correto).
- Thaynara = PE (memória antiga dizia AL3, corrigido).
- Auditoria cobrança Promotiva R$107k: não mexer até resposta do 1º e-mail.

**FIM — base para a sessão de implementação do import do cms.**
