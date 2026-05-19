# Dia 4.5 Etapa A — Schema de perfis + pré-população

Data: 2026-05-19
Escopo: schema novo + seeds + script de pré-população dos 44 promotores. **Não toca código TS** (cascata + UI ficam na Etapa B).

---

## Entregas

### 1. Migration schema (`20260518230000_dia45_share_profiles.sql`)

- ENUM `share_profile_type` com 6 valores
- Tabela **`share_scale`** (catálogo de escalas, kind = CREDIT | INSURANCE)
- Tabela **`share_scale_tier`** (faixas de cada escala) — UNIQUE(scale_id, volume_min) + CHECK volume_max>min
- Tabela **`promoter_share_profile`** (1:1 com promoters, FK CASCADE)
  - CONSTRAINT `profile_consistency` valida a combinação `(profile_type, fixed_percent, scale_id)` — força que apenas a coluna correspondente ao tipo esteja preenchida.
- Tabela **`entrante_monthly_volume`** (tracking para futura graduação 6m)
- ALTER `promoter_proposal_commissions ADD COLUMN share_percent_override numeric(7,4)`
- **RLS** nas 4 tabelas novas: read autenticado, write apenas sócio (via subquery em `app_users`). DROP POLICY IF EXISTS antes de CREATE para idempotência.

### 2. Migration seeds (`20260518231000_dia45_share_scale_seeds.sql`)

3 escalas + 14 tiers, todos com `ON CONFLICT DO NOTHING` (idempotentes):

| scale_code | kind | tiers |
|---|---|---|
| PADRAO_ENTRANTE | CREDIT | 5 (0/50k/80k/100k/136k) |
| LETICIA_JAYENE | CREDIT | 2 (0/100k) |
| SEGURO_SLIP_MAIO_2026 | INSURANCE | 7 (penetração 0–15/15–25/25–30/30–35/35–40/40–60/60+) |

**Nota semântica:** para `kind = INSURANCE`, `volume_min/max` representam **% penetração** (decimal 0..1), não volume R$. A Etapa B/C decide aplicação conforme `scale_kind`.

### 3. Script de pré-população (`scripts/dia45_prepopulate_share_profiles.py`)

- Dicionário `PROFILES` com 17 promotores classificados explicitamente (2 CLT + 4 acordo fixo + 6 entrante padrão + 1 entrante custom + 4 acordo variável)
- Match por nome com `normalize_name` (NFD + ASCII + uppercase) + fallback parcial (substring)
- Catch-all: todos os promotores sem entry explícito viram `DEFAULT`
- **Idempotente**: UPSERT por `promoter_id`
- Resumo no stdout: classificados / default / não-encontrados / ambíguos / erros + distribuição final por `profile_type`
- Validação: `scale_id` obrigatório para perfis ENTRANTE_*; aborta entry se `scale_code` não existir no banco (impede CHECK constraint violation)

---

## A.4 Validação técnica — **pendente Diego executar**

Como migrations + script precisam ser executados no Supabase, eu não posso rodar. Diego executa nesta ordem:

1. **Aplicar migrations** no Supabase Studio (ou `supabase db push`):
   - `20260518230000_dia45_share_profiles.sql`
   - `20260518231000_dia45_share_scale_seeds.sql`

2. **Verificar seeds:**
   ```sql
   select count(*) from share_scale;              -- esperado: 3
   select count(*) from share_scale_tier;         -- esperado: 14 (5+2+7)
   select scale_code, scale_kind, count(*) as tiers
     from share_scale s join share_scale_tier t on t.scale_id = s.id
     group by scale_code, scale_kind order by scale_code;
   ```

3. **Rodar script** (do diretório raiz do projeto):
   ```bash
   pip install supabase python-dotenv
   python scripts/dia45_prepopulate_share_profiles.py
   ```

4. **Verificar distribuição:**
   ```sql
   select profile_type, count(*)
     from promoter_share_profile
    group by profile_type
    order by profile_type;
   ```
   Esperado (per análise das planilhas):
   ```
   ACORDO_FIXO        4
   ACORDO_VARIAVEL    4
   CLT_FIXO           2
   DEFAULT           27
   ENTRANTE_CUSTOM    1
   ENTRANTE_PADRAO    6
   TOTAL             44
   ```

Se algum nome não bater (script reporta `NAO ENCONTRADOS`), Diego me passa o nome real do banco e ajusto a entry no `PROFILES`.

---

## Decisões consolidadas (documentadas)

- **Promoção ENTRANTE → DEFAULT:** após 6 meses consecutivos com `monthly_volume >= 136000`. Lógica de promoção automática fica como **D26 backlog** — a tabela `entrante_monthly_volume` apenas registra o histórico por enquanto.
- **Teto 5,80%** sobre `valor_liquido` mantido na cascata atual de `/api/calculate/monthly` — Etapa B integra com o novo perfil.
- **Cascata da Etapa B (planejada):** `share_percent_override` (proposta) > `profile.fixed_percent` > `profile.scale` (tier por volume) > regras existentes (manual_proposal / product_rule / agreement / imported_monthly_table / default_share).

---

## Não toca código TypeScript

Confirmado: nenhum arquivo `.ts` ou `.tsx` foi modificado nesta etapa. Apenas:
- 2 arquivos SQL novos em `supabase/migrations/`
- 1 arquivo Python novo em `scripts/`
- Este relatório em `scratch/`

R1 status: **100% mantido** — cascata e UI atuais não sofrem alteração.

---

## Pendências para próximas etapas

**Etapa B (cascata + UI base):**
- Refator `/api/calculate/monthly` para consultar `promoter_share_profile` + escalas (com tier lookup por volume) na cascata
- Endpoint `GET /api/commissions/proposals` ampliado: retornar `share_percent_effective` + `share_percent_source` (qual nível da cascata definiu o valor)
- UI: coluna `% REPASSE` (override) separada de `% PROMOTOR` (efetivo final pós-cascata)
- Bulk apply alvo passa a ser `share_percent_override`

**Etapa C (seguro slip ativo):**
- Cascata de seguro consome `SEGURO_SLIP_MAIO_2026` a partir de maio/2026
- Coluna `COMISSAO SEGURO PROMOTOR` editável (override no `proposal_commissions`)

**D26 backlog:**
- Lógica de promoção automática `ENTRANTE → DEFAULT` após 6 meses consecutivos com volume ≥ 136k

---

## Restrições respeitadas

- Migrations idempotentes (DO blocks para CREATE TYPE; IF NOT EXISTS para tabelas/colunas; DROP POLICY IF EXISTS; ON CONFLICT DO NOTHING nos seeds)
- Script idempotente (UPSERT on_conflict promoter_id)
- Sem mudança em `/api/calculate/monthly`
- Sem mudança na UI
- Sem UI de gerenciamento de perfis (frente futura)

---

# Resultado final (19/05/2026)

## Aplicação das migrations

Via Supabase Studio (SQL Editor):
- `20260518230000_dia45_share_profiles.sql` ✓
- `20260518231000_dia45_share_scale_seeds.sql` ✓

## Verificações pós-migration

- `share_scale`: 3 escalas (`PADRAO_ENTRANTE`, `LETICIA_JAYENE`, `SEGURO_SLIP_MAIO_2026`)
- `share_scale_tier`: 14 tiers (5+2+7)
- `promoter_share_profile`: tabela criada
- `promoter_proposal_commissions.share_percent_override`: `numeric(7,4)` adicionado

## Pré-população

Script Python executado. Catch-all aplicou DEFAULT em 31 promotores inicialmente. 9 entries explícitas bateram. **7 nomes não bateram** por causa de nomes incompletos no dict PROFILES original:

| Dict original | Nome real no banco |
|---|---|
| ALDALENE FREITAS | ALDALENE DE FREITAS ABRAÃO |
| ANA CLARA | (não existe no banco — D28) |
| ANA PRISCILA | (não existe no banco — D28) |
| FABIANA BEZERRA | (não existe no banco — D28) |
| MONICA PEREIRA | (não existe no banco — D28) |
| MARIA LETICIA | (não existe no banco — D28) |
| ISAC NICHOLAS | ISAC NICHOLAS AZEVEDO |
| JARLLES MARLON | JARLES MARLON DE OLIVEIRA (1 L) |

E **1 nome ambíguo**: `JULIANA DOS SANTOS` bateu com 2 promoters (real `JULIANA DOS SANTOS OLIVEIRA` + chave master `JULIANA DOS SANTOS - CHAVE MASTER`).

**Patch SQL manual** aplicado via Supabase Studio para corrigir os 7 que são registros reais. **Script atualizado nesta etapa** (wrap-up) para próxima execução bater 100% sem patch.

## Distribuição final validada (40 promotores)

| Profile | Qtd | Promotores |
|---|---|---|
| DEFAULT | 28 | Catch-all (4 incluem chaves master) |
| CLT_FIXO | 2 | Lilian Crislayne; Maria de Fátima |
| ACORDO_FIXO | 4 | Carla 25%; Erika 62,50%; Thaynara 75%; Juliana DOS SANTOS 100% |
| ENTRANTE_PADRAO | 1 | Isac Nicholas |
| ENTRANTE_CUSTOM | 1 | Leticia Jayene (escala custom) |
| ACORDO_VARIAVEL | 4 | Adriana; Aldalene; Jarles; Luciana Matias |

## Chaves master (Disc.12)

4 promoters com `is_master=true` classificados como DEFAULT:

- Juliana DOS SANTOS — CHAVE MASTER — CNPJ 51.457.289 (PE)
- Maria Jose Freire — CHAVE MASTER AL 2 — CNPJ 56.140.658
- Renata Oliveira — CHAVE MASTER AL — CNPJ 48.357.275
- Renata Oliveira — CHAVE MASTER AL 3 — CNPJ 55.867.409

Comportamento: recebem produção via `MASTER_REASSIGNED` do importador. Cálculo neutro (58,33% × `company_received_percent` com teto 5,8%). Quando reatribuídas ao promotor real (futura **Disc.29**), a cascata pega o profile correto.

## D28 backlog

5 promotores produziram em abr/2026 mas **não estão em `promoters`**:
- ANA CLARA, ANA PRISCILA, FABIANA BEZERRA, MONICA PEREIRA, MARIA LETICIA

Provável: cadastrar como ENTRANTE_PADRAO quando entrarem no sistema.

## Próximas etapas Dia 4.5

- **Etapa B**: cascata nova em `/api/calculate/monthly` + UI cascata viva
- **Etapa C**: tabela Seguro Slip ativa a partir de maio/2026
- **Disc.29**: tela de reatribuição master → promotor real
