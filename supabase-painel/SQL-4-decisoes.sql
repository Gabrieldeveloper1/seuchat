-- 004: decisão de denúncias pelo Discord
alter table public.reports
  add column if not exists discord_message_id text,
  add column if not exists decided_by text,
  add column if not exists decided_at timestamptz;
