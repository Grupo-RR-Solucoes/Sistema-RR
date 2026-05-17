-- Disc.13 fecha + cleanup group_code
-- 1. Documenta semantica de promoters.is_master (decisao H1)
-- 2. Preenche companies.group_code (3 ALs + 1 PE)

comment on column promoters.is_master is
'Placeholder operacional: marca que este promoter representa a CHAVE MASTER administrativa do CNPJ (nao e pessoa-fisica promotora). Usado como filtro em /api/promoters/list e KPI activePromoters. Marcacao manual via Disc.12 (17/05/2026).';

update companies set group_code = 'AL' where cnpj = '48.357.275/0001-03';
update companies set group_code = 'AL' where cnpj = '56.140.658/0001-53';
update companies set group_code = 'AL' where cnpj = '55.867.409/0001-00';
update companies set group_code = 'PE' where cnpj = '51.457.289/0001-03';

-- Validacao inline
do $$
declare al_count int; pe_count int;
begin
  select count(*) into al_count from companies where group_code = 'AL';
  select count(*) into pe_count from companies where group_code = 'PE';
  if al_count <> 3 then raise exception 'Expected 3 AL companies, got %', al_count; end if;
  if pe_count <> 1 then raise exception 'Expected 1 PE company, got %', pe_count; end if;
end $$;
