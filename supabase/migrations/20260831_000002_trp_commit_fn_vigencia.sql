-- Migration: TRP — trp_commit_version com as TRÊS SAÍDAS da vigência intra-mês
-- Fase 2 de 3, arquivo 2 de 2.  (2026-08-31)
--
-- PRÉ-REQUISITO: rodar DEPOIS de 20260831_000001. O EXCLUDE criado lá é o que
-- torna a saída "PARTE" segura — sem ele, esta função confiaria só na própria
-- lógica para não sobrepor.
--
-- ASSINATURA IDÊNTICA À DE HOJE. p_valid_from JÁ existia (o commitVersion.ts
-- sempre passou a vigência derivada); o que muda é ele deixar de ser um valor
-- ecoado e virar a DECISÃO. Por ser a mesma assinatura:
--   - `create or replace` basta: NÃO há DROP FUNCTION, não há overload novo;
--   - os grants existentes são PRESERVADOS (o revoke/grant no fim é idempotência,
--     não conserto).
--
-- AS TRÊS SAÍDAS (mais a de competência vazia), decididas pela comparação entre
-- p_valid_from e o valid_from da fatia ATIVA MAIS RECENTE da competência:
--
--   sem fatia ativa            -> PRIMEIRA. Insere. Nada a substituir nem partir.
--                                 É o caminho de toda competência nova.
--
--   p_valid_from  =  ativa     -> SUBSTITUI. Desativa a fatia e insere a nova.
--                                 É o COMPORTAMENTO DE HOJE, e é o caminho de
--                                 todo re-upload sem override (sem override o
--                                 valid_from é derivado, logo sempre igual).
--
--   p_valid_from  >  ativa     -> PARTE. Trunca a anterior em p_valid_from - 1
--                                 (ela CONTINUA ATIVA) e insere a nova. É o caso
--                                 da TRP39: agosto vira TRP38 [31/07..04/08] +
--                                 TRP39 [05/08..28/08].
--
--   p_valid_from  <  ativa     -> RECUSA, com raise exception. NÃO adivinha.
--
-- ORDEM DAS ESCRITAS NA SAÍDA "PARTE": UPDATE (trunca) e SÓ DEPOIS INSERT. O
-- ex_trp_vigencia_sem_overlap não é DEFERRABLE — inserir antes de truncar passa
-- por um estado sobreposto e é recusado na hora. A ordem aqui não é estilo.
--
-- O QUE ESTA FUNÇÃO **NÃO** PROTEGE, dito com todas as letras:
--   Ela não conhece a janela da competência (é holiday-aware e vive na aplicação,
--   em lib/trp/vigencia.ts). Logo NÃO sabe dizer se um p_valid_from é o início da
--   janela. Consequência: subir a PRIMEIRA régua de uma competência já com
--   override deixaria a fatia inicial do mês descoberta — um BURACO. Quem acusa
--   isso é o resolvedor, com TrpVigenciaGapError (lib/trp/resolveTrpRegraDb.ts),
--   que FALHA ALTO em vez de escolher "a fatia mais próxima". A validação
--   preventiva (override tem de cair dentro da janela) é da Fase 3, em
--   commitTrpVersion. Aqui fica a rede, não o primeiro anteparo.
--
-- LIMITAÇÃO CONHECIDA E ACEITA: não dá para corrigir uma fatia ANTERIOR sem
-- antes desativar as posteriores — p_valid_from menor cai na RECUSA. É
-- deliberado: reescrever uma fatia velha por baixo de outra viva é justamente a
-- classe de mudança silenciosa que esta frente existe para impedir.
--
-- NENHUMA RÉGUA SOBE AQUI. Só a função.
--
-- Segurança: security definer + revoke/grant (só service_role executa). A RLS
-- default-deny da F1 continua sendo a fronteira real; isto é cinto-e-suspensório.
-- Idempotente: create or replace. Rodar 2x é seguro.

begin;

create or replace function trp_commit_version(
  p_competencia     date,
  p_regime          text,
  p_valid_from      date,
  p_valid_until     date,
  p_regra_json      jsonb,
  p_trp_doc_ref     text,
  p_source_filename text,
  p_source_sha256   text,
  p_parser_version  text,
  p_uploaded_by     uuid,
  p_notes           text
) returns trp_rule_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next    integer;
  v_ativa   trp_rule_versions;   -- fatia ATIVA de maior valid_from (NULL se não há)
  v_ativas  integer;
  v_row     trp_rule_versions;
begin
  -- ---- guardas de entrada: nada de vigência impossível ----
  if p_competencia is null or p_valid_from is null or p_valid_until is null then
    raise exception
      'trp_commit_version: p_competencia, p_valid_from e p_valid_until são obrigatórios';
  end if;
  if p_valid_from > p_valid_until then
    raise exception
      'trp_commit_version: vigência invertida (valid_from % > valid_until %)',
      p_valid_from, p_valid_until;
  end if;

  -- serializa commits concorrentes da MESMA competência (evita corrida no
  -- version_no E na decisão substituir/partir, que lê antes de escrever).
  perform pg_advisory_xact_lock(hashtextextended(p_competencia::text, 0));

  select count(*) into v_ativas
    from trp_rule_versions
   where competencia = p_competencia and is_active;

  -- A fatia ATIVA MAIS RECENTE. `order by valid_from desc` importa: com a
  -- competência já partida, a decisão é contra a ÚLTIMA fatia, não contra uma
  -- qualquer. FOR UPDATE trava a linha que vamos desativar ou truncar.
  select * into v_ativa
    from trp_rule_versions
   where competencia = p_competencia and is_active
   order by valid_from desc
   limit 1
   for update;

  select coalesce(max(version_no), 0) + 1 into v_next
    from trp_rule_versions where competencia = p_competencia;

  if v_ativa.id is null then
    -- ---- SAÍDA 0: PRIMEIRA régua da competência ----
    null;

  elsif p_valid_from = v_ativa.valid_from then
    -- ---- SAÍDA 1: SUBSTITUI (o comportamento de hoje) ----
    -- `where id = v_ativa.id`, NÃO `where competencia and is_active`: com a
    -- competência partida, desativar por competência mataria TAMBÉM a fatia
    -- anterior, que continua valendo. Com uma fatia só (todo o histórico até
    -- hoje) v_ativa É ela, então isto é byte-idêntico ao que a função fazia.
    update trp_rule_versions
       set is_active = false
     where id = v_ativa.id;

  elsif p_valid_from > v_ativa.valid_from then
    -- ---- SAÍDA 2: PARTE ----
    if p_valid_from > v_ativa.valid_until then
      raise exception
        'trp_commit_version: PARTIR em % deixaria BURACO — a fatia ativa de % vai só até %. '
        'Não estico a régua anterior por conta própria.',
        p_valid_from, p_competencia, v_ativa.valid_until;
    end if;
    -- TRUNCA a anterior e a mantém ATIVA. UPDATE ANTES do INSERT: o
    -- ex_trp_vigencia_sem_overlap não é deferrable (ver cabeçalho).
    update trp_rule_versions
       set valid_until = p_valid_from - 1
     where id = v_ativa.id;

  else
    -- ---- SAÍDA 3: RECUSA ----
    raise exception
      'trp_commit_version: p_valid_from % é ANTERIOR ao início da fatia ativa de % (%). '
      'Não adivinho o que fazer: para reescrever uma fatia anterior, desative antes as '
      'posteriores. (% régua(s) ativa(s) nesta competência.)',
      p_valid_from, p_competencia, v_ativa.valid_from, v_ativas;
  end if;

  insert into trp_rule_versions (
    competencia, regime, valid_from, valid_until, version_no, is_active,
    regra_json, trp_doc_ref, source_filename, source_sha256, parser_version,
    uploaded_by, notes
  ) values (
    p_competencia, p_regime, p_valid_from, p_valid_until, v_next, true,
    p_regra_json, p_trp_doc_ref, p_source_filename, p_source_sha256, p_parser_version,
    p_uploaded_by, p_notes
  ) returning * into v_row;

  -- Respeita uq_trp_rule_versions_active_from (1 ativa por competência+início),
  -- ex_trp_vigencia_sem_overlap (fatias ativas não se cruzam),
  -- ck_trp_vigencia_ordenada e uq(competencia, version_no).
  return v_row;
end $$;

comment on function trp_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text) is
  'TRP self-service: ÚNICO caminho que grava em trp_rule_versions. Desde 31/08/2026 '
  'decide entre SUBSTITUIR (p_valid_from = o da fatia ativa; o re-upload de sempre), '
  'PARTIR (p_valid_from maior: trunca a anterior em p_valid_from-1, ela segue ATIVA, '
  'e insere a nova — o caso da TRP39 a partir de 05/08) e RECUSAR (p_valid_from '
  'anterior). Atômica, serializada por advisory lock na competência. NÃO valida se '
  'p_valid_from cai na janela holiday-aware: isso é da aplicação (commitTrpVersion), '
  'e o buraco resultante é acusado pelo TrpVigenciaGapError do resolvedor.';

revoke all on function trp_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function trp_commit_version(date,text,date,date,jsonb,text,text,text,text,uuid,text)
  to service_role;

commit;

-- ============================================================================
-- VERIFICACAO — rodar depois, e colar a saida.
-- ============================================================================
-- (a) a funcao foi trocada, e a assinatura NAO se multiplicou:
--   select p.oid::regprocedure as assinatura, p.prosecdef as security_definer
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'trp_commit_version';
--   -- esperado: EXATAMENTE 1 linha (nao 2 — se aparecerem duas, houve overload
--   --   e o PostgREST fica ambiguo), security_definer = true
--
-- (b) so o service_role executa:
--   select grantee, privilege_type
--     from information_schema.routine_privileges
--    where routine_name = 'trp_commit_version';
--   -- esperado: service_role EXECUTE, e NADA para anon/authenticated/public
--
-- (c) PROVA FUNCIONAL DAS TRES SAIDAS. Rodar INTEIRO dentro de begin/rollback —
--     nao deixa nada no banco. Usa 2026-08, que hoje esta VAZIA.
--
--   begin;
--     -- (c1) SAIDA 0 — primeira regua da competencia (a TRP38 materializada).
--     select competencia, version_no, is_active, valid_from, valid_until
--       from trp_commit_version(
--         '2026-08-01','VOLUME_5_FAIXAS','2026-07-31','2026-08-28',
--         '{"t":38}'::jsonb, null, 'TRP38.pdf', null, null, null, 'prova c1');
--     -- esperado: version_no 1, is_active t, 2026-07-31 .. 2026-08-28
--
--     -- (c2) SAIDA 2 — PARTE em 05/08 (a TRP39). A v1 tem de continuar ATIVA,
--     --      truncada em 04/08.
--     select competencia, version_no, is_active, valid_from, valid_until
--       from trp_commit_version(
--         '2026-08-01','VOLUME_5_FAIXAS','2026-08-05','2026-08-28',
--         '{"t":39}'::jsonb, null, 'TRP39.pdf', null, null, null, 'prova c2');
--     -- esperado: version_no 2, is_active t, 2026-08-05 .. 2026-08-28
--
--     select version_no, is_active, valid_from, valid_until
--       from trp_rule_versions where competencia = '2026-08-01' order by version_no;
--     -- esperado — E O CASO CONCRETO INTEIRO, as duas ATIVAS:
--     --   1  t  2026-07-31  2026-08-04   <- truncada pelo PARTE
--     --   2  t  2026-08-05  2026-08-28
--
--     -- (c3) SAIDA 1 — SUBSTITUI: re-upload da TRP39 (mesmo valid_from).
--     --      A v1 (TRP38) NAO pode ser afetada.
--     select version_no, is_active from trp_commit_version(
--         '2026-08-01','VOLUME_5_FAIXAS','2026-08-05','2026-08-28',
--         '{"t":"39b"}'::jsonb, null, 'TRP39-corrigida.pdf', null, null, null, 'prova c3');
--     -- esperado: version_no 3, is_active t
--
--     select version_no, is_active, valid_from, valid_until
--       from trp_rule_versions where competencia = '2026-08-01' order by version_no;
--     -- esperado:
--     --   1  t  2026-07-31  2026-08-04   <- SEGUE ATIVA (o ponto do `where id =`)
--     --   2  f  2026-08-05  2026-08-28   <- so ela foi desativada
--     --   3  t  2026-08-05  2026-08-28
--
--     -- (c4) SAIDA 3 — RECUSA: tentar gravar com inicio ANTERIOR ao da ativa.
--     select * from trp_commit_version(
--         '2026-08-01','VOLUME_5_FAIXAS','2026-08-01','2026-08-28',
--         '{"t":"x"}'::jsonb, null, null, null, null, null, 'prova c4');
--     -- esperado: ERROR ... p_valid_from 2026-08-01 e ANTERIOR ao inicio da fatia
--     --   ativa de 2026-08-01 (2026-08-05)
--   rollback;
--
--   begin;
--     -- (c5) o BURACO recusado: partir depois do fim da fatia ativa.
--     select * from trp_commit_version(
--         '2026-09-01','VOLUME_5_FAIXAS','2026-08-31','2026-09-29',
--         '{"a":1}'::jsonb, null, null, null, null, null, 'prova c5 base');
--     select * from trp_commit_version(
--         '2026-09-01','VOLUME_5_FAIXAS','2026-10-15','2026-09-29',
--         '{"a":2}'::jsonb, null, null, null, null, null, 'prova c5');
--     -- esperado: ERROR — a segunda cai na guarda de vigencia invertida
--     --   (valid_from 2026-10-15 > valid_until 2026-09-29), ANTES do buraco.
--     --   Para ver a mensagem do BURACO, use valid_until 2026-10-31.
--   rollback;
--
--   -- conferencia final: nada sobrou dos rollbacks
--   select count(*) as total, count(*) filter (where is_active) as ativas
--     from trp_rule_versions;
--   -- esperado: total 5, ativas 4   <- exatamente como antes das provas
-- ============================================================================
