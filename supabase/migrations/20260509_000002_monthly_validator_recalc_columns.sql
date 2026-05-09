-- Fase 4.2 — Refinamento ETAPA 2A
--
-- Adiciona em monthly_validator_snapshot 4 colunas para registrar valores
-- recalculados a partir das abas A Vista dos XLSX mensais Promotiva. As
-- colunas dão à Camada 1 fonte de verdade independente do Validador/Resumo
-- (que pode estar bugado em meses específicos — vide Dez/2023 com
-- pct_penetracao snapshot=23,10% reconhecido pela auditoria humana v9 como
-- corrompido).
--
-- ESCOPO SELETIVO:
--   pct_penetracao_recalc / volume_prestamista_recalc são populadas APENAS
--   em meses ELEGÍVEIS — ou seja, onde a penetração entra na decisão de
--   Cat_Devida (regra OPP099). Em qualquer outro mês, ficam NULL com
--   entrada explicativa em raw_data._diagnostico.penetracao_recalc_motivo.
--
--   Critério de elegibilidade (avaliado em scripts/seed_validator.cjs):
--     1. Regime do mês ∈ {META_2_NIVEIS_MATRIZ_TAXA_PRAZO, META_2_NIVEIS, META_4_NIVEIS}
--     2. mes >= 2023-09 (vigência OPP099)
--     3. pct_meta_recalc ∈ [0.9000, 1.0000)
--
--   Calcular penetração em meses não-elegíveis é trabalho desperdiçado: o
--   número não muda Cat_Devida (regime VOLUME → INDETERMINADO; meta>=100% →
--   TABELA 2 direto; meta<90% → TABELA 1 direto).
--
-- ESCOPO COMPLETO:
--   vol_liquido_avista_recalc_xlsx e delta_vol_liquido_xlsx_vs_v9 são
--   populadas em TODOS os 41 meses — servem como cruzamento de consistência
--   entre o XLSX mensal (fonte primária Promotiva) e audit_v9_avista
--   (snapshot do auditor humano v9). Delta > threshold sinaliza mês onde
--   a v9 e o XLSX divergem materialmente.
--
-- IDEMPOTÊNCIA: ALTER TABLE ADD COLUMN IF NOT EXISTS — esta migration pode
-- ser re-aplicada sem efeito colateral. Tabela já existe (criada pela
-- migration 20260509_000001_monthly_validator_snapshot.sql aplicada no
-- CHECKPOINT A).

alter table monthly_validator_snapshot
  add column if not exists pct_penetracao_recalc numeric(8,4),
  add column if not exists volume_prestamista_recalc numeric(14,2),
  add column if not exists vol_liquido_avista_recalc_xlsx numeric(14,2),
  add column if not exists delta_vol_liquido_xlsx_vs_v9 numeric(14,2);

comment on column monthly_validator_snapshot.pct_penetracao_recalc is
  'Penetração Prestamista recalculada da aba A Vista do XLSX mensal: SUM(VALOR LÍQUIDO WHERE VALOR SEGURO > 0) / SUM(VALOR LÍQUIDO), filtrado ex-SRCC e CNPJs ativos. Decimal (1.0 = 100%). NULL = mês não-elegível (regime não-META, ou pct_meta_recalc fora da faixa promocional [0,90; 1,00) onde OPP099 dispara). Calcular nos demais meses não muda Cat_Devida.';

comment on column monthly_validator_snapshot.volume_prestamista_recalc is
  'Numerador do pct_penetracao_recalc: SUM(VALOR LÍQUIDO de contratos com seguro), ex-SRCC. NULL nos mesmos meses que pct_penetracao_recalc.';

comment on column monthly_validator_snapshot.vol_liquido_avista_recalc_xlsx is
  'Soma de VALOR LÍQUIDO da aba A Vista do XLSX mensal (todos os CNPJs ativos, ex-SRCC). Populado em TODOS os 41 meses. Comparar com sum(audit_v9_avista.valor_liquido) ex-SRCC para auditoria de consistência v9 vs XLSX.';

comment on column monthly_validator_snapshot.delta_vol_liquido_xlsx_vs_v9 is
  'Delta = vol_liquido_avista_recalc_xlsx - SUM(audit_v9_avista.valor_liquido) ex-SRCC. Em R$. |delta| > threshold (~R$ 0,01) sinaliza divergência entre o XLSX original e a auditoria humana v9 — flagged em raw_data._diagnostico.flagged_v9_consistency.';
