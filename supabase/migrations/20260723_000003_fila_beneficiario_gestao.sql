-- FRENTE DE PRODUTO — VENDA PROPRIA DE GESTAO (3/3): a fila ganha um DONO
-- alternativo, e o gestor de consorcio ganha escopo na fila.
--
-- Hoje product_line_assignments aponta SO promoter_id. Para a venda de um papel de
-- gestao (que NAO e promotor), a atribuicao precisa apontar para o app_user. Em vez de
-- criar uma segunda fila, a fila existente ganha uma coluna: a chave natural, o indice
-- unico parcial da ancora do consorcio, a heranca por proposta e o reprocesso do M1
-- continuam EXATAMENTE os mesmos.
--
-- APLICAR MANUALMENTE no Supabase Studio (o banco nao usa migrate automatico).
-- Depende de 20260720_000002 (fila), 20260721_000001 (carteira) e 20260723_000002
-- (app_users.venda_propria).

-- 1) DONO ALTERNATIVO na fila. NULL em tudo que ja existe -> nenhuma linha muda de
--    comportamento (o gate do no-op depende disto).
alter table public.product_line_assignments
  add column if not exists assigned_app_user_id uuid references public.app_users(id);

-- CHECK deliberadamente FROUXO: "no maximo um dono". O acoplamento com `status`
-- (ASSIGNED <-> tem dono) continua onde ja estava, no codigo (assignProductLine /
-- assignConsorcioProposta) — um CHECK duro amarrando status quebraria linhas legadas
-- sem ganho, ja que ninguem escreve nesta tabela fora daquelas duas funcoes.
alter table public.product_line_assignments
  drop constraint if exists product_line_assignments_um_dono_check;

alter table public.product_line_assignments
  add constraint product_line_assignments_um_dono_check check (
    promoter_id is null or assigned_app_user_id is null
  );

create index if not exists idx_product_line_assignments_app_user
  on public.product_line_assignments (assigned_app_user_id);

comment on column public.product_line_assignments.assigned_app_user_id is
  'Dono da linha quando o vendedor e um PAPEL DE GESTAO com venda propria (nao e '
  'promotor). Mutuamente exclusivo com promoter_id. O repasse vai para '
  'gestao_venda_propria, nunca para o PMR.';

-- 2) CARTEIRA do consorcio: mesmo dono alternativo. A carteira DESNORMALIZA o dono
--    (a verdade fica na fila). Sem esta coluna, uma proposta vendida pelo gestor
--    apareceria como "(nao atribuido)" na producao geral da tela dele — a tela
--    mentiria sobre uma venda que tem dono.
alter table public.carteira_consorcio
  add column if not exists app_user_id uuid references public.app_users(id);

create index if not exists carteira_consorcio_app_user_idx
  on public.carteira_consorcio (app_user_id);

-- 3) RLS da fila — o gestor de consorcio ve/edita SO linhas de CONSORCIO.
--    NUNCA BBCAP nem CONTA_CORRENTE, nem no using nem no with check (ele nao pode
--    ler, criar, nem MOVER uma linha PARA fora do consorcio).
--
--    NOTA HONESTA: a rota /api/produtos/atribuicao usa service_role (Escola A), que
--    BYPASSA RLS — o gate real do escopo e o guard + o filtro por entry_type na rota.
--    Esta policy e defesa em profundidade: vale para qualquer acesso com o client anon
--    autenticado (Studio com o JWT dele, rota futura Escola B, PostgREST direto).
drop policy if exists "product_line_assignments_gestor_consorcio" on public.product_line_assignments;
create policy "product_line_assignments_gestor_consorcio" on public.product_line_assignments for all to authenticated
using (
  public.current_app_user_role() = 'gestor_consorcio'
  and entry_type = 'CONSORCIO'
)
with check (
  public.current_app_user_role() = 'gestor_consorcio'
  and entry_type = 'CONSORCIO'
);

-- Verificacao pos-execucao:
--   -- (a) colunas no lugar:
--   select assigned_app_user_id from public.product_line_assignments limit 1;
--   select app_user_id from public.carteira_consorcio limit 1;
--   -- (b) o CHECK barra dois donos (deve dar ERRO):
--   --   update product_line_assignments set assigned_app_user_id = '<app_users.id>'
--   --    where promoter_id is not null limit 1;
--   -- (c) NENHUMA linha da fila tem dono de gestao ainda (gate do no-op; o retroativo
--   --     do Alan so entra depois que o Diego confirmar as propostas de junho):
--   select count(*) from public.product_line_assignments
--    where assigned_app_user_id is not null;   -- esperado: 0
