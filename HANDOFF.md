# HANDOFF — Frente VENDA PROPRIA DE GESTAO (23/07/2026)

## Onde parou

- **Branch:** `feat/venda-propria-gestao`
- **Ultimo commit:** `ccefd68` — `gate da venda propria: no-op, PMR byte-identico, trava de flag e reconciliacao`
- **Empilhada sobre:** `feat/gestor-consorcio-por-role` (b3c7506), que por sua vez traz M2a/M2b/M3.
- **Working directory limpo** (nenhuma modificacao minha pendente).

### ATENCAO — branch duplicada

No meio da sessao um `git checkout` que NAO partiu deste trabalho moveu o HEAD para
`feat/ads-bbts-ressarcimento-correcoes`, e os 2 ultimos commits caIram la. Corrigido por
fast-forward: `feat/venda-propria-gestao` foi movida para `ccefd68` e agora tem os 6 commits.
`feat/ads-bbts-ressarcimento-correcoes` ficou apontando para o MESMO commit `ccefd68` — nao foi
apagada nem alterada, mas **ela nao contem trabalho de ADS/BBTS nenhum**: e um alias acidental
desta frente. Decida se apaga ou reaproveita.

---

## CONCLUIDO nesta sessao

Desenho A/B aprovado pelo Diego e implementado por inteiro, mais C e D.

### (A) Onde mora a venda propria — `gestao_venda_propria`

Tabela nova, espelho achatado do PMR para quem NAO e promotor, keyed por
`(app_user_id, year, month, company_id)`. O PMR nao foi tocado (`promoter_id NOT NULL FK promoters`
continua intacto). `consorcio_gestor_payout` (os 10%) tambem ficou intocada — o "40% + 10% = 50%"
nao virou regra em lugar nenhum: os 40% caem na venda propria e os 10% saem do payout, cuja base
sempre somou todas as parcelas (inclusive as que ele mesmo vendeu). Somam na LEITURA da tela.

Flag `app_users.venda_propria` (boolean) com CHECK restringindo aos tres papeis de gestao.

### (B) Como e atribuida — a fila ganhou um dono alternativo

`product_line_assignments.assigned_app_user_id` + CHECK "no maximo um dono". Chave natural,
indice unico parcial da ancora do consorcio e heranca por proposta continuam identicos.

- `lib/produtoBeneficiario.ts` (NOVO) — vocabulario unico do beneficiario (`promotor:<uuid>` /
  `gestao:<uuid>`), `colunasDeDono`, `beneficiarioDaLinha`, `PAPEIS_COM_VENDA_PROPRIA`.
- `lib/produtoAssignments.ts` — `computeProductCommissionByPromoter` virou
  `...ByBeneficiario`; `applyProdutoRepasseAoPmr` filtra SO promotores e devolve os buckets de
  gestao em `.gestao`.
- `lib/consorcio/fila.ts` — `resolveConsorcioPromoterByProposta` virou
  `resolveConsorcioBeneficiarioByProposta`; `assignConsorcioProposta` recebe `beneficiario`.
- `lib/consorcio/carteira.ts` — carteira desnormaliza `app_user_id` alem de `promoter_id`.
- `lib/gestaoVendaPropria.ts` (NOVO) — grava/reconcilia `gestao_venda_propria` + le a venda
  propria de UM usuario. Tem **trava de coerencia**: so paga quem tem `venda_propria = true` e
  papel de gestao ATIVO; o resto vira `ignoradas_sem_flag` (nao vira pagamento fantasma).
- `lib/reconsolidarCompetencia.ts` — chama `applyVendaPropriaGestao` logo depois do repasse ao
  PMR e reporta em `venda_propria_gestao`.

**REGUA:** nenhuma nova. Reusa `repassePromotor` (x0,5833) e `repasseConsorcioPromotor` (x0,40).

### (C) Desfazer o "gestor tambem e promotor"

- Migration `20260723_000001` zera `app_users.promoter_id` dos gestores e devolve o scope CHECK
  ao formato de `20260721_000003`.
- Picker "Tambem e promotor?" REMOVIDO de `CreateUsuarioModal` e `EditUsuarioModal`; no lugar
  entrou o checkbox **"Este gestor tambem vende"** (venda propria), visivel so para socio e so
  para os tres papeis de gestao.
- `POST /api/admin/usuarios` volta a rejeitar `cnpj_id`/`promoter_id` de qualquer papel que nao
  seja promotor; aceita `venda_propria` (403 se nao for socio).
- `PATCH /api/admin/usuarios/[id]` idem, e ZERA o flag quando o usuario sai de um papel de gestao.
- `/api/gestor-consorcio` **parou de ler `session.appUser.promoterId`** e de usar
  `buildPromoterAnalytics`; o bloco agora e "Minha venda propria", lido de `gestao_venda_propria`
  pelo proprio `app_user_id`.

### (D) Escopo do gestor na atribuicao

- `requireAtribuicaoProdutos()` / `withAtribuicaoProdutosAdmin()` em `lib/auth/guards.ts`:
  socio/funcionario -> escopo `TODOS`; gestor_consorcio -> escopo `CONSORCIO`.
- `/api/produtos/atribuicao`: no escopo CONSORCIO nem consulta BBCAP/CONTA_CORRENTE; `sync` so
  roda as ancoras; `assign` com outro `entry_type` da **403**.
- Tela: esconde os dois cards, muda o titulo, dropdown com `optgroup` Promotores / Gestao,
  linhas de gestao em DESTAQUE (chip "VENDA DE GESTAO" + KPI "Venda de gestao") para conferencia.
- `page.tsx` libera o role; `AppShell` ganha "Atribuir consorcio" no grupo Gestao.
- Policy RLS do gestor na fila (defesa em profundidade — a rota usa service_role).

### Gate

`scripts/venda_propria_gestao_gate.cjs` — **self-contained, sem banco** (Supabase falso em
memoria rodando as funcoes REAIS). Registrado em `run_all_gates.cjs`. **18/18 passaram**:

- **A** no-op: sem ninguem habilitado, PMR e payout iguais e `gestao_venda_propria` vazia;
- **B** isolamento: com a venda propria ligada, o payload do PMR fica **byte-identico** ao de A;
- **C** 40 + 10 = 50 sem regra nova, e o payout NAO muda entre A e B;
- **D** trava de coerencia (atribuido com flag desligado nao paga ninguem);
- **E** reconciliacao (proposta devolvida ao balde apaga a linha orfa).

`npx tsc --noEmit` -> **0 erros**. `npm run gates` -> **2 executados, 2 passaram**.

---

## PELA METADE / NAO VERIFICADO

- **`npm run build` NAO foi executado ate o fim** (interrompido no desligamento). O typecheck
  isolado passou com 0 erros e os gates passaram, mas o build do Next (que roda o lint) nao foi
  confirmado. **Primeira coisa a rodar ao retomar.**
- **Nada foi testado contra o banco** — as 3 migrations abaixo ainda nao rodaram no Studio.
  Enquanto nao rodarem, a frente e inerte (as colunas nao existem).

## NAO INICIADO (de proposito)

- **Retroativo do Alan** (decisao 5): o mecanismo esta pronto, mas **nenhuma proposta foi
  atribuida**. Depende da lista de propostas de junho que o Diego vai confirmar.
- **DRE** (decisao 4): a venda propria fica FORA, igual os 10% ja estao. Pendencia conhecida,
  registrada no comentario da migration `20260723_000002`. Vira frente propria.
- **Credito** (decisao 1): fora de escopo. A venda propria cobre BBCAP, Conta Corrente e Consorcio.

---

## SQL PARA RODAR NO STUDIO

Rodar **na ordem**. Os arquivos completos (com verificacoes pos-execucao) estao em
`supabase/migrations/20260723_00000{1,2,3}_*.sql`. Blocos prontos para colar:

### 1) `20260723_000001_desfaz_gestor_promotor.sql`

```sql
begin;

update public.app_users
   set promoter_id = null
 where role = 'gestor_consorcio'
   and promoter_id is not null;

alter table public.app_users
  drop constraint if exists app_users_role_scope_check;

alter table public.app_users
  add constraint app_users_role_scope_check check (
    (role = 'promotor' and cnpj_id is not null and promoter_id is not null) or
    (role in ('socio', 'funcionario', 'supervisor', 'gerente_regional', 'gestor_consorcio')
      and cnpj_id is null and promoter_id is null)
  );

commit;
```

### 2) `20260723_000002_venda_propria_gestao.sql`

```sql
alter table public.app_users
  add column if not exists venda_propria boolean not null default false;

alter table public.app_users
  drop constraint if exists app_users_venda_propria_check;

alter table public.app_users
  add constraint app_users_venda_propria_check check (
    venda_propria = false
    or role in ('gestor_consorcio', 'supervisor', 'gerente_regional')
  );

create table if not exists public.gestao_venda_propria (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete restrict,
  company_id  uuid references public.companies(id),
  year  integer not null,
  month integer not null,
  role_snapshot text,
  bbcap_commission_value          numeric(18,2) not null default 0,
  conta_corrente_commission_value numeric(18,2) not null default 0,
  consorcio_commission_value      numeric(18,2) not null default 0,
  lob_commission_value            numeric(18,2) not null default 0,
  final_commission_value          numeric(18,2) not null default 0,
  source text not null default 'fechamento',
  status text not null default 'ABERTO' check (status in ('ABERTO', 'FECHADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_user_id, year, month, company_id)
);

create index if not exists gestao_venda_propria_comp_idx
  on public.gestao_venda_propria (year, month);
create index if not exists gestao_venda_propria_user_idx
  on public.gestao_venda_propria (app_user_id);

alter table public.gestao_venda_propria enable row level security;
grant select, insert, update, delete on public.gestao_venda_propria to authenticated;

drop policy if exists "gestao_venda_propria_socio_all" on public.gestao_venda_propria;
create policy "gestao_venda_propria_socio_all" on public.gestao_venda_propria for all to authenticated
using (public.current_app_user_role() = 'socio') with check (public.current_app_user_role() = 'socio');

drop policy if exists "gestao_venda_propria_self_select" on public.gestao_venda_propria;
create policy "gestao_venda_propria_self_select" on public.gestao_venda_propria for select to authenticated
using (app_user_id = (select id from public.app_users where auth_user_id = auth.uid()));
```

### 3) `20260723_000003_fila_beneficiario_gestao.sql`

```sql
alter table public.product_line_assignments
  add column if not exists assigned_app_user_id uuid references public.app_users(id);

alter table public.product_line_assignments
  drop constraint if exists product_line_assignments_um_dono_check;

alter table public.product_line_assignments
  add constraint product_line_assignments_um_dono_check check (
    promoter_id is null or assigned_app_user_id is null
  );

create index if not exists idx_product_line_assignments_app_user
  on public.product_line_assignments (assigned_app_user_id);

alter table public.carteira_consorcio
  add column if not exists app_user_id uuid references public.app_users(id);

create index if not exists carteira_consorcio_app_user_idx
  on public.carteira_consorcio (app_user_id);

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
```

### Conferencia depois das tres

```sql
select count(*) from public.app_users where role='gestor_consorcio' and promoter_id is not null; -- 0
select count(*) from public.gestao_venda_propria;                                                -- 0
select count(*) from public.product_line_assignments where assigned_app_user_id is not null;     -- 0
```

---

## PROXIMO PASSO CONCRETO

1. `npm run build` — confirmar que o lint/build do Next passa (unica verificacao que ficou aberta).
2. Rodar as 3 migrations no Studio, na ordem, e conferir os 3 selects acima (todos 0).
3. Ligar o flag do Alan: `/admin/usuarios` -> editar -> "Este gestor tambem vende".
4. Reconsolidar junho e conferir que o PMR e o payout **nao mudaram** (a fila ainda nao tem nada
   atribuido a ele — deve ser no-op real em prod, igual ao gate).
5. So entao, com a lista de propostas confirmada pelo Diego, atribuir as vendas proprias do Alan
   em `/produtos/atribuicao` e reconsolidar de novo.

## Decisoes ja fechadas (nao reabrir)

| # | Decisao |
|---|---|
| 1 | Credito **FORA** do escopo. Venda propria = BBCAP + Conta Corrente + Consorcio. |
| 2 | Auto-atribuicao **LIBERADA**, com `assigned_by` gravado e linhas de gestao em destaque na tela. |
| 3 | Flag `venda_propria`: **so socio** liga (`canChangeUserRole`). Auxiliar financeiro nao. |
| 4 | DRE: venda propria fica **fora** por ora, igual os 10%. Pendencia registrada, frente propria depois. |
| 5 | Retroativo: **nao migrar nada** ainda. Diego confirma quais propostas de junho sao venda propria do Alan. |
| 6 | Migrations ja aplicadas em prod: `20260721_000001..000004`, `20260722_000001`, `20260722_000002`. Logo `consorcio_gestor` **nao existe mais** (drop cascade) — o revert so precisa mexer em `app_users`. |
| 7 | Indice `app_users_um_gestor_consorcio_ativo`: **MANTEM** (1 gestor ativo por vez). |
