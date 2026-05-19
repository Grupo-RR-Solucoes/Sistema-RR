-- Dia 4.5 Etapa A — Seeds das 3 escalas de repasse.
--
-- 3 escalas iniciais identificadas nas planilhas:
--   1. PADRAO_ENTRANTE (CREDIT, 5 tiers) — usada pelos 6 entrantes
--      sem acordo customizado
--   2. LETICIA_JAYENE (CREDIT, 2 tiers) — Leticia tem regra propria
--   3. SEGURO_SLIP_MAIO_2026 (INSURANCE, 7 tiers) — tabela Slip
--      oficial a partir de maio/2026, faixa = % penetracao mensal
--
-- Para INSURANCE: volume_min/max representam % de PENETRACAO (0..1
-- em decimal — ex: 0.15 = 15%) em vez de volume R$. A semantica do
-- scale_kind muda o significado de volume_* para penetracao_*.
--
-- Idempotencia: ON CONFLICT DO NOTHING nos INSERTs.

-- ============================================================
-- 1. PADRAO_ENTRANTE
-- ============================================================
insert into public.share_scale (scale_code, description, scale_kind)
values (
  'PADRAO_ENTRANTE',
  'Escala padrao Promotiva para promotores entrantes',
  'CREDIT'
)
on conflict (scale_code) do nothing;

insert into public.share_scale_tier (scale_id, volume_min, volume_max, share_percent)
select id, 0,        49999.99,  0.0000 from public.share_scale where scale_code = 'PADRAO_ENTRANTE'
union all
select id, 50000,    79999.99,  0.4385 from public.share_scale where scale_code = 'PADRAO_ENTRANTE'
union all
select id, 80000,    99999.99,  0.4824 from public.share_scale where scale_code = 'PADRAO_ENTRANTE'
union all
select id, 100000,  135999.99,  0.5263 from public.share_scale where scale_code = 'PADRAO_ENTRANTE'
union all
select id, 136000,  null,       0.5833 from public.share_scale where scale_code = 'PADRAO_ENTRANTE'
on conflict (scale_id, volume_min) do nothing;

-- ============================================================
-- 2. LETICIA_JAYENE
-- ============================================================
insert into public.share_scale (scale_code, description, scale_kind)
values (
  'LETICIA_JAYENE',
  'Escala personalizada Leticia Jayene (0 ate 100k = 0%, 100k+ = 25%)',
  'CREDIT'
)
on conflict (scale_code) do nothing;

insert into public.share_scale_tier (scale_id, volume_min, volume_max, share_percent)
select id, 0,        99999.99,  0.0000 from public.share_scale where scale_code = 'LETICIA_JAYENE'
union all
select id, 100000,   null,      0.2500 from public.share_scale where scale_code = 'LETICIA_JAYENE'
on conflict (scale_id, volume_min) do nothing;

-- ============================================================
-- 3. SEGURO_SLIP_MAIO_2026 (INSURANCE)
-- ============================================================
-- volume_min/max aqui = % PENETRACAO (decimal 0..1). share_percent
-- = % aplicado sobre VALOR_SEGURO. A Etapa B/C cuida da semantica
-- de aplicacao (consumidor escolhe escala pelo scale_kind).
insert into public.share_scale (scale_code, description, scale_kind)
values (
  'SEGURO_SLIP_MAIO_2026',
  'Tabela seguro Slip a partir de maio/2026 (volume_* = % penetracao)',
  'INSURANCE'
)
on conflict (scale_code) do nothing;

insert into public.share_scale_tier (scale_id, volume_min, volume_max, share_percent)
select id, 0.0000, 0.1499, 0.0030 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.1500, 0.2499, 0.0100 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.2500, 0.2999, 0.0140 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.3000, 0.3499, 0.0170 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.3500, 0.3999, 0.0243 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.4000, 0.5999, 0.0283 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
union all
select id, 0.6000, null,   0.0338 from public.share_scale where scale_code = 'SEGURO_SLIP_MAIO_2026'
on conflict (scale_id, volume_min) do nothing;
