-- ============================================================
-- FRENTE 2 (TRP por PDF) — Sub-passo 3.1
-- DDL da tabela trp_credit_rules (matriz de remuneracao de credito PF da TRP).
--
-- Consumidor: lib/trp/creditLookup.ts (funcao pura lookupTrpCredit). O lookup
-- compara competencia como STRING 'YYYY-MM-01'; o Supabase devolve a coluna
-- date nesse formato. juros_max/prazo_max = NULL significam limite aberto
-- ("A partir de" / "Acima de"); faixa = NULL significa produto Geral.
--
-- Idempotente: create table/index com IF NOT EXISTS. Nao insere dados (o seed
-- da competencia vem no sub-passo 3.2).
-- ============================================================

create table if not exists trp_credit_rules (
  id           uuid primary key default gen_random_uuid(),
  competencia  date not null,              -- 1o dia da competencia (ex.: '2026-06-01')
  valid_from   date not null,              -- ultimo dia util do mes anterior
  valid_until  date,                       -- penultimo dia util do mes nominal; null = aberto
  tabela_ref   text not null,              -- '1.2'..'3.4'
  produto_desc text,                       -- descricao (metadado, nao usado no match)
  juros_min    numeric(6,2),               -- pontos percentuais; NULL = aberto
  juros_max    numeric(6,2),               -- pontos percentuais; NULL = "A partir de"
  prazo_min    integer,
  prazo_max    integer,                    -- NULL = "Acima de" / "A partir de"
  faixa        integer,                    -- 1..5 | NULL = produto Geral (2.2/2.3/3.4)
  percent      numeric(6,2) not null,      -- pontos percentuais (ex.: 2.44 = 2,44%)
  ticket_min   text,                       -- metadado
  custo_proc   text,                       -- metadado
  created_at   timestamptz not null default now()
);

-- Indice de lookup: o creditLookup filtra por competencia + tabela_ref + faixa.
create index if not exists idx_trp_credit_rules_lookup
  on trp_credit_rules (competencia, tabela_ref, faixa);

-- Conferencia (apos rodar): a tabela deve existir e estar vazia.
-- select count(*) as linhas from trp_credit_rules;
