-- FIX-3.SEGURO — Schema (base_field) + 4 regras vigentes corretas.
--
-- Reverte FIX-1.E.6.D (ESTOQUE_D0 cravado em 0% para abr/2026+) e
-- valid_from errado de SLIP (estava 2026-04-01; correto é 2026-03-01).
--
-- Origem das regras (validado empiricamente em 40 meses de fechamentos
-- — Tarefas M/O/P/Q, 19.522 CASH entries; cross-check com daily abr/2026):
--
--   ESTOQUE_D0 pré-mar/2026: prêmio × 2,5% — paga MENSAL fracionado em N
--     parcelas; motor RR registra TOTAL no mês 1 (reconciliação financeira
--     mensal é tema separado).
--   ESTOQUE_D0 mar/2026+:    gross × 0,15% — parcela única, mesma TAXA do
--     ESTOQUE legado mas mudou para pagamento único. Confirmado em 48
--     contratos novos da Tarefa Q (100% bate).
--   SLIP pré-mar/2026:       prêmio × 2,5% — parcela única. Confirmado em
--     233 entries (jan+fev/2026) da Tarefa O, 227 batem.
--   SLIP mar/2026+ (TRP §188): gross × pct_faixa(Parcelas), parcela única.
--     Faixas: 0-36=0,15% | 37-60=0,25% | 61-84=0,40% | 85+=0,55%.
--     Confirmado em 227 entries (mar+abr/2026) da Tarefa O, 222 batem.
--
-- BASE de cálculo (campo base_field):
--   'premio' = insurance_value (prêmio do seguro)
--   'gross'  = gross_value (valor financiado bruto)
--
-- PRAZO usado no lookup: PARCELAS do raw_payload (regra empírica J/K).
--   Helper getPrazoTrp resolve isso (3100/3101 → Prazo, demais → Parcelas).
--   Para seguro, NUNCA é 3100/3101, então sempre cai em Parcelas.
--
-- DECISAO Diego (Fase 3):
--   - Sem TRP match → proposta marcada VERMELHO (não comissionar; não
--     chutar fallback legacy).
--   - SEM override manual de seguro — só TRP + tabela de remuneração
--     (penetração na Etapa E).

begin;

-- ============================================================
-- 1) SCHEMA — adicionar base_field
-- ============================================================
alter table public.insurance_slip_rules
  add column if not exists base_field text not null default 'gross';

-- check constraint idempotente
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'insurance_slip_rules_base_field_check'
      and conrelid = 'public.insurance_slip_rules'::regclass
  ) then
    alter table public.insurance_slip_rules
      add constraint insurance_slip_rules_base_field_check
      check (base_field in ('gross', 'premio'));
  end if;
end $$;

-- ============================================================
-- 2) DADOS — DELETE tudo (regras anteriores erradas) + INSERT das 4 regras
-- ============================================================
delete from public.insurance_slip_rules;

-- ESTOQUE_D0 pré-mar/2026 — prêmio × 2,5%
insert into public.insurance_slip_rules
  (modality, term_min, term_max, commission_percent, base_field, valid_from, valid_until, notes)
values
  ('ESTOQUE_D0', 0, null, 0.02500, 'premio', '2023-01-01', '2026-02-28',
   'Estoque legado — prêmio × 2,5% (mensal). Motor RR registra TOTAL no mês 1. Tarefa O 199799037+199896033+199117625 = 100% bate.');

-- ESTOQUE_D0 mar/2026+ — gross × 0,15%
insert into public.insurance_slip_rules
  (modality, term_min, term_max, commission_percent, base_field, valid_from, valid_until, notes)
values
  ('ESTOQUE_D0', 0, null, 0.00150, 'gross', '2026-03-01', null,
   'Estoque novo — gross × 0,15% (parcela única). Reverte FIX-1.E.6.D (0%). Tarefa Q: 48 contratos novos 100% bate.');

-- SLIP pré-mar/2026 — prêmio × 2,5%
insert into public.insurance_slip_rules
  (modality, term_min, term_max, commission_percent, base_field, valid_from, valid_until, notes)
values
  ('SLIP', 0, null, 0.02500, 'premio', '2023-01-01', '2026-02-28',
   'SLIP antigo — prêmio × 2,5% (parcela única). Tarefa O jan/2026: 127/129 bate; fev/2026: 100/104.');

-- SLIP mar/2026+ — TRP §188 (4 faixas por PARCELAS)
-- ATENÇÃO: valid_from = 2026-03-01 (corrigido de 2026-04-01 errado).
insert into public.insurance_slip_rules
  (modality, term_min, term_max, commission_percent, base_field, valid_from, valid_until, notes)
values
  ('SLIP',  0,  36,  0.00150, 'gross', '2026-03-01', null,
   'TRP §188 - prazo curto (0-36 parcelas) — 0,15%.'),
  ('SLIP', 37,  60,  0.00250, 'gross', '2026-03-01', null,
   'TRP §188 - prazo médio (37-60 parcelas) — 0,25%.'),
  ('SLIP', 61,  84,  0.00400, 'gross', '2026-03-01', null,
   'TRP §188 - prazo longo (61-84 parcelas) — 0,40%.'),
  ('SLIP', 85, null, 0.00550, 'gross', '2026-03-01', null,
   'TRP §188 - prazo extra-longo (85+ parcelas) — 0,55%.');

commit;

-- Resultado esperado (7 linhas):
-- modality    | term_min | term_max | pct      | base_field | valid_from | valid_until
-- ESTOQUE_D0  | 0        | null     | 0.02500  | premio     | 2023-01-01 | 2026-02-28
-- ESTOQUE_D0  | 0        | null     | 0.00150  | gross      | 2026-03-01 | null
-- SLIP        | 0        | null     | 0.02500  | premio     | 2023-01-01 | 2026-02-28
-- SLIP        | 0        | 36       | 0.00150  | gross      | 2026-03-01 | null
-- SLIP        | 37       | 60       | 0.00250  | gross      | 2026-03-01 | null
-- SLIP        | 61       | 84       | 0.00400  | gross      | 2026-03-01 | null
-- SLIP        | 85       | null     | 0.00550  | gross      | 2026-03-01 | null
