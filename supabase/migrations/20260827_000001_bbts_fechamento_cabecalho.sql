-- Migration: cabecalho "Valor para Emissao da Nota Fiscal" do fechamento ADS/BBTS
--            (2026-08-27) — frente feat/residuo-financeiro
--
-- STATUS: NAO EXECUTADA. Rodar no Studio antes do deploy do codigo desta frente.
--
-- PROBLEMA. O PDF de credito da ADS traz, no bloco de totais, mais colunas do que
-- o parser lia. Ele lia as duas primeiras POR POSICAO (Pagamento AVT e Pagamento
-- PRT) e usava "Abertura de Conta" so como marcador de parada da secao PRT — o
-- valor ia para o lixo. Medido em 27/08/2026 nos dois PDFs em disco:
--
--   competencia   AVT          PRT     Abertura   4a coluna              Total
--   2026-06     7.707,03      7,01       0,00     "Valor Descontado" 0   7.714,04
--   2026-07    18.737,33      7,01     100,00     "Glosa"            0  18.844,34
--
-- Os R$ 100,00 de julho sao exatamente a diferenca entre o card "Recebido" e o
-- total do PDF. E o 4o rotulo MUDOU DE NOME entre as duas competencias — por isso
-- a captura no codigo pareia rotulo com valor e se valida pela identidade da soma,
-- em vez de confiar em nome ou em posicao.
--
-- POR QUE TABELA PROPRIA. Abertura de Conta e Glosa sao grandezas de COMPETENCIA,
-- nao de contrato: nao ha proposta a que anexa-las, entao nao cabem em
-- daily_production_records. E exatamente a situacao do PRT, que ja tem tabela
-- propria (bbts_prt_parcelas) e e lido pela competencia LITERAL, nao pela janela.
-- Esta tabela segue o mesmo precedente, inclusive na chave (dia 01) e no regime de
-- acesso (RLS default-deny, alcancavel so por service_role).
--
-- ESCOPO: PURAMENTE ADITIVA. Uma tabela nova, vazia. Nenhuma linha existente e
-- lida, alterada ou apagada. Nenhum numero muda ate o fechamento ser reimportado.
-- Transacional e idempotente (create table if not exists).
--
-- ORDEM DE DEPLOY: esta migration PRIMEIRO. O codigo tolera a ausencia da tabela
-- (a Abertura entra como 0 e o card fica como esta hoje), entao rodar depois nao
-- quebra nada — mas ate rodar, o valor continua fora.

begin;

create table if not exists bbts_fechamento_cabecalho (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  competencia       date not null,               -- sempre dia 01, igual bbts_prt_parcelas
  pagamento_avt     numeric not null default 0,
  pagamento_prt     numeric not null default 0,
  abertura_conta    numeric not null default 0,
  outras_deducoes   numeric not null default 0,  -- "Valor Descontado" (jun) / "Glosa" (jul)
  pagamento_total   numeric not null default 0,
  rotulos           jsonb,                       -- o cabecalho CRU, rotulo->valor, na ordem
  source_filename   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, competencia)
);

comment on table bbts_fechamento_cabecalho is
  'ADS/BBTS: o bloco "Valor para Emissao da Nota Fiscal" do PDF de credito, uma linha '
  'por competencia. Grandeza de COMPETENCIA (nao de contrato) — mesmo motivo pelo qual '
  'o PRT tem tabela propria. Lida pela competencia LITERAL, nunca pela janela.';

comment on column bbts_fechamento_cabecalho.abertura_conta is
  'Abertura de Conta paga pela BBTS na competencia. Medido: R$ 100,00 em 2026-07 e '
  'R$ 0,00 em 2026-06. Entra na receita da ADS (dre.ts e financialAnalytics.ts).';

comment on column bbts_fechamento_cabecalho.outras_deducoes is
  'A 4a coluna do cabecalho, cujo ROTULO muda: "Valor Descontado" em 06/26, "Glosa" em '
  '07/26. Guardada somada aqui e nominalmente em `rotulos` — o nome e do documento, '
  'nao nosso, e nao deve virar coluna com nome fixo.';

comment on column bbts_fechamento_cabecalho.rotulos is
  'O cabecalho como ele veio: [{rotulo, valor}] na ordem de leitura. E o registro de '
  'que layout produziu estes numeros — sem isso, uma mudanca de rotulo da BBTS ficaria '
  'invisivel depois de gravada.';

alter table bbts_fechamento_cabecalho enable row level security;
-- SEM POLICY, de proposito: default-deny. Os dois leitores (DRE e /financeiro) ja
-- usam service_role para a ADS — o mesmo regime de bbts_prt_parcelas. Registrado
-- aqui porque isso NAO estava documentado para a bbts_prt_parcelas e qualquer
-- leitura futura pelo caminho da pagina vai quebrar igual.

commit;

-- ============================================================
-- Verificacao pos-execucao
-- ============================================================
--   -- (a) a tabela existe e esta vazia:
--   select count(*) from bbts_fechamento_cabecalho;   -- esperado: 0
--
--   -- (b) depois de reimportar o fechamento de julho pela tela:
--   select competencia, pagamento_avt, pagamento_prt, abertura_conta,
--          outras_deducoes, pagamento_total, rotulos
--     from bbts_fechamento_cabecalho
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--    order by competencia;
--   -- esperado p/ 2026-07-01: 18737.33 | 7.01 | 100.00 | 0.00 | 18844.34
--
--   -- (c) a identidade fecha (a mesma que o extrator valida):
--   select competencia,
--          round(pagamento_avt + pagamento_prt + abertura_conta + outras_deducoes, 2)
--            as soma_componentes,
--          pagamento_total
--     from bbts_fechamento_cabecalho;
