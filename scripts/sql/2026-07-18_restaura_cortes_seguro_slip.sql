-- ============================================================================
-- RESTAURA os cortes da escala de seguro SEGURO_SLIP_MAIO_2026 para a REGUA.
--
-- CONTEXTO (divida latente 3):
--   A migration 20260528000000_e6_e2_seguro_slip_tiers_vigentes.sql SEMPRE
--   esteve CERTA: ela insere os cortes 0.00 / 0.10 / 0.20 / 0.30 com bordas
--   [min, max) e shares 0.10 / 0.25 / 0.35 / 0.50.
--   Um UPDATE MANUAL nao versionado alterou o BANCO para 0.11 / 0.21 / 0.30,
--   alinhando a tabela ao literal (que tambem estava errado) e desalinhando
--   AMBOS da regua.
--
--   Logo NAO existe migration nova a criar: o codigo de migrations ja descreve
--   o estado certo. O que falta e DESFAZER o UPDATE manual no banco. Depois
--   deste script, banco == migration == regua, e rodar as migrations num
--   ambiente limpo produz exatamente o mesmo resultado (fim da divergencia).
--
-- REGUA (planilha de remuneracao, aba Seguro), semantica do lookup
-- lookupInsuranceShareFromPenetration: p >= volume_min AND p < volume_max,
-- ultima faixa aberta (volume_max NULL):
--   [0.00, 0.10) -> 0.10
--   [0.10, 0.20) -> 0.25
--   [0.20, 0.30) -> 0.35      <-- penetracao 20,00% CRAVADA cai AQUI = 0,35
--   [0.30, NULL) -> 0.50
--
-- Os SHARES ja estao corretos no banco; so os CORTES mudam.
--
-- METODO: UPDATE por tier (nao DELETE+INSERT) para nao brigar com a migration
-- antiga nem com a unique (scale_id, volume_min). Ordem de baixo para cima
-- para nunca colidir com a unique durante a transacao.
-- IDEMPOTENTE: rodar de novo nao muda nada (os WHERE ja nao casam).
-- ESCOPO: SOMENTE scale_id b489e9de (INSURANCE). As escalas de CREDITO
-- (PADRAO_ENTRANTE a2ef0d2c, LETICIA_JAYENE bba2838a) NAO sao tocadas — o
-- WHERE e escopado por scale_code = 'SEGURO_SLIP_MAIO_2026'.
-- ============================================================================

begin;

-- Trava o escopo: id da escala de SEGURO (nunca as de credito).
create temporary table _alvo on commit drop as
  select id from public.share_scale
   where scale_code = 'SEGURO_SLIP_MAIO_2026';

-- Guarda: aborta se a escala nao existir ou se vier mais de uma.
do $$
declare n int;
begin
  select count(*) into n from _alvo;
  if n <> 1 then
    raise exception 'esperava 1 escala SEGURO_SLIP_MAIO_2026, achei %', n;
  end if;
end $$;

-- ANTES (para o log do Studio).
select 'ANTES' as momento, t.volume_min, t.volume_max, t.share_percent
  from public.share_scale_tier t
 where t.scale_id in (select id from _alvo)
 order by t.volume_min;

-- 3a faixa: 0.21 -> 0.20 (min) e max ja e 0.30.
update public.share_scale_tier
   set volume_min = 0.20
 where scale_id in (select id from _alvo)
   and volume_min = 0.21;

-- 2a faixa: [0.11, 0.21) -> [0.10, 0.20).
update public.share_scale_tier
   set volume_min = 0.10, volume_max = 0.20
 where scale_id in (select id from _alvo)
   and volume_min = 0.11;

-- 1a faixa: max 0.11 -> 0.10 (min ja e 0.00).
update public.share_scale_tier
   set volume_max = 0.10
 where scale_id in (select id from _alvo)
   and volume_min = 0.00
   and volume_max = 0.11;

-- Guarda final: o estado tem que ser EXATAMENTE a regua, senao rollback.
do $$
declare bad int;
begin
  select count(*) into bad
    from public.share_scale_tier t
   where t.scale_id in (select id from _alvo)
     and not (
          (t.volume_min = 0.00 and t.volume_max = 0.10 and t.share_percent = 0.10)
       or (t.volume_min = 0.10 and t.volume_max = 0.20 and t.share_percent = 0.25)
       or (t.volume_min = 0.20 and t.volume_max = 0.30 and t.share_percent = 0.35)
       or (t.volume_min = 0.30 and t.volume_max is null and t.share_percent = 0.50)
     );
  if bad > 0 then
    raise exception 'estado final fora da regua em % tier(s) — nada foi gravado', bad;
  end if;
end $$;

-- DEPOIS (para o log do Studio).
select 'DEPOIS' as momento, t.volume_min, t.volume_max, t.share_percent
  from public.share_scale_tier t
 where t.scale_id in (select id from _alvo)
 order by t.volume_min;

commit;
