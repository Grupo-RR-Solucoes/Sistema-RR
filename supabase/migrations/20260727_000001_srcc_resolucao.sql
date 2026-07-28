-- Migration: srcc_resolucao — a RESPOSTA que o fechamento deu sobre o SRCC.
--
-- TRES CAMPOS, TRES DONOS DIFERENTES, e a razao desta migration existir e nao
-- misturar os tres:
--
--   raw_payload["Indicador Restricao SRCC"]
--       COPIA FIEL do arquivo da gestora. E o que a Promotiva mandou na diaria,
--       intocavel. Nas linhas que esta migration atende ele diz "Consulta nao
--       realizada por problemas tecnicos" — e vai continuar dizendo, para
--       sempre, porque foi isso que a gestora mandou naquele dia.
--
--   is_srcc_restricted (boolean, ja existia)
--       O que o CALCULO consulta. isValidRecord (calculate/monthly:272) e
--       isEligibleProductionRecord descartam a linha quando ele e true. E o
--       campo que tira a producao da contagem.
--
--   srcc_resolucao (esta migration)
--       CONCLUSAO NOSSA, derivada do fechamento. Nao e o que a gestora mandou
--       na diaria; e o que o fechamento REVELOU depois, quando a consulta que
--       estava pendente ja tinha resposta.
--
-- POR QUE NAO REUSAR OS QUE JA EXISTEM. Gravar a conclusao dentro do
-- raw_payload apagaria a copia fiel da fonte. Gravar so no booleano nao
-- resolveria a etiqueta (getSrccRestrictionLabel le o raw_payload primeiro) e,
-- pior, deixaria a linha eternamente "indefinida" — o passo do import a
-- recandidataria a cada rodada, sem forma de saber que ela ja foi resolvida.
--
-- E ha precedente caro: a coluna company_received_percent acumulou DOIS
-- escritores com convencoes opostas porque ninguem separou "o que a gestora
-- mandou" de "o que o sistema concluiu". Custou duas rodadas de investigacao em
-- 27/07/2026 para descobrir que 0,95 queria dizer 0,95% e nao 95%. Nao repetir
-- o padrao uma frente depois de sofrer com ele.
--
-- ADITIVA: tres colunas novas, nullable, sem default e sem backfill. Nenhuma
-- linha existente muda de valor ao aplicar. NULL = nao resolvido, que e o
-- estado de 100% da tabela no momento em que isto roda.

alter table public.daily_production_records
  add column if not exists srcc_resolucao text,
  add column if not exists srcc_resolucao_fonte text,
  add column if not exists srcc_resolucao_em timestamptz;

comment on column public.daily_production_records.srcc_resolucao is
  'CONCLUSAO derivada do fechamento sobre a restricao SRCC: SIM | NAO | NAO_SE_APLICA. '
  'NULL = nao resolvido. NAO e o dado da gestora (esse fica em raw_payload, copia fiel) '
  'nem o booleano que o calculo consulta (is_srcc_restricted). Quando preenchida, tem '
  'precedencia sobre o raw_payload em getSrccRestrictionLabel.';

comment on column public.daily_production_records.srcc_resolucao_fonte is
  'De onde veio a resolucao. Hoje: fechamento_rr (metadata "RESTRICAO SRCC" do '
  'monthly_closing_entries). Existe para a resposta ser auditavel: uma conclusao sem '
  'procedencia nao se confere.';

comment on column public.daily_production_records.srcc_resolucao_em is
  'Quando a resolucao foi gravada. Junto com a fonte, responde "de onde e desde quando '
  'o sistema sabe disto" sem precisar reprocessar o fechamento.';

-- Dominio explicito. Rejeita valor fora dos tres — sem isto o campo aceitaria
-- "Sim"/"sim"/"nao se aplica" e viraria outra ambiguidade de formato, que e
-- exatamente a classe de problema que esta migration nasceu para evitar.
-- NOT VALID: a tabela esta 100% NULL agora, entao nao ha o que validar, e evita
-- varredura completa no ALTER.
alter table public.daily_production_records
  drop constraint if exists daily_production_records_srcc_resolucao_check;

alter table public.daily_production_records
  add constraint daily_production_records_srcc_resolucao_check
  check (srcc_resolucao is null or srcc_resolucao in ('SIM', 'NAO', 'NAO_SE_APLICA'))
  not valid;

-- Indice parcial: as consultas do passo do import e do backfill perguntam
-- "quais linhas AINDA NAO foram resolvidas" (srcc_resolucao is null). O parcial
-- indexa so as resolvidas, que sao poucas e crescem devagar — o caminho comum
-- (null) segue no scan da competencia, que ja e filtrado por data e empresa.
create index if not exists idx_dpr_srcc_resolucao
  on public.daily_production_records (srcc_resolucao)
  where srcc_resolucao is not null;
