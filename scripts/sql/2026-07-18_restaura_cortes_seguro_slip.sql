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
--   o estado certo. O que falta e DESFAZER o UPDATE manual no banco.
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
-- ---------------------------------------------------------------------------
-- V2 - POR QUE A V1 FALHOU COM 'relation ... does not exist'
-- ---------------------------------------------------------------------------
-- A v1 criava uma TEMP TABLE com o id da escala e a referenciava nos statements
-- seguintes. Isso depende de ESTADO DE SESSAO sobreviver entre os statements
-- do mesmo paste - garantia que o SQL Editor do Supabase NAO da:
--   (a) ON COMMIT DROP mata a temp table no primeiro COMMIT, e o editor pode
--       commitar por statement em vez de honrar o begin;/commit; explicito; e
--   (b) a conexao passa por pooler em modo transaction, entao statements
--       consecutivos podem cair em BACKENDS DIFERENTES - e temp table e
--       visivel so na sessao que a criou.
-- Nao foi erro de colar: o script estava quebrado por construcao para este
-- ambiente. Erro de desenho meu.
--
-- V2: nenhum estado atravessa statement. A mutacao inteira e UM UNICO
-- statement - um bloco DO plpgsql que resolve o scale_id numa variavel local,
-- aplica os 3 UPDATEs e roda as guardas. Bloco DO e atomico: qualquer
-- RAISE EXCEPTION dentro dele desfaz TODOS os UPDATEs do bloco. Por isso o
-- begin;/commit; explicito tambem saiu - ele nao ajudava e podia conflitar
-- com o wrapping do editor.
-- Os dois SELECT (ANTES/DEPOIS) sao read-only e se escopam sozinhos por
-- scale_code, sem depender de nada criado antes.
--
-- IDEMPOTENTE: rodar de novo nao muda nada (os WHERE ja nao casam) e a guarda
-- final continua passando.
-- ESCOPO: SOMENTE a escala INSURANCE 'SEGURO_SLIP_MAIO_2026'. As escalas de
-- CREDITO (PADRAO_ENTRANTE, LETICIA_JAYENE) nao sao alcancadas por nenhum
-- WHERE deste arquivo.
--
-- COMO RODAR: cole o arquivo INTEIRO de uma vez no SQL Editor e execute.
-- Confira no resultado: o 1o SELECT mostra ANTES, o 2o mostra DEPOIS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ANTES (read-only; esperado 0.00/0.11 , 0.11/0.21 , 0.21/0.30 , 0.30/NULL)
-- ---------------------------------------------------------------------------
select 'ANTES' as momento, t.volume_min, t.volume_max, t.share_percent
  from public.share_scale_tier t
  join public.share_scale s on s.id = t.scale_id
 where s.scale_code = 'SEGURO_SLIP_MAIO_2026'
 order by t.volume_min;

-- ---------------------------------------------------------------------------
-- 2) MUTACAO + GUARDAS (um unico statement, atomico)
-- ---------------------------------------------------------------------------
do $$
declare
  v_scale uuid;
  v_tiers int;
  v_u1 int;
  v_u2 int;
  v_u3 int;
  v_bad int;
begin
  -- Resolve a escala de SEGURO. Variavel local: nao depende de temp table.
  select s.id into v_scale
    from public.share_scale s
   where s.scale_code = 'SEGURO_SLIP_MAIO_2026';

  if v_scale is null then
    raise exception 'escala SEGURO_SLIP_MAIO_2026 nao encontrada; nada foi gravado';
  end if;

  -- Guarda de forma: a escala tem que ter exatamente 4 faixas.
  select count(*) into v_tiers
    from public.share_scale_tier t
   where t.scale_id = v_scale;

  if v_tiers <> 4 then
    raise exception 'esperava 4 tiers na SEGURO_SLIP, achei %; nada foi gravado', v_tiers;
  end if;

  -- 3a faixa: volume_min 0.21 -> 0.20 (o max ja e 0.30).
  -- Ordem de cima para baixo para nunca colidir com a unique (scale_id, volume_min).
  update public.share_scale_tier
     set volume_min = 0.20
   where scale_id = v_scale
     and volume_min = 0.21;
  get diagnostics v_u1 = row_count;

  -- 2a faixa: [0.11, 0.21) -> [0.10, 0.20).
  update public.share_scale_tier
     set volume_min = 0.10,
         volume_max = 0.20
   where scale_id = v_scale
     and volume_min = 0.11;
  get diagnostics v_u2 = row_count;

  -- 1a faixa: volume_max 0.11 -> 0.10 (o min ja e 0.00).
  update public.share_scale_tier
     set volume_max = 0.10
   where scale_id = v_scale
     and volume_min = 0.00
     and volume_max = 0.11;
  get diagnostics v_u3 = row_count;

  raise notice 'UPDATEs aplicados: faixa3=% faixa2=% faixa1=% (1/1/1 na 1a rodada, 0/0/0 se ja corrigido)',
    v_u1, v_u2, v_u3;

  -- GUARDA FINAL: o estado tem que ser EXATAMENTE a regua, senao desfaz tudo.
  select count(*) into v_bad
    from public.share_scale_tier t
   where t.scale_id = v_scale
     and not (
          (t.volume_min = 0.00 and t.volume_max = 0.10 and t.share_percent = 0.10)
       or (t.volume_min = 0.10 and t.volume_max = 0.20 and t.share_percent = 0.25)
       or (t.volume_min = 0.20 and t.volume_max = 0.30 and t.share_percent = 0.35)
       or (t.volume_min = 0.30 and t.volume_max is null and t.share_percent = 0.50)
     );

  if v_bad > 0 then
    raise exception 'estado final fora da regua em % tier(s); TUDO foi desfeito', v_bad;
  end if;

  raise notice 'OK: os 4 tiers estao na regua 0.00/0.10/0.20/0.30. 20,00%% cravado passa a pagar 0,35.';
end $$;

-- ---------------------------------------------------------------------------
-- 3) DEPOIS (read-only; esperado 0.00/0.10 , 0.10/0.20 , 0.20/0.30 , 0.30/NULL)
-- ---------------------------------------------------------------------------
select 'DEPOIS' as momento, t.volume_min, t.volume_max, t.share_percent
  from public.share_scale_tier t
  join public.share_scale s on s.id = t.scale_id
 where s.scale_code = 'SEGURO_SLIP_MAIO_2026'
 order by t.volume_min;
