-- Novos vídeos expiram em 10 dias; outros anexos não expiram automaticamente.
-- Os anexos antigos conservam sua data anterior: não é possível identificar
-- o conteúdo cifrado com segurança e classificá-lo retroativamente.
alter table public.attachments add column if not exists kind text;
alter table public.attachments alter column expires_at drop not null;
alter table public.attachments alter column expires_at drop default;
alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (kind is null or kind in ('video', 'file'));
create index if not exists attachments_expired_video on public.attachments (expires_at) where kind = 'video';
