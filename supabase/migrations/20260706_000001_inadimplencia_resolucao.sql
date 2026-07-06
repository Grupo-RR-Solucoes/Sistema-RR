-- ============================================================
-- INADIMPLÊNCIA PRT — Fatia B: status de RESOLUÇÃO manual (SOLUCIONADO).
--
-- Adiciona um mecanismo manual SEPARADO do status_acompanhamento (que é do
-- MOTOR). Decisão do Diego: "Recuperado" (motor detectou volta a pagar) é
-- distinto de "Solucionado" (o sócio marca resolvido — quitação / cancelamento /
-- portabilidade / justificado pela Promotiva / pagou). SOLUCIONADO é mais amplo
-- e 100% manual.
--
-- POR QUE UM CAMPO SEPARADO (e não mais um valor em status_acompanhamento):
-- a BLINDAGEM estrutural. O motor (persistInadimplenciaSnapshot) faz UPSERT
-- listando SÓ as colunas do fato + status_acompanhamento/ja_cobrado/cobranca_id.
-- Como resolucao_status/por/em NUNCA entram no payload do upsert nem do update
-- do reconciliador, o PostgREST gera "ON CONFLICT DO UPDATE SET <colunas do
-- payload>" — logo essas 3 colunas jamais são tocadas no recálculo. O motor
-- fisicamente não consegue sobrescrever a marcação manual.
--
-- resolucao_status: PENDENTE (default) → fica na fila; SOLUCIONADO → sai da fila
--   principal, vai pra aba "Solucionados" e SAI do recuperável aberto. O registro
--   NÃO é movido nem apagado — é a mesma tabela, filtrada por resolucao_status.
-- resolucao_por: email do sócio que marcou (auditoria — quem).
-- resolucao_em:  timestamp da marcação (auditoria — quando).
--
-- socio-only via a RLS que já existe na tabela (nada muda no RLS aqui).
-- Aplicada manualmente no Supabase Studio (banco não usa migrate automático).
-- ============================================================

alter table public.prt_inadimplencia_monitor
  add column if not exists resolucao_status text not null default 'PENDENTE'
    check (resolucao_status in ('PENDENTE','SOLUCIONADO')),
  add column if not exists resolucao_por  text,
  add column if not exists resolucao_em   timestamptz;

-- Aba "Solucionados" / filtro da fila por competência:
create index if not exists prt_inadimplencia_monitor_resolucao_idx
  on public.prt_inadimplencia_monitor (competencia, resolucao_status);
