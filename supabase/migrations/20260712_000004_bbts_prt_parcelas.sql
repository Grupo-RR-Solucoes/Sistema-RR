-- Migration: Auditoria ADS/BBTS — 1B: parcelas do PAGAMENTO PRT  (2026-07-12)
--
-- O PRT é a 2a PERNA do pagamento da BBTS. Pela tabela dela (pág. 8): o recebimento
-- à vista é capado em 6% e o EXCEDENTE é pago A PRAZO — "diferença percentual a
-- receber dividido pelo prazo da operação". O PDF de fechamento traz a seção
-- "Propostas do PAGAMENTO PRT" (contrato / data / nº da parcela / valor / qtde),
-- que hoje é simplesmente DESCARTADA. Sem ela, a auditoria da ADS só enxerga
-- metade do que a BBTS pagou.
--
-- POR QUE TABELA PRÓPRIA (e não monthly_closing_entries):
--   monthly_closing_entries é o universo da PROMOTIVA/RR. O ciclo PRT do RR
--   (lib/prtCiclo.ts) soma as linhas PRT por ano/mês SEM filtrar empresa — jogar a
--   ADS lá dentro contaminaria os números do RR na hora. Tabela separada = raio de
--   explosão zero.
--
-- GRÃO: uma linha por (empresa, contrato, competência, nº da parcela). Os contratos
-- desta seção são de competências ANTIGAS (estão pagando o diferido de meses
-- passados) — podem nem existir em daily_production_records. Por isso NÃO há FK
-- para produção: a chave é o número do contrato.
--
-- Aditiva, transacional, idempotente. RLS default-deny (só service_role).
-- STATUS: NÃO EXECUTADA. Rodar no Studio.

begin;

create table if not exists bbts_prt_parcelas (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  competencia     date not null,               -- 1o dia do mês do fechamento ('2026-06-01')
  proposal_number text not null,               -- nº do contrato (casa com daily_production_records quando existir)
  n_parcela       integer not null,            -- nº da parcela PRT paga nesta competência
  valor_parcela   numeric not null,            -- o que a BBTS pagou nesta parcela
  qt_parcela      integer,                     -- total de parcelas (o PDF traz '#N/D' em algumas)
  data_pagamento  date,                        -- data que o PDF declara para a parcela
  source_filename text,
  created_at      timestamptz not null default now(),
  constraint uq_bbts_prt_parcelas unique (company_id, proposal_number, competencia, n_parcela)
);

alter table bbts_prt_parcelas enable row level security;   -- default-deny: sem policy

-- Leitura da auditoria: por competência (e por contrato, no drill-down).
create index if not exists idx_bbts_prt_parcelas_comp
  on bbts_prt_parcelas (company_id, competencia);
create index if not exists idx_bbts_prt_parcelas_contrato
  on bbts_prt_parcelas (proposal_number);

comment on table bbts_prt_parcelas is
  'ADS/BBTS: parcelas do PAGAMENTO PRT (o excedente do teto de 6% que a BBTS paga a '
  'prazo), lidas da secao "Propostas do PAGAMENTO PRT" do PDF de fechamento. E o lado '
  'PAGO da perna diferida da auditoria da ADS. Uma linha por contrato/competencia/parcela. '
  'NAO usa monthly_closing_entries (universo da Promotiva) de proposito.';

commit;

-- ============================================================
-- Verificação pós-execução
-- ============================================================
--   select count(*) from bbts_prt_parcelas;   -- esperado: 0 (nada importado ainda)
--
--   -- após o reimport do fechamento de junho (8 parcelas, Sigma 7,01):
--   select competencia, count(*) as parcelas, sum(valor_parcela) as total
--     from bbts_prt_parcelas group by competencia order by competencia;
--
--   select relrowsecurity from pg_class where relname='bbts_prt_parcelas';  -- true
--   select count(*) from pg_policies where tablename='bbts_prt_parcelas';   -- 0
