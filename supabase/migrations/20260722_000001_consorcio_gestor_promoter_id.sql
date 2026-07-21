-- FRENTE DE PRODUTO — ajuste: o GESTOR de consorcio TAMBEM pode ser PROMOTOR.
--
-- Caso do Alan (consorcio@rrcred.srv.br): ele loga como gestor (role gestor_consorcio,
-- conta unica) mas tambem vende. Numa venda propria recebe 40% (promotor, no PMR) +
-- 10% (gestao, no payout) = 50%. As duas facetas ja existem no ledger e sao linhas
-- INDEPENDENTES (PMR x consorcio_gestor_payout) — nao se somam nem se anulam. Este
-- vinculo e so para a TELA do gestor mostrar tambem a producao dele como promotor.
--
-- Coluna OPCIONAL: gestor puro (futuro) fica com promoter_id NULL e o bloco "Minhas
-- vendas" nao aparece. Quando preenchida, aponta para o registro de promotor do gestor.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).

alter table public.consorcio_gestor
  add column if not exists promoter_id uuid references public.promoters(id);

comment on column public.consorcio_gestor.promoter_id is
  'Opcional: quando o gestor tambem e promotor, aponta para promoters(id). NULL = gestor puro.';

create index if not exists consorcio_gestor_promoter_idx
  on public.consorcio_gestor (promoter_id);
