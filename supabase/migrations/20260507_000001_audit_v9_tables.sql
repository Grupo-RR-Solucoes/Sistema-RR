-- Fase 4.1 — Tabelas de espelhamento do dataset v9 (auditoria humana fechada).
--
-- Fonte: auditorias/RELATORIO_AUDITORIA_FINAL_v9.xlsx (07/Mai/2026, 15 abas).
-- Especificação: stress_test_workspace_local/TRANSFERENCIA_CONHECIMENTO_SISTEMA.md
-- Plano: stress_test_workspace_local/gap_analysis.md §7 Fase 4.1.
--
-- 4 tabelas:
--   audit_v9_avista          (23.884 linhas) — aba "Auditoria À Vista"
--   audit_v9_prt             (12.612 linhas) — aba "Auditoria PRT"
--   audit_v9_enquadramento   (41 linhas)     — aba "Mapa Enquadramento"
--   audit_v9_reconciliacao   (41 × 4 CNPJs)  — aba "Reconciliação Caixa"
--
-- Coluna `trace jsonb` em audit_v9_avista e audit_v9_prt implementa G22+G23
-- (rastreabilidade documental). Será populada na Fase 4.3 (reescrita
-- Camada 2). Por ora fica null nas linhas seedadas direto do XLSX.

-- =========================================================================
-- audit_v9_avista — espelha aba "Auditoria À Vista"
-- =========================================================================

create table if not exists audit_v9_avista (
  contract_number text primary key,
  empresa text not null,
  mes text not null,                              -- ISO YYYY-MM
  tipo text,                                      -- "NOVO", "RENOVACAO"
  produto text,                                   -- "CRÉDITO ADIANTAMENTO", "CONSIGNADO INSS", etc.
  convenio bigint,                                -- código numérico (1640, 1078, 98604, ...)
  tx_juros numeric(8,4),                          -- 1.6500 = 1,65%
  prazo int,
  cat_aplicada text,                              -- "TABELA 1", "TABELA 2", "FAIXA 3", "RUBI", etc.
  cat_devida text,
  valor_liquido numeric(14,2),
  pct_aplicado numeric(7,4),                      -- decimal: 0.0540 = 5,40%
  pct_devido numeric(7,4),
  comissao_paga numeric(14,2),
  comissao_devida numeric(14,2),
  diferenca numeric(14,2),
  status_fase1 text,                              -- StatusFase1 (lib/types/blocos.ts)
  observacoes text,
  bloco text,                                     -- Bloco (preenchido só p/ contratos das abas Sol Reg)
  valor_solicitacao_regularizacao numeric(14,2),  -- só p/ Bloco PEDIDO_FIRME_2.1
  trace jsonb,                                    -- G22+G23: rastreabilidade (Fase 4.3)
  created_at timestamptz not null default now()
);

create index if not exists audit_v9_avista_mes_status_idx
  on audit_v9_avista (mes, status_fase1);
create index if not exists audit_v9_avista_bloco_idx
  on audit_v9_avista (bloco) where bloco is not null;
create index if not exists audit_v9_avista_convenio_idx
  on audit_v9_avista (convenio);

-- =========================================================================
-- audit_v9_prt — espelha aba "Auditoria PRT"
-- =========================================================================

create table if not exists audit_v9_prt (
  contract_number text primary key,
  empresa text not null,
  mes_origem text not null,                       -- ISO YYYY-MM (mês da contratação)
  tipo text,
  produto text,
  convenio bigint,
  tabela text,                                    -- categoria aplicada na época
  base_prt numeric(14,2),
  parc_tot int,
  meses_pagos int,
  prt_pago numeric(14,2),
  prt_listado_nao_pago numeric(14,2),             -- core do bloco 2.2
  excedente_devido numeric(14,2),
  status_fase2 text,                              -- StatusFase2 (PRT_*)
  observacoes text,
  bloco text,
  valor_solicitacao_regularizacao numeric(14,2),  -- só p/ Bloco PEDIDO_FIRME_2.2
  trace jsonb,                                    -- G22+G23
  created_at timestamptz not null default now()
);

create index if not exists audit_v9_prt_mes_status_idx
  on audit_v9_prt (mes_origem, status_fase2);
create index if not exists audit_v9_prt_bloco_idx
  on audit_v9_prt (bloco) where bloco is not null;
create index if not exists audit_v9_prt_convenio_idx
  on audit_v9_prt (convenio);

-- =========================================================================
-- audit_v9_enquadramento — espelha aba "Mapa Enquadramento" (Camada 1)
-- =========================================================================

create table if not exists audit_v9_enquadramento (
  mes text primary key,                           -- ISO YYYY-MM
  cnpjs_ativos int,
  vol_bruto numeric(14,2),
  vol_liquido numeric(14,2),
  qtd_contratos int,
  vol_prestamista numeric(14,2),
  penetracao numeric(7,4),                        -- decimal
  meta_declarada numeric(14,2),
  pct_atingido numeric(7,4),
  regime text,                                    -- Regime (lib/types/blocos.ts)
  cat_devida text,
  cat_aplicada text,
  status_enquadramento text,                      -- StatusFase1
  impacto_estimado numeric(14,2),
  observacoes text,
  created_at timestamptz not null default now()
);

create index if not exists audit_v9_enquadramento_regime_idx
  on audit_v9_enquadramento (regime);

-- =========================================================================
-- audit_v9_reconciliacao — espelha aba "Reconciliação Caixa"
-- =========================================================================
-- Δ_avista e Δ_prt devem ser 0 em todas as linhas. Esta tabela é o critério
-- de aceite da Fase 4.5 (motor TS deve reproduzir as mesmas somas).

create table if not exists audit_v9_reconciliacao (
  id bigserial primary key,
  mes text not null,
  cnpj text not null,
  avista_calculado numeric(14,2),
  avista_caixa numeric(14,2),
  delta_avista numeric(14,2),
  prt_pago_calculado numeric(14,2),
  prt_pago_caixa numeric(14,2),
  delta_prt numeric(14,2),
  status text,
  created_at timestamptz not null default now(),
  unique (mes, cnpj)
);

create index if not exists audit_v9_reconciliacao_mes_idx
  on audit_v9_reconciliacao (mes);
