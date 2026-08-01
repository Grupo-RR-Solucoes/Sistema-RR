-- Migration: Remuneracao de lideranca — regua versionada (2026-08-01)
--
-- Objetivo: tirar a remuneracao de supervisor/gerente_regional do numero fixo
-- em codigo e coloca-la numa tabela VERSIONADA POR VIGENCIA, no mesmo padrao de
-- trp_rule_versions (20260701_000010): a regra e dado, nao constante.
--
-- HOJE O NUMERO ESTA EM CODIGO. lib/comissaoGestao.ts:27:
--     export const PERCENTUAL_COMISSAO_GESTAO = 0.001;
-- com o cabecalho em :4-6 dizendo "A mesma regua vale para supervisor e para
-- gerente_regional". Esta migration NAO muda o comportamento: o seed da regua
-- ANTIGA reproduz exatamente esse 0,10% para os DOIS cargos (decisao Diego,
-- 01/08/2026, depois de a divergencia ter sido medida e reportada).
--
-- DUAS REGUAS, DUAS VIGENCIAS
--
--   ate 2026-07  (base PRODUCAO_LIQUIDA)
--     supervisor        aliquota 0,10%   piso 0
--     gerente_regional  aliquota 0,10%   piso 0
--     Pagamento = aliquota x producao liquida da rede. Sem piso — o piso 0
--     deixa o max() da formula unica cair sempre no termo da aliquota.
--
--   de 2026-08 em diante  (base AVISTA_CREDITO_PF)
--     supervisor        aliquota 2,50%   piso 0,07%
--     gerente_regional  aliquota 3,50%   piso 0,10%
--     Pagamento = MAIOR entre (aliquota x comissao a vista da base) e
--                             (piso x producao liquida da base).
--
-- O QUE E "A BASE" NA REGUA NOVA — medido em monthly_closing_entries de
-- jun/2026 (consulta paginada COM order by id; sem order o range() do PostgREST
-- repete/pula linhas e o total sai errado — aconteceu na primeira medicao):
--
--   entry_type | sheet_name            linhas         comissao            liquido
--   CASH       | 'A Vista '               707    R$ 187.848,62    R$ 5.346.031,61
--   INSURANCE  | 'A Vista '               194      R$ 4.372,62    R$ 1.059.329,56
--   INSURANCE  | 'Seguro'                  30       R$ -901,24       R$ 20.656,51
--   PRT        | 'PRT'                  10238     R$ 54.479,03            R$ 0,00
--   CONSORCIO  | 'CONSORCIO'               37     R$ 11.903,05            R$ 0,00
--   CREDIT     | 'Crédito'                  8      R$ 8.989,06        R$ 8.989,06
--   DEBIT      | 'Débito'                   2       R$ -250,21         R$ -250,21
--
-- DOIS RECORTES, NAO UM:
--   comissao da base = CASH + INSURANCE|'A Vista '  = R$ 192.221,24
--   liquido  da base = CASH APENAS                  = R$ 5.346.031,61
--
-- O LIQUIDO NAO SOMA OS DOIS. As 194 linhas de prestamista sao o subconjunto
-- SEGURADO dos MESMOS contratos das 707 de credito — medido: 194 de 194 tem
-- contrato tambem em CASH, ZERO sem par. Somar conta a mesma producao 2x.
--
-- O erro inflava o liquido em 19,8153% e derrubava a TRP implicita:
--   comissao / (CASH + seguro) = 3,0009%   errado
--   comissao / CASH            = 3,5956%   confere com os 3,5974% do
--                                          fechamento PE (desvio 0,0018 p.p.)
--
-- Isso importa PARA O PISO: o piso de 0,07% so deve disparar com TRP abaixo de
-- 0,0007/0,025 = 2,80%. Com o liquido inflado o gatilho ia para 3,355%, e
-- maio/2026 fechou em 3,16% — o piso dispararia indevidamente.
--
-- PRT, CONSORCIO, CREDIT (bonus), DEBIT, BBCAP e CONTA_CORRENTE ficam FORA dos
-- dois recortes.
--
-- ATENCAO AO DADO: sheet_name da aba a vista e 'A Vista ' COM ESPACO NO FIM.
-- Comparacao literal falha; o helper normaliza (NFD + trim + upper).
--
-- CANCELAMENTO DE SEGURO — definido na regua, NAO aplicado no nivel de rede.
-- Numero reconciliado em 01/08/2026: 30 linhas / -R$ 901,24, confirmado por DUAS
-- execucoes com order by id e ids identicos. Uma medicao anterior falou em 51
-- linhas / -R$ 1.603,27 — era paginacao sem order, e esta descartada.
-- As 30 linhas de INSURANCE|'Seguro' de jun/2026 tem j_key NULO em 30 de 30:
-- sem chave J nao ha promotor, logo nao ha supervisor. Ratear seria distribuir
-- a rede um valor que nao e dela. Decisao Diego (01/08/2026): nao descontar no
-- nivel de rede; o desconto continua so no consolidado do grupo, onde ja e
-- aplicado. A coluna desconta_cancelamento_seguro registra a INTENCAO da regua
-- para quando a atribuicao existir.
--
-- SRCC: monthly_closing_entries NAO tem is_srcc_restricted (ver o create table
-- em 20260420_000001_rr_foundation.sql:339-361). A coluna vive em
-- daily_production_records (:109). A exclusao e feita na aplicacao, por join de
-- numero de operacao/contrato — nao da para expressar aqui.
--
-- Seguranca / idempotencia: transacional; create table if not exists; o seed usa
-- on conflict do nothing sobre a chave natural. Rodar 2x e seguro.

begin;

-- ============================================================
-- 1) leadership_rule_versions — uma linha por CARGO e por VIGENCIA
-- ============================================================
create table if not exists leadership_rule_versions (
  id                            uuid primary key default gen_random_uuid(),
  cargo                         text not null,
  aliquota                      numeric(8,6) not null,
  piso                          numeric(8,6) not null default 0,
  -- Qual base a ALIQUOTA multiplica. O piso multiplica SEMPRE a producao
  -- liquida da base. 'PRODUCAO_LIQUIDA' = regua antiga (aliquota tambem sobre
  -- producao); 'AVISTA_CREDITO_PF' = regua nova (aliquota sobre a comissao).
  base_calculo                  text not null,
  -- Vigencia por COMPETENCIA (1o dia do mes), nao por data-calendario: a regra
  -- vale para a competencia inteira. fim NULO = vigente ate segunda ordem.
  competencia_inicio            date not null,
  competencia_fim               date,
  -- Registra a intencao da regua mesmo onde o dado ainda nao permite aplicar.
  desconta_cancelamento_seguro  boolean not null default false,
  notes                         text,
  created_at                    timestamptz not null default now(),
  constraint ck_leadership_cargo
    check (cargo in ('supervisor', 'gerente_regional')),
  constraint ck_leadership_base
    check (base_calculo in ('PRODUCAO_LIQUIDA', 'AVISTA_CREDITO_PF')),
  constraint ck_leadership_vigencia
    check (competencia_fim is null or competencia_fim >= competencia_inicio),
  constraint ck_leadership_fracoes
    check (aliquota >= 0 and aliquota <= 1 and piso >= 0 and piso <= 1),
  constraint uq_leadership_cargo_inicio
    unique (cargo, competencia_inicio)
);

-- RLS default-deny, igual a trp_rule_versions: nenhuma policy => authenticated
-- nao le nem escreve; service_role (motor/gate) ignora RLS. Policy de leitura
-- para a tela entra quando houver tela.
alter table leadership_rule_versions enable row level security;

-- Lookup do resolvedor: por cargo, ordenado por vigencia.
create index if not exists idx_leadership_rule_cargo_vigencia
  on leadership_rule_versions (cargo, competencia_inicio desc);

comment on table leadership_rule_versions is
  'Regua versionada de remuneracao de lideranca (supervisor/gerente_regional). '
  'Uma linha por cargo e vigencia. Resolvida por lib/remuneracaoLideranca.ts, '
  'que e a fonte UNICA do calculo. Padrao espelhado de trp_rule_versions.';
comment on column leadership_rule_versions.base_calculo is
  'Qual base a ALIQUOTA multiplica. PRODUCAO_LIQUIDA (regua ate 2026-07) ou '
  'AVISTA_CREDITO_PF (regua de 2026-08 em diante). O PISO multiplica sempre a '
  'producao liquida da base.';
comment on column leadership_rule_versions.desconta_cancelamento_seguro is
  'Intencao da regua. Em 2026-08 nasce TRUE mas NAO e aplicado no nivel de rede: '
  'as linhas de cancelamento (INSURANCE|Seguro) tem j_key nulo e nao sao '
  'atribuiveis a promotor. Ver o cabecalho desta migration.';

-- ============================================================
-- 2) Seed das duas reguas
-- ============================================================
-- competencia_inicio da regua antiga = 2026-01: o ledger do sistema nasce em
-- jan/2026 (as competencias de 2025 estao fora do escopo do PMR). Nao ha regua
-- de lideranca anterior a isso para versionar.
insert into leadership_rule_versions
  (cargo, aliquota, piso, base_calculo, competencia_inicio, competencia_fim,
   desconta_cancelamento_seguro, notes)
values
  ('supervisor',       0.001000, 0.000000, 'PRODUCAO_LIQUIDA',
   date '2026-01-01', date '2026-07-01', false,
   'Regua ate 2026-07. Espelha lib/comissaoGestao.ts:27 (0,001) — mesmo valor '
   'para os dois cargos, como o codigo aplica hoje. Piso 0: o max() cai sempre '
   'no termo da aliquota.'),

  ('gerente_regional', 0.001000, 0.000000, 'PRODUCAO_LIQUIDA',
   date '2026-01-01', date '2026-07-01', false,
   'Idem supervisor. A sobreposicao entre os niveis e intencional: a mesma '
   'producao remunera o supervisor e o gerente acima dele.'),

  ('supervisor',       0.025000, 0.000700, 'AVISTA_CREDITO_PF',
   date '2026-08-01', null, true,
   'Regua nova. Maior entre 2,5% da comissao a vista da base e 0,07% da '
   'producao liquida da base.'),

  ('gerente_regional', 0.035000, 0.001000, 'AVISTA_CREDITO_PF',
   date '2026-08-01', null, true,
   'Regua nova. Maior entre 3,5% da comissao a vista da base e 0,10% da '
   'producao liquida da base.')
on conflict (cargo, competencia_inicio) do nothing;

commit;

-- ============================================================
-- Verificacao pos-execucao (rodar apos o commit)
-- ============================================================
--   -- (a) 4 linhas, duas vigencias por cargo:
--   select cargo, aliquota, piso, base_calculo, competencia_inicio, competencia_fim
--     from leadership_rule_versions
--    order by cargo, competencia_inicio;
--   -- esperado: 4 linhas.
--   --   gerente_regional 0.001000 0.000000 PRODUCAO_LIQUIDA  2026-01-01 2026-07-01
--   --   gerente_regional 0.035000 0.001000 AVISTA_CREDITO_PF 2026-08-01 (null)
--   --   supervisor       0.001000 0.000000 PRODUCAO_LIQUIDA  2026-01-01 2026-07-01
--   --   supervisor       0.025000 0.000700 AVISTA_CREDITO_PF 2026-08-01 (null)
--
--   -- (b) nenhuma vigencia SOBREPOSTA por cargo (deve devolver 0 linhas):
--   select a.cargo, a.competencia_inicio, b.competencia_inicio
--     from leadership_rule_versions a
--     join leadership_rule_versions b
--       on a.cargo = b.cargo and a.id <> b.id
--    where a.competencia_inicio <= coalesce(b.competencia_fim, date '9999-12-31')
--      and b.competencia_inicio <= coalesce(a.competencia_fim, date '9999-12-31');
--   -- esperado: 0 linhas.
--
--   -- (c) o CHECK de cargo barra papel invalido (rode em begin/rollback):
--   -- begin;
--   --   insert into leadership_rule_versions (cargo, aliquota, piso, base_calculo, competencia_inicio)
--   --     values ('promotor', 0.01, 0, 'PRODUCAO_LIQUIDA', date '2026-08-01');
--   -- rollback;  -- esperado: ERROR ... violates check constraint "ck_leadership_cargo"
