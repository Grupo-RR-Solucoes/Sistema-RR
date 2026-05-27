-- FIX-1.E.6.B — Tabela de regras de comissao Promotiva sobre seguro.
-- Fonte unica de calculo para 'insurance_commission_percent' no novo
-- regime TRP35 §188 SLIP (vigente desde abr/2026). ESTOQUE_D0 mantido
-- apenas com janela historica fechada para auditoria retroativa.
--
-- Idempotente: CREATE TABLE/INDEX usam IF NOT EXISTS; os INSERTs
-- declaram ON CONFLICT em (modality, term_min, valid_from) para nao
-- duplicar seeds em re-aplicacoes.

create table if not exists insurance_slip_rules (
  id uuid primary key default gen_random_uuid(),
  modality text not null,                       -- 'SLIP' ou 'ESTOQUE_D0'
  term_min integer not null,                    -- prazo minimo, inclusive
  term_max integer,                             -- prazo maximo inclusive; null = sem teto
  commission_percent numeric(7,5) not null,     -- ex: 0.00150 = 0,15%
  valid_from date not null,
  valid_until date,                             -- null = ainda vigente
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (modality, term_min, valid_from)
);

create index if not exists idx_insurance_slip_rules_lookup
  on insurance_slip_rules(modality, valid_from, valid_until);

-- ============================================================
-- SEED — TRP35 §188 SLIP vigente desde 2026-04-01:
--   0..36  → 0,15%
--   37..60 → 0,25%
--   61..84 → 0,40%
--   85+    → 0,55%
-- ============================================================
insert into insurance_slip_rules
  (modality, term_min, term_max, commission_percent, valid_from, notes)
values
  ('SLIP',  0,   36,   0.00150, '2026-04-01', 'TRP35 §188 - prazo curto'),
  ('SLIP', 37,   60,   0.00250, '2026-04-01', 'TRP35 §188 - prazo medio'),
  ('SLIP', 61,   84,   0.00400, '2026-04-01', 'TRP35 §188 - prazo longo'),
  ('SLIP', 85, null,   0.00550, '2026-04-01', 'TRP35 §188 - prazo extra-longo')
on conflict (modality, term_min, valid_from) do nothing;

-- ============================================================
-- SEED — ESTOQUE_D0 legado, encerrado em 2026-03-31. Mantido para
-- audit retroativa de propostas <= mar/2026; nao gera comissao nova.
-- ============================================================
insert into insurance_slip_rules
  (modality, term_min, term_max, commission_percent, valid_from, valid_until, notes)
values
  ('ESTOQUE_D0', 0, null, 0.00150, '2023-01-01', '2026-03-31',
   'ESTOQUE PRT - encerrado abr/2026')
on conflict (modality, term_min, valid_from) do nothing;
