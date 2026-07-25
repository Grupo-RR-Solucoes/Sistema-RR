-- Migration 2.4 (Fase 1): bbts_sobra_caixa — sobra de caixa da EMPRESA por contrato.
--
-- CONCEITO: a "sobra" e o spread que fica com a EMPRESA (RR) no a-vista da ADS:
--   sobra = devido_avista_bbts (regua BBTS Faixa 4, teto 6% empresa)
--         - base_promotor_trp   (TRP Faixa 3, teto 5,80% promotor)
-- NAO e comissao de promotor (essa vive no PMR). Nunca somar no PMR — mesma
-- disciplina do teto 5,80% x 6%.
--
-- PREVISTA x REALIZADA (dependencia do fechamento):
--   - sobra_prevista (devido - base) existe JA no mes aberto, so pela regua.
--   - sobra_realizada (pago - base) so existe DEPOIS do fechamento, quando chega
--     pago_avista_bbts. Ate la e NULL — NUNCA 0 (0 seria um valor legitimo de
--     sobra; a ausencia de realizado se representa por NULL). O CHECK abaixo trava
--     isso: sobra_realizada nao-null exige pago_avista_bbts nao-null.
--   - A diferenca (prevista - realizada) = devido - pago = o erro de faixa/
--     subpagamento que a conferencia ja acusa.
--
-- Colunas do lado PREVISTO (devido/base/sobra_prevista) sao NULL quando o contrato
-- e FORA_DA_TABELA (sobra indefinida) — nao se inventa numero.
--
-- GRAO: (company_id, proposal_number, competencia) UNIQUE — mesmo grao da
-- conferencia. FK opcional para bbts_conferencia_resolucao liga previsto ->
-- realizado -> recebido quando o contrato virou subpagamento/ressarcimento.
--
-- Calculada por lib/bbts/sobraCaixa.ts (FONTE UNICA — Fase 1). A materializacao
-- (uma linha por contrato no fechamento) e a Fase 2, acoplada ao
-- monthlyClosingImport. Esta migration so cria a estrutura.
--
-- RLS default-deny (so service_role), como bbts_prt_parcelas / bbts_conferencia_resolucao.
-- Transacional, idempotente.
-- STATUS: NAO EXECUTADA. Rodar no Studio.

begin;

create table if not exists bbts_sobra_caixa (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id),
  proposal_number          text not null,
  competencia              date not null,               -- 1o dia do mes de PRODUCAO (ex '2026-07-01')
  devido_avista_bbts       numeric,                     -- regua BBTS F4, teto 6% empresa (NULL se FORA_DA_TABELA)
  base_promotor_trp        numeric,                     -- TRP F3, teto 5,80% promotor (NULL se FORA_DA_TABELA)
  sobra_prevista           numeric,                     -- devido - base (NULL se algum lado indefinido)
  pago_avista_bbts         numeric,                     -- so no fechamento; NULL no mes aberto
  sobra_realizada          numeric,                     -- pago - base; NULL ate o fechamento (NUNCA 0 como sentinela)
  conferencia_resolucao_id uuid references bbts_conferencia_resolucao(id),  -- liga previsto->realizado->recebido
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint uq_bbts_sobra_caixa unique (company_id, proposal_number, competencia),
  -- realizada so pode existir se houver pago (senao e mes aberto = indefinido, NULL)
  constraint bbts_sobra_caixa_realizada_requires_pago
    check (sobra_realizada is null or pago_avista_bbts is not null)
);

alter table bbts_sobra_caixa enable row level security;   -- default-deny: sem policy

-- Leitura por competencia (e por contrato no drill-down).
create index if not exists idx_bbts_sobra_caixa_comp
  on bbts_sobra_caixa (company_id, competencia);
create index if not exists idx_bbts_sobra_caixa_contrato
  on bbts_sobra_caixa (proposal_number);

comment on table bbts_sobra_caixa is
  'ADS/BBTS: sobra de caixa da EMPRESA (spread) por contrato/competencia. '
  'sobra = devido a-vista BBTS (F4, teto 6%) menos a base do promotor (TRP F3, '
  'teto 5,80%). PREVISTA existe no mes aberto (regua); REALIZADA (pago - base) so '
  'apos o fechamento (pago_avista_bbts nao-null). NAO e comissao de promotor: nunca '
  'somar no PMR. Calculada por lib/bbts/sobraCaixa.ts (fonte unica).';

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'bbts_sobra_caixa'::regclass order by contype, conname;
--   -- esperado: PK id; FKs company_id->companies(id),
--   --           conferencia_resolucao_id->bbts_conferencia_resolucao(id);
--   --           uq_bbts_sobra_caixa UNIQUE (company_id, proposal_number, competencia);
--   --           bbts_sobra_caixa_realizada_requires_pago CHECK
--   --             (sobra_realizada IS NULL OR pago_avista_bbts IS NOT NULL)
--
--   select relrowsecurity, relforcerowsecurity from pg_class
--     where relname = 'bbts_sobra_caixa';   -- esperado: true, false
--   select count(*) from bbts_sobra_caixa;  -- esperado: 0 (Fase 2 materializa)
