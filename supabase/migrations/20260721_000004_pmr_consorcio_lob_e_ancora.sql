-- FRENTE DE PRODUTO — Movimento 2b: colunas do consorcio/LOB no PMR + ancora da fila.
--
-- 1) LEDGER — duas colunas achatadas no PMR (mesmo padrao do M2a: uma coluna por
--    componente, somada no final_commission_value). consorcio_commission_value recebe
--    o repasse do promotor (comissao-empresa x 0,40). lob_commission_value nasce
--    ZERADA (decisao C: LOB adiado; M1 nao desdobra portabilidade — sem fonte de dado).
--    O gestor (10%) NAO entra no PMR: vai no payout separado (20260721_000003).
--
-- 2) ANCORA da fila — heranca por proposta. O consorcio e diferido: uma proposta tem
--    PARC1..n em meses diferentes, todas do MESMO promotor. Entao a atribuicao e
--    POR PROPOSTA (uma ancora), nao por parcela/mes. Este indice unico parcial garante
--    UMA ancora por (company_id, proposta) para entry_type='CONSORCIO'. A ancora usa
--    contract_number='' e year/month = 1a competencia vista (informativo); a resolucao
--    do promotor por parcela ignora year/month e casa so pela proposta.
--
-- Depende de 20260720_000002 (product_line_assignments) e 20260420_000001 (PMR).
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

alter table public.promoter_monthly_results
  add column if not exists consorcio_commission_value numeric(18,2) not null default 0,
  add column if not exists lob_commission_value numeric(18,2) not null default 0;

-- Ancora por proposta (heranca): 1 linha por (company_id, proposta) no consorcio.
-- Parcial em CONSORCIO para nao interferir na chave natural por-parcela dos eventos
-- unicos (BBCAP/CONTA_CORRENTE). O codigo cria/atualiza a ancora por select+insert/
-- update (nao por upsert onConflict), entao este indice e a rede de seguranca.
create unique index if not exists product_line_assignments_consorcio_ancora_uidx
  on public.product_line_assignments (company_id, operation_number)
  where entry_type = 'CONSORCIO';
