-- Migration: materializacao da carteira PRT vira ASSINCRONA  (2026-09-03)
--
-- O DEFEITO QUE ESTA MIGRATION MATA
-- ---------------------------------
-- `app/api/import/closing/route.ts` chamava as duas RPCs de materializacao
-- (fn_materializar_producao_contrato + fn_materializar_carteira_contrato) pelo
-- PostgREST. MEDIDO: o role `authenticator` tem statement_timeout=8s e
-- lock_timeout=8s; as duas funcoes juntas queimam 38-51s. Logo a chamada NUNCA
-- podia terminar por essa porta -- e nao terminava desde 2026-07-07. As MESMAS
-- funcoes rodam sem problema no Studio (foi assim que a carteira foi posta em
-- 2026-08 no dia 02/09/2026, `created_at` unico 2026-09-02T21:27:50).
--
-- NUMERO DE FECHAMENTO, medido DENTRO do worker depois de aplicada esta
-- migration (fila origem='manual', 2026-08): **ms = 60.150**, com
-- linhas_producao 270.198, linhas_carteira 74.956 e carteira_competencia_max
-- 2026-08. Sessenta segundos contra um teto de oito: **7,5x**. Nao era margem
-- apertada, era impossibilidade -- e nenhuma otimizacao razoavel da funcao
-- caberia nos 8s. E este numero que sustenta o desenho inteiro.
--
-- Escopar por competencia NAO resolve: a 2a funcao nao tem competencia para
-- escopar -- ela comeca com TRUNCATE e reconstroi a janela 2026+ inteira.
--
-- O DESENHO: FILA EM `public`, WORKER EM `cron`
-- --------------------------------------------
--   1. a rota faz UM INSERT em `materializacao_fila` (milissegundos, cabe folgado
--      nos 8s) e devolve o import;
--   2. um job pg_cron de 1 minuto chama `fn_materializacao_fila_processar()`, que
--      roda DENTRO do banco -- sem PostgREST, logo sem os 8s -- e escreve o
--      resultado (status/ms/erro CRU) de volta na linha da fila.
--
-- POR QUE A FILA FICA EM `public` E NAO EM `cron`: o PostgREST desta instancia
-- expoe SO `public` e `graphql_public` (medido: PGRST106 lista os dois, e o
-- controle com schema inventado devolve a mensagem IDENTICA -- "nao achei" ali
-- nao e prova de ausencia). Fila em `public` = observavel com service_role de
-- fora; so o AGENDADOR fica fora do alcance. Sem isso o rastro voltaria a ser
-- invisivel, que e o defeito de origem.
--
-- POR QUE O WORKER NAO E EXPOSTO AO service_role: chamar o worker pelo
-- PostgREST cairia nos mesmos 8s. Nao ha grant para anon/authenticated/
-- service_role DE PROPOSITO -- a unica porta e o pg_cron. Quem precisa olhar usa
-- `fn_diag_materializacao_cron()`, que e barata e SO LE.
--
-- MEDIDO NO STUDIO EM 03/09/2026, antes desta migration:
--   pg_extension            -> vazio (pg_cron NAO instalado)
--   pg_available_extensions -> pg_cron 1.6.4, installed_version NULL
-- Por isso o `create extension` entra AQUI, como no caso do btree_gist.
--
-- APLICAR MANUALMENTE no Studio (padrao deste repo). Idempotente.
-- O portao scripts/gate_materializacao_fila.cjs REPROVA enquanto a tabela, a
-- funcao de diagnostico ou o job do cron nao existirem -- de proposito: sem eles
-- o conserto e inerte e a rota estaria enfileirando para ninguem.

begin;

-- ---------------------------------------------------------------- extensao --
create extension if not exists pg_cron;

-- -------------------------------------------------------------------- fila --
create table if not exists public.materializacao_fila (
  id           uuid primary key default gen_random_uuid(),
  -- 'closing_rr' | 'closing_ads' | 'manual'. Texto, nao enum: enum novo exige
  -- migration, e este repo aplica migration a mao (mesmo criterio de
  -- import_pos_diag.origem).
  origem       text not null,
  -- id da linha em monthly_closing_imports (RR) ou daily_imports (ADS).
  import_id    uuid,
  -- competencia do fechamento que PEDIU a materializacao. NAO e o escopo do
  -- trabalho (a 2a funcao reconstroi 2026+ inteiro): e a competencia cujo
  -- CONGELAMENTO fica devendo. Foi a ausencia deste par (year,month) que deixou
  -- o vintage de 2026-07 inalcancavel -- o congelamento tirava a competencia do
  -- max(competencia) da carteira, que ja tinha andado para 2026-08.
  year         int,
  month        int,
  status       text not null default 'PENDENTE',
  tentativas   int  not null default 0,
  -- true = a materializacao desta linha ainda nao teve o congelamento
  -- correspondente. O congelamento e TypeScript (buildPrtAgenda +
  -- buildAvistaProducao) e nao pode rodar dentro do banco; ele roda no import
  -- SEGUINTE ou por chamada explicita, lendo esta coluna.
  congelamento_pendente boolean not null default true,
  congelado_em timestamptz,
  -- mensagem CRUA do erro (sqlerrm). Nunca resumir.
  erro         text,
  ms           int,
  linhas_producao bigint,
  linhas_carteira bigint,
  carteira_competencia_max text,
  criado_em    timestamptz not null default now(),
  iniciado_em  timestamptz,
  terminado_em timestamptz,
  constraint materializacao_fila_status_chk
    check (status in ('PENDENTE', 'RODANDO', 'OK', 'ERRO'))
);

comment on table public.materializacao_fila is
  'Fila da materializacao da carteira PRT. A rota de import INSERE (rapido); o job '
  'pg_cron materializacao_fila processa dentro do banco, onde o statement_timeout '
  'de 8s do authenticator nao vale. Linha PENDENTE velha = o worker NAO rodou; '
  'ausencia de linha = import anterior a esta fila, NAO sucesso. '
  'Ver lib/materializacao/filaRegras.ts.';

create index if not exists idx_materializacao_fila_pendente
  on public.materializacao_fila (status, criado_em);
create index if not exists idx_materializacao_fila_congelamento
  on public.materializacao_fila (congelamento_pendente, status, criado_em);

-- Escrita e leitura sao do service_role (as rotas de import ja usam admin).
-- Default-deny para anon/authenticated: a coluna `erro` carrega mensagem crua do
-- banco, que nao e conteudo de tela.
alter table public.materializacao_fila enable row level security;

-- ------------------------------------------------------------------ worker --
create or replace function public.fn_materializacao_fila_processar(p_max_jobs int default 1)
returns table (job_id uuid, job_status text, job_ms int, job_erro text)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_job         public.materializacao_fila;
  v_t0          timestamptz;
  v_processados int := 0;
begin
  -- UM worker por vez. Sem isto, dois disparos sobrepostos rodariam dois
  -- TRUNCATE+INSERT em carteira_contrato ao mesmo tempo. `xact` e nao `session`
  -- de proposito: lock de sessao NAO e liberado por rollback, e um aborto
  -- deixaria a fila travada para sempre.
  if not pg_try_advisory_xact_lock(hashtext('materializacao_fila_worker')::bigint) then
    return;
  end if;

  -- O TETO DA API NAO VALE AQUI -- e e a razao de existir desta frente. Desligar
  -- explicitamente, e nao herdar o default do banco: o default e configuracao
  -- que muda fora do repo, e foi exatamente uma configuracao invisivel (os 8s do
  -- authenticator) que matou a materializacao por dois meses.
  set local statement_timeout = 0;
  set local lock_timeout = '30s';

  loop
    exit when v_processados >= greatest(1, p_max_jobs);

    -- o MAIS ANTIGO pendente primeiro (a ordem importa: o congelamento de julho
    -- tem de vir antes do de agosto). SKIP LOCKED: nao espera por linha de outro.
    select * into v_job
      from public.materializacao_fila
     where status = 'PENDENTE'
     order by criado_em asc
     limit 1
       for update skip locked;

    exit when not found;

    update public.materializacao_fila
       set status = 'RODANDO', iniciado_em = now(), tentativas = tentativas + 1
     where id = v_job.id;

    v_t0 := clock_timestamp();
    begin
      perform public.fn_materializar_producao_contrato();
      perform public.fn_materializar_carteira_contrato();

      update public.materializacao_fila
         set status = 'OK',
             terminado_em = now(),
             ms = (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
             erro = null,
             linhas_producao = (select count(*) from public.producao_contrato),
             linhas_carteira = (select count(*) from public.carteira_contrato),
             carteira_competencia_max = (select max(competencia) from public.carteira_contrato)
       where id = v_job.id;
    exception when others then
      -- A linha NAO volta para PENDENTE. Retry automatico de um TRUNCATE+INSERT
      -- de 40s e o jeito de transformar uma falha em quatro; e a mensagem crua
      -- fica onde alguem le. Reprocessar e ato explicito (update para PENDENTE).
      update public.materializacao_fila
         set status = 'ERRO',
             terminado_em = now(),
             ms = (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int,
             erro = coalesce(nullif(sqlerrm, ''), '(erro sem mensagem)')
       where id = v_job.id;
    end;

    v_processados := v_processados + 1;
  end loop;

  return query
    select f.id, f.status, f.ms, f.erro
      from public.materializacao_fila f
     where f.terminado_em is not null
     order by f.terminado_em desc
     limit greatest(1, p_max_jobs);
end;
$fn$;

comment on function public.fn_materializacao_fila_processar(int) is
  'Worker da fila de materializacao. SO o pg_cron chama: NAO ha grant para '
  'service_role de proposito, porque pelo PostgREST ele cairia nos mesmos 8s que '
  'esta frente veio contornar.';

-- SEM grant para as roles da API. `revoke from public` porque funcao nasce com
-- execute para PUBLIC -- e sem isto o `service_role` (que herda de PUBLIC) poderia
-- chama-la pela API e reintroduzir o teto.
revoke all on function public.fn_materializacao_fila_processar(int) from public;
revoke all on function public.fn_materializacao_fila_processar(int) from anon;
revoke all on function public.fn_materializacao_fila_processar(int) from authenticated;
revoke all on function public.fn_materializacao_fila_processar(int) from service_role;

-- ------------------------------------------------------------ diagnostico --
-- SO LE. Existe porque `cron` nao e exposto pelo PostgREST: sem esta janela, a
-- unica prova de que o agendador esta vivo estaria no Studio, e a frente
-- inteira voltaria a depender de alguem ir olhar.
create or replace function public.fn_diag_materializacao_cron()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v jsonb;
begin
  select jsonb_build_object(
    'pg_cron_instalado', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_cron_versao',    (select extversion from pg_extension where extname = 'pg_cron'),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule,
               'active', j.active, 'database', j.database, 'command', j.command))
        from cron.job j
       where j.jobname like 'materializacao%'), '[]'::jsonb),
    'execucoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'runid', d.runid, 'jobid', d.jobid, 'status', d.status,
               'return_message', d.return_message,
               'start_time', d.start_time, 'end_time', d.end_time))
        from (select r.* from cron.job_run_details r
               where r.jobid in (select jobid from cron.job where jobname like 'materializacao%')
               order by r.start_time desc limit 10) d), '[]'::jsonb),
    'statement_timeout_por_role', coalesce((
      select jsonb_object_agg(r.rolname, s.setconfig)
        from pg_db_role_setting s
        join pg_roles r on r.oid = s.setrole
       where r.rolname in ('authenticator', 'postgres', 'service_role')), '{}'::jsonb)
  ) into v;
  return v;
end;
$fn$;

comment on function public.fn_diag_materializacao_cron() is
  'Janela SO-LEITURA sobre cron.job / cron.job_run_details e os timeouts por role. '
  'Existe porque o PostgREST expoe apenas public e graphql_public -- sem ela nao ha '
  'como provar de fora que o agendador esta vivo.';

grant execute on function public.fn_diag_materializacao_cron() to service_role;

commit;

-- ------------------------------------------------------------- agendamento --
-- FORA da transacao: cron.schedule faz commit proprio em algumas versoes.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'materializacao_fila') then
    perform cron.unschedule('materializacao_fila');
  end if;
end $$;

-- A CADA MINUTO, em cron CLASSICO.
--
-- CORRECAO DE 03/09/2026, medida na aplicacao: eu tinha escrito `'1 minute'` e
-- ESTA VERSAO DO pg_cron RECUSA essa forma. Ela aceita cron classico
-- (`* * * * *`) ou intervalo em segundos (`'[1-59] seconds'`) — e nada entre os
-- dois. A justificativa que estava aqui antes ("'1 minute' nao depende do
-- suporte a intervalo sub-minuto") estava ERRADA nos dois sentidos: o suporte
-- sub-minuto existe, e era a forma em minutos que nao era aceita.
--
-- Por que 1 minuto e nao segundos: o congelamento NAO espera mais a fila (roda
-- no import seguinte ou por chamada explicita), entao latencia de fila nao e
-- requisito. E MEDIDO em 03/09/2026, o trabalho leva **60.150 ms** — disparar a
-- cada 10s so faria o worker encontrar a si mesmo. Quando isso acontecer (o
-- trabalho passar do minuto, como ja passa por 150 ms), o disparo seguinte cai
-- no `pg_try_advisory_xact_lock` e volta na hora, sem fila dupla. E para isso
-- que o lock esta la.
select cron.schedule(
  'materializacao_fila',
  '* * * * *',
  'select public.fn_materializacao_fila_processar(1);'
);

-- O PostgREST guarda um CACHE DE SCHEMA. Tabela e funcao novas so aparecem na
-- API depois do reload; sem isto o portao continua dizendo PGRST205/PGRST202
-- como se a migration nao tivesse rodado.
notify pgrst, 'reload schema';

-- ============================================================
-- CONFERENCIA (rodar depois, no Studio ou pela RPC de diagnostico):
--   select * from cron.job where jobname = 'materializacao_fila';
--   select jsonb_pretty(fn_diag_materializacao_cron());
--
--   -- a fila:
--   select criado_em, origem, year, month, status, ms, congelamento_pendente,
--          carteira_competencia_max, erro
--     from materializacao_fila order by criado_em desc limit 20;
--
--   -- prova de ponta a ponta SEM import (enfileira a mao e espera 1 minuto):
--   insert into materializacao_fila (origem, year, month) values ('manual', 2026, 8);
--   -- ... 1 min ...
--   select status, ms, linhas_carteira, carteira_competencia_max, erro
--     from materializacao_fila where origem = 'manual' order by criado_em desc limit 1;
--
--   -- ultimas execucoes do job (status 'succeeded'/'failed'):
--   select status, return_message, start_time, end_time
--     from cron.job_run_details
--    where jobid in (select jobid from cron.job where jobname = 'materializacao_fila')
--    order by start_time desc limit 10;
-- ============================================================
