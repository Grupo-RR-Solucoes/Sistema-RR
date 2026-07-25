# HANDOFF — Frente ADS/BBTS: ressarcimento junho + correcoes (2026-07-23)

> NOTA: existe outro `HANDOFF.md` na raiz que e de OUTRA frente (venda propria de
> gestao, sessao concorrente). Este arquivo (`HANDOFF_ADS_BBTS.md`) e o desta
> frente. Nao confundir nem sobrescrever o outro.

## Branch e commit
- Branch: `feat/ads-bbts-ressarcimento-correcoes`
- Ultimo commit: este HANDOFF (ver `git log -1`). Criada a partir de
  `feat/venda-propria-gestao` (base ccefd68).

## AVISO IMPORTANTE — sessao concorrente no mesmo repo
Durante esta sessao OUTRO processo/sessao commitou ativamente em
`feat/venda-propria-gestao` (reflog mostra commits/resets/checkout que EU nao fiz;
o HEAD mudou de branch sozinho entre dois comandos meus). Efeitos:
- As modificacoes pendentes em `app/admin/usuarios/*` do inicio da sessao NAO se
  perderam: foram commitadas por essa outra sessao (commits "gate da venda propria"
  / "tela do gestor"). `git diff HEAD -- app/admin/usuarios` esta vazio hoje.
- Minha branch acabou apontando para o mesmo commit ccefd68 de
  `feat/venda-propria-gestao` (a outra sessao avancou o ponteiro). Meu unico commit
  proprio e este HANDOFF.
- Ao retomar, confirme que nenhuma outra sessao esta operando o repo antes de mexer,
  para nao haver corrida de git.

## NAO escrevi codigo funcional nesta sessao
Toda a sessao foi INVESTIGACAO (agentes read-only + scripts descartaveis em
`scratch/`, que e gitignored e foi limpo). Nenhum arquivo de `lib/`, `app/` ou
migration foi criado/editado. O valor esta consolidado abaixo.

---

## O QUE FOI CONCLUIDO (investigacao/decisao)

### 2.1 TETO A VISTA 5,80% — DECIDIDO: NAO MEXER
O 5,80% e INTENCIONAL, nao e erro. E o teto do PROMOTOR (politica interna do Grupo
RR: o promotor enxerga 5,80%, a empresa fica com o spread de 0,20%, e o excedente
vira diferido 100% empresa). Diferente do teto da EMPRESA de 6,00% (o que a
Promotiva/BBTS paga a RR).
Evidencias:
- `lib/tetoAvistaRR.ts` cabecalho (4-13) e snapshot (60-63): "Teto RR 5,80% ... NAO
  confundir com o teto da EMPRESA 6,00% ... NAO unificar".
- `lib/trp/creditAvistaTrp.ts:31-33` (`TETO_EMPRESA_AVISTA = 0.06`, intocado).
- `docs/MAPA_ARVORE_DEPENDENCIA.md:1029-1034` ("NAO E BUG ... politica interna,
  confirmado pelo Diego"); `docs/escopo-operacional.md:72,78-79`.
- Commit que centralizou o valor: `6acbe7a` (2026-07-18, Diego).
ACAO: nenhuma alteracao de codigo. So relatar.

### 2.2 REGUA BBTS / NAO_CONSIGNADO — DIAGNOSTICADO (conserto NAO aplicado)
Causa: falha do ROTEADOR, nao do parser. `inferCreditTable`
(`lib/motor.ts:369-413`) decide a tabela de credito. O bloco de nao-consignado
(`motor.ts:387-394`) so casa descricao `"CREDITO SALARIO/BENEFICIO/AUTOMATIC"` ou
uma lista de product_code. Os contratos ADS sao `"CDC Novo Automatico"` (e tambem
`"CDC Novo Salario"`, `"CDC Novo Beneficio"`), que:
- NAO contem `"CREDITO AUTOMATIC"` (normalizado -> `"CDC NOVO AUTOMATICO"`); e
- tem `product_code = NULL` no banco (confirmado) — o caminho por product_code
  tambem nao pega.
-> caem no default `motor.ts:412` -> `PUBLICO_GERAL` -> (via `grupoBbts.ts:60`
TABLEKEY_TO_GRUPO) -> `PUBLICO_DEMAIS`. Na conferencia, PUBLICO_DEMAIS nao tem
celula para prazo 24 (prazo_min 36) -> FORA_DA_TABELA.

Fatos medidos:
- A celula certa EXISTE: NAO_CONSIGNADO "a partir de 5,39% / 13+ parcelas",
  Faixa 4 = 8,92% — cobre juros 7,43% e 6,61% com prazo 24.
- O roteador e COMPARTILHADO: a comissao do PROMOTOR (via `calcularOperacao`) usa o
  mesmo `inferCreditTable`. Hoje esses contratos JA recebem % pelo promotor via
  PUBLICO_GERAL: 8,55% (juros 7,43%/6,61%) e 9,37% (juros 5,01% prazo 48). O
  promotor NAO esta zerado — so a conferencia quebra.
- BLAST RADIUS de afrouxar o matcher de forma ingenua e PERIGOSO: `\bSALARIO\b`
  capturaria 281 registros de "CREDITO ANTECIPACAO 13o SALARIO", que sao 13o e
  DEVEM ir para ADIANTAMENTO_13 (Diego pediu para NAO mexer no 13o). Os que
  realmente misroteiam sao SO a familia "CDC NOVO" (Automatico/Salario/Beneficio) =
  6 registros no banco inteiro.

PONTO EXATO ONDE PAROU: rodando o script que media o DELTA na comissao do promotor
ao rotear os 6 contratos "CDC Novo" de PUBLICO_GERAL para
AUTOMATICO_SALARIO_BENEFICIO. A ultima execucao foi interrompida (erro de tool).
FALTA esse numero para decidir ENTRE:
  (a) corrigir o roteador compartilhado `motor.ts:387-394` (principled, mas muda a
      comissao do promotor desses contratos — precisa saber o impacto e se
      reprocessa meses fechados); OU
  (b) corrigir SO na conferencia (override em `lib/bbts/grupoBbts.ts` depois do
      inferCreditTable), sem tocar a comissao do promotor (zero blast radius, mas
      roteia o mesmo contrato diferente em dois lugares).
Matcher estreito seguro (pega so a familia CDC Novo; nunca o 13o, pois o check de
"13" em `motor.ts:383` dispara antes):
  `/\bCDC\b/.test(desc) && (/AUTOMATIC/.test(desc) || /\bSALARIO\b/.test(desc) || /\bBENEFICIO\b/.test(desc))`
ACAO PENDENTE: rodar o delta, decidir (a) vs (b), implementar, e escrever gate que
prove no-op na comissao do promotor OU quantifique a mudanca por contrato/mes.

### 2.3 CONTRACT_DATE NULO — DIAGNOSTICADO (conserto NAO aplicado)
`carregarUniversoBbtsDb` (`lib/bbts/conferenciaBbts.ts:359-413`) filtra
`daily_production_records` por `contract_date` (linhas 371-373). A diaria viva ADS
(`lib/bbtsDailyImport.ts:285-286`) deixa `contract_date` NULO porque a aba "Total"
do relatorio nao tem coluna de data de contratacao. Logo o mes ABERTO retorna 0.
Meses fechados funcionam porque `lib/bbtsClosingImport.ts:306` preenche contract_date.

CORRECAO CERTA (diferente do "corrija a gravacao" pedido): NAO preencher
contract_date na diaria (nao ha fonte; copiar movement_date corromperia a semantica
"data real de venda" que o fechamento reserva). Em vez disso, trocar
`carregarUniversoBbtsDb` para recortar por `movement_date`, replicando a cascata de
`bbtsMonthly.ts:139-141`:
  `getProductionPeriodFromValue(movement_date) || contract_date || proposal_date`,
mantendo a janela holiday-aware de `vigenciaDaCompetencia`. `movement_date` e o
campo canonico de competencia em todo o resto do sistema.

TELAS/ROTAS HOJE ZERADAS EM JULHO (unica cadeia dependente):
- Rota `GET /api/auditoria/bbts-conferencia` (`app/api/auditoria/bbts-conferencia/route.ts:44`)
- Componente `components/auditoria/ConferenciaBbtsSection.tsx`
- Tela `/auditoria` -> secao "AUDITORIA · ADS / Conferencia BBTS"
  (`app/auditoria/page.tsx:142`). No mes vivo cai no vazio "fechamento ADS nao
  importado"; KPIs (deixou de pagar / pago x devido / conformes / PRT gerado) = ZERO.
- Gate `scripts/bbts_conferencia_gate.cjs:92` herda a correcao automaticamente.
ACAO PENDENTE: aplicar a troca para movement_date + rodar o gate.

### TAREFA 1 — RESSARCIMENTO JUNHO — SEM ESTRUTURA -> PROPOR MIGRATION
(Diego autorizou: "se nao houver estrutura, proponha a migration, nao force").
- (a) Caixa: existe `receita_lancamento_manual` (migrations 20260604000001 +
  20260619000001): company_id, ano, mes, categoria CHECK
  ('CONSORCIO','AJUSTE_CONTADOR','OUTRO'), valor, descricao, data_credito. PORÉM tem
  UM SO eixo de competencia (ano/mes = mes de CAIXA/fiscal, ver `lib/dre.ts:361-383`),
  sem coluna para "competencia de PRODUCAO de origem" e sem natureza 'RESSARCIMENTO'.
  Registrar hoje forcaria o dado (categoria errada + perda da origem junho).
- (b) Baixa dos 16 contratos: NAO EXISTE persistencia da conferencia. A conferencia
  (`lib/bbts/conferenciaBbts.ts`) e on-the-fly; nao ha tabela
  `bbts_conferencia`/`auditoria`/`subpagamento`. O status SUBPAGAMENTO so existe em
  memoria. Nao ha onde baixar os 16 contratos.
- (c) Status "ressarcido": nao existe. Unico enum e `StatusBbts`
  (`conferenciaBbts.ts:45-51`). O padrao de resolucao manual mais proximo e
  `resolucao_status ('PENDENTE','SOLUCIONADO')` em `prt_inadimplencia_monitor`
  (migration 20260706_000001), de outro dominio.
ACAO: migrations propostas na secao SQL abaixo. NENHUM dado gravado em producao.

---

## O QUE FICOU PELA METADE
- **2.2**: medicao do delta de comissao do promotor (script interrompido). Sem esse
  numero nao decidi (a) roteador vs (b) so-conferencia. Nada implementado.

## O QUE NAO FOI INICIADO (codigo)
- Implementacao 2.2 (roteador/conferencia) + gate.
- Implementacao 2.3 (carregarUniversoBbtsDb por movement_date) + gate.
- Arquivos de migration da Tarefa 1 (SQL pronto abaixo, mas nao virou arquivo em
  supabase/migrations).
- Insercao dos dados do ressarcimento (depende das migrations aplicadas).
- 2.4 (sobra de caixa no ledger): so proposta (Diego pediu so proposta).

---

## SQL / MIGRATIONS PARA RODAR NO STUDIO (nada aplicado)

> Convencao do repo: migrations nascem "NAO EXECUTADA", rodadas manualmente no
> Studio, em transacao. Conferir nomes de constraint antes.

### Migration 1A — natureza RESSARCIMENTO + competencia de origem em receita_lancamento_manual
```sql
begin;

-- 1) permitir a natureza RESSARCIMENTO. Se o nome do constraint diferir, rode antes:
--    select conname from pg_constraint
--      where conrelid = 'receita_lancamento_manual'::regclass and contype='c';
alter table receita_lancamento_manual
  drop constraint if exists receita_lancamento_manual_categoria_check;
alter table receita_lancamento_manual
  add constraint receita_lancamento_manual_categoria_check
  check (categoria in ('CONSORCIO','AJUSTE_CONTADOR','RESSARCIMENTO','OUTRO'));

-- 2) competencia de PRODUCAO de origem (separada do ano/mes = mes de caixa/fiscal)
alter table receita_lancamento_manual
  add column if not exists competencia_origem_ano integer,
  add column if not exists competencia_origem_mes integer;

comment on column receita_lancamento_manual.competencia_origem_ano is
  'Competencia de PRODUCAO de origem quando difere do ano/mes (mes de caixa). Ex.: ressarcimento de producao 06/2026 recebido em 07/2026. NULL = mesma do caixa.';
comment on column receita_lancamento_manual.competencia_origem_mes is
  'Mes (1-12) da competencia de producao de origem. Ver competencia_origem_ano.';

commit;
```

### Migration 1B — persistencia da conferencia ADS/BBTS (para baixar contratos)
```sql
begin;

create table if not exists bbts_conferencia_resolucao (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  proposal_number       text not null,
  competencia_origem    date not null,            -- 1o dia do mes de PRODUCAO (ex '2026-06-01')
  status_conferencia    text not null,            -- StatusBbts no momento da baixa (ex 'SUBPAGAMENTO')
  resolucao_status      text not null default 'PENDENTE'
                          check (resolucao_status in ('PENDENTE','RESSARCIDO')),
  valor_devido_avista   numeric,
  valor_pago_avista     numeric,
  valor_ressarcido      numeric,
  data_baixa            date,
  receita_lancamento_id uuid references receita_lancamento_manual(id),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_bbts_conf_resol unique (company_id, proposal_number, competencia_origem)
);

alter table bbts_conferencia_resolucao enable row level security;  -- default-deny

comment on table bbts_conferencia_resolucao is
  'Persistencia da resolucao manual da conferencia ADS/BBTS (sobra/falta de caixa). '
  'A conferencia segue on-the-fly; esta tabela guarda a BAIXA de contratos (ex.: '
  'SUBPAGAMENTO ressarcido pela BBTS) com rastro de valor/data/lancamento.';

commit;
```

### Dados a inserir (SO DEPOIS de aplicar 1A e 1B)
```sql
-- (i) recebimento no caixa: caixa = julho, origem producao = junho.
--     company_id ADS = '375aea6d-3b9c-4490-87f0-e739e312c8ef'.
insert into receita_lancamento_manual
  (company_id, ano, mes, data_credito, categoria,
   competencia_origem_ano, competencia_origem_mes, valor, descricao)
values
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', 2026, 7, date '2026-07-15', 'RESSARCIMENTO',
   2026, 6, 1509.44,
   'Ressarcimento BBTS: 16 contratos de jun/2026 pagos na Faixa 1, corrigidos p/ Faixa 4. Recebido 15/07/2026. Producao=junho, caixa=julho.')
returning id;   -- guarde este id para o receita_lancamento_id da baixa

-- (ii) baixa dos 16 contratos. ATENCAO: os 16 NAO foram enumerados nesta sessao.
--      Obter a lista rodando a conferencia de junho e filtrando SUBPAGAMENTO:
--        GET /api/auditoria/bbts-conferencia?year=2026&month=6
--        (ou node no repo: conferirBbtsMes(sb,'2026-06'), filtrar
--         linhas.status === 'SUBPAGAMENTO')
--      A soma dos |diferenca| dos 16 deve fechar em R$ 1.509,44 (validar).
--      Para cada contrato:
insert into bbts_conferencia_resolucao
  (company_id, proposal_number, competencia_origem, status_conferencia,
   resolucao_status, valor_devido_avista, valor_pago_avista, valor_ressarcido,
   data_baixa, receita_lancamento_id, notes)
values
  ('375aea6d-3b9c-4490-87f0-e739e312c8ef', '<PROPOSAL>', date '2026-06-01', 'SUBPAGAMENTO',
   'RESSARCIDO', <devido>, <pago>, <devido-pago>, date '2026-07-15',
   '<id_do_insert_i>', 'Faixa 1->4 ressarcido pela BBTS')
  -- ... repetir para os 16 ...
;
```

---

## 2.4 SOBRA DE CAIXA NO LEDGER — PROPOSTA (nao implementar)
Hoje a sobra (BBTS devido a-vista Faixa 4 menos a base TRP do promotor) so existe
como residuo on-the-fly na conferencia (`somaSobrepagamento`/diferenca em
`conferenciaBbts.ts`). Proposta:
- **Granularidade**: por (company_id, proposal_number, competencia) — mesmo grao da
  conferencia. Uma linha por contrato por competencia.
- **Onde**: estender `bbts_conferencia_resolucao` (1B) OU uma irma `bbts_sobra_caixa`
  com: `devido_avista_bbts` (regua BBTS F4, teto 6% empresa), `base_promotor_trp`
  (TRP F3, teto 5,80%), `sobra = devido - base`, `pago_avista_bbts` (quando o
  fechamento chega), `realizado = pago - base`. Assim a sobra PREVISTA (regua) e a
  REALIZADA (caixa) convivem; a diferenca entre elas e o erro de faixa/subpagamento.
- **Quando gravar**: snapshot por competencia no fechamento (como previsao_snapshot
  faz para PRT), virando historico auditavel; no mes aberto, on-the-fly.
- **Por que separado do PMR**: PMR e comissao de PROMOTOR; a sobra e caixa da
  EMPRESA (spread). Nunca somar no PMR (mesma disciplina do teto 5,80% x 6%).
- **Ligacao com Tarefa 1**: a linha de sobra/subpagamento de um contrato aponta para
  o `receita_lancamento_manual` do ressarcimento (via `receita_lancamento_id`),
  fechando o ciclo previsto -> realizado -> recebido.

---

## PROXIMO PASSO CONCRETO PARA RETOMAR
1. Confirmar que nenhuma outra sessao esta operando o repo (ver AVISO no topo).
2. `git checkout feat/ads-bbts-ressarcimento-correcoes`.
3. Retomar 2.2: rodar o delta de comissao do promotor para os 6 contratos "CDC
   Novo" e decidir (a) roteador vs (b) so-conferencia.
4. Implementar na ordem do Diego: Tarefa 1 (migrations) -> 2.2 -> 2.3, cada um com
   commit em portugues sem caracteres especiais, sem Co-Authored-By, sem push.
5. 2.1: so relatar (nao mexer). 2.4: so a proposta acima.

## ARQUIVOS GERADOS FORA DO CODIGO (nao se perdem — no disco do Diego)
- `C:\Users\diego\Downloads\comparacao_TRP38_x_BBTSv1_2026-07.xlsx` (comparacao
  celula a celula das duas reguas, 5 abas)
- `C:\Users\diego\Downloads\comparacao_TRP38_x_BBTSv1_2026-07.csv`
