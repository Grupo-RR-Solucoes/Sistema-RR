-- ============================================================================
-- BBTS — a perna do PAGAMENTO passa a declarar a competencia do PDF
-- ============================================================================
--
-- O PROBLEMA, medido em 30/08/2026.
--
-- O PDF da BBTS e EXTRATO DE PAGAMENTO: o valor pertence a competencia EM QUE O
-- PDF PAGOU. O PRT e a Abertura de Conta ja respeitam isso (lidos por
-- `.eq(competencia, ...)`), mas as outras duas pernas — `bbts_pag_avista` e
-- `bbts_seguro_pago` — sao lidas pela JANELA das datas do contrato
-- (movement/contract/proposal_date). Nao ha campo que diga de qual fechamento o
-- valor veio.
--
-- Ate hoje isso nao doia porque o importador CARIMBA a competencia na data:
--   lib/bbtsClosingImport.ts:385  compMovementDate = `${year}-${month}-15`
-- Dia 15 cai sempre dentro da janela da propria competencia, entao para toda
-- linha escrita pelo importador vale competencia-do-PDF == competencia-por-janela.
-- Medido: das 61 linhas que carregam valor de fechamento em todo o banco (todas
-- da ADS), 60 tem o carimbo e ZERO delas diverge. Sobra exatamente uma.
--
-- A excecao e UMA linha, e ela mostra que a garantia nao e guardada:
--   id 5240028e-464b-428a-870d-86576c31dfc6  operacao 221262790  seguro 89,42
--   movement_date 2026-07-31, contract_date e proposal_date NULL
--   created_at 2026-08-04 (bbtsDailyImport, datas REAIS do contrato)
--   updated_at 2026-08-28 (o valor de seguro foi BACKFILLADO nela)
-- A linha nasceu do DIARIO e recebeu valor de FECHAMENTO. Pela janela ela cai em
-- 2026-08; o PDF que pagou os 89,42 e o de JULHO. Resultado: julho exibe 115,10
-- em vez de 204,52, e agosto exibe 89,42 que nao sao dele.
--
-- POR QUE COLUNA NOVA, E NAO RECARIMBAR A DATA. Medido:
--   * a linha nao e "uma linha de seguro" — e um contrato inteiro: gross_value
--     12.200,00, insurance_value 89.415,39, term 108, taxa 1,77, chave JJ552710,
--     dona REBECA ARAUJO DE OLIVEIRA. Mexer na data move TUDO isso.
--   * 39 arquivos em lib/ e app/ leem essas tres datas; 23 resolvem competencia
--     por elas. A data e a chave de competencia do sistema inteiro.
--   * o destino esta FECHADO E PAGO: 2026-07 tem 58 linhas de PMR (bbtsx10,
--     fechamentox48) e 2026-08 tem ZERO. Recarimbar injetaria um 2o contrato num
--     mes ja pago — a producao de julho da ADS iria de 519.798,35 para
--     531.998,35. E a trava "reprocessar mes fechado muda valor pago".
-- Entao: a data do CONTRATO fica intocada, e a competencia do PAGAMENTO ganha
-- campo proprio. Mesmo desenho que o PRT e a Abertura ja usam.
--
-- ORDEM DE EXECUCAO — importa. O CHECK so pode ser validado DEPOIS do backfill,
-- senao ele reprova na linha 5240028e. Por isso ele nasce NOT VALID e e validado
-- no fim, quando ja nao ha violacao. Rodar o arquivo inteiro, de uma vez.
--
-- Aplicar no Studio. Idempotente: pode rodar duas vezes sem estragar nada.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) A COLUNA — competencia do fechamento que trouxe o valor da perna de
--    pagamento. NULL = a linha nao carrega valor de fechamento (o caso normal:
--    a esmagadora maioria das linhas e so producao do diario).
-- ---------------------------------------------------------------------------
alter table daily_production_records
  add column if not exists bbts_competencia_fechamento date;

comment on column daily_production_records.bbts_competencia_fechamento is
  'Competencia do fechamento (PDF) que trouxe bbts_pag_avista/bbts_seguro_pago. '
  'Sempre dia 01. NULL = a linha nao carrega valor de fechamento. E a competencia '
  'que o DRE e o card Recebido usam para a perna do PAGAMENTO — a janela das datas '
  'do contrato NAO vale aqui, porque o PDF e extrato de deposito.';

create index if not exists idx_dpr_bbts_comp_fechamento
  on daily_production_records (company_id, bbts_competencia_fechamento)
  where bbts_competencia_fechamento is not null;

-- ---------------------------------------------------------------------------
-- 2) BACKFILL (a) — as 60 linhas que o importador escreveu ja declaram a
--    competencia na data: movement_date terminando em dia 15. O carimbo E a
--    evidencia, entao o backfill so o traduz para a coluna.
--    O `date_trunc` normaliza para o dia 01.
-- ---------------------------------------------------------------------------
update daily_production_records
   set bbts_competencia_fechamento = date_trunc('month', movement_date)::date
 where bbts_competencia_fechamento is null
   and (coalesce(bbts_pag_avista, 0) <> 0 or coalesce(bbts_seguro_pago, 0) <> 0)
   and extract(day from movement_date) = 15;

-- ---------------------------------------------------------------------------
-- 3) BACKFILL (b) — a UNICA linha sem carimbo. Os 89,42 dela sao do PDF de
--    JULHO, e isso e conferivel pela ancora do proprio documento:
--       seguro_calculo do PDF de julho = 204,52 = 115,10 (as 12 linhas de
--       seguro ja carimbadas em julho) + 89,42 (esta)
--    Escopo por id E por valor: se a linha ja tiver sido corrigida por outro
--    caminho, o update simplesmente nao acha nada.
-- ---------------------------------------------------------------------------
update daily_production_records
   set bbts_competencia_fechamento = date '2026-07-01'
 where id = '5240028e-464b-428a-870d-86576c31dfc6'
   and bbts_competencia_fechamento is null
   and bbts_seguro_pago = 89.42;

-- ---------------------------------------------------------------------------
-- 4) A GUARDA. Valor de fechamento so pode existir em linha carimbada.
--    E ela que teria impedido o backfill de 28/08 de entrar sem competencia —
--    que foi exatamente como o defeito nasceu.
--    NOT VALID: nao revarre a tabela agora; a validacao vem no passo 6, depois
--    de o backfill ter zerado as violacoes.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'dpr_valor_fechamento_exige_competencia'
       and conrelid = 'daily_production_records'::regclass
  ) then
    alter table daily_production_records
      add constraint dpr_valor_fechamento_exige_competencia
      check (
        (coalesce(bbts_pag_avista, 0) = 0 and coalesce(bbts_seguro_pago, 0) = 0)
        or bbts_competencia_fechamento is not null
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) O TOTAL DE SEGURO DO CABECALHO — a ancora que faltava.
--    Medido em 30/08/2026: lib/bbtsPdfExtract.ts:541-551 JA LE o "TOTAL" do
--    cabecalho do PDF de seguro (o rotulo "PAGAMENTO DESCONTO TOTAL", ultimo
--    R$ da linha seguinte) e ate o usa como auto-ancora (:568-572). Mas
--    extractBbtsClosingFromPdfs (:600-618) monta `_ancoras` com `seguro_calculo`
--    e DESCARTA o total. E o mesmo caso da Abertura de Conta antes de 28/08:
--    o dado esta no arquivo, e lido, conferido, e jogado fora.
--    Com ele, `bruto - estorno = deposito` deixa de ser derivacao e vira
--    conferencia contra o documento.
--
--    NULLABLE de proposito: 0 e um valor legitimo (competencia sem seguro), e
--    "nao capturado" tem de ser distinguivel de "capturado e vale zero" — a
--    mesma doutrina do `seguro_pdf_ausente` do importador. Junho e julho nascem
--    NULL porque foram importados antes desta coluna existir.
-- ---------------------------------------------------------------------------
alter table bbts_fechamento_totais
  add column if not exists seguro_total numeric;

comment on column bbts_fechamento_totais.seguro_total is
  'Ancora TOTAL do PDF de seguro = o que a BBTS DEPOSITOU de seguro na '
  'competencia (calculo menos estorno). NULL = nao capturado (import anterior a '
  'coluna); 0 = capturado e a competencia nao teve seguro. Conferencia: '
  'Sigma bbts_seguro_pago da competencia - Sigma estorno = seguro_total.';

-- ---------------------------------------------------------------------------
-- 6) VALIDA a guarda. Se este passo falhar, ha linha com valor de fechamento e
--    sem competencia que os backfills nao alcancaram — NAO force: rode a
--    consulta de verificacao abaixo, descubra de que PDF a linha veio, e
--    carimbe. Falhar aqui e o CHECK fazendo o trabalho dele.
-- ---------------------------------------------------------------------------
alter table daily_production_records
  validate constraint dpr_valor_fechamento_exige_competencia;

commit;

-- ============================================================================
-- VERIFICACAO — rodar depois, e colar a saida.
-- ============================================================================
-- (a) nao pode sobrar NENHUMA linha com valor de fechamento e sem carimbo:
--   select count(*) as sem_carimbo
--     from daily_production_records
--    where (coalesce(bbts_pag_avista,0) <> 0 or coalesce(bbts_seguro_pago,0) <> 0)
--      and bbts_competencia_fechamento is null;
--   -- esperado: 0
--
-- (b) a perna do pagamento por competencia do PDF (o que o DRE passa a somar):
--   select bbts_competencia_fechamento as comp,
--          count(*)                                as linhas,
--          round(sum(coalesce(bbts_pag_avista,0)),2) as avt,
--          round(sum(coalesce(bbts_seguro_pago,0)),2) as seguro
--     from daily_production_records
--    where company_id = '375aea6d-3b9c-4490-87f0-e739e312c8ef'
--      and bbts_competencia_fechamento is not null
--    group by 1 order by 1;
--   -- esperado (medido em 30/08/2026, ANTES de rodar, reproduzindo os backfills):
--   --   2026-06-01   18 linhas   avt  7.707,03   seguro   97,54
--   --   2026-07-01   43 linhas   avt 18.737,33   seguro  204,52   <- era 115,10
--   --   (nada em 2026-08: os 89,42 voltaram para julho)
--
-- (c) a guarda existe e esta VALIDADA:
--   select conname, convalidated
--     from pg_constraint
--    where conname = 'dpr_valor_fechamento_exige_competencia';
--   -- esperado: convalidated = true
-- ============================================================================
