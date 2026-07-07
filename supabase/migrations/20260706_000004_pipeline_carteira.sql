-- Migration: pipeline de materializacao da carteira PRT por-contrato (2026-07-06)
--
-- Versiona as duas funcoes que materializam a carteira viva (Opcao B), ate entao
-- rodadas ad-hoc no Studio. Fonte: producao_contrato (2023+, tipada via to_num_br).
--
-- fn_materializar_producao_contrato(): INSERT idempotente do metadata PRT (ON CONFLICT
--   DO NOTHING) — traz 2023+ inteiro (o historico e necessario para detectar saidas).
-- fn_materializar_carteira_contrato(): recompute total (TRUNCATE + rematerializa) da
--   janela 2026+, classificando cada contrato x competencia:
--     - encerrado  : parcelas_pagas >= prazo
--     - saiu_antes : (a) transicao definitiva cod_est 1 -> 2/99 com parcela a vencer,
--                    ou (b) desaparecimento antes do fim estando pagavel com parcela a vencer
--     - ativo      : demais linhas pagaveis (cod_est=1) com parcela a vencer
--   saldo_a_receber = comissao * restantes.
--
-- Gate provado (2026-07-06): reproduz 56.131 linhas / 55.527 ativos / 100 encerrados /
--   504 saidas / saldo ultima competencia R$2.667.150,04 — identico ao populate ad-hoc.
--
-- APLICAR MANUALMENTE no Studio. Idempotente (create or replace). Executar a
-- materializacao e separado: select fn_materializar_producao_contrato();
--                             select fn_materializar_carteira_contrato();

create or replace function fn_materializar_producao_contrato()
returns void
language sql
as $$
  insert into producao_contrato (
    numero_operacao, competencia, entry_type, chave_j, mci,
    valor_financiado, prazo, parcelas_pagas, comissao, cod_est,
    monthly_closing_import_id
  )
  select
    btrim(metadata->>'NRO OPERAÇÃO'),
    year || '-' || lpad(month::text, 2, '0'),
    entry_type,
    metadata->>'CHAVE J',
    metadata->>'MCI',
    to_num_br(metadata->>'VALOR FINANCIADO'),
    trunc(to_num_br(metadata->>'QTD PARCELAS TOTAL'))::int,
    trunc(to_num_br(metadata->>'QTD PARCELAS PGS'))::int,
    to_num_br(metadata->>'COMISSÃO'),
    trunc(to_num_br(metadata->>'COD EST'))::int,
    monthly_closing_import_id
  from monthly_closing_entries
  where entry_type = 'PRT'
    and btrim(coalesce(metadata->>'NRO OPERAÇÃO', '')) <> ''
  on conflict (numero_operacao, competencia, entry_type) do nothing;
$$;

create or replace function fn_materializar_carteira_contrato()
returns void
language plpgsql
as $$
begin
  truncate table carteira_contrato;

  insert into carteira_contrato (
    numero_operacao, competencia, parcelas_pagas, prazo,
    comissao, restantes, saldo_a_receber, status
  )
  with serie as (
    select numero_operacao, competencia, parcelas_pagas, prazo, comissao, cod_est,
           lag(cod_est)        over (partition by numero_operacao order by competencia) as cod_est_ant,
           lag(competencia)    over (partition by numero_operacao order by competencia) as comp_ant,
           lag(parcelas_pagas) over (partition by numero_operacao order by competencia) as pagas_ant
    from producao_contrato where entry_type='PRT'
  ),
  comp_max as (select max(competencia) cmax from producao_contrato where entry_type='PRT'),
  ultima as (
    select numero_operacao, max(competencia) ult_comp
    from producao_contrato where entry_type='PRT' group by numero_operacao
  ),
  saida_transicao as (
    select s.numero_operacao, s.comp_ant as competencia
    from serie s
    where s.cod_est_ant=1 and s.cod_est in (2,99) and s.pagas_ant < s.prazo and s.comp_ant >= '2026-01'
      and not exists (
        select 1 from producao_contrato p
        where p.numero_operacao=s.numero_operacao and p.entry_type='PRT'
          and p.competencia > s.competencia and p.cod_est=1
      )
  ),
  saida_desaparece as (
    select u.numero_operacao, u.ult_comp as competencia
    from ultima u
    join producao_contrato p on p.numero_operacao=u.numero_operacao and p.competencia=u.ult_comp and p.entry_type='PRT'
    cross join comp_max cm
    where u.ult_comp < cm.cmax and u.ult_comp >= '2026-01'
      and p.cod_est=1 and p.parcelas_pagas < p.prazo
  ),
  saidas as (
    select numero_operacao, competencia from saida_transicao
    union
    select numero_operacao, competencia from saida_desaparece
  )
  select
    pc.numero_operacao,
    pc.competencia,
    pc.parcelas_pagas,
    pc.prazo,
    pc.comissao,
    greatest(0, pc.prazo - pc.parcelas_pagas) as restantes,
    round(pc.comissao * greatest(0, pc.prazo - pc.parcelas_pagas), 2) as saldo_a_receber,
    case
      when exists (select 1 from saidas s where s.numero_operacao=pc.numero_operacao and s.competencia=pc.competencia)
        then 'saiu_antes'
      when pc.parcelas_pagas >= pc.prazo then 'encerrado'
      else 'ativo'
    end as status
  from producao_contrato pc
  where pc.entry_type='PRT'
    and pc.competencia >= '2026-01'
    and pc.cod_est = 1;
end;
$$;
