-- Migration: Disc.12 - Coluna is_master em promoters
--
-- Distingue promotores reais (pessoas) de chaves master (operacional
-- da empresa, criadas como placeholder de promoter pelo importador
-- quando uma Chave J nao bate com promotor real).
--
-- Cleanup arquitetural para corrigir 2 sintomas simultaneos:
-- 1. KPI activePromoters: 40 (deveria ser 36 - exclui 4 masters)
-- 2. KPI CHAVES MASTER: 0 (deveria ser 4 - j_keys.key_type='INDIVIDUAL'
--    em todas, default que nunca foi atualizado para 'MASTER')
--
-- Diego (socio) mapeou os 4 masters manualmente em 17/05/2026.

-- Adicionar coluna is_master
alter table public.promoters
  add column if not exists is_master boolean not null default false;

comment on column public.promoters.is_master is
  'TRUE para chaves master operacionais da empresa (recebem producao via fluxo MASTER_REASSIGNED quando importador nao bate Chave J com promotor real). FALSE para promotores pessoa-fisica.';

-- Marcar os 4 masters conhecidos
update public.promoters
   set is_master = true,
       updated_at = now()
 where id in (
   'ac7bb664-26c7-4df9-93d4-2ba3e8b642d9',  -- RENATA AL 1
   '4cfd506e-3505-4f25-8075-bb6f66acf8fa',  -- RENATA AL 3
   '96b82ee8-edf4-46d0-9e00-7afc4c66fbbe',  -- MARIA JOSE AL 2
   'f01f5101-2cda-4d54-95b4-b3a74acedfd3'   -- JULIANA PE
 );

-- Atualizar j_keys.key_type para 'MASTER' nas 4 chaves correspondentes
update public.j_keys
   set key_type = 'MASTER',
       updated_at = now()
 where id in (
   'c85ff666-e890-4c2f-b3f3-42dfb7a88ac5',  -- JG626476
   'ccb15aa2-19bc-4b45-99d2-08b34aec7457',  -- JJ089376
   '2dc5d7df-63f4-4a8e-b06c-7a58fd22b196',  -- JI303965
   '54b92f86-5cf4-459c-aa04-6d574e709150'   -- JH157945
 );
