-- Migration 1B: bbts_conferencia_resolucao — persistencia da baixa da conferencia
-- ADS/BBTS  (frente ADS/BBTS, ressarcimento junho/2026).
--
-- CONTEXTO: a conferencia ADS/BBTS (lib/bbts/conferenciaBbts.ts) e on-the-fly; nao
-- havia onde BAIXAR os contratos SUBPAGAMENTO ressarcidos pela BBTS. Esta tabela
-- guarda a resolucao manual (status, valores devido/pago/ressarcido, data da baixa)
-- e aponta para o lancamento de receita do ressarcimento (receita_lancamento_id).
--
-- GRAO: uma linha por (company_id, proposal_number, competencia_origem) — o mesmo
-- grao da conferencia. RLS default-deny (so service_role) — esta migration LIGA a
-- RLS desta tabela.
--
-- Transacional, idempotente.
-- STATUS: JA EXECUTADA no Studio (2026-07). Este arquivo versiona o que foi aplicado.

begin;

create table if not exists bbts_conferencia_resolucao (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  proposal_number       text not null,
  competencia_origem    date not null,               -- 1o dia do mes de PRODUCAO (ex '2026-06-01')
  status_conferencia    text not null,               -- StatusBbts no momento da baixa (ex 'SUBPAGAMENTO')
  resolucao_status      text not null default 'PENDENTE'
                          constraint bbts_conferencia_resolucao_resolucao_status_check
                          check (resolucao_status = any (array['PENDENTE', 'RESSARCIDO'])),
  valor_devido_avista   numeric,
  valor_pago_avista     numeric,
  valor_ressarcido      numeric,
  data_baixa            date,
  receita_lancamento_id uuid references receita_lancamento_manual(id),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_bbts_conf_resol unique (company_id, proposal_number, competencia_origem)
);

alter table bbts_conferencia_resolucao enable row level security;   -- default-deny: sem policy

comment on table bbts_conferencia_resolucao is
  'Persistencia da resolucao manual da conferencia ADS/BBTS. A conferencia segue on-the-fly; esta tabela guarda a BAIXA de contratos (ex: SUBPAGAMENTO ressarcido pela BBTS) com rastro de valor/data.';

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'bbts_conferencia_resolucao'::regclass order by contype, conname;
--   -- esperado: PK id; FKs company_id->companies(id), receita_lancamento_id->receita_lancamento_manual(id);
--   --           uq_bbts_conf_resol UNIQUE (company_id, proposal_number, competencia_origem);
--   --           resolucao_status_check CHECK (resolucao_status = ANY (ARRAY['PENDENTE','RESSARCIDO']))
--
--   select relrowsecurity, relforcerowsecurity from pg_class
--     where relname = 'bbts_conferencia_resolucao';   -- esperado: true, false
--   select count(*) from pg_policies where tablename = 'bbts_conferencia_resolucao';  -- 0
