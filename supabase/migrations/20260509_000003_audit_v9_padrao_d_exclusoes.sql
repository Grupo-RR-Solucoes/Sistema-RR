-- Fase 4.3 (Camada 2 À Vista) — registro central de contratos PADRÃO D.
--
-- Origem: descoberta CHECKPOINT B (re-run após decisões A.1+B.2+C-mirror) —
-- 7 contratos com status_fase1='SUBPAGAMENTO' em audit_v9_avista que v9
-- humana EXCLUIU de Sol Reg 2.1 (bloco=null, valor_solicitacao_regularizacao=null).
-- Esses contratos têm subpagamento numericamente correto (dif < 0, vlLiq > 0,
-- pct_aplicado < pct_devido) mas v9 humana decidiu não cobrar.
--
-- Distribuição dos 7 contratos:
--   2024-07 + 2024-09 (4 contratos): meses DIVERGENTE_ENQUADRAMENTO (OPP099).
--     v9 humana parece ter calculado pct_avista_esperado usando cat_aplicada
--     (TABELA 1, 5,40%) em vez de cat_devida (TABELA 2, 6,00%). Inconsistência
--     interna v9 com sua própria Camada 1 — bug NÃO documentado em v9 §6/9.
--     motivo_exclusao='INCONSISTENCIA_CAMADA1_V9'.
--   2025-07 + 2025-08 + 2025-09 (3 contratos): regime VOLUME, cat_aplicada =
--     cat_devida, pct_aplicado < teto sem critério publicado. v9 humana parece
--     ter aplicado tolerância silenciosa não-publicada (~1-3 p.p. abaixo).
--     motivo_exclusao='TOLERANCIA_SILENCIOSA_VOLUME'.
--
-- Decisão Diego CHECKPOINT B (D.1): motor TS espelha v9 byte-a-byte para
-- estes 7 contratos consultando esta tabela. Soma R$ 60.040,89 EXATOS é
-- preservada (sem motor incluiria os 7 e somaria R$ 60.192,90).
--
-- DESCOBERTA CRÍTICA — Fase 4.3 (gap_analysis.md):
--   No subgrupo INCONSISTENCIA_CAMADA1_V9, v9 humana violou sua própria
--   Camada 1. Pode haver dezenas a centenas de contratos com mesmo bug não
--   detectados na amostra 100 — investigar query global Fase 4.4.
--
-- Pendências Fase 4.4:
--   1. Investigar batch full por contratos análogos não detectados na amostra
--      (queries especulativas adicionais em CHECKPOINT C — Refinamento 3a).
--   2. Decidir se motor mantém mirror v9 (espelha bug interno) OU implementa
--      lookup correto via Cat_Devida (rejeita exclusões inconsistentes,
--      potencialmente cobrando contratos legítimos não-cobrados pela v9).
--   3. No caso TOLERANCIA_SILENCIOSA_VOLUME, investigar se há regra
--      Promotiva ou critério de comercialização Diego que justifique a
--      tolerância (~1-3 p.p. abaixo do teto).
--
-- Risco se removido sem revisão: motor diverge do email enviado 07/05/2026
-- (R$ 107.622,76) que NÃO incluiu esses 7 contratos. Defesa diante da
-- Promotiva exige consistência byte-a-byte com a auditoria humana enviada.

create table if not exists audit_v9_padrao_d_exclusoes (
  contract_number text not null,
  mes text not null,                            -- ISO YYYY-MM
  produto text,
  cat_aplicada text,
  cat_devida text,
  pct_aplicado numeric(8,6),                    -- decimal: 0.054000 = 5,40%
  pct_devido numeric(8,6),
  diferenca numeric(14,2),                      -- comissao_paga - comissao_devida (sinal v9)
  obs_v9 text,                                  -- conteúdo de audit_v9_avista.observacoes
  motivo_exclusao text not null,                -- 'INCONSISTENCIA_CAMADA1_V9' | 'TOLERANCIA_SILENCIOSA_VOLUME' | 'OUTRO'
  inserted_at timestamptz not null default now(),
  primary key (contract_number, mes),
  constraint audit_v9_padrao_d_exclusoes_motivo_chk
    check (motivo_exclusao in (
      'INCONSISTENCIA_CAMADA1_V9',
      'TOLERANCIA_SILENCIOSA_VOLUME',
      'OUTRO'
    ))
);

create index if not exists audit_v9_padrao_d_exclusoes_mes_idx
  on audit_v9_padrao_d_exclusoes (mes);
create index if not exists audit_v9_padrao_d_exclusoes_motivo_idx
  on audit_v9_padrao_d_exclusoes (motivo_exclusao);

comment on table audit_v9_padrao_d_exclusoes is
  'Fase 4.3 - Contratos que v9 humana classifica como SUBPAGAMENTO mas exclui de Sol Reg 2.1 (bloco=null). Motor TS espelha v9 nesta fase consultando esta tabela. Pendencia Fase 4.4: investigar criterio de exclusao v9 e decidir se motor mantem mirror ou implementa logica propria.';

comment on column audit_v9_padrao_d_exclusoes.motivo_exclusao is
  'INCONSISTENCIA_CAMADA1_V9 = v9 calculou pct_esperado pela cat_aplicada em vez de cat_devida (bug interno v9). TOLERANCIA_SILENCIOSA_VOLUME = regime VOLUME, pct < teto, v9 nao cobrou sem regra publicada. OUTRO = motivo fora desses 2 (investigar antes de adicionar).';

comment on column audit_v9_padrao_d_exclusoes.diferenca is
  'Sinal v9: comissao_paga - comissao_devida. Negativo = subpagamento. Mantem byte-a-byte audit_v9_avista.diferenca.';
