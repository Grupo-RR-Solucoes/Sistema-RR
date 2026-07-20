-- FRENTE DE PRODUTO — Movimento 1: desdobramento das abas BBCAP / Conta Corrente /
-- BB Consorcio em linhas individuais dentro de monthly_closing_entries.
--
-- As linhas nascem com a comissao-EMPRESA ja pronta e SEM promotor (a atribuicao
-- vem no Movimento 2, pela migracao: proposta para BBCAP/Consorcio, numero de conta
-- ou chave J para Conta Corrente). Usam entry_type proprios ('BBCAP',
-- 'CONTA_CORRENTE', 'CONSORCIO') que os consolidadores atuais (CASH/INSURANCE/PRT)
-- ignoram -> aditivo, nao mexe no PMR nem no fechamento_mensal_empresa.
--
-- Idempotencia: chave de conteudo por linha, para nao duplicar em reimport nem em
-- re-envio por outro codigo C. Como o mesmo produto pode vir partido em 2 arquivos
-- (ex.: consorcio no "Todos" + no avulso, com propostas distintas), a chave e por
-- linha (nao por competencia), e o indice e PARCIAL (so nos 3 tipos novos) para nao
-- tocar nas linhas de credito/cash/prt.
--
-- operation_number = PROPOSTA (BBCAP/Consorcio) ou NUMERO DA CONTA (Conta Corrente).
-- contract_number  = discriminador da parcela/tipo (Consorcio: 'R|PARC1' etc;
--                    '' nos demais). O parser grava '' (nunca null) nessas linhas
--                    para a chave ser deterministica (NULL seria distinto no indice).

create unique index if not exists monthly_closing_entries_produto_uidx
  on public.monthly_closing_entries
    (company_id, year, month, entry_type, operation_number, contract_number)
  where entry_type in ('BBCAP', 'CONTA_CORRENTE', 'CONSORCIO');
