-- Número interno do app. Não representa telefone nem usa SMS.
create table if not exists public.app_number_directory (
  app_number text primary key check (app_number ~ '^[1-9][0-9]{4}-[0-9]{4}$'),
  user_id text not null unique references public.identities(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_number_directory enable row level security;
revoke all on public.app_number_directory from anon, authenticated;