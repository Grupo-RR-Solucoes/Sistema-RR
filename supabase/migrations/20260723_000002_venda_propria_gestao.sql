-- FRENTE DE PRODUTO — VENDA PROPRIA DE GESTAO (2/3): onde a venda propria MORA.
--
-- REQUISITO (Diego, 21/07): venda propria e um atributo do PAPEL DE GESTAO, nao um
-- vinculo a promotor. Vale para os TRES papeis: gestor_consorcio, supervisor e
-- gerente_regional. A REGUA e a MESMA do promotor (BBCAP/Conta Corrente x 0,5833;
-- consorcio x 0,40) — o que muda e SO quem e o beneficiario.
--
-- POR QUE UMA TABELA NOVA (e nao o PMR): promoter_monthly_results e
-- promoter_id NOT NULL FK promoters, com unique (promoter_id, year, month, company_id),
-- e e lido por promoterAnalytics, report.ts (PDF/XLSX), dre.ts, /projecao, /relatorios
-- e por RLS keyed em promoter_id. Um beneficiario polimorfico contaminaria ranking,
-- meta, faixa, PDF e DRE. Esta tabela e o ESPELHO do PMR para quem NAO e promotor:
-- mesmo padrao achatado (uma coluna numerica por componente, somadas no final).
--
-- O QUE ELA NAO E: nao e o payout de gestao. Os 10% do gestor de consorcio continuam
-- em consorcio_gestor_payout (20260721_000003), INTOCADOS — sao naturezas diferentes
-- (override sobre o TOTAL x comissao da venda). O "40% + 10% = 50%" da venda propria
-- do gestor de consorcio NAO e regra em lugar nenhum: os 40% caem aqui e os 10% saem
-- do payout, cuja base ja soma TODAS as parcelas regulares (inclusive as dele). As
-- duas facetas se somam na LEITURA da tela, nunca no banco.
--
-- CREDITO ESTA FORA (decisao do Diego): a venda propria cobre BBCAP, Conta Corrente e
-- Consorcio. Credito nasce em daily_production_records.promoter_id (FK promoters) e a
-- regua e escalonada por faixa/meta DO PROMOTOR — nao ha caminho para um app_user.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

-- 1) FLAG DO PAPEL — quem tem venda propria habilitada. E o que faz o beneficiario
--    aparecer no dropdown da tela de atribuicao. So SOCIO liga (regra na rota:
--    canChangeUserRole); o CHECK aqui garante que nenhum outro papel (promotor,
--    socio, funcionario) possa carregar o flag nem por escrita direta no banco.
alter table public.app_users
  add column if not exists venda_propria boolean not null default false;

alter table public.app_users
  drop constraint if exists app_users_venda_propria_check;

alter table public.app_users
  add constraint app_users_venda_propria_check check (
    venda_propria = false
    or role in ('gestor_consorcio', 'supervisor', 'gerente_regional')
  );

comment on column public.app_users.venda_propria is
  'Papel de gestao (gestor_consorcio/supervisor/gerente_regional) que TAMBEM vende. '
  'Habilita o usuario como beneficiario na fila product_line_assignments e faz nascer '
  'linhas em gestao_venda_propria. NAO transforma o usuario em promotor.';

-- 2) RESULTADO MENSAL DA VENDA PROPRIA — espelho do PMR para nao-promotores.
--    Grao identico ao do PMR: (beneficiario, competencia, empresa). Escrito pelo
--    reconsolidarCompetenciaFechada, logo depois do repasse de produto ao PMR.
--    Idempotente: upsert por (app_user_id, year, month, company_id).
create table if not exists public.gestao_venda_propria (
  id uuid primary key default gen_random_uuid(),

  app_user_id uuid not null references public.app_users(id) on delete restrict,
  company_id  uuid references public.companies(id),
  year  integer not null,
  month integer not null,

  -- papel no momento do calculo (historico leve, igual ao carimbo do payout).
  role_snapshot text,

  -- componentes (mesmo padrao achatado do PMR; credito fora de escopo).
  bbcap_commission_value          numeric(18,2) not null default 0, -- x 0,5833
  conta_corrente_commission_value numeric(18,2) not null default 0, -- x 0,5833
  consorcio_commission_value      numeric(18,2) not null default 0, -- x 0,40
  lob_commission_value            numeric(18,2) not null default 0, -- adiado (sem fonte)
  final_commission_value          numeric(18,2) not null default 0, -- soma dos acima

  source text not null default 'fechamento',
  status text not null default 'ABERTO' check (status in ('ABERTO', 'FECHADO')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (app_user_id, year, month, company_id)
);

create index if not exists gestao_venda_propria_comp_idx
  on public.gestao_venda_propria (year, month);
create index if not exists gestao_venda_propria_user_idx
  on public.gestao_venda_propria (app_user_id);

-- RLS — socio gerencia tudo; o beneficiario le SO as PROPRIAS linhas.
-- Diferente do payout dos 10% (que e por ROLE, porque o gestor de consorcio e unico e
-- ha linhas orfas de junho): venda propria e por PESSOA e ha tres papeis possiveis,
-- entao o filtro e por app_user_id. Ninguem le a venda propria de outro.
alter table public.gestao_venda_propria enable row level security;
grant select, insert, update, delete on public.gestao_venda_propria to authenticated;

drop policy if exists "gestao_venda_propria_socio_all" on public.gestao_venda_propria;
create policy "gestao_venda_propria_socio_all" on public.gestao_venda_propria for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

-- subselect canonico (auth_user_id = auth.uid()), o mesmo de current_app_user_role.
drop policy if exists "gestao_venda_propria_self_select" on public.gestao_venda_propria;
create policy "gestao_venda_propria_self_select" on public.gestao_venda_propria for select to authenticated
using (app_user_id = (select id from public.app_users where auth_user_id = auth.uid()));

-- PENDENCIA CONHECIDA (registrada, nao resolvida aqui — decisao do Diego): esta tabela
-- fica FORA do DRE, exatamente como consorcio_gestor_payout ja esta hoje. O DRE soma
-- payable_commission_value do PMR (promotores ATIVOS por CNPJ) e nao enxerga pagamento
-- de gestao. Unificar "pagamentos de gestao" no DRE/caixa e frente propria.

-- Verificacao pos-execucao:
--   -- (a) a coluna e o CHECK existem:
--   select venda_propria from public.app_users limit 1;
--   -- (b) o CHECK barra papel nao-gestao (deve dar ERRO):
--   --   update app_users set venda_propria = true where role = 'promotor';
--   -- (c) a tabela nasce VAZIA (gate do no-op):
--   select count(*) from public.gestao_venda_propria;   -- esperado: 0
