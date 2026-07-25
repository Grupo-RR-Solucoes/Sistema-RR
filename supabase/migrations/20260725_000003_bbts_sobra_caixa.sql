-- Migration 2.4 (Fase 1): bbts_sobra_caixa — sobra de caixa da EMPRESA por contrato.
--
-- CONCEITO: a "sobra" e o spread que fica com a EMPRESA (RR) na ADS. Ela tem DOIS
-- lados, porque a BBTS paga em duas pernas (a-vista + PRT/diferido) e o promotor
-- tambem (a-vista capado em 5,80% + o excedente que vira diferido):
--   sobra_avista = devido_avista_bbts (BBTS F4, teto 6%) - base_avista_promotor (TRP F3, teto 5,80%)
--   sobra_prt    = devido_prt_bbts    (diferido BBTS)     - base_prt_promotor   (diferido promotor)
--   sobra_total  = sobra_avista + sobra_prt   <- METRICA CANONICA de caixa da empresa
--
-- POR QUE O TOTAL (e nao so a-vista): medir so a-vista engana. Ex. real (jul/2026,
-- contrato 220437923, PRIVADO 2,98%/36): a BBTS reembolsa so 2,55% A-VISTA mas o
-- promotor recebe 5,80% a-vista -> sobra_avista = -R$ 422 (a empresa banca). O
-- excedente volta no PRT: sobra_prt positiva, sobra_total perto de zero/positiva.
-- E timing, nao prejuizo. Por isso a coluna que as telas leem e sobra_total; a-vista
-- e prt sao DECOMPOSICAO.
--
-- NAO e comissao de promotor (essa vive no PMR). Nunca somar no PMR.
--
-- PREVISTA x REALIZADA (dependencia do fechamento):
--   - sobra_avista/sobra_prt/sobra_total existem JA no mes aberto (so pela regua).
--   - pago_avista_bbts / pago_prt_bbts e sobra_realizada_total so existem DEPOIS do
--     fechamento. Ate la sao NULL — NUNCA 0 (0 e valor legitimo; a ausencia de
--     realizado se representa por NULL). O CHECK trava: realizada nao-null exige
--     pago_avista_bbts nao-null.
--
-- Colunas de valor sao NULL quando o contrato e FORA_DA_TABELA (sobra indefinida) —
-- nao se inventa numero.
--
-- GRAO: (company_id, proposal_number, competencia) UNIQUE — mesmo grao da
-- conferencia. FK opcional para bbts_conferencia_resolucao liga previsto ->
-- realizado -> recebido quando o contrato virou subpagamento/ressarcimento.
--
-- Calculada por lib/bbts/sobraCaixa.ts (FONTE UNICA). A materializacao (uma linha
-- por contrato no fechamento) e a Fase 2, acoplada ao monthlyClosingImport. Esta
-- migration so cria a estrutura.
--
-- RLS default-deny (so service_role). Transacional, idempotente.
-- STATUS: NAO EXECUTADA. Rodar no Studio.

begin;

create table if not exists bbts_sobra_caixa (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references companies(id),
  proposal_number          text not null,
  competencia              date not null,               -- 1o dia do mes de PRODUCAO (ex '2026-07-01')

  -- lado A-VISTA
  devido_avista_bbts       numeric,                     -- regua BBTS F4, teto 6% (conferencia.devidoAvista); NULL se FORA
  base_avista_promotor     numeric,                     -- TRP F3 pos-teto 5,80% (bbtsMonthly.proposta.avista); NULL se FORA
  sobra_avista             numeric,                     -- devido_avista - base_avista

  -- lado PRT / DIFERIDO
  devido_prt_bbts          numeric,                     -- diferido BBTS (conferencia.devidoPrtTotal); NULL se FORA
  base_prt_promotor        numeric,                     -- diferido promotor, o que passa de 5,80% (bbtsMonthly.proposta.diferido)
  sobra_prt                numeric,                     -- devido_prt - base_prt

  -- TOTAL (metrica canonica de caixa da empresa)
  sobra_total              numeric,                     -- sobra_avista + sobra_prt

  -- REALIZADO (so no fechamento; NULL no mes aberto, nunca 0)
  pago_avista_bbts         numeric,                     -- bbts_pag_avista do fechamento
  pago_prt_bbts            numeric,                     -- PRT pago (bbts_prt_parcelas) do fechamento
  sobra_realizada_total    numeric,                     -- (pago_avista+pago_prt) - (base_avista+base_prt); NULL ate o fechamento

  conferencia_resolucao_id uuid references bbts_conferencia_resolucao(id),  -- liga previsto->realizado->recebido
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint uq_bbts_sobra_caixa unique (company_id, proposal_number, competencia),
  -- realizada so pode existir se houver pago do fechamento (senao e mes aberto = NULL)
  constraint bbts_sobra_caixa_realizada_requires_pago
    check (sobra_realizada_total is null or pago_avista_bbts is not null)
);

alter table bbts_sobra_caixa enable row level security;   -- default-deny: sem policy

-- Leitura por competencia (e por contrato no drill-down).
create index if not exists idx_bbts_sobra_caixa_comp
  on bbts_sobra_caixa (company_id, competencia);
create index if not exists idx_bbts_sobra_caixa_contrato
  on bbts_sobra_caixa (proposal_number);

comment on table bbts_sobra_caixa is
  'ADS/BBTS: sobra de caixa da EMPRESA (spread) por contrato/competencia, em DUAS '
  'pernas. sobra_avista = devido a-vista BBTS (F4, teto 6%) menos base a-vista do '
  'promotor (TRP F3, teto 5,80%); sobra_prt = diferido BBTS menos diferido promotor; '
  'sobra_total = sobra_avista + sobra_prt e a metrica canonica (medir so a-vista '
  'engana: excedente a-vista volta no PRT). PREVISTA existe no mes aberto (regua); '
  'REALIZADA (pago - base) so apos o fechamento. NAO e comissao de promotor: nunca '
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
--   --             (sobra_realizada_total IS NULL OR pago_avista_bbts IS NOT NULL)
--
--   select relrowsecurity, relforcerowsecurity from pg_class
--     where relname = 'bbts_sobra_caixa';   -- esperado: true, false
--   select count(*) from bbts_sobra_caixa;  -- esperado: 0 (Fase 2 materializa)
