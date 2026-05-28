-- FIX-1.E.6.D — Registra encerramento explicito de ESTOQUE_D0 em abr/2026.
--
-- Decisao Diego: ESTOQUE_D0 com contract_date >= 2026-04-01 nao deve
-- gerar comissao nova. Em vez de tratar em codigo (guard na cascata),
-- modelamos como uma regra com commission_percent = 0.
--
-- Resultado: a cascata TRP35 vai cobrir essas 43 propostas em abr/2026
-- com amount=0 (source = 'TRP35_ESTOQUE_D0'), em vez de cair pra legacy
-- e gerar comissao espuria.
--
-- Idempotente: UNIQUE (modality, term_min, valid_from) + ON CONFLICT.
-- A linha 2023-01-01..2026-03-31 (criada em PRE-B) NAO e tocada.

insert into insurance_slip_rules
  (modality, term_min, term_max, commission_percent, valid_from, valid_until, notes)
values
  ('ESTOQUE_D0', 0, null, 0.00000, '2026-04-01', null,
   'ESTOQUE PRT encerrado abr/2026 - sem comissao nova (TRP35 §188 SLIP assume)')
on conflict (modality, term_min, valid_from) do nothing;
