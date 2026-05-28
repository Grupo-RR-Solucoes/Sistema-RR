-- FIX-1.E.6.E.2 — Substitui as 7 faixas TRP antigas da scale
-- SEGURO_SLIP_MAIO_2026 por 4 faixas TRP vigente (Tabela de
-- Remuneracao ABRIL 2026).
--
-- Mudanca conceitual:
--   - 7 faixas com share como % sobre valor (TRP antiga) →
--     4 faixas com share como FRACAO da comissao Promotiva.
--   - Borda superior agora e EXCLUSIVA no lookup; ultima faixa
--     (volume_max NULL) continua aberta.
--   - Prazo nao afeta repasse (so afeta o PMT da Promotiva, que
--     ja entra em daily_production_records.insurance_commission_amount).
--
-- Idempotencia: DELETE + INSERT escopado pelo scale_id resolvido
-- via scale_code. Re-rodar a migration deixa o banco no mesmo
-- estado (4 faixas exatas). Usa CTE para evitar repetir o
-- subselect de scale_id.
--
-- Bordas vigentes (limite inferior inclusivo, superior EXCLUSIVO):
--   [0.00, 0.10) → 0.10
--   [0.10, 0.20) → 0.25
--   [0.20, 0.30) → 0.35
--   [0.30, NULL) → 0.50

begin;

with target_scale as (
  select id from public.share_scale
   where scale_code = 'SEGURO_SLIP_MAIO_2026'
)
delete from public.share_scale_tier
 where scale_id in (select id from target_scale);

with target_scale as (
  select id from public.share_scale
   where scale_code = 'SEGURO_SLIP_MAIO_2026'
)
insert into public.share_scale_tier
  (scale_id, volume_min, volume_max, share_percent)
select id, 0.00, 0.10, 0.10 from target_scale
union all
select id, 0.10, 0.20, 0.25 from target_scale
union all
select id, 0.20, 0.30, 0.35 from target_scale
union all
select id, 0.30, null, 0.50 from target_scale;

-- Atualiza descricao para refletir a nova semantica do share_percent.
update public.share_scale
   set description = 'Tabela Slip TRP ABRIL/2026: volume_* = % penetracao mensal; share_percent = FRACAO da comissao Promotiva repassada ao promotor (borda superior exclusiva)',
       updated_at  = now()
 where scale_code = 'SEGURO_SLIP_MAIO_2026';

commit;
